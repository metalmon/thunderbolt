; Fork (Volt) — intentionally EMPTY.
;
; The Windows display name «Вольт» is now handled by the fully vendored NSIS
; template `src-tauri/installer.nsi` (bundle.windows.nsis.template), which is the
; only reliable way to rename the DESKTOP shortcut too (it is created on the
; finish page, after NSIS_HOOK_POSTINSTALL, so a hook could never reach it).
;
; This file stays referenced by bundle.windows.nsis.installerHooks purely so the
; template's `!include "{{installer_hooks}}"` resolves to a valid file; it defines
; no NSIS_HOOK_* macros, so every `!ifmacrodef` in the template is a no-op.
