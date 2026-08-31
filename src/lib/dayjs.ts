/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import relativeTime from 'dayjs/plugin/relativeTime'
// Russian locale data (day/month names + relativeTime strings for `.fromNow()`).
// English is dayjs's built-in default; the active locale is chosen in i18n.ts to
// track the UI language.
import 'dayjs/locale/ru'

dayjs.extend(duration)
dayjs.extend(relativeTime)

export default dayjs
