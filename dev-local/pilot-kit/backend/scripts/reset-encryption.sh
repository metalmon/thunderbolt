#!/usr/bin/env bash
# Полный сброс сквозного шифрования на стенде — для ВСЕХ учётных записей.
#
# Когда это нужно. Ключ учётной записи лежит на сервере только в «конвертах»,
# зашифрованным под ключи получателей: каждого доверенного устройства и фразы
# восстановления. Сервер открыть их не может — у него только шифротекст. Если
# у человека не осталось ни одного доверенного устройства и нет сохранённой
# фразы, его данные не восстановит никто, и войти в синхронизацию он больше не
# сможет: приложение будет вечно просить подтвердить устройство.
#
# Что делает скрипт. Снимает ключевое состояние и содержимое всех учёток, после
# чего следующее устройство проходит первичную настройку заново и получает новую
# фразу. Учётные записи Keycloak НЕ трогаются — люди входят теми же логинами.
#
# ⚠⚠ Это удаление данных, а не починка. Переписки, задачи, подсказки, навыки,
# проекты и значения настроек стираются у всех. Они всё равно нечитаемы —
# зашифрованы ключом, которого больше нет, — но уходят безвозвратно.
#
# Перед удалением скрипт кладёт копию затрагиваемых таблиц в data/ — если
# окажется, что ключ всё-таки нашёлся, восстановить есть откуда.
#
# Usage: scripts/reset-encryption.sh [--yes]
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Именно проект этого комплекта: переименованная папка может оставить рядом
# чужой контейнер, и сброс не в той базе был бы необратим и незаметен.
compose_project="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env 2>/dev/null | head -1)"
compose_project="${compose_project:-volt}"
container="${compose_project}-postgres-1"

if ! docker inspect "$container" >/dev/null 2>&1; then
  echo "Не нахожу контейнер базы «$container». Стенд поднят?" >&2
  exit 1
fi

psql() { docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

# Таблицы с шифрованными столбцами (shared/e2ee-types.ts, encryptedColumnsMap)
# плюс серверные таблицы ключей. Порядок удаления снизу вверх по ссылкам.
content_tables=(chat_messages chat_threads tasks prompts settings models model_profiles triggers skills projects)

echo "Стенд: проект «$compose_project», база в «$container»."
users=$(psql -tAc 'select count(*) from "user";')
echo "Учётных записей затрагивается: $users (все)."
echo

if [ "${1:-}" != "--yes" ]; then
  echo "⚠ Будут стёрты переписки, задачи, подсказки, навыки, проекты и настройки"
  echo "  ВСЕХ пользователей, вместе с ключами шифрования и списком устройств."
  printf 'Введите СБРОС заглавными, чтобы продолжить: '
  read -r answer
  [ "$answer" = "СБРОС" ] || { echo "Отменено."; exit 1; }
fi

stamp="$(date +%Y%m%d-%H%M%S)"
dump="data/e2ee-reset-$stamp.sql"
mkdir -p data
echo "Копия затрагиваемых таблиц -> $dump"
dump_args=(-t envelopes -t wrapped_keys -t encryption_metadata -t org_envelopes -t session -t powersync.devices)
for t in "${content_tables[@]}"; do dump_args+=(-t "powersync.$t"); done
docker exec -i "$container" pg_dump -U postgres -d postgres --data-only "${dump_args[@]}" > "$dump"
echo "  $(wc -c < "$dump") байт"
echo

# Одной транзакцией: либо сброшено всё, либо ничего. Полусброшенный стенд —
# ключи есть, устройств нет — не поднимется вовсе.
{
  echo 'begin;'
  echo 'delete from envelopes;'
  echo 'delete from wrapped_keys;'
  echo 'delete from encryption_metadata;'
  echo 'delete from org_envelopes;'
  echo 'delete from challenge_nonces;'
  for t in "${content_tables[@]}"; do echo "delete from powersync.$t;"; done
  # Устройства после содержимого: на них ссылаются конверты (уже удалены выше).
  echo 'delete from powersync.devices;'
  # Сеансы последними: пока они живы, клиент продолжает ходить с прежней привязкой.
  echo 'delete from session;'
  echo 'commit;'
} | psql -q

echo "Готово."
echo
echo "Дальше:"
echo "  1. docker compose restart backend web   (с тем же набором файлов описания)"
echo "  2. Каждому человеку: очистить данные сайта в браузере для адреса стенда,"
echo "     либо просто войти заново — приложение само заметит, что устройства нет,"
echo "     и начнёт с чистого листа."
echo "  3. При первой настройке ФРАЗУ ВОССТАНОВЛЕНИЯ НАДО СОХРАНИТЬ."
echo "     Второй двери на этом стенде нет: ключи доступа работают только в"
echo "     потребительском режиме входа, а здесь вход через Keycloak."
