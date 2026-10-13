// Gogo reads Google Drive (read-only scope). A request to change a Drive document is not a list item, a
// reminder or a web search: it gets an honest answer instead of a guess. Zero-import so every router can use it.
const WRITE_VERB_RE = /\b(?:add|append|write|put|insert|type|paste|update|edit|change|rewrite|fix|replace|delete|remove)\b/i
const DOC_NOUN_RE = /\b(?:docs?|documents?|sheets?|spreadsheets?|slides?|files?|notes?)\b/i
const DRIVE_RE = /\b(?:in|on|into|to)\s+(?:my\s+|the\s+)?(?:google\s+)?drive\b|\bgoogle\s+(?:docs?|sheets?|slides)\b|\bg-?docs?\b/i

export function isDriveWriteRequest(text: string): boolean {
  const t = String(text || '')
  return WRITE_VERB_RE.test(t) && DOC_NOUN_RE.test(t) && DRIVE_RE.test(t)
}

export const DRIVE_WRITE_REPLY =
  "I can find and read files in your Google Drive, but I can't edit them yet, so nothing was changed.\n\n" +
  "I can draft the text here for you to paste in, or save it as a note in Gogo. Which would you like?"
