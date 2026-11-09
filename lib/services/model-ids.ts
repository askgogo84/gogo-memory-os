// One place for the Anthropic model ids AskGogo calls (8 Nov audit: 11 literal 'claude-sonnet-4-5' sites, ~35 haiku).
// 9 Nov: Sonnet default moved from claude-sonnet-4-5 to claude-sonnet-5-5 (owner-approved, supersedes #1208's 7-file
// rewrite). Rollback without a deploy of code: set GOGO_MODEL_SONNET=claude-sonnet-4-5 in Vercel and redeploy.
// Any id used here must have a row in brain.ts MODEL_PRICES so spend stays metered.
export const SONNET_MODEL: string = (process.env.GOGO_MODEL_SONNET || '').trim() || 'claude-sonnet-5-5'
export const HAIKU_MODEL: string = (process.env.GOGO_MODEL_HAIKU || '').trim() || 'claude-haiku-4-5'
