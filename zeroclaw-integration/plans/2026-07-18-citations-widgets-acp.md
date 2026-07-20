# Citations / Widgets / ACP `deliver_file` (Thunderbolt) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After ZeroClaw materializes outbound ACP `resource`+`blob`, Thunderbolt maintains a client ref-map `uri → localFileId` and resolves `[N]` / `<widget:document-result fileId=…>` to sideview `local-file` on the ZeroClaw path — without Haystack fetch and without ACP `filename`.

**Architecture:** Thick logic stays under `src/fork/zeroclaw/` (ref-map, resolve helpers, citation placeholders). Existing `materializeOutboundResourceBlobs` gains `uri` + `turnPosition` on refs and registers the map. Thin MPL hooks in `acp-to-ai-sdk.ts`, `document-result/widget.tsx`, `text-part.tsx`, and `source-card.tsx` call fork helpers only. Haystack `_meta` / `/v1/haystack/files` paths remain untouched for Deepset agents.

**Tech Stack:** TypeScript, React, existing IndexedDB `putAttachment` / `local-file` sideview, `bun test` (same style as `outbound-resource-blob.test.ts`), fork-owned modules under `src/fork/zeroclaw/`.

**Spec:** `zeroclaw-integration/specs/2026-07-18-citations-widgets-acp-design.md`  
**Companion ZC (do first):** `E:\zeroclaw\docs\superpowers\plans\2026-07-18-deliver-file-return-uri.md`  
**Sequencing:** Implement/finish ZC uri-in-result first; then this plan. Client ref-map can use ACP wire `uri` even before agents copy it, but agent skill note + end-to-end citations need ZC.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/fork/zeroclaw/delivered-uri-ref-map.ts` | `DeliveredUriRef` type, turn-scoped upsert/lookup by uri and by turnPosition |
| `src/fork/zeroclaw/delivered-uri-ref-map.test.ts` | Unit tests for map |
| `src/fork/zeroclaw/outbound-resource-blob.ts` | Extend `DeliveredFileRef` with `uri` (+ keep basename as `filename`); register map on materialize |
| `src/fork/zeroclaw/outbound-resource-blob.test.ts` | Assert uri + map registration |
| `src/fork/zeroclaw/resolve-delivered-file.ts` | Resolve widget `fileId` / citation → `{ sideviewType, sideviewId }` or missing |
| `src/fork/zeroclaw/resolve-delivered-file.test.ts` | Resolve tests; unknown must not imply Haystack |
| `src/fork/zeroclaw/delivered-citations.ts` | `buildDeliveredCitationPlaceholders` for `[N]` → local-file citations |
| `src/fork/zeroclaw/delivered-citations.test.ts` | `[N]` → map turnPosition |
| `src/fork/zeroclaw/zc-deliver-cite-note.ts` | Short prompt/skill note string for ZC ACP compose |
| `src/acp/translators/acp-to-ai-sdk.ts` | Thin: after materialize, register refs (if not done inside materialize) |
| `src/widgets/document-result/widget.tsx` | Thin: open via fork resolve helper |
| `src/widgets/document-result/widget.test.tsx` | Local-file path when fileId is attachment uri |
| `src/widgets/document-result/instructions.ts` | Note ZC may pass `attachment://deliver/…` as fileId |
| `src/components/chat/text-part.tsx` | Thin: when no haystack refs, try delivered citations from message tool parts / map |
| `src/components/chat/source-card.tsx` | Thin: local-file sideview when citation is delivered-local |
| `src/components/chat/assistant-message.tsx` | Thin: pass delivered refs into TextPart if needed |
| `src/acp/acp-adapter.ts` | Thin: inject ZC cite note into `composeAcpPrompt` when agent is ZeroClaw (or always-safe additive note for ACP) |
| `zeroclaw-integration/HAYSTACK-TO-ACP.md` | Mark widget/`[N]` resolve as adapted |

**Do not:** `git rm` Haystack; open upstream TB PRs that include `src/fork/zeroclaw/`; add ACP `filename`.

---

### Task 1: Ref-map module (TDD)

