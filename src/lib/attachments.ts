/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { defaultDeliveryMode, getTransformer } from '@/files/transformers'
import type { AttachmentData, ThunderboltUIMessage } from '@/types'
import { attachmentMarker } from '@/fork/citations/attachment-sources'
import { getAttachment, type StoredFile } from './file-blob-storage'

/**
 * The AI SDK `data-*` part type for a chat attachment reference. The part holds
 * only the {@link AttachmentData} reference — never the file bytes — so it
 * persists/syncs cheaply and `convertToModelMessages` ignores it (data parts
 * are UI-only). At send time the per-agent transport hydrates the bytes from
 * IndexedDB.
 */
export const attachmentPartType = 'data-attachment' as const

export type AttachmentPart = {
  type: typeof attachmentPartType
  id?: string
  data: AttachmentData
}

/** Model-facing note standing in for attachments an agent couldn't be sent
 *  (missing on this device, or with no form that agent accepts), one line per
 *  file. English like every other model-facing text. */
export const undeliverableAttachmentsNote = (filenames: string[]): string =>
  filenames.map((name) => `[Attachment "${name}" could not be delivered to this agent]`).join('\n')

/** Build the reference-only attachment part to include in an outgoing message. */
export const buildAttachmentPart = (data: AttachmentData): AttachmentPart => ({
  type: attachmentPartType,
  data,
})

/** Type guard for attachment parts. */
export const isAttachmentPart = (part: { type: string }): part is AttachmentPart => part.type === attachmentPartType

/** Extract all attachment references from a message, in order. */
export const getAttachments = (message: ThunderboltUIMessage): AttachmentData[] =>
  message.parts.filter(isAttachmentPart).map((part) => part.data)

/** Read a Blob as a base64 data URL. */
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read attachment'))
    reader.readAsDataURL(blob)
  })

