const fs = require('fs')
let s = fs.readFileSync(process.argv[2], 'utf8')

// (a) Every Start-menu / Desktop shortcut .lnk is a HUMAN-VISIBLE name.
s = s.split('${PRODUCTNAME}.lnk').join('${DISPLAYNAME}.lnk')

// (b) Installer/wizard name (drives $(^Name) in every MUI page title).
if (!s.includes('Name "${PRODUCTNAME}"')) throw new Error('Name directive not found')
s = s.replace('Name "${PRODUCTNAME}"', 'Name "${DISPLAYNAME}"')

// (c) "Programs and Features" label. (Leave the OTHER DisplayName read (~line 199),
//     which scans third-party apps, untouched - it targets $1, not ${PRODUCTNAME}.)
const arpFrom = 'WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"'
const arpTo = 'WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${DISPLAYNAME}"'
if (!s.includes(arpFrom)) throw new Error('ARP DisplayName not found')
s = s.replace(arpFrom, arpTo)

// (d) Define DISPLAYNAME just before its first use (the Name directive). This is
//     the ONLY non-ASCII literal in the whole file.
s = s.replace(
  'Name "${DISPLAYNAME}"',
  '; FORK: human-visible name (the machine name stays ${PRODUCTNAME}=Volt).\n!define DISPLAYNAME "Вольт"\nName "${DISPLAYNAME}"',
)

const header = [
  '; FORK (Volt) - VENDORED copy of Tauri 2.11.2 NSIS installer.nsi',
  '; (crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi @ tag tauri-cli-v2.11.2),',
  '; wired via bundle.windows.nsis.template. ONLY delta vs upstream: a DISPLAYNAME',
  '; override so the human-visible name is Cyrillic everywhere (wizard title,',
  '; Start-menu + Desktop shortcuts, "Programs and Features"), while the MACHINE name',
  '; stays ASCII ${PRODUCTNAME}=Volt (INSTALLDIR, Volt.exe, uninstall registry key path).',
  ';',
  '; RE-SYNC on every Tauri/@tauri-apps/cli upgrade: re-fetch the upstream installer.nsi',
  '; for the pinned CLI version and re-apply four edits - (a) !define DISPLAYNAME before',
  '; the Name directive, (b) Name -> ${DISPLAYNAME}, (c) the UNINSTKEY DisplayName value',
  '; -> ${DISPLAYNAME}, (d) every ${PRODUCTNAME}.lnk -> ${DISPLAYNAME}.lnk (this script).',
  ';',
  '; ENCODING: plain UTF-8, NO BOM. Tauri runs this template through handlebars and',
  '; writes the generated .nsi itself (handling non-ASCII exactly as it does a Cyrillic',
  '; productName); a BOM here corrupts line 1 of the generated file and aborts makensis.',
  '',
  '',
].join('\n')

fs.writeFileSync('src-tauri/installer.nsi', header + s)
console.log('wrote src-tauri/installer.nsi:', (header + s).split('\n').length, 'lines (no BOM)')
