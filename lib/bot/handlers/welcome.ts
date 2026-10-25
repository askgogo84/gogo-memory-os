// AskGogo welcome copy (approved by Goverdhan, 21 Oct 2026).
// - buildWelcomeIntro: a person's first message (new user).
// - buildWelcomeBack: "Hi" from someone already using AskGogo.
// - buildAccessGrantedText: sent when an admin approves a waitlist number.
// WhatsApp formatting: *bold* only, no italics.

export const DASHBOARD_URL = 'app.askgogo.in/dashboard'

export function welcomeFirstName(name?: string | null) {
  const clean = String(name || '').trim()
  if (!clean || clean.toLowerCase() === 'friend') return 'there'
  return clean.split(/\s+/)[0]
}

const FEATURES = `*What I can do for you*
🍽️ *Book* · restaurant tables, and I can call the place for you
🛒 *Compare prices* · Amazon, Flipkart, Croma and more in one reply
✈️ *Travel* · find flights, keep your tickets, remind you to check in
⏰ *Remember* · reminders for you or a friend, notes, documents, bills
📅 *Calendar & email* · read your day, draft replies, add meetings
💰 *Track* · expenses, gold rates and price drops, with alerts
☀️ *Brief you* · a morning summary of what matters today

I always check with you before I pay, send or book anything.`

export function buildWelcomeIntro(name?: string | null) {
  return `👋 Hey ${welcomeFirstName(name)}, I'm *AskGogo*, your AI assistant that gets things done, right here on WhatsApp.

Type, send a voice note, or drop a screenshot. I'll take it from there.

${FEATURES}

*Try one now*
• Book a table for 2 at Toit tonight at 8
• Compare iPhone 16 256GB prices
• Remind me tomorrow at 9 am to call Divya

📲 Your dashboard: ${DASHBOARD_URL}
Type *help* anytime to see everything.`
}

export function buildWelcomeBack(name?: string | null) {
  return `👋 Welcome back, ${welcomeFirstName(name)}! What should I get done today?

• Plan my day
• What's pending?
• Compare prices for AirPods Pro
• Book a table for tonight

📲 ${DASHBOARD_URL} · Type *help* for everything I can do`
}

export function buildAccessGrantedText(name?: string | null) {
  return `🎉 You're in, ${welcomeFirstName(name)}! Your AskGogo access is now open.

I'm your AI assistant that gets things done, right here on WhatsApp. Type, send a voice note, or drop a screenshot.

${FEATURES}

*Try one now*
• Plan my day
• Compare iPhone 16 256GB prices
• Remind me tomorrow at 9 am to call Divya

📲 Your dashboard: ${DASHBOARD_URL} (sign in with this number)
Reply *Hi* to get started.`
}

// WhatsApp template version (Meta approval, UTILITY): plain account update, one variable, no variable at the edges.
export const ACCESS_GRANTED_TEMPLATE_BODY = `Hi {{1}}, your AskGogo access is now active.

You can now use AskGogo here on WhatsApp to book restaurant tables, compare prices across stores, plan travel, set reminders, track expenses and get a daily brief. AskGogo always checks with you before it pays, sends or books anything.

Reply Hi to get started, or sign in at app.askgogo.in/dashboard with this number.`

export const HELP_MENU = `✨ *Everything AskGogo can do*
Just talk to me normally: type, send a voice note, or a screenshot.

🍽️ *Bookings*
• Book a table for 2 at Toit tonight at 8
• Call District 6 and book a table for 4 on Saturday
• My bookings

🛒 *Prices & shopping*
• Compare iPhone 16 256GB prices
• Watch Sony WH-1000XM5 below ₹25,000
• Watch the 22K gold rate below ₹13,000

✈️ *Travel*
• Find flights from Bangalore to Delhi next Friday
• Send your ticket and I'll remind you to check in
• Where is my Jailer ticket?

⏰ *Reminders & people*
• Remind me tomorrow at 9 am to call Divya
• Remind me every Monday at 9 am to review the week
• Remind Nithin to send the report on Friday

📅 *Calendar & email*
• What's on my calendar today?
• Add a meeting with Nithin tomorrow at 4 pm
• Any important emails today?
• Draft an email to Nithin about the 4 pm meeting

📝 *Notes, documents & memory*
• Remember my car is parked at B2, slot 14
• Send a photo, PDF or screenshot and I'll keep it
• What do you remember about me?

💰 *Money*
• Spent 450 on lunch at Truffles
• How much did I spend this week?

🎙️ *Meetings*
• Send a meeting recording for notes and action items

☀️ *Your day*
• Plan my day · What's pending? · Summarise my week

🔒 I always check with you before I pay, send or book anything.
📲 Dashboard: ${DASHBOARD_URL}`
