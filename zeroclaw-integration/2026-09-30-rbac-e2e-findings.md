# Connect-by-code + RBAC — E2E findings against a live Volt pilot (2026-09-30)

Handoff for the Thunderbolt/Volt client agent. We ran a full connect-by-code +
per-principal RBAC test from THIS client against a live Volt (Volt) pilot
(the enterprise F4 authz build) and it **works end-to-end** — but the test
surfaced the issues below. The Volt protocol/server side is solid; every
item is client UX / transport / deployment, not a protocol gap. Prioritized:
#1 (test-connection gate) is the remaining client-side blocker; #2 (the
"handshake was canceled") was the server requesting a client cert on wss and is
now FIXED SERVER-SIDE — no client workaround needed; #3 is a stale comment;
#4 is a clarification that corrects an earlier mis-diagnosis about the proxy.

## What was verified working (do NOT "fix" these)

- **Pairing-over-ACP** (`src/fork/agent-pairing/pair-over-acp.ts`): open a
  pre-auth WS to `/acp` (carrier-only subprotocols, no bearer), try `volt/pair
  {code}` first → this pilot's runtime refuses it with a JSON-RPC error whose
  `data.reason` is `"pair_first"` (observed `code: -32010`) → `isMethodUnknown`
  (`:53`, keys on `data.reason === 'pair_first'` OR `code === -32601`) falls
  back once to `zeroclaw/pair {code}` → `{ token }`. Works. A **pre-bound** code
  (minted on the pilot as `?principal=<id>`) binds the token to that principal
  **server-side** — the client only receives `{ token }` (`PairResult` =
  `{ token; agents? }`), the binding lives in the runtime, no pending step.
- **Carrier subprotocols match**: client offers `['volt.acp.v1',
  'zeroclaw.acp.v1', 'bearer.<token>']`; server echoes `volt.acp.v1`. Good.
- **RBAC enforcement** (server-side): principal `alice` (role allows only
  `crm_bot`) → chat with `crm_bot` works; chat with `payroll-bot` →
  `-32602 "Agent \`payroll-bot\` is not permitted for this principal"`,
  `data.reason = "agent_not_permitted"`. Deny-by-default (a principal with no
  role) → the `/acp` upgrade itself is refused with **HTTP 401** at connect.

## Issues to fix (prioritized)

### 1. HIGH — "Test connection" doesn't validate per-agent access
`src/acp/connection-test.ts` runs only the ACP `initialize` handshake — "the
probe never drives a session" (`:31`, `:111`). But Volt's per-AGENT gate is
enforced at **`session/new`**, not at connect/initialize. Connect + initialize
is *principal-level* (does the principal have ANY agents), so the test PASSES
for an agent the principal cannot actually use.

Observed: paired as `alice` (role = `crm_bot` only), "test connection" on a
`payroll-bot` agent row → **success**; first chat → `agent_not_permitted`.

Fix: after `initialize`, the connection test should attempt a `session/new` for
the target agent alias (then immediately cancel/close the session) so
`agent_not_permitted` surfaces at test time instead of on the first message.
Report that specific error as a distinct "not permitted for your account"
result, separate from a transport failure.

### 2. RESOLVED SERVER-SIDE — "handshake was canceled" was the server requesting a client cert (mTLS) on wss
Corrected root cause (supersedes the earlier "WebView2 doesn't trust the CA"
theory). The pilot's public `/acp` TLS listener had optional mTLS enabled
(`[gateway.tls.client_auth] enabled = true`, `require_client_cert = false`), so
the server sent a TLS **CertificateRequest** during the handshake. Chromium /
WebView2 has a **documented bug**: a client-certificate request on a **WSS**
handshake aborts the connection (`handshake was canceled`) unless a prior plain
HTTPS request to the same origin first cached the "no client certificate"
decision. `require_client_cert = false` (optional mTLS) does NOT help — rustls
still emits CertificateRequest. This is exactly why real Chrome sometimes
"worked" (a prior HTTPS request had cached the no-cert decision) while the fresh
WebView2 wss failed — it was never really a CA-trust difference.

**Fixed on the Volt/Volt side:** set `[gateway.tls.client_auth] enabled =
false` on the public listener — no CertificateRequest is sent. Verified with
`openssl s_client -connect <host>:8453`: it no longer lists "Acceptable client
certificate CA names". Browser clients (Thunderbolt/Volt) authenticate by the
pairing **bearer token**, not mTLS, so this removes nothing they use. **The
client needs NO workaround** — no pre-flight HTTP request, no SPKI flag, no
`ServerCertificateErrorDetected` shim for this. If mTLS device_id clients are
ever used, they must sit on a SEPARATE non-browser listener/port, never on this
browser-facing plane.

Separate, lesser concern — plain CA trust (`net::ERR_CERT_AUTHORITY_INVALID`):
the pilot's server cert is signed by a self-signed CA
(`Volt-Pilot-CA` today; a `Volt-Pilot-CA` after rebrand), which WebView2
must still trust for the chain to validate. This is ordinary TLS trust, NOT the
canceled-handshake bug above. For a real deployment, issue the cert from a CA
the environment already trusts (enterprise CA via GPO, or a real cert for a DNS
name) — then there is nothing to import. For the self-signed pilot only: import
the CA to `LocalMachine\Root`, or pin just that cert via
`--ignore-certificate-errors-spki-list=<SPKI>` in Tauri `additionalBrowserArgs`.
Never ship a blanket `--ignore-certificate-errors`.

