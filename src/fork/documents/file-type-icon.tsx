/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

/**
 * Bundled file-type icons for the document chip: a filled, colour-coded document
 * glyph (folded corner + format label) drawn as inline SVG — no OS icon extraction,
 * works identically on web and desktop. Colours follow the familiar office palette
 * (Word blue, Excel green, PowerPoint orange, PDF red, image teal, archive amber).
 */

type FileKind = 'word' | 'excel' | 'ppt' | 'pdf' | 'image' | 'archive' | 'text' | 'generic'

const KIND_COLOR: Record<FileKind, string> = {
  word: '#2b579a',
  excel: '#217346',
  ppt: '#c43e1c',
  pdf: '#d3352b',
  image: '#0f766e',
  archive: '#b45309',
  text: '#5b6472',
  generic: '#475569',
}

const kindOf = (ext: string, mimeType: string): FileKind => {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.includes('word') || ['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'word'
  if (mimeType.includes('spreadsheet') || ['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'excel'
  if (mimeType.includes('presentation') || ['ppt', 'pptx', 'odp'].includes(ext)) return 'ppt'
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return 'archive'
  if (mimeType.startsWith('text/') || ['txt', 'md', 'markdown', 'json', 'log'].includes(ext)) return 'text'
  return 'generic'
}

/** Short uppercase format label for the glyph (≤4 chars from the extension). */
const labelOf = (ext: string, kind: FileKind): string => {
  if (ext && ext.length >= 1 && ext.length <= 4) return ext.toUpperCase()
  return kind === 'image' ? 'IMG' : 'FILE'
}

type FileTypeIconProps = {
  filename: string
  mimeType: string
  className?: string
}

/**
 * A colour-coded document glyph for `filename`/`mimeType`. Sized via `className`
 * (set width; height follows the intrinsic 24×30 aspect). Decorative — the chip's
 * filename already labels it, so it's `aria-hidden`.
 */
export const FileTypeIcon = ({ filename, mimeType, className }: FileTypeIconProps) => {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const kind = kindOf(ext, mimeType)
  const color = KIND_COLOR[kind]
  const label = labelOf(ext, kind)
  return (
    <svg viewBox="0 0 24 30" className={className} fill="none" role="img" aria-hidden="true">
      <path
        d="M4 1.5h9.5L20 8v18.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-23a2 2 0 0 1 2-2z"
        fill={color}
      />
      <path d="M13.5 1.5V6a2 2 0 0 0 2 2H20z" fill="#ffffff" fillOpacity="0.4" />
      <text
        x="12"
        y="21.5"
        textAnchor="middle"
        fontSize={label.length >= 4 ? 5.5 : 6.5}
        fontWeight="700"
        fill="#ffffff"
        fontFamily="system-ui, sans-serif"
      >
        {label}
      </text>
    </svg>
  )
}
