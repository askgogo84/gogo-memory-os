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

Your personal AI assistant on WhatsApp.

I can help you with:
• reminders
• weather
• unread emails
• morning briefing
• sports updates
• quick reply drafts

Try:
• Remind me in 10 mins to call Rahul
• Bangalore weather tomorrow
• Show my unread emails
• Morning briefing
• Next RCB match

I’ll keep it short, useful and WhatsApp-native.`
}

export function buildHelpReply() {
  return `✨ *AskGogo Menu*

Here’s what you can ask me:

⏰ *Reminders*
• Remind me in 20 mins to call Rahul
• Remind me tomorrow at 9 am
• Snooze 10 mins
• Move it to 8 pm

📬 *Email*
• Show my unread emails
• Summarize my latest emails
• Reply to the latest mail

☀️ *Daily*
• Morning briefing
• Bangalore weather tomorrow
• Next RCB match

🚀 *Beta*
• Pricing
• Invite friends
• Notify me

Type any command naturally.`
}

export function buildUpgradeReply() {
  return `🚀 *AskGogo Founder Beta*

You’re using early access right now.

Payments are not live yet because Razorpay verification is still in progress.

Until then:
• You can continue using the free beta
• Your reminders will keep working
• Gmail and briefing features can be tested
• Early users will get founder pricing when payments go live

Expected plans:
• Starter — ₹299/month
• Pro — ₹999/month

Want early access to the founder offer?

Reply:
*notify me*

Want to invite friends?

Reply:
*invite friends*`
}

export function buildNotifyMeReply(userName?: string) {
  const name = cleanName(userName)

  return `✅ *You’re on the founder list, ${name}*

I’ll remember that you’re interested in early access pricing.

When payments go live, you’ll be among the first to get the founder offer.

Meanwhile, keep testing:
• reminders
• unread emails
• morning briefing
• weather
• sports alerts`
}

export function buildReferralReply() {
  return `🎁 *Invite friends to AskGogo*

Share this with people who live on WhatsApp and need a personal AI assistant.

Copy and send:

“I’ve been testing AskGogo — an AI assistant on WhatsApp for reminders, email help, weather, sports updates and morning briefings.

Try it here:
${ASK_GOGO_WHATSAPP_LINK}”

Founder beta users will get priority access when paid plans go live.`
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
