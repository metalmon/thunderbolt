/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Connect-by-code pairing: exchange a short pairing code for a bearer token
 * over a transient, pre-auth ACP WebSocket. The runtime's `/acp` pre-auth loop
 * accepts only the pairing method and answers `{ token }`; we then hand that
 * token to the normal bearer plumbing (`setAgentBearerToken`) and reconnect as
 * usual. Prefer the `volt/pair` method, fall back to `zeroclaw/pair` so we work
 * against both a new (accept-both) and an older runtime.
 */

import type { WebSocketLike } from '@/acp/transports/websocket'
import { pairingDeviceName, pairingDeviceType } from './device-identity'
import { resolvePairingWebSocketFactory } from './pairing-transport'

/** Result of a successful pairing. `agents` is an unused Phase-1 slot for the
 *  future `agents/list` contract — the runtime returns only the token today. */
export type PairResult = { token: string; agents?: unknown[] }

export type PairingErrorKind = 'invalid_code' | 'rejected' | 'transport' | 'timeout'

export class PairingError extends Error {
  readonly kind: PairingErrorKind
  constructor(kind: PairingErrorKind, message: string) {
    super(message)
    this.name = 'PairingError'
    this.kind = kind
  }
}

export type PairOverAcpInputs = {
  url: string
  code: string
  deviceName?: string
  /** Device class for the gateway's admin list. Defaults to this platform's. */
  deviceType?: string
  timeoutMs?: number
  /** Test seam — production omits and the tokenless pairing factory is built. */
  webSocketFactory?: (url: string) => WebSocketLike
}

type JsonRpcError = { code?: number; message?: string; data?: { reason?: string } }

/** Internal signal: the server does not know this pairing method — try the other. */
const METHOD_UNKNOWN = Symbol('method-unknown')

const defaultTimeoutMs = 15000

/** An old runtime rejects an unknown pairing method either as JSON-RPC
 *  method-not-found (-32601) or via its pre-auth gate (`reason: "pair_first"`,
 *  emitted for any method that is not the one it accepts). Both mean "fall back
 *  to the legacy method", never "bad code". */
const isMethodUnknown = (error: JsonRpcError): boolean => error.code === -32601 || error.data?.reason === 'pair_first'

/** A wrong / expired / consumed code vs any other refusal. */
const classifyError = (error: JsonRpcError): PairingErrorKind => {
  const text = (error.message ?? '').toLowerCase()
  return /code|invalid|expired/.test(text) ? 'invalid_code' : 'rejected'
}

/** One pairing attempt over a fresh socket with a single JSON-RPC request.
 *  Resolves the token, or rejects with a `PairingError` — except an
 *  unknown-method refusal, which rejects with the `METHOD_UNKNOWN` symbol so
 *  the caller can retry the legacy method. */
const attemptPair = (
  factory: (url: string) => WebSocketLike,
  url: string,
  method: string,
  code: string,
  // A promise, not a value: the hostname lookup is an IPC round-trip, and awaiting
  // it before dialling would add that latency to every pairing AND move socket
  // creation off the caller's tick. Opened first, resolved while connecting.
  device: Promise<{ name: string; type: string }>,
  timeoutMs: number,
): Promise<PairResult> =>
  new Promise<PairResult>((resolve, reject) => {
    let ws: WebSocketLike
    try {
      ws = factory(url)
    } catch {
      // A malformed URL / unsupported scheme makes `new WebSocket(...)` throw
      // synchronously — surface it as a typed transport error, not a raw one.
      reject(new PairingError('transport', 'Could not open the pairing connection'))
      return
    }
    const requestId = 1
    let settled = false

    const finish = (run: () => void) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      ws.removeEventListener('open', handleOpen)
      ws.removeEventListener('message', handleMessage)
      ws.removeEventListener('close', handleClose)
      ws.removeEventListener('error', handleError)
      try {
        ws.close()
      } catch {
        // closing a socket that never opened is fine
      }
      run()
    }

    const handleOpen = () => {
      void device
        .then(({ name, type }) => {
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: requestId,
              method,
              params: { code, device_name: name, device_type: type },
            }),
          )
        })
        .catch(() => finish(() => reject(new PairingError('transport', 'Could not send the pairing request'))))
    }

    const handleMessage = (event: { data: string }) => {
      let msg: { id?: unknown; result?: { token?: unknown }; error?: JsonRpcError }
      try {
        msg = JSON.parse(event.data)
      } catch {
        return // not JSON — ignore
      }
      if (msg.id !== requestId) {
        return // unrelated pre-auth frame
      }
      if (msg.result && typeof msg.result.token === 'string') {
        const token = msg.result.token
        finish(() => resolve({ token }))
        return
      }
      if (msg.error) {
        const error = msg.error
        if (isMethodUnknown(error)) {
          finish(() => reject(METHOD_UNKNOWN))
          return
        }
        finish(() => reject(new PairingError(classifyError(error), error.message ?? 'Pairing failed')))
        return
      }
      finish(() => reject(new PairingError('rejected', 'Malformed pairing response')))
    }

    const handleClose = () => finish(() => reject(new PairingError('transport', 'Pairing connection closed')))
    const handleError = () => finish(() => reject(new PairingError('transport', 'Pairing connection failed')))

    const timer = setTimeout(() => finish(() => reject(new PairingError('timeout', 'Pairing timed out'))), timeoutMs)

    ws.addEventListener('open', handleOpen)
    ws.addEventListener('message', handleMessage)
    ws.addEventListener('close', handleClose)
    ws.addEventListener('error', handleError)
  })

/**
 * Exchange `code` for a bearer token against the agent at `url`. Tries
 * `volt/pair` first and falls back once to `zeroclaw/pair` when the runtime
 * doesn't know the newer method.
 */
export const pairOverAcp = async (inputs: PairOverAcpInputs): Promise<PairResult> => {
  const factory = inputs.webSocketFactory ?? resolvePairingWebSocketFactory()
  const timeoutMs = inputs.timeoutMs ?? defaultTimeoutMs
  // Both are what the gateway lists a paired device by; without them its admin
  // page shows "Без названия" and an operator cannot tell one machine from another.
  // Started, not awaited: the socket opens on this tick and the lookup rides along.
  const device = (async () => ({
    name: inputs.deviceName ?? (await pairingDeviceName()),
    type: inputs.deviceType ?? pairingDeviceType(),
  }))()

  try {
    return await attemptPair(factory, inputs.url, 'volt/pair', inputs.code, device, timeoutMs)
  } catch (error) {
    if (error !== METHOD_UNKNOWN) {
      throw error
    }
  }

  try {
    return await attemptPair(factory, inputs.url, 'zeroclaw/pair', inputs.code, device, timeoutMs)
  } catch (error) {
    if (error === METHOD_UNKNOWN) {
      throw new PairingError('rejected', 'The agent does not support code pairing')
    }
    throw error
  }
}
