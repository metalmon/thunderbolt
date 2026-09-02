/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hashValues } from '@/lib/utils'
import type { Skill, SkillRow } from '@/types'
import { instructions as askWidgetInstruction } from '@/widgets/ask/instructions'
import { instructions as connectIntegrationWidgetInstruction } from '@/widgets/connect-integration/instructions'
import { instructions as linkPreviewWidgetInstruction } from '@/widgets/link-preview/instructions'
import { instructions as mapWidgetInstruction } from '@/widgets/map/instructions'
import { instructions as weatherForecastWidgetInstruction } from '@/widgets/weather-forecast/instructions'

/**
 * Hash of reconciled skill fields. Widget contracts hash only their locked
 * content so enabled or legacy pinned state cannot block contract updates.
 * Editable task defaults also include state and `deletedAt`, so those user
 * changes remain protected from reconciliation.
 *
 * Accepts raw (nullable) rows as well as `Skill` so the hash-restamp data
 * migration can stamp exactly what reconciliation will later recompute.
 */
export const hashSkill = (
  skill: Pick<
    SkillRow,
    'id' | 'name' | 'label' | 'description' | 'instruction' | 'enabled' | 'pinnedOrder' | 'deletedAt'
  >,
): string => {
  const contentFields = [skill.name, skill.label, skill.description, skill.instruction]
  return hashValues(
    isWidgetSkillId(skill.id) ? contentFields : [...contentFields, skill.enabled, skill.pinnedOrder, skill.deletedAt],
  )
}

const dailyBriefInstruction = `Create a daily brief with the following sections. Do not ask the user for any missing information — just skip sections for which you are missing information or tools.

1. If you know the user's location, show the 7-day forecast. If not, skip this section.

2. Today's top news stories. Use the fetch_content tool to get the content of apnews.com. Provide the top 10 headlines in an ordered list. Do not include link previews.

3. If you have access to email tools, check the inbox and summarize what has come in over the last 24 hours, focusing on what looks most important. If not, skip this section.

4. If you have access to calendar tools, check the calendar and give a summary of what is coming up for the current day. Provide this as a personal assistant might. If not, skip this section.

Format the brief as follows:

Good <morning/afternoon/evening> <user's name if available>,

Some friendly, witty variation of "I've put together a daily brief for you!" with an emoji.

# Weather

Today's forecast is ____.

# News

1. <headline>
2. <headline>
3. <headline>

# Inbox

This is what's in your inbox that you should be aware of...

# Calendar

This is what you've got on your calendar today...

Do not show skipped sections at all, even placeholders — just skip them entirely.`

const importantEmailsInstruction = `Review the user's inbox and summarize the 5 most important emails that need attention today. Include sender, subject, and why each is important.`

/** Former "Search" chat mode, now shipped as a default skill (`/search`). */
const searchInstruction = `SEARCH MODE: ALWAYS search the web and return link previews. Never answer from memory.

For ANY query—even simple facts you know—you MUST:
1. Search the web
2. Evaluate the search results:
   - If results are already individual pages (articles, products, places, etc), use them directly
   - If results are homepages or aggregate pages (/, /hub/, /sections/, listicles), follow the Link Preview Workflow to discover individual URLs
3. Return each result as: <widget:link-preview source="N" url="https://..." />
4. Target ~10 link previews (fewer if irrelevant, up to 20 if many good)
5. No prose, no explanations, no summaries

CRITICAL QUALITY RULES:
- Every link-preview URL must be unique — never repeat the same URL
- Every URL must point to a specific page (deep path), not a homepage or section page
- If search results are all homepages (common for broad news queries), you MUST fetch them to find individual article URLs

Do NOT answer questions directly. Do NOT write paragraphs. Just search and show links.`

/** Former "Research" chat mode, now shipped as a default skill (`/research`). */
const researchInstruction = `You are **Deep Research**. The user wants EXHAUSTIVE research, not a quick answer.

## MANDATORY MINIMUMS (non-negotiable)
- At least 5 different searches (different queries, not refinements)
- At least 10 page fetches total
- At least 3 sub-questions investigated
- Do NOT write your final response until you've met these minimums

## Step 1: Plan
Break the query into 3-6 sub-questions. For each, plan 2-3 search queries using different keywords/angles.

## Step 2: Research Loop
For EACH sub-question:
1. Search with your first query
2. Fetch 2-4 promising pages from results
3. Search again with a different angle/query
4. Fetch 2-3 more pages
5. If findings conflict or gaps remain, search again

AFTER completing a sub-question, move to the next. Do NOT skip sub-questions. Do NOT stop early because you "have enough."

## Step 3: Output (only after meeting minimums)
1. **Executive Summary** – Direct answer + confidence level (High/Medium/Low)
2. **Detailed Findings** – Organized by sub-question. Cite with [N] at end of sentence.
3. **Conflicts & Gaps** – Where sources disagreed, what couldn't be verified
Do not add a Sources or References section at the end — inline [N] citations are sufficient.

## Rules
- If you've done fewer than 5 searches, you MUST do more
- If you've fetched fewer than 10 pages, you MUST fetch more
- "Good enough" is NOT acceptable—the user wants thoroughness
- When in doubt, search more`

/**
 * Default skills seeded for new users on first sign-in. UUIDs are stable so
 * the reconciler can recognize them across devices and across app restarts.
 *
 * New users get Search, Research, and Weather pinned (in that order) as their
 * starter chips; Daily Brief ships enabled but unpinned, and Important Emails
 * ships disabled. Additional model-facing widget contracts ship enabled and
 * unpinned. Task skills may be edited or soft-deleted; widget contracts only
 * expose enabled state.
 */
