/**
 * The deployment's own model catalog, configured through the environment.
 *
 * The fork ships an EMPTY catalog (`shared/defaults/models.ts`): inside a closed
 * perimeter the cloud models are unreachable, and a picker row that can only
 * fail is worse than no row at all. So every deployment names its own model —
 * and doing that by editing source and rebuilding the image is wrong: this is
 * deployment configuration, not product content. `MINI_APPS` next door works
 * exactly this way, and this variable imitates it on purpose.
 *
 * Clients receive the set over `/config` → `defaults.models` and decide for
 * themselves whose copy is newer by comparing versions (`pickModelsDefaults`).
 * Rollback is therefore done by RAISING the version with the reverted content,
 * never by lowering it: convergence across devices rests on monotonicity.
 *
 * An API key neither belongs here nor can be put here: it lives on the client in
 * the local-only `models_secrets` table, and a server-side model is served by
 * the managed-upstream lane, which attaches the key itself.
 */

import { z } from 'zod'

import type { SharedModel } from '@shared/defaults/models'

/** These rows store flags as numbers (0/1), the same way the models table does. */
const flag = (fallback: 0 | 1) => z.coerce.number().int().min(0).max(1).default(fallback)

/**
 * Required is the minimum that identifies a row; everything else is filled in,
 * so an entry can be written short instead of copying seventeen fields for the
 * sake of one model.
 */
const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.enum(['openai', 'custom', 'openrouter', 'thunderbolt', 'anthropic', 'tinfoil']),
  model: z.string().min(1),
  url: z.string().nullable().default(null),
  isSystem: flag(1),
  enabled: flag(1),
  toolUsage: flag(1),
  isConfidential: flag(0),
  startWithReasoning: flag(0),
  supportsParallelToolCalls: flag(0),
  contextWindow: z.coerce.number().int().positive().nullable().default(null),
  deletedAt: z.string().nullable().default(null),
  defaultHash: z.string().nullable().default(null),
  vendor: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  userId: z.string().nullable().default(null),
})

export type DeploymentModels = { version: number; data: SharedModel[] }

export type ParseDeploymentModelsInput = {
  /** `DEFAULT_MODELS`: the catalog rows as a JSON array. */
  raw: string
  /** `DEFAULT_MODELS_VERSION`; empty means "derive it". */
  version: string
  /** The version compiled into this build; a declared one must exceed it. */
  bundledVersion: number
}

/**
 * Parse the deployment's model set.
 *
 * Returns `null` wherever there is nothing to publish or publishing would be
 * unsafe — the caller then serves the bundled catalog. Every refusal is
 * explained in the log: a set that silently fails to arrive looks like "the
 * model disappeared", and the cause will be hunted anywhere but in a typo in
 * the environment.
 */
export const parseDeploymentModels = ({
  raw,
  version,
  bundledVersion,
}: ParseDeploymentModelsInput): DeploymentModels | null => {
  if (!raw.trim()) {
    return null
  }

  /*
   * The version may be left out, and that is the default rather than a
   * concession.
   *
   * Demanding a number means demanding the operator remember it has to exceed
   * the bundled one — and upstream raises the bundled one over time, so a
   * number that is right today eventually falls below it and the deployment's
   * set loses to the bundled catalog in silence. "Bundled + 1" is always right
   * and needs no maintenance.
   *
   * Naming it by hand is needed in exactly one case: the set CHANGES while
   * devices have already applied the previous one. They then need a strictly
   * greater number for reconciliation to prefer the new content — the derived
   * value is the same number, so the change would never reach them.
   */
  const declared = version.trim() ? Number(version) : bundledVersion + 1
  if (!Number.isInteger(declared)) {
    console.error(`[models] DEFAULT_MODELS_VERSION is not an integer ("${version}"); no set published`)
    return null
  }
  if (declared <= bundledVersion) {
    console.error(
      `[models] DEFAULT_MODELS_VERSION=${declared} does not exceed this build's version (${bundledVersion}); a client would prefer the bundled catalog, so no set was published. Drop the variable and it is derived (${bundledVersion + 1})`,
    )
    return null
  }

  let container: unknown
  try {
    container = JSON.parse(raw)
  } catch (error) {
    console.error(`[models] DEFAULT_MODELS does not parse as JSON: ${error instanceof Error ? error.message : error}`)
    return null
  }
  if (!Array.isArray(container)) {
    console.error('[models] DEFAULT_MODELS must be an array of catalog rows; no set published')
    return null
  }

  const data = container.flatMap((candidate, index) => {
    const parsed = modelSchema.safeParse(candidate)
    if (!parsed.success) {
      const why = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
      console.error(`[models] Dropping entry ${index} — ${why}`)
      return []
    }
    return [parsed.data satisfies SharedModel]
  })

  /*
   * An empty result is not "publish zero models". Publishing an empty set at a
   * higher version would tell every client that all bundled rows are retired,
   * and the only way to get here is a typo: an operator with nothing to publish
   * simply leaves the variable unset.
   */
  if (data.length === 0) {
    console.error('[models] DEFAULT_MODELS holds no usable row; no set published')
    return null
  }

  console.info(`[models] Publishing deployment set: version ${declared}, ${data.length} row(s)`)
  return { version: declared, data }
}
