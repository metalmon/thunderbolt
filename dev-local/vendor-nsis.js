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

// (e) Drop the wizard subtitles that only restate their own page title. NSIS
//     pairs a bold title with an instruction line, and several of those pairs
//     say the same thing twice ("Установка завершена" over "Установка успешно
//     завершена."). Only the ones that ADD something - "Подождите, идёт
//     копирование файлов..." - are left alone.
//
//     Two mechanisms, both documented MUI2 settings: MUI_PAGE_HEADER_SUBTEXT
//     for a normal page (given alone, MUI keeps the localized title), and
//     MUI_INSTFILESPAGE_{FINISH,ABORT}HEADER_SUBTEXT for the progress page's
//     end states.
//
//     Scoping is NOT uniform, and getting it wrong fails the build: MUI unsets
//     MUI_PAGE_HEADER_SUBTEXT and ...FINISHHEADER_SUBTEXT after each page (so
//     the uninstaller's pages need their own defines), but it does NOT unset
//     ...ABORTHEADER_SUBTEXT - defining that one twice is a duplicate !define.
//     One define, before the first instfiles page, covers both.
const blankSubtitle = (anchor, defines) => {
  if (!s.includes(anchor)) throw new Error(`${anchor} not found`)
  const block = defines.map((d) => `!define ${d} ""`).join('\n')
  s = s.replace(anchor, `; FORK: no subtitle - it restated the page title.\n${block}\n${anchor}`)
}

blankSubtitle('!insertmacro MUI_PAGE_DIRECTORY', ['MUI_PAGE_HEADER_SUBTEXT'])
blankSubtitle('!insertmacro MUI_PAGE_INSTFILES', [
  'MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT',
  'MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT',
])
blankSubtitle('!insertmacro MUI_UNPAGE_CONFIRM', ['MUI_PAGE_HEADER_SUBTEXT'])
blankSubtitle('!insertmacro MUI_UNPAGE_INSTFILES', ['MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT'])

// (f) Brand the strip along the bottom of every page. Tauri wires it to the
//     bundle's `copyright`, which we do not set - and NSIS reads an empty
//     BrandingText as "use my own", printing "Nullsoft Install System v3.11".
const branding = 'BrandingText "${COPYRIGHT}"'
if (!s.includes(branding)) throw new Error('BrandingText not found')
s = s.replace(
  branding,
  [
    '; FORK: an empty BrandingText makes NSIS advertise itself instead.',
    '!if "${COPYRIGHT}" == ""',
    '  BrandingText "${DISPLAYNAME}"',
    '!else',
    `  ${branding}`,
    '!endif',
  ].join('\n'),
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
  '; for the pinned CLI version and re-apply six edits - (a) !define DISPLAYNAME before',
  '; the Name directive, (b) Name -> ${DISPLAYNAME}, (c) the UNINSTKEY DisplayName value',
  '; -> ${DISPLAYNAME}, (d) every ${PRODUCTNAME}.lnk -> ${DISPLAYNAME}.lnk, (e) empty',
  '; subtitles on the pages whose subtitle only restates the title, (f) a BrandingText',
  '; fallback so an unset copyright does not advertise NSIS (this script).',
  ';',
  '; ENCODING: plain UTF-8, NO BOM. Tauri runs this template through handlebars and',
  '; writes the generated .nsi itself (handling non-ASCII exactly as it does a Cyrillic',
  '; productName); a BOM here corrupts line 1 of the generated file and aborts makensis.',
  '',
  '',
].join('\n')

fs.writeFileSync('src-tauri/installer.nsi', header + s)
console.log('wrote src-tauri/installer.nsi:', (header + s).split('\n').length, 'lines (no BOM)')
