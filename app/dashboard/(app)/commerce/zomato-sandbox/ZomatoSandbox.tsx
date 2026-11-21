'use client'

import {useState} from 'react'
import {
  SANDBOX_MENU, SANDBOX_RESTAURANTS,
  advanceSandbox, newSandboxState, sandboxQuote,
  type SandboxEvent,
} from '@/lib/commerce/partner-bridge/zomato-sandbox-demo'

const rupees = (minor: number) => '₹' + (minor / 100).toLocaleString('en-IN', {minimumFractionDigits: 2})
const button = 'rounded-xl border border-[#454545] bg-[#232323] px-4 py-2.5 text-sm font-medium hover:bg-[#303030] disabled:cursor-not-allowed disabled:opacity-40'
const heading = 'text-sm font-semibold uppercase tracking-wide text-[#a7a7a7]'

export default function ZomatoSandbox() {
  const [state, setState] = useState(newSandboxState)
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState('')
  const quote = sandboxQuote(state)
  const chosen = SANDBOX_RESTAURANTS.find(r => r.id === state.restaurantId)
  const final = state.stage === 'fixture_completed' || state.stage === 'fixture_failed'
  const submitted = state.stage === 'outcome_unknown' || final
  function apply(event: SandboxEvent) {
    try {
      const next = advanceSandbox(state, event)
      setState(next)
      setError('')
      if (event.type === 'select' || event.type === 'quantity' || event.type === 'review' || event.type === 'reset') {
        setApproved(false)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Synthetic workflow blocked.')
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8 text-[#f1f1f1]">
      <div className="rounded-2xl border border-amber-800/50 bg-[#2c2116] p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-300">AskGogo × Zomato MCP • Synthetic owner test</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Food ordering journey lab</h1>
        <p className="mt-3 text-sm leading-6 text-[#e0ceba]">
          Every restaurant, menu, price, connection, payment and outcome here is a local fixture.
          No Zomato authentication, MCP calls, real cart, order, payment or provider receipt occurs.
          This preview tests the product experience, not live partner access.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-full border border-[#3b3b3b] px-3 py-1 text-[#bdbdbd]">
          Stage: {state.stage.replaceAll('_', ' ')}
        </span>
        <span className="text-[#aaa]">Synthetic submission attempts: {state.submissionCount}</span>
        <button className={button} onClick={() => apply({type: 'reset'})}>Start new test</button>
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-600/40 bg-red-950/30 p-3 text-sm text-red-200">{error}</p>}

      <section className="rounded-2xl border border-[#303030] bg-[#161616] p-5">
        <h2 className={heading}>1. Simulated account connection</h2>
        <p className="mt-2 text-sm text-[#a4a4a4]">
          This is a fixture-only toggle, not OAuth or permission to access a Zomato account.
        </p>
        <button className={button + ' mt-4'} disabled={state.connected || state.stage !== 'discover'}
          onClick={() => apply({type: 'connect'})}>
          {state.connected ? 'Simulated connection active' : 'Enable simulated connection'}
        </button>
      </section>

      <section className="rounded-2xl border border-[#303030] bg-[#161616] p-5">
        <h2 className={heading}>2. Discover a restaurant</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SANDBOX_RESTAURANTS.map(r => (
            <button key={r.id} disabled={!state.connected || submitted}
              onClick={() => apply({type: 'select', restaurantId: r.id})}
              className={'rounded-xl border p-4 text-left disabled:opacity-40 ' +
                (state.restaurantId === r.id ? 'border-amber-500 bg-[#35281b]' : 'border-[#393939] bg-[#202020] hover:bg-[#282828]')}>
              <strong className="block text-base">{r.name}</strong>
              <span className="mt-1 block text-xs text-[#b4b4b4]">{r.cuisine} · {r.area}</span>
              <span className="mt-2 block text-xs text-amber-300">DEMO DATA — NOT A LIVE LISTING</span>
            </button>
          ))}
        </div>
      </section>

      {chosen && <section className="rounded-2xl border border-[#303030] bg-[#161616] p-5">
        <h2 className={heading}>3. Explore menu and build cart</h2>
        <p className="mt-2 text-sm text-[#c4c4c4]">{chosen.name} · simulated menu</p>
        <div className="mt-4 space-y-3">
          {SANDBOX_MENU.filter(i => i.restaurant === chosen.id).map(i => (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-[#303030] p-3" key={i.id}>
              <div><p className="font-medium">{i.name}</p><p className="text-xs text-[#a5a5a5]">{rupees(i.minor)}</p></div>
              <div className="flex items-center gap-3">
                <button aria-label={'Remove one ' + i.name} className={button}
                  disabled={submitted || !(state.quantities[i.id] || 0)}
                  onClick={() => apply({type: 'quantity', itemId: i.id, quantity: Math.max(0, (state.quantities[i.id] || 0) - 1)})}>−</button>
                <span className="min-w-4 text-center">{state.quantities[i.id] || 0}</span>
                <button aria-label={'Add one ' + i.name} className={button}
                  disabled={submitted || (state.quantities[i.id] || 0) >= 5}
                  onClick={() => apply({type: 'quantity', itemId: i.id, quantity: (state.quantities[i.id] || 0) + 1})}>+</button>
              </div>
            </div>
          ))}
        </div>
      </section>}

      {chosen && <section className="rounded-2xl border border-[#303030] bg-[#161616] p-5">
        <h2 className={heading}>4. Exact cart review (fixture)</h2>
        <div className="mt-4 space-y-2 text-sm">
          {quote.items.length ? quote.items.map(i =>
            <div key={i.id} className="flex justify-between gap-4"><span>{i.quantity} × {i.name}</span><span>{rupees(i.minor * i.quantity)}</span></div>
          ) : <p className="text-[#999]">Your simulated cart is empty.</p>}
          <div className="flex justify-between pt-3 text-[#b3b3b3]"><span>Subtotal</span><span>{rupees(quote.subtotalMinor)}</span></div>
          <div className="flex justify-between text-[#b3b3b3]"><span>Illustrative tax (5%)</span><span>{rupees(quote.taxMinor)}</span></div>
          <div className="flex justify-between text-[#b3b3b3]"><span>Illustrative delivery fee</span><span>{rupees(quote.deliveryMinor)}</span></div>
          <div className="flex justify-between border-t border-[#3e3e3e] pt-3 text-lg font-bold"><span>Demo total</span><span>{rupees(quote.totalMinor)}</span></div>
        </div>
        {!submitted && <button className={button + ' mt-4'} disabled={!quote.items.length}
          onClick={() => apply({type: 'review'})}>Review this synthetic quote</button>}
        {state.stage === 'review' && <>
          <label className="mt-5 flex items-start gap-3 rounded-xl border border-amber-700/40 bg-[#2b221a] p-4 text-sm">
            <input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)}
              className="mt-1" />
            <span>I explicitly approve <strong>one simulated submission</strong> for {rupees(quote.totalMinor)}. I understand nothing will be ordered or charged.</span>
          </label>
          <button className={button + ' mt-3'} disabled={!approved} onClick={() => apply({
            type: 'approve', explicitlyApproved: approved, displayedSnapshot: quote.snapshot,
          })}>Simulate one approved submission</button>
        </>}
      </section>}

      {chosen && <section className="rounded-2xl border border-[#303030] bg-[#161616] p-5">
        <h2 className={heading}>5. One-attempt outcome &amp; readback</h2>
        <p className="mt-2 text-sm text-[#b1b1b1]">
          A simulated accept/timeout never means the order succeeded. The state first becomes
          unknown, and only a separate mock readback determines the fixture outcome.
        </p>
        {!submitted && <div className="mt-4">
          <label htmlFor="scenario" className="mb-2 block text-xs text-[#aaa]">Choose a synthetic provider response</label>
          <select id="scenario" className="w-full rounded-lg border border-[#555] bg-[#222] p-3 text-sm"
            value={state.scenario} disabled={!chosen}
            onChange={e => apply({type: 'scenario', value: e.target.value as 'completed' | 'failed' | 'pending'})}>
            <option value="completed">Fixture readback: completed</option>
            <option value="failed">Fixture readback: failed</option>
            <option value="pending">Fixture readback: still pending</option>
          </select>
        </div>}
        {state.stage === 'outcome_unknown' && <>
          <p className="mt-4 rounded-xl border border-amber-600/50 bg-[#2c261b] p-3 text-sm text-amber-200">
            Outcome unknown • Do not submit again. One simulated submission has been reserved.
          </p>
          <button className={button + ' mt-4'} onClick={() => apply({type: 'reconcile'})}>Check synthetic provider readback</button>
        </>}
        {final && <p className={'mt-4 rounded-xl border p-4 text-sm ' +
          (state.stage === 'fixture_completed' ? 'border-emerald-700/50 bg-emerald-950/20 text-emerald-200' : 'border-red-700/50 bg-red-950/20 text-red-200')}>
          {state.stage === 'fixture_completed'
            ? 'Fixture marked completed — NOT a Zomato order or authenticated provider receipt.'
            : 'Fixture marked failed — no real transaction occurred.'}
          {' '}Submission count remained {state.submissionCount}.
        </p>}
        {state.stage === 'outcome_unknown' && state.scenario === 'pending' &&
          <p className="mt-3 text-xs text-amber-300">A pending readback must remain unknown. No retry is allowed.</p>}
      </section>}
      <footer className="border-t border-[#333] pt-5 text-sm text-[#969696]">
        This isolated preview cannot call Zomato MCP. Live account linking, merchant quotes,
        ordering, tracking and payment remain blocked until a written provider agreement,
        client allowlisting and separately reviewed server integration are complete.
      </footer>
    </div>
  )
}
