// Pure precedence guard for the legacy "save this as <title>" notes shortcut.
// These destinations are first-class actions and must continue to the specialist
// router instead of being interpreted as labels for the previous conversation.
const RESERVED_ACTION_DESTINATION = /^(?:save|remember)\s+(?:it|this|that)\s+as\s+(?:a\s+)?(?:reminder|alarm|task|todo|to-do|list|checklist|calendar|event|appointment|meeting)\b/i

export function isReservedSaveLastActionDestination(text: string): boolean {
  return RESERVED_ACTION_DESTINATION.test(String(text || '').trim())
}
