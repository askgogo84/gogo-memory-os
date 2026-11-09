// The first registered skills: wrappers over capabilities AskGogo already has. Nothing here does anything new;
// each handler calls the existing module and returns the shape its schema promises. Registering is idempotent.
import { registerSkill, skillDefinition, type SkillDefinition, type SkillHandler } from './skill-registry'

type Builtin = { def: SkillDefinition; handler: SkillHandler }

const ORDER_ID = /^[A-Za-z0-9-]{1,40}$/

export const BUILTIN_SKILLS: Builtin[] = [
  {
    def: {
      id: 'merchant.order.accept', sopVersion: '1.0.0', title: 'Accept a Tipplr order', purpose: 'Accept one new order for the acting outlet with a prep time; Done only after Tipplr reads back accepted.',
      input: { outletId: { type: 'string', required: true, maxLength: 60 }, orderId: { type: 'string', required: true, pattern: ORDER_ID }, prepMinutes: { type: 'number', required: true, integer: true, min: 5, max: 90 } },
      output: { state: { type: 'string', required: true }, text: { type: 'string', required: true } },
      limits: { maxSteps: 3, maxMinutes: 1, maxCostPaise: 0 }, requiredCapabilities: ['merchant'], exactActionApproval: true, evidence: ['provider_readback', 'http_status'], risk: 'medium', irreversible: true,
    },
    handler: async (input, ctx) => {
      const { acceptOrder } = await import('@/lib/enterprise/tipplr/actions')
      const adapter = (input as any).__adapter // test/preview seam; production callers pass the adapter through ctx-bound closures
      if (!adapter) throw new Error('merchant adapter not bound')
      const r = await acceptOrder(adapter, ctx.telegramId, String(input.orderId), Number(input.prepMinutes), undefined, String(input.outletId))
      return { state: r.record.state, text: r.text }
    },
  },
  {
    def: {
      id: 'merchant.order.reject', sopVersion: '1.0.0', title: 'Reject a Tipplr order', purpose: 'Reject one new order for the acting outlet with a reason; verified by read-back.',
      input: { outletId: { type: 'string', required: true, maxLength: 60 }, orderId: { type: 'string', required: true, pattern: ORDER_ID }, reason: { type: 'string', required: true, enum: ['out_of_stock', 'no_response'] } },
      output: { state: { type: 'string', required: true }, text: { type: 'string', required: true } },
      limits: { maxSteps: 3, maxMinutes: 1, maxCostPaise: 0 }, requiredCapabilities: ['merchant'], exactActionApproval: true, evidence: ['provider_readback', 'http_status'], risk: 'medium', irreversible: true,
    },
    handler: async (input, ctx) => {
      const { rejectOrder } = await import('@/lib/enterprise/tipplr/actions')
      const adapter = (input as any).__adapter
      if (!adapter) throw new Error('merchant adapter not bound')
      const r = await rejectOrder(adapter, ctx.telegramId, String(input.orderId), input.reason as any, undefined, String(input.outletId))
      return { state: r.record.state, text: r.text }
    },
  },
  {
    def: {
      id: 'merchant.ops.digest', sopVersion: '1.0.0', title: 'Tipplr ops digest', purpose: "Yesterday's orders, revenue, cancellations and top out-of-stock outlets, every figure from the ledger.",
      input: {}, output: { text: { type: 'string', required: true } },
      limits: { maxSteps: 2, maxMinutes: 2, maxCostPaise: 0 }, requiredCapabilities: ['merchant'], exactActionApproval: false, evidence: ['none'], risk: 'low', irreversible: false,
    },
    handler: async (input, ctx) => {
      const dg = await import('@/lib/enterprise/tipplr/digest')
      const adapter = (input as any).__adapter, store = (input as any).__store
      if (!adapter || !store) throw new Error('merchant adapter not bound')
      return { text: dg.formatDigest(await dg.buildDigest(adapter, store, ctx.now)) }
    },
  },
  {
    def: {
      id: 'people.brief', sopVersion: '1.0.0', title: 'Who is this person', purpose: 'A short brief on a person from calendar, mail and notes the owner already connected; nothing is fetched from outside.',
      input: { name: { type: 'string', required: true, maxLength: 80 } }, output: { text: { type: 'string', required: true } },
      limits: { maxSteps: 3, maxMinutes: 1, maxCostPaise: 0 }, requiredCapabilities: ['contacts', 'email', 'calendar'], exactActionApproval: false, evidence: ['none'], risk: 'low', irreversible: false,
    },
    handler: async (input) => {
      const p = await import('@/lib/agent/people')
      const actor = (input as any).__actor
      if (!actor) throw new Error('actor not bound')
      const brief = await p.tryPersonAsk(actor, `what do I know about ${String(input.name)}?`)
      return { text: brief || `I don't have anything on ${String(input.name)} yet.` }
    },
  },
  {
    def: {
      id: 'thread.reply', sopVersion: '1.0.0', title: 'Reply to an open alert thread', purpose: 'Resolve a short reply (paid / check again / track / open / ignore / later) against the latest proactive alert.',
      input: { text: { type: 'string', required: true, maxLength: 160 } }, output: { text: { type: 'string' }, handled: { type: 'boolean', required: true } },
      limits: { maxSteps: 3, maxMinutes: 1, maxCostPaise: 0 }, requiredCapabilities: ['email', 'reminders'], exactActionApproval: false, evidence: ['none'], risk: 'low', irreversible: false,
    },
    handler: async (input, ctx) => {
      const ot = await import('@/lib/agent/open-thread')
      const actor = (input as any).__actor
      if (!actor) throw new Error('actor not bound')
      const r = await ot.tryThreadReply(actor, String(input.text), ctx.now)
      return r ? { text: r, handled: true } : { handled: false }
    },
  },
]

// Inputs carry bound dependencies under __ keys only from trusted callers; the schemas above do not list them, so a
// skill invoked with an unknown __adapter from an untrusted shape fails validation before the handler sees it. Trusted
// callers bind through bindSkillInput() which strips and re-attaches after validation.
export function bindSkillInput(input: Record<string, unknown>, bindings: Record<`__${string}`, unknown>): { forValidation: Record<string, unknown>; forHandler: Record<string, unknown> } {
  const forValidation: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) if (!k.startsWith('__')) forValidation[k] = v
  return { forValidation, forHandler: { ...forValidation, ...bindings } }
}

let registered = false
/** Registers the builtin skills once per process. Safe to call from any entry point. */
export function ensureBuiltinSkills(): number {
  if (registered) return BUILTIN_SKILLS.length
  for (const b of BUILTIN_SKILLS) if (!skillDefinition(b.def.id)) registerSkill(b.def, b.handler)
  registered = true
  return BUILTIN_SKILLS.length
}
