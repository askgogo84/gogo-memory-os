#!/usr/bin/env python3
"""
AskGogo Phase 2 patch: wire the WhatsApp plan-picker into the bot.
Idempotent + fail-loud. Run from repo root:  python patch_phase2.py
Edits: process-message.ts, whatsapp-premium.ts, limits.ts
(New file lib/bot/handlers/plan-checkout.ts is added separately.)
"""
import io, os, sys

def load(path):
    raw = io.open(path, encoding='utf-8').read()
    return raw.replace('\r\n', '\n'), ('\r\n' in raw)

def save(path, text, had_crlf):
    out = text.replace('\n', '\r\n') if had_crlf else text
    io.open(path, 'w', encoding='utf-8', newline='').write(out)

def replace_once(text, anchor, new, label, sentinel):
    """Insert/replace at a unique anchor. Idempotent via `sentinel` (unique added text)."""
    if sentinel in text:
        print(f'  = {label}: already applied, skipping')
        return text
    n = text.count(anchor)
    if n != 1:
        sys.exit(f'  ! {label}: expected exactly 1 anchor, found {n}. ABORT (no changes written).')
    print(f'  + {label}')
    return text.replace(anchor, new, 1)

def replace_span(text, start, end, new, label, sentinel):
    if sentinel in text:
        print(f'  = {label}: already applied, skipping')
        return text
    i = text.find(start)
    if i < 0: sys.exit(f'  ! {label}: start anchor not found. ABORT.')
    j = text.find(end, i)
    if j < 0: sys.exit(f'  ! {label}: end anchor not found. ABORT.')
    j += len(end)
    print(f'  + {label}')
    return text[:i] + new + text[j:]

ROOT = os.getcwd()
def p(rel): return os.path.join(ROOT, rel)

# ---------------------------------------------------------------- process-message.ts
pm = p('lib/bot/process-message.ts')
print('process-message.ts')
t, crlf = load(pm)

t = replace_once(t,
    "import { buildPremiumWhatsappReply } from './handlers/whatsapp-premium'\n",
    "import { buildPremiumWhatsappReply } from './handlers/whatsapp-premium'\n"
    "import { parsePlanSelection, buildPlanCheckoutReply } from './handlers/plan-checkout'\n",
    'import plan-checkout',
    "import { parsePlanSelection, buildPlanCheckoutReply }")

block_anchor = (
    "  if (\n"
    "    intent.type === 'welcome_menu' ||\n"
    "    intent.type === 'help_menu' ||\n"
    "    intent.type === 'upgrade_plan' ||\n"
    "    intent.type === 'referral_flow' ||\n"
    "    intent.type === 'notify_me'\n"
    "  ) {\n"
)
checkout_block = (
    "  // \u2500\u2500 Plan selection \u2192 create a subscription link \u2500\u2500\n"
    "  {\n"
    "    const selectedPlan = parsePlanSelection(incomingText)\n"
    "    if (selectedPlan) {\n"
    "      const explicit = /^(subscribe|get|buy|choose|select|start)\\b/i.test(incomingText.trim())\n"
    "      const recent = await getLatestFollowupState(resolvedUser.telegramId, 'plan_select')\n"
    "      const recentEnough = recent && (Date.now() - new Date(recent.created_at).getTime() < 30 * 60 * 1000)\n"
    "      if (explicit || recentEnough) {\n"
    "        const reply = await buildPlanCheckoutReply(resolvedUser, selectedPlan)\n"
    "        await saveConversation(resolvedUser.telegramId, 'user', incomingText)\n"
    "        await saveConversation(resolvedUser.telegramId, 'assistant', reply)\n"
    "        return { text: formatOutgoingText(params.channel, reply), resolvedUser }\n"
    "      }\n"
    "    }\n"
    "  }\n\n"
)
t = replace_once(t, block_anchor, checkout_block + block_anchor, 'insert plan-checkout dispatch',
                 "const selectedPlan = parsePlanSelection(incomingText)")

