/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Fork: a readable record of the frontend's boot sequence.
//!
//! On Linux there is no way to read the webview's console. Astra ships no browser, its
//! repository is unreachable from inside the perimeter, and the WebKitGTK remote
//! inspector speaks only WebSocket. A client that stopped on its splash with no error
//! cost an evening that one log line would have ended.
//!
//! The line goes to a file rather than stdout on purpose: a customer launches from a
//! desktop icon, where stderr goes nowhere, and "send me boot.log" is an instruction
//! anyone can follow. stderr is the fallback for when the file cannot be opened — not
//! a second sink.
//!
//! Deliberately unconditional: it is a dozen lines per launch, and the whole point is
//! that a plain released binary can be asked for its boot log without first being told
//! how to enable one.

use std::io::Write;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

/// Open file handle, kept across calls so the log is truncated once per launch rather
/// than once per line.
static LOG_FILE: Mutex<Option<std::fs::File>> = Mutex::new(None);

/// Append one boot-sequence line to `<app data>/boot.log`.
#[tauri::command]
pub fn fork_boot_log(app: AppHandle, line: String) {
    // Keep the payload bounded: this is an IPC endpoint the page can reach, and a boot
    // step label is short. Truncation beats letting a page flood the file.
    let text: String = line.chars().take(400).collect();

    let mut guard = match LOG_FILE.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    if guard.is_none() {
        *guard = app.path().app_data_dir().ok().and_then(|dir| {
            std::fs::create_dir_all(&dir).ok()?;
            // Truncate: each launch starts a fresh log, so the file cannot grow without
            // bound and what the user sends is always the run they just saw.
            std::fs::File::create(dir.join("boot.log")).ok()
        });
    }

    match guard.as_mut() {
        Some(file) => {
            let _ = writeln!(file, "[volt-init] {text}");
            let _ = file.flush();
        }
        // No writable app data dir — say it where a terminal would see it, rather than
        // losing the line entirely.
        None => {
            let mut err = std::io::stderr();
            let _ = writeln!(err, "[volt-init] {text}");
            let _ = err.flush();
        }
    }
}
