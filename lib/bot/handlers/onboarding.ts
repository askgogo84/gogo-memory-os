/**
 * Interactive Onboarding Flow
 * New user gets a warm first-use message + a compact menu, then a tailored quick-start.
 */

export interface OnboardingState {
  step: 'menu' | 'setup' | 'done'
  choice?: number
  userName?: string
}

const EMAIL_OPT_IN_PROMPT =
  `\n\n📬 *Want Gogo Tips by email too?*\n` +
  `One useful AskGogo idea a day for your first month — reminders, documents, lists, travel, memory and shortcuts.\n\n` +
  `It’s completely optional. Open *Dashboard → You* and add the email you want to use:\n` +
  `https://app.askgogo.in/dashboard/you\n\n` +
  `_I won’t automatically use the Gmail account you connect to AskGogo._`

// ── Step 1: Welcome menu ──────────────────────────────────────────────────────

export function buildOnboardingMenu(userName?: string): string {
  const name = userName ? userName.split(' ')[0] : 'there'
  return (
    `👋 *Hi ${name}, I’m Gogo.*\n\n` +
    `I’m your personal memory and action assistant on WhatsApp.\n\n` +
    `Send me the things you don’t want to keep in your head — reminders, documents, screenshots, lists, meetings, travel details, or simply something you want to remember. I’ll organise them and bring them back when you need them.\n\n` +
    `*Try me now:*\n` +
    `_“Remind me tomorrow at 10 AM to call Mom.”_\n\n` +
    `Or just send me a photo, PDF or voice note. ✨\n\n` +
    `*Want a quick tour? Pick one:*\n` +
    `1️⃣ Reminders & follow-ups\n` +
    `2️⃣ Meeting notes & transcription\n` +
    `3️⃣ Save content\n` +
    `4️⃣ Expenses & finance\n` +
    `5️⃣ Notes, documents & memory\n` +
    `6️⃣ Show me everything\n\n` +
    `_Reply with 1–6, or just start talking to me naturally._`
  )
}

// ── Step 2: Tailored quick-start based on choice ──────────────────────────────

export function buildOnboardingFollowup(choice: number, userName?: string): string {
  const name = userName ? userName.split(' ')[0] : ''
  const greeting = name ? `Perfect, ${name}! ` : 'Perfect! '

  switch (choice) {
    case 1:
      return (
        `${greeting}Here’s the easiest way to use reminders:\n\n` +
        `⏰ *Simple*\n` +
        `_“Remind me tomorrow at 9 AM to call Rahul.”_\n\n` +
        `🔁 *Recurring*\n` +
        `_“Remind me every Monday at 9 AM for team standup.”_\n\n` +
        `🔔 *Follow-up*\n` +
        `_“Remind me about Priya’s invoice if there’s no reply in 3 days.”_\n\n` +
        `You can type it or send a voice note.\n` +
        `Say *my reminders* anytime to see what’s coming up.` +
        EMAIL_OPT_IN_PROMPT
      )

    case 2:
      return (
        `${greeting}AskGogo can turn meetings and voice notes into something useful:\n\n` +
        `🎙️ *Browser recorder*\n` +
        `Open app.askgogo.in/record.html before a meeting. End the recording when you’re done and I’ll organise the notes.\n\n` +
        `📱 *WhatsApp voice note*\n` +
        `Send me a voice-note recap after a meeting and I’ll extract the summary, decisions and action items.\n\n` +
        `Say *my meeting notes* to find past meetings, or *what’s pending* to see open follow-ups.` +
        EMAIL_OPT_IN_PROMPT
      )

    case 3:
      return (
        `${greeting}You can use AskGogo as a “save this for later” inbox:\n\n` +
        `📸 Forward an Instagram reel\n` +
        `💼 Send a LinkedIn post\n` +
        `▶️ Send a YouTube URL\n` +
        `📰 Send an article or web link\n\n` +
        `I’ll save the useful context so you can find it later.\n\n` +
        `Try: _“find the reel I saved about marketing”_ or _“show my YouTube saves.”_` +
        EMAIL_OPT_IN_PROMPT
      )

    case 4:
      return (
        `${greeting}Here are a few finance shortcuts:\n\n` +
        `💸 _“Paid 500 for lunch with Mathew.”_\n` +
        `🧾 _“Split 3,000 between me, Srinivas and Mathew.”_\n` +
        `📊 _“Show my expenses this week.”_\n` +
        `📅 _“Remind me on the 1st to pay the house cleaner.”_\n\n` +
        `Tell me naturally — I’ll work out the structure from the message.` +
        EMAIL_OPT_IN_PROMPT
      )

    case 5:
      return (
        `${greeting}This is where AskGogo becomes your second brain:\n\n` +
        `📝 *Notes*\n` +
        `_“Remember: the blue folder is in the study cabinet.”_\n\n` +
        `📄 *Documents*\n` +
        `Send a PDF or photo, then say _“save this document.”_\n\n` +
        `📸 *Screenshots & images*\n` +
        `Send something you want to keep and tell me what it is.\n\n` +
        `🔍 *Find it later*\n` +
        `_“Show me my lease agreement.”_\n` +
        `_“Find the payment screenshot.”_\n\n` +
        `📋 *Lists*\n` +
        `_“Add milk to shopping list.”_\n\n` +
        `For passwords, OTPs, PINs or other authentication secrets, use a dedicated password manager rather than saving them in chat.` +
        EMAIL_OPT_IN_PROMPT
      )

    case 6:
    default:
      return (
        `${greeting}Here’s the map — you don’t need to learn commands; just talk naturally.\n\n` +
        `⏰ *Reminders* — simple, recurring and follow-up\n` +
        `🎙️ *Meetings* — transcription, summaries and action items\n` +
        `🧠 *Memory* — notes, screenshots, photos and documents\n` +
        `📋 *Lists & tasks* — create, add, review and follow up\n` +
        `💸 *Money* — expenses and bill splits\n` +
        `🍎 *Nutrition* — meals and daily summaries\n` +
        `✈️ *Travel* — tickets and travel reminders\n` +
        `📅 *Calendar* — Google Calendar connection\n` +
        `☀️ *Daily briefing* — your day in one message\n` +
        `🧘 *Breathe with Gogo* — a calm breathing space in your dashboard\n` +
        `🖥️ *Dashboard* — say *dashboard* anytime for your personal control centre\n\n` +
        `Try one now:\n` +
        `• _“Remind me tomorrow at 9 to call Priya.”_\n` +
        `• _“What’s my day today?”_\n` +
        `• Send a screenshot and say _“save this.”_\n\n` +
        `Say *help* anytime if you want the menu again.` +
        EMAIL_OPT_IN_PROMPT
      )
  }
}

// ── Detect if user is replying to the onboarding menu ────────────────────────

export function isOnboardingMenuReply(text: string): number | null {
  const t = text.trim()
  if (/^[1-6]$/.test(t)) return parseInt(t)

  const emojiMap: Record<string, number> = {
    '1️⃣': 1, '2️⃣': 2, '3️⃣': 3, '4️⃣': 4, '5️⃣': 5, '6️⃣': 6,
  }
  if (emojiMap[t]) return emojiMap[t]

  if (/^reminders?/i.test(t)) return 1
  if (/^meetings?/i.test(t)) return 2
  if (/^(save|content|reels?)/i.test(t)) return 3
  if (/^(expenses?|finance|money)/i.test(t)) return 4
  if (/^(notes?|memory|documents?)/i.test(t)) return 5
  if (/^(all|everything|show)/i.test(t)) return 6
  return null
}
