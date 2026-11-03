/* Copyright (c) Okta Plus LLC. All rights reserved.
 * Fork-owned file (see AGENTS.md / CLAUDE.md: additive fork surface). */

/**
 * The invariants of the desktop app's native surface: what the webview may ask
 * the native side for, and how the window is wired.
 *
 * These are invariants, not preferences. The webview renders model output,
 * attachments and remote documents, so "JS in the app origin" is a state to
 * design against, not an impossible one — and every unscoped native permission
 * turns it into something worse. A permission that drifts back in is a silent
 * regression: nothing fails to build, nothing fails to run, and the hole is
 * only visible in this file.
 *
 * Deliberately a JSON assertion rather than a Rust test: the capability file is
 * the thing that grants the right, and reading it directly cannot be fooled by
 * how the Rust side happens to be wired today.
 */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Permission = string | { identifier: string; allow?: { path: string }[] }

const capabilities = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../src-tauri/capabilities/default.json'), 'utf-8'),
) as { permissions: Permission[] }

const identifiers = capabilities.permissions.map((p) => (typeof p === 'string' ? p : p.identifier))

const scopeOf = (identifier: string): { path: string }[] | undefined =>
  capabilities.permissions.find(
    (p): p is Exclude<Permission, string> => typeof p !== 'string' && p.identifier === identifier,
  )?.allow

describe('desktop capabilities', () => {
  /**
   * `open_path` is a raw ShellExecute: it launches whatever the OS associates
   * with the file, including `.bat`, `.lnk` and `.exe`. Granted to JS it is an
   * execution primitive — write a file somewhere writable (Downloads is), then
   * open it. Opening is the Rust side's job, on a path the webview never names.
   *
   * `openUrl` is what the frontend actually uses (external links, OAuth) and is
   * covered by `opener:default`.
   */
  it('never lets the webview open a path', () => {
    expect(identifiers).not.toContain('opener:allow-open-path')
  })

  /**
   * The save dialog is the Rust command's (`save_document_as`): capabilities gate
   * IPC from the webview, and Rust calling the plugin needs none. Granting it to
   * JS again would mean the destination is being chosen in the webview once more,
   * which is the shape this whole change removed.
   */
  it('does not let the webview raise a save dialog of its own', () => {
    expect(identifiers).not.toContain('dialog:allow-save')
  })

  /** Writing is fine where it is scoped; unscoped write is not. */
  it('keeps every granted file write inside a scope', () => {
    for (const identifier of identifiers.filter((id) => id.startsWith('fs:allow-write'))) {
      expect(scopeOf(identifier), `${identifier} is granted without a scope`).toBeDefined()
    }
  })
})

describe('what "Download and open" may launch', () => {
  const commands = readFileSync(resolve(import.meta.dirname, '../../../src-tauri/src/commands.rs'), 'utf-8')
  const allowlist = commands.match(/OPENABLE_EXTENSIONS: &\[&str\] = &\[(.*?)\];/s)?.[1] ?? ''

  /**
   * The bytes come from a chat attachment or an agent, and opening hands them to
   * whatever the OS associates with the extension. Macros and script are the two
   * ways "just a document" becomes execution, so these formats are revealed in
   * the file manager instead of opened: the legacy Office trio carries macros,
   * and an `.svg` opens in a browser that will run what is inside it.
   */
  it.each(['doc', 'xls', 'ppt', 'svg', 'html', 'htm', 'exe', 'bat', 'lnk', 'ps1'])(
    'never launches a .%s',
    (extension) => {
      expect(allowlist).not.toContain(`"${extension}"`)
    },
  )

  /** What a browser does to a download, so Office opens it in Protected View. */
  it('marks the saved file as coming from the internet zone', () => {
    expect(commands).toContain('Zone.Identifier')
    expect(commands).toContain('ZoneId=3')
  })
})

describe('desktop window', () => {
  const tauriConf = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../src-tauri/tauri.conf.json'), 'utf-8'),
  ) as { app: { windows: { dragDropEnabled?: boolean }[] } }

  /**
   * Tauri replaces WebView2's drag-drop handler unless this is off — its own doc
   * says disabling is *required* for HTML5 drag and drop on Windows. The
   * attachment drop is an HTML5 one (`onDrop`/`DataTransfer` in
   * `chat-prompt-input.tsx`), and no code listens to Tauri's `DragDropEvent`, so
   * with the default the webview never sees a dropped file at all.
   */
  it('lets the webview handle HTML5 file drops', () => {
    expect(tauriConf.app.windows[0]?.dragDropEnabled).toBe(false)
  })
})

/**
 * `connect-src` of the MAIN window — not the artifact frame, which has its own, far
 * stricter policy (`src/artifacts/sandbox-host.ts`, per item, usually
 * `default-src 'none'; connect-src 'none'`). Two policies, two frames; only the frame's
 * one is a real boundary, and nothing here touches it.
 *
 * What this directive can and cannot be is measured in
 * `docs/development/loopback-connect-src.md`: bare `https:`/`wss:` already allow every
 * TLS host, and the `http:default` capability (any host, any port, any path) reaches
 * anything over IPC where a content policy never sees it. So it buys no protection from
 * exfiltration, and none from reaching loopback with a plain request.
 *
 * ⚠ For a WEBSOCKET it is the only gate there is — that capability is fetch-only — so
 * the port wildcard genuinely widens what the page may open on this machine. That is an
 * accepted cost, not an oversight: the port is a runtime fact of each install, so a
 * static list is wrong on the next machine and costs a release to correct. The narrower
 * alternative — a native bridge scoped to the configured agent URLs — is recorded in the
 * spec and not built. A local agent is expected to require its bearer token regardless
 * (`zeroclaw.acp.v1`), which is what actually protects it.
 *
 * What is left worth pinning is the one line that still means something (plaintext only
 * to loopback) and the shape of the list, because a long list of dead entries is what
 * invites an eighteenth.
 */
describe('main-window connect-src', () => {
  const csp = (
    JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../src-tauri/tauri.conf.json'), 'utf-8')) as {
      app: { security: { csp: Record<string, string> } }
    }
  ).app.security.csp['connect-src']

  const sources = csp.split(/\s+/).filter(Boolean)

  it('allows loopback on any port, by address and by name', () => {
    // The agent form takes any URL and ZeroClaw's port comes from its own config, so a
    // fixed port can only ever be wrong on the next install.
    for (const source of ['ws://127.0.0.1:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'http://localhost:*']) {
      expect(sources).toContain(source)
    }
  })

  it('names no loopback port, so the list cannot grow back', () => {
    const withPort = sources.filter((s) => /^(ws|http)s?:\/\/(127\.0\.0\.1|localhost):\d+$/.test(s))
    expect(withPort).toEqual([])
  })

  it('names no https host, because bare `https:` already covers every one', () => {
    // This is how `https://opencode.ai` got in: redundant the day it was written.
    const redundant = sources.filter((s) => /^(https|wss):\/\/[^*]/.test(s))
    expect(redundant).toEqual([])
  })

  it('allows plaintext ONLY to loopback', () => {
    // The load-bearing one. Reaching a plaintext LAN address from the page stays
    // refused, and `http:` must never be opened wholesale.
    const plaintext = sources.filter((s) => /^(ws|http):/.test(s))
    const allowed = new Set([
      'http://ipc.localhost',
      'ws://127.0.0.1:*',
      'http://127.0.0.1:*',
      'ws://localhost:*',
      'http://localhost:*',
    ])
    expect(plaintext.filter((s) => !allowed.has(s))).toEqual([])
  })
})
