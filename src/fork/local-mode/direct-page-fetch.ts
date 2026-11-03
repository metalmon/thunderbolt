/* Copyright (c) Okta Plus LLC. All rights reserved.
 * Fork-owned file (see AGENTS.md / CLAUDE.md: additive fork surface). */

/**
 * Чтение страницы без полосы Pro.
 *
 * Спека: `docs/development/autonomous-web-fetch.md`.
 *
 * Полоса включается всюду, где `shouldIncludeProTools` ложно: нет бэкенда, нет
 * подписки, либо оператор выключил Pro вручную. Поиска она не заменяет — только
 * чтение по ссылке, с правом пойти по ссылкам, найденным внутри прочитанного.
 *
 * Потолок осознанный: сценарии на странице не исполняются, поэтому страница,
 * рисующая себя сценариями, вернёт пустой каркас. Это говорится пользователю, а
 * не достраивается догадкой.
 */

import { invoke } from '@tauri-apps/api/core'
import { isPrivateOrInternalAddress, parseIpAddress } from '@shared/ip-classification'
import { redirectStatuses } from '@shared/proxy-protocol'
import type { FetchContentData } from '@/integrations/thunderbolt-pro/schemas'
import { getActiveLocale } from '@/i18n/active-locale'
import { sourceLocale } from '@shared/i18n/locales'

/** Столько переходов проходим, дальше считаем петлёй. Как у предохранителя бэкенда. */
const maxHops = 5

/** Тот же порядок усечения, что у бэкенда, чтобы `isTruncated` значил одно и то же. */
const maxChars = 16_000

/**
 * Разрешитель имени. На клиенте его даёт команда Tauri: в отрисовщике имя
 * разрешить нечем.
 *
 * Внедряется зависимостью по той же причине, по которой внедряется `DnsLookup` в
 * `backend/src/utils/url-validation.ts`: `mock.module` течёт между файлами набора.
 */
export type ResolveHost = (host: string) => Promise<string[]>

/** Что отдаёт `fork_fetch_pinned`. Перенаправления не отслежены: их проходим здесь. */
export type PinnedResponse = {
  status: number
  location: string | null
  content_type: string | null
  body: string
  truncated: boolean
}

export type DirectPageFetchDeps = {
  resolveHost: ResolveHost
  /** Запрос, подключённый ТОЛЬКО к названному адресу. Имя больше не разрешается. */
  fetchPinned: (url: string, address: string, acceptLanguage: string) => Promise<PinnedResponse>
}

/**
 * Настоящие зависимости: обе — команды Tauri. Запрос живёт в Rust, потому что
 * привязка к проверенному адресу требует своих `Host` и SNI, а из вебвью их не
 * задать.
 *
 * ⚠ Полоса существует только под Tauri. `operationMode` считается из сборочной
 * переменной и платформы не знает, а в обозревателе обычный запрос к чужому узлу
 * убивает CORS, а команд Tauri там нет вовсе. Затвор — в `src/lib/tools.ts`.
 */
export const directPageFetchDeps: DirectPageFetchDeps = {
  resolveHost: (host) => invoke<string[]>('fork_resolve_host', { host }),
  fetchPinned: (url, address, acceptLanguage) =>
    invoke<PinnedResponse>('fork_fetch_pinned', { url, address, acceptLanguage }),
}

/** Адрес, который предохранитель не пропустил. Отдельный сорт: модели про него говорим иначе, чем про сбой сети. */
export class BlockedTargetError extends Error {}

/** Цепочка перенаправлений без конца. */
export class TooManyHopsError extends Error {}

/** Содержимое, из которого текста не добыть: PDF, двоичное, каркас без слов. */
export class UnreadableContentError extends Error {}

/**
 * Чем представляемся чужой странице по части языка.
 *
 * Повторяет поведение бэкенда (`backend/src/utils/accept-language.ts`), чтобы одна
 * и та же страница отвечала одинаково, какой бы полосой её ни читали: английский и
 * всё неизвестное — английской цепочкой, остальное — своим языком с английским
 * запасным.
 *
 * Сам заголовок о клиенте ставит Rust: он один на все запросы и строкой из
 * вебвью управляться не должен.
 */
