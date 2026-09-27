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

// (e) Blank the directory page's MUI subtitle. NSIS pairs a bold title with an
//     instruction line, and the Russian pair says the same thing twice
//     ("Выбор папки установки" / "Выберите папку для установки Вольт."). The
//     define wins over MUI_DEFAULT and MUI unsets it after the page, so only
//     this page is affected.
const dirPage = '!insertmacro MUI_PAGE_DIRECTORY'
if (!s.includes(dirPage)) throw new Error('MUI_PAGE_DIRECTORY not found')
s = s.replace(
  dirPage,
  '; FORK: drop the subtitle - it restates the page title in every language.\n!define MUI_PAGE_HEADER_SUBTEXT ""\n' + dirPage,
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
  '; for the pinned CLI version and re-apply five edits - (a) !define DISPLAYNAME before',
  '; the Name directive, (b) Name -> ${DISPLAYNAME}, (c) the UNINSTKEY DisplayName value',
  '; -> ${DISPLAYNAME}, (d) every ${PRODUCTNAME}.lnk -> ${DISPLAYNAME}.lnk, (e) an empty',
  '; MUI_PAGE_HEADER_SUBTEXT on the directory page (this script).',
  ';',
  '; ENCODING: plain UTF-8, NO BOM. Tauri runs this template through handlebars and',
  '; writes the generated .nsi itself (handling non-ASCII exactly as it does a Cyrillic',
  '; productName); a BOM here corrupts line 1 of the generated file and aborts makensis.',
  '',
  '',
].join('\n')

fs.writeFileSync('src-tauri/installer.nsi', header + s)
console.log('wrote src-tauri/installer.nsi:', (header + s).split('\n').length, 'lines (no BOM)')
