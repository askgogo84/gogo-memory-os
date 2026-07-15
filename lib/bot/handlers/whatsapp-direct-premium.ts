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
      mediaUrl: null,
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

  // Referral commands are handled by referral-unlock.ts before this direct handler.
  return null
}
