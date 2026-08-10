# Memorae — Design Tokens & Asset Inventory

Everything you need to reproduce the look. All asset paths are on the public CDN
base **`https://cdn.memorae.ai`** — append the path shown (spaces are URL-encoded as `%20`).

---

## Color palette (measured from computed styles)

| Role | Value |
|------|-------|
| Primary blue (accent, links, active) | `#557BF4` (rgb 85,123,244) |
| Hall sky base | `#92B4D4` (rgb 146,180,212) |
| Hall sky gradient | light sky blue → paler blue (top-lit) |
| White (text on sky, cards) | `#FFFFFF` |
| Text — near-black | `#14140F` / `#31313A` |
| Text — dark gray | `#333333` |
| Text — muted gray | `#9A9AA1`, `#A1A1A7`, `#9F9F9F` |
| Light neutral / dividers | `#EDEDED` |
| Light blue tint (chips) | `#DFE7FF` |
| Cream surface | `#FAF9F5` |
| Dashboard panels | dark translucent, ~`rgba(20,20,20,0.5)` over blurred photo |
| Panel borders / hairlines | `rgba(255,255,255,0.08–0.16)` |
| CTA gradient ("Create new…", "Add a friend") | purple → magenta, ~`#6D5FF6 → #E255A1` |
| "Unlock Supernova" gradient | blue → purple → pink |
| Park (Memory Bubble) bg | light blue vertical gradient |
| Coffee bg | soft warm cream→peach gradient |
| Clean up bg | dark navy/teal |

## Typography
- **Figtree** (primary UI font) — available on Google Fonts.
  Fallback stack: `Figtree, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Weights: greeting/H1 ~700–800 (large), body ~400–500, labels ~500–600.
- Big display headings on Hall/rooms; standard 14–16px body in the dashboard.

## Shape & effects
- Very rounded: pills/chips fully rounded; cards ~16–24px radius.
- Heavy use of **glassmorphism** (translucent panels + backdrop blur) over photographic backgrounds.
- Soft drop shadows on white pills; glossy iridescent mascot sphere.

---

## Asset inventory (base `https://cdn.memorae.ai`)

### Brand & mascot
- `/l3/Memorae_logo_home_white.png` — wordmark logo (white)
- `/l3/memorae-side-chat.webp` — mascot bubble (176×176), the floating assistant

### Backgrounds
- `/l3/newhomepage/bg-new-hall.webp` — Hall/Portal sky
- `/l3/dashboard-bg-desk.webp` — blurred desk/laptop background (dashboard pages)
- `/l3/moving-cld.webp` — animated drifting cloud
- `/l3/newhomepage/cloude-white-complete-one.webp` — static clouds

### Hall command-chip icons (20×20)
- `/l3/what-can-i-share.webp`
- `/l3/remind-me-to.webp`
- `/l3/whats-my-schedule.webp`
- `/l3/save-this-link.webp`

### Hall panel icons
- `/l3/friends-icon.webp`
- `/l3/personalize-icon.webp`
- `/l3/integrations-icon.webp`
- `/l3/master-memorae-icon.webp`

### Dashboard card art / illustrations
- `/New-Dashboard/Frame%202147238259.webp`
- `/New-Dashboard/Frame%202147238532.webp`
- `/New-Dashboard/Frame%202147238438.webp`
- `/New-Dashboard/Frame%202147238533.webp`
- `/l3/TaskTrackerDashboard.webp`
- `/l3/happy-young-woman-greeting-someone.webp`
- `/l3/multicalendar.webp`
- `/l3/light-mem-2.webp`
- `/l3/daily%20brief%20(2).webp`
- `/l3/image%20intelligence%20(3).webp`
- `/l3/create%20and%20manage%20lists.webp`
- `/l3/memory%20everywhere%20(2).webp`
- `/l3/friend%20to%20friend%20reminders.webp`
- `/l3/Button-2.webp`

### Third-party
- `https://ui-avatars.com/api/` — generated letter avatars (e.g. "GO")

> Note: images are served through Next.js `/_next/image` optimization at runtime; the paths above are the
> underlying originals. A few decorative avatars/hats in Master Memorae load lazily and aren't all listed here.

---

## Route map (sitemap)

```
/en/hall/                              Portal (sky home + command bar)
/en/dashboard/panel/                   Office / Dashboard (sidebar app)
/en/dashboard/friends/                 Friends
/en/dashboard/integrations/            Integrations (Supernova paywall)
/en/dashboard/reminders/               Reminders
/en/dashboard/calendar/                Calendars
/en/dashboard/lists/                   Lists
/en/dashboard/tasks/                   Tasks / Boards
/en/dashboard/master-memorae/          Master Memorae (Actions / Tricks / Use Cases)
/en/dashboard/master-memorae/use-cases/  Use Cases
/en/dashboard/personalize/             Choose a personality / Personalize
/en/dashboard/profile/                 Profile
/en/memory-bubble/everything/          Park / Memory Bubble (Everything / My bubbles / Clean up)
```
Room switcher (Hall bottom nav): **Portal → /en/hall/ · Office → /en/dashboard/panel/ ·
Coffee → in-Hall chat · Park → /en/memory-bubble/everything/**
