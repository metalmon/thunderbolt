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
   * Сторож условия, из-за которого заметка и существует.
   *
   * 0.1.167: апстрим снял `hasWebTools` (требовал ОБА инструмента) и завёл
   * `buildWebToolsPrompt(availableToolNames)`, который теперь сам говорит про
   * полосу «есть fetch_content, нет search». Наша заметка осталась не ради самого
   * факта инструмента, а ради того, чего апстрим про НАШУ реализацию не знает:
   * страницы читаются без выполнения скриптов, ссылки перечислены в конце текста,
   * а приватные и петлевые адреса отвергаются. Сторож переставлен на ту же ветку
   * апстрима: если она исчезнет или перестанет быть условной, заметка снова
   * станет единственным голосом и это надо заметить.
   */
  it('апстрим по-прежнему различает полосу без search', () => {
    const source = readRepoFile('src/ai/prompts/web-tools.ts')
    expect(source).toContain("const hasSearch = availableToolNames.includes('search')")
    expect(source).toContain("const hasFetch = availableToolNames.includes('fetch_content')")
    expect(source).toContain('if (!hasSearch)')
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
