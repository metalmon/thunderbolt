/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Sandboxed-content host (desktop half).
//!
//! Serves agent-authored / MCP-app HTML from a dedicated `sandbox:` origin so it
//! does NOT inherit the app window's strict CSP. Local-scheme iframes (`srcdoc`,
//! `data:`, `blob:`) inherit the embedder's CSP in Chromium/WebView2 and their own
//! `<meta>` CSP cannot loosen it, so inline scripts are blocked. A real origin that
//! returns its OWN `Content-Security-Policy` response header escapes that — the
//! frame is then governed only by the per-item CSP we set here.
//!
//! Security: the main app CSP (`script-src 'self'`) is untouched. The content is
//! still framed with `sandbox="allow-scripts"` (never `allow-same-origin`) on the JS
//! side, so it runs in an opaque origin that can't reach the app DOM/IPC/tokens, and
//! the per-item CSP (e.g. render_html's `default-src 'none'; connect-src 'none'`)
//! blocks network exfiltration.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::http::{Request, Response};
use tauri::{Manager, Runtime, State, UriSchemeContext};

/// One stored item: the full HTML document and the CSP to serve it under.
pub struct StoredContent {
    pub html: String,
    pub csp: String,
}

/// Process-wide, id-keyed store of sandboxed content. Populated by the JS host via
/// `store_sandbox_content` and read by the `sandbox:` protocol handler. Entries are
/// small and short-lived (revoked when the frame unmounts).
#[derive(Default)]
pub struct SandboxStore(pub Mutex<HashMap<String, StoredContent>>);

/// JS → Rust: register content under `id`, to be served at `sandbox://localhost/<id>`.
#[tauri::command]
pub fn store_sandbox_content(state: State<'_, SandboxStore>, id: String, html: String, csp: String) {
    if let Ok(mut map) = state.0.lock() {
        map.insert(id, StoredContent { html, csp });
    }
}

/// JS → Rust: drop a previously-registered item (frame unmount / content swap).
#[tauri::command]
pub fn revoke_sandbox_content(state: State<'_, SandboxStore>, id: String) {
    if let Ok(mut map) = state.0.lock() {
        map.remove(&id);
    }
}

/// `sandbox:` URI-scheme handler. The path is the item id (a UUID — URL-safe, so no
/// percent-decoding needed). Serves the stored HTML with its own CSP header, or 404.
pub fn protocol_handler<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let id = request.uri().path().trim_start_matches('/').to_string();
    let store = ctx.app_handle().state::<SandboxStore>();
    let found = store
        .0
        .lock()
        .ok()
        .and_then(|map| map.get(&id).map(|c| (c.html.clone(), c.csp.clone())));

    match found {
        Some((html, csp)) => Response::builder()
            .status(200)
            .header("Content-Type", "text/html; charset=utf-8")
            .header("Content-Security-Policy", csp)
            .header("Cache-Control", "no-store")
            .body(html.into_bytes())
            .unwrap(),
        None => Response::builder()
            .status(404)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(b"sandbox content not found".to_vec())
            .unwrap(),
    }
}
