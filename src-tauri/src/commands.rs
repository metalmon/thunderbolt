/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use anyhow::Result;
use tauri::command;

#[command]
pub async fn toggle_dock_icon(app_handle: tauri::AppHandle, show: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;

        let policy = if show {
            ActivationPolicy::Regular
        } else {
            ActivationPolicy::Accessory
        };

        let _ = app_handle.set_activation_policy(policy);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app_handle;
        let _ = show;
    }

    Ok(())
}

// === Fork: save a delivered/attached file to a user-chosen path ==============================

/// Extensions "Download and open" may hand to the OS default application.
///
/// An allowlist rather than a denylist: the webview decides WHICH stored file is
/// saved, so the set of things that can be launched has to be closed. Everything
/// else is revealed in the file manager instead — the user still gets the file,
/// nothing is executed on their behalf.
///
/// Deliberately absent, though they are documents by any ordinary reading:
/// - `doc`, `xls`, `ppt` — the legacy formats carry macros, and the file came
///   from a chat attachment or an agent;
/// - `svg` — opens in a browser and can carry script, so "view a picture" would
///   mean running someone's markup.
const OPENABLE_EXTENSIONS: &[&str] = &[
    "pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "rtf", "txt", "md", "csv", "json", "png", "jpg", "jpeg", "gif",
    "webp",
];

/// Mark a saved file as coming from the internet zone, the way a browser marks a
/// download (Windows only — the stream is an NTFS feature).
///
/// This is what makes Office open it in Protected View and SmartScreen weigh in:
/// the bytes arrived over the network through a chat or an agent, so they deserve
/// the same treatment as anything else downloaded. Best effort by design — FAT
/// and exFAT volumes (a USB stick) carry no alternate streams, and failing to
/// mark a file is not a reason to fail the save the user asked for.
fn mark_as_downloaded(path: &std::path::Path) {
    #[cfg(windows)]
    {
        let stream = format!("{}:Zone.Identifier", path.display());
        let _ = std::fs::write(stream, "[ZoneTransfer]\r\nZoneId=3\r\n");
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
}

/// Save bytes to a location the user picks, then open or reveal the result.
///
/// The destination comes from a dialog shown HERE, in Rust, and the bytes are
/// written only to what that dialog returned. The webview never names a path:
/// it used to, and because this writes with `std::fs` (outside the `fs` plugin's
/// scopes) and then launched the result, any script running in the app origin
/// could write an executable anywhere and start it. The dialog on the JS side
/// was a formality — from here it was just a string from the client.
///
/// Opening is restricted to `OPENABLE_EXTENSIONS`; anything else is revealed in
/// the file manager. `suggested_name` only seeds the dialog's filename field,
/// so a crafted name cannot escape the directory the user chose.
///
/// See src/fork/documents/file-actions.ts for the caller.
///
/// @returns `true` when a file was written, `false` when the user cancelled.
#[command]
pub async fn save_document_as(
    app_handle: tauri::AppHandle,
    contents: Vec<u8>,
    suggested_name: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;

    // `file_name` takes the leaf only: a name carrying separators would otherwise
    // steer the dialog out of the directory the user is looking at.
    let leaf = std::path::Path::new(&suggested_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document")
        .to_string();

    let Some(chosen) = app_handle.dialog().file().set_file_name(&leaf).blocking_save_file() else {
        return Ok(false); // cancelled
    };
    let path = chosen
        .into_path()
        .map_err(|e| format!("the save dialog returned a path this platform cannot use: {e}"))?;

    std::fs::write(&path, &contents).map_err(|e| e.to_string())?;
    mark_as_downloaded(&path);

    let openable = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| OPENABLE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false);

    if openable {
        tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())?;
    } else {
        tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

// === Interface Style (iOS keyboard/system UI theme) ==========================================

/// Set the native user interface style on iOS to control keyboard and system UI appearance.
/// Android keyboards follow the system dark mode setting and cannot be overridden per-app.
/// Desktop: no-op.
/// style: "system" | "light" | "dark"
#[command]
pub fn set_interface_style(style: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        use objc2_foundation::MainThreadMarker;
        use objc2_ui_kit::{UIApplication, UIUserInterfaceStyle, UIWindowScene};

        let ui_style = match style.as_str() {
            "light" => UIUserInterfaceStyle::Light,
            "dark" => UIUserInterfaceStyle::Dark,
            _ => UIUserInterfaceStyle::Unspecified,
        };

        let mtm = MainThreadMarker::new()
            .ok_or_else(|| "set_interface_style must run on the main thread".to_string())?;

        let app = UIApplication::sharedApplication(mtm);
        for scene in app.connectedScenes() {
            if let Some(window_scene) = scene.downcast_ref::<UIWindowScene>() {
                for window in window_scene.windows() {
                    window.setOverrideUserInterfaceStyle(ui_style);
                }
            }
        }
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = style;
    }

    Ok(())
}

// === OAuth loopback server ===================================================================

/// Ports pre-registered as redirect URIs in the Google / Microsoft OAuth console.
const OAUTH_PORTS: &[u16] = &[17421, 17422, 17423];

/// Starts the in-house OAuth loopback server and returns the port it bound to.
///
/// The Rust server accepts one HTTP connection, sends an "Authentication Complete"
/// response, emits an `"oauth-callback"` event to the frontend, then shuts down.
/// No external HTTP framework or Tauri plugin is required.
#[command]
pub async fn start_oauth_server(app: tauri::AppHandle) -> Result<u16, String> {
    crate::oauth_server::start(app, OAUTH_PORTS)
}

// === Thunderbolt CLI install =================================================================

/// Download, verify and install the standalone `thunderbolt` CLI into
/// `~/.local/bin`, deriving the release URL from this app's version. Desktop
/// macOS/Linux only — other platforms return `Unsupported` (see [`crate::cli_installer`]).
#[command]
pub async fn install_thunderbolt_cli(
    app: tauri::AppHandle,
) -> Result<crate::cli_installer::CliInstallResult, crate::cli_installer::CliInstallError> {
    let version = app.package_info().version.to_string();
    crate::cli_installer::install_cli(&version).await
}

/// Fork: what the `PATH` change would touch, so the confirmation can name it.
#[command]
pub async fn cli_path_target() -> String {
    crate::cli_path::path_target_description()
}

/// Fork: append the CLI's install directory to the user's persistent `PATH`.
///
/// ⚠ Called ONLY after the user confirms in the UI. It writes to
/// `HKCU\Environment`, which outlives the app, so it is never part of the
/// install itself — the install reports whether the directory is on `PATH` and
/// the user decides.
#[command]
pub async fn add_cli_dir_to_path(
) -> Result<crate::cli_path::PathUpdate, crate::cli_path::PathError> {
    let dir = crate::cli_installer::cli_install_dir()?;
    crate::cli_path::add_dir_to_user_path(&dir)
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    #[test]
    fn http_capability_is_scoped_to_main_webview_and_http_schemes() {
        let capability: Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert_eq!(capability["webviews"], json!(["main"]));
        assert!(capability.get("windows").is_none());
        let http = capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|permission| permission["identifier"] == "http:default")
            .unwrap();
        assert_eq!(
            http["allow"],
            json!([{ "url": "http://*:*/*" }, { "url": "https://*:*/*" }])
        );
    }
}
