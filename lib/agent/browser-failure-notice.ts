// Fixed, user-facing explanations only. Raw browser errors can contain page
// content or private URLs and must never be copied into a notification.
export function browserFailureSummary(error:unknown):string{
  const code=String(error||'')
  if(code.includes('browser_live_session_expired'))return 'The browser session expired before this task finished. Open the task, choose Take Control to restore your account or delivery location, then resume the same task. Do not send login codes in chat.'
  if(code==='browser_read_deadline')return 'The browser read reached its time limit before verifying a result. The task is incomplete. No input is requested from you; AskGogo needs to resolve the browser failure before retrying.'
  if(code==='browser_objective_unverified'||code==='browser_planning_failed')return 'AskGogo could not verify the requested information on this page. The task is incomplete. No input is requested from you; AskGogo needs to resolve the browser failure before retrying.'
  return 'AskGogo could not finish the browser task. No verified result is available. No input is requested from you; the failure needs investigation before retrying.'
}
