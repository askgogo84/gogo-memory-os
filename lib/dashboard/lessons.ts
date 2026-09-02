export type GogoLesson = {
  key: string
  title: string
  minutes: number
  category: string
  description: string
  prompt?: string
  videoSrc?: string
  steps?: string[]
}

export const GOGO_LESSONS: GogoLesson[] = [
  {
    key: 'meet-gogo',
    title: 'Meet Gogo',
    minutes: 1,
    category: 'Start here',
    description: 'A quick overview of the second brain that lives with you on WhatsApp and the web.',
    videoSrc: '/askgogo_demo.mp4',
  },
  {
    key: 'first-reminder',
    title: 'Your first reminder',
    minutes: 1,
    category: 'Reminders',
    description: 'Say it naturally. Gogo turns a sentence into something you no longer need to hold in your head.',
    prompt: 'Remind me tomorrow at 10 AM to call Mom',
    steps: ['Tell Gogo what and when.', 'Gogo confirms the interpreted time.', 'Reply naturally if you want to move, snooze or change it.'],
  },
  {
    key: 'recurring-reminders',
    title: 'Recurring reminders',
    minutes: 1,
    category: 'Reminders',
    description: 'Daily, weekly and repeating routines without rebuilding the reminder each time.',
    prompt: 'Remind me every day at 6 PM to drink water',
    steps: ['Use everyday language such as every day or every Monday.', 'Gogo keeps the recurrence with the reminder.', 'You can change or resolve an occurrence later.'],
  },
  {
    key: 'voice-notes',
    title: 'Use your voice',
    minutes: 1,
    category: 'Capture',
    description: 'Send a voice note when typing is inconvenient. Gogo can turn speech into actions and notes.',
    steps: ['Open AskGogo on WhatsApp.', 'Hold the microphone and speak naturally.', 'For meetings, say meeting notes or use the recorder.'],
  },
  {
    key: 'lists-tasks',
    title: 'Lists and tasks',
    minutes: 1,
    category: 'Organize',
    description: 'Build grocery lists, project lists and tasks, then check things off from WhatsApp or the dashboard.',
    prompt: 'Add milk to my grocery list',
    steps: ['Name the item and list.', 'Ask to show the list any time.', 'Say done plus an item name to clear it.'],
  },
  {
    key: 'save-retrieve-documents',
    title: 'Save and find documents',
    minutes: 2,
    category: 'Memory',
    description: 'Save an image or PDF, then retrieve it later by name, person, amount or document type.',
    prompt: 'Find my saved document',
    steps: ['Say save this, then send the file — or send the file and say save this.', 'Gogo stores the original privately.', 'Ask naturally for it later; sensitive documents stay masked by default.'],
  },
  {
    key: 'screenshots-links',
    title: 'Screenshots and useful links',
    minutes: 1,
    category: 'Memory',
    description: 'Keep useful visual references and links without losing them inside old chats.',
    steps: ['Send the screenshot or link.', 'Tell Gogo what it means if the context is not obvious.', 'Search for it later by the words you remember.'],
  },
  {
    key: 'calendar',
    title: 'Connect your calendar',
    minutes: 1,
    category: 'Calendar',
    description: 'Bring Google Calendar into Today and let Gogo help around your real schedule.',
    prompt: 'Connect calendar',
    steps: ['Connect Google Calendar once.', 'Your day can include real events alongside reminders.', 'Ask Gogo to create or move calendar events naturally.'],
  },
  {
    key: 'meeting-recorder',
    title: 'Meeting recorder',
    minutes: 2,
    category: 'Meetings',
    description: 'Record a meeting, get the transcript, decisions and follow-ups, then turn actions into reminders.',
    prompt: 'Record meeting',
    steps: ['Start the AskGogo recorder from WhatsApp.', 'End the recording when the meeting is finished.', 'Review transcript, decisions and action items back in AskGogo.'],
  },
  {
    key: 'daily-brief',
    title: 'Daily Brief',
    minutes: 1,
    category: 'Planning',
    description: 'Wake up to the day already organized — weather, calendar, reminders and travel when relevant.',
    prompt: 'Today',
    steps: ['Choose your briefing time.', 'Keep WhatsApp briefing and email briefing independently on or off.', 'Use Today to turn the important parts into actions.'],
  },
  {
    key: 'memory-search',
    title: 'Search your second brain',
    minutes: 1,
    category: 'Memory',
    description: 'You do not need exact filenames. Ask using the person, brand, amount or phrase you remember.',
    prompt: 'Show me what I saved about Jopasu',
    steps: ['Ask naturally instead of browsing folders.', 'Gogo ranks your saved asset by title and context.', 'Open the original when you need the source file.'],
  },
  {
    key: 'travel',
    title: 'Travel with Gogo',
    minutes: 1,
    category: 'Travel',
    description: 'Send a ticket or itinerary and let Gogo keep the travel details and timing close at hand.',
    steps: ['Send a ticket image or PDF.', 'Gogo extracts useful travel details.', 'Use Today and reminders around departure and check-in.'],
  },
  {
    key: 'breathing',
    title: 'Breathe with Gogo',
    minutes: 1,
    category: 'Calm',
    description: 'Three breathing patterns with original ambient sound for a short reset inside the dashboard.',
    steps: ['Tap the meditating Gogo button.', 'Choose Balance, Stress Reset or Deep Relax.', 'Turn sound on if you want the generated soundscape.'],
  },
]
