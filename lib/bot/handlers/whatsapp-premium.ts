export type PremiumWhatsappIntent =
  | 'welcome_menu'
  | 'help_menu'
  | 'upgrade_plan'
  | 'referral_flow'
  | 'notify_me'

const ASK_GOGO_WHATSAPP_LINK =
  process.env.ASK_GOGO_WHATSAPP_JOIN_LINK ||
  'https://wa.me/15797006612?text=Hi%20AskGogo'

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

🚀 *Founder Beta*
• Pricing
• Usage
• Notify me
• Invite friends

Type or speak naturally. I’ll understand.`
}

export function buildUpgradeReply() {
  return `💚 *AskGogo Plans*

Starting at ₹99/month — less than a cup of chai/day. Every plan comes with a *7-day free trial*, cancel anytime.

*Lite* — ₹99/month
• 60 AI actions/month
• 5 active reminders
• 10 voice notes/month

*Starter* — ₹149/month
• 100 AI actions/month
• 10 active reminders
• 30 voice notes/month

*Pro — most popular* — ₹199/month
• 250 AI actions/month
• 50 active reminders
• Calendar + daily briefing
• Web search

Reply *lite*, *starter*, or *pro* and I'll send you a secure payment link. 🔒`
}

export function buildNotifyMeReply(userName?: string) {
  const name = cleanName(userName)

  return `✅ *You’re on the founder pricing list, ${name}*

I’ll remember that you want early access when paid plans go live.

Plans will start at *₹99/month* — less than a cup of chai/day.

Want priority Founder Beta access?
Invite 3 friends who live on WhatsApp.

Reply *invite friends* and I’ll give you a ready-to-send message.`
}

export function buildReferralReply() {
  return `🎁 *Invite 3 friends to AskGogo*

Copy and send this:

“I’ve been testing AskGogo — an AI assistant on WhatsApp for reminders, calendar planning, weather, sports updates and daily briefings.

You can type or send voice notes in Indian languages.

Try it here:
${ASK_GOGO_WHATSAPP_LINK}”

Founder beta users who invite friends will get priority early pricing when Razorpay goes live.`
}

export function buildPremiumWhatsappReply(
  intentType: string,
  userName?: string
) {
  if (intentType === 'welcome_menu') {
    return buildWelcomeReply(userName)
  }

  if (intentType === 'help_menu') {
    return buildHelpReply()
  }

  if (intentType === 'upgrade_plan') {
    return buildUpgradeReply()
  }

  if (intentType === 'referral_flow') {
    return buildReferralReply()
  }

  if (intentType === 'notify_me') {
    return buildNotifyMeReply(userName)
  }

  return buildHelpReply()
}
