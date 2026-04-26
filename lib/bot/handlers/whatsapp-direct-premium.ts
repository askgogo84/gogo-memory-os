export type DirectWhatsappReply = {
  text: string
  mediaUrl?: string | null
  saveMemory?: string | null
}

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
• recurring reminders
• calendar planning
• today briefing
• memory
• weather
• sports updates
• lists and notes
• web search

Try:
1. Send a voice note: “Remind me in 10 mins to call Rahul”
2. Connect calendar
3. Today
4. Show my reminders
5. Invite friends

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
• Remind me every day at 9 pm to review expenses
• Show my reminders
• Cancel water reminder
• Snooze 10 mins
• Done

📅 *Calendar*
• Connect calendar
• Today
• What’s on my calendar today?
• Add meeting tomorrow at 4 pm

🧠 *Memory*
• Remember that I prefer morning meetings
• What do you remember about me?
• Forget my office address

🚀 *Beta*
• Pricing
• Usage
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

Built for WhatsApp-first productivity.

*Free Beta*
₹0
• 25 AI actions/month
• 3 active reminders
• Voice notes enabled
• Weather, sports, reminders, lists

*Starter*
₹149/month
• 100 AI actions/month
• 10 active reminders
• Voice notes
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
      text: `✅ *You’re on the founder pricing list, ${name}*

I’ll remember that you want early access when paid plans go live.

Want priority Founder Beta access?
Invite 3 friends who live on WhatsApp.

Reply *invite friends* and I’ll give you your referral link.`
    }
  }

  // Referral commands are handled by referral-unlock.ts before this direct handler.
  return null
}
