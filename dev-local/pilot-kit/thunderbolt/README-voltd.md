# Агенты voltd появляются сами (вход через Keycloak)

В основном README комплекта это записано в «сознательно НЕ в комплекте»:

> Вход агентов через Keycloak (OIDC → voltd) готов со стороны voltd …
> включается, когда бэкенд Thunderbolt отдает JWT по контракту.

Бэкенд это умеет. Ниже — что включить, чтобы агенты стенда появлялись у
авторизованного пользователя сами, без спаривания по коду.

## Что это даёт

Бэкенд спрашивает у voltd список агентов по ACP (`initialize` →
`_meta.zeroclaw.agents`) и публикует каждого как обычного агента `managed-acp`.
Клиент при этом не настраивается вообще: агенты просто появляются в списке —
ровно те, которые разрешены группам вошедшего пользователя. Сессия идёт через
бэкенд (`/v1/voltd/ws`), а не напрямую с машины пользователя, и бэкенд на каждую
сессию выпускает свой короткоживущий токен (ES256, `typ: at+jwt`, RFC 9068) с
группами пользователя из Keycloak.

Спаривание по коду остаётся — это два независимых пути, можно жить и на нём.

## Порядок включения

```bash
scripts/gen-secrets.sh <имя-хоста> --tls --voltd    # Linux
scripts\gen-secrets.ps1 -PublicHost <имя-хоста> -Tls -Voltd   # Windows
scripts/gen-voltd-keys.sh            # ключевая пара ES256 → conf/voltd-keys/
cp ../certs/out/ca.crt.pem conf/certs/   # Bun должен доверять листу voltd
scripts/up.sh --tls
```

`gen-secrets … --voltd` дописывает в `.env`:

| Переменная | Значение | Зачем |
|---|---|---|
| `COMPOSE_FILE` | `docker-compose.yml:docker-compose.voltd.yml` | подмешивает наложение |
| `COMPOSE_PATH_SEPARATOR` | `:` | без этого на Windows `:` читается как часть имени файла |
| `VOLTD_URL` | `wss://<имя>:8443/acp` | публичная точка voltd |
| `VOLTD_ISSUER` | `https://<имя>/v1` | наш `iss`; voltd берёт отсюда discovery и JWKS |
| `VOLTD_GROUPS_CLAIM` | `groups` | где в токене Keycloak лежат группы |
| `THUNDERBOLT_BACKEND_EXTRA_CA` | `/etc/volt/certs/ca.crt.pem` | Bun не знает про приватный CA |

`--voltd` требует `--tls` и без него откажется работать: `iss` по `http://` на
не-loopback адресе бэкенд отвергает сам, и фича молча не включилась бы.

Пустой `VOLTD_URL` = фича выключена целиком (агенты не публикуются, маршрут
ретрансляции не поднимается). Наложение можно оставить подмешанным навсегда.

## Что должно совпасть на стороне voltd

Раскомментировать `[oidc.volt]` в `volt/conf/config.toml` и выставить:

| Поле | Значение |
|---|---|
| `issuer` | `https://<имя-хоста>/v1` — **ровно** то же, что `VOLTD_ISSUER`, вместе с `/v1` |
| `audience`, `client_id` | `volt` |
| `claim_path` | `groups` — то же, что `VOLTD_GROUPS_CLAIM` |
| `interactive_clients` | `["thunderbolt"]` |
| `tls_ca_cert_path` | `/voltd-data/certs/ca.crt.pem` — тот же приватный CA |
| `[oidc.volt.profile_map]` | `volt-admins = "operator"`, `volt-avk = "avk"`, `volt-kb = "kb"` |

Группы `volt-admins` / `volt-avk` / `volt-kb` уже заведены в
`conf/keycloak/realm.json`, и клиент реалма отдаёт их в claim `groups`
(mapper «Group Membership», `full.path: false`). Пользователей в комплекте нет
вообще: их создаёт администратор в консоли Keycloak и там же распределяет по
группам. Секрет клиента реалма тоже не зашит — его выпускает `gen-secrets`
одновременно в `.env` и в `realm.json`.

Примечание к `certs/README.md`: там написано, что для OIDC-issuer по https с
приватным CA настройки у voltd «пока нет». Она есть — `[oidc.volt].tls_ca_cert_path`,
читается и добавляется в доверенные корни того самого клиента, который тянет
discovery и JWKS. Это больше не причина отказываться от входа через Keycloak.

## Проверка

```bash
docker compose logs backend | grep -i voltd
curl -k https://<имя>/v1/.well-known/openid-configuration
curl -k https://<имя>/v1/voltd/jwks
```

- в JWKS должен быть один ключ `EC/P-256/ES256` с `kid` (отпечаток JWK по RFC 7638);
- в списке агентов у вошедшего пользователя — агенты стенда;
- агент, не разрешённый группам пользователя, не должен появляться вообще
  (не «появляться серым»).

Если агентов нет, смотреть в этом порядке: `VOLTD_URL` пуст → фича выключена;
ошибка TLS → не скопирован `ca.crt.pem`; `voltd rejected initialize` → не совпал
`issuer` или voltd не перезапущен после правки `config.toml`.

## Ограничения

- Отзыв группы у пользователя действует со следующей его сессии — время жизни
  уже выданной сессии.
- Ретранслируемая ACP-сессия не посылает ping; простой дольше таймаута прокси
  закрывает её (в комплекте `conf/nginx/web-nginx.conf.template` поднимает его до
  3600 с для `/v1/voltd/ws`; измерено: с таймаутом по умолчанию сессия закрывается
  на 60-й секунде простоя с кодом 1006).
