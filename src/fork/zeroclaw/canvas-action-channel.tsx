/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

/**
 * Canvas Action Channel — controller.
 *
 * Receives Wire A JSON-RPC messages (`./canvas-bridge-protocol`) from the
 * `ui://` canvas iframe (routed here by `SandboxedHtmlFrame.onBridgeMessage`,
 * see `src/components/artifact/sandboxed-html-frame.tsx`), proxies
 * `tools/call` / `ui/prompt` as ordinary chat turns on the ACTIVE chat
 * session, and resolves the resulting pending calls by observing that
 * session's messages for the matching tool part (`./canvas-pending`).
 *
 * There is exactly one active `Chat` instance at a time, held in the global
 * `useChatStore` (`src/chats/chat-store.ts`) — NOT the per-tree
 * `useCanvasRegistry` context, which only exists inside the transcript
 * subtree and is unreachable from here. `computeLatestByUri` (a pure
 * function exported by `./canvas-registry`) is reused instead to recover the
 * `uri` of the artifact currently shown in the side panel.
 */

import { useChatStore } from '@/chats/chat-store'
import { useContentView } from '@/content-view/context'
import { useAllAgents } from '@/dal'
import type { ThunderboltUIMessage } from '@/types'
import { useChat, type UseChatOptions } from '@ai-sdk/react'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { buildCanvasActionMessage } from './canvas-action-message'
import { composeCanvasCallId } from './canvas-call-id'
import { buildJsonRpcError, buildJsonRpcResult } from './canvas-bridge-host'
import { CANVAS_BRIDGE_METHODS, type JsonRpcNotification, type JsonRpcRequest } from './canvas-bridge-protocol'
import { CANVAS_JSONRPC_ERRORS, classifyCanvasRequest } from './canvas-errors'
import { createNonceRateLimiter, findResolvedPending, type PendingCall } from './canvas-pending'
import { computeLatestByUri } from './canvas-registry'

/** Wire A protocol version this host implements (MCP Apps / SEP-1865). Bump if the wire shape changes. */
const canvasProtocolVersion = '2025-06-18'

/** Rate limit applied per-nonce (one live canvas frame) to `tools/call`. */
const rateLimitCalls = 10
const rateLimitWindowMs = 10_000

/** The resolved theme classes `ThemeProvider` ever puts on `document.documentElement`. */
type ResolvedThemeClass = 'light' | 'dark' | 'paper'

/**
 * Read the theme actually applied to `document.documentElement`, mirroring
 * `SandboxedHtmlFrame`'s own local helper of the same name (spec §6) — kept
 * as a small duplicate here rather than importing a private implementation
 * detail of that component.
 */
const readResolvedThemeClass = (): ResolvedThemeClass => {
  const root = document.documentElement
  return root.classList.contains('dark') ? 'dark' : root.classList.contains('paper') ? 'paper' : 'light'
}

/** A JSON-RPC request carries `id`; a notification does not. */
const isJsonRpcRequest = (msg: JsonRpcRequest | JsonRpcNotification): msg is JsonRpcRequest => 'id' in msg

/** Narrow an untyped `params` bag to a `tools/call` name/arguments/prompt shape. */
const readToolsCallParams = (
  params: Record<string, unknown> | undefined,
): { name: string; arguments?: Record<string, unknown>; prompt?: string } => ({
  name: typeof params?.name === 'string' ? params.name : '',
  arguments:
    typeof params?.arguments === 'object' && params.arguments !== null
      ? (params.arguments as Record<string, unknown>)
      : undefined,
  prompt: typeof params?.prompt === 'string' ? params.prompt : undefined,
})

/** Narrow an untyped `params` bag to a `ui/prompt` prompt string. */
const readPromptParam = (params: Record<string, unknown> | undefined): string | undefined =>
  typeof params?.prompt === 'string' ? params.prompt : undefined

/** A pending call's resolution target: the JSON-RPC id to reply with, and the frame to post it into. */
type Resolver = { jsonRpcId: string | number; post: (m: unknown) => void }

type CanvasActionChannelValue = {
  /** Pass as `SandboxedHtmlFrame.onBridgeMessage` for the panel showing the active `ui://` artifact. */
  handleBridgeMessage: (
    msg: JsonRpcRequest | JsonRpcNotification,
    frame: { nonce: string; post: (m: unknown) => void },
  ) => void
  /** Pass as `SandboxedHtmlFrame.nonceRef` so the controller learns the live frame's nonce. */
  nonceRef: (nonce: string) => void
  /**
   * Whether the currently-open `ui://` canvas is a read-only snapshot: it was
   * emitted by an agent that is no longer the thread's selected agent (agent-
   * switch gate, see `./canvas-emitting-agent`). `false` for a legacy
   * (pre-stamp) canvas or when there is no open canvas.
   */
  isReadOnly: boolean
  /** Display name of the agent that emitted the open canvas, when resolvable. Null when unknown or not read-only. */
  emittingAgentName: string | null
}

