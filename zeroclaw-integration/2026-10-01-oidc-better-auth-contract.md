# OIDC-вход в агентов voltd через Better Auth — контракт для бэкенда Thunderbolt

Дата: 2026-10-01. Сторона voltd (Volt-форк): ветка `feat/fork-voltd-8289`,
апстримный `[oidc.<alias>]`-провайдер (#8289 stage 5) + форковый диспатч bearer на `/acp`.

## Что это даёт

Пользователь залогинен в клиенте Thunderbolt (email-OTP, Keycloak через SSO —
не важно). Клиент берёт у своего бэкенда **JWT** и подключается к `/acp` с ним
как bearer — **без кода спаривания и без токенов `zc_`**. voltd проверяет подпись
по JWKS бэкенда, берёт из токена группы, маппит их на профили доступа
(`[permission_profiles.*]`) и отдаёт ровно тех агентов, что положены группе.
Пользователи и группы управляются в IdP/бэкенде; каталог «группа → агенты»
живёт в конфиге voltd.

ACP-контракт клиента **не меняется**: тот же `bearer.<token>` subprotocol
(или `?token=`), тот же ростер в `initialize._meta.zeroclaw.agents`
`{alias, display_name, default}`, тот же отказ `-32602 / agent_not_permitted`
на `session/new`, тот же 401 на upgrade, если у принципала нет ни одного агента.

## Что должен отдавать бэкенд (issuer)

Проверка на стороне voltd — апстримный код, он строгий и fail-closed. Всё ниже
обязательно.

### 1. Discovery

`GET <issuer>/.well-known/openid-configuration` →

```json
{ "issuer": "<issuer>", "jwks_uri": "<issuer>/voltd/jwks" }
```

`issuer` — строка **байт-в-байт** равная `iss` в токенах и значению
`[oidc.thunderbolt].issuer` в voltd. **https обязателен** (http voltd принимает
только для loopback-хоста). Без query/fragment, без завершающего `/`.
Плагин `jwt` Better Auth этот документ **не** отдаёт — нужен свой роут
(Elysia, на корне `BETTER_AUTH_URL`).

### 2. JWKS + выдача токена — СВОЙ роут на `jose`, не плагин `jwt`

**Проверено на пилоте 2026-10-01:** voltd (апстримный код) принимает в
JWKS-режиме **только RFC 9068 typed access tokens** — header обязан нести
`typ: "at+jwt"`, а конфиг — `require_at_jwt = true` (иначе voltd объявляет
всю auth-конфигурацию невалидной и ставит deny-all). Плагин `jwt` Better Auth
header не настраивает (жёстко `{alg, kid}`), поэтому он **не подходит**
без костыля с `jwt.sign` + `jwks.remoteUrl`. Проще и честнее — свой мини-сервис
(~40 строк, `jose` уже в зависимостях):

```ts
import { SignJWT, exportJWK, importPKCS8, importSPKI, calculateJwkThumbprint } from 'jose'

// Ключ ES256 (P-256) из секрета (PEM в env/секрет-сторе). Ротация — добавить
// второй kid в JWKS, подписывать новым, старый убрать через >= 15 минут.
const privateKey = await importPKCS8(settings.voltdJwtPrivateKeyPem, 'ES256')
const publicJwk = { ...(await exportJWK(await importSPKI(settings.voltdJwtPublicKeyPem, 'ES256'))), alg: 'ES256', use: 'sig' }
publicJwk.kid = await calculateJwkThumbprint(publicJwk)

app
  .get('/.well-known/openid-configuration', () => ({ issuer: settings.publicApiUrl, jwks_uri: `${settings.publicApiUrl}/voltd/jwks` }))
  .get('/voltd/jwks', () => ({ keys: [publicJwk] }))
  .get('/voltd/token', async ({ user, set }) => {        // session-auth (cookie или bearer-плагин)
    if (!user || user.isAnonymous) { set.status = 401; return { error: 'Unauthorized' } }
    const token = await new SignJWT({ client_id: 'thunderbolt', groups: user.groups ?? [] })
      .setProtectedHeader({ alg: 'ES256', kid: publicJwk.kid, typ: 'at+jwt' })
      .setIssuer(settings.publicApiUrl)                    // == [oidc.thunderbolt].issuer
      .setAudience('volt')                                 // == [oidc.thunderbolt].audience
      .setSubject(user.id)
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime('15m')                            // voltd: max_auth_lifetime_secs = 900
      .sign(privateKey)
    return { token }
  })
```

Ключ: **ES256 (P-256) или RS256** — EdDSA voltd отвергает (`unsupported JWT alg`).
Если всё же хочется плагин `jwt`: `jwks: { remoteUrl: <свой JWKS> }` + `jwt.sign`
(кастомная подпись, где header задаёте сами) — но тогда ключи всё равно ваши.

### 3. Токен

| claim | требование |
|---|---|
| `iss` | == issuer |
| `aud` | содержит `"volt"` |
| `sub` | непустой, стабильный (user.id) |
| `iat`, `exp` | есть; `exp - iat` ≤ 900 с (voltd режет по `max_auth_lifetime_secs`) |
| `jti` | непустой |
| `client_id` | `"thunderbolt"` |
| `groups` | массив строк; значения из каталога voltd (`volt-admins`, `volt-crm`, …). Лишние — игнорируются; **ни одной известной — 401** |
| header `typ` | **`at+jwt` ОБЯЗАТЕЛЕН** (`require_at_jwt = true`; без него — deny) |
| header `alg`,`kid` | ES256 + kid из JWKS |

Что voltd делает с группами: `profile_map = { "volt-admins" = "operator", "volt-crm" = "crm" }`
→ объединение профилей → `allowed_agents`. Группа без маппинга даёт ничего.

### 4. Выдача токена клиенту

`GET <issuer>/voltd/token` с сессией (cookie или `Authorization: Bearer <session-token>`,
bearer-плагин уже включён) → `{ "token": "<jwt>" }`. Клиент подключается к
`wss://<voltd>:8443/acp` с subprotocol `volt.acp.v1` + `bearer.<jwt>` (точки и
base64url в subprotocol-токене допустимы по RFC 6455) или `?token=<jwt>`.
Токен живёт 15 минут — **перед каждым новым соединением брать свежий**;
живое соединение после `exp` не рвётся (voltd проверяет на upgrade).

### 5. Откуда берутся `groups`

Это ваша часть дизайна. Варианты:

- **SSO/Keycloak**: в Keycloak-клиенте маппер «Group Membership» → claim `groups`
  (без full path), в `sso({...})` Better Auth — `provisionUser`/`mapping`
  записывает их в `user.groups` (additionalField, `string[]`), и при каждом
  SSO-логине обновляет. Тогда админ рулит доступом к агентам из Keycloak.
- **Без IdP** (малый бизнес, email-OTP): `user.groups` ведёт админ Thunderbolt
  в своей админке. Пара «клиент ↔ агенты» без кодов всё равно работает.

Любой другой корпоративный IdP (ADFS/Okta/…) подключается к Better Auth, а
voltd про него не знает — ему виден только issuer Thunderbolt.

## Что настроено на стороне voltd

```toml
[oidc.thunderbolt]
issuer = "https://<thunderbolt-api-host>"
audience = "volt"
client_id = "volt"
validation = "jwks"
claim_path = "groups"
interactive_clients = ["thunderbolt"]
require_at_jwt = true
max_auth_lifetime_secs = 900

[oidc.thunderbolt.profile_map]
volt-admins = "operator"
volt-crm = "crm"
```

Профили (`[permission_profiles.operator|crm|viewer]`) и парные принципалы
(`[[authz.principals]]`) — рядом в том же конфиге; оба пути (код спаривания и
OIDC) живут одновременно.

## Как проверить без бэкенда

В `E:/zeroclaw/_local/deploy-f4-docker/fake-oidc/issuer.mjs` — фейковый issuer
на чистом Node (discovery + JWKS + mint ES256), повторяющий контракт выше
один-в-один. Им гоняется smoke на пилоте `voltd-f4`. Когда бэкенд будет готов,
достаточно переключить `issuer` в конфиге voltd на боевой URL.

## Открытые вопросы

1. **`aud` общий (`volt`) или per-instance (`volt-srv-<id>`)?** v1 — общий: один
   бэкенд Thunderbolt = одна компания, токен одного пользователя действует на
   всех её voltd-инстансах, но в каждом — только с его собственными группами
   (у каждого инстанса свой `profile_map`). Per-instance потребует свой роут
   выдачи (`signJWT` с `overrideOptions.jwt.audience`), сделаем, когда появится
   мультиинстансность у одного заказчика.
2. **Локальный docker-стенд**: бэкенд там на http, а voltd требует https для
   не-loopback issuer. Для e2e на стенде нужен TLS-фронт перед бэкендом (caddy
   с CA пилота, CA добавить в trust контейнера voltd) — либо пока гонять через
   fake-oidc.
3. **Отзыв доступа**: JWKS-режим офлайновый, снятие группы вступает в силу за
   ≤15 минут (новое соединение). Если нужен мгновенный отзыв — introspection-режим
   (`validation = "introspection"`, RFC 7662 endpoint + `client_secret`) —
   отдельная задача на бэкенде.
