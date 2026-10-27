# Result cards — implementation plan

| Phase | What | Done when |
|---|---|---|
| 1 | Pure card model + tests; signed PNG route; worker sends card before text | Full suite + CI green; live WhatsApp flight search shows the card |
| 2 | Dashboard results page `/r/[id]` (flights): cards, filters, pick, Book | Mock parity at 375 px; Book starts approval |
| 3 | Round-trip cards | Card shows total for both legs |
| 4 | Hotels: pick a live price source (Google Hotels read), card + map page | Owner approves source |

Each phase is its own PR, merged after tests pass.
