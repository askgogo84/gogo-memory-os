/**
 * Synthetic, NO NETWORK Zomato-like commerce journey for owner UX acceptance.
 * Not a Zomato connector, not actual restaurant/menu data, and not provider evidence.
 * Production execution is deliberately impossible from this module.
 */
export const SANDBOX_RESTAURANTS = [
  {id: 'demo-south', name: 'Demo South Kitchen', cuisine: 'South Indian (synthetic)', area: 'Indiranagar (example)'},
  {id: 'demo-pizza', name: 'Demo Pizza Studio', cuisine: 'Pizza (synthetic)', area: 'Koramangala (example)'},
] as const

export const SANDBOX_MENU = [
  {id: 'dosa', restaurant: 'demo-south', name: 'Masala dosa', minor: 15000},
  {id: 'idli', restaurant: 'demo-south', name: 'Idli plate', minor: 9000},
  {id: 'coffee', restaurant: 'demo-south', name: 'Filter coffee', minor: 5000},
  {id: 'pizza', restaurant: 'demo-pizza', name: 'Margherita pizza', minor: 23900},
  {id: 'bread', restaurant: 'demo-pizza', name: 'Garlic bread', minor: 11900},
  {id: 'lemonade', restaurant: 'demo-pizza', name: 'Lemonade', minor: 7900},
] as const

export type SandboxStage = 'discover' | 'cart' | 'review' | 'outcome_unknown' | 'fixture_completed' | 'fixture_failed'
export type SandboxScenario = 'completed' | 'failed' | 'pending'
export type SandboxState = {
  connected: boolean
  restaurantId: string | null
  quantities: Record<string, number>
  stage: SandboxStage
  scenario: SandboxScenario
  reviewSnapshot: string | null
  submissionCount: number
}
export type SandboxEvent =
  | {type: 'connect'}
  | {type: 'select'; restaurantId: string}
  | {type: 'quantity'; itemId: string; quantity: number}
  | {type: 'review'}
  | {type: 'scenario'; value: SandboxScenario}
  | {type: 'approve'; explicitlyApproved: boolean; displayedSnapshot: string}
  | {type: 'reconcile'}
  | {type: 'reset'}

export function newSandboxState(): SandboxState {
  return {connected: false, restaurantId: null, quantities: {}, stage: 'discover',
    scenario: 'completed', reviewSnapshot: null, submissionCount: 0}
}

export function sandboxQuote(state: SandboxState) {
  const items = SANDBOX_MENU.filter(i => i.restaurant === state.restaurantId)
    .map(i => ({...i, quantity: state.quantities[i.id] || 0}))
    .filter(i => i.quantity > 0)
  const subtotalMinor = items.reduce((sum, item) => sum + item.minor * item.quantity, 0)
  const taxMinor = subtotalMinor === 0 ? 0 : Math.round(subtotalMinor * 0.05)
  const deliveryMinor = subtotalMinor === 0 ? 0 : 2500
  const totalMinor = subtotalMinor + taxMinor + deliveryMinor
  // This is a demo snapshot string, NOT a security hash / provider quote.
  const snapshot = JSON.stringify([state.restaurantId, items.map(i => [i.id, i.quantity, i.minor]),
    subtotalMinor, taxMinor, deliveryMinor, totalMinor])
  return {items, subtotalMinor, taxMinor, deliveryMinor, totalMinor, snapshot}
}

function requireCondition(ok: boolean, reason: string): void {
  if (!ok) throw new Error(reason)
}

export function advanceSandbox(state: SandboxState, event: SandboxEvent): SandboxState {
  if (event.type === 'reset') return newSandboxState()
  if (event.type === 'connect') {
    requireCondition(state.stage === 'discover', 'Reset the sandbox to connect again.')
    return {...state, connected: true}
  }
  if (event.type === 'select') {
    requireCondition(state.connected, 'Enable the simulated connection first.')
    requireCondition(['discover', 'cart', 'review'].includes(state.stage), 'This test already submitted. Reset to start another.')
    requireCondition(SANDBOX_RESTAURANTS.some(r => r.id === event.restaurantId), 'Unknown synthetic restaurant.')
    return {...state, restaurantId: event.restaurantId, quantities: {}, stage: 'cart', reviewSnapshot: null}
  }
  if (event.type === 'quantity') {
    requireCondition(state.connected && state.restaurantId !== null, 'Select a synthetic restaurant first.')
    requireCondition(['cart', 'review'].includes(state.stage), 'Cannot change a submitted cart. Reset to start another.')
    requireCondition(Number.isInteger(event.quantity) && event.quantity >= 0 && event.quantity <= 5, 'Quantity must be 0–5.')
    const item = SANDBOX_MENU.find(i => i.id === event.itemId && i.restaurant === state.restaurantId)
    requireCondition(!!item, 'Item does not belong to selected restaurant.')
    return {...state, quantities: {...state.quantities, [event.itemId]: event.quantity},
      stage: 'cart', reviewSnapshot: null}
  }
  if (event.type === 'review') {
    requireCondition(state.connected && !!state.restaurantId && sandboxQuote(state).items.length > 0,
      'Add an item to review the synthetic cart.')
    requireCondition(['cart', 'review'].includes(state.stage), 'This test already submitted.')
    return {...state, stage: 'review', reviewSnapshot: sandboxQuote(state).snapshot}
  }
  if (event.type === 'scenario') {
    requireCondition(['cart', 'review'].includes(state.stage), 'Choose the fixture outcome before submitting.')
    requireCondition(['completed', 'failed', 'pending'].includes(event.value), 'Unknown fixture outcome.')
    return {...state, scenario: event.value}
  }
  if (event.type === 'approve') {
    requireCondition(state.stage === 'review' && state.submissionCount === 0 && event.explicitlyApproved,
      'Explicit approval is required and submissions cannot be repeated.')
    requireCondition(!!state.reviewSnapshot && state.reviewSnapshot === event.displayedSnapshot &&
      state.reviewSnapshot === sandboxQuote(state).snapshot,
      'Cart changed since review. Return to review.')
    // Simulate ONE submission reservation. Even a mock "accepted" response is UNKNOWN until readback.
    return {...state, stage: 'outcome_unknown', submissionCount: 1}
  }
  if (event.type === 'reconcile') {
    requireCondition(state.stage === 'outcome_unknown', 'No pending simulated submission.')
    if (state.scenario === 'pending') return state
    return {...state, stage: state.scenario === 'completed' ? 'fixture_completed' : 'fixture_failed'}
  }
  return state
}
