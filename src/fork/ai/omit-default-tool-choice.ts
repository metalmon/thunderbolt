/**
 * Drop `tool_choice` from a request body when it carries the spec default.
 *
 * The AI SDK core sets `toolChoice: { type: 'auto' }` as soon as a call has
 * tools, so `tool_choice: "auto"` rides every tool-bearing request even though
 * nothing asked for it. Gateways that claim OpenAI compatibility but validate
 * against a simplified schema choke on exactly that field: its type is a union
 * (`string | object`) and their validator cannot represent one. The case this
 * was written for answered `400 Type 'mixed' is unexpected` to any value of it,
 * and to nothing else — content part arrays, `tools`, `stream`,
 * `stream_options`, `parallel_tool_calls` and a `system` role all passed.
 *
 * Why this is not a per-server hack: in the OpenAI spec an absent `tool_choice`
 * alongside `tools` IS `auto`, so removing it is a provable no-op for any
 * compliant upstream. That also draws the boundary — only `auto` is removed,
 * while `required`, `none` and a named function pass through untouched, because
 * removing those would change behaviour.
 *
 * Hence no configuration: nothing to switch on, nothing for an operator to
 * know. Installed through `transformRequestBody`, the hook
 * `@ai-sdk/openai-compatible` documents for proxy providers that need a
 * slightly different request format.
 */
export const omitDefaultToolChoice = (body: Record<string, unknown>): Record<string, unknown> => {
  if (body.tool_choice !== 'auto') {
    return body
  }
  const { tool_choice: _dropped, ...rest } = body
  return rest
}
