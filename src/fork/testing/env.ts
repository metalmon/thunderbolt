/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Put an environment variable back the way a test found it.
 *
 * ⚠ Assignment cannot do this. Under bun `import.meta.env` IS `process.env`,
 * and `env.X = undefined` stores the STRING `"undefined"` — a truthy value that
 * every later reader believes. It is process state, not module state, so it
 * outlives the file that wrote it.
 *
 * That one line cost 37 failures in `src/services/encryption.test.ts`: the
 * escrow key read back as `"undefined"`, `buildOrgEnvelope` decided the build
 * escrows after all, and `atob("undefined")` threw. The count moved between
 * runs because `--randomize` decides the order, which is what made it look like
 * flakiness or upstream debt for weeks.
 *
 * @param env - the environment object, usually `import.meta.env`
 * @param key - the variable name
 * @param value - what it held before, `undefined` for "it was not set"
 */
export const restoreEnv = (env: Record<string, unknown>, key: string, value: unknown): void => {
  if (value === undefined) {
    delete env[key]
    return
  }
  env[key] = value
}
