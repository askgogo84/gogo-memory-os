import { waLink } from '@/lib/product-urls'

export type PremiumWhatsappIntent =
  | 'welcome_menu'
  | 'help_menu'
  | 'upgrade_plan'
  | 'referral_flow'
  | 'notify_me'

const ASK_GOGO_WHATSAPP_LINK =
  process.env.ASK_GOGO_WHATSAPP_JOIN_LINK ||
  waLink('Hi AskGogo')

function cleanName(name?: string) {
  const n = (name || '').trim()
  if (!n || n.toLowerCase() === 'friend') return 'there'
  return n.split(' ')[0]
}

export function buildWelcomeReply(userName?: string) {
  const name = cleanName(userName)

  return `Hey ${name}, I’m *AskGogo* 👋

Your AI assistant inside WhatsApp.

Use me by *typing or sending a voice note*.

I can help you with:
• reminders
• calendar planning
• today briefing
• weather
• sports updates
• lists and notes
• quick drafts
• web search

Try:
1. Send a voice note: “Remind me in 10 mins to call Rahul”
2. Connect calendar
3. Today
4. Show my reminders
5. Bangalore weather tomorrow

Built for people who live on WhatsApp.`
}

export function buildHelpReply() {
  return `✨ *AskGogo Menu*

🎙️ *Voice first*
Send a voice note in English, Hindi, Hinglish, Kannada, Tamil, Telugu or Malayalam.

⏰ *Reminders*
• Remind me in 20 mins to call Rahul
• Show my reminders
• Cancel water reminder
• Snooze 10 mins
• Move it to 8 pm
• Done

📅 *Calendar*
• Connect calendar
• Today
• What’s on my calendar today?
• Add meeting tomorrow at 4 pm

☀️ *Daily*
• Morning briefing
• Bangalore weather tomorrow
• Next RCB match

🚀 *AskGogo*
• Pricing
• Usage
• Invite friends

Type or speak naturally. I’ll understand.`
}

export function buildUpgradeReply() {
  return `💚 *AskGogo Plans*

Start free, then upgrade anytime. Every paid plan starts with a *7-day free trial* and can be cancelled anytime.

*Free* — ₹0
• Try AskGogo with core reminders, memory and lists

*Lite* — ₹99/month
• 60 AI actions/month
• 5 active reminders
• 10 voice notes/month

*Pro — most popular* — ₹299/month
• 250 AI actions/month
• 50 active reminders
• 100 voice notes/month
• Calendar + daily briefing
• Web search

*Power* — ₹499/month
• 600 AI actions/month
• 200 active reminders
• 300 voice notes/month
• Higher search + calendar limits
• Priority access

Reply *lite*, *pro*, or *power* and I'll send you the secure subscription link. 🔒`
}

export function buildNotifyMeReply(userName?: string) {
  const name = cleanName(userName)

  return `✅ *Got it, ${name}*

Paid AskGogo plans are available from *₹99/month* with a *7-day free trial*.

Reply *pricing* to see Free, Lite, Pro and Power, or *upgrade* when you're ready.`
}

export function buildReferralReply() {
  return `🎁 *Invite friends to AskGogo*

Copy and send this:

“I’ve been testing AskGogo — an AI assistant on WhatsApp for reminders, memory, calendar planning, weather, sports updates and daily briefings.

You can type or send voice notes in Indian languages.

Try it here:
${ASK_GOGO_WHATSAPP_LINK}”`
}

export function buildPremiumWhatsappReply(
  intentType: string,
  userName?: string
) {
  if (intentType === 'welcome_menu') return buildWelcomeReply(userName)
  if (intentType === 'help_menu') return buildHelpReply()
  if (intentType === 'upgrade_plan') return buildUpgradeReply()
  if (intentType === 'referral_flow') return buildReferralReply()
  if (intentType === 'notify_me') return buildNotifyMeReply(userName)
  return buildHelpReply()
}
