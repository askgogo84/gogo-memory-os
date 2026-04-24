export type DirectWhatsappReply = {
  text: string
  mediaUrl?: string | null
  saveMemory?: string | null
}

const ASK_GOGO_WHATSAPP_LINK =
  process.env.ASK_GOGO_WHATSAPP_JOIN_LINK ||
  'https://wa.me/15797006612?text=Hi%20AskGogo'

function firstName(name?: string) {
  const clean = (name || '').trim()
  if (!clean || clean.toLowerCase() === 'friend') return 'there'
  return clean.split(' ')[0]
}

function envUrl(name: string) {
  const value = process.env[name]
  if (!value || !value.trim()) return null
  return value.trim()
}

export function getDirectWhatsappPremiumReply(input: string, userName?: string): DirectWhatsappReply | null {
  const raw = (input || '').trim()
  const lower = raw.toLowerCase()
  const name = firstName(userName)

  if (/^(hi|hello|hey|start|\/start|hi askgogo|hello askgogo|hey askgogo|start askgogo|askgogo)$/i.test(lower)) {
    return {
      mediaUrl: envUrl('ASKGOGO_WELCOME_GIF_URL'),
      text: `Hey ${name}, I’m *AskGogo* 👋

Your AI assistant inside WhatsApp.

Now you can use me by *typing or sending a voice note*.

I can help you with:
• reminders
• unread emails
• morning briefing
• weather
• sports updates
• quick reply drafts
• lists and notes
• web search

Try:
1. Send a voice note: “Remind me in 10 mins to call Rahul”
2. Bangalore weather tomorrow
3. Show my unread emails
4. Today
5. Next RCB match

Built for people who live on WhatsApp.`
    }
  }

  if (
    lower === 'help' ||
    lower === '/help' ||
    lower === 'menu' ||
    lower === 'commands' ||
    lower === 'what can you do' ||
    lower === 'features'
  ) {
    return {
      text: `✨ *AskGogo Menu*

🎙️ *Voice first*
Send a voice note in English, Hindi, Hinglish, Kannada, Tamil, Telugu or Malayalam.

⏰ *Reminders*
• Remind me in 20 mins to call Rahul
• Remind me tomorrow at 9 am
• Snooze 10 mins
• Move it to 8 pm
• Done

📬 *Email*
• Connect Gmail
• Show my unread emails
• Reply to the latest mail

☀️ *Daily*
• Today
• Morning briefing
• Bangalore weather tomorrow
• Next RCB match

🚀 *Beta*
• Pricing
• Notify me
• Invite friends

Type or speak naturally. I’ll understand.`
    }
  }

  if (
    lower === 'pricing' ||
    lower === 'price' ||
    lower === 'plans' ||
    lower === 'plan' ||
    lower === 'upgrade' ||
    lower === '/upgrade' ||
    lower === 'payment' ||
    lower === 'payments' ||
    lower.includes('razorpay')
  ) {
    return {
      mediaUrl: envUrl('ASKGOGO_PRICING_IMAGE_URL'),
      text: `💚 *AskGogo Pricing*

Less than a chai a day.

*Starter*
₹149/month — about ₹5/day
• 20 messages/day
• 5 active reminders
• Basic memory
• Lists & notes

*Pro — most popular*
₹299/month — about ₹10/day
• Unlimited messages
• Unlimited reminders
• Full memory everywhere
• Document analysis
• Web search
• Expense tracking
• Google Calendar sync

*Family*
₹399/month — about ₹2.5/day/user
• Everything in Pro
• 5 family members
• Shared lists & events
• Save 60%

*Current status*
Razorpay verification is in progress, so checkout is not live yet.

Until then, you’re on founder beta access.

Reply *notify me* and I’ll mark you for early founder pricing.`
    }
  }

  if (
    lower === 'notify me' ||
    lower === 'notify' ||
    lower === 'notify me when live' ||
    lower === 'notify me when payment is live' ||
    lower === 'founder offer' ||
    lower === 'founder pricing' ||
    lower.includes('early access')
  ) {
    return {
      mediaUrl: envUrl('ASKGOGO_SUCCESS_GIF_URL'),
      saveMemory: 'User asked to be notified when AskGogo Razorpay/payment/founder pricing goes live.',
      text: `✅ *You’re on the founder list*

I’ll remember that you want early access pricing.

When Razorpay goes live, you’ll be among the first to get the founder offer.

Meanwhile, you can keep using AskGogo beta on WhatsApp.`
    }
  }

  if (
    lower === 'invite' ||
    lower === 'invite friends' ||
    lower === 'refer' ||
    lower === 'referral' ||
    lower === 'share' ||
    lower.includes('invite my friends') ||
    lower.includes('refer friends')
  ) {
    return {
      mediaUrl: envUrl('ASKGOGO_REFERRAL_GIF_URL'),
      text: `🎁 *Invite friends to AskGogo*

Copy and send this:

“I’ve been testing AskGogo — an AI assistant on WhatsApp for reminders, email help, weather, sports updates and morning briefings.

You can type or send voice notes in Indian languages.

Try it here:
${ASK_GOGO_WHATSAPP_LINK}”

Founder beta users will get priority access when paid plans go live.`
    }
  }

  return null
}