const CanvasActionChannelContext = createContext<CanvasActionChannelValue | undefined>(undefined)

/**
 * Reject every currently-tracked pending call whose nonce is `nonce`, via its
 * stashed resolver, then drop it from `resolversRef`. Shared by the F1
 * no-hang path and the F7 stale-frame cancellation path.
 */
const rejectPendingWithNonce = (
  pending: PendingCall[],
  nonce: string,
  resolversRef: { current: Map<string, Resolver> },
  message: string,
): PendingCall[] => {
  const [stale, live] = [pending.filter((p) => p.nonce === nonce), pending.filter((p) => p.nonce !== nonce)]
  for (const call of stale) {
    const resolver = resolversRef.current.get(call.callId)
    resolver?.post(buildJsonRpcError(resolver.jsonRpcId, CANVAS_JSONRPC_ERRORS.TOOL_FAILED.code, message))
    resolversRef.current.delete(call.callId)
  }
  return live
}

/**
 * Mounts the Canvas Action Channel controller for the active chat session.
 * Wraps the layout region that contains both the chat transcript and the
 * artifact side panel (`src/layout/main-layout.tsx`) so both the active
 * `Chat` instance (via the global chat store) and the content-view state
 * (via `useContentView`) are in scope. No-ops when there is no active chat
 * session (off-chat routes, e.g. Settings) — `handleBridgeMessage` simply
 * ignores every message in that case.
 */