### 3. LOW (doc) — stale reference to a removed `PairByCodeInput` component
`src/fork/agent-pairing/pair-by-code-field.tsx:16-17` — the docstring says the
detail panel "uses `PairByCodeInput`", but that component was **intentionally
removed** and no longer exists (only this comment and `PairByCodeField` itself
remain; `PairByCodeField` is used by `add-custom-agent-form.tsx:310`). This is
a stale comment, not a broken import — the build is fine. Fix: update the
docstring to describe the current behavior (pairing happens only in the
add-agent flow, folded into "Test connection"; the detail panel uses the manual
token field, no re-pair-by-code).

Design note (not a bug, your call): with re-pair-by-code removed, a saved
agent whose token was revoked or rotated can only be recovered by delete +
re-add. Volt pairing tokens are long-lived and revoke-only, so this is fine
for the pilot; only revisit if you want explicit revoke/rotate-recovery UX.

### 4. INFO — proxy routing and `127.0.0.1` (not the desktop WS blocker)
Clarification, since it is easy to misread: in the **packaged Tauri app the ACP
WebSocket always dials direct** — `createProxyWebSocket` (`src/lib/proxy-fetch.ts:263-267`)
short-circuits to `new WebSocket(url, protocols)` whenever `isStandalone()` is
true. So for the desktop client `wss://127.0.0.1:8453/acp` is correct (the
client dials its own loopback = the pilot); the proxy is NOT in the WS path.

The proxy only matters for (a) **REST** calls (`createProxyFetch`,
`:204-215` — routed through `${cloudUrl}/proxy` when `proxyEnabled`, default
true), and (b) **web / hosted mode**, where the WS is proxied too
(`${cloudUrl}/proxy/ws`, target URL base64url-encoded in a `tbproxy.target.*`
subprotocol, dialed **server-side** by our backend).

Consequence for proxied/hosted deployments: the backend resolves the target URL
on ITS OWN host, so `127.0.0.1` there means the backend's loopback, not the
user's machine — it can never reach an on-prem agent. A proxied connection to a
self-hosted agent must use a **routable address** (the host's LAN IP or DNS),
never loopback; and loopback / self-hosted URLs should simply always take the
direct transport (the desktop WS path already does). Worth a one-line guard +
doc so nobody points the proxy at `127.0.0.1` and expects it to work.

## Server-side references (Volt / Volt, for context)
- Pairing mint (loopback, on the pilot): `POST /admin/paircode/new` (add
  `?principal=<id>` to pre-bind). Exchange: `POST /api/pair {code, device_name}`
  or `zeroclaw/pair` over `/acp`.
- `/acp` is on the public TLS surface; auth via `bearer.<token>` subprotocol
  (also `Authorization: Bearer` or `?token=`). Carrier subprotocols
  `volt.acp.v1` / `zeroclaw.acp.v1`.
- Per-agent gate error: JSON-RPC `-32602`, message
  `"Agent \`<alias>\` is not permitted for this principal"`,
  `data.reason = "agent_not_permitted"`. Deny-by-default → HTTP 401 at upgrade.

## Agent roster (entitled list) — read `initialize._meta.zeroclaw.agents`

The entitled agent list for the paired principal is delivered **in the ACP
`initialize` response** — the handshake the client already performs. It is NOT
a pair-reply field and NOT a separate `agents/list` method. `connection-test.ts`
already calls `connection.initialize(...)` and holds the response; the roster is
already in hand.

**Contract:** `result._meta.zeroclaw.agents` = array of:
```ts
{ alias: string; display_name: string; default: boolean }
```
- `alias` — the agent id; connect as `wss://<host>/acp?agent=<alias>` and
  `session/new` with it.
- `display_name` — falls back to `alias` (Volt has no per-agent display-name
  field in its schema today).
- `default` — whether it is the connection's default agent (when `?agent=` is
  omitted).

**Scope:** exactly what this principal may use — configured ∩ dispatchable ∩
entitled. Live: an admin editing the principal's profile changes the next
`initialize` roster with no reconnect. The list never exceeds what `session/new`
will admit, so a listed alias is guaranteed dispatchable for this principal.

**Verified live (pilot, 2026-09-30):**
- principal `alice` (role `crm-view`): `[{"alias":"crm_bot","display_name":"crm_bot","default":false}]`
- principal `ops` (admin): `[{"alias":"crm_bot",…},{"alias":"payroll-bot",…}]`

**Client action:** in the connect/test flow, read `result._meta.zeroclaw.agents`
and render one entry per entitled agent (label = `display_name`, id = `alias`).
Do NOT wait on the reserved `PairResult.agents?` slot and do NOT call an
`agents/list` method — neither carries the roster. The roster is on `initialize`.
