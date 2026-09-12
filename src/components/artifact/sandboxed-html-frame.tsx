/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  artifactRequest,
  artifactElementAtSchema,
  artifactElementAtMethod,
  artifactCsp,
  formatHarnessError,
  parseHarnessMessage,
  wrapArtifactHtml,
  wrapArtifactPreviewHtml,
  type ArtifactContext,
  type ArtifactTextSelection,
} from '@/artifacts/harness'
import { registerSandboxContent, type SandboxHandle } from '@/artifacts/sandbox-host'
import { createPendingRequests, elementAtTimeoutMs } from '@/components/embedded'
import type { SurfaceHighlightedElement } from '@/components/embedded'

import { buildThemeStyleTag, resolveArtifactColorScheme, snapshotThemeTokens } from '@/artifacts/theme-tokens'
import { parseCanvasBridgeMessage } from '@/fork/zeroclaw/canvas-bridge-host'
import type { JsonRpcNotification, JsonRpcRequest } from '@/fork/zeroclaw/canvas-bridge-protocol'
import { cn } from '@/lib/utils'
import { useEffect, useMemo, useRef, useState } from 'react'

/** Height used before the page reports its own, and the floor/ceiling for the reported height. */
const defaultAutoHeightPx = 400
const minAutoHeightPx = 60
// Ceiling so a page (which knows its own nonce) can't report a huge height and blow out the transcript.
const maxAutoHeightPx = 20_000

/** The resolved theme classes `ThemeProvider` ever puts on `document.documentElement`. */
type ResolvedThemeClass = 'light' | 'dark' | 'paper'

/**
 * Read the theme actually applied to `document.documentElement` (spec §6).
 * Reading the applied CLASS — rather than the raw `theme` setting from
 * `useTheme()` — sidesteps a real ordering hazard: the class is flipped by
 * `ThemeProvider`'s own effect, which for the SAME commit as a `theme` change
 * can run after this component's, so a render-time read keyed on the raw
 * setting would see the class one render behind. It also folds `'system'`
 * resolution and OS-level scheme changes (which never touch the raw `theme`
 * value) into one signal for free.
 */
const readResolvedThemeClass = (): ResolvedThemeClass => {
  const root = document.documentElement
  return root.classList.contains('dark') ? 'dark' : root.classList.contains('paper') ? 'paper' : 'light'
}

/** Build the `<style>` tag to inject into the artifact for a given resolved theme class. */
const computeThemeStyle = (resolvedTheme: ResolvedThemeClass): string =>
  buildThemeStyleTag(snapshotThemeTokens(), resolveArtifactColorScheme(resolvedTheme))

export type SandboxedHtmlFrameProps = {
  /** Complete, self-contained HTML document to render. */
  html: string
  /** Accessible title for the iframe. */
  title: string
  className?: string
  /**
   * Whether the page's own scripts may run. Defaults to `true`. Set `false` for a
   * live streaming preview so incomplete/complete JS never executes (no hangs, no
   * spurious errors) — only HTML/CSS render. No harness is injected in that mode.
   */
  allowScripts?: boolean
  /**
   * Size the iframe to its content's height (reported by the harness) instead of
   * filling its container — so a tall artifact grows the card rather than scrolling
   * inside a fixed frame (which would trap the page scroll). Needs `allowScripts`.
   */
  autoHeight?: boolean
  /** Fired once the page has loaded and run its initial synchronous script. */
  onReady?: () => void
  /** Fired if the page reports a runtime error (including after load, during use). */
  onError?: (error: string) => void
  /**
   * Fired when the user highlights text inside the artifact, and again with null
   * when they clear it. Reported by the page because the host cannot read a
   * selection inside a frame it shares no origin with.
   */
  onSelectionChange?: (selection: ArtifactTextSelection | null) => void
  /**
   * Receives a resolver for element picking: hand it a point in the artifact's
   * own viewport coordinates and it answers with the element under it, or null
   * over padding and background.
   *
   * Passed out rather than exposed on a ref because the nonce and the frame
   * element are both private to this component, and the caller only ever needs
   * the one question.
   */
  onQueryReady?: (query: (point: { x: number; y: number }) => Promise<SurfaceHighlightedElement | null>) => void
  /**
   * What the page currently shows, derived by the harness and re-sent when the
   * page changes — so an artifact the user has interacted with reports what it
   * looks like now, not what it looked like at load.
   */
  onContextChange?: (context: ArtifactContext) => void
   * Fork hook (Canvas Action Channel): fired for each validated Wire A JSON-RPC
   * request/notification the in-iframe canvas bridge script posts to the host.
   * `frame.post` sends a message back into this same iframe — e.g. a JSON-RPC
   * response or a `ui/notifications/*` push — WITHOUT touching `wrappedHtml`,
   * so the frame stays mounted and does not reload (Model B). The routing/
   * business logic lives in the fork controller that supplies this callback;
   * this component only plumbs messages through.
   */
  onBridgeMessage?: (
    msg: JsonRpcRequest | JsonRpcNotification,
    frame: { nonce: string; post: (m: unknown) => void },
  ) => void
  /**
   * Fork hook: called once with this mounted frame's per-render nonce, so a
   * controller outside this component can correlate later `onBridgeMessage`
   * calls (and any `post`s it issues) with the right iframe instance.
   */
  nonceRef?: (nonce: string) => void
}

