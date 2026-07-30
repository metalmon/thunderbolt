/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Continuous mic capture for the realtime (bidi) voice path.
 *
 * Unlike `./vad.ts` (which gates frames through the energy-VAD endpointer for
 * the pipeline session), a realtime engine's server does its own turn
 * detection over the raw stream — every captured frame must reach
 * `engine.sendAudio` unconditionally. This owns just the mic/worklet plumbing
 * (getUserMedia + AudioWorklet resampled to 16 kHz), forwarding each frame to
 * `onFrame` with no gating, buffering, or endpointing whatsoever.
 *
 * `getUserMedia` runs with echo cancellation on, and model audio is expected
 * to play through `./playback.ts`'s graph (routed to the default output) so
 * the browser/OS AEC has the assistant's own voice as its echo reference.
 */
import { MediaDevicesUnavailableError } from '@/voice/voice-error'

export type MicCapture = {
  start: () => Promise<void>
  destroy: () => Promise<void>
}

const micConstraints: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
}

/** Create a continuous mic capture stream — every 16 kHz frame the worklet
 *  emits is forwarded to `onFrame` as soon as it arrives, never buffered or
 *  dropped. */
export const createMicCapture = (onFrame: (frame: Float32Array) => void): MicCapture => {
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let node: AudioWorkletNode | null = null

  const start = async () => {
    // WKWebView hides `navigator.mediaDevices` outside a secure context (a Tauri
    // dev build over http://localhost), so guard before dereferencing it — a raw
    // "undefined is not an object" TypeError isn't actionable.
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MediaDevicesUnavailableError()
    }
    stream = await navigator.mediaDevices.getUserMedia(micConstraints)
    // Native mic rate (can't connect a MediaStreamSource across rates); the
    // worklet resamples to 16 kHz.
    ctx = new AudioContext()
    // Mobile webviews create the context suspended even inside a gesture; resume
    // so the capture graph actually pulls frames.
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
    await ctx.audioWorklet.addModule('/voice/capture-worklet.js')
    node = new AudioWorkletNode(ctx, 'capture-processor')
    ctx.createMediaStreamSource(stream).connect(node)
    node.connect(ctx.destination) // worklet has no output; keeps the graph pulling
    node.port.onmessage = (event: MessageEvent<Float32Array>) => onFrame(event.data)
  }

  const destroy = async () => {
    if (node) {
      node.port.onmessage = null
    }
    node?.disconnect()
    node = null
    for (const track of stream?.getTracks() ?? []) {
      track.stop()
    }
    stream = null
    await ctx?.close()
    ctx = null
  }

  return { start, destroy }
}
