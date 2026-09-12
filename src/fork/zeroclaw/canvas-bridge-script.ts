/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { CANVAS_BRIDGE_METHODS } from './canvas-bridge-protocol'

/**
 * Builds the `<script>` tag injected into a sandboxed artifact iframe so
 * agent-authored canvas code can talk to the host over "Wire A" — the
 * iframe↔host JSON-RPC channel of MCP Apps (SEP-1865). Mirrors
 * `harnessScript`'s IIFE-plus-embedded-nonce style (`src/artifacts/harness.ts`):
 * every message the iframe sends is stamped with the same per-render
 * `artifactNonce` the harness uses, and every message it accepts is
 * nonce-gated before being routed.
 *
 * Installs `window.mcpApp`:
 * - `initialize()` — sends `ui/initialize`, resolves with the host's result.
 * - `callTool(name, args, opts?)` — sends `tools/call`; `opts.prompt` carries
 *   the combined-mode extra field (spec §3c).
 * - `sendPrompt(text)` — sends `ui/prompt` as a fire-and-forget notification
 *   (spec §3b: the host never replies, so unlike `callTool` this returns
 *   nothing and allocates no `pending` entry).
 * - `on(method, cb)` — registers a handler for a host→app notification
 *   (`ui/notifications/initialized` / `-tool-input` / `-tool-result`).
 * - `METHODS` — the full wire method-name table, embedded so app code
 *   needn't hardcode the notification-method strings it passes to `on()`.
 *
 * PASSIVE AT LOAD: installs only the API object and one capture-phase
 * `message` listener; it posts nothing and throws nothing until the app
 * calls one of the `mcpApp` methods. The bridge shares the iframe with the
 * verification harness, which gates on `artifact-ready`/`artifact-error` —
 * this script must never disturb that race.
 *
 * The returned string contains no runtime import: it is serialized into a
 * cross-origin iframe that has none of our modules, so `CANVAS_BRIDGE_METHODS`
 * is read only at BUILD time, here, to interpolate its literal wire values.
 */
export const buildCanvasBridgeScript = (nonce: string): string => `<script>
(function () {
  var NONCE = ${JSON.stringify(nonce)};
  var METHODS = ${JSON.stringify(CANVAS_BRIDGE_METHODS)};
  var nextId = 1;
  var pending = {};
  var handlers = {};
  function send(msg) {
    msg.artifactNonce = NONCE;
    try { parent.postMessage(msg, '*'); } catch (e) {}
  }
  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      send({ jsonrpc: '2.0', id: id, method: method, params: params });
    });
  }
  function notify(method, params) {
    send({ jsonrpc: '2.0', method: method, params: params });
  }
  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || data.artifactNonce !== NONCE) { return; }
    if (typeof data.id !== 'undefined' && Object.prototype.hasOwnProperty.call(pending, data.id)) {
      var p = pending[data.id];
      delete pending[data.id];
      if (data.error) { p.reject(data.error); } else { p.resolve(data.result); }
      return;
    }
    if (typeof data.method === 'string' && Object.prototype.hasOwnProperty.call(handlers, data.method)) {
      handlers[data.method](data.params);
    }
  }, true);
  window.mcpApp = {
    METHODS: METHODS,
    initialize: function () {
      return request(METHODS.UI_INITIALIZE, {});
    },
    callTool: function (name, args, opts) {
      var params = { name: name, arguments: args || {} };
      if (opts && opts.prompt) { params.prompt = opts.prompt; }
      return request(METHODS.TOOLS_CALL, params);
    },
    sendPrompt: function (text) {
      notify(METHODS.UI_PROMPT, { prompt: text });
    },
    on: function (method, cb) {
      handlers[method] = cb;
    }
  };
})();
</script>`
