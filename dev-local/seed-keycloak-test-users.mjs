/**
 * Seeds the local Keycloak `volt` realm with the test users the voltd live test
 * needs, and assigns each the group the gateway maps to a permission profile.
 *
 * Why a script and not realm.json: the realm ships no members on purpose — its
 * `demo` account carries the password `demo` in git, and pre-wiring a known
 * credential into a group that grants agent access is a standing privilege grant
 * that would travel with the file. So the users are created at runtime with
 * generated passwords instead.
 *
 * Why it must be re-runnable: keycloak runs `start-dev` with an embedded H2 that is
 * recreated on every container start, so these users vanish on each restart. Run
 * this again afterwards.
 *
 *   bun dev-local/seed-keycloak-test-users.mjs
 *
 * Passwords are reused from powersync-service/.local-test-users.txt when it exists
 * (so a restart does not invalidate what you already noted down) and generated
 * otherwise. That file is git-ignored; nothing here prints a password.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base = process.env.KEYCLOAK_URL ?? 'http://127.0.0.1:8180'
const realm = process.env.KEYCLOAK_REALM ?? 'volt'
const adminUser = process.env.KEYCLOAK_ADMIN ?? 'admin'
const adminPass = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin'
const credentialsPath = resolve(import.meta.dirname, '..', 'powersync-service', '.local-test-users.txt')

/** username → group. Usernames need 3+ characters (realm policy), which is why the
 *  `kb` role's account is `kb-user`; access comes from the GROUP, not the name. */
const plan = [
  ['admin', 'volt-admins'],
  ['avk', 'volt-avk'],
  ['kb-user', 'volt-kb'],
]

const api = async (method, path, token, body) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

const adminToken = async () => {
  const response = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: 'admin-cli', username: adminUser, password: adminPass, grant_type: 'password' }),
  })
  if (!response.ok) throw new Error(`admin token failed: ${response.status} — is Keycloak up on ${base}?`)
  return (await response.json()).access_token
}

/** Reuse already-noted passwords so a restart does not invalidate them. */
const readExisting = () => {
  if (!existsSync(credentialsPath)) return {}
  const pairs = readFileSync(credentialsPath, 'utf-8').matchAll(/^(\S+) \/ (\S+)/gm)
  return Object.fromEntries([...pairs].map((m) => [m[1], m[2]]))
}

const token = await adminToken()
const { body: groups } = await api('GET', `/admin/realms/${realm}/groups`, token)
const groupId = Object.fromEntries(groups.map((group) => [group.name, group.id]))

const existing = readExisting()
const lines = [
  '# Local dev Keycloak users for the voltd live test. NOT committed, NOT for any',
  '# deployment. Regenerate with: bun dev-local/seed-keycloak-test-users.mjs',
  '# Keycloak runs start-dev with an embedded H2, so re-run this after every restart.',
  '',
]

for (const [username, group] of plan) {
  if (!groupId[group]) throw new Error(`realm ${realm} has no group ${group} — is the realm imported?`)
  const email = `${username}@volt.local`
  await api('POST', `/admin/realms/${realm}/users`, token, {
    username,
    enabled: true,
    emailVerified: true,
    email,
    firstName: username,
    lastName: 'Test',
  })
  const { body: found } = await api('GET', `/admin/realms/${realm}/users?username=${username}&exact=true`, token)
  if (!found?.length) throw new Error(`could not create or find ${username}`)
  const id = found[0].id

  const password = existing[username] ?? randomBytes(9).toString('base64url')
  const pwd = await api('PUT', `/admin/realms/${realm}/users/${id}/reset-password`, token, {
    type: 'password',
    value: password,
    temporary: false,
  })
  const grp = await api('PUT', `/admin/realms/${realm}/users/${id}/groups/${groupId[group]}`, token)
  if (pwd.status >= 400 || grp.status >= 400) throw new Error(`${username}: password=${pwd.status} group=${grp.status}`)

  console.log(`${username.padEnd(8)} group=${group}${existing[username] ? ' (password kept)' : ' (password generated)'}`)
  lines.push(`${username} / ${password}   group=${group}   email=${email}`)
}

writeFileSync(credentialsPath, `${lines.join('\n')}\n`, 'utf-8')
console.log(`\ncredentials -> ${credentialsPath}`)
