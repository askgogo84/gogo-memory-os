export const JEV_SHADOW_MODEL = 'jev-latest'
export const JEV_SHADOW_VERSION = 'jev-shadow-v1'

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
  read: 'The user only wants information or inspection; no stored or external state should change.',
  private_write: 'The user wants a reversible private AskGogo state change such as a reminder, list, task, or memory update.',
  consequential_write: 'The user wants an external or consequential action such as calendar mutation, browser submission, booking, payment, or sending.',
  research: 'The user wants search, comparison, or investigation without executing a consequential action.',
  clarify: 'The request is too ambiguous to act safely without asking the user for clarification.',
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
      instructions: 'Classify what kind of application behavior the user is requesting. Distinguish read-only, reversible private writes, consequential external writes, research, and requests that need clarification.',
      criteria: JEV_ACTION_MODE_CRITERIA,
    },
    referent_kind: {
      type: 'choice',
      instructions: 'If the message uses pronouns, ordinals, shorthand, or continuation language, choose what kind of prior object it most likely refers to. Choose none when the message stands alone.',
      criteria: JEV_REFERENT_CRITERIA,
    },
  } as const
}