/** Read a Blob as raw base64 (no `data:<mime>;base64,` prefix). */
export const blobToBase64 = async (blob: Blob): Promise<string> => {
  const dataUrl = await blobToDataUrl(blob)
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

/** An attachment reference paired with its base64-encoded bytes. */
export type HydratedAttachment = AttachmentData & { base64: string }

/** Injectable IO for {@link hydrateAttachmentsAsFileParts} — overridden in tests to avoid IndexedDB/transformers. */
export type HydrationDeps = {
  getAttachment: typeof getAttachment
  getTransformer: typeof getTransformer
}

const defaultHydrationDeps: HydrationDeps = { getAttachment, getTransformer }

/** A `text` part carrying an attachment's extracted text, or just its name when there's no text to send. */
const attachmentTextPart = (filename: string, text?: string) => ({
  type: 'text' as const,
  text: text ? `[Attachment: ${filename}]\n\n${text}` : `[Attachment: ${filename}]`,
})

/**
 * Deliver a *current-turn* attachment in full (see {@link AttachmentData.deliverAs}):
 *   - default → AI SDK `file` part, bytes inlined as a data URL (e.g. an Anthropic
 *     PDF document block) — the native-first path. Plain-text files default to text.
 *   - `'text'` → run the text transformer and emit a `text` part instead (the
 *     convert-to-text remediation). Falls back to native bytes if no transformer.
 *   - `'images'` → rasterize (e.g. a scanned PDF) into one image `file` part per
 *     page for a vision model. Falls back to native bytes if no transformer.
 */
const hydrateCurrentAttachment = async (
  data: AttachmentData,
  file: StoredFile,
  deps: HydrationDeps,
  /** Fork: this attachment's 1-based number in the turn, which the reply cites as `[N]`. */
  citationIndex: number,
) => {
  // Fork: its own part rather than a prefix on the text, because two of the three
  // delivery paths below carry no text at all — docx and PDF travel as raw bytes, and
  // those are exactly the documents people ask about. See
  // docs/development/attachment-citations.md.
  const marker = { type: 'text' as const, text: attachmentMarker(data.filename, citationIndex) }
  const mode = data.deliverAs ?? defaultDeliveryMode(data.mimeType)
  if (mode === 'text') {
    const transformer = await deps.getTransformer(data.mimeType, 'text')
    if (transformer) {
      const output = await transformer(file)
      if ('text' in output) {
        return [marker, { type: 'text' as const, text: output.text }]
      }
    }
    // No text transformer — fall through to native bytes.
  }
  if (mode === 'images') {
    const transformer = await deps.getTransformer(data.mimeType, 'images')
    if (transformer) {
      const output = await transformer(file)
      if ('images' in output) {
        return [
          marker,
          ...output.images.map((image) => ({
            type: 'file' as const,
            mediaType: image.mimeType,
            filename: data.filename,
            url: image.dataUrl,
          })),
        ]
      }
    }
    // No images transformer — fall through to native bytes.
  }
  const url = await blobToDataUrl(file.blob)
  return [marker, { type: 'file' as const, mediaType: data.mimeType, filename: data.filename, url }]
}

/**
 * Reduce a *historical* attachment (from an earlier turn) to its extracted text,
 * or a bare `[Attachment: name]` reference when no text can be extracted (e.g. an
 * image). Historical attachments are NEVER re-sent as native bytes — see
 * {@link hydrateAttachmentsAsFileParts}.
 */
const hydrateHistoricalAttachment = async (data: AttachmentData, file: StoredFile, deps: HydrationDeps) => {
  const transformer = await deps.getTransformer(data.mimeType, 'text')
  if (transformer) {
    const output = await transformer(file)
    if ('text' in output) {
      return [attachmentTextPart(data.filename, output.text)]
    }
  }
  return [attachmentTextPart(data.filename)]
}

/**
 * Built-in (AI SDK) transport hydration: replace reference-only attachment parts
 * with their content so `convertToModelMessages` forwards them to the model.
 * Bytes are read from IndexedDB at send time — the persisted message keeps only
 * the reference. Attachments missing on this device are left as the reference
 * part (which `convertToModelMessages` drops from model input).
 *
 * Only the **latest user turn** delivers its attachments in full (native bytes /
 * images / extracted text). Attachments from **earlier** turns are reduced to
 * extracted text (or a `[Attachment: name]` reference) and are NEVER re-sent as
 * native bytes. Stateless chat resends the whole history every turn, so re-inlining
 * historical bytes both bloats each request and — critically — poisons the *entire
 * thread* if any one historical attachment is undeliverable (e.g. an image a model
 * rejects, which has no remediation path): the bad part replays forever and every
 * subsequent send fails. Reducing history to text removes the native bytes (so
 * nothing replays that can fail), keeps follow-up questions answerable, and shrinks
 * the payload. The current turn still gets full fidelity, and remediation still
 * operates on it.
 */
export const hydrateAttachmentsAsFileParts = async (
  messages: ThunderboltUIMessage[],
  deps: HydrationDeps = defaultHydrationDeps,
): Promise<ThunderboltUIMessage[]> => {
  const currentTurnIndex = messages.findLastIndex((message) => message.role === 'user')
  return Promise.all(
    messages.map(async (message, index) => {
      if (!message.parts.some(isAttachmentPart)) {
        return message
      }
      const isCurrentTurn = index === currentTurnIndex
      // Fork: the number each attachment is cited as, keyed on the part itself so it
      // cannot drift from `attachmentSourcesOfTurn`, which numbers the same list in
      // the same order. Only the current turn is numbered — earlier turns were
      // numbered when they ran, and their citations resolve from their own message.
      const citationIndexes = new Map(
        message.parts.filter(isAttachmentPart).map((part, position) => [part, position + 1] as const),
      )
      // Each attachment maps to one or more parts (images yield one part per
      // page), so build arrays and flatten.
      const nested = await Promise.all(
        message.parts.map(async (part) => {
          if (!isAttachmentPart(part)) {
            return [part]
          }
          // An unreadable attachment is treated exactly like a missing one: leave
          // the part alone and send the turn without those bytes. Both the lookup
          // and the read can fail for a file stored before `putAttachment` copied
          // bytes (it held a reference to a path on disk, so editing the source
          // invalidated it) — and because every send re-reads the whole history,
          // letting that throw failed the turn, burned all three auto-retries, and
          // broke even a plain-text follow-up. The conversation stays usable.
          // Fork: an attachment that cannot be read still OCCUPIES its number — the user
          // sees its chip in the thread, and a numbering that shifted with the outcome of
          // a disk read would be nondeterministic. So it keeps its place and says plainly
          // that it did not arrive, rather than being announced as a citable source and
          // then silently dropped. The ACP path has always done this; the built-in path
          // said nothing at all.
          const undeliverable = () =>
            isCurrentTurn
              ? [
                  {
                    type: 'text' as const,
                    text: `${attachmentMarker(part.data.filename, citationIndexes.get(part) ?? 1)} ${undeliverableAttachmentsNote([part.data.filename])}`,
                  },
                ]
              : [part]
          try {
            const file = await deps.getAttachment(part.data.localFileId)
            if (!file) {
              return undeliverable()
            }
            return isCurrentTurn
              ? await hydrateCurrentAttachment(part.data, file, deps, citationIndexes.get(part) ?? 1)
              : await hydrateHistoricalAttachment(part.data, file, deps)
          } catch (error) {
            console.warn('Skipping an unreadable attachment', { filename: part.data.filename, error })
            return undeliverable()
          }
        }),
      )
      return { ...message, parts: nested.flat() }
    }),
  )
}
