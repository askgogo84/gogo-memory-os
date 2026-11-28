// Inert, process-local reservation reference implementation. Not a distributed ledger.
// Call IDs must be unique per attempt; caller must reserve before each provider/tool attempt.
// Monetary units are integer micro-INR (one millionth of a rupee), rounded up by the caller.
export type ExecutionBudgetLimits = Readonly<{ maxSteps: number; maxCostMicrosInr: number; deadlineMs: number }>
type Denial = 'invalid' | 'duplicate' | 'deadline' | 'steps' | 'cost' | 'breach'
export type ReservationDecision = { ok: true } | { ok: false; reason: Denial }
type Entry = { estimate: number; status: 'reserved' | 'settled' | 'unknown'; charge: number }
const valid = (n: number): boolean => Number.isSafeInteger(n) && n >= 0

export class ExecutionBudget {
  private readonly calls = new Map<string, Entry>()
  private used = 0
  private breached = false
  private readonly limits: ExecutionBudgetLimits
  constructor(limits: ExecutionBudgetLimits, private readonly clock: () => number = Date.now) {
    if (!valid(limits.maxSteps) || limits.maxSteps < 1 || !valid(limits.maxCostMicrosInr) || !valid(limits.deadlineMs)) throw new Error('invalid execution budget')
    this.limits = { ...limits }
  }

  reserve(callId: string, estimateMicrosInr: number | null): ReservationDecision {
    if (this.breached) return { ok: false, reason: 'breach' }
    if (!callId || callId.length > 200 || estimateMicrosInr === null || !valid(estimateMicrosInr)) return { ok: false, reason: 'invalid' }
    if (this.calls.has(callId)) return { ok: false, reason: 'duplicate' }
    const now = this.clock()
    if (!valid(now) || now >= this.limits.deadlineMs) return { ok: false, reason: 'deadline' }
    if (this.calls.size >= this.limits.maxSteps) return { ok: false, reason: 'steps' }
    if (estimateMicrosInr > this.limits.maxCostMicrosInr - this.used) return { ok: false, reason: 'cost' }
    this.calls.set(callId, { estimate: estimateMicrosInr, status: 'reserved', charge: estimateMicrosInr })
    this.used += estimateMicrosInr
    return { ok: true }
  }

  // Unknown outcomes retain their full reservation. An underestimated call halts further
  // work even if the overall cap still has headroom. No retry or authorization is implied.
  settle(callId: string, actualMicrosInr: number | null): void {
    const e = this.calls.get(callId)
    if (!e || e.status !== 'reserved') throw new Error('unknown or finalized reservation')
    if (actualMicrosInr === null) { e.status = 'unknown'; return }
    const next = this.used - e.charge + actualMicrosInr
    if (!valid(actualMicrosInr) || !valid(next)) {
      this.breached = true
      e.status = 'unknown'
      throw new Error('invalid settlement; budget halted')
    }
    if (actualMicrosInr > e.estimate || next > this.limits.maxCostMicrosInr) this.breached = true
    this.used = next
    e.charge = actualMicrosInr
    e.status = 'settled'
  }

  snapshot() {
    return { steps: this.calls.size, committedCostMicrosInr: this.used, breached: this.breached,
      unresolved: [...this.calls.values()].filter(e => e.status !== 'settled').length }
  }
}