const acceptLanguageChain = (): string => {
  const locale = getActiveLocale()
  return !locale || locale === sourceLocale ? 'en-US,en;q=0.9' : `${locale},en;q=0.9`
}

/** Имена, означающие саму машину: адреса за ними не разрешить, а идти туда нельзя. */
const deviceLocalHosts = ['localhost', 'host.docker.internal']

/**
 * Пропустить адрес или отказать — ДО всякого запроса.
 *
 * ⚠ Предикат здесь `isPrivateOrInternalAddress`, а не `isLocalNetworkAddress`.
 * Второй — РАЗРЕШАЮЩИЙ: его назначение в `src/lib/native-fetch.ts` — пропускать
 * службы на самой машине, и переходные механизмы (NAT64, 6to4, Teredo) он
 * частными намеренно не считает. Подмена одного другим здесь была бы дырой, а не
 * опечаткой; закреплено тестом на `64:ff9b::c0a8:101`.
 *
 * ⚠ И по той же причине политику нельзя переносить в `src/lib/native-fetch.ts`:
 * он пропускает местные адреса намеренно, и правка там сломает свои модели и свой
 * бэкенд по адресу вида `localhost`.
 *
 * Возвращает АДРЕС, к которому можно подключиться, и этим закрывает подмену DNS:
 * имя разрешается ровно один раз, здесь, и дальше запрос привязывается к уже
 * проверенному адресу (`fork_fetch_pinned`). Второго разрешения нет, значит нет и
 * окна, в которое ответ DNS мог бы подмениться между проверкой и подключением.
 */
const resolvePublicTarget = async (url: URL, deps: DirectPageFetchDeps): Promise<string> => {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BlockedTargetError(`Схема ${url.protocol} не читается`)
  }

  // Квадратные скобки — требование записи IPv6 в адресе; точка на конце — корень DNS.
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()

  const literal = parseIpAddress(host)
  if (literal) {
    if (isPrivateOrInternalAddress(literal)) {
      throw new BlockedTargetError(`${host} — частный или внутренний адрес`)
    }
    return host
  }

  if (deviceLocalHosts.includes(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new BlockedTargetError(`${host} означает саму машину`)
  }

  const addresses = await deps.resolveHost(host)
  if (!addresses.length) {
    throw new BlockedTargetError(`${host} не разрешается ни в один адрес`)
  }
  // Отказ, если непубличный ХОТЯ БЫ ОДИН: подключаются к любому из полученных.
  for (const address of addresses) {
    const resolved = parseIpAddress(address)
    if (!resolved) {
      throw new BlockedTargetError(`${host} разрешается в неразбираемый адрес ${address}`)
    }
    if (isPrivateOrInternalAddress(resolved)) {
      throw new BlockedTargetError(`${host} разрешается в частный адрес ${address}`)
    }
  }
  // Привязываемся к первому: проверены все, так что любой годится, а подключение
  // пойдёт только к названному.
  return addresses[0]
}

/** Узлы, которые к содержимому страницы не относятся и только съедают окно контекста. */
const strippedSelectors = 'script, style, noscript, template, svg, nav, footer, aside, header, form'

/** Ссылка в тексте остаётся видимой разметкой: без неё обход по цепочке кормить нечем. */
const inlineLink = (text: string, href: string): string => `[${text}](${href})`

type ParsedPage = {
  title: string | null
  text: string
  links: string[]
  author: string | null
  favicon: string | null
  image: string | null
  publishedDate: string | null
}

const metaContent = (doc: Document, selectors: string[]): string | null => {
  for (const selector of selectors) {
    const value = doc.querySelector(selector)?.getAttribute('content')?.trim()
    if (value) {
      return value
    }
  }
  return null
}

/**
 * Разобрать страницу в текст со ссылками.
 *
 * `DOMParser` сценариев не исполняет, поэтому чужую разметку он разбирает
 * безопасно — и поэтому же не видит того, что страница рисует сама.
 */
