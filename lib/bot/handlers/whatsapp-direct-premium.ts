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
4. Bangalore weather tomorrow
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

📅 *Calendar*
• Connect calendar
• Today
• What’s on my calendar today?
• Add meeting tomorrow at 4 pm

☀️ *Daily*
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
      mediaUrl: null,
      text: `💚 *AskGogo Pricing*

Starting at ₹99/month — less than a cup of chai/day.

*Free Beta*
₹0
• 25 AI actions/month
• 3 active reminders
• 5 voice notes/month
• Weather, sports, reminders, lists

*Lite*
₹99/month
• 60 AI actions/month
• 5 active reminders
• 10 voice notes/month
• Weather & sports
• Lists and notes

*Starter*
₹149/month
• 100 AI actions/month
• 10 active reminders
• 30 voice notes/month
• Basic memory
• Lists & notes

*Pro — most popular*
₹299/month
• 250 AI actions/month
• 50 active reminders
• Calendar integration
• Today briefing
• Voice notes
• Web search: 30/month
• Quick drafts

*Founder Pro*
₹499/month
• 600 AI actions/month
• Priority access
• Calendar power features
• Web search: 100/month
• Best for power users

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

“I’ve been testing AskGogo — an AI assistant on WhatsApp for reminders, calendar planning, weather, sports updates and daily briefings.

You can type or send voice notes in Indian languages.

Try it here:
${ASK_GOGO_WHATSAPP_LINK}”

Founder beta users will get priority access when paid plans go live.`
    }
  }

  return null
}
