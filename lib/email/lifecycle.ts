import { waLink } from '@/lib/product-urls'

export type LifecycleEmail = {
  key: string
  day: number
  subject: (firstName: string) => string
  preheader: string
  title: string
  body: string[]
  example?: string
  ctaLabel: string
  ctaPrompt: string
  secondaryLabel?: string
  secondaryUrl?: string
}

// The progression intentionally mirrors the habit-building structure we observed
// in the Memorae / Irati onboarding series (one capability at a time), but all
// copy below is original AskGogo copy and reflects AskGogo's actual product.
export const LIFECYCLE_EMAILS: LifecycleEmail[] = [
  {
    key: '01-first-reminder', day: 0,
    subject: (n) => `${n}, give Gogo one thing to remember`,
    preheader: 'Start with one tiny reminder and get it out of your head.',
    title: 'Your first win takes one sentence.',
    body: [
      'You do not need to learn AskGogo before using it. Start with one thing you genuinely do not want to forget.',
      'Tell Gogo naturally, exactly the way you would tell another person. I will turn it into a reminder and bring it back at the right time.',
    ],
    example: 'Remind me tomorrow at 10 AM to call Mom.',
    ctaLabel: 'Create my first reminder', ctaPrompt: 'Remind me tomorrow at 10 AM to call Mom',
  },
  {
    key: '02-recurring', day: 1,
    subject: (n) => `${n}, let the repeating things run themselves`,
    preheader: 'Daily, weekly and monthly reminders without rebuilding them each time.',
    title: 'Some things should repeat without you.',
    body: [
      'The best reminders are the ones you never have to recreate.',
      'AskGogo can repeat reminders daily, weekly, monthly or on a specific cadence. Set it once and move on.',
    ],
    example: 'Remind me every Monday at 9 AM for the team stand-up.',
    ctaLabel: 'Set a recurring reminder', ctaPrompt: 'Remind me every Monday at 9 AM for the team stand-up',
  },
  {
    key: '03-voice', day: 2,
    subject: (n) => `${n}, say it instead of typing it`,
    preheader: 'Voice notes work too.',
    title: 'Your thumbs can take the day off.',
    body: [
      'When typing is annoying, send Gogo a voice note.',
      'Use it for reminders, quick thoughts, meeting summaries or anything you want organised. The point is to capture it before it disappears.',
    ],
    example: 'Voice note: “Tomorrow morning remind me to send the investor deck.”',
    ctaLabel: 'Open AskGogo', ctaPrompt: 'I want to try a voice note',
  },
  {
    key: '04-lists', day: 3,
    subject: (n) => `${n}, loose thoughts belong in a list`,
    preheader: 'Groceries, packing, workstreams and anything else that grows over time.',
    title: 'Keep related things together.',
    body: [
      'A reminder is one thing. A list is everything around it.',
      'Create shopping lists, packing lists, project lists or anything else you keep adding to. AskGogo keeps the list and lets you check items off later.',
    ],
    example: 'Add passport, charger and headphones to my New York packing list.',
    ctaLabel: 'Start a list', ctaPrompt: 'Create a New York packing list and add passport, charger and headphones',
  },
  {
    key: '05-calendar', day: 4,
    subject: (n) => `${n}, your calendar can come to you`,
    preheader: 'Ask what is on your day instead of opening another app.',
    title: 'Stop checking. Start asking.',
    body: [
      'Once Google Calendar is connected, Gogo can tell you what is on your day and include it in your briefing.',
      'You can ask about today, tomorrow or a specific date without hunting through calendar views.',
    ],
    example: 'What do I have tomorrow?',
    ctaLabel: 'Ask about tomorrow', ctaPrompt: 'What do I have tomorrow?',
  },
  {
    key: '06-documents', day: 5,
    subject: (n) => `${n}, where is that document?`,
    preheader: 'Save the original file and retrieve it later by meaning.',
    title: 'Documents should be easier to find than to lose.',
    body: [
      'Send AskGogo a PDF or image and say what it is. Gogo can keep the original file and help you retrieve it later.',
      'For identity and financial documents, sensitive details stay masked in normal retrieval replies. Never send passwords, OTPs, PINs or authentication secrets.',
    ],
    example: 'Save this as my lease agreement.',
    ctaLabel: 'Save a document', ctaPrompt: 'I want to save a document',
  },
  {
    key: '07-screenshots', day: 6,
    subject: (n) => `${n}, that screenshot can become memory`,
    preheader: 'Screenshots are useful only if you can find them again.',
    title: 'Send the screenshot. Keep the context.',
    body: [
      'Payment proof, an address, a booking detail, a product you liked — screenshots usually matter for a reason.',
      'Send the image and tell Gogo what you want remembered. Later, ask for it in plain English.',
    ],
    example: 'Save this payment screenshot for the ₹51,000 transfer.',
    ctaLabel: 'Try it with an image', ctaPrompt: 'I want to save a screenshot',
  },
  {
    key: '08-links', day: 7,
    subject: (n) => `${n}, save the link before it disappears`,
    preheader: 'Articles, reels, videos and useful pages can all become searchable memory.',
    title: 'Interesting now. Findable later.',
    body: [
      'Forward useful links to Gogo instead of leaving them in open tabs or saved-message graveyards.',
      'AskGogo can save and summarise supported articles, videos and social content so you can search by what it was about later.',
    ],
    example: 'Send a YouTube or article link and say “save this”.',
    ctaLabel: 'Open AskGogo', ctaPrompt: 'I want to save a link',
  },
  {
    key: '09-dashboard', day: 8,
    subject: (n) => `${n}, WhatsApp is only the front door`,
    preheader: 'Your Zen dashboard gives you a quiet view of everything Gogo holds.',
    title: 'There is a calm space behind the chat.',
    body: [
      'WhatsApp is where you talk to Gogo. The dashboard is where you can see the bigger picture.',
      'Home, Today, Tasks, Memory, Calendar, Lists and your account all live there — with light and dark modes and a breathing space when you need a minute.',
    ],
    ctaLabel: 'Open my dashboard', ctaPrompt: 'dashboard',
    secondaryLabel: 'Open dashboard directly', secondaryUrl: 'https://app.askgogo.in/dashboard',
  },
  {
    key: '10-preferences', day: 9,
    subject: (n) => `${n}, Gogo should fit you — not the other way around`,
    preheader: 'Use the parts that matter and ignore the rest.',
    title: 'You do not need every feature.',
    body: [
      'Some people live in reminders. Others mostly save documents, plan travel or capture meeting notes.',
      'AskGogo works best when it becomes invisible infrastructure around the habits you already have. Keep using the parts that reduce friction for you.',
    ],
    ctaLabel: 'Tell Gogo what matters', ctaPrompt: 'The things I want the most help with are…',
  },
  {
    key: '11-google', day: 10,
    subject: (n) => `${n}, connect the things that already know your day`,
    preheader: 'Calendar and Gmail make AskGogo more useful with less input.',
    title: 'Connect once. Ask naturally afterwards.',
    body: [
      'When Google Calendar is connected, Gogo can include meetings in your day. Gmail can help you work with mail when you explicitly ask.',
      'Connections stay tied to your AskGogo profile and can be managed from your dashboard.',
    ],
    ctaLabel: 'Open connected accounts', ctaPrompt: 'Gogo, help me connect Google',
    secondaryLabel: 'Go to account', secondaryUrl: 'https://app.askgogo.in/dashboard/you',
  },
  {
    key: '12-email-forwarding', day: 11,
    subject: (n) => `${n}, important things often arrive by email`,
    preheader: 'Tickets, confirmations and documents should not die inside an inbox.',
    title: 'Bring important email into memory.',
    body: [
      'A booking, itinerary, invoice or document often starts life in your inbox.',
      'When you want something from an email remembered, bring the relevant information or attachment into AskGogo rather than relying on inbox search months later.',
    ],
    ctaLabel: 'Ask Gogo how', ctaPrompt: 'How should I save something important from my email?',
  },
  {
    key: '13-task-query', day: 12,
    subject: (n) => `${n}, ask what is still open`,
    preheader: 'Turn memory into action.',
    title: 'Saved is useful. Pending is better.',
    body: [
      'As reminders and tasks accumulate, you should not have to remember what you already told Gogo.',
      'Ask for what is pending and let Gogo bring the active items back into view.',
    ],
    example: 'What do I have pending?',
    ctaLabel: 'Show what is pending', ctaPrompt: 'What do I have pending?',
  },
  {
    key: '14-calendar-query', day: 13,
    subject: (n) => `${n}, ask for the meeting instead of searching for it`,
    preheader: 'Natural-language retrieval works for your schedule too.',
    title: 'The calendar is a question away.',
    body: [
      'Try asking about a meeting by date, person or timeframe.',
      'The habit we want is simple: when you need the answer, ask Gogo before you start opening tools.',
    ],
    example: 'When is my meeting with Divya?',
    ctaLabel: 'Ask about a meeting', ctaPrompt: 'When is my next meeting?',
  },
  {
    key: '15-briefing', day: 14,
    subject: (n) => `${n}, let the day introduce itself`,
    preheader: 'Your morning briefing can combine reminders, calendar and useful context.',
    title: 'Start with one calm summary.',
    body: [
      'A good daily brief does not need to be long. It just needs to tell you what matters before the day starts pulling at you.',
      'Turn on the AskGogo morning briefing and choose the time that suits you.',
    ],
    example: 'briefing on',
    ctaLabel: 'Turn on my briefing', ctaPrompt: 'briefing on',
  },
  {
    key: '16-plan-day', day: 15,
    subject: (n) => `${n}, turn the brief into a plan`,
    preheader: 'Knowing the day is step one. Shaping it is step two.',
    title: 'Move from summary to action.',
    body: [
      'Once Gogo shows your day, you can ask for help turning it into concrete reminders and a simple plan.',
      'That is where the assistant starts feeling less like storage and more like a working memory.',
    ],
    example: 'Plan my day.',
    ctaLabel: 'Plan my day', ctaPrompt: 'Plan my day',
  },
  {
    key: '17-week-ahead', day: 16,
    subject: (n) => `${n}, zoom out for a minute`,
    preheader: 'A week view catches things your morning view cannot.',
    title: 'What is coming this week?',
    body: [
      'When several days are busy, looking only at today can hide what is approaching.',
      'Ask Gogo for the week ahead before it becomes the day-of problem.',
    ],
    example: 'What do I have this week?',
    ctaLabel: 'Show my week', ctaPrompt: 'What do I have this week?',
  },
  {
    key: '18-people', day: 17,
    subject: (n) => `${n}, not every reminder is only about you`,
    preheader: 'Keep track of people and shared follow-ups.',
    title: 'Remember the people around the task.',
    body: [
      'Some things need a person attached: call Divya, nudge Srinivas, follow up with Mathew.',
      'AskGogo can keep those people-oriented reminders together so relationship follow-ups do not vanish under more urgent work.',
    ],
    example: 'Remind me Friday to follow up with Mathew about the deck.',
    ctaLabel: 'Create a people reminder', ctaPrompt: 'Remind me Friday to follow up with Mathew about the deck',
  },
  {
    key: '19-followups', day: 18,
    subject: (n) => `${n}, follow-up is where things usually break`,
    preheader: 'Give the second step a time too.',
    title: 'Do not rely on “I’ll remember to follow up.”',
    body: [
      'Sending the message is only half the job. The thing that gets lost is checking back later.',
      'When a follow-up matters, tell Gogo when to bring it back.',
    ],
    example: 'Remind me in 3 days to check if they replied.',
    ctaLabel: 'Create a follow-up', ctaPrompt: 'Remind me in 3 days to check if they replied',
  },
  {
    key: '20-travel', day: 19,
    subject: (n) => `${n}, travel has too many tiny deadlines`,
    preheader: 'Tickets, check-in, departure and documents can live together.',
    title: 'Let Gogo carry the small travel details.',
    body: [
      'Trips create a pile of details: ticket, PNR, check-in, departure time, hotel, documents and packing.',
      'Send supported tickets or itineraries to Gogo and keep the trip details closer to the conversation where you can ask for them.',
    ],
    ctaLabel: 'Save a trip detail', ctaPrompt: 'I want to save a travel ticket',
  },
  {
    key: '21-search-memory', day: 20,
    subject: (n) => `${n}, you do not need to remember the filename`,
    preheader: 'Search by meaning, person, amount or context.',
    title: 'Ask for what you remember about it.',
    body: [
      'People rarely remember exact filenames. They remember “that payment screenshot”, “Srini’s passport” or “the lease agreement”.',
      'That is how AskGogo retrieval is designed to feel: describe the thing, not the storage system.',
    ],
    example: 'Show me the lease agreement.',
    ctaLabel: 'Search my memory', ctaPrompt: 'Show me something I saved recently',
  },
  {
    key: '22-memory-usage', day: 21,
    subject: (n) => `${n}, memory matters when it changes what you do`,
    preheader: 'The value is retrieval at the moment you need it.',
    title: 'Do not just collect. Reuse.',
    body: [
      'Saving is only the first half of a memory product.',
      'Try using Gogo as the first place you ask for a past note, document, decision, list or commitment. Retrieval is the habit that makes the system compound.',
    ],
    ctaLabel: 'Retrieve something', ctaPrompt: 'What have I saved recently?',
  },
  {
    key: '23-cleanup', day: 22,
    subject: (n) => `${n}, your second brain should stay tidy`,
    preheader: 'Review what you no longer need.',
    title: 'Useful memory also knows what to forget.',
    body: [
      'Old notes, completed lists and irrelevant memories eventually create noise.',
      'Use the dashboard to review what Gogo holds, and use forget/delete controls when something no longer belongs there.',
    ],
    ctaLabel: 'Review my memory', ctaPrompt: 'What did I save recently?',
    secondaryLabel: 'Open Memory', secondaryUrl: 'https://app.askgogo.in/dashboard/memory',
  },
  {
    key: '24-automatic-review', day: 23,
    subject: (n) => `${n}, let Gogo surface what is easy to miss`,
    preheader: 'Briefings and resurfacing help saved context come back at useful moments.',
    title: 'Memory should return before you search for it.',
    body: [
      'Some information is valuable precisely because it returns at the right moment.',
      'Keep your briefing and reminders useful, and Gogo can bring the things you already captured back into your working day.',
    ],
    ctaLabel: 'Show my day', ctaPrompt: 'What’s my day today?',
  },
  {
    key: '25-deadlines', day: 24,
    subject: (n) => `${n}, deadlines are cheaper before they are urgent`,
    preheader: 'Renewals, taxes, payments and expiries belong on the calendar before the panic.',
    title: 'Give important dates a home early.',
    body: [
      'Renewals, tax dates, subscriptions and document expiries are perfect AskGogo material because they matter later, not now.',
      'Capture the date when you first see it and let future-you receive the reminder.',
    ],
    example: 'Remind me 30 days before my passport expires.',
    ctaLabel: 'Save a deadline', ctaPrompt: 'I want to save an important deadline',
  },
  {
    key: '26-security', day: 25,
    subject: (n) => `${n}, some things should never become chat memory`,
    preheader: 'A quick security rule for your second brain.',
    title: 'Useful memory has boundaries.',
    body: [
      'AskGogo can safely handle many documents and mask sensitive identifiers during normal retrieval.',
      'But do not send passwords, OTPs, PINs, CVVs, API keys or authentication secrets. Those belong in a dedicated password manager, not a chat assistant.',
    ],
    ctaLabel: 'Review Memory', ctaPrompt: 'What can I safely save in AskGogo?',
  },
  {
    key: '27-personality', day: 26,
    subject: (n) => `${n}, make Gogo feel like your assistant`,
    preheader: 'Natural language is the interface.',
    title: 'You can talk normally.',
    body: [
      'You do not need command syntax for most things. Short, messy, conversational messages are fine.',
      'The closer AskGogo gets to “tell someone who already knows how I work”, the less friction you carry.',
    ],
    ctaLabel: 'Say something naturally', ctaPrompt: 'I need to remember something for next week',
  },
  {
    key: '28-feedback', day: 27,
    subject: (n) => `${n}, tell us what still feels like work`,
    preheader: 'The best product feedback is where the friction still lives.',
    title: 'What should Gogo make easier next?',
    body: [
      'If something takes too many steps, fails to understand you, or feels unlike the calm assistant we are trying to build, tell us.',
      'The most useful feedback is a real example of what you expected Gogo to do.',
    ],
    ctaLabel: 'Send feedback', ctaPrompt: 'Feedback for AskGogo: ',
  },
  {
    key: '29-videos', day: 28,
    subject: (n) => `${n}, send the video you meant to watch later`,
    preheader: 'YouTube and supported social content can become searchable notes.',
    title: 'Watch later is not a memory system.',
    body: [
      'Useful videos tend to pile up faster than you can watch them.',
      'Send supported video links to Gogo so the useful context can be summarised and found later without remembering which platform it came from.',
    ],
    ctaLabel: 'Save a video', ctaPrompt: 'I want to save a video link',
  },
  {
    key: '30-breathing', day: 29,
    subject: (n) => `${n}, your dashboard has a quiet corner`,
    preheader: 'Three guided breathing modes live inside your Zen dashboard.',
    title: 'Sometimes the next action is one minute of quiet.',
    body: [
      'AskGogo is built to reduce mental load, not just organise it.',
      'Tap the meditating Gogo in the dashboard for Balance, Stress Reset or Deep Relax breathing with original ambient soundscapes.',
    ],
    ctaLabel: 'Open my calm space', ctaPrompt: 'dashboard',
    secondaryLabel: 'Open Zen Home', secondaryUrl: 'https://app.askgogo.in/dashboard/home',
  },
  {
    key: '31-ideas', day: 30,
    subject: (n) => `${n}, one month in — try AskGogo differently`,
    preheader: 'A few combinations people often miss.',
    title: 'The useful part is combining the pieces.',
    body: [
      'Save a ticket, then ask what to pack. Save a meeting, then turn the action items into reminders. Save a document, then retrieve it by the person or context around it.',
      'The product gets more valuable when memory, reminders, lists, calendar and retrieval stop feeling like separate features.',
    ],
    ctaLabel: 'Ask Gogo for an idea', ctaPrompt: 'Show me one AskGogo feature I probably haven’t tried yet',
  },
]

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch))
}

