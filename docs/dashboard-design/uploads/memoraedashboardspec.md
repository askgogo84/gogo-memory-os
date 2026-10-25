# Memorae Dashboard — Full Structure Spec

Captured from `https://memorae.ai` on 2026-08-10 for rebuilding in Claude design.
Personal data (real email / phone / password) has been redacted and replaced with placeholders.

---

## 1. Concept & information architecture

Memorae is a "memory layer" assistant with a playful cloud/sky + bubble-mascot theme.
The product is organized as **four "rooms"** switched from a bottom pill nav in the Hall, plus a
**classic left-sidebar dashboard** reached from the "Office" room.

```
Memorae
├── PORTAL  (Hall)            /en/hall/                → sky home + command bar
├── OFFICE  (Dashboard)       /en/dashboard/panel/     → sidebar app
│   ├── Hall                  /en/hall/
│   ├── Dashboard             /en/dashboard/panel/
│   ├── Friends               /en/dashboard/friends/
│   ├── Integrations          /en/dashboard/integrations/   (Supernova paywall)
│   ├── Reminders             /en/dashboard/reminders/
│   ├── Calendars             /en/dashboard/calendar/
│   ├── Lists                 /en/dashboard/lists/
│   ├── Tasks (Boards)        /en/dashboard/tasks/
│   ├── Master Memorae        /en/dashboard/master-memorae/
│   │   ├── Actions           (21-step onboarding checklist)
│   │   ├── Tricks            (life-hack library)
│   │   └── Use Cases         /en/dashboard/master-memorae/use-cases/
│   ├── Choose a personality  /en/dashboard/personalize/
│   └── Profile               /en/dashboard/profile/
├── COFFEE (Chat)             in-Hall view → "Coffee with Memorae" conversation
└── PARK   (Memory Bubble)    /en/memory-bubble/everything/
    ├── Everything            /en/memory-bubble/everything/  (memory board / masonry)
    ├── My bubbles            (park-bench empty state)
    └── Clean up              (paywall modal → Upgrade)
```

Persistent global elements: a floating **mascot bubble** bottom-right (opens chat) on every dashboard
page; a **blurred desk photo** background across all sidebar pages; the Hall uses a **sky** background.

---

## 2. PORTAL / Hall — `/en/hall/`

Full-bleed **sky background** (soft blue gradient, drifting clouds).

- **Top-left:** small circular icon button (settings/meditate toggle).
- **Top-right:** circular icon button (download/notifications).
- **Center column:**
  - Mascot bubble (glossy iridescent sphere with a smiling face), ~176px.
  - Time-based greeting headline: "Good evening, Gogo" / "Good night, Gogo" (huge, white, bold).
  - Subtitle: "Talk to me, or pick where you feel pull."
  - **Command bar** (rounded pill, translucent white): rotating placeholder that types out prompts
    like "Summarize my Berlin trip notes", "Remind me to call mom tomorrow", "Remind…". Right side:
    a `+` (add file/image) button and a circular **record/submit** button.
  - **4 suggestion chips** (white rounded pills, small icon + two-line label):
    - 🟣 "What can I save here?" · *Teach me*
    - 🔔 "Remind me to __" · *Fill in the blanks*
    - 📅 "What's on my schedule?" · *Retrieve what I know*
    - 🔖 "Save this link" · *Park it for later*
- **Bottom-right stacked cards** (white pills, icon + label + status):
  - Friends · 1 partners → `/en/dashboard/friends/`
  - Personalize · Customize → `/en/dashboard/personalize/`
  - Integrations · 1 active → `/en/dashboard/integrations/`
  - (a 4th, Master Memorae · 1/21 actions, appears in the same cluster)
- **Bottom-left toast** (dismissible): "CONTINUE TO MASTER MEMORAE / Create Your First Reminder /
  Unlocks Baseball Cap" with an X.
- **Bottom-center room switcher** (pill segmented control): **Portal · Office · Coffee · Park**
  (Portal active = filled white with blue text).

---

## 3. OFFICE / Dashboard — `/en/dashboard/panel/`

Two-column app: **left sidebar** + **main content**, over a blurred desk/laptop photo.

