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
      text: `👋 Hey ${name}, I’m *AskGogo*.

Your AI assistant inside WhatsApp.

You can *type*, send a *voice note*, or upload a *screenshot/photo*.

Try one now:
• Remind me in 10 mins to drink water
• Plan my day
• Save note: call Rahul tomorrow
• What’s on my calendar today?
• Meeting notes: we discussed follow-ups
• Send a screenshot and I’ll read it

Founder beta is live now.
Type *help* anytime to see what I can do.`
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
      text: `✨ *AskGogo Help Menu*

Use me by typing naturally, sending voice notes, or uploading screenshots/photos.

⏰ *Reminders*
• Remind me in 20 mins to call Rahul
• Remind me every day at 9 pm to review expenses
• Show my reminders
• Snooze 10 mins
• Done

📅 *Calendar*
• Connect calendar
• Today
• What’s on my calendar tomorrow?
• Add meeting with Srinivas tomorrow at 4 pm

📝 *Notes & screenshots*
• Save note: call Rahul tomorrow
• My notes
• Send a screenshot/photo and I’ll read + save it

🎙️ *Meeting notes*
• Send meeting audio
• Meeting notes: we discussed Razorpay follow-ups
• Reply *yes* to create reminders from action items

🧠 *Memory*
• Remember that I prefer morning meetings
• What do you remember about me?
• Forget my office address

🎁 *Founder beta*
• Pricing
• Usage
• Invite friends
• Share my win

Try: *Plan my day*`
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
• Meeting notes
• Quick drafts

*Founder Pro*
₹499/month
• 600 AI actions/month
• 200 active reminders
• Priority access
• Calendar power features
• Meeting/audio notes
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
