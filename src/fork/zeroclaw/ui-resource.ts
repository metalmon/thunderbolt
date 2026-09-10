/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { deliveredLocalFileId } from './outbound-resource-blob'

/** A ZeroClaw `ui://` UI-resource artifact carried inline as text over ACP. */
export type UiResourceRef = { uri: string; mimeType: string; html: string }

/** Shape emitted on `tool-output-available` when ACP content carried a `ui://` resource. */
export type UiResourceOutput = { uiResource: UiResourceRef; text?: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const maxTitleLength = 80

/**
 * Walk ACP `tool_call_update.content` and return the first `ui://` resource that
 * carries inline `text` (never a `blob` — that path is deliver_file). Recognition is
 * content-driven on the `ui://` scheme, never on the tool title (§3).
 */
export const extractUiResource = (content: unknown): UiResourceRef | null => {
  if (!Array.isArray(content)) {
    return null
  }
  for (const item of content) {
    if (!isRecord(item)) {
      continue
    }
    const block = item.type === 'content' && isRecord(item.content) ? item.content : item
    if (!isRecord(block) || block.type !== 'resource' || !isRecord(block.resource)) {
      continue
    }
    const resource = block.resource
    const uri = typeof resource.uri === 'string' ? resource.uri : ''
    const html = typeof resource.text === 'string' ? resource.text : null
    if (!uri.startsWith('ui://') || html === null) {
      continue
    }
    const mimeType = typeof resource.mimeType === 'string' && resource.mimeType ? resource.mimeType : 'text/html'
    return { uri, mimeType, html }
  }
  return null
}

/**
 * Type guard for `tool-output-available` event payloads that carry a UI resource.
 * Rejects if the uiResource shape is invalid (missing uri, mimeType, or html).
 */
export const isUiResourceOutput = (output: unknown): output is UiResourceOutput => {
  if (!isRecord(output) || !isRecord(output.uiResource)) {
    return false
  }
  const r = output.uiResource
  return typeof r.uri === 'string' && typeof r.mimeType === 'string' && typeof r.html === 'string'
}

/**
 * Stable artifact identity, keyed on `(threadId, uri)` — never the uri alone. The uri
 * is session-agnostic (a tool can pin the same `ui://` uri across threads), and the
 * side panel is window-global, so two chat threads emitting the same uri would collide
 * on a single shared id and one thread's panel would silently overwrite the other's.
 * Salting with the owning thread id keeps the two identities distinct. Stateless.
 */
export const uiResourceArtifactId = (threadId: string, uri: string): string =>
  deliveredLocalFileId(`${threadId} ${uri}`)

const prettifyUriSegment = (uri: string): string => {
  const segment = uri.replace(/\/+$/, '').split('/').pop() ?? ''
  const spaced = segment.replace(/[-_]+/g, ' ').trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : 'Artifact'
}

// eslint-disable-next-line no-control-regex
const controlChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

const cleanTitle = (raw: string): string =>
  raw.replace(controlChars, '').replace(/\s+/g, ' ').trim().slice(0, maxTitleLength)

/**
 * Client-derived title (never off the wire, §UX): the HTML `<title>`, else its
 * first `<h1>`, else the `ui://` last segment. Parsed with DOMParser (no script
 * execution) and used only as a text label.
 */
export const deriveArtifactTitle = (html: string, uri: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const fromTitle = cleanTitle(doc.title ?? '')
  if (fromTitle) {
    return fromTitle
  }
  const fromH1 = cleanTitle(doc.querySelector('h1')?.textContent ?? '')
  if (fromH1) {
    return fromH1
  }
  return prettifyUriSegment(uri)
}
