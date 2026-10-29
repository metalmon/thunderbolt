// Fork-owned (metalmon / Volt). Adds the CLI's install directory to the user's
// persistent `PATH`, on the user's explicit confirmation — never silently.
//
//! Why this is not `setx`.
//!
//! `setx PATH "%PATH%;<dir>"` is the answer every guide gives, and it is
//! **destructive**: `setx` truncates the value it writes at 1024 characters, so
//! on a machine whose `PATH` is already longer — which is most developer
//! machines — the tail is silently cut off. It also expands `%PATH%` to the
//! MACHINE + USER concatenation and writes the result into the USER value,
//! duplicating every system entry.
//!
//! The registry is the only non-destructive route: read `HKCU\Environment\Path`
//! raw, append one entry, write it back with its original type, and broadcast
//! `WM_SETTINGCHANGE` so newly started processes see it without a sign-out.

use serde::Serialize;

/// Outcome of a `PATH` change, so the UI can say what actually happened rather
/// than claiming success for a no-op.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PathUpdate {
    /// The directory was appended to the user's persistent `PATH`.
    Added { dir: String },
    /// It was already there — nothing was written.
    AlreadyPresent { dir: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathError {
    pub message: String,
}

impl From<std::io::Error> for PathError {
    fn from(error: std::io::Error) -> Self {
        Self { message: error.to_string() }
    }
}

/// Whether `dir` is already one of the `;`-separated entries of `value`.
///
/// Windows paths are case-insensitive and a trailing separator means the same
/// directory, so both are normalized before comparing. An unexpanded entry
/// (`%LOCALAPPDATA%\volt\bin`) is NOT recognised as equal to its expansion —
/// deliberately: re-adding is harmless, while wrongly reporting "already there"
/// would leave the user with a CLI they cannot run.
pub fn path_contains(value: &str, dir: &str) -> bool {
    let normalize = |s: &str| s.trim().trim_end_matches(['\\', '/']).to_lowercase();
    let target = normalize(dir);
    value.split(';').any(|entry| !entry.trim().is_empty() && normalize(entry) == target)
}

/// Appends `dir` to `value`, inserting the separator only when needed.
pub fn append_entry(value: &str, dir: &str) -> String {
    let trimmed = value.trim_end_matches(';');
    if trimmed.is_empty() {
        dir.to_string()
    } else {
        format!("{trimmed};{dir}")
    }
}

#[cfg(target_os = "windows")]
pub fn add_dir_to_user_path(dir: &str) -> Result<PathUpdate, PathError> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_EXPAND_SZ, REG_SZ};
    use winreg::{RegKey, RegValue};

    let environment = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
        .map_err(PathError::from)?;

    // ⚠ Read the RAW value, not the expanded one. A `Path` stored as
    // `REG_EXPAND_SZ` usually contains `%USERPROFILE%`-style references; writing
    // back an expanded copy would freeze them to today's values and break the
    // moment anything they point at moves.
    let (existing, kind) = match environment.get_raw_value("Path") {
        Ok(value) => {
            let text = String::from_utf16_lossy(&to_u16(&value.bytes));
            (text.trim_end_matches('\u{0}').to_string(), value.vtype)
        }
        // No user-level Path at all is normal on a fresh profile.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (String::new(), REG_EXPAND_SZ),
        Err(error) => return Err(PathError::from(error)),
    };

    if path_contains(&existing, dir) {
        return Ok(PathUpdate::AlreadyPresent { dir: dir.to_string() });
    }

    let updated = append_entry(&existing, dir);
    let vtype = if kind == REG_SZ { REG_SZ } else { REG_EXPAND_SZ };
    environment
        .set_raw_value("Path", &RegValue { bytes: to_bytes(&updated), vtype })
        .map_err(PathError::from)?;

    broadcast_environment_change();
    Ok(PathUpdate::Added { dir: dir.to_string() })
}

#[cfg(not(target_os = "windows"))]
pub fn add_dir_to_user_path(_dir: &str) -> Result<PathUpdate, PathError> {
    // POSIX has no machine-readable equivalent: `PATH` is assembled by whichever
    // shell the user runs, from a profile file we must not rewrite behind their
    // back. The install result keeps carrying the one-line hint instead.
    Err(PathError { message: "Editing PATH automatically is Windows-only".to_string() })
}

#[cfg(target_os = "windows")]
fn to_u16(bytes: &[u8]) -> Vec<u16> {
    bytes.chunks_exact(2).map(|pair| u16::from_ne_bytes([pair[0], pair[1]])).collect()
}

#[cfg(target_os = "windows")]
fn to_bytes(text: &str) -> Vec<u8> {
    text.encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(|unit| unit.to_ne_bytes())
        .collect()
}

/// Tells already-running processes that the environment changed. Without it the
/// new `PATH` reaches only processes started after the next sign-in, because
/// Explorer hands its children a cached copy.
#[cfg(target_os = "windows")]
fn broadcast_environment_change() {
    // ⚠ `windows-sys` exposes WPARAM/LPARAM as plain type ALIASES (usize/isize),
    // unlike the higher-level `windows` crate where they are tuple structs.
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    let environment: Vec<u16> = "Environment".encode_utf16().chain(std::iter::once(0)).collect();
    // Best effort by design: the PATH is already written, and a hung listener
    // must not turn a successful install into a reported failure.
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            environment.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            5000,
            std::ptr::null_mut(),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_an_entry_regardless_of_case_and_trailing_separator() {
        let value = r"C:\Windows;C:\Users\x\AppData\Local\Volt\Bin\;C:\Other";
        assert!(path_contains(value, r"C:\Users\x\AppData\Local\volt\bin"));
        assert!(!path_contains(value, r"C:\Users\x\AppData\Local\volt"));
    }

    #[test]
    fn ignores_empty_entries_rather_than_matching_them() {
        assert!(!path_contains(r"C:\Windows;;", ""));
    }

    #[test]
    fn appends_without_doubling_or_leading_separators() {
        assert_eq!(append_entry(r"C:\Windows", r"C:\bin"), r"C:\Windows;C:\bin");
        assert_eq!(append_entry(r"C:\Windows;", r"C:\bin"), r"C:\Windows;C:\bin");
        assert_eq!(append_entry("", r"C:\bin"), r"C:\bin");
    }
}
