export const JEV_SHADOW_MODEL = 'jev-latest'
export const JEV_SHADOW_VERSION = 'jev-shadow-v1.2'

export const JEV_INTENT_CRITERIA = {
  reminder_read: 'Read, list, inspect, or answer questions about reminders without changing them.',
  reminder_mutation: 'Create, move, reschedule, snooze, cancel, or otherwise change a reminder.',
  calendar_read: 'Read, list, inspect, or answer questions about calendar events or meetings without changing them.',
  calendar_mutation: 'Create, move, reschedule, cancel, invite to, or otherwise change a calendar event or meeting.',
  watcher: 'Create, inspect, update, or stop ongoing monitoring, alerts, watches, or condition checks.',
  travel_research: 'Research, compare, inspect, or discuss flights, hotels, trips, tickets, or travel options without booking.',
  browser_action: 'Navigate or act on an external website or provider, including forms, booking, checkout, or account actions.',
  memory_context: 'Save, recall, or use personal memory/context that is not better handled by another capability.',
  list_task: 'Create, read, or change a list, checklist, task, or todo.',
  general_reasoning: 'A general question or reasoning request that does not cleanly fit the other options.',
  other: 'None of the listed intents fit well.',
} as const

export const JEV_ACTION_MODE_CRITERIA = {
  read: 'Read/inspect existing state only. Examples: list reminders, show calendar, list active watchers, ask watcher status.',
  private_write: 'Reversible private AskGogo state change. Includes creating, stopping, or updating watchers; reminders; lists; tasks; memory.',
  consequential_write: 'External/consequential write. Includes calendar mutation, browser form submission, booking, payment, purchase, or sending.',
  research: 'Search/compare/investigate without changing stored or external state.',
  clarify: 'Too ambiguous to choose a safe action without clarification.',
} as const

export const JEV_ATTENTION_CRITERIA = {
  none: 'No unresolved commitment or completion evidence is expressed.',
  waiting_on: 'Someone else has committed to provide, send, confirm, reply, deliver, update, or get back to the user and it is still pending.',
  followup: 'The user needs to follow up because a reply/update has not arrived or explicitly says a follow-up is needed.',
  commitment: 'The user has an unresolved action they need to do, such as send, call, submit, review, confirm, finish, pay, book, or reply.',
  completed: 'The message provides evidence that a previously pending commitment or waiting item has been completed, delivered, replied to, approved, received, or otherwise resolved.',
} as const

export const JEV_REFERENT_CRITERIA = {
  none: 'The message does not depend on a prior conversational object.',
  reminder: 'A pronoun or shorthand refers to a reminder.',
  calendar_event: 'A pronoun or shorthand refers to a calendar event or meeting.',
  watcher: 'A pronoun or shorthand refers to a monitor, watcher, or alert.',
  travel_option: 'A pronoun, ordinal, or shorthand refers to a flight, hotel, trip, or travel option.',
  mission: 'The message refers to the currently active multi-step mission, goal, or agent run.',
  other_context: 'The message depends on prior context, but none of the listed referent kinds fit.',
} as const

export function buildJevShadowQuestions() {
  return {
    intent: {
      type: 'choice',
      instructions: 'Choose the single best AskGogo capability intent for the user message. Prefer the most specific option. Do not infer permission to execute; classify meaning only.',
      criteria: JEV_INTENT_CRITERIA,
    },
    action_mode: {
      type: 'choice',
      instructions: 'Choose the requested behavior. Creating/stopping a background watcher is private_write; asking what is being watched is read. Calendar/browser/booking/payment writes are consequential_write.',
      criteria: JEV_ACTION_MODE_CRITERIA,
    },
    referent_kind: {
      type: 'choice',
      instructions: 'If the message uses pronouns, ordinals, shorthand, or continuation language, choose what kind of prior object it most likely refers to. Choose none when the message stands alone.',
      criteria: JEV_REFERENT_CRITERIA,
    },
    attention_state: {
      type: 'choice',
      instructions: 'Classify whether this turn creates or resolves an attention/open-loop state. Do not invent commitments. Choose none unless the message itself contains evidence of waiting, follow-up, a user commitment, or completion.',
      criteria: JEV_ATTENTION_CRITERIA,
    },
  } as const
}
