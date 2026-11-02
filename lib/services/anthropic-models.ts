import type Anthropic from '@anthropic-ai/sdk'

/** Native API models reviewed for this path. Retired overrides cannot revive Sonnet 4.5. */
export const SONNET_MODEL = 'claude-sonnet-5-5'
export const DOCUMENT_FALLBACK_MODEL = 'claude-sonnet-4-6'
const BRAIN_MODELS = new Set([SONNET_MODEL, DOCUMENT_FALLBACK_MODEL, 'claude-haiku-4-5', 'claude-haiku-5-5'])
export function resolveBrainModel(value?: string): string {
  const model = value?.trim() || SONNET_MODEL
  if (/^claude-sonnet-4-5(?:-20250929)?$/.test(model)) return SONNET_MODEL
  if (!BRAIN_MODELS.has(model)) throw new Error('unsupported_brain_model')
  return model
}
export function isBrainModel(model: string): boolean { return BRAIN_MODELS.has(model) }

/** Keep the existing small output budgets usable: no up-front reasoning for one-shot calls.
 * SDK 0.90 predates between_tools; this narrow wire-type bridge is intentional (no SDK upgrade).
 * https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide
 */
export function modelOptions(model: string) {
  if (model !== SONNET_MODEL) return { model }
  const thinking = { type: 'between_tools' } as unknown as Anthropic.ThinkingConfigParam
  return { model, thinking, output_config: { effort: 'low' as const } }
}
export function sonnetOptions() { return modelOptions(SONNET_MODEL) }

/** Thinking can precede text. Refused/truncated results must not become a completed answer. */
export function messageText(message: { content?: readonly { type: string; text?: string }[]; stop_reason?: string | null }): string {
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded') return ''
  return (message.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n').trim()
}