notify_anchor = (
    "    if (intent.type === 'notify_me') {\n"
    "      await saveMemory(resolvedUser.telegramId, 'User asked to be notified for AskGogo founder pricing / paid plan launch.')\n"
    "    }\n"
)
notify_new = notify_anchor + (
    "    if (intent.type === 'upgrade_plan') {\n"
    "      await saveFollowupState(resolvedUser.telegramId, 'plan_select', { created_at: new Date().toISOString() })\n"
    "    }\n"
)
t = replace_once(t, notify_anchor, notify_new, 'save plan_select on upgrade',
                 "saveFollowupState(resolvedUser.telegramId, 'plan_select'")
save(pm, t, crlf)

# ---------------------------------------------------------------- whatsapp-premium.ts
wp = p('lib/bot/handlers/whatsapp-premium.ts')
print('whatsapp-premium.ts')
t, crlf = load(wp)
new_upgrade = (
    "export function buildUpgradeReply() {\n"
    "  return `\U0001f49a *AskGogo Plans*\n\n"
    "Starting at \u20b999/month \u2014 less than a cup of chai/day. Every plan comes with a *7-day free trial*, cancel anytime.\n\n"
    "*Lite* \u2014 \u20b999/month\n"
    "\u2022 60 AI actions/month\n"
    "\u2022 5 active reminders\n"
    "\u2022 10 voice notes/month\n\n"
    "*Starter* \u2014 \u20b9149/month\n"
    "\u2022 100 AI actions/month\n"
    "\u2022 10 active reminders\n"
    "\u2022 30 voice notes/month\n\n"
    "*Pro \u2014 most popular* \u2014 \u20b9199/month\n"
    "\u2022 250 AI actions/month\n"
    "\u2022 50 active reminders\n"
    "\u2022 Calendar + daily briefing\n"
    "\u2022 Web search\n\n"
    "Reply *lite*, *starter*, or *pro* and I'll send you a secure payment link. \U0001f512`\n"
    "}"
)
t = replace_span(t,
    "export function buildUpgradeReply() {",
    "Reply *notify me* to get early founder pricing.`\n}",
    new_upgrade, 'rewrite buildUpgradeReply', 'AskGogo Plans*')
save(wp, t, crlf)

# ---------------------------------------------------------------- limits.ts
lm = p('lib/data/limits.ts')
print('limits.ts')
t, crlf = load(lm)
t = replace_once(t, "    label: 'Pro',\n    priceInr: 299,\n",
                    "    label: 'Pro',\n    priceInr: 199,\n", 'Pro priceInr 199',
                    "    label: 'Pro',\n    priceInr: 199,\n")
if 'Pro \u2014 \u20b9299/month' in t:
    t = t.replace('Pro \u2014 \u20b9299/month', 'Pro \u2014 \u20b9199/month')
    print('  + Pro copy \u20b9199')
else:
    print('  = Pro copy \u20b9199: already applied')
lim_start = "    `AskGogo is still in founder beta while Razorpay checkout is being enabled.\\n\\n` +\n"
lim_end   = "    `Reply *usage* to see your current limits.`\n"
lim_new = (
    "    `Upgrade to keep going:\\n` +\n"
    "    `\u2022 Lite \u2014 \u20b999/month \u2014 60 AI actions/month\\n` +\n"
    "    `\u2022 Starter \u2014 \u20b9149/month \u2014 100 AI actions/month\\n` +\n"
    "    `\u2022 Pro \u2014 \u20b9199/month \u2014 250 AI actions/month\\n\\n` +\n"
    "    `Reply *upgrade* to pick a plan (7-day free trial).\\n` +\n"
    "    `Reply *usage* to see your current limits.`\n"
)
t = replace_span(t, lim_start, lim_end, lim_new, 'un-gate limit message', 'Upgrade to keep going')
save(lm, t, crlf)

print('\nDONE. All patches applied.')
