# Design: Bearer token for custom ACP agents (local-only, upstream-aligned)

**Date:** 2026-08-15
**Status:** Approved for planning (Approach B — local-only, builds on upstream scaffolding)
**Author:** fork maintenance (metalmon/thunderbolt)
**License surface:** thin invasive hooks in upstream files (form / transport / connect) + one additive helper in `src/fork/**` + locale strings.

## 1. Problem

When a user adds a custom `remote-acp` agent (e.g. a self-hosted **zeroclaw**
gateway), the only place to put the access token today is **inside the agent
URL** as a `?token=…` query parameter. That leaks via access logs / `Referer` /
proxy logs, rides in a synced field, and is shown in the URL box forever.

We want a dedicated token field that is delivered to the agent as a **bearer**
(not in the URL) and stored as a **write-only** credential.

## 2. Key finding — this is an upstream feature; align with it

`agents_secrets` (`api_key`, `auth_method`), its DAL (`getAgentSecrets` /
`setAgentSecrets`), and tests already exist **in `origin/main`** (upstream).
Upstream documents the intent in `docs/architecture/export-format.md`:

> `agents_secrets` — **API keys for user-created ACP agents.** … **Local-only
> tables stay local on import** … importing on a different device **expects the
> user to re-enter the keys per device.**

So the "credentials never leave the device" posture is a **deliberate,
documented** upstream policy shared by the whole `*_secrets` family
(`models_secrets`, `mcp_secrets`, `agents_secrets`). Credentials never reach the
backend at all — stronger than E2E-encrypted sync (no ciphertext, no metadata
server-side). The `auth_method` column (`'bearer' | 'oauth'`) is **dormant
scaffolding for exactly this feature** — upstream carved the seam but has not
wired it to the transport.