**Left sidebar** (dark translucent, ~240px):
- Wordmark "memorae" (top) + collapse `X`.
- Nav (icon + label): Hall, **Dashboard** (active), Friends, Integrations, Reminders, Calendars,
  Lists, Tasks, Master Memorae, Choose a personality.
- Bottom: gradient pill **"Unlock Supernova"**; user row (avatar "GO", name, phone) → Profile.

**Main content:**
- Header banner over a laptop photo: "Welcome back, Gogo" (small) + "What's on your mind today?" (H1).
- **Card grid** (glassy dark cards, each with a mascot illustration in header + a "View all/more" pill):
  - **Reminder** — empty: "No reminders". Footer prompt chips: "Memorae, remind me to call mom",
    "Memorae, wakeup at 7am".
  - **Calendars** — shows "Monday 10", empty: "No events". Chips: "Memorae, schedule meeting at 3pm",
    "Memorae, show my schedule for today".
  - **Lists** — empty: "No lists". Chips: "Memorae, add milk to shopping list", "Memorae, create a todo list".
  - **Today's Tasks** — empty: "No tasks in Today".
- Top-right icon cluster (inbox/bag, bell, mute) and the floating mascot bubble bottom-right.

---

## 4. COFFEE — "Coffee with Memorae" (chat)

Casual chat mode (reached via the Coffee room tab). Split layout over a soft warm gradient:
- **Left rail:** heading "Coffee with Memorae", mascot + **coffee cup** illustration, "Change drink" pill.
- **Right:** a scrollable **conversation** — user bubbles (right, white) and assistant text (left).
  Example content includes onboarding help ("7 things I can do", "10 actionable things you can do right now").
- **Bottom:** wide input "Type or record a new thought" with `+` and record button.
- Bottom-center room switcher present.

---

## 5. PARK / Memory Bubble — `/en/memory-bubble/everything/`

Light blue gradient sky theme. Top bar: **Home** button (left); segmented tabs **Everything · My bubbles ·
Clean up** (center); inbox/bell toggle + mute (right).

**Everything tab** — big italic search "Search your Memory…" then a **masonry board** of memory tiles:
- "Type or record a new thought" input tile (+, mic, send).
- Saved items as varied cards: app captures (Instagram), AI images (Mona-Lisa bubble), a
  "AI Agent morae" card, photos (laptop, smartwatch, people at a laptop), a **video** tile (play button),
  a quote card ("Live in the…"), a **FILE** tile ("Document shared: E-itinerary.pdf,…"), and a
  "My Memorae Motion Graphic explainer" tile.

**My bubbles tab** — hero **park scene**: wooden bench on grass under blue sky, the mascot sitting on the
bench, speech bubble "MEMORAE / Welcome! Create your first bubble.", and a translucent **`+`** bubble to create one.

**Clean up tab** — dark-themed "Clean up your Memory…" screen (memory cards with Keep/Delete), gated behind a
modal: mascot + "Clean up your memory" / "Review your saved memories, keep what still matters, and forget what
you no longer need." + **Upgrade plan** button + "Not right now".

---

## 6. Friends — `/en/dashboard/friends/`

- Title "Friend-to-friend Reminders" / "Send reminders to friends via WhatsApp and manage your connections."
  + **"New contact +"** button (top-right).
- **Stat pills:** Total friends: 1 · Pending: 0 · Active reminders: 0 · This month: 2.
- **4 quota progress bars:** Your Friends 1/20 (19 left) · Daily reminders 2/10 (8 left) ·
  Monthly reminders 2/100 (98 left) · Daily additions 1/5 (4 left). (each with a colored gradient fill)
- **Left column:** search "Search contacts", filter tabs All / Friend / Pending, contact list rows
  (avatar, name, [Friend] badge, phone).
- **Right panel empty state:** people icon, "Ready to connect?", "Send friend requests and schedule reminders
  through WhatsApp.", **"Add a friend"** gradient button.

---

## 7. Integrations — `/en/dashboard/integrations/`  (gated)