/**
 * Renders agent-authored HTML inside a sandboxed iframe (`allow-scripts`, and
 * deliberately no `allow-same-origin`, so it cannot reach the parent's DOM,
 * cookies, or storage). The HTML is wrapped with the same harness used for
 * verification and served from the sandboxed-content host (a dedicated origin with
 * its OWN CSP — see `@/artifacts/sandbox-host`), because the app's strict CSP would
 * otherwise block the artifact's inline scripts in any local-scheme (`srcdoc`/
 * `data:`/`blob:`) iframe. What we show is exactly what we verified. Shared by the
 * inline and side-panel artifact views.
 */
export const SandboxedHtmlFrame = ({
  html,
  title,
  className,
  allowScripts = true,
  autoHeight = false,
  onReady,
  onError,
  onSelectionChange,
  onQueryReady,
  onContextChange,
  onBridgeMessage,
  nonceRef,
}: SandboxedHtmlFrameProps) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // One nonce per mounted frame; correlates the harness's messages with this iframe. useState (not
  // useMemo) so it's a real stability guarantee — React may drop a useMemo cache and recompute,
  // which would regenerate the nonce, silently reload the iframe, and re-key the message listener.
  const [nonce] = useState(() => crypto.randomUUID())
  // Publish the nonce once per mount so a fork controller outside this component can
  // correlate it with later `onBridgeMessage` calls. `nonce` is stable for the life of
  // the mount (see above), so this fires exactly once — a legitimate one-time effect,
  // not a derived value computable during render (the controller lives outside this tree).
  useEffect(() => {
    nonceRef?.(nonce)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- publish once per mount; nonce is stable for the mount's lifetime
  }, [])

  // Theme tokens (spec §6): snapshot what's applied now for the initial render, then
  // re-snapshot whenever the resolved theme CLASS changes. There is no live in-frame
  // recolor — the frame is cross-origin/immutable — so a theme change re-wraps the HTML
  // below, which the registration effect (keyed on `wrappedHtml`) turns into a reload.
  // That resets in-iframe JS/interaction state; acceptable for dashboards whose state is
  // re-derivable from the (offline, static-per-render) HTML.
  const lastThemeClassRef = useRef<ResolvedThemeClass>(readResolvedThemeClass())
  const [themeStyle, setThemeStyle] = useState(() => computeThemeStyle(lastThemeClassRef.current))
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const nextThemeClass = readResolvedThemeClass()
      // `documentElement`'s class attribute also carries unrelated concerns (scroll-lock,
      // RTL, ...) — only react when the resolved light/dark/paper class actually changed,
      // or every open artifact would reload on any of those.
      if (nextThemeClass === lastThemeClassRef.current) {
        return
      }
      lastThemeClassRef.current = nextThemeClass
      setThemeStyle(computeThemeStyle(nextThemeClass))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // Scripts on: wrap with the harness. Scripts off (streaming preview): still inject the
  // offline CSP so the preview can't beacon out via a subresource before verification.
  const wrappedHtml = useMemo(
    () => (allowScripts ? wrapArtifactHtml(html, nonce, themeStyle) : wrapArtifactPreviewHtml(html, themeStyle)),
    [html, nonce, allowScripts, themeStyle],
  )

  // Keep the latest callbacks in refs so the message subscription is set up once
  // per document, not re-subscribed on every parent render.
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange
  const onContextChangeRef = useRef(onContextChange)
  onContextChangeRef.current = onContextChange

  /**
   * Hand the caller an element-at resolver, once per document.
   *
   * Re-issued at each document boundary, so a resolver captured before a reload
   * cannot be answered by the new document — the outstanding query is aborted
   * and resolves empty instead of pointing at the previous artifact's DOM.
   *
   * The nonce alone could not do this: it comes from `useState` and is stable
   * for the component's lifetime, while `srcDoc` recomputes when the HTML
   * changes. The boundary is `srcDoc`.
   */
  const onQueryReadyRef = useRef(onQueryReady)
  onQueryReadyRef.current = onQueryReady
  // One registry per frame, shared with the message handler below so replies
  // route through a single listener rather than one per request.
  const [pending] = useState(() => createPendingRequests())
  useEffect(() => {
    onQueryReadyRef.current?.(async (point) => {
      const frame = iframeRef.current?.contentWindow
      if (!frame) {
        return null
      }
      const result = await pending.issue(
        // `'*'` is the only targetOrigin that can reach this frame, not a
        // shortcut: `sandbox="allow-scripts"` without `allow-same-origin` gives
        // the document an **opaque** origin, and an opaque origin never matches
        // a URL-derived targetOrigin — naming one would silently drop every
        // message. (The Mini App bridge, whose frames load from a real origin,
        // does pin `app.origin`; the difference is the sandbox, not the care.)
        // What travels is a viewport coordinate and the per-mount nonce the
        // document was rendered with and already knows.
        // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration -- opaque sandbox origin; see above
        (id) => frame.postMessage(artifactRequest(nonce, id, artifactElementAtMethod, point), '*'),
        elementAtTimeoutMs,
      )
      // Parsed rather than cast: a page answering with `{}` would otherwise
      // render `undefined` into an outline. Anything unexpected resolves null,
      // which reads as "nothing here" — the routine answer over padding.
      const parsed = artifactElementAtSchema.safeParse(result)
      return parsed.success ? parsed.data.element : null
    })
  }, [nonce, srcDoc, pending])
  const onBridgeMessageRef = useRef(onBridgeMessage)
  onBridgeMessageRef.current = onBridgeMessage

  // Register the wrapped HTML with the sandbox host; the resulting URL is what the
  // iframe loads. Re-register when the document changes; revoke on change/unmount.
  const [src, setSrc] = useState<string | null>(null)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  useEffect(() => {
    let handle: SandboxHandle | null = null
    let cancelled = false
    // Reset measured height at each document boundary so a swap doesn't keep the previous
    // artifact's height until a fresh `artifact-height` arrives (dead space / clipping).
    setContentHeight(null)
    setSrc(null)
    registerSandboxContent({ html: wrappedHtml, csp: artifactCsp })
      .then((registered) => {
        if (cancelled) {
          registered.revoke()
          return
        }
        handle = registered
        setSrc(registered.url)
      })
      .catch((error) => onErrorRef.current?.(error instanceof Error ? error.message : String(error)))
    return () => {
      cancelled = true
      handle?.revoke()
    }
  }, [wrappedHtml])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = parseHarnessMessage(event, iframeRef.current?.contentWindow ?? null, nonce)
      if (!data) {
        return
      }
      if (data.type === 'artifact-ready') {
        onReadyRef.current?.()
      }
      if (data.type === 'artifact-error') {
        onErrorRef.current?.(formatHarnessError(data))
      }
      if (data.type === 'artifact-selection') {
        onSelectionChangeRef.current?.(data.selection)
      }
      if (data.type === 'artifact-context') {
        onContextChangeRef.current?.(data.context)
      }
      if (data.type === 'artifact-reply') {
        pending.settle(data.id, data.result)
      }
      if (data.type === 'artifact-height' && Number.isFinite(data.height)) {
        const next = Math.min(maxAutoHeightPx, Math.max(minAutoHeightPx, Math.round(data.height)))
        // Ignore sub-pixel jitter so a self-measuring page can't oscillate.
        setContentHeight((prev) => (prev !== null && Math.abs(prev - next) <= 1 ? prev : next))
      }
      // Fork hook (Canvas Action Channel, Wire A): a sibling parse for the canvas bridge
      // script's JSON-RPC messages, gated the same way as the harness branch above (same
      // iframe, same nonce). `frame.post` below writes into the SAME iframe document via
      // postMessage — it never touches `wrappedHtml`/`src`, so the frame is never
      // re-registered or reloaded for a data update (Model B: mounted-frame updates only).
      if (onBridgeMessageRef.current) {
        const bridge = parseCanvasBridgeMessage(event, iframeRef.current?.contentWindow ?? null, nonce)
        if (bridge) {
          onBridgeMessageRef.current(bridge, {
            nonce,
            post: (m) => iframeRef.current?.contentWindow?.postMessage(m, '*'),
          })
        }
      }
    }
    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      // A caller awaiting an answer when the document reloads gets an empty one
      // rather than a promise that never settles. `srcDoc` is a dependency for
      // exactly that reason: the nonce is stable for the component's lifetime, so
      // keying only on it meant a reload never re-ran this and a query issued
      // against the old document sat until its timeout.
      pending.abortAll()
    }
  }, [nonce, srcDoc, pending])

  const style = autoHeight ? { height: contentHeight ?? defaultAutoHeightPx } : undefined
  const frameClass = cn('w-full border-0 bg-white', autoHeight ? '' : 'h-full', className)

  // While the host is registering (a fast IPC/SW round-trip), hold the frame's box so
  // the card doesn't collapse and reflow when the iframe appears.
  if (!src) {
    return <div aria-hidden style={style} className={frameClass} />
  }
  return (
    <iframe
      ref={iframeRef}
      title={title}
      sandbox={allowScripts ? 'allow-scripts' : ''}
      src={src}
      style={style}
      className={frameClass}
    />
  )
}
