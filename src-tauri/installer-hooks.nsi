; Fork (Volt) — display-name override for the Windows NSIS installer.
;
; The MACHINE name stays "Volt" (productName): INSTALLDIR\Volt, Volt.exe, and
; the uninstall registry key PATH ...\Uninstall\Volt all remain ASCII. Only the
; HUMAN-VISIBLE label is switched to Cyrillic "Вольт": the "Programs and
; Features" DisplayName and the Start-menu / Desktop shortcuts. The installer
; wizard chrome (welcome/finish header) stays "Volt" — changing it would need a
; full custom template (rejected for its per-upgrade re-sync cost).
;
; Contract mirrored from Tauri's default installer.nsi — RE-VERIFY these three
; points on every Tauri upgrade, they are load-bearing:
;   1. hooks NSIS_HOOK_POSTINSTALL (runs AFTER shortcut creation) and
;      NSIS_HOOK_PREUNINSTALL are inserted by the template.
;   2. !define UNINSTKEY "...\Uninstall\${PRODUCTNAME}", written under SHCTX.
;   3. the Start-menu shortcut is created at $SMPROGRAMS\${PRODUCTNAME}.lnk when
;      no `startMenuFolder` is configured (the `!else` branch of the template's
;      `!if "${STARTMENUFOLDER}"` — OUR case), or at
;      $SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk with one; the desktop
;      shortcut is $DESKTOP\${PRODUCTNAME}.lnk. All -> $INSTDIR\${MAINBINARYNAME}.exe.
;
; ENCODING: this file MUST be saved as UTF-8 WITH BOM — the installer is
; `Unicode true`, and without the BOM makensis mis-decodes the Cyrillic
; literals below into mojibake shortcut/label names.

!include LogicLib.nsh

!macro NSIS_HOOK_POSTINSTALL
  ; "Programs and Features" display label (the key PATH stays ...\Uninstall\Volt)
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "Вольт"

  ; Re-label the shortcuts Tauri just created: same target exe, Cyrillic name.
  ; Start-menu shortcut — DIRECT in $SMPROGRAMS when no startMenuFolder is set
  ; (our case), or in the $AppStartMenuFolder subfolder otherwise. Handle both.
  ${If} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    CreateShortcut "$SMPROGRAMS\Вольт.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${EndIf}
  ${If} ${FileExists} "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\Вольт.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  ${EndIf}
  ; Desktop shortcut — only present here for silent/passive installs; an
  ; interactive install creates it on the finish page (after this hook), so its
  ; label stays "Volt" in that case (a known, minor limitation).
  ${If} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
    CreateShortcut "$DESKTOP\Вольт.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; The uninstaller only removes ${PRODUCTNAME}.lnk; delete our re-labelled ones too.
  Delete "$SMPROGRAMS\Вольт.lnk"
  Delete "$SMPROGRAMS\$AppStartMenuFolder\Вольт.lnk"
  Delete "$DESKTOP\Вольт.lnk"
!macroend