**Files:**
- Create: `src/fork/zeroclaw/delivered-uri-ref-map.ts`
- Create: `src/fork/zeroclaw/delivered-uri-ref-map.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, test, beforeEach } from 'vitest'
import {
  clearDeliveredUriRefMap,
  getDeliveredUriRefByTurnPosition,
  getDeliveredUriRefByUri,
  listDeliveredUriRefs,
  upsertDeliveredUriRef,
  type DeliveredUriRef,
} from './delivered-uri-ref-map'

const sample = (over: Partial<DeliveredUriRef> = {}): DeliveredUriRef => ({
  uri: 'attachment://deliver/a1b2c3d4e5f6.pdf',
  localFileId: 'local-1',
  turnPosition: 1,
  mimeType: 'application/pdf',
  storageBasename: 'a1b2c3d4e5f6.pdf',
  ...over,
})

describe('delivered-uri-ref-map', () => {
  beforeEach(() => {
    clearDeliveredUriRefMap()
  })

  test('upsert then get by uri and turnPosition', () => {
    upsertDeliveredUriRef(sample())
    expect(getDeliveredUriRefByUri('attachment://deliver/a1b2c3d4e5f6.pdf')?.localFileId).toBe(
      'local-1',
    )
    expect(getDeliveredUriRefByTurnPosition(1)?.uri).toBe('attachment://deliver/a1b2c3d4e5f6.pdf')
    expect(listDeliveredUriRefs()).toHaveLength(1)
  })

  test('second upsert same uri replaces entry and keeps latest turnPosition', () => {
    upsertDeliveredUriRef(sample({ turnPosition: 1, localFileId: 'old' }))
    upsertDeliveredUriRef(sample({ turnPosition: 2, localFileId: 'new' }))
    expect(getDeliveredUriRefByUri('attachment://deliver/a1b2c3d4e5f6.pdf')?.localFileId).toBe(
      'new',
    )
    expect(getDeliveredUriRefByTurnPosition(2)?.localFileId).toBe('new')
  })

  test('unknown uri / position returns undefined', () => {
    expect(getDeliveredUriRefByUri('attachment://deliver/missing.pdf')).toBeUndefined()
    expect(getDeliveredUriRefByTurnPosition(9)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from Thunderbolt worktree root):

```bash
bun test src/fork/zeroclaw/delivered-uri-ref-map.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Minimal implementation**

```ts
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

export type DeliveredUriRef = {
  uri: string
  localFileId: string
  turnPosition: number
  mimeType: string
  storageBasename: string
}

/** Turn-scoped live map. Cleared at turn boundaries by callers when needed. */
const byUri = new Map<string, DeliveredUriRef>()
const byTurnPosition = new Map<number, DeliveredUriRef>()

export const clearDeliveredUriRefMap = (): void => {
  byUri.clear()
  byTurnPosition.clear()
}

export const upsertDeliveredUriRef = (ref: DeliveredUriRef): void => {
  const prev = byUri.get(ref.uri)
  if (prev) {
    byTurnPosition.delete(prev.turnPosition)
  }
  byUri.set(ref.uri, ref)
  byTurnPosition.set(ref.turnPosition, ref)
}

export const getDeliveredUriRefByUri = (uri: string): DeliveredUriRef | undefined => byUri.get(uri)

export const getDeliveredUriRefByTurnPosition = (
  turnPosition: number,
): DeliveredUriRef | undefined => byTurnPosition.get(turnPosition)

export const listDeliveredUriRefs = (): DeliveredUriRef[] =>
  Array.from(byUri.values()).sort((a, b) => a.turnPosition - b.turnPosition)

/** Next 1-based turn position among successful deliveries in this map. */
export const nextDeliveredTurnPosition = (): number => listDeliveredUriRefs().length + 1
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/fork/zeroclaw/delivered-uri-ref-map.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fork/zeroclaw/delivered-uri-ref-map.ts src/fork/zeroclaw/delivered-uri-ref-map.test.ts
git commit -m "$(cat <<'EOF'
feat(fork/zeroclaw): add delivered uri ref-map

EOF
)"
```

---

### Task 2: Materialize registers ref-map (TDD)

**Files:**
- Modify: `src/fork/zeroclaw/outbound-resource-blob.ts`
- Modify: `src/fork/zeroclaw/outbound-resource-blob.test.ts`
- Modify: `src/acp/translators/acp-to-ai-sdk.ts` (only if registration is not inside materialize — prefer inside materialize)