Shows the **Supernova upgrade** view for this account (no free integrations UI reachable):
- Mascot wearing AR glasses + speech bubble "Ready to unlock more?".
- Billing toggle **Monthly / Annual** (Annual shows **-50%**).
- Plan card **Supernova**, badge "6 MONTHS FREE":
  - Annual: ~~₹1300~~ **₹650** per month · "12 months for ₹7800".
  - Monthly: **₹1300** per month.
  - "Everything in Origin plus…" then feature tiles: **Long Term Memory, Daily Briefing, Image to Action,
    Full Control Dashboard, Google Workspace integration**.
- **"Unlock Supernova"** gradient CTA.

---

## 8. Reminders — `/en/dashboard/reminders/`

- Title "Reminders" + mascot (glasses + party horn).
- **Stat cards:** 1 Active (Currently live reminders) · 0 Recurring (Repeating reminders) ·
  3 Completed (Done successfully) · 4 Total (Created overall).
- Toolbar: search "Search for a reminder", sort dropdown "Newest first", filter "All",
  **"Create new reminder"** gradient button.
- **Reminder row:** bell icon, "get milk", "3:23 PM · Today", edit + delete icons on hover.

---

## 9. Calendars — `/en/dashboard/calendar/`

- Title "Calendars" + mascot; top-right **account/calendar selector** (Google account) + `+`.
- View toggle **Month / Week / Day**; month + year selectors ("August" / "2026"); refresh; "Today";
  prev/next arrows.
- **Source chips:** connected Google calendar, "Family". **Legend dots:** Meeting, Focus, All day.
- **Month grid** (Aug 2026, current day highlighted) + right **"Today's events"** panel (dated, skeletons when empty).

---

## 10. Lists — `/en/dashboard/lists/`

- Title "Lists" + mascot; search "Search elements"; sort "Newest first"; **"Create new list"** gradient button.
- Tabs: **My lists / Shared with me**.
- Empty state: bell icon, "No lists found", "Create your first list to get started".

---

## 11. Tasks / Boards — `/en/dashboard/tasks/`

- Title "Your Boards" / "Boards with your upcoming tasks". Tabs **My boards / Shared with me**. "Today" · 0/0.
- **Board card** "Gogo" (⋮ menu): big check "ALL CLEAR", "0 pending tasks".
- **"Create new board"** dashed card with `+`.

---

## 12. Master Memorae — `/en/dashboard/master-memorae/`

Full-screen (no sidebar), back arrow top-left. Title "Master Memorae" / "Watch, try, and unlock rewards as you
learn." **Three entry cards** (each a colorful mascot illustration):

- **Actions** — "1/21 completed | Learn by doing" (+ progress bar).
- **Tricks** — "Small tricks. Big time saved."
- **Use Cases** — "Ready-to-use prompts for daily life."

### 12a. Actions (21-step onboarding)
Header "Actions" / "Keep going, every step unlocks a new reward." + segmented progress bar (1/21).
Each row = video thumbnail + duration + title + subtitle + **reward badge** (a hat). Full list:

| # | Title | Subtitle | Reward |
|---|-------|----------|--------|
| 1 | Discover Memorae (02:17) | Get started by sending an audio and say the magic words | Avatar Hat ✓ unlocked |
| 2 | Create Your First Reminder (00:40) | Learn to create it in seconds by saying what and when | Baseball Cap (next) |
| 3 | Schedule your first recurring reminder (00:52) | Make it repeat daily, weekly, monthly, or on specific days | Beanie |
| 4 | Save Things for Later (00:49) | Plus learn how to retrieve them when needed | French Beret |
| 5 | Create your first friend to friend reminder (01:05) | Add contacts via WhatsApp and start reminding them | Slouch Cap |
| 6 | Create Your First Task (00:48) | Discover the new task manager | Bucket Hat (Blue) |
| 7 | Create Your First List (00:54) | Create, edit, and check off lists directly from chat | Bucket Hat (Red) |
| 8 | Configure Memorae (01:28) | Unlock daily briefings, events, meetings and smart email | Cocktail Hat |
| 9 | Activate your Daily Briefing (01:01) | Receive your full day in one message: events, tasks, emails | Cowboy Hat |
| 10 | Create your first event (01:12) | Create, edit, move or cancel events directly from chat | Crown |
| 11 | Create your first Bubble (01:06) | Build visual collections to group related content | Explorer Hat |
| 12 | Save a useful password (01:09) | Store and retrieve everyday passwords securely | Flat Cap |
| 13 | Search across all your channels (01:30) | Find anything without remembering where it was saved | Graduation Cap |
| 14 | Clean your memory with Clean up (01:05) | Let go of what no longer matters without manual sorting | Hard Hat |
| 15 | Install the Chrome Extension (01:04) | Save pages, articles, flights and links from your browser | Military Helmet |
| 16 | Install your widget (00:35) | Capture ideas, tasks and reminders from your home screen | Party Hat |
| 17 | Join the community (00:56) | Access tips, updates, feedback and direct contact with the team | Pharaoh Headdress |
| 18 | Turn images into action (01:02) [SUPERNOVA][BIG BANG] | Send a photo/screenshot and turn it into tasks, reminders, events or contacts | Pilot Cap |
| 19 | Connect Google Workspace (01:18) [SUPERNOVA][BIG BANG] | Link Drive, Docs and Sheets to retrieve and summarize files | Pirate Hat |
| 20 | Activate your smart email (01:49) [BIG BANG] | Classify, retrieve and draft email without opening Gmail | Security Cap |
| 21 | Close with clarity (01:45) | Finish the journey — Memorae gives you mental space back | Top Hat |

### 12b. Tricks
Header "Tricks" / "Creative life hacks powered by Memorae". Search + category chips
(**All, Capture, Birthday, Share & Earn, Health, Love, Security, Travel**). Sectioned card grid:
- **Capture:** Pin Memorae Chat · Capture with Widgets · iPhone Shortcut · Chrome Extension
- **Birthday:** Never Miss Birthdays · Gift Ideas List
- **Share & Earn:** Mind Savers Club (Invite friends. Earn rewards.)
- **Health:** Cycle-Based Training & Nutrition · Pill Routine
- **Love:** Anniversary Love · Unexpected Smile · Be There on Time
- **Security:** Phone Lost? IMEI · Pin Number · Puk Number · Passwords
- **Travel:** Block Travel Time · Travel Bubble · Check-in Reminder

### 12c. Use Cases — `/en/dashboard/master-memorae/use-cases/`
Header "Use Cases" / "Copy prompts, they go straight to Memorae chat." **6 persona cards** (illustrated header +
2 example prompts each with a **TRY IT** button + **VIEW MORE +**):
- **Creatives** — "My week has no order, no shape."
- **Families** — "Everyone needs something, and I'm the one supposed to remember."
- **Travelers** — "I'm moving between places, and everything I need is scattered."
- **Operations** — "One small detail can break the whole process."
- **Follow-ups** — "I said I would do it, and I don't want to drop it."
- **Entrepreneurs** — "I'm building something new, and there is no map yet."

---

## 13. Choose a personality / Personalize — `/en/dashboard/personalize/`

Full-screen, back arrow. Title "Personalize Memorae" / "Make Memorae feel more like you". **Two big cards:**
- **Personality** (face icon) — "Choose how Memorae talks to you".
- **Dress Memorae** (shirt icon) — "Style your Memorae with unlocked items".
Large mascot displayed on a **purple pedestal** at the bottom.

---

## 14. Profile — `/en/dashboard/profile/`

Centered single column. Title "Profile" / "Here you can update your email address, phone number, and password…".
- **Account Information** (Member since Aug 5, 2026): Email `[user email]`; Phone number `[user phone]` [Change];
  Password `••••••••` [Change]; Language "English (US)" [Change]; Notification Channel "Whatsapp" [Change].
- **Subscription Details:** plan **Origin** (month plan) with **Trialing** badge; [Change plan] [Manage subscription];
  "Next billing date: August 13, 2026"; "Need help? support@memorae.ai".
- **Danger Zone:** "Manage subscription cancellation" + [Show cancellation options].
- **End session:** "Finish your session safely from this device." + red **[Sign out]**.
