// Make: generate, save and edit decks and sheets. Non-personal requests go to the cheapest configured provider
// (make_draft_nonpersonal; never a provider that trains on inputs for drafts, per the policy router), Claude is the
// backstop. Public web snippets give the model real prices and facts; it never invents numbers.
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from '@/lib/agent/actor'
import { chatReply, editedReply, isMakeEdit, madeIdFromReply, makeDocRequest, type MakeDoc } from './documents'
import { editDoc, generateDoc } from './generate'

export const MAKE_TYPES = { deck: 'slide_deck', sheet: 'spreadsheet' } as const
export async function saveDoc(telegramId: number, doc: MakeDoc, request: string, sources: string[]) {
  const content_json = { format: doc.format, doc, request, sources, notes: '' }
  const row = (type: string) => ({
    telegram_id: String(telegramId), type, title: doc.title,
    subtitle: doc.format === 'deck' ? `${(doc as any).slides.length} slides` : `${(doc as any).rows.length} rows`,
    schema_version: 1, content_json, source_refs: [{ type: 'make_request' }],
  })
  let { data, error } = await supabaseAdmin.from('agent_artifacts').insert(row(MAKE_TYPES[doc.format])).select('id').single()
  // 24 Oct live: the type check constraint predates slide_deck/spreadsheet (migration 20261024120000 adds them).
  // Until it runs, save under research_brief; content_json.format still marks it as a deck or sheet everywhere.
  if (error && /agent_artifacts_type_check/.test(error.message || '')) {
    ({ data, error } = await supabaseAdmin.from('agent_artifacts').insert(row('research_brief')).select('id').single())
  }
  if (error || !data?.id) throw new Error(`make_save_failed:${error?.message || 'unknown'}`)
  return String(data.id)
}

export async function loadDoc(telegramId: number, id: string): Promise<{ doc: MakeDoc; content: any; owner: number } | null> {
  const { data } = await supabaseAdmin.from('agent_artifacts').select('type,content_json').eq('id', id).eq('telegram_id', String(telegramId)).maybeSingle()
  const content: any = data?.content_json
  const doc = content?.doc
  if (!doc || (doc.format !== 'deck' && doc.format !== 'sheet')) return null
  return { doc: doc as MakeDoc, content, owner: telegramId }
}

export async function updateDoc(telegramId: number, id: string, content: any, doc: MakeDoc, instruction: string) {
  const history = (Array.isArray(content?.history) ? content.history : []).slice(-9)
  history.push({ at: new Date().toISOString(), instruction: instruction.slice(0, 200), doc: content.doc })
  const { error } = await supabaseAdmin.from('agent_artifacts').update({
    title: doc.title, subtitle: doc.format === 'deck' ? `${(doc as any).slides.length} slides` : `${(doc as any).rows.length} rows`,
    content_json: { ...content, doc, history }, updated_at: new Date().toISOString(),
  }).eq('id', id).eq('telegram_id', String(telegramId))
  if (error) throw new Error(`make_update_failed:${error.message}`)
}

async function lastAssistantReply(telegramId: number) {
  const { data } = await supabaseAdmin.from('conversations').select('content').eq('telegram_id', telegramId).eq('role', 'assistant').order('created_at', { ascending: false }).limit(1)
  return String((data || [])[0]?.content || '')
}

/** Chat entry: a new deck/sheet, or a change to the one Gogo just made. Null when the message is neither. */
/** The dashboard owner id. 24 Oct live: on WhatsApp the actor's legacy id is the phone-based chat id, so decks made
 * there were saved under it and the dashboard (users.telegram_id) showed 404. Artifacts always use users.telegram_id. */
async function ownerTelegramId(actor: Pick<AgentActor, 'legacyTelegramId'> & { userId?: string }) {
  if (actor.userId) {
    try {
      const { data } = await supabaseAdmin.from('users').select('telegram_id').eq('id', actor.userId).maybeSingle()
      const tg = Number((data as any)?.telegram_id)
      if (Number.isFinite(tg) && tg) return tg
    } catch {}
  }
  return Number(actor.legacyTelegramId)
}

export async function handleMakeDoc(params: { actor: Pick<AgentActor, 'legacyTelegramId'> & { userId?: string }; text: string }): Promise<{ text: string; handledBy: string; status: string } | null> {
  const chatId = Number(params.actor.legacyTelegramId)
  const text = String(params.text || '').trim()
  const ask = makeDocRequest(text)
  if (ask) {
    const made = await generateDoc(ask.format, ask.request)
    if (!made) return { text: `I couldn't build that ${ask.format === 'deck' ? 'deck' : 'sheet'} just now. Try again in a minute, or tell me a bit more about what it should cover.`, handledBy: 'make-doc', status: 'failed' }
    const id = await saveDoc(await ownerTelegramId(params.actor), made.doc, ask.request, made.sources)
    return { text: chatReply(made.doc, id), handledBy: 'make-doc', status: 'completed' }
  }
  if (!isMakeEdit(text)) return null
  const id = madeIdFromReply(await lastAssistantReply(chatId))
  if (!id) return null
  const telegramId = await ownerTelegramId(params.actor)
  const loaded = await loadDoc(telegramId, id) || (telegramId !== chatId ? await loadDoc(chatId, id) : null)
  if (!loaded) return null
  const next = await editDoc(loaded.doc, text)
  if (!next) return { text: `I couldn't apply that change. Try saying it another way, like "make slide 2 shorter".`, handledBy: 'make-doc', status: 'failed' }
  await updateDoc(loaded.owner, id, loaded.content, next, text)
  return { text: editedReply(next, id), handledBy: 'make-doc', status: 'completed' }
}
