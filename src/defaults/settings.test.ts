/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import { defaultSettings, defaultSettingsVersion, hashSetting } from './settings'

/**
 * Snapshot pinning the shipped defaults to their declared version. When you
 * change any default setting (add/remove/edit/reorder), this test fails.
 *
 * Fix it in this order:
 *   1. Bump `defaultSettingsVersion` in `src/defaults/settings.ts`.
 *   2. Update `expected` below to match the actual values from the failure.
 *
 * The version is the ordering signal reconcile uses to decide who owns the
 * newest defaults across devices (THU-637 pattern extended to settings in
 * THU-677). Changing defaults without bumping the version breaks that
 * ordering silently.
 *
 * Fork note: the hash below carries two fork deviations, and the version still
 * stays at upstream’s. One is a row upstream does not ship,
 * `artifact_view_width` at index 18; the other is `data_collection` shipped
 * `false` rather than `true`, because Volt ships into closed perimeters. The
 * version is a cross-device ordering signal shared with the server payload, so
 * running ahead of upstream would make its next bump lose to ours; a row that
 * only ever gets inserted (never overwritten) needs no bump of its own. Keep
 * the parity and re-insert the row after a sync — do not "fix" this by bumping.
 *
 * Not bumping is also what makes the `data_collection` change safe: with no
 * newer version, reconcile only INSERTS the row where it is missing, so a fresh
 * install gets `false` while a device that already has the row keeps it. A bump
 * would overwrite it on every device that never touched the setting — a decision
 * about someone else's consent, and not one to make silently.
 */
const computeSnapshotHash = () =>
  defaultSettings.map((setting, index) => `${index}:${setting.key}:${hashSetting(setting)}`).join('|')

const expected = {
  version: 8,
  hash: '0:data_collection:9xnigq|1:is_triggers_enabled:eonvmh|2:experimental_feature_tasks:-zg8zmz|3:experimental_feature_voice:6l2ce1|4:preferred_name:-5w6dil|5:location_name:27rtqf|6:location_lat:-tpss8p|7:location_lng:-tpsiwv|8:location_country_code:-ee3q2s|9:location_id:-yieo9|10:location_name_display:qbbf38|11:distance_unit:-3esuvm|12:temperature_unit:-dmzg9f|13:time_format:we6fw3|14:currency:avihzf|15:integrations_pro_is_enabled:bbnpv0|16:user_has_completed_onboarding:-hxwxxt|17:content_view_width:8pnzc5|18:artifact_view_width:-pt9kt9|19:integrations_do_not_ask_again:yv9tj5|20:language:p3z19g|21:experimental_feature_otari:55gjoa',
}

describe('defaultSettings version snapshot', () => {
  test('version and content are in sync — read the file header if this fails', () => {
    expect({
      version: defaultSettingsVersion,
      hash: computeSnapshotHash(),
    }).toEqual(expected)
  })
})
