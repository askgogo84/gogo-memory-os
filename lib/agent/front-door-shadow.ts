// Front door step 1 entry for the WhatsApp webhook: the shadow comparison only (see scheduleFrontDoorShadow in
// ./brain). Kept as its own import so the webhook's early hook is not the brain's reply path.
export { scheduleFrontDoorShadow } from './brain'