export function renderLifecycleEmail(params: {
  email: LifecycleEmail
  firstName: string
  unsubscribeUrl: string
}) {
  const { email, firstName, unsubscribeUrl } = params
  const ctaUrl = waLink(email.ctaPrompt)
  const paragraphs = email.body.map((p) => `<p style="margin:0 0 18px;color:#6b4a34;font-size:16px;line-height:1.7">${escapeHtml(p)}</p>`).join('')
  const example = email.example
    ? `<div style="margin:24px 0;padding:16px 18px;border:1px solid #eadfd3;border-radius:16px;background:#fffaf5;color:#3e2312;font-size:15px;line-height:1.55"><strong>Try this:</strong><br>${escapeHtml(email.example)}</div>`
    : ''
  const secondary = email.secondaryUrl && email.secondaryLabel
    ? `<div style="margin-top:14px"><a href="${email.secondaryUrl}" style="color:#714c77;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(email.secondaryLabel)} →</a></div>`
    : ''

  const html = `<!doctype html><html><body style="margin:0;background:#f7f0e7;font-family:Arial,Helvetica,sans-serif;color:#3e2312"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(email.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f0e7"><tr><td align="center" style="padding:30px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fffdf9;border:1px solid #eadfd3;border-radius:24px;overflow:hidden"><tr><td style="padding:26px 30px 18px;background:linear-gradient(135deg,#fff4e7,#f7efe7)"><div style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#9a8778;font-weight:700">Gogo from AskGogo</div><div style="margin-top:8px;font-family:Georgia,serif;font-size:30px;line-height:1.15;color:#3e2312;font-weight:700">${escapeHtml(email.title)}</div></td></tr><tr><td style="padding:28px 30px 30px"><p style="margin:0 0 18px;color:#3e2312;font-size:16px;line-height:1.7">Hi ${escapeHtml(firstName)},</p>${paragraphs}${example}<a href="${ctaUrl}" style="display:inline-block;margin-top:4px;background:#f18219;color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 20px;border-radius:999px">${escapeHtml(email.ctaLabel)}</a>${secondary}<div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee5dc;color:#9a8778;font-size:12px;line-height:1.6">You’re receiving this because you asked AskGogo to keep in touch by email.<br><a href="${unsubscribeUrl}" style="color:#9a8778">Unsubscribe from Gogo Tips</a> · <a href="https://app.askgogo.in/dashboard" style="color:#9a8778">Dashboard</a></div></td></tr></table></td></tr></table></body></html>`

  const text = [
    `Hi ${firstName},`,
    '',
    email.title,
    '',
    ...email.body,
    ...(email.example ? ['', `Try this: ${email.example}`] : []),
    '',
    `${email.ctaLabel}: ${ctaUrl}`,
    ...(email.secondaryUrl && email.secondaryLabel ? [`${email.secondaryLabel}: ${email.secondaryUrl}`] : []),
    '',
    `Unsubscribe from Gogo Tips: ${unsubscribeUrl}`,
  ].join('\n')

  return { subject: email.subject(firstName), html, text }
}
