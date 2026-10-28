# `client_id` в токене Volt стал `volt` — поправить `interactive_clients`

2026-10-05. Касается только пилотного блока `[oidc.volt]`, который у вас пока
закомментирован, поэтому ничего работающего это не ломает.

## Что изменилось у нас

Бэкенд Volt минтит токен для voltd с claim `client_id = "volt"` (было
`"thunderbolt"` — имя апстрима, от которого мы избавляемся везде, где оно уходит
за пределы нашего кода).

## Что нужно у вас

В `volt/conf/config.toml`, блок `[oidc.volt]`:

```diff
- interactive_clients = ["thunderbolt"]
+ interactive_clients = ["volt"]
```

Это обязательно и именно одновременно: по вашей же документации в
`zeroclaw-config/src/schema.rs` токен, чей клиент не объявлен ни в
`service_clients`, ни в `interactive_clients`, **отклоняется**. То есть со старым
значением шлюз откажет каждому запросу клиента Volt, а с новым — заработает, как
только мы отгрузим образ бэкенда с этой сборкой (master `f784aac82` и новее).

Остальные поля блока не меняются: `audience = "volt"`, `client_id = "volt"`,
`claim_path = "groups"`, `profile_map` с `volt-admins`/`volt-avk`/`volt-kb`.

## Попутно: старый бренд в шаблоне

В том же файле комментарий над блоком четыре раза называет нас Thunderbolt:

> `# ── OIDC: login through Thunderbolt (Keycloak behind it). Uncomment when the`
> `#    Thunderbolt backend serves the JWT contract ...`
> `#    ... The issuer is the Thunderbolt PUBLIC_URL + /v1 ...`
> `#    ... that signed the Thunderbolt certificate ...`

Продукт называется **Volt** («Вольт» в русских документах); Thunderbolt — это
апстрим, на котором он основан, и в поставляемых заказчику файлах его быть не
должно. Текст у вас в репозитории, не в комплекте, поэтому правка за вами.

Папку `thunderbolt/` в комплекте вы уже переименовали в `backend/` — наша половина
синхронизирована под новым именем, и имя проекта docker compose теперь закреплено
(`COMPOSE_PROJECT_NAME=volt` в `.env`), чтобы переименование каталога больше не
создавало второй пустой стек рядом с работающим.

---

# Дополнение: роли по одному агенту, и OIDC в комплекте включён

Решение заказчика: **одна роль на одного агента**, админу — все. Прежняя группировка
(`avk` = avk + avk_editor + ocr, `kb` = kb_search + kb_editor) была догадкой о том, кому
что нужно, и снята.

В комплекте (`volt/conf/config.toml`) я это уже применил; **в вашем репозитории нужно
то же**:

```toml
[permission_profiles.operator]   admin = true   allowed_agents = ["*"]
[permission_profiles.avk]        allowed_agents = ["avk"]
[permission_profiles.avk_editor] allowed_agents = ["avk_editor"]
[permission_profiles.ocr]        allowed_agents = ["ocr"]
[permission_profiles.kb_search]  allowed_agents = ["kb_search"]
[permission_profiles.kb_editor]  allowed_agents = ["kb_editor"]

[oidc.volt.profile_map]
volt-admins = "operator"
volt-avk = "avk"
volt-avk-editor = "avk_editor"
volt-ocr = "ocr"
volt-kb-search = "kb_search"
volt-kb-editor = "kb_editor"
```

Принципалы сопряжения по коду — тоже по одному на агента:
`admin` (operator), `avk`, `avk-editor`, `ocr`, `kb-search`, `kb-editor`. То есть
`deploy paircode kb-search` выдаёт код ровно на один агент. `volt/README.md` в комплекте
я поправил под эти id.

Это работает ровно потому, что ваш резолвер **складывает** профили по всем значениям
claim (`filter_map(profile_map.get)` → `merge_profiles`), а не берёт первое совпадение:
кому нужно несколько агентов, тот состоит в нескольких группах.

**Блок `[oidc.volt]` в комплекте расскомментирован и заполнен** под пилотный стенд:
`issuer = "https://backend.volt.oktaplus.ru/v1"` (байт в байт с нашим `VOLTD_ISSUER`),
`audience`/`client_id` = `volt`, `validation = "jwks"`, `claim_path = "groups"`,
`require_at_jwt = true`, `max_auth_lifetime_secs = 900`,
`tls_ca_cert_path = "/voltd-data/certs/ca.crt.pem"`. На нашей стороне проверено живьём:
discovery и JWKS отдают 200 по https через пилотный CA, и Keycloak выдаёт каждой из шести
учётных записей ровно её группу в claim `groups` вместе с `email`.

---

# Открыто: агент не отвечает на `initialize` (05.10, вечер)

Связка «Вольт» → ретрансляция → шлюз доведена и проверена по частям. Не работает
последнее звено, и оно на вашей стороне.

**Что проверено и работает:**

- клиент получает список агентов по ролям (`operator` — все шесть, `avk` — только свой);
- WebSocket до `/v1/voltd/ws?agent=…` проходит оба прокси (код 101), таймауты 3600 с;
- ретрансляция принимает сокет, авторизует по bearer, минтит токен и **держит соединение
  открытым** — я проверял, 10 с без единого кадра, обрыва нет;
- бэкенд открывает `wss://…:8443/acp` к шлюзу: рукопожатие проходит (`OPEN`);
- voltd достаёт наш discovery по https через пилотный CA: `200`;
- voltd достаёт сервер моделей: `GET /v1/models` → `200`.

**Что не работает:** я отправил через ретрансляцию кадр

```json
{"jsonrpc":"2.0","id":1,"method":"initialize",
 "params":{"protocolVersion":1,"clientCapabilities":{...}}}
```

с действительным bearer — **ответа нет 25 секунд, соединение при этом не закрывается**.
В журнале voltd об этих соединениях нет ни строки; `RUST_LOG=debug` на него не влияет.
Реальный клиент в итоге получает обрыв без кода.

**Вопросы к вам:**

1. Как поднять подробность журнала voltd — ACP-соединения в stdout не видны вовсе.
2. Ожидает ли шлюз на `/acp` чего-то до `initialize` (другой подпротокол,版 протокола,
   авторизационный кадр)? Наш подпротокол — `zeroclaw.acp.v1`, токен в `bearer.<...>`.
3. Что в вашей терминологии означает принятый, но молчащий сокет — не ждёт ли он
   завершения какой-то инициализации агента (рабочее пространство, память, модель)?

Провайдер модели на стенде сейчас: `http://10.250.0.22:1234/v1`, `qwen/qwen3.5-9b`.
⚠ Исходный шаблон указывал `127.0.0.1:8080`, а этот порт на хосте занимает PowerSync из
нашего комплекта — на объекте это столкновение повторится, если модель поднимут локально.
