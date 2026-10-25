// Fixed, user-facing explanations only. Raw browser errors can contain page
// content or private URLs and must never be copied into a notification.
export function browserFailureSummary(error:unknown):string{
  const code=String(error||'')
  if(code.includes('browser_live_session_expired'))return 'The browser session expired before this task finished. Open the task, choose Take Control to restore your account or delivery location, then resume the same task. Do not send login codes in chat.'
  // 16 Oct: plain words. The old copy ("No input is requested from you; AskGogo needs to resolve the browser
  // failure before retrying") read like a system log. Still no guessed results, and nothing for the person to do.
  if(code==='browser_read_deadline')return "That site took too long, so I stopped before I could check the answer. Nothing was changed. Try again in a few minutes."
  if(code==='browser_objective_unverified'||code==='browser_planning_failed')return "I opened the site but couldn't find that information on it, so I won't guess. Nothing was changed. Try asking in a different way, or check the site or app directly."
  return "I couldn't finish that on the site, so I have no checked answer to give you. Nothing was changed. Try again in a few minutes."
}
