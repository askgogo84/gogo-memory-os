// One place for the Anthropic model ids AskGogo calls (8 Nov audit: 11 literal 'claude-sonnet-4-5' sites, ~35 haiku).
// The default values are unchanged. GOGO_MODEL_SONNET / GOGO_MODEL_HAIKU let a vendor-verified id be rolled out behind a
// flag per environment; changing the id here is not authorization to raise spend — cost tables in brain.ts must know it.
export const SONNET_MODEL: string = (process.env.GOGO_MODEL_SONNET || '').trim() || 'claude-sonnet-4-5'
export const HAIKU_MODEL: string = (process.env.GOGO_MODEL_HAIKU || '').trim() || 'claude-haiku-4-5'
