#Requires -Version 5.1
<#
.SYNOPSIS
Полный сброс сквозного шифрования на стенде — для ВСЕХ учётных записей.

.DESCRIPTION
Ключ учётной записи лежит на сервере только в «конвертах», зашифрованным под
ключи получателей: каждого доверенного устройства и фразы восстановления.
Сервер открыть их не может — у него только шифротекст. Если у человека не
осталось ни одного доверенного устройства и нет сохранённой фразы, его данные
не восстановит никто, и войти в синхронизацию он больше не сможет: приложение
будет вечно просить подтвердить устройство.

Скрипт снимает ключевое состояние и содержимое всех учёток, после чего
следующее устройство проходит первичную настройку заново и получает новую
фразу. Учётные записи Keycloak НЕ трогаются — люди входят теми же логинами.

⚠⚠ Это удаление данных, а не починка. Переписки, задачи, подсказки, навыки,
проекты и значения настроек стираются у всех. Они всё равно нечитаемы —
зашифрованы ключом, которого больше нет, — но уходят безвозвратно.

Перед удалением кладётся копия затрагиваемых таблиц в data/.

.EXAMPLE
pwsh scripts/reset-encryption.ps1
pwsh scripts/reset-encryption.ps1 -Yes
#>
[CmdletBinding()]
param([switch]$Yes)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Именно проект этого комплекта: переименованная папка может оставить рядом
# чужой контейнер, и сброс не в той базе был бы необратим и незаметен.
$project = (Select-String -Path .env -Pattern '^COMPOSE_PROJECT_NAME=' -ErrorAction SilentlyContinue |
    Select-Object -First 1).Line -replace '^COMPOSE_PROJECT_NAME=', ''
if (-not $project) { $project = 'volt' }
$container = "$project-postgres-1"

docker inspect $container *> $null
if ($LASTEXITCODE -ne 0) { Write-Error "Не нахожу контейнер базы «$container». Стенд поднят?"; exit 1 }

# Таблицы с шифрованными столбцами (shared/e2ee-types.ts, encryptedColumnsMap).
$content = @('chat_messages', 'chat_threads', 'tasks', 'prompts', 'settings',
    'models', 'model_profiles', 'triggers', 'skills', 'projects')

$users = (docker exec -i $container psql -U postgres -d postgres -tAc 'select count(*) from "user";').Trim()
Write-Host "Стенд: проект «$project», база в «$container»."
Write-Host "Учётных записей затрагивается: $users (все)."
Write-Host ""

if (-not $Yes) {
    Write-Host "⚠ Будут стёрты переписки, задачи, подсказки, навыки, проекты и настройки" -ForegroundColor Yellow
    Write-Host "  ВСЕХ пользователей, вместе с ключами шифрования и списком устройств." -ForegroundColor Yellow
    $answer = Read-Host "Введите СБРОС заглавными, чтобы продолжить"
    if ($answer -ne 'СБРОС') { Write-Host "Отменено."; exit 1 }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dump = "data/e2ee-reset-$stamp.sql"
New-Item -ItemType Directory -Force data | Out-Null
Write-Host "Копия затрагиваемых таблиц -> $dump"
$dumpArgs = @('-t', 'envelopes', '-t', 'wrapped_keys', '-t', 'encryption_metadata',
    '-t', 'org_envelopes', '-t', 'session', '-t', 'powersync.devices')
foreach ($t in $content) { $dumpArgs += @('-t', "powersync.$t") }
docker exec -i $container pg_dump -U postgres -d postgres --data-only @dumpArgs |
    Set-Content -Path $dump -Encoding utf8
if ($LASTEXITCODE -ne 0) { Write-Error "Не удалось снять копию — сброс не выполнен."; exit 1 }
Write-Host ("  {0:N0} байт" -f (Get-Item $dump).Length)
Write-Host ""

# Одной транзакцией: либо сброшено всё, либо ничего. Полусброшенный стенд —
# ключи есть, устройств нет — не поднимется вовсе.
$sql = @('begin;', 'delete from envelopes;', 'delete from wrapped_keys;',
    'delete from encryption_metadata;', 'delete from org_envelopes;',
    'delete from challenge_nonces;')
foreach ($t in $content) { $sql += "delete from powersync.$t;" }
# Устройства после содержимого: на них ссылаются конверты (уже удалены выше).
$sql += 'delete from powersync.devices;'
# Сеансы последними: пока они живы, клиент ходит с прежней привязкой.
$sql += @('delete from session;', 'commit;')

$sql -join "`n" | docker exec -i $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
if ($LASTEXITCODE -ne 0) { Write-Error "Сброс не выполнен — изменения откачены."; exit 1 }

Write-Host "Готово." -ForegroundColor Green
Write-Host ""
Write-Host "Дальше:"
Write-Host "  1. docker compose restart backend web   (с тем же набором файлов описания)"
Write-Host "  2. Каждому человеку: очистить данные сайта в браузере для адреса стенда,"
Write-Host "     либо просто войти заново — приложение само заметит, что устройства нет,"
Write-Host "     и начнёт с чистого листа."
Write-Host "  3. При первой настройке ФРАЗУ ВОССТАНОВЛЕНИЯ НАДО СОХРАНИТЬ." -ForegroundColor Yellow
Write-Host "     Второй двери на этом стенде нет: ключи доступа работают только в"
Write-Host "     потребительском режиме входа, а здесь вход через Keycloak."
