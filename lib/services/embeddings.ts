import OpenAI from 'openai'

// Reuses the existing OPENAI_API_KEY already used across the app.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIM = 1536

/**
 * Embed a single piece of text -> 1536-dim vector.
 * Truncates to ~2000 chars (well under the model limit, keeps cost predictable).
 */
export async function embedText(text: string): Promise<number[]> {
  const input = (text || '').slice(0, 2000).trim()
  if (!input) throw new Error('embedText: empty input')
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input })
  const vec = res.data?.[0]?.embedding
  if (!vec || vec.length !== EMBEDDING_DIM) {
    throw new Error(`embedText: unexpected embedding dim ${vec?.length}`)
  }
  return vec as number[]
}
