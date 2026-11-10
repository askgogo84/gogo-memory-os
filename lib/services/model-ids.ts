// One place for the Anthropic model ids AskGogo calls (8 Nov audit: 11 literal 'claude-sonnet-4-5' sites, ~35 haiku).
// 10 Nov hotfix: default back to claude-sonnet-4-5. Sonnet 5.5 (#1402) rejects forced tool_choice ('any'/'tool', used
// by the brain) with a 400, and its responses can open with a thinking block that content[0] readers treat as an empty
// reply; production WhatsApp replies failed. Move to 5.5 again only after those call sites are migrated and tested.
// GOGO_MODEL_SONNET still overrides per environment. Any id used here must have a row in brain.ts MODEL_PRICES.
export const SONNET_MODEL: string = (process.env.GOGO_MODEL_SONNET || '').trim() || 'claude-sonnet-4-5'
export const HAIKU_MODEL: string = (process.env.GOGO_MODEL_HAIKU || '').trim() || 'claude-haiku-4-5'

// ---- Sonnet 5.5 request compatibility (10 Nov) ------------------------------------------------------------------
// Verified from Anthropic's Sonnet 5.5 migration guide: the model runs adaptive thinking unless told otherwise (so the
// first content block can be a thinking block with empty text), returns 400 for temperature/top_p/top_k, for
// thinking {type:'disabled'|'enabled'}, for tool_choice 'any'/'tool' and for assistant prefill. Every Sonnet call goes
// through forModel() and reads text with textOf(), so the id can change by env without touching call sites.

/** Models with the Sonnet 5.5 request rules. */
export function isAdaptiveOnlyModel(model: unknown): boolean { return /^claude-sonnet-5-5/.test(String(model || '')) }

/** All text blocks joined; thinking, tool_use and other blocks are skipped. Never throws on odd shapes. */
export function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.filter((b: any) => b && b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('')
}

export type ModelEffort = 'low' | 'medium' | 'high'
/**
 * Make one messages.create() body valid for its model. For Sonnet 5.5: no up-front thinking (between_tools) at a low
 * effort unless the caller asks for more, sampling params removed, forced tool_choice turned into 'auto' (the caller
 * must say in the prompt that a tool is required and must handle a text answer). Other models pass through unchanged.
 */
export function forModel<T extends Record<string, any>>(params: T, opts: { effort?: ModelEffort } = {}): T {
  if (!isAdaptiveOnlyModel(params?.model)) return params
  const { temperature: _t, top_p: _p, top_k: _k, ...rest } = params as any
  const out: any = { ...rest, thinking: { type: 'between_tools' }, output_config: { ...(rest.output_config || {}), effort: opts.effort || 'low' } }
  if (out.tool_choice && (out.tool_choice.type === 'any' || out.tool_choice.type === 'tool')) out.tool_choice = { type: 'auto' }
  const last = Array.isArray(out.messages) ? out.messages[out.messages.length - 1] : null
  if (last && last.role === 'assistant') throw new Error('model_prefill_unsupported')
  return out as T
}
/** Appended to the system prompt when a forced tool call had to become 'auto'. */
export const TOOL_REQUIRED_NOTE = 'You must answer by calling exactly one of the provided tools. Do not answer in plain text.'
