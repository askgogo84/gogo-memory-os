/**
 * Interactive Onboarding Flow
 * New user gets a clean menu → picks their #1 use case → gets a tailored quick-start
 */

export interface OnboardingState {
  step: 'menu' | 'setup' | 'done'
  choice?: number
  userName?: string
}

// ── Step 1: Welcome menu ──────────────────────────────────────────────────────

export function buildOnboardingMenu(userName?: string): string {
  const name = userName ? userName.split(' ')[0] : 'there'
  return (
    `👋 *Hey ${name}! Welcome to AskGogo.*\n\n` +
    `I'm your AI assistant inside WhatsApp — type or send a voice note anytime.\n\n` +
    `*What do you need most?*\n\n` +
    `1️⃣ *Reminders & follow-ups*\n` +
    `   _Never forget a task or follow-up_\n\n` +
    `2️⃣ *Meeting notes & transcription*\n` +
    `   _Record meetings, get notes instantly_\n\n` +
    `3️⃣ *Save content*\n` +
    `   _Save reels, articles, YouTube videos_\n\n` +
    `4️⃣ *Expenses & finance*\n` +
    `   _Track splits, expenses, salary_\n\n` +
    `5️⃣ *Notes & memory*\n` +
    `   _Save anything, find it later_\n\n` +
    `6️⃣ *Show me everything*\n\n` +
    `_Reply with a number (1-6)_`
  )
}

// ── Step 2: Tailored quick-start based on choice ──────────────────────────────

export function buildOnboardingFollowup(choice: number, userName?: string): string {
  const name = userName ? userName.split(' ')[0] : ''
  const greeting = name ? `Perfect${name ? ', ' + name : ''}! ` : 'Perfect! '

  switch (choice) {
    case 1:
      return (
        `${greeting}Here's how reminders work:\n\n` +
        `⏰ *Simple reminders*\n` +
        `_"Remind me at 9 AM tomorrow to call Rahul"_\n\n` +
        `🔔 *Follow-up reminders*\n` +
        `_"Remind me about Priya's invoice if no reply in 3 days"_\n\n` +
        `🔁 *Recurring reminders*\n` +
        `_"Remind me every Monday at 9 AM for team standup"_\n\n` +
        `📅 *Monthly reminders*\n` +
        `_"Remind me on the 1st of every month to pay rent"_\n\n` +
        `*Try it now* — send a voice note or type a reminder!\n\n` +
        `Say *my reminders* anytime to see all your reminders.`
      )

    case 2:
      return (
        `${greeting}Here's how meeting notes work:\n\n` +
        `🎙️ *Option 1 — Browser recorder*\n` +
        `Open this link before your next meeting:\n` +
        `👉 app.askgogo.in/record.html\n` +
        `_Tap End Meeting when done — notes arrive in 60 seconds_\n\n` +
        `📱 *Option 2 — WhatsApp voice note*\n` +
        `After a meeting, send a voice note summary\n` +
        `_I'll transcribe + extract action items_\n\n` +
        `✨ *What you get:*\n` +
        `• Summary + key decisions\n` +
        `• Action items with owner names\n` +
        `• Full transcript\n` +
        `• Speaker identification\n\n` +
        `Say *my meeting notes* to see past meetings.\n` +
        `Say *what's pending* to see open action items.`
      )

    case 3:
      return (
        `${greeting}Here's how content saving works:\n\n` +
        `📸 *Instagram reels*\n` +
        `Forward any Instagram reel → I save a summary\n\n` +
        `💼 *LinkedIn posts*\n` +
        `Forward any LinkedIn post → saved to your LinkedIn memory\n\n` +
        `▶️ *YouTube videos*\n` +
        `Send a YouTube URL → I transcribe + summarize it\n\n` +
        `📰 *Articles & links*\n` +
        `Forward any article → saved as a note\n\n` +
        `*Commands to retrieve:*\n` +
        `• _my instagram saves_\n` +
        `• _my youtube saves_\n` +
        `• _my linkedin saves_\n` +
        `• _find reel about marketing_\n\n` +
        `Try it now — forward any reel or YouTube link!`
      )

    case 4:
      return (
        `${greeting}Here's how expense tracking works:\n\n` +
        `💸 *Log an expense*\n` +
        `_"Paid 500 for lunch with Mathew"_\n` +
        `_"Split 1200 for dinner 3 ways"_\n\n` +
        `📊 *View expenses*\n` +
        `_"My expenses this week"_\n` +
        `_"My expenses with Rahul"_\n\n` +
        `🧾 *Split bills*\n` +
        `_"Split 3000 between me, Srinivas, and Mathew"_\n\n` +
        `💰 *Salary reminder*\n` +
        `_"Remind me on the 1st to pay house cleaner 2000"_\n\n` +
        `Try it — tell me about your last expense!`
      )

    case 5:
      return (
        `${greeting}Here's how notes & memory work:\n\n` +
        `📝 *Save anything*\n` +
        `_"Note: Rahul's number is 9876543210"_\n` +
        `_"Remember: office wifi password is abc123"_\n\n` +
        `📸 *Save images*\n` +
        `Send any photo → I read and save the text\n` +
        `_(receipts, business cards, whiteboards)_\n\n` +
        `🔍 *Find it later*\n` +
        `_"my notes"_ → see all saved notes\n` +
        `_"find note about Rahul"_ → search notes\n\n` +
        `📋 *Lists*\n` +
        `_"Add milk to shopping list"_\n` +
        `_"my shopping list"_\n\n` +
        `Try it — save something right now!`
      )

    case 6:
    default:
      return (
        `${greeting}Here's everything AskGogo can do:\n\n` +
        `⏰ *Reminders* — simple, recurring, follow-up\n` +
        `🎙️ *Meeting notes* — transcription + action items\n` +
        `📸 *Save content* — reels, YouTube, LinkedIn\n` +
        `💸 *Expenses* — split bills, track spending\n` +
        `📝 *Notes & memory* — save anything, find later\n` +
        `🍎 *Nutrition* — track meals, daily summary\n` +
        `✈️ *Travel* — forward tickets, auto-reminders\n` +
        `📅 *Calendar* — connect Google Calendar\n` +
        `☀️ *Daily briefing* — your day, every morning\n\n` +
        `👉 Reply *briefing on* and I'll send it at 8 AM daily.\n\n` +
        `*Quick commands to try:*\n` +
        `• _"Remind me tomorrow at 9 to call Priya"_\n` +
        `• _"What's my day today"_\n` +
        `• _"Note: meeting with ECL on Thursday"_\n` +
        `• Forward any Instagram reel\n\n` +
        `Say *help* anytime for the full menu. 🚀`
      )
  }
}

// ── Detect if user is replying to the onboarding menu ────────────────────────

export function isOnboardingMenuReply(text: string): number | null {
  const t = text.trim()
  // Pure number 1-6
  if (/^[1-6]$/.test(t)) return parseInt(t)
  // "1️⃣" emoji numbers
  const emojiMap: Record<string, number> = {
    '1️⃣': 1, '2️⃣': 2, '3️⃣': 3, '4️⃣': 4, '5️⃣': 5, '6️⃣': 6
  }
  if (emojiMap[t]) return emojiMap[t]
  // Keywords
  if (/^reminders?/i.test(t)) return 1
  if (/^meetings?/i.test(t)) return 2
  if (/^(save|content|reels?)/i.test(t)) return 3
  if (/^(expenses?|finance|money)/i.test(t)) return 4
  if (/^(notes?|memory)/i.test(t)) return 5
  if (/^(all|everything|show)/i.test(t)) return 6
  return null
}
