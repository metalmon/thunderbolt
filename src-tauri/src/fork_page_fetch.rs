/* Copyright (c) Okta Plus LLC. All rights reserved.
 * Fork-owned file (see AGENTS.md / CLAUDE.md: additive fork surface). */

//! Fork: разрешение имени для полосы чтения страниц без Pro.
//!
//! Спека: `docs/development/autonomous-web-fetch.md`, раздел 4.1.
//!
//! Здесь НЕТ политики, и это осознанно. Что считать частным адресом, знает
//! `shared/ip-classification.ts`, и обе стороны — бэкенд и клиент — читают эту
//! правду оттуда. Если бы решение принималось здесь, в дереве появилась бы вторая
//! копия правила, расходящаяся с первой при каждой правке. Поэтому команда отдаёт
//! перечень адресов, а отказывает вызывающий на стороне TypeScript, где эту
//! проверку можно и покрыть обычным `bun test`.
//!
//! Зачем это вообще в Rust: в отрисовщике имя разрешить нечем, а проверка
//! литерала от раздвоенного DNS не защищает — публично выглядящее имя может
//! разрешаться в частный адрес, и в нашем контуре это не теория.

use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::str::FromStr;

use serde::Serialize;

/// Порт при разрешении не значит ничего: соединение не устанавливается, но
/// `to_socket_addrs` без порта не работает.
const RESOLVE_PORT: u16 = 443;

/// JS → Rust: разрешить имя в перечень адресов. Без политики и без соединения.
///
/// Имя приходит из вебвью, поэтому проверяется на входе: пустое, с разделителями
/// или с пробелами — отказ. Соединения здесь нет, так что цена ошибки невелика,
/// но граница доверия есть граница доверия.
#[tauri::command]
pub async fn fork_resolve_host(host: String) -> Result<Vec<String>, String> {
    if host.is_empty() || host.len() > 253 {
        return Err(format!("Недопустимая длина имени: {}", host.len()));
    }
    if host.contains(['/', '\\', ':', '@', '?', '#', ' ', '\t']) {
        return Err("Имя содержит разделители".to_string());
    }

    // Разрешение имени блокирует поток; на исполнителе асинхронной среды это
    // задержало бы всё остальное, что в ней ждёт.
    tauri::async_runtime::spawn_blocking(move || {
        (host.as_str(), RESOLVE_PORT)
            .to_socket_addrs()
            .map(|addresses| addresses.map(|address| address.ip().to_string()).collect())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Предел на тело ответа: страницу на сотню мегабайт отрисовщик не переживёт.
const MAX_BODY_BYTES: usize = 2_000_000;

const REQUEST_TIMEOUT_SECS: u64 = 15;

/// Ответ, пригодный для цикла переходов на стороне TypeScript.
#[derive(Serialize)]
pub struct PinnedResponse {
    pub status: u16,
    pub location: Option<String>,
    pub content_type: Option<String>,
    pub body: String,
    /// true, когда тело обрезано по `MAX_BODY_BYTES`.
    pub truncated: bool,
}

/// JS → Rust: запрос, подключённый ТОЛЬКО к названному адресу.
///
/// ⚠ Это и есть закрытие подмены DNS. Имя разрешается РОВНО ОДИН раз — на стороне
/// TypeScript, который там же и проверяет полученный адрес, — а сюда приходит уже
/// проверенный адрес. Второго разрешения нет, значит нет и окна, в которое ответ
/// DNS мог бы подмениться между проверкой и подключением.
///
/// `resolve` подставляет адрес в обход разрешения имён, сохраняя имя для `Host` и
/// для SNI с проверкой сертификата: из вебвью так сделать нельзя — `Host` там
/// запрещённый заголовок, а SNI задать нечем. Поэтому запрос и переехал сюда.
///
/// Перенаправления НЕ отслеживаются (`Policy::none()`): их проходит вызывающий,
/// заново разрешая, проверяя и привязывая каждый шаг. Решение о том, куда можно
/// идти, остаётся в одном месте.
#[tauri::command]
pub async fn fork_fetch_pinned(url: String, address: String) -> Result<PinnedResponse, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err(format!("Схема {} не читается", parsed.scheme()));
    }
    let host = parsed.host_str().ok_or("В адресе нет узла")?.to_string();
    let port = parsed
        .port_or_known_default()
        .ok_or("Для схемы неизвестен порт")?;
    let ip = IpAddr::from_str(&address).map_err(|error| error.to_string())?;

    let client = reqwest::Client::builder()
        .resolve(&host, SocketAddr::new(ip, port))
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status().as_u16();
    let header = |name: reqwest::header::HeaderName| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    let location = header(reqwest::header::LOCATION);
    let content_type = header(reqwest::header::CONTENT_TYPE);

    // Поток, а не `bytes()`: предел должен держаться и против сервера, который
    // соврал в `content-length` или не прислал его вовсе.
    let mut body = Vec::new();
    let mut truncated = false;
    let mut stream = response;
    while let Some(chunk) = stream.chunk().await.map_err(|error| error.to_string())? {
        if body.len() + chunk.len() > MAX_BODY_BYTES {
            body.extend_from_slice(&chunk[..MAX_BODY_BYTES.saturating_sub(body.len())]);
            truncated = true;
            break;
        }
        body.extend_from_slice(&chunk);
    }

    Ok(PinnedResponse {
        status,
        location,
        content_type,
        body: String::from_utf8_lossy(&body).into_owned(),
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_host() {
        let result = tauri::async_runtime::block_on(fork_resolve_host(String::new()));
        assert!(result.is_err());
    }

    #[test]
    fn rejects_host_with_separators() {
        for host in [
            "example.com:22",
            "example.com/path",
            "a b.com",
            "user@example.com",
        ] {
            let result = tauri::async_runtime::block_on(fork_resolve_host(host.to_string()));
            assert!(result.is_err(), "{host} should be rejected");
        }
    }

    /// Литералы разрешаются в себя же. Вызывающий их сюда не присылает (проверяет
    /// сам), но поведение фиксируем: отказа быть не должно.
    #[test]
    fn resolves_a_literal_to_itself() {
        let result = tauri::async_runtime::block_on(fork_resolve_host("93.184.216.34".to_string()));
        assert_eq!(result.unwrap(), vec!["93.184.216.34".to_string()]);
    }

    #[test]
    fn pinned_fetch_rejects_a_foreign_scheme() {
        let result = tauri::async_runtime::block_on(fork_fetch_pinned(
            "file:///C:/Windows/win.ini".to_string(),
            "93.184.216.34".to_string(),
        ));
        assert!(result.is_err());
    }

    /// Адрес приходит проверенным, но мусором быть не должен: разбор обязан
    /// отказать, а не подставить что-нибудь по умолчанию.
    #[test]
    fn pinned_fetch_rejects_an_unparsable_address() {
        let result = tauri::async_runtime::block_on(fork_fetch_pinned(
            "https://example.com/".to_string(),
            "not-an-address".to_string(),
        ));
        assert!(result.is_err());
    }
}