- [ ] **Step 1: Extend failing tests in `outbound-resource-blob.test.ts`**

Add:

```ts
import { clearDeliveredUriRefMap, getDeliveredUriRefByUri } from './delivered-uri-ref-map'

// inside describe('materializeOutboundResourceBlobs'):
  test('registers ref-map entry with uri and turnPosition', () => {
    clearDeliveredUriRefMap()
    const putAttachment = vi.fn(async () => {})
    const content = [
      {
        type: 'content',
        content: {
          type: 'resource',
          resource: {
            uri: 'attachment://deliver/a1b2c3d4e5f6.pdf',
            mimeType: 'application/pdf',
            blob: btoa('hello'),
          },
        },
      },
    ]
    const refs = materializeOutboundResourceBlobs(content, {
      putAttachment,
      randomId: () => 'id-1',
      now: () => 123,
    })
    expect(refs[0]).toMatchObject({
      localFileId: 'id-1',
      filename: 'a1b2c3d4e5f6.pdf',
      uri: 'attachment://deliver/a1b2c3d4e5f6.pdf',
      turnPosition: 1,
    })
    const mapped = getDeliveredUriRefByUri('attachment://deliver/a1b2c3d4e5f6.pdf')
    expect(mapped?.localFileId).toBe('id-1')
    expect(mapped?.turnPosition).toBe(1)
    expect(mapped?.storageBasename).toBe('a1b2c3d4e5f6.pdf')
  })

  test('assigns increasing turnPosition for multiple blobs', () => {
    clearDeliveredUriRefMap()
    const putAttachment = vi.fn(async () => {})
    const content = [
      {
        type: 'content',
        content: {
          type: 'resource',
          resource: { uri: 'attachment://deliver/a.pdf', mimeType: 'application/pdf', blob: btoa('a') },
        },
      },
      {
        type: 'content',
        content: {
          type: 'resource',
          resource: { uri: 'attachment://deliver/b.pdf', mimeType: 'application/pdf', blob: btoa('b') },
        },
      },
    ]
    const refs = materializeOutboundResourceBlobs(content, {
      putAttachment,
      randomId: () => crypto.randomUUID(),
      now: () => 1,
    })
    expect(refs.map((r) => r.turnPosition)).toEqual([1, 2])
  })
```

Update the existing `stores decoded bytes` expectation to include `uri` and `turnPosition` (from `file:///a/doc.pdf` → filename `doc.pdf`, uri preserved as given).

- [ ] **Step 2: Run to verify fail**

```bash
bun test src/fork/zeroclaw/outbound-resource-blob.test.ts
```

Expected: FAIL — `uri` / `turnPosition` missing on refs.

- [ ] **Step 3: Minimal implementation**

In `outbound-resource-blob.ts`:

1. Import map helpers:

```ts
import {
  nextDeliveredTurnPosition,
  upsertDeliveredUriRef,
} from './delivered-uri-ref-map'
```

2. Extend type:

```ts
export type DeliveredFileRef = {
  localFileId: string
  filename: string
  mimeType: string
  size: number
  uri: string
  turnPosition: number
}
```

3. In `materializeOutboundResourceBlobs`, after creating `id` / `filename`, compute position and push:

```ts
    const turnPosition = nextDeliveredTurnPosition()
    // ... putAttachment as today ...
    const ref: DeliveredFileRef = {
      localFileId: id,
      filename,
      mimeType: item.mimeType,
      size: copy.byteLength,
      uri: item.uri,
      turnPosition,
    }
    upsertDeliveredUriRef({
      uri: item.uri,
      localFileId: id,
      turnPosition,
      mimeType: item.mimeType,
      storageBasename: filename,
    })
    refs.push(ref)
```

4. Update `isDeliveredFilesOutput` to require `uri: string` and `turnPosition: number` on each file (or accept legacy without them for reload — prefer requiring for new materializations; if tests break on partial shapes, keep optional `uri?`/`turnPosition?` and only register when `uri` present).

**Preferred for this slice:** require `uri` + `turnPosition` on new refs; update all test fixtures that construct `DeliveredFileRef` / `deliveredFiles` arrays (including `delivered-file-card` tests if any, and `enrichToolOutputWithDeliveredFiles` fixtures) to include:

```ts
uri: 'attachment://deliver/x.pdf',
turnPosition: 1,
```

- [ ] **Step 4: Run tests**

```bash
bun test src/fork/zeroclaw/outbound-resource-blob.test.ts src/fork/zeroclaw/delivered-uri-ref-map.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fork/zeroclaw/outbound-resource-blob.ts src/fork/zeroclaw/outbound-resource-blob.test.ts
git commit -m "$(cat <<'EOF'
feat(fork/zeroclaw): register uri ref-map on outbound materialize

EOF
)"
```

---

### Task 3: Resolve helper for widget fileId (TDD)

**Files:**
- Create: `src/fork/zeroclaw/resolve-delivered-file.ts`
- Create: `src/fork/zeroclaw/resolve-delivered-file.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
/* Fork-owned — see ./FORK.md */

import { beforeEach, describe, expect, test } from 'vitest'
import { clearDeliveredUriRefMap, upsertDeliveredUriRef } from './delivered-uri-ref-map'
import { resolveDocumentResultTarget } from './resolve-delivered-file'
import { buildDocumentSideviewId } from '@/types/citation'

describe('resolveDocumentResultTarget', () => {
  beforeEach(() => {
    clearDeliveredUriRefMap()
  })

  test('attachment://deliver uri → local-file sideview', () => {
    upsertDeliveredUriRef({
      uri: 'attachment://deliver/a1b2c3d4e5f6.pdf',
      localFileId: 'local-abc',
      turnPosition: 1,
      mimeType: 'application/pdf',
      storageBasename: 'a1b2c3d4e5f6.pdf',
    })
    const target = resolveDocumentResultTarget({
      fileId: 'attachment://deliver/a1b2c3d4e5f6.pdf',
      name: 'Договор.pdf',
    })
    expect(target).toEqual({
      kind: 'local-file',
      sideviewType: 'local-file',
      sideviewId: buildDocumentSideviewId({ fileId: 'local-abc', fileName: 'Договор.pdf' }),
      displayName: 'Договор.pdf',
    })
  })

  test('missing name falls back to storage basename', () => {
    upsertDeliveredUriRef({
      uri: 'attachment://deliver/a1b2c3d4e5f6.pdf',
      localFileId: 'local-abc',
      turnPosition: 1,
      mimeType: 'application/pdf',
      storageBasename: 'a1b2c3d4e5f6.pdf',
    })
    const target = resolveDocumentResultTarget({
      fileId: 'attachment://deliver/a1b2c3d4e5f6.pdf',
    })
    expect(target?.displayName).toBe('a1b2c3d4e5f6.pdf')
    expect(target?.sideviewId).toContain('a1b2c3d4e5f6.pdf')
  })

  test('unknown attachment uri on ZC path → missing (not haystack)', () => {
    const target = resolveDocumentResultTarget({
      fileId: 'attachment://deliver/nope.pdf',
      name: 'x.pdf',
    })
    expect(target).toEqual({ kind: 'missing' })
  })

  test('non-attachment fileId → haystack-document (unchanged path)', () => {
    const target = resolveDocumentResultTarget({ fileId: 'deepset-uuid-1', name: 'a.pdf' })
    expect(target).toEqual({
      kind: 'haystack-document',
      sideviewType: 'document',
      sideviewId: buildDocumentSideviewId({ fileId: 'deepset-uuid-1', fileName: 'a.pdf' }),
      displayName: 'a.pdf',
    })
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test src/fork/zeroclaw/resolve-delivered-file.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
/* Fork-owned — see ./FORK.md */

import { buildDocumentSideviewId } from '@/types/citation'
import { getDeliveredUriRefByUri } from './delivered-uri-ref-map'

export type DocumentResultTarget =
  | {
      kind: 'local-file'
      sideviewType: 'local-file'
      sideviewId: string
      displayName: string
    }
  | {
      kind: 'haystack-document'
      sideviewType: 'document'
      sideviewId: string
      displayName: string
    }
  | { kind: 'missing' }

const isAttachmentDeliverUri = (fileId: string): boolean =>
  fileId.startsWith('attachment://deliver/')

/**
 * Resolve `<widget:document-result fileId=…>` for ZC vs Haystack.
 * Unknown `attachment://deliver/…` must NOT become a Haystack fetch.
 */