export const defaultSkillDailyBrief: Skill = {
  id: '01996330-0000-7000-8000-000000000001',
  name: 'daily-brief',
  label: 'Утренняя сводка',
  description:
    'Используй этот навык, когда пользователь просит дневную сводку, утренний обзор или сводку погоды, новостей, почты и календаря.',
  instruction: dailyBriefInstruction,
  enabled: 1,
  pinnedOrder: null,
  deletedAt: null,
  defaultHash: null,
  userId: null,
}

export const defaultSkillImportantEmails: Skill = {
  id: '01996330-0000-7000-8000-000000000002',
  name: 'important-emails',
  label: 'Важные письма',
  description:
    'Используй этот навык, когда пользователь хочет разобрать почту, увидеть, что требует внимания, или выделить самые важные письма дня.',
  instruction: importantEmailsInstruction,
  enabled: 0,
  pinnedOrder: null,
  deletedAt: null,
  defaultHash: null,
  userId: null,
}

export const defaultSkillSearch: Skill = {
  id: '01996330-0000-7000-8000-000000000003',
  name: 'search',
  label: 'Поиск',
  description:
    'Используй этот навык, когда пользователь хочет результаты веб-поиска в виде превью ссылок — новости, товары, места или что угодно, что лучше ответить списком источников.',
  instruction: searchInstruction,
  enabled: 1,
  pinnedOrder: 0,
  deletedAt: null,
  defaultHash: null,
  userId: null,
}

export const defaultSkillResearch: Skill = {
  id: '01996330-0000-7000-8000-000000000004',
  name: 'research',
  label: 'Исследование',
  description:
    'Используй этот навык, когда пользователь хочет исчерпывающее многоисточниковое погружение в тему, а не быстрый ответ.',
  instruction: researchInstruction,
  enabled: 1,
  pinnedOrder: 1,
  deletedAt: null,
  defaultHash: null,
  userId: null,
}

export const defaultSkillWeather: Skill = {
  id: '01996330-0000-7000-8000-000000000005',
  name: 'weather',
  label: 'Погода',
  description: 'Используй этот навык, когда пользователь спрашивает о погоде или хочет прогноз для места.',
  instruction: weatherForecastWidgetInstruction,
  enabled: 1,
  pinnedOrder: 2,
  deletedAt: null,
  defaultHash: null,
  userId: null,
}

export const defaultSkillLinkPreview: Skill = {
  id: '01996330-0000-7000-8000-000000000006',
  name: 'link-preview',
  label: 'Превью ссылок',
  description:
    'Используй этот навык, когда пользователь хочет веб-результаты, новости, товары, рекомендации или другие страницы в виде богатых превью ссылок.',
  instruction: linkPreviewWidgetInstruction,
  enabled: 1,
  pinnedOrder: null,
  deletedAt: null,
  defaultHash: null,
  userId: null,
}

export const defaultSkillConnectIntegration: Skill = {
  id: '01996330-0000-7000-8000-000000000007',
  name: 'connect-integration',
  label: 'Подключить интеграцию',
  description:
    'Используй этот навык, когда пользователь просит доступ к почте или календарю, но нужные инструменты Google или Microsoft недоступны.',
  instruction: connectIntegrationWidgetInstruction,
  // TEMP (fork/hide-integrations): disabled until the backend Google/Microsoft OAuth
  // creds are configured — with the integrations hidden this skill would only prompt a
  // connect flow that dead-ends on "OAuth is not configured". The defaultSkillsVersion
  // bump propagates this to existing accounts. Set back to 1 to re-enable.
  enabled: 0,
  pinnedOrder: null,
  deletedAt: null,
  defaultHash: null,
  userId: null,
}

export const defaultSkillAsk: Skill = {
  id: '01996330-0000-7000-8000-000000000008',
  name: 'ask',
  label: 'Спросить',
  description: 'Используй этот навык, когда нужно предложить пользователю выбрать из вариантов или ответить на интерактивный опрос.',
  instruction: askWidgetInstruction,
  enabled: 1,
  pinnedOrder: null,
  deletedAt: null,
  defaultHash: null,
  userId: null,
}

export const defaultSkillMap: Skill = {
  id: '01996330-0000-7000-8000-000000000009',
  name: 'map',
  label: 'Карта',
  description:
    'Используй этот навык, когда пользователь просит показать места, маршруты, регионы или другие географические результаты на интерактивной карте.',
  instruction: mapWidgetInstruction,
  enabled: 1,
  pinnedOrder: null,
  deletedAt: null,
  defaultHash: null,
  userId: null,
}

const widgetSkillIds = new Set([
  defaultSkillWeather.id,
  defaultSkillLinkPreview.id,
  defaultSkillConnectIntegration.id,
  defaultSkillAsk.id,
  defaultSkillMap.id,
])

/** Whether a skill id belongs to a model-facing widget rendering contract. */
export const isWidgetSkillId = (id: string): boolean => widgetSkillIds.has(id)

export const defaultSkills: ReadonlyArray<Skill> = [
  defaultSkillDailyBrief,
  defaultSkillImportantEmails,
  defaultSkillSearch,
  defaultSkillResearch,
  defaultSkillWeather,
  defaultSkillLinkPreview,
  defaultSkillConnectIntegration,
  defaultSkillAsk,
  defaultSkillMap,
] as const

/**
 * Monotonic version of the shipped skill defaults. Bump every time
 * `defaultSkills` changes in any way. Reconcile uses this as the ordering
 * signal so multi-device sync groups converge without ping-ponging (THU-637
 * pattern extended to skills in THU-677): a device only overwrites existing
 * rows when this bundled version is strictly newer than the highest ever
 * applied on this account.
 *
 * The paired snapshot test in `skills.test.ts` fails on any change to this
 * file's defaults without a matching version bump.
 */
export const defaultSkillsVersion = 8
