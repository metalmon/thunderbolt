# Thunderbolt — пилотный комплект (offline)

Все файлы в этой папке переносятся на USB-флешку и разворачиваются на машине
заказчика без интернета. ОС машины заранее неизвестна, поэтому у каждого
скрипта есть две версии: `.sh` (Linux/macOS, bash) и `.ps1` (Windows,
PowerShell). Используйте ту, что подходит под ОС.

Состав стека: `web` (фронтенд за nginx), `tls` (опциональный TLS-терминатор),
`backend`, `keycloak` (SSO), `powersync`, `postgres`. Firecrawl и SearXNG в
этот комплект не входят — веб-поиск и скрейпинг страниц в приложении будут
недоступны (см. "Известные ограничения" ниже).

## Что нужно на машине заранее

- Docker Engine + Docker Compose v2 (команда `docker compose`, не старый
  `docker-compose`). Проверить: `docker compose version`.
- Права на запуск docker без интернета — образы грузятся из локальных
  архивов, сеть не нужна.
- На Windows — PowerShell 5.1 или новее (есть в системе по умолчанию).

## 1. Загрузить образы

```sh
# Linux/macOS
scripts/load-images.sh
```
```powershell
# Windows
scripts\load-images.ps1
```

Скрипт проверяет, что все пять архивов на месте (`images/*.tar.gz`), и громко
падает, если что-то отсутствует. После загрузки видно список образов.

## 2. Сгенерировать секреты

Нужно публичное имя или IP-адрес машины — то, по которому десктоп-клиент и
браузер будут обращаться к стеку.

```sh
# Linux/macOS, без TLS (обычный http)
scripts/gen-secrets.sh 192.168.1.50

# с TLS (см. раздел 3)
scripts/gen-secrets.sh backend.volt.oktaplus.ru --tls
```
```powershell
# Windows
scripts\gen-secrets.ps1 -Host 192.168.1.50
scripts\gen-secrets.ps1 -Host backend.volt.oktaplus.ru -Tls
```

Скрипт создает `.env` в корне комплекта (рядом с `docker-compose.yml`) из
`conf/.env.example`, генерирует случайные `BETTER_AUTH_SECRET`,
`POWERSYNC_JWT_SECRET`, пароль Postgres и пароль администратора Keycloak, и
синхронизирует новый `POWERSYNC_JWT_SECRET` с ключом в
`conf/powersync/config.yaml` (их нельзя рассинхронизировать вручную).

Повторный запуск без `-f` / `-Force` не перезапишет существующий `.env`.

После генерации откройте `.env` и впишите хотя бы один ключ ИИ-провайдера
(`ANTHROPIC_API_KEY` / `FIREWORKS_API_KEY` / `MISTRAL_API_KEY` /
`VOLT_INFERENCE_API_KEY`) — без этого backend поднимется, но чат
работать не будет. Каждая переменная в `conf/.env.example` снабжена
комментарием: обязательна она или нет и как ее сгенерировать.

## 3. TLS (если нужен https)

Подробная инструкция — в `README-pilot-tls.md` (скопирована рядом с этим
файлом). Короткая версия:

- Нужно одно имя на весь стек (например `backend.volt.oktaplus.ru`) и один
  сертификат на это имя с `subjectAltName` (без SAN Chromium/WebView2
  отказывает сертификату).
- Публичный CA не подойдет (нужен интернет для выпуска/перевыпуска). Нужен
  свой CA — либо лист от CA, который уже стоит на машинах пилота (вариант 1
  в README-pilot-tls.md), либо свой CA с нуля (вариант 2).
- Если на машинах заказчика нет DNS-записи на это имя — добавить строку в
  `hosts` файл (`/etc/hosts` на Linux, `C:\Windows\System32\drivers\etc\hosts`
  на Windows).
- Корень CA нужно установить в доверенное хранилище Windows
  (`certutil -addstore -f Root ca.crt`) на каждой клиентской машине.
- Файлы `fullchain.pem` (лист + CA) и `privkey.pem` положить в
  `conf/certs/` — формат и грабли описаны в README-pilot-tls.md.
- Запуск стека с TLS: `scripts/up.sh --tls` / `scripts\up.ps1 -Tls`.

