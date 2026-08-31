# AskGogo Email Program — spec, from a Memorae teardown

Source: 201 emails to goverdhan.md@gmail.com, Aug 2026. Two senders, two entirely different programs.

---

## The one mechanic that matters

Every call to action in Memorae's lifecycle email is a **pre-filled WhatsApp link**. Not a login, not a magic token, not a dashboard.

```
👉 [Remind Clara, María and me that on Thursday at 2 PM we have a team lunch]
   https://wa.link/b97h7q
```

The link text *is* the command. Tapping it opens WhatsApp with that exact sentence typed into the composer, addressed to the bot. The user hits send and the feature just happened.

This is why the program works. There is no auth step, no context switch, no "log in to your account". The email is a remote control for the assistant, and the distance between reading and doing is one tap.

**AskGogo already has this.** `waLink()` in `lib/product-urls.ts` builds `api.whatsapp.com/send?phone=17605483659&text=<encoded>`. Every CTA in every email should be that function with a different `text` argument. Nothing new to build.

---

## Program 1 — Daily Brief

**From:** memorae@memorae.ai
**Cadence:** every day, ~08:30 IST
**Subject:** derived from the day's actual content, always suffixed with the date

Observed subjects, in order — note that none of them are templates:

- One meeting to focus on · Aug 31
- Quiet day, enjoy the calm · Aug 28
- Flight to Bengaluru this afternoon · Aug 27
- A calm and clear Monday · Aug 24
- Quiet day with no plans · Aug 25
- A calm, unbooked day ahead · Aug 19
- Quiet day, no scheduled items · Aug 20

The subject line is written *from* the data. An empty day gets "enjoy the calm" rather than "you have 0 events". That reframing is the entire reason an empty brief still gets opened.

### Body structure

```
Good morning, [Name]!
[One or two sentences of interpretation — not a list. What today is
 shaped like, and one suggestion about how to use it.]

[Weekday, Month DD, YYYY]

TODAY'S EVENTS
  Meeting — 16:00
  [ 5 MIN BEFORE ]  [ 10 MIN BEFORE ]     ← one-tap wa.link buttons

TASKS
  No tasks today.

REMINDERS
  No reminders today.

KEY POINTS
  1. [One observation that connects the items to each other, in the
     first person. Not a restatement of the list.]

[Closing offer — "If you need prep tips or want help organizing your
 afternoon before the meeting, just ask."]
```

### The buttons

Under each event: **5 MIN BEFORE** and **10 MIN BEFORE**. Both are wa.link CTAs that pre-fill a reminder request for that event. The copy underneath says it plainly:

> One tap and it's set: I'll nudge you on WhatsApp when it's time. No login, nothing else to do. Anything more? Just reply here, I read every answer.

Three separate promises in two lines — one tap, no login, and replies are read. Worth copying almost verbatim.

### Notes on tone

- First person throughout. "I already see your sole commitment is…"
- Empty sections are stated warmly, never as zeros
- No feature names, no product jargon, no marketing
- Ends with an open offer, not a CTA button

---

## Program 2 — Lifecycle drip

**From:** irati@memorae.ai — a named person with a title, not a brand
**Cadence:** daily, ~23:43 IST and sometimes ~11:43 IST
**Sent via:** ActiveCampaign

### The subject device

Subject and preview text form **one sentence broken in half**. The subject is a fragment that doesn't resolve; the preview completes it. In an inbox list both are visible, so the pair does the work.

| Subject | Preview | Teaches |
|---|---|---|
| Gogo, you have it | but you don't know where | Document retrieval |
| Gogo, don't write it. | review it | Meeting notes |
| Gogo, stop chasing. | and make it happen | Follow-up reminders |
| Gogo, you didn't notice. | but it's already working | Passive value |
| Gogo, tell me | in two lines | Quick capture |
| Gogo, and then, taxes | deadlines you can't miss | Expiry reminders |
| Gogo, check-in will catch you. | avoid it | Travel alerts |
| Gogo, your calendars don't talk | and it shows | Calendar connect |
| Gogo, not everyone needs the same | adjust it | Personalisation |
| Gogo, don't lose track | of your people | Contacts |
| Gogo, what's pending? | ask it | Task query |
| Gogo, don't ask for it every day | schedule it | Recurring reminders |
| Gogo, your links don't get lost. | check them | Link saving |
| Gogo, you can find your passwords now. | in seconds | Vault |
| Gogo, here's what you agreed on. | it doesn't get lost | Meeting capture |
| Gogo, what do you have this week? | ask it | Week ahead |
| Gogo, what if everyone could remember together? | Today I'll show you how to create reminders for your whole team in seconds. | Friend reminders |

Every one starts with the first name. Every one teaches **exactly one feature**. This is a feature-education drip disguised as a personal note.

### Body skeleton — verbatim structure from the team-reminders email

