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
 * Fork note: the hash below carries one row upstream does not ship,
 * `artifact_view_width` at index 18, and the version stays at upstream's. The
 * version is a cross-device ordering signal shared with the server payload, so
 * running ahead of upstream would make its next bump lose to ours; a row that
 * only ever gets inserted (never overwritten) needs no bump of its own. Keep
 * the parity and re-insert the row after a sync — do not "fix" this by bumping.
 */
const computeSnapshotHash = () =>
  defaultSettings.map((setting, index) => `${index}:${setting.key}:${hashSetting(setting)}`).join('|')

const expected = {
  version: 8,
  hash: '0:data_collection:bsmtz|1:is_triggers_enabled:eonvmh|2:experimental_feature_tasks:-zg8zmz|3:experimental_feature_voice:6l2ce1|4:preferred_name:-5w6dil|5:location_name:27rtqf|6:location_lat:-tpss8p|7:location_lng:-tpsiwv|8:location_country_code:-ee3q2s|9:location_id:-yieo9|10:location_name_display:qbbf38|11:distance_unit:-3esuvm|12:temperature_unit:-dmzg9f|13:time_format:we6fw3|14:currency:avihzf|15:integrations_pro_is_enabled:bbnpv0|16:user_has_completed_onboarding:-hxwxxt|17:content_view_width:8pnzc5|18:artifact_view_width:-pt9kt9|19:integrations_do_not_ask_again:yv9tj5|20:language:p3z19g|21:experimental_feature_otari:55gjoa',
}

describe('defaultSettings version snapshot', () => {
  test('version and content are in sync — read the file header if this fails', () => {
    expect({
      version: defaultSettingsVersion,
      hash: computeSnapshotHash(),
    }).toEqual(expected)
  })
})
