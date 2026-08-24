// Belt-and-braces redaction for the LLM prompt: keep secret-shaped memories out of the
// freeform Claude context (getMemories → askClaude). This is DEFENSE IN DEPTH, not the
// primary guarantee. The real guarantee is structural: vault plaintext is never written
// into public.memories, and no vault_items SELECT is added to the freeform assembly
// (see the constraint comment in process-message.ts). This filter only catches a secret
// that lands in `memories` anyway (e.g. a user pasting a password into "remember X").
//
// Kept pure and dependency-free so scripts/verify-memory-redaction.mts exercises the
// shipped logic directly.

// Explicit secret-labelling keywords. Matching any of these hides the whole memory.
const SECRET_KEYWORDS =
  /\b(pass(?:word|wd|code)|pin|otp|one[\s-]?time[\s-]?password|passport|aadhaar|aadhar|ssn|cvv|cvc|card\s*number|account\s*number|credit\s*card|debit\s*card|api[\s_-]?key|secret\s*key|secret|security\s*code|routing\s*number|ifsc)\b/i

// Heuristic: does this memory look like it carries a credential/identifier we must not
// surface to the model?
//   - keyword match (labelled secrets), OR
//   - a long digit run: 8+ consecutive digits after stripping spaces/hyphens, which
//     catches card / account / passport-style numbers (e.g. "4111 1111 1111 1111").
//
// FALSE POSITIVES (acceptable): a benign note that merely mentions "password", or a
// 10-digit phone number, gets withheld from Claude — the memory still exists, Claude
// just won't see it that turn. FALSE NEGATIVES (why this is belt-and-braces, not the
// guarantee): a short unlabelled secret (e.g. a 4-digit PIN with no "pin" word, or a
// passport like "A1234567" that is <8 digits) can still slip through.
export function isSecretShapedMemory(content: string): boolean {
  if (!content) return false
  const text = content.trim()
  if (!text) return false
  if (SECRET_KEYWORDS.test(text)) return true
  const digitsOnly = text.replace(/[\s-]/g, '')
  if (/\d{8,}/.test(digitsOnly)) return true
  return false
}

// Drop every secret-shaped entry. Exported for reuse/testing alongside getMemories.
export function stripSecretShapedMemories(memories: string[]): string[] {
  return memories.filter((m) => !isSecretShapedMemory(m))
}
