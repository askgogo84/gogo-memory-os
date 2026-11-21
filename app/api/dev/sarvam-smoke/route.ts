// Live provider smoke test for the Sarvam adapter (21 Nov). NEVER merged to main.
// It answers only on a Vercel PREVIEW build of a branch named integration/sarvam-smoke…, which sits behind Vercel
// Authentication. It reads nothing from the caller, sends fixed synthetic prompts only (no user data, no memory, no
// identifiers), performs no action, and returns pass/fail, latency and token counts. No key, header or provider body is returned.
import { NextResponse } from 'next/server'
import { sarvamChat, sarvamPrismIntentShadow, SarvamProviderError } from '@/lib/services/sarvam'
import { sarvamTextToSpeech, sarvamSpeechToText } from '@/lib/services/sarvam-voice'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Check = { name: string; ok: boolean; ms: number; detail: Record<string, unknown> }
const clip = (v: unknown, n = 220) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

async function run(name: string, fn: () => Promise<Record<string, unknown>>): Promise<Check> {
  const t0 = Date.now()
  try { const detail = await fn(); return { name, ok: true, ms: Date.now() - t0, detail } }
  catch (e) { return { name, ok: false, ms: Date.now() - t0, detail: { error: e instanceof SarvamProviderError ? e.message : 'unexpected_error' } } }
}

export async function GET() {
  const env = process.env
  if (env.VERCEL_ENV !== 'preview' || !String(env.VERCEL_GIT_COMMIT_REF || '').startsWith('integration/sarvam-smoke'))
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  const keyPresent = !!env.SARVAM_API_KEY
  const checks: Check[] = [{ name: 'key_present_in_preview', ok: keyPresent, ms: 0, detail: {} }]
  if (keyPresent) {
    const say = (model: 'sarvam-105b' | 'sarvam-105b-conversations', content: string, maxTokens = 200) => async () => {
      const r = await sarvamChat({ model, messages: [{ role: 'user', content }], maxTokens, timeoutMs: 30_000 })
      return { text: clip(r.text), in: r.usage.inputTokens, out: r.usage.outputTokens, paise: r.usage.estimatedCostPaise }
    }
    checks.push(await run('chat_105b_english', say('sarvam-105b', 'Reply with exactly the two letters: OK')))
    for (const [lang, prompt] of [
      ['hinglish', 'Kal subah 9 baje Divya ko call karna hai. Ek chhoti line mein Hinglish mein confirm karo.'],
      ['hindi', 'कल सुबह 9 बजे दिव्या को फोन करना है। एक छोटी पंक्ति में हिंदी में पुष्टि करें।'],
      ['kannada', 'ನಾಳೆ ಬೆಳಿಗ್ಗೆ 9 ಗಂಟೆಗೆ ದಿವ್ಯಾಗೆ ಕರೆ ಮಾಡಬೇಕು. ಒಂದು ಚಿಕ್ಕ ಸಾಲಿನಲ್ಲಿ ಕನ್ನಡದಲ್ಲಿ ದೃಢೀಕರಿಸಿ.'],
      ['tamil', 'நாளை காலை 9 மணிக்கு திவ்யாவை அழைக்க வேண்டும். ஒரு சிறிய வரியில் தமிழில் உறுதிப்படுத்தவும்.'],
      ['telugu', 'రేపు ఉదయం 9 గంటలకు దివ్యకు కాల్ చేయాలి. ఒక చిన్న వాక్యంలో తెలుగులో నిర్ధారించండి.'],
    ] as const) checks.push(await run(`chat_conversations_${lang}`, say('sarvam-105b-conversations', prompt)))
    const reminderTool = { name: 'set_reminder', description: 'Prepare a reminder for the person to approve.', input_schema: { type: 'object', properties: { task: { type: 'string' }, when: { type: 'string' } }, required: ['task', 'when'] } }
    checks.push(await run('chat_105b_forced_tool', async () => {
      const r = await sarvamChat({ model: 'sarvam-105b', messages: [{ role: 'user', content: 'Remind me to pay the electricity bill tomorrow at 9 am.' }], tools: [reminderTool], toolChoice: 'required', maxTokens: 300, timeoutMs: 30_000 })
      return { tool: r.tool?.name || null, input: clip(JSON.stringify(r.tool?.input || {})), in: r.usage.inputTokens, out: r.usage.outputTokens, paise: r.usage.estimatedCostPaise }
    }))
    // Approval boundary: with no tool allowed, a request to pay must come back as text (or fail closed), never as a tool call.
    checks.push(await run('chat_105b_tool_forbidden', async () => {
      const r = await sarvamChat({ model: 'sarvam-105b', messages: [{ role: 'user', content: 'Pay my electricity bill of 2,000 rupees right now.' }], tools: [reminderTool], toolChoice: 'none', maxTokens: 200, timeoutMs: 30_000 })
      if (r.tool) throw new SarvamProviderError('tool_returned_when_forbidden')
      return { text: clip(r.text) }
    }))
    for (const text of ['remind me to call Divya tomorrow at 9', 'pay 2000 rupees to Nithin now', 'what is on my calendar today'])
      checks.push(await run(`prism_intent:${text.slice(0, 24)}`, async () => ({ ...(await sarvamPrismIntentShadow(text, { timeoutMs: 20_000 })) })))
    for (const model of ['bulbul:v3', 'bulbul:v4-flash'] as const) {
      let audio: Buffer | null = null
      checks.push(await run(`tts_${model}`, async () => { audio = await sarvamTextToSpeech('Namaste. Yeh AskGogo ka ek chhota test hai. Kal subah nau baje Divya ko call karna hai.', { model, timeoutMs: 40_000 }); return { bytes: audio.length } }))
      if (audio) for (const mode of [undefined, 'codemix'] as const)
        checks.push(await run(`stt_saaras_v4_${mode || 'default'}_of_${model}`, async () => { const r = await sarvamSpeechToText(audio!, 'audio/mpeg', { ...(mode ? { mode } : {}), timeoutMs: 40_000 }); return { transcript: clip(r.text), language: r.languageCode } }))
    }
  }
  const passed = checks.filter(c => c.ok).length
  return NextResponse.json({ ok: passed === checks.length, passed, total: checks.length, at: new Date().toISOString(), commit: String(env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7), checks }, { headers: { 'Cache-Control': 'no-store' } })
}
