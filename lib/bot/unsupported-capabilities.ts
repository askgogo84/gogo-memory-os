// Requests AskGogo cannot do yet get one honest answer and the nearest useful alternative,
// instead of a model reply that improvises (Muse parity tests, 10-11 Oct, showed chat promising
// monitoring it never set up). Pure: patterns are narrow so ordinary requests pass through.

export type UnsupportedCapability = { id: string; reply: string }

const REMINDER = /\bremind|\breminder\b/i

const RULES: Array<{ id: string; test: (t: string) => boolean; reply: string }> = [
  {
    id: 'custom_app',
    test: (t) => /\b(?:build|code|make|create)\s+(?:me\s+)?(?:an?\s+)?(?:simple\s+|custom\s+|small\s+)?(?:kanban|trello|app|web\s*app|website|project\s+board|board)\b(?!\s+(?:meeting|exam|review))/i.test(t)
      && !/\b(?:list|plan|reminder|note)\b/i.test(t.split(/\bwith\b/i)[0] || ''),
    reply: "I can't build custom apps yet. I can keep your ideas as lists you manage here, for example *add <idea> to my ideas list*, and see them with *show my ideas list*.",
  },
  {
    id: 'music',
    test: (t) => /\b(?:spotify|jiosaavn|jio\s*saavn|gaana|wynk|apple\s+music|youtube\s+music)\b/i.test(t) && /\b(?:playlist|play|queue|song|songs)\b/i.test(t),
    reply: "I can't control Spotify or other music apps yet, so I haven't made a playlist. I can suggest songs for you to add yourself: say *suggest 20 songs like <artist or mood>*.",
  },
  {
    id: 'share_location_with_others',
    test: (t) => /\b(?:if|when(?:ever)?)\s+(?:my\s+)?(?:a\s+)?(?:family\s+member|wife|husband|partner|mom|mum|dad|father|mother|friend|someone|anyone)\b[^.?!]{0,60}\b(?:messages?|asks?|texts?|contacts?)\b[^.?!]{0,60}\b(?:where\s+i\s+am|my\s+location|share)\b/i.test(t),
    reply: "I only talk with you, and I won't share your whereabouts or calendar with anyone else. If you'd like, I can draft a message for you to send them yourself.",
  },
  {
    id: 'crypto_wallet',
    test: (t) => /\b(?:wallet(?:\s+address)?|xpub|btc\s+address|eth\s+address)\b/i.test(t) && /\b(?:transactions?|outgoing|transfers?|watch|alert|monitor)\b/i.test(t),
    reply: "I can't watch crypto wallet addresses yet, so nothing is being monitored. I can watch the news about a coin instead: say *track bitcoin news*.",
  },
  {
    id: 'youtube_comments',
    test: (t) => /\byoutube\b/i.test(t) && /\bcomments?\b/i.test(t),
    reply: "I can't read or reply to YouTube comments yet, so nothing was scheduled. Paste a few comments here and I'll draft replies for you to post.",
  },
  {
    id: 'dev_monitoring',
    test: (t) => /\b(?:sentry|crashlytics|datadog)\b/i.test(t) || (/\bgithub\b/i.test(t) && /\b(?:fix|crash|errors?|bug|pull\s+request|pr)\b/i.test(t)),
    reply: "I can't connect to Sentry or GitHub yet, so nothing is being watched. Paste an error or stack trace here and I'll explain the likely cause and a fix.",
  },
  {
    id: 'screen',
    test: (t) => /\b(?:look\s+at|see|watch|view|share)\s+(?:my\s+)?(?:screen|display|monitor)\b/i.test(t),
    reply: "I can't see your screen. Send a screenshot here and I'll tell you exactly where to click.",
  },
  {
    id: 'doc_edit',
    test: (t) => /\b(?:google\s+docs?|gdocs?|google\s+sheets?)\b/i.test(t) && /\b(?:open|edit|add|write|insert|reformat|update|change)\b/i.test(t) && /\bmy\b/i.test(t),
    reply: "I can read files you've connected, but I can't edit Google Docs yet. Tell me what to add and I'll write the paragraph here for you to paste in.",
  },
  {
    id: 'video_edit',
    test: (t) => /\b(?:cut|edit|trim|clip|splice)\b[^.?!]{0,40}\b(?:video|footage|recording)\b/i.test(t),
    reply: "I can't edit videos yet. I can help you plan the cut: tell me what the video is and what to keep, and I'll list the timestamps to look for.",
  },
  {
    id: 'avatar',
    test: (t) => /\byour\s+avatar\b/i.test(t),
    reply: "I don't have an avatar to dress up. I can tell you what's on your calendar today instead: say *what's my day*.",
  },
  {
    id: 'health_export',
    test: (t) => /\b(?:health|steps|weight|bmi|body\s+fat|fitness)\b/i.test(t) && /\b(?:export|dashboard|charts?|graphs?)\b/i.test(t),
    reply: "I can't build charts from health-app exports yet. Send me your recent numbers (for example weekly steps and weight) and I'll summarise the trend.",
  },
  {
    id: 'phone_call',
    test: (t) => /\b(?:call|phone|ring)\s+(?:up\s+)?(?:the\s+)?[\w&.'-]+(?:\s+[\w&.'-]+){0,3}\s+(?:customer\s+care|customer\s+service|support|helpline|hotline)\b/i.test(t) || /\bwait\s+on\s+hold\b/i.test(t),
    reply: "I can't make phone calls yet, so I haven't called anyone. I can find the right customer-care number and write a short script for your call: say *find <company> customer care number*.",
  },
  {
    id: 'email_to_calendar_automation',
    test: (t) => /\b(?:whenever|every\s+time|each\s+time|automatically)\b[^.?!]{0,60}\b(?:e-?mails?|mails?|gmail)\b[^.?!]{0,60}\bcalendar\b/i.test(t),
    reply: "Automatic calendar updates from email aren't available yet, so I haven't set one up. When a confirmation arrives, send me a screenshot or the text and I'll prepare the calendar entry for you to approve.",
  },
]

export function unsupportedCapability(text: string): UnsupportedCapability | null {
  const t = String(text || '').trim()
  if (!t || t.length > 600) return null
  if (REMINDER.test(t)) return null
  const rule = RULES.find((r) => r.test(t))
  return rule ? { id: rule.id, reply: rule.reply } : null
}
