import { AsyncLocalStorage } from 'node:async_hooks'

// QA runs post simulated WhatsApp messages whose MessageSid starts with "SMqa". Only for those,
// the replies Gogo sends are logged (QA_REPLY) so a test can read them without a phone.
const store = new AsyncLocalStorage<{ sid: string }>()

export const isQaSid = (sid: string) => /^SMqa[0-9a-z]{4,40}$/i.test(String(sid || ''))

export function runWithQaTrace<T>(sid: string, fn: () => Promise<T>): Promise<T> {
  return isQaSid(sid) ? store.run({ sid }, fn) : fn()
}

export function qaTraceReply(text: string) {
  const ctx = store.getStore()
  if (!ctx) return
  console.log('QA_REPLY:', JSON.stringify({ sid: ctx.sid, text: String(text || '').slice(0, 1500) }))
}
