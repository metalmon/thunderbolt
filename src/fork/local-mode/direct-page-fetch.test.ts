/* Copyright (c) Okta Plus LLC. All rights reserved.
 * Fork-owned file (see AGENTS.md / CLAUDE.md: additive fork surface). */

/**
 * Предохранитель полосы чтения страниц без Pro.
 *
 * Зачем он вообще: модель сама выбирает адрес и вправе идти по ссылкам, найденным
 * внутри прочитанной страницы. Значит текст чужой страницы может велеть ей сходить
 * по внутреннему адресу — готовая связка «внедрение в запрос → SSRF» на машине
 * оператора, где серверного предохранителя больше нет.
 *
 * Спека: `docs/development/autonomous-web-fetch.md`, раздел 4.
 */

import { describe, expect, it } from 'bun:test'
import {
  BlockedTargetError,
  fetchPageDirect,
  TooManyHopsError,
  type DirectPageFetchDeps,
  type PinnedResponse,
} from './direct-page-fetch'

const page = (html: string): PinnedResponse => ({
  status: 200,
  location: null,
  content_type: 'text/html',
  body: html,
  truncated: false,
})

const redirectTo = (location: string): PinnedResponse => ({
  status: 302,
  location,
  content_type: null,
  body: '',
  truncated: false,
})

/** Собрать зависимости: разрешитель имён и привязанный запросчик, оба поддельные. */
const deps = (options: {
  resolve?: Record<string, string[]>
  responses?: Record<string, PinnedResponse>
  /** Видит и адрес, и то, к какому IP запрос был привязан. */
  onFetch?: (url: string, address: string) => void
}): DirectPageFetchDeps => ({
  resolveHost: (host) => Promise.resolve(options.resolve?.[host] ?? ['93.184.216.34']),
  fetchPinned: (url, address) => {
    options.onFetch?.(url, address)
    return Promise.resolve(options.responses?.[url] ?? page('<html><body><p>обычная страница</p></body></html>'))
  },
})

describe('предохранитель адреса', () => {
  it('отказывает на обратной петле', async () => {
    await expect(fetchPageDirect('http://127.0.0.1/admin', deps({}))).rejects.toBeInstanceOf(BlockedTargetError)
  })

  it('отказывает на частной сети', async () => {
    await expect(fetchPageDirect('http://192.168.1.1/', deps({}))).rejects.toBeInstanceOf(BlockedTargetError)
  })

  it('отказывает на link-local, откуда читают метаданные облака', async () => {
    await expect(fetchPageDirect('http://169.254.169.254/latest/meta-data/', deps({}))).rejects.toBeInstanceOf(
      BlockedTargetError,
    )
  })

  it('отказывает на именах, которые означают саму машину', async () => {
    for (const host of ['localhost', 'app.localhost', 'printer.local', 'host.docker.internal']) {
      await expect(fetchPageDirect(`http://${host}/`, deps({}))).rejects.toBeInstanceOf(BlockedTargetError)
    }
  })

  /**
   * Этот случай и есть причина выбрать `isPrivateOrInternalAddress`, а не
   * `isLocalNetworkAddress`: второй РАЗРЕШАЮЩИЙ и переходные механизмы частными
   * намеренно не считает, поэтому такой адрес он пропустит.
   *
   * `64:ff9b::c0a8:101` — NAT64 с вложенным `192.168.1.1`.
   */
  it('отказывает на адресе с вложенным частным IPv4', async () => {
    await expect(fetchPageDirect('http://[64:ff9b::c0a8:101]/', deps({}))).rejects.toBeInstanceOf(BlockedTargetError)
  })

  /**
   * Раздвоенный DNS. Имя публичное, адрес частный — в контуре это не теория:
   * туннель подделывает DNS в `127.101.x.x`. Литеральной проверки здесь мало,
   * и именно поэтому имя разрешается на стороне Rust.
   */
  it('отказывает, когда публичное имя разрешается в частный адрес', async () => {
    const probe = deps({ resolve: { 'internal.example.com': ['127.101.0.7'] } })
    await expect(fetchPageDirect('https://internal.example.com/', probe)).rejects.toBeInstanceOf(BlockedTargetError)
  })

  it('отказывает, когда частный адрес лишь ОДИН из полученных', async () => {
    const probe = deps({ resolve: { 'mixed.example.com': ['93.184.216.34', '10.0.0.5'] } })
    await expect(fetchPageDirect('https://mixed.example.com/', probe)).rejects.toBeInstanceOf(BlockedTargetError)
  })

  it('отказывает, когда имя не разрешается ни во что', async () => {
    const probe = deps({ resolve: { 'nowhere.example.com': [] } })
    await expect(fetchPageDirect('https://nowhere.example.com/', probe)).rejects.toBeInstanceOf(BlockedTargetError)
  })

  it('отказывает на чужой схеме', async () => {
    await expect(fetchPageDirect('file:///C:/Windows/win.ini', deps({}))).rejects.toBeInstanceOf(BlockedTargetError)
  })

  it('не отправляет запрос на адрес, который отклонил', async () => {
    const attempted: string[] = []
    const probe = deps({ onFetch: (url) => attempted.push(url) })
    await expect(fetchPageDirect('http://127.0.0.1/', probe)).rejects.toBeInstanceOf(BlockedTargetError)
    expect(attempted).toEqual([])
  })
})

