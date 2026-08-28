/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Mic capture worklet (THU-684). The AudioContext runs at the mic's native rate
// (browsers won't connect a MediaStreamSource across sample rates), so this
// resamples to 16 kHz — what the energy VAD and STT expect — and emits fixed
// 512-sample frames. Plain JS in /public so `audioWorklet.addModule` loads it
// with the correct MIME (no bundler transform).
//
// Anti-aliasing: linear interpolation alone is a poor decimation filter. When
// the native rate is above 16 kHz (48 kHz on most devices), any mic energy
// above the 8 kHz target-Nyquist — sibilants, key clicks, HF background — folds
// back into the audible band as inharmonic whistles/tones. That garbage is then
// fed to Gemini's native-audio model, which listens to the raw waveform and
// intermittently reflects it as a beep/horn in its reply. So we run the input
// through a 4th-order Butterworth low-pass (two cascaded biquads) at ~7 kHz
// BEFORE decimating. Bypassed when the context already runs at/below 16 kHz
// (ratio ≤ 1, no downsampling, nothing to alias).
const TARGET_RATE = 16000
const FRAME_SAMPLES = 512
// Below the 8 kHz target-Nyquist with margin; still passes the full speech band.
const ANTI_ALIAS_CUTOFF_HZ = 7000
// Per-stage Q for a 4th-order Butterworth split into two biquads.
const BUTTERWORTH_Q = [0.54119610, 1.30656296]

/** A Transposed-Direct-Form-II biquad low-pass (RBJ cookbook coefficients),
 *  keeping its own two-sample state so it filters a continuous stream across
 *  `process()` calls. */
class Biquad {
  constructor(cutoffHz, sampleRateHz, q) {
    const w0 = (2 * Math.PI * cutoffHz) / sampleRateHz
    const cosW0 = Math.cos(w0)
    const alpha = Math.sin(w0) / (2 * q)
    const a0 = 1 + alpha
    this._b0 = ((1 - cosW0) / 2) / a0
    this._b1 = (1 - cosW0) / a0
    this._b2 = ((1 - cosW0) / 2) / a0
    this._a1 = (-2 * cosW0) / a0
    this._a2 = (1 - alpha) / a0
    this._z1 = 0
    this._z2 = 0
  }

  /** Filter one sample in the stream, advancing the internal state. */
  step(x) {
    const y = this._b0 * x + this._z1
    this._z1 = this._b1 * x - this._a1 * y + this._z2
    this._z2 = this._b2 * x - this._a2 * y
    return y
  }
}

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // Input samples per output sample, e.g. 3.0 at a 48 kHz context.
    this._ratio = sampleRate / TARGET_RATE
    this._frame = new Float32Array(FRAME_SAMPLES)
    this._fill = 0
    this._pending = new Float32Array(0)
    this._pos = 0 // fractional read position within _pending
    // Only decimation aliases; skip the filter when not downsampling.
    this._antiAlias =
      this._ratio > 1 ? BUTTERWORTH_Q.map((q) => new Biquad(ANTI_ALIAS_CUTOFF_HZ, sampleRate, q)) : null
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true

    const filtered = this._antiAlias ? this._lowpass(channel) : channel

    const merged = new Float32Array(this._pending.length + filtered.length)
    merged.set(this._pending, 0)
    merged.set(filtered, this._pending.length)
    this._pending = merged

    while (this._pos + 1 < this._pending.length) {
      const i = Math.floor(this._pos)
      const frac = this._pos - i
      this._frame[this._fill++] = this._pending[i] * (1 - frac) + this._pending[i + 1] * frac
      if (this._fill === FRAME_SAMPLES) {
        this.port.postMessage(this._frame.slice())
        this._fill = 0
      }
      this._pos += this._ratio
    }

    const consumed = Math.floor(this._pos)
    if (consumed > 0) {
      this._pending = this._pending.slice(consumed)
      this._pos -= consumed
    }
    return true
  }

  /** Run the input block through the cascaded anti-aliasing biquads. Returns a
   *  fresh buffer; the source block is left untouched. */
  _lowpass(channel) {
    const out = new Float32Array(channel.length)
    for (let i = 0; i < channel.length; i++) {
      let s = channel[i]
      for (const stage of this._antiAlias) {
        s = stage.step(s)
      }
      out[i] = s
    }
    return out
  }
}

registerProcessor('capture-processor', CaptureProcessor)
