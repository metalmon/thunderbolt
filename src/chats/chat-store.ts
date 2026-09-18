/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { prewarmSystemModel } from '@/ai/prewarm-system-model'
import { updateSettings } from '@/dal'
import { updateChatThread } from '@/dal/chat-threads'
import { getDb } from '@/db/database'
import type { SendResult, SessionSendQueue } from '@/fork/chat/session-send-queue'
import { type NamedMCPClient, type ReconnectClient } from '@/lib/mcp-provider'
import { trackEvent } from '@/lib/posthog'
import type { Agent } from '@/types/acp'
import type { AutomationRun, ChatThread, Model, ThunderboltUIMessage } from '@/types'
import { create } from 'zustand'
import type { Chat } from '@ai-sdk/react'
import type { PermissionOption, RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import { useShallow } from 'zustand/react/shallow'

/** Same derivation as `chat-instance.ts`'s private `ChatMessageInput` — the
 *  argument shape the AI SDK's `Chat.sendMessage` accepts for this app's
 *  message type. Re-derived here (rather than imported) because that alias
 *  isn't exported and this is the one other module that needs it: the type
 *  of the payload `ChatSession.enqueue` forwards into the send queue. */
export type ChatSendMessageInput = Parameters<Chat<ThunderboltUIMessage>['sendMessage']>[0]

/** Outstanding ACP permission request awaiting user response. The promise
 *  resolver lives here so the dialog UI can complete it via a store action;
 *  the adapter awaits the same promise inside its `requestPermission` client
 *  handler. */
export type PendingPermission = {
  agentId: string
  requestId: string
  request: RequestPermissionRequest
  resolve: (response: RequestPermissionResponse) => void
}

/** Keys a remembered allowance for this agent on the ACP tool kind. */
export const deriveToolKey = (request: RequestPermissionRequest): string => request.toolCall?.kind ?? 'unknown'

/** Finds the option used to approve a request, preferring one-time approval. */
export const findAllowOption = (options: PermissionOption[]): PermissionOption | undefined =>
  options.find((option) => option.kind === 'allow_once') ?? options.find((option) => option.kind === 'allow_always')

/** Builds the stored key for an agent-specific tool allowance. */
const getToolAllowanceKey = (agentId: string, toolKey: string): string => `${agentId}::${toolKey}`

/** Connection state for the per-agent ACP adapter. `idle` covers built-in
 *  agents (no handshake) and the initial state before the first send. */
export type ConnectionStatus = 'idle' | 'connecting' | 'ready' | 'error'

export type ChatSession = {
  chatInstance: Chat<ThunderboltUIMessage>
  chatThread: ChatThread | null
  connectionStatus: ConnectionStatus
  connectionError: Error | null
  id: string
  pendingPermission: PendingPermission | null
  retryCount: number
  retriesExhausted: boolean
  /** The user pressed Stop. Stays set until the next explicit send/regenerate so
   *  every auto-send path (the SDK's `sendAutomaticallyWhen`, `useChatAutomation`)
   *  stays suppressed — the stopped turn's trailing user message must not re-send
   *  itself. The composer derives its transient "stopping" spinner by masking this
   *  with a live request (see `getTurnActivity`), so lingering is harmless there. */
  stopping: boolean
  selectedAgent: Agent
  selectedModel: Model
  /**
   * Owning project for this chat, or null for a loose chat. Resolved at
   * hydration from the persisted `chat_threads.project_id`, or — for a brand-new
   * chat started from a project — the `?projectId=` search param. It lives on the
   * session for the same reason `selectedAgent` does: the thread row is created
   * lazily on the first message save, so the value has to survive until then or
   * the row would be written with `project_id` null.
   */
  projectId: string | null
  triggerData: AutomationRun | null
  /**
   * Fork (session turn serialization, Tasks 1-5): serializes ACP prompt
   * turns for this session so at most one is ever in flight. Populated by
   * `chat-instance` (Task 3) at hydration; undefined pre-hydration and in
   * tests that don't wire it — those sessions behave as if never busy.
   */
  sendQueue?: SessionSendQueue
  /**
   * Fork: reactive mirror of `sendQueue.isBusy()`, kept in sync via
   * `sendQueue.subscribe` (wired in Task 3). Optional — like `sendQueue` and
   * `enqueue` — because pre-existing session literals across the codebase
   * (tests, `use-hydrate-chat-store.ts`) are not required to supply it in
   * this task; `createSession` defaults it to `false` for sessions that
   * don't. Treat a missing value as `false` (not busy) at read sites.
   */
  turnInFlight?: boolean
  /**
   * Fork: the single entry point the composer (human, `queueable: false`)
   * and the canvas action channel (`queueable: true`, Task 4/5) call to
   * submit a turn through `sendQueue`. Populated alongside `sendQueue` in
   * Task 3; undefined until then.
   */
  enqueue?: (
    message: ChatSendMessageInput,
    opts: { queueable: boolean; stillValid?: () => boolean; onStart?: () => void },
  ) => SendResult
}

type ChatStoreState = {
  alwaysAllowedAgentIds: Set<string>
  alwaysAllowedAgentToolKeys: Set<string>
  currentSessionId: string | null
  getMcpClients: () => NamedMCPClient[]
  reconnectClient: ReconnectClient
  models: Model[]
  sessions: Map<string, ChatSession>
}

type ChatStoreActions = {
  allowAlwaysForAgent(agentId: string): void
  allowAlwaysForTool(agentId: string, toolKey: string): void
  createSession(session: ChatSession): void
  applyAgentWireIdentityChange(agent: Agent): void
  cancelPendingPermissionsForAgent(agentId: string): void
  isAlwaysAllowed(agentId: string, toolKey: string): boolean
  setCurrentSessionId(id: string): void
  setGetMcpClients(getMcpClients: () => NamedMCPClient[]): void
  setReconnectClient(reconnectClient: ReconnectClient): void
  setModels(models: Model[]): void
  setPendingPermission(id: string, permission: PendingPermission | null): void
  resolvePendingPermission(id: string, response: RequestPermissionResponse): void
  setSelectedAgent(id: string, agent: Agent): Promise<void>
  setSelectedModel(id: string, modelId: string | null, deps?: SetSelectedModelDeps): Promise<void>
  updateSession(id: string, session: Partial<Omit<ChatSession, 'id'>>): void
}

type SetSelectedModelDeps = {
  prewarmSystemModel?: typeof prewarmSystemModel
}

type ChatStore = ChatStoreState & ChatStoreActions

const initialState: ChatStoreState = {
  alwaysAllowedAgentIds: new Set(),
  alwaysAllowedAgentToolKeys: new Set(),
  currentSessionId: null,
  // Read fresh per send (not snapshotted) so that after a provider reconnect
  // swaps a server's client, the next send sees the new client instead of a
  // stale, closed one. Hydration replaces this with the provider's
  // `getEnabledClients` getter, which reads its live `serversRef`.
  getMcpClients: () => [],
  // Replaced by the MCP provider's `reconnectClient` on hydration. The default
  // no-op (returns null) makes `mergeMcpTools` skip a dropped server rather than
  // reconnect — correct for the pre-hydration / no-provider case.
  reconnectClient: async () => null,
  models: [],
  sessions: new Map(),
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  ...initialState,
  allowAlwaysForAgent: (agentId) => {
    set((state) => ({ alwaysAllowedAgentIds: new Set(state.alwaysAllowedAgentIds).add(agentId) }))
  },

  allowAlwaysForTool: (agentId, toolKey) => {
    set((state) => ({
      alwaysAllowedAgentToolKeys: new Set(state.alwaysAllowedAgentToolKeys).add(getToolAllowanceKey(agentId, toolKey)),
    }))
  },

  createSession: (session) => {
    const { sessions } = get()

    const nextSessions = new Map(sessions)

    if (nextSessions.has(session.id)) {
      throw new Error('Session already exists')
    }

    nextSessions.set(session.id, { ...session, turnInFlight: session.turnInFlight ?? false })

    set({ sessions: nextSessions })
  },

  applyAgentWireIdentityChange: (agent) => {
    const nextSessions = new Map(get().sessions)
    let changed = false

    for (const [id, session] of nextSessions) {
      const threadMatches = session.chatThread?.agentId === agent.id
      const agentMatches = session.selectedAgent.id === agent.id
      if (!threadMatches && !agentMatches) {
        continue
      }
      changed = true
      nextSessions.set(id, {
        ...session,
        chatThread: threadMatches ? { ...session.chatThread!, acpSessionId: null } : session.chatThread,
        selectedAgent: agentMatches ? agent : session.selectedAgent,
      })
    }

    if (changed) {
      set({ sessions: nextSessions })
    }
  },

  cancelPendingPermissionsForAgent: (agentId) => {
    const matching = [...get().sessions.entries()].filter(
      ([, session]) => session.pendingPermission?.agentId === agentId,
    )
    if (matching.length === 0) {
      return
    }

    const nextSessions = new Map(get().sessions)
    for (const [id, session] of matching) {
      nextSessions.set(id, { ...session, pendingPermission: null })
    }
    set({ sessions: nextSessions })

    const cancelled: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } }
    for (const [, session] of matching) {
      session.pendingPermission?.resolve(cancelled)
    }
  },

  setCurrentSessionId: (id) => {
    set({ currentSessionId: id })
  },

  isAlwaysAllowed: (agentId, toolKey) => {
    const { alwaysAllowedAgentIds, alwaysAllowedAgentToolKeys } = get()

    return alwaysAllowedAgentIds.has(agentId) || alwaysAllowedAgentToolKeys.has(getToolAllowanceKey(agentId, toolKey))
  },

  setGetMcpClients: (getMcpClients) => {
    set({ getMcpClients })
  },

  setReconnectClient: (reconnectClient) => {
    set({ reconnectClient })
  },

  setModels: (models) => {
    set({ models })
  },

  setPendingPermission: (id, permission) => {
    const { sessions } = get()

    const session = sessions.get(id)

    if (!session) {
      throw new Error('No session found')
    }

    const nextSessions = new Map(sessions)
    nextSessions.set(id, { ...session, pendingPermission: permission })
    set({ sessions: nextSessions })
  },

  resolvePendingPermission: (id, response) => {
    const { sessions } = get()

    const session = sessions.get(id)

    if (!session?.pendingPermission) {
      return
    }

    const { resolve } = session.pendingPermission

    const nextSessions = new Map(sessions)
    nextSessions.set(id, { ...session, pendingPermission: null })
    set({ sessions: nextSessions })

    resolve(response)
  },

  setSelectedAgent: async (id, agent) => {
    const { sessions } = get()

    const session = sessions.get(id)

    if (!session) {
      throw new Error('No session found')
    }

    const agentChanged = session.selectedAgent.id !== agent.id
    const threadPatch = agentChanged ? { agentId: agent.id, acpSessionId: null } : { agentId: agent.id }
    const nextSessions = new Map(sessions)
    const nextChatThread = session.chatThread ? { ...session.chatThread, ...threadPatch } : session.chatThread
    nextSessions.set(id, { ...session, chatThread: nextChatThread, selectedAgent: agent })

    set({ sessions: nextSessions })

    const db = getDb()

    if (session.chatThread) {
      await updateChatThread(db, session.chatThread.id, threadPatch)
    }

    // Persist the global last-used agent so new chats default to it (mirrors
    // `setSelectedModel`). The per-thread write above keeps existing chats
    // pinned to their own agent.
    await updateSettings(db, { selected_agent: agent.id })

    trackEvent('agent_select', { agent: agent.id })
  },

  setSelectedModel: async (id, modelId, deps = {}) => {
    const { models, sessions } = get()

    const model = models.find((m) => m.id === modelId)

    if (!model) {
      throw new Error('Model not found')
    }

    const session = sessions.get(id)

    if (!session) {
      throw new Error('No session found')
    }

    const nextSessions = new Map(sessions)
    nextSessions.set(id, { ...session, selectedModel: model })

    set({ sessions: nextSessions })

    // Fire-and-forget: the wrapper no-ops (before any dynamic import) unless
    // this is a Tinfoil system model, so the first send finds a warm client.
    void (deps.prewarmSystemModel ?? prewarmSystemModel)(model)

    const db = getDb()
    await updateSettings(db, { selected_model: model.id })

    trackEvent('model_select', { model: model.id })
  },

  updateSession: (id, session) => {
    const { sessions } = get()

    const existingSession = sessions.get(id)

    if (!existingSession) {
      throw new Error('No session found')
    }

    const nextSessions = new Map(sessions)
    nextSessions.set(id, { ...existingSession, ...session })
    set({ sessions: nextSessions })
  },
}))

/**
 * Returns the current chat session, throwing if none exists.
 *
 * Use this hook in components/hooks that fundamentally require an active session to function
 * (e.g., chat UI, message handlers). The throw ensures these components never render in an
 * invalid state.
 *
 * For components where a session is optional and they can still function without one
 * (e.g., Header, ChatListItem, useHandleIntegrationCompletion), access the store directly
 * with optional chaining: `state.sessions.get(state.currentSessionId ?? '')?.someProperty`
 */
export const useCurrentChatSession = () => {
  const session = useChatStore(useShallow((state) => state.sessions.get(state.currentSessionId ?? '')))

  if (!session) {
    throw new Error('No chat session found')
  }

  return session
}