describe('перенаправления', () => {
  it('проверяет адрес ЗАНОВО после перехода на чужое происхождение', async () => {
    const attempted: string[] = []
    const probe = deps({
      responses: { 'https://public.example.com/': redirectTo('http://10.0.0.5/secret') },
      onFetch: (url) => attempted.push(url),
    })
    await expect(fetchPageDirect('https://public.example.com/', probe)).rejects.toBeInstanceOf(BlockedTargetError)
    expect(attempted).toEqual(['https://public.example.com/'])
  })

  it('проходит переход на чужое происхождение, когда адрес публичный', async () => {
    const probe = deps({
      responses: {
        'https://example.com/': redirectTo('https://www.example.com/'),
        'https://www.example.com/': page('<html><title>Цель</title><body><p>дошли</p></body></html>'),
      },
    })
    const result = await fetchPageDirect('https://example.com/', probe)
    expect(result?.url).toBe('https://www.example.com/')
    expect(result?.title).toBe('Цель')
  })

  it('отказывает после пяти переходов', async () => {
    const probe: DirectPageFetchDeps = {
      resolveHost: () => Promise.resolve(['93.184.216.34']),
      fetchPinned: (url) => Promise.resolve(redirectTo(`${url}a`)),
    }
    await expect(fetchPageDirect('https://loop.example.com/', probe)).rejects.toBeInstanceOf(TooManyHopsError)
  })
})

describe('привязка к проверенному адресу', () => {
  /**
   * Это и есть закрытие подмены DNS: запрос уходит с ИМЕНЕМ в адресе и с
   * ПРОВЕРЕННЫМ адресом рядом, а подключение в Rust идёт только к названному.
   * Если привязка когда-нибудь отвяжется, имя разрешится второй раз, и окно для
   * подмены вернётся — пусть об этом скажет красный тест.
   */
  it('передаёт запросчику именно тот адрес, который прошёл проверку', async () => {
    const calls: Array<[string, string]> = []
    const probe = deps({
      resolve: { 'example.com': ['93.184.216.34', '93.184.216.35'] },
      onFetch: (url, address) => calls.push([url, address]),
    })
    await fetchPageDirect('https://example.com/', probe)
    expect(calls).toEqual([['https://example.com/', '93.184.216.34']])
  })

  it('на каждом переходе привязывается заново, к адресу нового узла', async () => {
    const calls: Array<[string, string]> = []
    const probe = deps({
      resolve: { 'example.com': ['93.184.216.34'], 'www.example.com': ['93.184.216.99'] },
      responses: {
        'https://example.com/': redirectTo('https://www.example.com/'),
        'https://www.example.com/': page('<html><body><p>дошли</p></body></html>'),
      },
      onFetch: (url, address) => calls.push([url, address]),
    })
    await fetchPageDirect('https://example.com/', probe)
    expect(calls).toEqual([
      ['https://example.com/', '93.184.216.34'],
      ['https://www.example.com/', '93.184.216.99'],
    ])
  })

  it('для литерального адреса привязывается к нему же', async () => {
    const calls: Array<[string, string]> = []
    const probe = deps({ onFetch: (url, address) => calls.push([url, address]) })
    await fetchPageDirect('https://93.184.216.34/', probe)
    expect(calls).toEqual([['https://93.184.216.34/', '93.184.216.34']])
  })
})

describe('разбор страницы', () => {
  it('сохраняет ссылки в тексте и разрешает их против КОНЕЧНОГО адреса', async () => {
    const probe = deps({
      responses: {
        'https://example.com/start': redirectTo('https://docs.example.com/guide/intro'),
        'https://docs.example.com/guide/intro': page(
          '<html><body><p>см. <a href="../next">дальше</a></p></body></html>',
        ),
      },
    })
    const result = await fetchPageDirect('https://example.com/start', probe)
    expect(result?.text).toContain('[дальше](https://docs.example.com/next)')
    expect(result?.text).toContain('https://docs.example.com/next')
  })

  it('выбрасывает сценарии и оформление, а не только скрывает их', async () => {
    const probe = deps({
      responses: {
        'https://example.com/': page(
          '<html><body><script>var a="секрет"</script><style>p{color:red}</style><p>текст</p></body></html>',
        ),
      },
    })
    const result = await fetchPageDirect('https://example.com/', probe)
    expect(result?.text).toContain('текст')
    expect(result?.text).not.toContain('секрет')
    expect(result?.text).not.toContain('color:red')
  })
})