Без TLS стек работает по обычному http — для внутреннего пилота в
изолированной сети этого обычно достаточно.

## 4. Запуск

```sh
scripts/up.sh          # http
scripts/up.sh --tls    # https, см. раздел 3
```
```powershell
scripts\up.ps1
scripts\up.ps1 -Tls
```

Скрипт проверяет, что все пять образов загружены, и громко падает, если
какой-то отсутствует. После старта выводит адрес приложения и Keycloak.

## 5. Первый вход

Вход в приложение идет через Keycloak (SSO), не через локальный пароль
backend'а.

В комплект зашит демо-реалм `volt` (`conf/keycloak/realm.json`) с одним
пользователем:

| Логин | Пароль |
|---|---|
| `demo` | `demo` |

Это демо-данные, не секрет — для реального пилота добавьте своих
пользователей через консоль администратора Keycloak:
`<KEYCLOAK_PUBLIC_URL>/admin`, логин `admin`, пароль — значение
`KEYCLOAK_ADMIN_PASSWORD` из вашего `.env` (сгенерирован на шаге 2).

### Почта и код подтверждения (OTP)

В комплекте нет SMTP-сервиса — почта не отправляется никуда. Если backend
все же генерирует код подтверждения или magic-link (например, резервный
локальный вход мимо Keycloak), он не уходит по почте, а только печатается в
лог:

```sh
docker compose logs backend | grep -i -E "otp|magic"
```
```powershell
docker compose logs backend | Select-String -Pattern "otp|magic"
```

## 6. Как подключить десктоп-клиент Volt

В настройках десктоп-клиента есть параметр адреса backend'а (`cloudUrl`).
Укажите туда `PUBLIC_URL` из вашего `.env` плюс `/v1`, например
`https://backend.volt.oktaplus.ru/v1` или `http://192.168.1.50:3000/v1`.

Важно: это значение сохраняется в `localStorage` клиента и **не
перезатирается** при обновлении поверх старой установки. Если клиент раньше
смотрел на другой адрес — либо ставьте на чистую машину, либо почистите
хранилище `thunderbolt-local-settings` перед первым запуском.

## 7. Как менять конфигурацию

Все редактируемые файлы лежат под `conf/` (не внутри образов) — их можно
править прямо на диске:

- `conf/.env.example` — шаблон; реальные значения — в `.env` в корне.
- `conf/keycloak/realm.json` — пользователи, клиент, редиректы Keycloak.
- `conf/powersync/config.yaml` — правила синхронизации PowerSync и ключ JWT.
- `conf/nginx/*.conf.template` — проксирование web/tls.
- `conf/postgres/init-db/*.sql` — выполняется только при первой
  инициализации пустого `./data/postgres`.

После правки конфига достаточно перезапустить нужный сервис, пересоздавать
стек не нужно:

```sh
docker compose restart backend
docker compose restart keycloak
```

Данные Postgres лежат в `./data/postgres` (bind mount, не анонимный volume) —
видны и доступны для бэкапа прямо с диска машины.

## 8. Остановка и логи

```sh
scripts/down.sh                 # остановить стек, данные сохраняются
scripts/logs.sh backend         # логи одного сервиса (по умолчанию backend)
```
```powershell
scripts\down.ps1
scripts\logs.ps1 -Service backend
```

## Известные ограничения

- **Нет автообновления.** Образы и конфиги на флешке — фиксированный
  снимок. Обновление пилота = новый комплект (новые `images/*.tar.gz` +
  новый `docker-compose.yml`), ручной `docker load` + `docker compose up -d`.
- **Нет Firecrawl и SearXNG.** Инструменты веб-поиска и загрузки страниц в
  приложении не будут работать (backend падает в fallback на Exa, если в
  `.env` задан `EXA_API_KEY`; без ключа — просто недоступны).
- **Keycloak в режиме `start-dev`** с встроенной БД H2 — это нормально для
  пилота; для продакшена Keycloak нужно отдельно укреплять (отдельная БД,
  `start` вместо `start-dev`), это за рамками этого комплекта.
- Демо-пользователь `demo`/`demo` — не для продакшен-использования, удалите
  или смените пароль перед реальной эксплуатацией.
