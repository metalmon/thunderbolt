// Fork brand swap (metalmon / Volt). Upstream hardcodes the brand "Thunderbolt"
// in source strings; the fork ships as "Volt". Rather than edit every source
// `<Trans>` (which re-keys the RU catalog and must be redone on every upstream
// sync), rewrite "Thunderbolt" -> "Volt" in the TRANSLATION VALUES (msgstr) of
// the shipped .po catalogs as a step in `i18n:extract`, after `lingui extract`.
//
// Why msgstr-only: the msgid stays the upstream source string, so Lingui's
// runtime lookup (keyed on the source `<Trans>` text) still hits — only the
// rendered value changes. Nothing in src/ is edited, so there is no re-key, and
// the swap re-applies to any newly-extracted upstream string automatically. It
// is idempotent + deterministic, so `i18n:check` (extract -> swap -> git diff)
// stays green once the swapped catalogs are committed.
//
// Scope: the negotiable locales only (en, ru) — the two the fork ships and the
// picker offers. RU is already "Вольт", so in practice this rebrands the en
// source-echo; the ru pass is a no-op guard for any future upstream leak.
import { readFileSync, writeFileSync } from 'node:fs'

const files = ['src/locales/en/messages.po', 'src/locales/ru/messages.po']
const swap = (line) => line.replaceAll('Thunderbolt', 'Volt')

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  let inMsgstr = false
  const out = lines.map((line) => {
    // A msgid / msgid_plural / msgctxt line, or a block separator, ends the
    // msgstr region — never rewrite a key.
    if (line.startsWith('msgid') || line.startsWith('msgctxt') || line.trim() === '') {
      inMsgstr = false
      return line
    }
    // `msgstr` / `msgstr[0]` opens the value region.
    if (line.startsWith('msgstr')) {
      inMsgstr = true
      return swap(line)
    }
    // A bare "..." continuation line belongs to whichever region is open.
    if (inMsgstr && line.startsWith('"')) {
      return swap(line)
    }
    return line
  })
  writeFileSync(file, out.join('\n'))
}
