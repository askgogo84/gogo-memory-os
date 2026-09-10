import { waLink } from '@/lib/product-urls'

export type PremiumWhatsappIntent =
  | 'welcome_menu'
  | 'help_menu'
  | 'upgrade_plan'
  | 'referral_flow'
  | 'notify_me'

const ASK_GOGO_WHATSAPP_LINK = process.env.ASK_GOGO_WHATSAPP_JOIN_LINK || waLink('Hi Gogo')

function cleanName(name?: string) {
  const n = (name || '').trim()
  if (!n || n.toLowerCase() === 'friend') return 'there'
  return n.split(' ')[0]
}

export function buildWelcomeReply(userName?: string) {
  const name = cleanName(userName)
  return `Hey ${name}, I’m *Gogo* 👋

Your personal AI inside AskGogo — I remember, plan, act and keep working when you’re away.

Use me by typing or sending a voice note.

Try:
• “What do I have today?”
• “Remember this for me.”
• “Plan my Mumbai work trip.”
• “Watch this price and tell me when it drops.”
• “Add this to my calendar.”
• “Find that document I sent you.”

Important actions such as sending, booking, paying or changing your calendar still stop for your approval.`
}

export function buildHelpReply() {
  return `✨ *Gogo Menu*

🧠 *Gogo Memory*
• Remember this
• Find my saved document
• What do you know about my Mumbai trip?

⚡ *Gogo Agent*
• Plan my trip
• Prepare me for tomorrow
• Research this and create a brief

👀 *Background Gogo*
• Watch this price
• Tell me when applications open

⏰ *Reminders & tasks*
• Remind me tomorrow at 8am
• Show my reminders
• Add a task

📅 *Calendar*
• Connect calendar
• What’s on today?
• Prepare a meeting for tomorrow

🎙️ *Voice*
Send a voice note in supported languages and talk naturally.

💳 *Plans*
• Pricing
• Usage
• Upgrade

Just tell Gogo the outcome — you don’t need to learn commands.`
}

export function buildUpgradeReply() {
  return `🟢 *Gogo Plans*

Start free. Paid plans include a *7-day free trial* and can be cancelled anytime.

*Gogo Free* — ₹0
Meet Gogo
• Core memory, tasks, lists and reminders
• Basic Daily Gogo
• Limited everyday AI use

*Gogo Essential* — ₹249/month
Let Gogo help
• More Gogo capacity
• WhatsApp + Calendar
• Light connected work
• Live flight search
• Light Agent missions
• 1 Background Gogo watch

*Gogo Plus — most popular* — ₹499/month
Let Gogo handle it
• Multi-step Gogo Agent
• Gmail, Calendar, Drive & Contacts
• Background Gogo
• Goals & Ideas
• Live flights + hotels
• Cash vs points travel intelligence
• Voice + artifacts + Secure Computer allowance

*Gogo Pro* — ₹999/month
Gogo, take it from here
• Highest Agent capacity
• More Background Gogo, Goals and voice
• More Secure Computer time
• Priority capabilities
• Advanced travel + booking/transaction preparation

Reply *essential*, *plus*, or *pro* and I’ll send the secure Razorpay subscription link. 🔒`
}

export function buildNotifyMeReply(userName?: string) {
  const name = cleanName(userName)
  return `✅ *Got it, ${name}*

Gogo paid plans start at *₹249/month* with a *7-day free trial*.

Reply *pricing* to see Gogo Essential, Gogo Plus and Gogo Pro, or *upgrade* when you’re ready.`
}

export function buildReferralReply() {
  return `🎁 *Invite someone to meet Gogo*

Copy and send this:

“I’ve been testing Gogo on AskGogo — a personal AI that remembers, plans, acts and keeps working in the background.

It works through WhatsApp and the AskGogo dashboard, with memory, reminders, Agent missions, connected apps and approvals for important actions.

Try Gogo here:
${ASK_GOGO_WHATSAPP_LINK}”`
}

export function buildPremiumWhatsappReply(intentType: string, userName?: string) {
  if (intentType === 'welcome_menu') return buildWelcomeReply(userName)
  if (intentType === 'help_menu') return buildHelpReply()
  if (intentType === 'upgrade_plan') return buildUpgradeReply()
  if (intentType === 'referral_flow') return buildReferralReply()
  if (intentType === 'notify_me') return buildNotifyMeReply(userName)
  return buildHelpReply()
}
