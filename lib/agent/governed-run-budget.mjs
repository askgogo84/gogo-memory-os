/**
 * Shared projected-run-budget decision prototype (NOT runtime enforcement).
 * All inputs must come from a trusted server-side meter/reservation service.
 * Unit: costMicropaise is integer millionths of one INR paise; tokens and
 * call counters are nonnegative safe integers. Unknown pricing is not zero.
 * This pure helper does not authenticate, reserve, dispatch, cancel or settle.
 * A production caller must atomically reserve with a durable scope/run/attempt
 * key, enforce existing permissions and approvals, then reconcile actual usage.
 * Unknown provider outcomes keep the reservation pending; no blind retry.
 * Inspired by Hachi pre-flight budgeting; original implementation, no copied code.
 */
const dimensions = Object.freeze(["tokens","costMicropaise","modelCalls","toolCalls"]);
function isCounter(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function isVector(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && dimensions.every(key => Object.prototype.hasOwnProperty.call(value,key) && isCounter(value[key]));
}
export function checkProjectedRunBudget(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return {allowed:false,reason:"invalid_budget_snapshot"};
  const {caps,committed,reserved,next}=input;
  if (![caps,committed,reserved,next].every(isVector)) return {allowed:false,reason:"invalid_budget_snapshot"};
  if (next.modelCalls === 0 && next.toolCalls === 0) return {allowed:false,reason:"missing_operation"};
  // Subtract rather than sum, so large valid counters never overflow JS safe integers.
  // Pending reservations remain charged until provider outcomes are reconciled.
  for (const dimension of dimensions) {
    const cap=caps[dimension], used=committed[dimension], pending=reserved[dimension], requested=next[dimension];
    if (used > cap || pending > cap-used || requested > cap-used-pending) {
      return {allowed:false,reason:"projected_budget_exceeded",dimension};
    }
  }
  return {allowed:true,reason:"within_projected_budget"};
}