export const resolveDocumentResultTarget = (args: {
  fileId: string
  name?: string
}): DocumentResultTarget => {
  const fileId = args.fileId.trim()
  if (isAttachmentDeliverUri(fileId)) {
    const ref = getDeliveredUriRefByUri(fileId)
    if (!ref) {
      return { kind: 'missing' }
    }
    const displayName = (args.name && args.name.trim()) || ref.storageBasename
    return {
      kind: 'local-file',
      sideviewType: 'local-file',
      sideviewId: buildDocumentSideviewId({ fileId: ref.localFileId, fileName: displayName }),
      displayName,
    }
  }

  const displayName = (args.name && args.name.trim()) || fileId
  return {
    kind: 'haystack-document',
    sideviewType: 'document',
    sideviewId: buildDocumentSideviewId({ fileId, fileName: displayName }),
    displayName,
  }
}
```

- [ ] **Step 4: Run tests — PASS**

```bash
bun test src/fork/zeroclaw/resolve-delivered-file.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/fork/zeroclaw/resolve-delivered-file.ts src/fork/zeroclaw/resolve-delivered-file.test.ts
git commit -m "$(cat <<'EOF'
feat(fork/zeroclaw): resolve document-result fileId via uri map

EOF
)"
```

---

### Task 4: Thin hook — `DocumentResultWidget` uses resolve helper

**Files:**
- Modify: `src/widgets/document-result/widget.tsx`
- Modify: `src/widgets/document-result/widget.test.tsx`
- Modify: `src/widgets/document-result/instructions.ts`

- [ ] **Step 1: Update widget tests for local-file path**

In `widget.test.tsx`, add a case that mocks `useContentView` / captures `showSideview` and:

1. `upsertDeliveredUriRef` for `attachment://deliver/a1b2c3d4e5f6.pdf`
2. Render `<DocumentResultWidget name="Договор.pdf" fileId="attachment://deliver/a1b2c3d4e5f6.pdf" />`
3. Click the button
4. Expect `showSideview` called with `'local-file'` and an id containing `local-…` / mapped id — **not** `'document'`
5. Existing Haystack uuid test must still call `'document'`

If the test file uses a capture helper already, extend it; otherwise mirror the existing click test pattern in that file.

- [ ] **Step 2: Run to verify fail**

```bash
bun test src/widgets/document-result/widget.test.tsx
```

Expected: FAIL — widget still opens `'document'` for attachment uri.

- [ ] **Step 3: Thin widget change**

Replace the click handler in `widget.tsx`:

```tsx
import { resolveDocumentResultTarget } from '@/fork/zeroclaw/resolve-delivered-file'

// inside component:
  const handleClick = useCallback(() => {
    const target = resolveDocumentResultTarget({ fileId, name })
    if (target.kind === 'missing') {
      // Non-blocking: do not call Haystack for unknown attachment:// uris
      return
    }
    showSideview(target.sideviewType, target.sideviewId)
  }, [showSideview, fileId, name])
```

Update `instructions.ts` text to mention ZC:

```ts
export const instructions = `## Document Result
<widget:document-result name="filename.pdf" fileId="uuid-or-attachment-uri" snippet="relevant text excerpt" score="0.95" />
Shows a source document card with file name and content snippet.
Haystack: fileId is a remote document id.
ZeroClaw: after deliver_file, fileId must be the exact returned uri (attachment://deliver/<basename>); name= comes from [Document: …], not from inventing ACP filename.`
```

- [ ] **Step 4: Run tests — PASS**

```bash
bun test src/widgets/document-result/widget.test.tsx src/fork/zeroclaw/resolve-delivered-file.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/widgets/document-result/widget.tsx src/widgets/document-result/widget.test.tsx src/widgets/document-result/instructions.ts
git commit -m "$(cat <<'EOF'
feat(widgets): resolve document-result via ZeroClaw uri map

EOF
)"
```

---

### Task 5: `[N]` delivered citations helper (TDD)

**Files:**
- Create: `src/fork/zeroclaw/delivered-citations.ts`
- Create: `src/fork/zeroclaw/delivered-citations.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
/* Fork-owned — see ./FORK.md */