const parsePage = (html: string, finalUrl: URL): ParsedPage => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const node of doc.querySelectorAll(strippedSelectors)) {
    node.remove()
  }

  // Адреса разрешаем против КОНЕЧНОГО адреса, после всех переходов: против
  // исходного список ссылок указывал бы не туда.
  const links: string[] = []
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? ''
    if (!URL.canParse(href, finalUrl)) {
      continue
    }
    const absolute = new URL(href, finalUrl)
    if (absolute.protocol !== 'https:' && absolute.protocol !== 'http:') {
      continue
    }
    const label = (anchor.textContent ?? '').trim()
    anchor.replaceWith(doc.createTextNode(label ? inlineLink(label, absolute.toString()) : absolute.toString()))
    if (!links.includes(absolute.toString())) {
      links.push(absolute.toString())
    }
  }

  const body = doc.body?.textContent ?? ''
  return {
    title: doc.querySelector('title')?.textContent?.trim() || null,
    text: body
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    links,
    author: metaContent(doc, ['meta[name="author"]', 'meta[property="article:author"]']),
    favicon: metaContent(doc, ['meta[name="msapplication-TileImage"]']),
    image: metaContent(doc, ['meta[property="og:image"]', 'meta[name="twitter:image"]']),
    publishedDate: metaContent(doc, ['meta[property="article:published_time"]', 'meta[name="date"]']),
  }
}

/** Собрать то же, что отдаёт полоса Pro, чтобы нумерация источников и виджеты работали без переходника. */
const toFetchContentData = (page: ParsedPage, finalUrl: URL, maxLength = maxChars): FetchContentData => {
  const limit = Math.min(maxLength, maxChars)
  const isTruncated = page.text.length > limit
  const linkList = page.links.length ? `\n\nСсылки на странице:\n${page.links.join('\n')}` : ''
  return {
    url: finalUrl.toString(),
    title: page.title,
    text: (isTruncated ? page.text.slice(0, limit) : page.text) + linkList,
    isTruncated,
    favicon: page.favicon,
    image: page.image,
    author: page.author,
    publishedDate: page.publishedDate,
  }
}

const readBody = (response: PinnedResponse): string => {
  const type = response.content_type ?? ''
  if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) {
    throw new UnreadableContentError(`Содержимое типа ${type} текстом не читается`)
  }
  // Предел держит Rust потоком, против сервера, совравшего в `content-length`.
  // Обрезанную разметку всё равно разбираем: половина статьи полезнее отказа.
  return response.body
}

/**
 * Прочитать страницу по адресу, пройдя перенаправления.
 *
 * Переходы не отслеживает никто: `fork_fetch_pinned` идёт с `Policy::none()`,
 * поэтому каждый шаг заново разрешается, проверяется и привязывается здесь.
 */
export const fetchPageDirect = async (
  rawUrl: string,
  deps: DirectPageFetchDeps,
  maxLength?: number,
): Promise<FetchContentData> => {
  if (!URL.canParse(rawUrl)) {
    throw new BlockedTargetError(`Адрес не разбирается: ${rawUrl}`)
  }
  let current = new URL(rawUrl)

  for (let hop = 0; ; hop++) {
    // На КАЖДОМ шаге, а не только на первом: перенаправления не отслеживает
    // никто кроме нас, значит и разрешать, проверять и привязывать каждый шаг —
    // наша работа.
    const address = await resolvePublicTarget(current, deps)
    const response = await deps.fetchPinned(current.toString(), address, acceptLanguageChain())

    const location = response.location
    if (!redirectStatuses.has(response.status) || !location) {
      const page = parsePage(readBody(response), current)
      if (!page.text) {
        throw new UnreadableContentError('Страница вернула каркас без текста: вероятно, она рисует себя сценариями')
      }
      return toFetchContentData(page, current, maxLength)
    }

    if (hop === maxHops) {
      throw new TooManyHopsError(`Больше ${maxHops} перенаправлений, начиная с ${rawUrl}`)
    }
    if (!URL.canParse(location, current)) {
      throw new BlockedTargetError(`Перенаправление на неразбираемый адрес: ${location}`)
    }
    current = new URL(location, current)
  }
}
