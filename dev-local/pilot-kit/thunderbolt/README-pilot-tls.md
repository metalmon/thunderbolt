# TLS для развёртывания в закрытом контуре (пилот)

Как поднять стек на собственном имени с собственным CA, без туннеля и без
интернета. Опирается на сервис `tls` в `powersync-service/docker-compose.yml`
(профиль `tls`) и шаблон `dev-local/docker/tls-nginx.conf.template`.

До этого TLS в нашем стеке не было вообще: и `web-nginx.conf.template`, и
upstream'ный `deploy/config/nginx.conf.template` слушают чистый HTTP, бэкенд
(`backend/src/index.ts`) поднимается через `app.listen` без опции `tls`.
Терминирование всегда делал туннель снаружи.

## Имя

Одно имя на все развёртывания, заказчик уводит его своим DNS куда нужно:

```
backend.volt.oktaplus.ru
```

Публичной A-записи у него нет — в закрытом контуре внешний DNS всё равно
недоступен, а отсутствие записи означает, что неверно настроенный клиент
отказывает громко, а не уходит молча в чужую сеть.

У заказчика: своя зона ровно на этот FQDN с A-записью на апексе (`@`).
Если DNS-администратора нет на месте — запись в `hosts` на машинах пилота.
TLS от этого не страдает: сертификат выписан на имя, не на адрес.

Keycloak живёт на **том же имени**, порт 8444 (8443 занят публичным /acp voltd) — поэтому нужен ровно один
сертификат и ровно одна DNS-запись. Делить 443 с приложением он не может:
Keycloak занимает пути в корне (`/realms`, `/resources`), а перенос на
относительный путь ломает issuer уже импортированного realm'а.

## Сертификат

Публичный CA не подходит: выпуск и перевыпуск требуют интернета, которого в
контуре нет. Нужен свой CA — как это уже сделано у шлюза «Вольт».

### Вариант 1 (предпочтительный) — лист от CA «Вольт»

У пилота сертификат шлюза подписан их самоподписанным CA, и его корень **уже
установлен в `LocalMachine\Root`** на машинах пилота
(см. `zeroclaw-integration/2026-09-30-rbac-e2e-findings.md:74-80`). Лист с этого
же CA не требует никакой дополнительной работы с хранилищами.

Приватный CA не ограничен владением доменом — он спокойно подпишет имя в
`oktaplus.ru`.

Запрос отдаём им как CSR, чтобы их ключ CA не покидал их сторону:

```sh
openssl req -new -newkey rsa:2048 -nodes \
  -keyout privkey.pem -out backend.csr \
  -subj "/CN=backend.volt.oktaplus.ru"
```

Файл расширений (его применяет подписывающая сторона — расширения из CSR
`openssl x509 -req` сам не переносит):

```ini
# ext.cnf
[v3_req]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:backend.volt.oktaplus.ru
```

Подпись на их стороне:

```sh
openssl x509 -req -in backend.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -sha256 -days 825 -extfile ext.cnf -extensions v3_req -out backend.crt
```

### Вариант 2 — свой CA

```sh
# CA — один раз, ключ хранить отдельно от пилотной машины
openssl req -x509 -newkey rsa:4096 -nodes -sha256 -days 3650 \
  -keyout volt-ca.key -out volt-ca.crt \
  -subj "/CN=Volt Internal CA" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

# лист
openssl req -new -newkey rsa:2048 -nodes \
  -keyout privkey.pem -out backend.csr \
  -subj "/CN=backend.volt.oktaplus.ru"
openssl x509 -req -in backend.csr -CA volt-ca.crt -CAkey volt-ca.key \
  -CAcreateserial -sha256 -days 825 \
  -extfile ext.cnf -extensions v3_req -out backend.crt
```

Корень на машины клиентов (от администратора):

```powershell
certutil -addstore -f Root volt-ca.crt
```

### Что nginx ждёт на диске

`fullchain.pem` — **лист первым**, затем CA:

```sh
cat backend.crt ca.crt > fullchain.pem   # privkey.pem уже лежит рядом
```

### Грабли, на которых это ломается молча

- **SAN обязателен.** Chromium (а значит WebView2) игнорирует CN с версии 58 —
  сертификат без `subjectAltName` даёт `ERR_CERT_COMMON_NAME_INVALID`, хотя
  `openssl verify` его принимает.
- **`extendedKeyUsage = serverAuth` обязателен**, иначе цепочка не строится как
  серверная.
- Лимит срока действия в 398 дней Chromium применяет только к публично
  доверенным цепочкам; для локально установленного корня он не действует,
  поэтому 825 дней здесь допустимы.

## Запуск

