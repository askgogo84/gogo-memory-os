# Gogo character system

Designed in Claude Design. Every action Gogo takes has its own character state (like Muse). Use these in every
AskGogo surface: dashboard, task cards, chat avatars, the side panel. Do not use the old meditating figure for status.

- `Gogo.dc.html` — the component. Props: `state` (one of the 15 below), `size` (48–480 px), `theme` (`light`/`dark`).
- `Gogo States.dc.html` — the sheet of all states; `Gogo Panels.dc.html` — usage in panels.
- `Gogo Character System.html` — the full bundled reference page.

| state | name | live line |
|---|---|---|
| idle | Idle | Ready when you are |
| thinking | Thinking / planning | Planning your trip… |
| searching | Searching the web | Searching live flight sources… |
| browsing | Deep browser work | Reading 6 pages in the background… |
| comparing | Comparing options | Comparing 14 options… |
| flight | Flight search | Checking current fares… |
| train | Train / IRCTC search | Checking seat availability… |
| grocery | Grocery / food search | Building your cart… |
| booking | Booking / preparing | Preparing your booking… |
| approval | Waiting for approval | Waiting for your approval… |
| otp | Waiting for OTP / login | Continue on your phone — I will pick up from here |
| watcher | Background watcher | Watching fares for Delhi → Goa |
| done | Completed / verified | Booked and verified |
| blocked | Blocked / needs help | This site needs your login to continue |
| failed | Failed — trying another way | That route did not work — trying another way (never red) |

Sizes: 48 mobile card · 72 task card · 120 side rail · 200 expanded. Live task text sits under Gogo.