import { beforeEach, describe, expect, test } from 'vitest'
import { clearDeliveredUriRefMap, upsertDeliveredUriRef } from './delivered-uri-ref-map'
import { buildDeliveredCitationPlaceholders } from './delivered-citations'
import { buildDocumentSideviewId, isDocumentCitation } from '@/types/citation'

describe('buildDeliveredCitationPlaceholders', () => {
  beforeEach(() => {
    clearDeliveredUriRefMap()
    upsertDeliveredUriRef({
      uri: 'attachment://deliver/a.pdf',
      localFileId: 'L1',
      turnPosition: 1,
      mimeType: 'application/pdf',
      storageBasename: 'a.pdf',
    })
  })

  test('replaces [1] with cite placeholder bound to local file', () => {
    const { fullText, citations } = buildDeliveredCitationPlaceholders('See [1].', 0)
    expect(fullText).toMatch(/\{\{CITE:\d+\}\}/)
    expect(fullText).not.toContain('[1]')
    const sources = citations.get(0)
    expect(sources).toHaveLength(1)
    const s = sources![0]
    expect(isDocumentCitation(s)).toBe(true)
    if (isDocumentCitation(s)) {
      expect(s.documentMeta.fileId).toBe('L1')
      expect(s.id).toBe(buildDocumentSideviewId({ fileId: 'L1', fileName: 'a.pdf' }))
      // Marker for source-card thin hook:
      expect((s as { localFileSideview?: boolean }).localFileSideview).toBe(true)
    }
  })

  test('unknown [N] left unchanged', () => {
    const { fullText } = buildDeliveredCitationPlaceholders('See [9].', 0)
    expect(fullText).toBe('See [9].')
  })
})
```

- [ ] **Step 2: Run — FAIL**

```bash
bun test src/fork/zeroclaw/delivered-citations.test.ts
```

- [ ] **Step 3: Implement**

Mirror the regex approach from `text-part.tsx` (`groupedCitationRegex` / `individualCitationRegex`) inside the fork module (copy the two regex constants into the fork file — do not import private consts from MPL `text-part.tsx`).

```ts
/* Fork-owned — see ./FORK.md */

import {
  buildDocumentSideviewId,
  type CitationMap,
  type DocumentCitationSource,
} from '@/types/citation'
import { getDeliveredUriRefByTurnPosition } from './delivered-uri-ref-map'