```sh
cd powersync-service
# .env
PUBLIC_URL=https://backend.volt.oktaplus.ru
KEYCLOAK_PUBLIC_URL=https://backend.volt.oktaplus.ru:8444
VOLT_TLS_SERVER_NAME=backend.volt.oktaplus.ru
VOLT_TLS_CERT_DIR=./certs        # fullchain.pem + privkey.pem

docker compose --profile tls up -d
```

`PUBLIC_URL` тянет за собой всё остальное — `APP_URL`, `BETTER_AUTH_URL`,
`TRUSTED_ORIGINS`, `CORS_ORIGINS` и `POWERSYNC_URL` уже выражены через него.
`CORS_ORIGINS` помимо него содержит origin'ы Tauri, поэтому десктоп проходит.

Сервис `web` остаётся без изменений и по-прежнему слушает только HTTP внутри
сети compose — наружу его порт публиковать не нужно.

Проверка после подъёма:

```sh
curl -v https://backend.volt.oktaplus.ru/v1/health
curl -v https://backend.volt.oktaplus.ru:8444/realms/volt/.well-known/openid-configuration
```

## Клиент

Десктоп собирается с `VITE_THUNDERBOLT_CLOUD_URL=https://backend.volt.oktaplus.ru/v1`.
Значение персистится в `localStorage` (`local-settings-store.ts`), поэтому
**установка поверх старой не подхватит новый адрес** — на пилоте ставить на
чистую машину либо чистить `thunderbolt-local-settings`.

### Куда какой трафик идёт, и где нужен приватный CA

Важно знать до выезда, потому что доверие к CA устанавливается в трёх разных
местах, и по одному из путей клиент хранилище Windows не читает.

| что | через что идёт | где должен быть CA |
|---|---|---|
| наш бэкенд `/v1` | `globalThis.fetch` (вебвью) | хранилище Windows |
| ACP / шлюз «Вольт» `wss://` | WebSocket вебвью | хранилище Windows |
| PowerSync, статика SPA | вебвью | хранилище Windows |
| модель на loopback по `http` | нативный fetch (Rust) | CA не участвует |
| модель / MCP в их сети по `https` | **универсальный прокси бэкенда** | **контейнер бэкенда** |

Последняя строка — та, которую легко пропустить. Диспетчеризация в
`src/ai/fetch.ts`: Custom-провайдер на **loopback** (`localhost`, `127.x`,
`[::1]`, `*.localhost`) идёт напрямую через нативный fetch, а всё остальное —
LAN-адреса, `.local`, публичные эндпоинты — уходит на `getProxyFetch()`, то есть
на `${cloudUrl}/proxy`. Значит TLS-соединение до такого сервиса устанавливает
**Bun внутри контейнера бэкенда**, а его набор корней про внутренний CA не знает.

Лечится конфигурацией, без пересборки: положить CA в каталог сертификатов и
указать на него:

```sh
# .env
VOLT_BACKEND_EXTRA_CA=/etc/volt/certs/ca.crt
```

Каталог `VOLT_TLS_CERT_DIR` смонтирован в бэкенд как `/etc/volt/certs:ro`.
Проверено на `oven/bun:alpine`: без `NODE_EXTRA_CA_CERTS` запрос падает с
«unable to verify the first certificate», с ним возвращает 200.

### Приватный CA и «Use Native Fetch»

Вызовы бэкенда идут через `globalThis.fetch` (`src/lib/http.ts:128` —
`options.fetch ?? config.fetch ?? globalThis.fetch`), то есть через WebView2,
который берёт корни из хранилища Windows. Приватный CA там доверяется, всё в
порядке. ACP-сокет — тоже вебвью.

Но путь нативного fetch доверия к хранилищу Windows **не имеет**:
`tauri-plugin-http 2.5.9` → `reqwest 0.12.28` → `webpki-roots`, то есть вшитый
набор корней Mozilla (проверено по `src-tauri/Cargo.lock`). Через него идут
`src/ai/fetch.ts`, `src/settings/models/model-catalog.ts` и `proxy-fetch.ts`,
причём `isNativeFetchEnabled` по умолчанию `true`.

Следствие: если внутренний HTTPS-эндпоинт (MCP, провайдер модели) подписан
приватным CA, запрос через нативный fetch упадёт на проверке сертификата, хотя
корень установлен. Обход на пилоте — выключить «Use Native Fetch» в настройках
разработчика. Нормальное исправление — пересобрать `tauri-plugin-http` на
TLS-бэкенде, читающем хранилище ОС (`native-tls`/schannel либо
native-roots-вариант rustls); это правка `src-tauri/Cargo.toml` и отдельная
задача, не для вечера перед выездом.
