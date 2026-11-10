// Turns one organizer message into one typed event action, using the small fast model with a forced tool call.
// The model fills only what the person stated. It does not write replies, compute headcounts or touch the database.
import Anthropic from '@anthropic-ai/sdk'
import { FAST_MODEL } from '@/lib/agent/brain'
import { forModel } from '@/lib/services/model-ids'
import { recordMeterEvent } from '@/lib/metering/record'
import type { EventAction, Extractor } from './entry'

const ACTIONS = ['none', 'create', 'update', 'publish', 'cancel', 'add_guests', 'headcount', 'pending', 'link', 'list'] as const
export const EVENT_TOOL: Anthropic.Tool = {
  name: 'event_action',
  description: 'The single action the organizer is asking for about an event they are hosting.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...ACTIONS], description: 'none = not about hosting or managing their own event (booking a table, a reminder, a question, anything else). create = start a new event. update = change the open event (date, time, place, name, size, or move it). publish = make the invitation live / get the link. cancel = cancel the open event. add_guests = add named people. headcount = how many are coming. pending = who has not replied. link = show the invitation link again. list = list their events.' },
      title: { type: 'string', description: 'Short event name in the person\'s words, e.g. "Divya\'s birthday". Only if stated or obvious from the occasion.' },
      kind: { type: 'string', enum: ['birthday', 'anniversary', 'dinner', 'outing', 'meeting', 'other'] },
      date: { type: 'string', description: 'YYYY-MM-DD in the organizer\'s timezone. Only if a date or a relative day was stated. Resolve relative days from today.' },
      time: { type: 'string', description: 'HH:MM, 24-hour, organizer\'s timezone. Only if a time was stated.' },
      shift_minutes: { type: 'integer', description: 'For "move it by one hour" style requests with no absolute date or time: minutes to move, negative for earlier.' },
      venue_name: { type: 'string', description: 'Place name only if stated ("Toit Indiranagar", "at home" -> "Home").' },
      venue_address: { type: 'string' }, online_url: { type: 'string' }, host_name: { type: 'string' }, dress_code: { type: 'string' }, description: { type: 'string' },
      capacity: { type: 'integer', description: 'Number of people only if stated.' },
      max_plus_ones: { type: 'integer', description: 'Only if the organizer said guests may bring others, and how many.' },
      guests: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' } }, required: ['name'] } },
    },
    required: ['action'],
  },
}

export function extractionSystem(input: { today: string; weekday: string; timezone: string; active: string | null }): string {
  return [
    'You read one message from a person who uses an assistant to host events (parties, dinners, outings, get-togethers) and return exactly one event_action.',
    `Today is ${input.weekday}, ${input.today} in ${input.timezone}.`,
    input.active ? `Their open event: ${input.active}. A short message with no other subject (a place, a time, "publish", "move it to Sunday") is about this event.` : 'They have no open event.',
    'Rules:',
    '- Fill a field only if the person stated it. Never invent a date, time, place, name or number.',
    '- "next Sunday" means the first Sunday after today that is at least 2 days away; "this Saturday" means the coming Saturday.',
    '- Booking a restaurant table, ordering, a personal reminder, a calendar meeting with one person, or any question that is not about an event they are hosting: action "none".',
    '- If unsure whether it is about hosting an event: action "none".',
  ].join('\n')
}

export function actionFromToolInput(input: unknown): EventAction | null {
  const a = input as EventAction
  if (!a || typeof a !== 'object' || !(ACTIONS as readonly string[]).includes(String(a.action))) return null
  return a
}

export const extractEventAction: Extractor = async (input) => {
  const t0 = Date.now()
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const res: any = await client.messages.create(forModel({
    model: FAST_MODEL, max_tokens: 500, system: extractionSystem(input), tools: [EVENT_TOOL], tool_choice: { type: 'tool' as const, name: EVENT_TOOL.name },
    messages: [{ role: 'user' as const, content: input.text.slice(0, 1200) }],
  }), { timeout: 12_000 })
  void recordMeterEvent({ vendor: 'anthropic', category: 'llm', model: FAST_MODEL, inputTokens: res?.usage?.input_tokens ?? null, outputTokens: res?.usage?.output_tokens ?? null, ok: true, metadata: { source: 'event_extract', ms: Date.now() - t0 } } as any)
  const use = Array.isArray(res?.content) ? res.content.find((b: any) => b?.type === 'tool_use' && b.name === EVENT_TOOL.name) : null
  return actionFromToolInput(use?.input)
}