export const CanvasActionChannelProvider = ({ children }: { children: ReactNode }) => {
  const chatInstance = useChatStore((s) => s.sessions.get(s.currentSessionId ?? '')?.chatInstance)
  const threadId = useChatStore((s) => s.currentSessionId) ?? ''
  const selectedAgentId = useChatStore((s) => s.sessions.get(s.currentSessionId ?? '')?.selectedAgent.id) ?? null
  const { state } = useContentView()
  const activeArtifactId = state.type === 'artifact' ? state.data.artifactId : null

  // `chat` only appears in the options object when a session is active, so `useChat` falls back to
  // its own throwaway default Chat instance otherwise (see @ai-sdk/react's `"chat" in options` check) —
  // never recreated on every render, and never used, since `handleBridgeMessage` no-ops below.
  const chatOptions: UseChatOptions<ThunderboltUIMessage> = chatInstance ? { chat: chatInstance } : {}
  const { sendMessage, messages, status } = useChat(chatOptions)

  // Agent-switch read-only snapshot (Task 9): the active canvas is bound to the `Agent.id` that
  // emitted it. `null` emittingAgentId means a legacy (pre-stamp) message — always allowed.
  const activeCanvasRef = useMemo(
    () => resolveActiveCanvasRef(messages, threadId, activeArtifactId),
    [messages, threadId, activeArtifactId],
  )
  const isReadOnly =
    activeCanvasRef !== null &&
    activeCanvasRef.emittingAgentId !== null &&
    activeCanvasRef.emittingAgentId !== selectedAgentId
  const allAgents = useAllAgents()
  const emittingAgentName = isReadOnly
    ? (allAgents.find((agent) => agent.id === activeCanvasRef?.emittingAgentId)?.name ?? null)
    : null

  const [pending, setPending] = useState<PendingCall[]>([])
  const resolversRef = useRef(new Map<string, Resolver>())
  const limiterRef = useRef(createNonceRateLimiter(rateLimitCalls, rateLimitWindowMs))
  const liveNonceRef = useRef<string | null>(null)

  // External-store-driven resolution: whenever the transcript changes, check whether any pending
  // canvas tool call now has a matching completed tool part, and reply into that call's frame.
  useEffect(() => {
    if (pending.length === 0) {
      return
    }
    const resolved = findResolvedPending(messages, pending)
    if (resolved.length === 0) {
      return
    }
    const resolvedCallIds = new Set<string>()
    for (const { pending: call, output, failed } of resolved) {
      resolvedCallIds.add(call.callId)
      const resolver = resolversRef.current.get(call.callId)
      if (!resolver) {
        continue
      }
      if (failed) {
        resolver.post(
          buildJsonRpcError(
            resolver.jsonRpcId,
            CANVAS_JSONRPC_ERRORS.TOOL_FAILED.code,
            CANVAS_JSONRPC_ERRORS.TOOL_FAILED.message,
          ),
        )
      } else {
        // App-initiated call: the result rides the `tools/call` response only. `ui/notifications/
        // tool-result` (spec §214-216) is reserved for MODEL-initiated tool calls, which have no
        // pending JSON-RPC request of their own to reply to.
        resolver.post(buildJsonRpcResult(resolver.jsonRpcId, output))
      }
      resolversRef.current.delete(call.callId)
    }
    setPending((prev) => prev.filter((p) => !resolvedCallIds.has(p.callId)))
  }, [messages, pending])

  // F1 no-hang: a turn that settles (streaming/submitted -> ready/error) without ever producing a
  // matching tool part for one of its pending calls must not leave the canvas waiting forever.
  // Re-derives resolution from `messages` rather than trusting `pending` alone, so this can't race
  // the resolution effect above within the same commit.
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prevStatus = prevStatusRef.current
    prevStatusRef.current = status
    const wasActive = prevStatus === 'submitted' || prevStatus === 'streaming'
    const nowSettled = status === 'ready' || status === 'error'
    if (!wasActive || !nowSettled || pending.length === 0) {
      return
    }
    const resolvedCallIds = new Set(findResolvedPending(messages, pending).map((r) => r.pending.callId))
    const unresolved = pending.filter((p) => !resolvedCallIds.has(p.callId))
    if (unresolved.length === 0) {
      return
    }
    for (const call of unresolved) {
      const resolver = resolversRef.current.get(call.callId)
      resolver?.post(buildJsonRpcError(resolver.jsonRpcId, CANVAS_JSONRPC_ERRORS.TOOL_FAILED.code, 'no result'))
      resolversRef.current.delete(call.callId)
    }
    setPending((prev) => prev.filter((p) => resolvedCallIds.has(p.callId)))
  }, [status, messages, pending])

  // F7: a new nonce for the same controller means the previous canvas frame is gone (reload/
  // remount) — any call still awaiting that frame can never be answered, so reject it now instead
  // of waiting for the no-hang fallback above.
  const nonceRef = useCallback((nonce: string) => {
    const prevNonce = liveNonceRef.current
    liveNonceRef.current = nonce
    if (prevNonce === null || prevNonce === nonce) {
      return
    }
    setPending((prev) => rejectPendingWithNonce(prev, prevNonce, resolversRef, 'canvas frame reloaded'))
  }, [])

  const handleBridgeMessage = (
    msg: JsonRpcRequest | JsonRpcNotification,
    frame: { nonce: string; post: (m: unknown) => void },
  ) => {
    if (!chatInstance) {
      return
    }

    // A turn is mid-flight on the active Chat. `ui/initialize` (below) only posts a synchronous
    // reply and is always safe; the two send paths (`tools/call`, `ui/prompt`) must not start a
    // second `makeRequest` on top of it — see the BUSY rejection in each branch.
    const isTurnActive = status === 'submitted' || status === 'streaming'

    if (msg.method === CANVAS_BRIDGE_METHODS.UI_INITIALIZE) {
      if (!isJsonRpcRequest(msg)) {
        return
      }
      frame.post(
        buildJsonRpcResult(msg.id, {
          protocolVersion: canvasProtocolVersion,
          hostCapabilities: {},
          hostInfo: { name: 'Volt', version: '1' },
          hostContext: { theme: readResolvedThemeClass(), readOnly: isReadOnly },
        }),
      )
      return
    }

    if (msg.method === CANVAS_BRIDGE_METHODS.TOOLS_CALL) {
      if (!isJsonRpcRequest(msg)) {
        return
      }
      // Serialize sends: proxying a canvas action calls `sendMessage`, which starts a `makeRequest`
      // on the one active `Chat`. Doing that while a turn is still streaming re-enters `makeRequest`
      // and clobbers its single `activeResponse` slot (`Cannot read properties of undefined (reading
      // 'state')`). An app that retries a hung `tools/call` mid-turn hits exactly this. Reject with a
      // retryable BUSY instead — checked before the rate limiter so a busy reject costs no budget.
      if (isTurnActive) {
        frame.post(buildJsonRpcError(msg.id, CANVAS_JSONRPC_ERRORS.BUSY.code, CANVAS_JSONRPC_ERRORS.BUSY.message))
        return
      }
      // Gate order matters here: no-canvas and read-only are checked BEFORE the rate limiter is
      // invoked, so a request that would be rejected on either of those never consumes rate-limit
      // budget. `limiterRef.current.allow(...)` has a side effect (it consumes a token), so it's
      // only called once both earlier gates have passed — `rateAllowed` is never read by
      // `classifyCanvasRequest` unless that's the case (see its priority-order doc comment).
      const hasCanvas = activeCanvasRef !== null
      const isReadOnlyNow =
        hasCanvas && activeCanvasRef.emittingAgentId !== null && activeCanvasRef.emittingAgentId !== selectedAgentId
      const rateAllowed = hasCanvas && !isReadOnlyNow ? limiterRef.current.allow(frame.nonce, performance.now()) : false
      const params = readToolsCallParams(msg.params)
      const decision = classifyCanvasRequest({
        hasCanvas,
        isReadOnly: isReadOnlyNow,
        rateAllowed,
        hasToolName: !!params.name,
      })
      if (decision.kind === 'reject') {
        frame.post(buildJsonRpcError(msg.id, decision.error.code, decision.error.message))
        return
      }
      // `decision.kind === 'proceed'` implies `hasCanvas` was true, so `activeCanvasRef` is non-null
      // here — but that invariant isn't visible to the type checker through the boolean.
      const uri = activeCanvasRef!.uri
      const callId = composeCanvasCallId(frame.nonce, String(msg.id))
      resolversRef.current.set(callId, { jsonRpcId: msg.id, post: frame.post })
      setPending((prev) => [...prev, { callId, nonce: frame.nonce, jsonRpcId: msg.id }])
      void sendMessage(
        buildCanvasActionMessage({
          toolCall: { name: params.name, arguments: params.arguments },
          prompt: params.prompt,
          uri,
          callId,
        }),
      )
      return
    }

    if (msg.method === CANVAS_BRIDGE_METHODS.UI_PROMPT) {
      const prompt = readPromptParam(msg.params)
      if (activeCanvasRef === null || !prompt) {
        return
      }
      // Same serialization guard as `tools/call`: `ui/prompt` also calls `sendMessage`, so starting
      // it mid-turn would re-enter `makeRequest`. It's a fire-and-forget notification (no id to
      // reply to), so a busy host drops it silently — the app owns retry timing.
      if (isTurnActive) {
        if (isJsonRpcRequest(msg)) {
          frame.post(buildJsonRpcError(msg.id, CANVAS_JSONRPC_ERRORS.BUSY.code, CANVAS_JSONRPC_ERRORS.BUSY.message))
        }
        return
      }
      // `ui/prompt` is fire-and-forget: it has no rate limit to gate lazily, so unlike `tools/call`
      // above there's no budget-consumption ordering concern here. `hasCanvas`/`hasToolName` are
      // passed `true` (both already established above), so this can only reject via `isReadOnly`.
      const isReadOnlyNow =
        activeCanvasRef.emittingAgentId !== null && activeCanvasRef.emittingAgentId !== selectedAgentId
      const decision = classifyCanvasRequest({
        hasCanvas: true,
        isReadOnly: isReadOnlyNow,
        rateAllowed: true,
        hasToolName: true,
      })
      if (decision.kind === 'reject') {
        // Notifications (no `id`) have no JSON-RPC id to reply to — drop silently, same as the
        // no-active-canvas/no-prompt cases above.
        if (isJsonRpcRequest(msg)) {
          frame.post(buildJsonRpcError(msg.id, decision.error.code, decision.error.message))
        }
        return
      }
      const uri = activeCanvasRef.uri
      const idPart = isJsonRpcRequest(msg) ? String(msg.id) : String(Date.now())
      void sendMessage(
        buildCanvasActionMessage({ prompt, uri, callId: composeCanvasCallId(frame.nonce, `prompt-${idPart}`) }),
      )
    }
  }

  const value = useMemo<CanvasActionChannelValue>(
    () => ({ handleBridgeMessage, nonceRef, isReadOnly, emittingAgentName }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleBridgeMessage intentionally recreated every render (fresh closures over messages/state/sendMessage); consumers stash it in a ref, so identity churn is harmless.
    [
      nonceRef,
      messages,
      status,
      threadId,
      activeArtifactId,
      sendMessage,
      chatInstance,
      selectedAgentId,
      isReadOnly,
      emittingAgentName,
    ],
  )

  return <CanvasActionChannelContext.Provider value={value}>{children}</CanvasActionChannelContext.Provider>
}

/**
 * Recover the `ui://` uri (and its emitting agent) of the currently-open
 * artifact from the transcript, or null if none is open. The emitting agent
 * id backs the Task 9 read-only snapshot gate below.
 */
const resolveActiveCanvasRef = (
  messages: ThunderboltUIMessage[],
  threadId: string,
  activeArtifactId: string | null,
): { uri: string; emittingAgentId: string | null } | null => {
  if (activeArtifactId === null) {
    return null
  }
  const latestByUri = computeLatestByUri(messages, threadId)
  for (const [uri, ref] of latestByUri) {
    if (ref.artifactId === activeArtifactId) {
      return { uri, emittingAgentId: ref.emittingAgentId }
    }
  }
  return null
}

/**
 * Access the Canvas Action Channel controller. Must be used within a
 * {@link CanvasActionChannelProvider} (mounted once in `main-layout.tsx`).
 */
export const useCanvasActionChannel = (): CanvasActionChannelValue => {
  const ctx = useContext(CanvasActionChannelContext)
  if (ctx === undefined) {
    throw new Error('useCanvasActionChannel must be used within a CanvasActionChannelProvider')
  }
  return ctx
}
