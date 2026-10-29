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

/// The shell startup file that owns `PATH` for `shell`, relative to `$HOME`.
///
/// POSIX has no machine-readable `PATH`: the shell assembles it from its own
/// startup file, so the right file depends on which shell the user runs. The
/// fallback is `.profile`, which every Bourne-compatible login shell reads.
pub fn profile_for_shell(shell: &str) -> &'static str {
    match shell.rsplit('/').next().unwrap_or(shell) {
        "zsh" => ".zshrc",
        "bash" => ".bashrc",
        "fish" => ".config/fish/config.fish",
        _ => ".profile",
    }
}

/// The line that puts `dir` on `PATH`, in `shell`'s own syntax.
///
/// fish is not Bourne-compatible — `export PATH=...` is a syntax error there —
/// and `fish_add_path` is idempotent by itself, which is exactly what a file
/// that may be sourced twice needs.
pub fn export_line(shell: &str, dir: &str) -> String {
    if shell.rsplit('/').next().unwrap_or(shell) == "fish" {
        format!("fish_add_path {dir}")
    } else {
        format!("export PATH=\"{dir}:$PATH\"")
    }
}

/// Marks our block so a second install recognises its own work instead of
/// appending a duplicate. Matched as a substring, so the user may reformat the
/// block freely as long as this comment survives.
pub const PROFILE_MARKER: &str = "# Added by the desktop app: CLI on PATH";

#[cfg(not(target_os = "windows"))]
pub fn add_dir_to_user_path(dir: &str) -> Result<PathUpdate, PathError> {
    use std::io::Write;

    let home = std::env::var("HOME")
        .map_err(|_| PathError { message: "HOME environment variable is not set".to_string() })?;
    let shell = std::env::var("SHELL").unwrap_or_default();
    let profile = std::path::Path::new(&home).join(profile_for_shell(&shell));

    // Already on the live PATH — nothing to add, whatever the profile says.
    if std::env::var("PATH").is_ok_and(|value| path_contains_posix(&value, dir)) {
        return Ok(PathUpdate::AlreadyPresent { dir: dir.to_string() });
    }

    let existing = std::fs::read_to_string(&profile).unwrap_or_default();
    if existing.contains(PROFILE_MARKER) {
        return Ok(PathUpdate::AlreadyPresent { dir: dir.to_string() });
    }

    if let Some(parent) = profile.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Appended, never rewritten: this is a file the user maintains by hand, and
    // a leading newline keeps our block off the end of whatever line is there.
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&profile)?;
    writeln!(file, "\n{PROFILE_MARKER}\n{}", export_line(&shell, dir))?;

    Ok(PathUpdate::Added { dir: dir.to_string() })
}

/// Whether `dir` is one of the `:`-separated entries of a POSIX `PATH`.
/// Case-SENSITIVE, unlike the Windows form — POSIX filesystems are.
#[cfg(not(target_os = "windows"))]
fn path_contains_posix(value: &str, dir: &str) -> bool {
    let normalize = |s: &str| s.trim_end_matches('/').to_string();
    let target = normalize(dir);
    value.split(':').any(|entry| !entry.is_empty() && normalize(entry) == target)
}

/// What the confirmation dialog must name before anything is written.
///
/// The user is agreeing to a change OUTSIDE the app that outlives it, so saying
/// "we'll edit your PATH" is not enough — it has to say where.
pub fn path_target_description() -> String {
    #[cfg(target_os = "windows")]
    {
        "your user PATH (Windows environment variables)".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_default();
        format!("~/{}", profile_for_shell(&shell))
    }
}

#[cfg(target_os = "windows")]
fn to_u16(bytes: &[u8]) -> Vec<u16> {
    // `as_chunks` rather than `chunks_exact(2)`: clippy rejects a constant
    // chunk size, and the trailing remainder cannot exist for a UTF-16 buffer.
    let (pairs, _) = bytes.as_chunks::<2>();
    pairs.iter().map(|pair| u16::from_ne_bytes(*pair)).collect()
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
    fn picks_the_startup_file_each_shell_actually_reads() {
        assert_eq!(profile_for_shell("/bin/zsh"), ".zshrc");
        assert_eq!(profile_for_shell("/usr/bin/fish"), ".config/fish/config.fish");
        assert_eq!(profile_for_shell("/bin/bash"), ".bashrc");
        // Unknown or unset: .profile is read by every Bourne-compatible login shell.
        assert_eq!(profile_for_shell(""), ".profile");
        assert_eq!(profile_for_shell("/usr/bin/nu"), ".profile");
    }

    #[test]
    fn writes_fish_syntax_for_fish_and_bourne_syntax_elsewhere() {
        // `export PATH=...` is a syntax error in fish, so this is not cosmetic.
        assert_eq!(export_line("/usr/bin/fish", "/home/x/.local/bin"), "fish_add_path /home/x/.local/bin");
        assert_eq!(
            export_line("/bin/bash", "/home/x/.local/bin"),
            "export PATH=\"/home/x/.local/bin:$PATH\""
        );
    }

    #[test]
    fn appends_without_doubling_or_leading_separators() {
        assert_eq!(append_entry(r"C:\Windows", r"C:\bin"), r"C:\Windows;C:\bin");
        assert_eq!(append_entry(r"C:\Windows;", r"C:\bin"), r"C:\Windows;C:\bin");
        assert_eq!(append_entry("", r"C:\bin"), r"C:\bin");
    }
}
