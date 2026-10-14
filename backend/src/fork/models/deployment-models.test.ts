import { describe, expect, it, spyOn } from 'bun:test'

import { parseDeploymentModels } from './deployment-models'

const row = {
  id: 'c88aff83-95d1-4d3c-9a05-c78b93c67306',
  name: 'Qwen3.6 35B',
  provider: 'openrouter',
  model: 'Qwen3.6-35B-A3B-AWQ',
  isSystem: 1,
  enabled: 1,
  isConfidential: 0,
  contextWindow: 32768,
  toolUsage: 1,
  startWithReasoning: 0,
  supportsParallelToolCalls: 0,
  deletedAt: null,
  url: null,
  defaultHash: null,
  vendor: 'qwen',
  description: 'Stand model',
  userId: null,
}

const quiet = <T>(run: () => T): T => {
  const error = spyOn(console, 'error').mockImplementation(() => undefined)
  const info = spyOn(console, 'info').mockImplementation(() => undefined)
  try {
    return run()
  } finally {
    error.mockRestore()
    info.mockRestore()
  }
}

describe('parseDeploymentModels', () => {
  it('publishes nothing when unconfigured', () => {
    expect(parseDeploymentModels({ raw: '', version: '', bundledVersion: 11 })).toBeNull()
  })

  it('publishes a row at the declared version', () => {
    const published = parseDeploymentModels({ raw: JSON.stringify([row]), version: '12', bundledVersion: 11 })
    expect(published?.version).toBe(12)
    expect(published?.data).toHaveLength(1)
    expect(published?.data[0]?.model).toBe('Qwen3.6-35B-A3B-AWQ')
  })

  it('derives the version when none is given: bundled + 1', () => {
    expect(parseDeploymentModels({ raw: JSON.stringify([row]), version: '', bundledVersion: 11 })?.version).toBe(12)
    expect(parseDeploymentModels({ raw: JSON.stringify([row]), version: '   ', bundledVersion: 20 })?.version).toBe(21)
  })

  it('drops a malformed entry and keeps the rest', () => {
    const published = quiet(() =>
      parseDeploymentModels({
        raw: JSON.stringify([row, { id: 'broken' }, { ...row, id: 'second', model: 'other' }]),
        version: '12',
        bundledVersion: 11,
      }),
    )
    expect(published?.data.map((m) => m.id)).toEqual([row.id, 'second'])
  })

  it('treats an unknown provider as a malformed entry', () => {
    const published = quiet(() =>
      parseDeploymentModels({
        raw: JSON.stringify([{ ...row, provider: 'homegrown' }]),
        version: '12',
        bundledVersion: 11,
      }),
    )
    expect(published).toBeNull()
  })

  it('rejects a version that does not exceed the bundle — a client would ignore it in silence', () => {
    for (const version of ['11', '10']) {
      expect(quiet(() => parseDeploymentModels({ raw: JSON.stringify([row]), version, bundledVersion: 11 }))).toBeNull()
    }
  })

  it('rejects a version that is not a number', () => {
    expect(
      quiet(() => parseDeploymentModels({ raw: JSON.stringify([row]), version: 'latest', bundledVersion: 11 })),
    ).toBeNull()
  })

  it('survives input that is not JSON', () => {
    expect(quiet(() => parseDeploymentModels({ raw: '{not json', version: '12', bundledVersion: 11 }))).toBeNull()
  })

  it('rejects input that is not an array', () => {
    expect(quiet(() => parseDeploymentModels({ raw: JSON.stringify(row), version: '12', bundledVersion: 11 }))).toBeNull()
  })

  it('rejects an empty array — that is a typo, not "publish zero models"', () => {
    expect(quiet(() => parseDeploymentModels({ raw: '[]', version: '12', bundledVersion: 11 }))).toBeNull()
  })

  it('fills optional fields so an entry can be written short', () => {
    const short = { id: 'short', name: 'Short row', provider: 'custom', model: 'm', url: 'https://example.test/v1' }
    const published = parseDeploymentModels({ raw: JSON.stringify([short]), version: '12', bundledVersion: 11 })
    const parsed = published?.data[0]
    expect(parsed?.enabled).toBe(1)
    expect(parsed?.isSystem).toBe(1)
    expect(parsed?.toolUsage).toBe(1)
    expect(parsed?.deletedAt).toBeNull()
    expect(parsed?.userId).toBeNull()
  })
})
