// One place for the Anthropic model ids AskGogo calls (8 Nov audit: 11 literal 'claude-sonnet-4-5' sites, ~35 haiku).
// 10 Nov hotfix: default back to claude-sonnet-4-5. Sonnet 5.5 (#1402) rejects forced tool_choice ('any'/'tool', used
// by the brain) with a 400, and its responses can open with a thinking block that content[0] readers treat as an empty
// reply; production WhatsApp replies failed. Move to 5.5 again only after those call sites are migrated and tested.
// GOGO_MODEL_SONNET still overrides per environment. Any id used here must have a row in brain.ts MODEL_PRICES.
export const SONNET_MODEL: string = (process.env.GOGO_MODEL_SONNET || '').trim() || 'claude-sonnet-4-5'
export const HAIKU_MODEL: string = (process.env.GOGO_MODEL_HAIKU || '').trim() || 'claude-haiku-4-5'