**Roadmap check (2026-08-15):** the scaffolding has been dormant since
~2026-07-10 with **zero consumers** of `getAgentSecrets` anywhere in
`origin/main` (HEAD 2026-08-13), and there is **no open upstream PR/issue** that
wires `agents_secrets`/`auth_method` into remote-acp bearer auth. (The adjacent
draft #967 is *managed-acp* GitHub-token provisioning — a different auth model.)

**Consequence:** we finish upstream's dormant seam in upstream's shape. No
cross-device sync (that is upstream's intended behaviour). If upstream later
ships its own wiring, our stored data already matches their schema and only one
thin transport hook needs to yield to theirs.

## 3. Decision

- **Storage:** upstream's local-only `agents_secrets`. A bearer token is stored
  as `{ apiKey: <token>, authMethod: 'bearer' }`. No schema change, no
  encryption-map change, no backend change.
- **UI:** optional write-only "Access token" field on the add/edit agent form;
  a populated indicator on edit; value never read back.
- **Transport:** for `remote-acp`, read the secret at connect time and, when
  `authMethod === 'bearer'`, carry the token as a `bearer.<token>` subprotocol.
- **No sync** (per-device entry) — accepted, matches upstream policy.

**Non-goals:** no change to `managed-acp`; no OAuth path (leave `authMethod`
open for upstream's future `'oauth'`); no auto-migration of existing `?token=`
URLs (they keep working — §8).

## 4. Verified facts about the wire (why this works unchanged)

### 4.1 zeroclaw accepts a bearer three ways

`E:/zeroclaw/crates/zeroclaw-gateway/src/ws.rs` → `extract_ws_token()`
(lines 86–120), precedence order:

1. `Authorization: Bearer <token>` header
2. `Sec-WebSocket-Protocol: bearer.<token>` subprotocol (prefix `bearer.`)
3. `?token=<token>` query parameter

Auth is enforced only when the gateway requires pairing
(`state.pairing.require_pairing()`, `ws.rs:134`); the token is hashed to a
stable subject `ws:<hash>`. When pairing is off, the token is ignored (harmless).

### 4.2 Browsers/WebView cannot set `Authorization` on `new WebSocket()`

The only handshake-time channel available is `Sec-WebSocket-Protocol`. The fork
already relies on this for `managed-acp`
(`src/acp/transports/index.ts:131-140`) and the universal proxy
(`src/lib/proxy-fetch.ts:218-243`). So the client carries the zeroclaw token as
the **`bearer.<token>`** subprotocol entry.

> **Prefix note.** `thunderbolt.bearer.<token>` is consumed by the Thunderbolt
> **cloud backend** to authenticate the *Thunderbolt* login — a different server
> and credential. zeroclaw expects the bare `bearer.` prefix. They never collide.
> Do not unify the two prefixes.

### 4.3 The universal proxy forwards the entry to the upstream

`backend/src/proxy/ws.ts` → `parseTargetSubprotocol()` (line 86) strips only
`tbproxy.*` and `thunderbolt.*`; every other offered subprotocol stays in
`callerProtocols` and is passed to `new WebSocket(targetUrl, callerProtocols)`
(lines 199, 228). So `bearer.<token>` survives the proxy hop and reaches
zeroclaw. Works on both the proxied and native paths.

### 4.4 zeroclaw token is subprotocol-safe as-is

`E:/zeroclaw/crates/zeroclaw-config/src/pairing.rs:299` mints the token as
`format!("zc_{}", hex::encode(bytes))` → `zc_<64 lowercase hex>`. Charset
`z c _ 0-9 a-f` is all valid RFC 6455 subprotocol tokens (`_` is a `tchar`).
zeroclaw does a plain `strip_prefix("bearer.")` with **no** base64url decode, so
we send `bearer.<token>` verbatim — no encoding, no zeroclaw change.

> The 6-digit `generate_code()` value is the one-time **pairing code**, not the
> bearer. The user pastes the resulting `zc_…` token.

## 5. Transport delivery matrix

| Path | Constructor | Carries token |
|---|---|---|
| Native standalone (Tauri, proxy OFF) | `new WebSocket(url, ['zeroclaw.v1','bearer.<token>'])` direct to zeroclaw | subprotocol |
| Proxied (web always; Tauri proxy ON) | append `bearer.<token>` to `protocols` handed to `createProxyWebSocket` → proxy forwards | subprotocol |

Offering `zeroclaw.v1` alongside the bearer on the native path lets zeroclaw
echo a selected subprotocol (`ws.rs:150-159`). When no token is configured,
behaviour is byte-for-byte unchanged (`new WebSocket(url)` / current proxy
protocols).

## 6. Storage — reuse upstream `agents_secrets` (local-only)

Table (`src/db/tables.ts:315`, unchanged):

```ts
export const agentsSecretsTable = sqliteTable('agents_secrets', {
  agentId: text('id').primaryKey(), // = agents.id
  apiKey: text('api_key'),
  authMethod: text('auth_method'),  // 'bearer' | 'oauth' (we set 'bearer')
})
```

- Local-only (`src/db/powersync/schema.ts:49`, `localOnly: true`) — never
  synced, never uploaded. No backend change, no encryption-map change.
- DAL exists (`src/dal/agents.ts:227,240`): `getAgentSecrets(db, id)` →
  `{ apiKey, authMethod } | null`; `setAgentSecrets(db, id, partial)` upserts.
- A bearer token is `{ apiKey: token, authMethod: 'bearer' }`. Clearing =
  `setAgentSecrets(db, id, { apiKey: null, authMethod: null })`.

## 7. UI — add/edit custom agent form

Files: `src/components/settings/agents/add-custom-agent-form.tsx`,
`create-agent-detail-panel.tsx`, and the edit surface (`agent-detail`).

- New **optional** field "Access token" (`agents.authToken*` i18n keys) beneath
  the URL field. `type="password"`, `autoComplete="off"`.
- **Reducer:** extend `AgentFormState`/`AgentFormAction` with `authToken` +
  `{ type: 'TOKEN_CHANGED'; value: string }`. Stay on the existing `useReducer`
  (no new `useState`).
- **Payload:** `AddCustomAgentPayload` gains `authToken: string | null`
  (trimmed; `null` when empty). The panel's `handleAdd`:
  1. `createAgent(db, { …existing fields… })` (unchanged).
  2. if `authToken` is non-null: `setAgentSecrets(db, id, { apiKey: authToken,
     authMethod: 'bearer' })`.
- **Write-only semantics:**
  - Create: field holds the plaintext the user types.
  - Edit: field renders **empty** with a populated indicator
    (`getAgentSecrets(db,id)?.apiKey != null`) — mirrors zeroclaw's own
    `SecretResponse { populated }` model. Empty on save = keep existing; a typed
    value = replace; an explicit "Clear token" affordance sets `apiKey: null`.
  - The stored token is **never** read back into the input.
- **Test connection:** `testAcpConnection` accepts the token from form state
  (not the DB — it may be unsaved) and opens its probe with the same
  `bearer.<token>` subprotocol so it tests the real auth path.
- **No E2EE hint needed** (nothing syncs). Optionally a muted note: "Stored only
  on this device — re-enter on other devices" to set expectations.

## 8. Wiring — from stored secret to transport

The token lives in a local-only table, so it is read at **connect time** (not
carried on the synced `Agent` row).

1. `openTransport` inputs gain `agentAuthToken?: string | null`
   (`OpenTransportInputs` in `src/acp/transports/index.ts`). `remote-acp`
   branch of `resolveWebSocketFactory`:
   - native: `new WebSocket(url, buildAgentSubprotocols(token))`
   - proxied: pass `buildAgentSubprotocols(token)` as the `protocols` arg to the
     `createProxyWebSocket` factory.
2. `buildAgentSubprotocols(token: string | null): string[] | undefined` —
   returns `['zeroclaw.v1', 'bearer.' + token]` when a non-empty token is
   present, else `undefined` (unchanged behaviour). **New additive file:**
   `src/fork/agent-bearer/subprotocols.ts` + colocated test.
3. `connectAcpAdapter` / `connectToAgent` (`src/acp/connect.ts`,
   `acp-adapter.ts`) resolve the secret before opening the transport:
   `const secret = await getAgentSecrets(getDb(), agent.id)` and pass
   `secret?.authMethod === 'bearer' ? secret.apiKey : null` as
   `agentAuthToken`. Only for `remote-acp` (managed-acp keeps its own bearer).
4. **Cleanup:** extend upstream `deleteAgent` to also clear the local secret
   (`setAgentSecrets(db, id, { apiKey: null, authMethod: null })`) so a deleted
   agent leaves no dead credential on the device.

**Prefix:** `buildAgentSubprotocols` emits the bare `bearer.` prefix (zeroclaw's
contract), intentionally distinct from `wsBearerSubprotocolPrefix`
(`thunderbolt.bearer.`, Thunderbolt cloud). Do not unify them.

## 9. Backward compatibility

- Agents that already embed `?token=` in the URL **keep working** — the URL is
  untouched and zeroclaw reads the query param (precedence #3). If both a URL
  token and a stored bearer are present, zeroclaw prefers the bearer
  (precedence #2 > #3) — a clean upgrade path with no data migration.
- No auto-migration. Optional follow-up: the edit form can detect a `?token=` in
  the URL and offer a one-click "move to token field". Out of scope for v1.

## 10. Security considerations

- Token never enters the URL, `Referer`, or default request logs — it rides the
  subprotocol header (not logged by default).
- Credential is **local-only**: never uploaded to the backend in any form.
- Input is `type="password"`, write-only; value never echoed to the DOM after
  save.
- `WebSocket.protocol` never exposes the bearer entry (zeroclaw echoes only
  `zeroclaw.v1`; the proxy never echoes caller bearer entries).
- Cleared on agent delete (§8.4) — no dead credential lingers on the device.

## 11. Testing plan

- **Unit — `buildAgentSubprotocols`:** token present → `['zeroclaw.v1',
  'bearer.<t>']`; empty/null → `undefined`; passthrough (no encoding); `zc_…`
  charset survives verbatim.
- **Unit — transport factory:** native and proxied `remote-acp` branches pass
  the subprotocols; **no-token path is byte-identical to current output**
  (regression guard); `managed-acp` path unchanged.
- **Unit — form reducer:** `TOKEN_CHANGED`; create-with-token calls
  `setAgentSecrets({apiKey, authMethod:'bearer'})`; edit keeps existing on empty;
  clear sets `apiKey:null`; populated indicator reflects `getAgentSecrets`.
- **Unit — DAL (already covered upstream):** add a case asserting the
  `{apiKey, authMethod:'bearer'}` round-trip used by the form; delete clears it.
- **Unit — connect:** `remote-acp` with a stored bearer passes `agentAuthToken`
  to `openTransport`; without a secret passes `null`; `authMethod:'oauth'`
  passes `null` (not yet supported).
- **Integration — test-connection:** probe uses the bearer subprotocol.
- **Manual gates:** (1) real zeroclaw, pairing required — bearer auth succeeds,
  wrong token → `UNAUTHORIZED`; (2) web/proxied path reaches zeroclaw with the
  bearer; (3) second device — agent syncs (row) but token is absent until
  re-entered (confirms local-only posture).

## 12. Touch-point summary

| File | Change | Surface |
|---|---|---|
| `src/db/tables.ts` | none (reuse `agents_secrets`) | — |
| `src/db/powersync/schema.ts` | none (stays local-only) | — |
| backend | none | — |
| `src/fork/agent-bearer/subprotocols.ts` (new) | `buildAgentSubprotocols` + test | **additive** |
| `src/acp/transports/index.ts` | `agentAuthToken` input + `remote-acp` subprotocol branch (native + proxied) | invasive (thin) |
| `src/acp/connect.ts`, `acp-adapter.ts` | resolve secret, pass `agentAuthToken` | invasive (thin) |
| `src/dal/agents.ts` | `deleteAgent` clears the secret | invasive (thin) |
| `src/components/settings/agents/add-custom-agent-form.tsx` | token field + reducer + payload | invasive |
| `create-agent-detail-panel.tsx` / edit surface | call `setAgentSecrets`, populated indicator | invasive |
| locale catalogs (`fork/i18n-locales`) | `agents.authToken*` (RU/EN) | additive (fork IP) |

## 13. Open questions (resolved)

- **Is this a fork or upstream feature?** Upstream — `agents_secrets` + DAL +
  tests are in `origin/main`, documented local-only (§2).
- **Will upstream wire it themselves soon?** No sign — dormant 5+ weeks, zero
  consumers, no targeting PR/issue (§2 roadmap check). Safe to finish now.
- **Sync vs local-only?** Local-only, per upstream policy and user decision (§3).
- **Does zeroclaw accept a bearer / need encoding / survive the proxy?** Yes /
  no / yes (§4).
- **Hide in UI?** Write-only field + populated indicator (§7).
