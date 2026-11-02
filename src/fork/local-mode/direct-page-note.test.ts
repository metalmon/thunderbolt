/* Copyright (c) Okta Plus LLC. All rights reserved.
 * Fork-owned file (see AGENTS.md / CLAUDE.md: additive fork surface). */

import { describe, expect, it } from 'bun:test'
import { readRepoFile } from '../testing/source-file'
import { directPageFetchNote } from './direct-page-note'

describe('заметка о полосе чтения без Pro', () => {
  it('выдаётся, когда есть fetch_content и нет search', () => {
    const note = directPageFetchNote(['render_html', 'fetch_content', 'skill'])
    expect(note).toContain('READ-ONLY BY URL')
  })

  it('молчит на полной полосе Pro: там про сеть говорит webToolsPrompt', () => {
    expect(directPageFetchNote(['search', 'fetch_content'])).toBeNull()
  })

  it('молчит, когда сети нет вовсе', () => {
    expect(directPageFetchNote(['render_html'])).toBeNull()
  })

  /**
   * Сторож условия, из-за которого заметка и существует. Если `hasWebTools`
   * когда-нибудь перестанет требовать ОБА инструмента, `webToolsPrompt` начнёт
   * подмешиваться сам, и тогда заметка станет вторым голосом про одно и то же.
   * Пусть об этом скажет красный тест, а не поведение модели.
   */
  it('условие hasWebTools по-прежнему требует оба инструмента', () => {
    const source = readRepoFile('src/ai/fetch.ts')
    expect(source).toContain("'search' in appToolset && 'fetch_content' in appToolset")
  })

  /**
   * ⚠ Заметка обязана ехать ИЗМЕНЯЕМОЙ частью запроса. Постоянная участвует в
   * подписи кеша harness, а `buildVolatileSystemNotes` вызывается только на
   * ЗАПАСНОМ пути (`aiFetchStreamingResponse`) — встройка туда до живой установки
   * не доезжает, и однажды уже не доехала. См. attachment-citations.md, раздел 9.
   */
  it('подмешана в volatileSystemPrompt, а не в стабильный запрос и не в запасной путь', () => {
    const source = readRepoFile('src/ai/fetch.ts')
    const volatileBlock = source.slice(source.indexOf('volatileSystemPrompt: ['))
    expect(volatileBlock.slice(0, 600)).toContain('directPageFetchNote')
  })
})