const groupedCitationRegex = /\[\d+\](?!\()(?:\s*\[\d+\](?!\())*/g
const individualCitationRegex = /\[(\d+)\]/g

/** Document citation that should open sideview `local-file` (ZC path). */
export type LocalDocumentCitationSource = DocumentCitationSource & {
  localFileSideview: true
}

export const isLocalDocumentCitation = (
  source: { localFileSideview?: boolean },
): source is LocalDocumentCitationSource => source.localFileSideview === true

export const buildDeliveredCitationPlaceholders = (
  text: string,
  startKey = 0,
): { fullText: string; citations: CitationMap } => {
  const citations: CitationMap = new Map()
  let nextKey = startKey

  const fullText = text.replace(groupedCitationRegex, (match) => {
    const validSources: LocalDocumentCitationSource[] = []
    for (const m of match.matchAll(individualCitationRegex)) {
      const n = parseInt(m[1], 10)
      const ref = getDeliveredUriRefByTurnPosition(n)
      if (!ref) {
        continue
      }
      const ext = ref.storageBasename.split('.').pop()?.toLowerCase() ?? ''
      validSources.push({
        id: buildDocumentSideviewId({ fileId: ref.localFileId, fileName: ref.storageBasename }),
        title: ref.storageBasename,
        url: '',
        siteName: ext.toUpperCase(),
        isPrimary: validSources.length === 0,
        documentMeta: {
          fileId: ref.localFileId,
          fileName: ref.storageBasename,
        },
        localFileSideview: true,
      })
    }
    if (validSources.length === 0) {
      return match
    }
    const key = nextKey++
    citations.set(key, validSources)
    return `{{CITE:${key}}}`
  })

  return { fullText, citations }
}
```

- [ ] **Step 4: Run — PASS**

```bash
bun test src/fork/zeroclaw/delivered-citations.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/fork/zeroclaw/delivered-citations.ts src/fork/zeroclaw/delivered-citations.test.ts
git commit -m "$(cat <<'EOF'
feat(fork/zeroclaw): build [N] citations from delivered uri map

EOF
)"
```

---

### Task 6: Thin hooks — TextPart + SourceCard

**Files:**
- Modify: `src/components/chat/text-part.tsx`
- Modify: `src/components/chat/source-card.tsx`
- Optional test: extend an existing text-part / source-card test if present; otherwise add a focused fork-level test already covered in Task 5 and a small source-card unit test.

- [ ] **Step 1: TextPart — prefer Haystack when present; else delivered map**

In `TextPart`'s `useMemo` citation builder selection (where `hasDocumentRefs` picks `buildDocumentCitationPlaceholders`), change to:

```ts
import { buildDeliveredCitationPlaceholders } from '@/fork/zeroclaw/delivered-citations'
import { listDeliveredUriRefs } from '@/fork/zeroclaw/delivered-uri-ref-map'

// ...
  const hasDeliveredRefs = listDeliveredUriRefs().length > 0

  // Pick citation builder:
  // 1) Haystack references win when present (Deepset path unchanged)
  // 2) Else ZC delivered uri map
  // 3) Else web sources
  const buildPlaceholders = hasDocumentRefs
    ? (text: string, offset: number) =>
        buildDocumentCitationPlaceholders(text, haystackReferences!, offset)
    : hasDeliveredRefs
      ? (text: string, offset: number) => buildDeliveredCitationPlaceholders(text, offset)
      : hasNewSources
        ? (text: string, offset: number) => buildSourceCitationPlaceholders(text, sources!, offset)
        : null
```

Wire `buildPlaceholders` into the existing loop the same way the current ternary does. Keep hook order stable.

Add `hasDeliveredRefs` to the `useMemo` dependency list (or call `listDeliveredUriRefs()` inside the memo and depend on `part.text` + haystack/sources — map is module state updated before text streams; for tests, upsert before render).

- [ ] **Step 2: SourceCard — open `local-file` when flagged**

In `source-card.tsx` `handleClick`:

```ts
import { isLocalDocumentCitation } from '@/fork/zeroclaw/delivered-citations'

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault()
    if (isDocument && isLocalDocumentCitation(source)) {
      showSideview('local-file', buildDocumentSideviewId(source.documentMeta))
    } else if (isDocument) {
      showSideview('document', buildDocumentSideviewId(source.documentMeta))
    } else if (safeUrl !== '#') {
      openExternalLink(safeUrl)
    }
    onSelect?.()
  }
```

- [ ] **Step 3: Manual/unit check**

```bash
bun test src/fork/zeroclaw/delivered-citations.test.ts src/components/chat/source-list.test.tsx
```

If `text-part` has tests, run them too. Expected: Haystack tests still pass; no new Haystack calls introduced.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/text-part.tsx src/components/chat/source-card.tsx
git commit -m "$(cat <<'EOF'
feat(chat): resolve ZC [N] citations to local-file sideview

EOF
)"
```

---

### Task 7: Agent skill / prompt note (ZC ACP compose)

**Files:**
- Create: `src/fork/zeroclaw/zc-deliver-cite-note.ts`
- Modify: `src/acp/acp-adapter.ts` (`composeAcpPrompt` call site)
- Modify: `src/acp/acp-adapter.test.ts`

- [ ] **Step 1: Failing adapter test**

Add a test that when composing an ACP prompt for a ZeroClaw-style agent (use the same agent id / registry hint the fork already uses for ZC — if none, inject unconditionally into ACP compose as a small always-on note for ACP sessions only), the prompt text includes a substring like `deliver_file returns uri` / `attachment://deliver`.

Inspect how the adapter distinguishes agents; if ZeroClaw is selected via registry snapshot / agent id containing `zeroclaw`, gate on that. If gating is unclear, append the note for **all** ACP prompts (Haystack agents ignore `deliver_file` — YAGNI-safe). Prefer: append for all ACP `composeAcpPrompt` outputs when `skillInstructions` path runs — simplest thin hook:

```ts
import { ZEROCLAW_DELIVER_CITE_NOTE } from '@/fork/zeroclaw/zc-deliver-cite-note'

// when building skillInstructions array or inside composeAcpPrompt:
// prepend/append ZEROCLAW_DELIVER_CITE_NOTE as its own block
```