```
[Preview line — completes the subject]

[Name], a lot of things start with a simple sentence.

**But not everything is just about you.**

Some plans involve other people.

Here's how to handle it:

For yourself, it would be something like:

"Remind me that on Thursday at 2 PM there's a team lunch."

**But to do it as a group:**

👉 [Remind Clara, María and me that on Thursday at 2 PM we have a
    team lunch]  ← wa.link

**Even if these people don't have Memorae (yet),**

it saves it for each person.

And reminds you when it matters.

You offload your memory,

and theirs too,

**and make sure the plan actually happens.**

**Irati**
**Engagement Specialist at Memorae**

------

**P.S. Send a request to your people now,**
**so when it's time to create reminders,**
**you'll already have part of the work done.**
```

Structural rules worth keeping:

1. One idea per line, with blank lines between. Reads like a message, not a paragraph.
2. Show the basic version first, then the better version. Teaching by contrast.
3. The CTA is a real sentence in brackets, not a button labelled "Try it".
4. Signed by a person with a job title.
5. P.S. every time, with a reason to act now.

---

## AskGogo build spec

### Sender identity

Two senders, matching the split:

- `askgogo@askgogo.in` — the daily brief, written as the assistant
- A named human at `@askgogo.in` — the lifecycle drip, an engagement person with a title

Do not send both from the same address. They have different jobs and different voices.

### Timing

Memorae's lifecycle sends land at 23:43 IST — that's 20:13 in Spain, optimised for their market, not yours. For India:

- Daily brief: 07:00–07:30 IST, ahead of the WhatsApp briefing
- Lifecycle: 09:00 IST or 19:00 IST, tested against each other

### The duplication problem, and the answer

AskGogo already sends a daily briefing on WhatsApp at ~08:30 IST. Sending the same content by email is noise.

Make them different jobs:

- **WhatsApp brief** stays the daily driver — short, actionable, for engaged users
- **Email brief** goes to users who have not messaged in 7+ days. It is a re-engagement channel, and it works precisely because the 24-hour WhatsApp messaging window does not apply to it

That single rule turns a duplicate into a recovery mechanism, and it is the argument for building it at all.

### Lifecycle sequence for AskGogo

One feature per email, ordered by how quickly the user gets value:

| # | Subject | Preview | Feature | CTA text pre-filled into WhatsApp |
|---|---|---|---|---|
| 1 | Gogo, say it out loud | I'll write it down | Voice notes | *(voice — instruct, no prefill)* |
| 2 | Gogo, you'll forget this | unless you tell me now | Basic reminder | Remind me to call the bank tomorrow at 11 am |
| 3 | Gogo, send me the photo | I'll read it for you | Image notes | *(instruct to send a photo)* |
| 4 | Gogo, that PDF you were sent | I'll keep it findable | Documents | *(instruct to forward a PDF)* |
| 5 | Gogo, stop typing the same thing | schedule it once | Recurring reminders | Remind me to take my meds every day at 9 am |
| 6 | Gogo, your morning is noisy | let me sort it | Daily briefing | Today |
| 7 | Gogo, they still owe you | split it properly | Bill split | Split ₹4,800 dinner between me, Arjun and Sneha |
| 8 | Gogo, check-in opens while you sleep | forward the ticket | Travel | *(instruct to forward a ticket)* |
| 9 | Gogo, your calendar doesn't know | connect it once | Calendar | connect my calendar |
| 10 | Gogo, they didn't reply | I'll chase it | Follow-up reminders | Remind me if no reply from Ravi in 3 days |
| 11 | Gogo, what did I say about the lease | ask me | Document retrieval | Where is my lease? |
| 12 | Gogo, in your language | not mine | Multilingual | *(instruct — voice note in own language)* |

Each body follows the skeleton above: observation, contrast, the basic way, the better way, the bracketed CTA, three short benefit lines, signature, P.S.

### Onboarding sequence

Separate from the drip. Triggered on first WhatsApp message, once the email is captured:

1. **Immediately** — welcome, one thing to try, nothing else
2. **Day 1** — did it work? plus one feature they haven't touched
3. **Day 3** — the feature their usage suggests they'd want next
4. **Day 7** — the daily brief, switched on, with a sample

### What to reuse

- `waLink()` for every CTA
- The existing briefing generator for daily-brief content — it already assembles weather, calendar, reminders and next actions
- The magic-link pattern only if a CTA genuinely needs the dashboard. Most will not.

### What not to copy

- **The 23:43 send time.** Wrong market.
- **Emails every single day from the founder persona.** Memorae sends a lifecycle email daily on top of a daily brief. That is two emails a day forever, and their unread rate shows it — most of the irati emails in this account are still unread. Twice a week is more defensible.
- **The Delaware shell address in the footer.** Use the real registered entity.

---

## Open decisions

1. **Email provider.** Nothing is wired in `gogo-memory-os` today. Memorae uses ActiveCampaign. Resend is the lighter option for transactional plus simple sequences; ActiveCampaign or Customer.io if the drip logic gets conditional.
2. **Email capture.** The onboarding flow already asks for an email — confirm the capture rate before building a program that depends on it.
3. **Who signs the lifecycle emails.** It needs to be a real person with a real name, and they need to actually read replies. Memorae's "I read every answer" is only credible if true.
