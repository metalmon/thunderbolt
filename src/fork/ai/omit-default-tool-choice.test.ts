import { describe, expect, it } from 'bun:test'

import { omitDefaultToolChoice } from './omit-default-tool-choice'

describe('omitDefaultToolChoice', () => {
  it('drops tool_choice when it carries the spec default', () => {
    const body = omitDefaultToolChoice({ model: 'm', tools: [{ type: 'function' }], tool_choice: 'auto' })
    expect('tool_choice' in body).toBe(false)
  })

  it('keeps required — dropping it would change behaviour', () => {
    expect(omitDefaultToolChoice({ tool_choice: 'required' }).tool_choice).toBe('required')
  })

  it('keeps none', () => {
    expect(omitDefaultToolChoice({ tool_choice: 'none' }).tool_choice).toBe('none')
  })

  it('keeps a named function choice', () => {
    const choice = { type: 'function', function: { name: 'cancel_order' } }
    expect(omitDefaultToolChoice({ tool_choice: choice }).tool_choice).toEqual(choice)
  })

  it('leaves every other field alone', () => {
    const body = { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true, temperature: 0.2 }
    expect(omitDefaultToolChoice({ ...body, tool_choice: 'auto' })).toEqual(body)
  })

  it('passes a body without tool_choice through', () => {
    const body = { model: 'm', stream: true }
    expect(omitDefaultToolChoice(body)).toEqual(body)
  })

  it('does not mutate the body it was given', () => {
    const body = { model: 'm', tool_choice: 'auto' }
    omitDefaultToolChoice(body)
    expect(body.tool_choice).toBe('auto')
  })
})