Write the test against the existing `folds resolved skill instructions` style: expect user text prompt to contain the cite note.

- [ ] **Step 2: Run — FAIL**

```bash
bun test src/acp/acp-adapter.test.ts
```

- [ ] **Step 3: Implement note + thin hook**

`zc-deliver-cite-note.ts`:

```ts
/* Fork-owned — see ./FORK.md */

export const ZEROCLAW_DELIVER_CITE_NOTE = `When deliver_file returns uri, cite that exact uri in
<widget:document-result fileId="<uri>" name="<pretty from Document marker>" … />
or as [N] matching delivery order. Do not invent fileId prefixes.
Pretty names come from [Document: …], never from uri basename alone if a Document marker exists.`
```

In `composeAcpPrompt` (or its caller in `acp-adapter.ts`), include the note as the first block when present:

```ts
const composeAcpPrompt = (
  skillInstructions: string[] | undefined,
  userText: string,
  priorTranscript?: string,
): string =>
  [
    ZEROCLAW_DELIVER_CITE_NOTE,
    skillInstructions && skillInstructions.length > 0 ? skillInstructions.join('\n\n') : undefined,
    priorTranscript ? `Conversation so far:\n\n${priorTranscript}` : undefined,
    userText,
  ]
    .filter((block): block is string => block !== undefined)
    .join('\n\n')
```

- [ ] **Step 4: Run — PASS**

```bash
bun test src/acp/acp-adapter.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/fork/zeroclaw/zc-deliver-cite-note.ts src/acp/acp-adapter.ts src/acp/acp-adapter.test.ts
git commit -m "$(cat <<'EOF'
feat(acp): inject ZeroClaw deliver_file citation note into compose

EOF
)"
```

---

### Task 8: Inventory doc + final verification

**Files:**
- Modify: `zeroclaw-integration/HAYSTACK-TO-ACP.md`

- [ ] **Step 1: Update inventory rows**

Change the `document-result` widget row Action from **Partial** to **Adapted for ZC** (ref-map + local-file; Haystack remote unchanged). Add a row or note for `[N]` citations on ZC path → delivered uri map.

- [ ] **Step 2: Run fork + widget + adapter tests**

```bash
bun test src/fork/zeroclaw/ src/widgets/document-result/widget.test.tsx src/acp/acp-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 3: Confirm Haystack not deleted**

```bash
git ls-files backend/src/haystack | head
rg -n "haystack/files" src/widgets/document-result/use-document-blob.ts
```

Expected: Haystack paths still present; `useDocumentBlob` still fetches `haystack/files/${fileId}` for the Haystack sideview path.

- [ ] **Step 4: Commit**

```bash
git add zeroclaw-integration/HAYSTACK-TO-ACP.md
git commit -m "$(cat <<'EOF'
docs(zeroclaw-integration): note ZC citation/widget resolve via uri map

EOF
)"
```

---

## Acceptance mapping (spec §10 Thunderbolt)

| Acceptance | Task |
|------------|------|
| Materializing outbound blob registers ref-map for uri | Task 1–2 |
| Widget `fileId=attachment://deliver/…` → local-file; zero Haystack | Task 3–4 |
| `[N]` for N-th delivered blob → same local file | Task 5–6 |
| `name=` as title; missing → uri basename | Task 3 |
| Unknown fileId on ZC path does not hit Haystack | Task 3 (`missing`) + Task 4 early return |
| Haystack agent path still resolves remote ids | Task 3 haystack branch + Task 6 Haystack-first |
| Agent reuses uri (prompt note) | Task 7 (+ ZC companion plan) |

## Spec coverage / non-goals

- No ACP `filename` / required `_meta`
- No Haystack purge
- No auto-deliver
- No upstream PR of `src/fork/zeroclaw/`
- ZC model-facing `uri` — companion ZC plan only

## Placeholder scan

No TBD steps; concrete types/names: `DeliveredUriRef`, `upsertDeliveredUriRef`, `resolveDocumentResultTarget`, `buildDeliveredCitationPlaceholders`, `ZEROCLAW_DELIVER_CITE_NOTE`.

## Type consistency

- Map field `storageBasename` (not `prettyName`)
- Wire uri scheme only `attachment://deliver/…`
- Sideview types: `'local-file'` vs `'document'`
- `turnPosition` is 1-based
