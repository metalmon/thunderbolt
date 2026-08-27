/* Fork IP — additive. Not upstream MPL logic; a thin fork-only helper. */

/**
 * Fork-only ownership relaxation for custom agents under an **anonymous** account.
 *
 * Upstream gates agent management on strict ownership: `agent.userId ===
 * currentUserId`. That assumes a stable account id. The fork runs on anonymous
 * accounts, and two facts break the assumption:
 *
 *  1. Anonymous users cannot sync — the backend `/upload` route rejects them with
 *     `403 ANONYMOUS_SYNC_FORBIDDEN` (see `backend/src/api/powersync.ts`). So an
 *     anonymous account's agents are **local-only**; they never leave the device.
 *  2. Each anonymous re-enrollment mints a fresh `user.id`. A custom agent stamped
 *     with the session's id at creation time is orphaned (`agent.userId !==
 *     currentUserId`) the moment that id churns, which hides its management menu.
 *
 * Because the data is local-only and single-human-per-device, ownership-by-id is
 * meaningless for anonymous accounts — presence in the local DB already means the
 * agent is this user's. So under an anonymous account we treat any custom agent as
 * manageable. For a **stable / synced** account (a future prod/SSO world where
 * agents really can belong to distinct users within one account) the strict
 * upstream check is kept, so this never widens access where it matters.
 *
 * @param agentUserId  the agent row's stored owner id (may be a churned anon id)
 * @param currentUserId  the current session user id, or null while auth resolves
 * @param isAnonymous  whether the current session user is anonymous
 */
export const canManageForkCustomAgent = (
  agentUserId: string | null,
  currentUserId: string | null,
  isAnonymous: boolean,
): boolean => {
  if (!currentUserId) {
    return false
  }
  return agentUserId === currentUserId || isAnonymous
}
