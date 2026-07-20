/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { putAttachment, type StoredFile } from '@/lib/file-blob-storage'

/** Cap aligned with ZeroClaw deliver_file / embedded resource intake (10 MiB). */
export const maxOutboundBlobBytes = 10 * 1024 * 1024

export type AcpResourceBlob = {
  uri: string
  mimeType: string
  blob: string
}

export type DeliveredFileRef = {
  localFileId: string
  filename: string
  mimeType: string
  size: number
  uri: string
  /** Prose caption from `tool_call_update.title` (falls back to the basename). Citation /
   *  document-result widget label, never the disk filename. Optional: absent on files
   *  delivered before the title field existed — readers fall back to {@link deliveredCaption}. */
  title?: string
}

/** Shape emitted on `tool-output-available` when ACP content carried resource+blob. */
export type DeliveredFilesOutput = {
  text: string
  deliveredFiles: DeliveredFileRef[]
}

export type OutboundBlobDeps = {
  putAttachment: typeof putAttachment
  now: () => number
}

const defaultDeps: OutboundBlobDeps = {
  putAttachment,
  now: () => Date.now(),
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Basename from a file:// or opaque uri; falls back to upload.bin. */
export const filenameFromUri = (uri: string): string => {
  const trimmed = uri.trim()
  if (!trimmed) {
    return 'upload.bin'
  }
  try {
    if (trimmed.startsWith('file:')) {
      const path = decodeURIComponent(new URL(trimmed).pathname)
      const base = path.split('/').pop()
      if (base) {
        return base
      }
    }
  } catch {
    // fall through
  }
  const slash = trimmed.replace(/\\/g, '/').split('/').pop()
  return slash && slash.length > 0 ? slash : 'upload.bin'
}

/**
 * Deterministic, colon/slash-free IndexedDB key for a delivered file, derived purely
 * from its deliver uri. This is the heart of the design: a widget or citation holds
 * only the uri and computes the same `localFileId` the writer stored the blob under —
 * so resolution needs no in-memory map and survives turn boundaries, app restarts, and
 * conversation loads. FNV-1a over the uri, rendered as `zc-<8 hex>` (no `:` / `/`, so it
 * is a safe first segment of a `fileId:fileName` sideview id).
 */
export const deliveredLocalFileId = (uri: string): string => {
  const s = uri.trim()
  let hash = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `zc-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * Display caption for a delivered file: the ZeroClaw `tool_call_update.title`
 * (prose, as-is) when present and meaningful, else the uri basename. The old
 * daemon sent the literal tool name "deliver_file" as the title — treat that as
 * absent. Used for citations + the document-result widget label, never the disk
 * filename (which is always the basename).
 */
export const deliveredCaption = (title: string | null | undefined, basename: string): string => {
  const trimmed = title?.trim()
  return trimmed && trimmed !== 'deliver_file' ? trimmed : basename
}

const decodeBase64 = (b64: string): Uint8Array | null => {
  try {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

/**
 * Walk ACP `tool_call_update.content` (array of tool-content items) and collect
 * nested `type: "resource"` blocks that carry a base64 `blob`.
 */
export const extractResourceBlobsFromToolContent = (content: unknown): AcpResourceBlob[] => {
  if (!Array.isArray(content)) {
    return []
  }
  const out: AcpResourceBlob[] = []
  for (const item of content) {
    if (!isRecord(item)) {
      continue
    }
    // ACP tool content item: { type: "content", content: ContentBlock }
    const block = item.type === 'content' && isRecord(item.content) ? item.content : item
    if (!isRecord(block) || block.type !== 'resource' || !isRecord(block.resource)) {
      continue
    }
    const resource = block.resource
    const blob = typeof resource.blob === 'string' ? resource.blob : null
    if (!blob) {
      continue
    }
    const uri = typeof resource.uri === 'string' ? resource.uri : 'file:///upload.bin'
    const mimeType =
      typeof resource.mimeType === 'string' && resource.mimeType ? resource.mimeType : 'application/octet-stream'
    out.push({ uri, mimeType, blob })
  }
  return out
}

/**
 * Decode + store outbound ACP resource blobs into IndexedDB under a uri-derived id
 * ({@link deliveredLocalFileId}). Storage is fire-and-forget so the ACP translator
 * can stay synchronous; the Blob is ready in memory for immediate download even if
 * IDB commit races a click. The returned refs — persisted in the tool output — are the
 * single source of truth for citations; there is no live map to keep in sync.
 */
export const materializeOutboundResourceBlobs = (
  content: unknown,
  title?: string | null,
  deps: OutboundBlobDeps = defaultDeps,
): DeliveredFileRef[] => {
  const extracted = extractResourceBlobsFromToolContent(content)
  const refs: DeliveredFileRef[] = []
  for (const item of extracted) {
    const bytes = decodeBase64(item.blob)
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > maxOutboundBlobBytes) {
      continue
    }
    const filename = filenameFromUri(item.uri)
    const localFileId = deliveredLocalFileId(item.uri)
    // Copy into a fresh ArrayBuffer-backed view for BlobPart typing.
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const stored: StoredFile = {
      id: localFileId,
      filename,
      mimeType: item.mimeType,
      size: copy.byteLength,
      createdAt: deps.now(),
      blob: new Blob([copy], { type: item.mimeType }),
    }
    void deps.putAttachment(stored).catch(() => {
      // Preview/download still works from the in-memory Blob we do not retain;
      // a failed IDB write only breaks later sideview reloads.
    })
    refs.push({
      localFileId,
      filename,
      mimeType: item.mimeType,
      size: copy.byteLength,
      uri: item.uri,
      title: deliveredCaption(title, filename),
    })
  }
  return refs
}

export const isDeliveredFilesOutput = (output: unknown): output is DeliveredFilesOutput => {
  if (!isRecord(output) || !Array.isArray(output.deliveredFiles)) {
    return false
  }
  return output.deliveredFiles.every(
    (f) =>
      isRecord(f) &&
      typeof f.localFileId === 'string' &&
      typeof f.filename === 'string' &&
      typeof f.mimeType === 'string' &&
      typeof f.uri === 'string',
  )
}

export const enrichToolOutputWithDeliveredFiles = (
  rawOutput: unknown,
  deliveredFiles: DeliveredFileRef[],
): DeliveredFilesOutput | unknown => {
  if (deliveredFiles.length === 0) {
    return rawOutput ?? {}
  }
  const text = typeof rawOutput === 'string' ? rawOutput : rawOutput == null ? '' : JSON.stringify(rawOutput)
  return { text, deliveredFiles }
}

/** True when a tool UI part carries materialized outbound ACP blobs. */
export const toolPartHasDeliveredFiles = (part: { state?: string; output?: unknown }): boolean =>
  part.state === 'output-available' && isDeliveredFilesOutput(part.output) && part.output.deliveredFiles.length > 0
