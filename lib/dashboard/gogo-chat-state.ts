// Which pose Gogo's character shows in the dashboard chat. One pure function so the chat page, the side panel
// and the tests all agree. The poses are the canonical GogoCharacter states; nothing here draws anything.
export type ChatGogoState = 'calm' | 'listening' | 'thinking' | 'acting' | 'watching' | 'approval' | 'done'

export type ChatGogoStateInput = {
  /** A message is on its way and no reply has come back yet. */
  sending: boolean
  /** The person has typed something in the box and not sent it. */
  typing: boolean
  /** From summarizeActiveRunState: real work running, waiting on the person, or nothing active. */
  runTone: 'working' | 'waiting' | 'idle'
  /** Gogo has just answered (a few seconds). */
  justReplied: boolean
  /** Number of active background watches. */
  watchers: number
}

export function chatGogoState(input: ChatGogoStateInput): ChatGogoState {
  // Order matters: what Gogo is doing right now beats what is merely true in the background.
  if (input.sending) return 'thinking'
  if (input.runTone === 'working') return 'acting'
  if (input.runTone === 'waiting') return 'approval'
  if (input.typing) return 'listening'
  if (input.justReplied) return 'done'
  if (input.watchers > 0) return 'watching'
  return 'calm'
}

/** Short words for the pose, shown under the character in the side panel. */
export const CHAT_STATE_LABEL: Record<ChatGogoState, string> = {
  calm: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  acting: 'Working',
  watching: 'Watching in the background',
  approval: 'Waiting for you',
  done: 'Done',
}

/** One or two words for the slim phone header, where the long label would be cut off. */
export const CHAT_STATE_SHORT: Record<ChatGogoState, string> = {
  calm: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  acting: 'Working',
  watching: 'Watching',
  approval: 'Waiting for you',
  done: 'Done',
}
