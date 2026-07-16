#!/usr/bin/env python3
"""Fix 'done' reliability + follow-up chain stop + label quote/connector cleanup.
Idempotent + fail-loud. Run from repo root:  python patch_done_fix.py"""
import io, os, sys
def load(p): r=io.open(p,encoding='utf-8').read(); return r.replace('\r\n','\n'),('\r\n' in r)
def save(p,t,c): io.open(p,'w',encoding='utf-8',newline='').write(t.replace('\n','\r\n') if c else t)
def rep(t,old,new,label,sent):
    if sent in t: print(f'  = {label}: already applied'); return t
    if t.count(old)!=1: sys.exit(f'  ! {label}: anchor found {t.count(old)}x. ABORT.')
    print(f'  + {label}'); return t.replace(old,new,1)

ROOT=os.getcwd()

# ---------------- edit-reminder.ts ----------------
er=os.path.join(ROOT,'lib/bot/handlers/edit-reminder.ts'); t,c=load(er); print('edit-reminder.ts')

# 1) rewrite getLatestActionableReminder: pick whichever the user most recently
#    interacted with — the reminder that last NUDGED them, or the last one they SET.
old_fn=(
"export async function getLatestActionableReminder(telegramId: number) {\n"
"  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()\n"
"\n"
"  const { data } = await supabaseAdmin\n"
"    .from('reminders')\n"
"    .select('id, message, remind_at, sent, created_at')\n"
"    .eq('telegram_id', telegramId)\n"
"    .gte('created_at', oneHourAgo)\n"
"    .order('created_at', { ascending: false })\n"
"    .limit(1)\n"
"\n"
"  return data?.[0] || null\n"
"}\n"
)
new_fn=(
"export async function getLatestActionableReminder(telegramId: number) {\n"
"  const now = Date.now()\n"
"  const firedCut = new Date(now - 6 * 60 * 60 * 1000).toISOString()\n"
"  const createdCut = new Date(now - 60 * 60 * 1000).toISOString()\n"
"  const cols = 'id, message, remind_at, sent, sent_at, created_at, recurring_pattern'\n"
"\n"
"  // The reminder that most recently NUDGED the user.\n"
"  const { data: fired } = await supabaseAdmin\n"
"    .from('reminders').select(cols)\n"
"    .eq('telegram_id', telegramId).not('sent_at', 'is', null).gte('sent_at', firedCut)\n"
"    .order('sent_at', { ascending: false }).limit(1)\n"
"\n"
"  // The reminder the user most recently SET.\n"
"  const { data: created } = await supabaseAdmin\n"
"    .from('reminders').select(cols)\n"
"    .eq('telegram_id', telegramId).gte('created_at', createdCut)\n"
"    .order('created_at', { ascending: false }).limit(1)\n"
"\n"
"  const f = fired?.[0], cr = created?.[0]\n"
"  if (f && cr) return new Date(f.sent_at).getTime() >= new Date(cr.created_at).getTime() ? f : cr\n"
"  return f || cr || null\n"
"}\n"
"\n"
"// When a follow-up is marked done, cancel its pending next nudge so the chain stops.\n"
"async function cancelFollowupChain(telegramId: number, pattern: string | null | undefined) {\n"
"  if (!pattern || !String(pattern).startsWith('followup:')) return\n"
"  await supabaseAdmin.from('reminders').update({ sent: true })\n"
"    .eq('telegram_id', telegramId).eq('recurring_pattern', pattern).eq('sent', false)\n"
"}\n"
)
t=rep(t,old_fn,new_fn,'getLatestActionableReminder + chain-cancel','cancelFollowupChain')

# 2) getActiveReminders: carry recurring_pattern + sent_at so index-path can stop chains
t=rep(t,
"export async function getActiveReminders(telegramId: number, limit = 10) {\n"
"  const { data } = await supabaseAdmin\n"
"    .from('reminders')\n"
"    .select('id, message, remind_at, sent, created_at')\n",
"export async function getActiveReminders(telegramId: number, limit = 10) {\n"
"  const { data } = await supabaseAdmin\n"
"    .from('reminders')\n"
"    .select('id, message, remind_at, sent, sent_at, created_at, recurring_pattern')\n",
'getActiveReminders select',"recurring_pattern')\n    .eq('telegram_id', telegramId)\n    .eq('sent', false)")

# 3) markLatestReminderDone: call chain-cancel after marking done
t=rep(t,
"  const ok = await updateReminderSent(reminder, true)\n\n  if (!ok) {\n    return `I couldn't mark that reminder done right now.`\n  }\n\n  return `\u2705 *Marked done*\\n\\n${cleanReminderName(reminder.message)}`\n}",
"  const ok = await updateReminderSent(reminder, true)\n\n  if (!ok) {\n    return `I couldn't mark that reminder done right now.`\n  }\n\n  await cancelFollowupChain(telegramId, reminder.recurring_pattern)\n\n  return `\u2705 *Marked done*\\n\\n${cleanReminderName(reminder.message)}`\n}",
'markLatestReminderDone chain-cancel call','cancelFollowupChain(telegramId, reminder.recurring_pattern)')
save(er,t,c)

# ---------------- followup-reminder.ts ----------------
fr=os.path.join(ROOT,'lib/services/followup-reminder.ts'); t,c=load(fr); print('followup-reminder.ts')
# strip surrounding quotes at the start of stripToTask
t=rep(t,
"function stripToTask(t: string): string {\n  return t\n    .replace(/^\\s*(please\\s+)?/i, '')\n",
"function stripToTask(t: string): string {\n  return t\n    .replace(/[\"'\\u201c\\u201d\\u2018\\u2019]/g, '')\n    .replace(/^\\s*(please\\s+)?/i, '')\n",
'stripToTask quote removal',".replace(/[\"'\\u201c\\u201d\\u2018\\u2019]/g, '')")
save(fr,t,c)
print('DONE.')
