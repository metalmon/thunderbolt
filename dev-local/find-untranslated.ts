#!/usr/bin/env bun
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Fork i18n audit: finds user-facing English string literals that are NOT routed
 * through the translation layer (`t()`), so after an upstream sync we see exactly
 * what still needs Russian. Volt ships Russian-only; upstream leaves many strings
 * hardcoded in English.
 *
 * Flags (raw literals only — `t(...)` calls are excluded):
 *   - JSX text children:             <span>Save changes</span>
 *   - user-facing attributes:        placeholder / title / alt / label /
 *                                    loadingLabel / aria-label / aria-* text
 *   - string literals inside JSX {}: {cond ? 'Hide' : 'Show'}, {'Loading…'}
 *
 * For every hit it looks the value up in locales/en/*.json and, if a key already
 * has that exact text, suggests reusing it (a prior sweep created many keys but
 * left components unwrapped) — otherwise marks it as a new key to add.
 *
 * Uses @babel/parser rather than the `typescript` package: the project pins the
 * native TS port (v6), which has no classic AST API.
 *
 * Usage: bun dev-local/find-untranslated.ts [path ...]   # default: src
 * Exits 1 when anything is found (usable as a CI gate).
 */
import { parse } from '@babel/parser'
import traverseImport from '@babel/traverse'
import { readFileSync, readdirSync, statSync } from 'node:fs'

// @babel/traverse is CJS; unwrap the interop default.
const traverse = (
  typeof traverseImport === 'function' ? traverseImport : (traverseImport as { default: unknown }).default
) as (typeof import('@babel/traverse'))['default']

const USER_FACING_ATTRS = new Set([
  'placeholder',
  'title',
  'alt',
  'label',
  'loadingLabel',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
])

// Callees whose string arguments are never user-facing prose.
const NON_UI_CALLEES = new Set(['t', 'cn', 'clsx', 'classnames', 'cva', 'tv', 'twmerge', 'twjoin', 'format'])

// Binary operators where a string operand is a discriminant, not displayed text.
const COMPARISON_OPS = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'instanceof', 'in'])

// A string literal used as `x === 'foo'`, `case 'foo':`, or `['a','b'].includes(s)`
// is program logic (state/type/variant), never rendered — skip it.
const isDiscriminant = (path: NodePath): boolean => {
  const parent = path.parent
  if (!parent) {
    return false
  }
  if (parent.type === 'BinaryExpression' && COMPARISON_OPS.has(parent.operator)) {
    return true
  }
  if (parent.type === 'SwitchCase' && parent.test === path.node) {
    return true
  }
  return false
}

const hasEnglishWord = (value: string): boolean => /[A-Za-z]{2,}/.test(value)
const looksLikeKey = (value: string): boolean => /^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$/.test(value.trim())
const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim()

// --- locale index: normalized en value -> "namespace:key.path" ---------------
const buildLocaleIndex = (): Map<string, string> => {
  const index = new Map<string, string>()
  try {
    statSync('locales/en')
  } catch {
    return index
  }
  const walk = (obj: unknown, path: string, ns: string) => {
    if (typeof obj === 'string') {
      const key = normalize(obj)
      if (key && !index.has(key)) {
        index.set(key, `${ns}:${path}`)
      }
    } else if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        walk(v, path ? `${path}.${k}` : k, ns)
      }
    }
  }
  for (const file of readdirSync('locales/en')) {
    if (file.endsWith('.json')) {
      walk(JSON.parse(readFileSync(`locales/en/${file}`, 'utf8')), '', file.replace(/\.json$/, ''))
    }
  }
  return index
}
const localeIndex = buildLocaleIndex()
const existingKeyFor = (text: string): string | undefined => localeIndex.get(normalize(text))

type Finding = { file: string; line: number; col: number; kind: string; text: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- babel NodePath
type NodePath = any

const calleeName = (node: NodePath['node']): string => {
  const callee = node.callee
  if (callee?.type === 'Identifier') {
    return callee.name.toLowerCase()
  }
  if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier') {
    return callee.property.name.toLowerCase()
  }
  return ''
}

// Classify a StringLiteral by walking its ancestors: is it a t()/cn() argument
// (skip), a user-facing attribute value (flag), or a JSX child expression (flag)?
const classifyString = (path: NodePath): { skip: boolean; kind?: string } => {
  let p: NodePath | null = path.parentPath
  let sawJsxExpression = false
  while (p) {
    const t = p.node.type
    if (t === 'CallExpression' && NON_UI_CALLEES.has(calleeName(p.node))) {
      return { skip: true }
    }
    if (t === 'JSXExpressionContainer') {
      sawJsxExpression = true
    }
    if (t === 'JSXAttribute') {
      const name = p.node.name?.name ?? ''
      return USER_FACING_ATTRS.has(name) ? { skip: false, kind: `attr:${name}` } : { skip: true }
    }
    if (t === 'JSXElement' || t === 'JSXFragment') {
      return sawJsxExpression ? { skip: false, kind: 'jsx-expr' } : { skip: true }
    }
    p = p.parentPath
  }
  return { skip: true }
}

const scanFile = (file: string): Finding[] => {
  const source = readFileSync(file, 'utf8')
  let ast
  try {
    ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  } catch {
    return []
  }
  const findings: Finding[] = []
  traverse(ast, {
    JSXText(path) {
      const text = normalize(path.node.value)
      if (text && hasEnglishWord(text) && !looksLikeKey(text)) {
        const loc = path.node.loc!.start
        findings.push({ file, line: loc.line, col: loc.column + 1, kind: 'jsx-text', text })
      }
    },
    StringLiteral(path) {
      const text = path.node.value
      if (!hasEnglishWord(text) || looksLikeKey(text) || isDiscriminant(path)) {
        return
      }
      const { skip, kind } = classifyString(path)
      if (!skip && kind) {
        const loc = path.node.loc!.start
        findings.push({ file, line: loc.line, col: loc.column + 1, kind, text })
      }
    },
  })
  return findings
}

const collectFiles = (root: string): string[] => {
  let isFile = false
  try {
    isFile = statSync(root).isFile()
  } catch {
    return []
  }
  if (isFile) {
    return root.endsWith('.tsx') ? [root] : []
  }
  return [...new Bun.Glob('**/*.tsx').scanSync(root)]
    .map((rel) => `${root.replace(/\/$/, '')}/${rel}`)
    .filter((f) => !f.endsWith('.test.tsx') && !f.endsWith('.stories.tsx'))
}

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['src']
const files = roots.flatMap(collectFiles)
const all = files.flatMap(scanFile)
all.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))

let currentFile = ''
let reuse = 0
for (const f of all) {
  if (f.file !== currentFile) {
    currentFile = f.file
    console.log(`\n${f.file}`)
  }
  const key = existingKeyFor(f.text)
  if (key) {
    reuse++
  }
  console.log(`  ${f.line}:${f.col}  [${f.kind}]  ${JSON.stringify(f.text)}${key ? `  → reuse ${key}` : '  → NEW key'}`)
}

console.log(
  `\n${all.length} untranslated string(s) across ${new Set(all.map((f) => f.file)).size} file(s) ` +
    `(${reuse} already have a key to reuse, ${all.length - reuse} need a new key); ${files.length} scanned.`,
)

process.exit(all.length > 0 ? 1 : 0)
