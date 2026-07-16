#!/usr/bin/env python3
"""AskGogo reminder hardening + conversational fallback. Idempotent + fail-loud.
Run from repo root:  python patch_reminders_v2.py
  reminders.ts     : add 'today' parser + noon/midday/midnight time words
  process-message.ts: LLM fallback so natural phrasings set reminders instead of
                      dead-ending on 'What time and when?'"""
import io, os, sys

def load(p):
    r = io.open(p, encoding='utf-8').read(); return r.replace('\r\n','\n'), ('\r\n' in r)
def save(p, t, crlf):
    io.open(p, 'w', encoding='utf-8', newline='').write(t.replace('\n','\r\n') if crlf else t)
def once(t, anchor, new, label, sentinel):
    if sentinel in t: print(f'  = {label}: already applied'); return t
    if t.count(anchor) != 1: sys.exit(f'  ! {label}: anchor found {t.count(anchor)}x. ABORT.')
    print(f'  + {label}'); return t.replace(anchor, new, 1)

ROOT = os.getcwd()

# ---------------- reminders.ts ----------------
rp = os.path.join(ROOT, 'lib/bot/handlers/reminders.ts')
t, crlf = load(rp)
print('reminders.ts')

# (a) parseTodayReminder + chain
today_fn = (
    'function parseTodayReminder(text: string): ParsedReminder {\n'
    '  if (!/\\btoday\\b/i.test(text)) return null\n'
    '  if (getAmbiguousReminderTime(text)) return null\n'
    '  const time = parseTimePart(text)\n'
    '  if (!time) return null\n'
    '  const nowIst = istNowParts()\n'
    '  const when = istWallTimeToUtcDate(nowIst.year, nowIst.month, nowIst.day, time.hour, time.minute)\n'
    '  if (when.getTime() <= Date.now()) return null\n'
    '  return { kind: \'one_time\', remindAtIso: when.toISOString(), message: cleanMessageText(text) }\n'
    '}\n\n'
)
t = once(t, 'function parseTomorrowReminder(text: string): ParsedReminder {',
         today_fn + 'function parseTomorrowReminder(text: string): ParsedReminder {',
         'add parseTodayReminder', 'function parseTodayReminder')
t = once(t, 'parseTomorrowReminder(text) || parseSpecificWeekdayReminder(text)',
         'parseTomorrowReminder(text) || parseTodayReminder(text) || parseSpecificWeekdayReminder(text)',
         'wire today into chain', 'parseTodayReminder(text) ||')

# (b) noon/midday/midnight words in parseTimePart (right after the p.m./a.m. normalization)
noon_anchor = "    .replace(/\\ba\\.\\s*m\\.?\\b/gi, 'am')\n"
# find the end of the normalization chain: it ends with a line then blank; insert after the raw normalization block.
# We anchor on the a.m. replace line and inject the word-time check immediately after the statement it belongs to.
if 'noon|midday' in t:
    print('  = noon/midday/midnight: already applied')
else:
    # The normalization assigns to `raw`; insert word handling right after parseTimePart's raw is built.
    # Anchor: the compact-time match that begins the numeric parsing.
    comp = "  const compact = raw.match(/\\b(\\d{3,4})\\s*(am|pm)\\b/i)"
    if t.count(comp) != 1: sys.exit(f'  ! noon anchor found {t.count(comp)}x. ABORT.')
    inject = (
        "  if (/\\b(noon|midday)\\b/i.test(raw)) return { hour: 12, minute: 0 }\n"
        "  if (/\\bmidnight\\b/i.test(raw)) return { hour: 0, minute: 0 }\n"
        + comp
    )
    t = t.replace(comp, inject, 1); print('  + noon/midday/midnight time words')
save(rp, t, crlf)

# ---------------- process-message.ts ----------------
pm = os.path.join(ROOT, 'lib/bot/process-message.ts')
t, crlf = load(pm)
print('process-message.ts')
anchor = ("  if (!eagerReminder && intent.type === 'set_reminder') {\n"
          "    const lower = incomingText.toLowerCase()\n")
llm = (
    "  if (!eagerReminder && intent.type === 'set_reminder') {\n"
    "    // Regex couldn't parse the time — let Claude resolve it (it computes the\n"
    "    // datetime itself and handles natural phrasings). Fail-safe: any error\n"
    "    // falls through to the clarifying question below.\n"
    "    try {\n"
    "      const llmRaw = await askClaude(incomingText, [], [], resolvedUser.name, '')\n"
    "      const llmParsed = parseClaudeResponse(llmRaw)\n"
    "      if (llmParsed.type === 'reminder' && llmParsed.remindAt) {\n"
    "        const ms = Date.parse(llmParsed.remindAt)\n"
    "        if (!isNaN(ms) && ms > Date.now() - 60000) {\n"
    "          await createReminder(resolvedUser.telegramId, resolvedUser.telegramId, llmParsed.remindAt, llmParsed.message, llmParsed.pattern, params.channel === 'whatsapp' ? resolvedUser.whatsappId : null)\n"
    "          const confirmation = buildReminderConfirmation({ kind: llmParsed.pattern ? 'recurring' : 'one_time', remindAtIso: new Date(ms).toISOString(), message: llmParsed.message, pattern: llmParsed.pattern } as any)\n"
    "          const rr = styleReplyByIntent('set_reminder', confirmation)\n"
    "          await saveConversation(resolvedUser.telegramId, 'assistant', rr)\n"
    "          return { text: formatOutgoingText(params.channel, rr), resolvedUser }\n"
    "        }\n"
    "      }\n"
    "    } catch (llmErr) {\n"
    "      console.error('LLM reminder fallback failed, asking instead:', llmErr)\n"
    "    }\n"
    "    const lower = incomingText.toLowerCase()\n"
)
t = once(t, anchor, llm, 'LLM reminder fallback', 'LLM reminder fallback failed, asking instead')
save(pm, t, crlf)
print('\nDONE.')
