/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Fork: a stdout sink for the frontend's boot sequence.
//!
//! On Linux there is no way to read the webview's console. Astra ships no browser,
//! its repository is unreachable from inside the perimeter, and the WebKitGTK remote
//! inspector speaks only WebSocket. So when the client stopped on its splash screen
//! with no error, the `[init]` log the app already writes was simply unreadable, and
//! an evening went into inferring what one line would have said.
//!
//! This routes those lines out through Tauri's IPC — which demonstrably works on that
//! platform even when the webview is otherwise wedged — instead of through anything
//! WebKitGTK-specific or version-gated.
//!
//! Deliberately unconditional: it is a dozen lines per launch, and the whole point is
//! that a plain released binary on a customer machine can be asked for its boot log.

use std::io::Write;

/// Write one boot-sequence line to stderr.
///
/// stderr rather than stdout: it is unbuffered, so the last line before a hang is
/// not lost in a buffer that never flushes — which is exactly the case this exists
/// to diagnose. Errors are swallowed; a logging call must never fail a boot.
#[tauri::command]
pub fn fork_boot_log(line: String) {
    // Keep the payload bounded: this is an IPC endpoint the page can call, and a
    // boot step label is short. Truncation beats letting a page flood the log.
    let text: String = line.chars().take(400).collect();
    let mut err = std::io::stderr();
    let _ = writeln!(err, "[volt-init] {text}");
    let _ = err.flush();
}
