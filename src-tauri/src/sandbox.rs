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
//! Security: the main app CSP (`script-src 'self'`) is untouched. The content runs
//! in an opaque origin (via the iframe `sandbox` attribute on desktop / a CSP
//! `sandbox` directive on web) that can't reach the app DOM, and the per-item CSP
//! (e.g. render_html's `default-src 'none'`) blocks network exfiltration.
//!
//! ⚠ Tauri IPC exposure (defense-in-depth — DO NOT loosen the artifact CSP):
//! Because this content is served from a `register_uri_scheme_protocol` origin,
//! Tauri's `is_local_url` classifies the sandbox frame as **Local**, so Tauri
//! injects its full IPC surface (`window.__TAURI_INTERNALS__`, `invoke`, …) into it
//! and would grant it the main window's ACL. Tauri keys IPC on the *webview*, not the
//! sub-frame, so it CANNOT be rejected by frame origin from Rust (verified against
//! 2.11: `Webview::url()` returns the main frame's URL), and the injected internals
//! are non-writable so they can't be neutralised from our harness. The artifact is
//! nonetheless UNABLE to invoke commands because BOTH IPC transports are dead:
//!   1. the fetch transport (`http://ipc.localhost/…`) is blocked by the per-item
//!      CSP `default-src 'none'` (no `connect-src`) — OUR control, load-bearing;
//!   2. the postMessage transport is not delivered to native from an opaque-origin
//!      sub-frame by WebView2/WKWebView — a platform behaviour (verified live: a
//!      `dialog|save` invoke opened no dialog).
//! The safe canvas bridge is a separate channel (`window.parent.postMessage`, frame→
//! app JS), not Tauri IPC. If invariant (1) is ever weakened, or (2) changes upstream,
//! this becomes a real sandbox escape — re-evaluate (options: serve the artifact in a
//! separate webview with no capability). See docs/superpowers/specs/2026-09-21-web-
//! artifact-coep-sandbox-design.md §11.
//!
//! ACCEPTED cosmetic console error (`Cannot read properties of undefined (reading
//! 'plugins')`): the same all-frames injection runs Tauri's built-in `path` plugin
//! init in this sub-frame, where it can execute before Tauri's `__TAURI_INTERNALS__`
//! bootstrap and throw. It is console-only (end users never see it), does not affect
//! rendering, and CANNOT be reliably suppressed: doing so requires running before that
//! injected script, but WebView2 does not preserve script order across sub-frames — a
//! plugin registered FIRST still lost the race (a `js_init_script_on_all_frames` guard
//! stub, "Attempt A", was tried and reverted). The only reliable cure is making the
//! artifact a MAIN frame (a separate child-webview, where the bootstrap runs
//! deterministically), which is disproportionate for a cosmetic error — deferred (see
//! spec §11 / the ledger). DECISION: accept + document. Do not re-attempt frame-level
//! fixes; they hit the same non-deterministic sub-frame ordering.

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
