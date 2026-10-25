# AskGogo product memory

Updated 4 October 2026 from the owner's explicit instructions. This is durable project guidance for implementation; it is not a claim that every capability is shipped or a write to an end user's AskGogo memory.

## Product direction

Build a combined experience: Instinct-style conversational continuity and proactive follow-through, with Muse-style WhatsApp and dashboard access to the same personal agent. These names describe the owner's desired experience, not verified claims about either competitor's internal architecture.

- One owner-scoped context across WhatsApp, dashboard, saved facts, corrections, tasks and browser handoffs.
- Retain the original request and later corrections. Resume the same task after missing information or human sign-in; do not create a new disconnected task.
- An ongoing find/watch request must persist its exact item or itinerary, location, eligibility conditions, cadence, last evidence and next check. Recheck until its condition is met, the user stops it or a real blocker requires input. A saved memory alone does not schedule work.
- Alert promptly after a qualifying result is actually observed. Show when the last and next checks occur; periodic checks cannot guarantee instantaneous detection. Do not repeatedly send unchanged blockers or the same offer.
- Return the observed provider product, restaurant or itinerary link. Opening the installed app depends on that provider and the phone; a cloud browser cart is not proof of the phone's cart.
- WhatsApp should give a concise useful result and link. Dashboard should show the same result, progress, evidence, blocker and next action, with human takeover where needed.
- Meeting shares must retain title, time zone, start/end, original meeting link and follow-up context. Past meetings must be identified as past; do not silently move them to another date.
- Completion requires evidence: provider readback for state changes and notification delivery receipts where available. Passing fixture tests is not a completed live investor demo.

## Reference video

Owner-selected Muse reference: [YouTube video](https://www.youtube.com/watch?v=7BeAeTo2evo).

Saved on 4 October 2026. Contents have NOT been inspected: the web fetch failed and the browser reached a Google unusual-traffic CAPTCHA. Do not infer the title, demonstrated features, transcript or internal implementation from the link. Human access or an accessible transcript is needed to finish the video analysis. The product direction above comes from the owner's messages and screenshots, not unseen video content.

## Implementation research

Read selected public Odysseus source at commit `2992bf6d368a11472323e47d3bfed91e79cefc6b` without installing or executing it.

- [Memory manager](https://github.com/odysseus-dev/odysseus/blob/2992bf6d368a11472323e47d3bfed91e79cefc6b/src/memory.py) loads persisted entries, supports owner filtering, refuses corrupt-store updates and uses an atomic file replacement when saving. Takeaway: durable storage, owner boundaries and failure handling matter independently of the model. Keep AskGogo's existing database; do not migrate it to JSON files.
- [Task scheduler](https://github.com/odysseus-dev/odysseus/blob/2992bf6d368a11472323e47d3bfed91e79cefc6b/src/task_scheduler.py) records scheduled tasks/runs, marks interrupted runs aborted at startup, moves overdue schedules forward and bounds agent steps. Takeaway: explicitly test restart recovery and duplicate dispatch. This code is not evidence of exactly-once WhatsApp delivery or retained interactive browser state.
- [Web tools](https://github.com/odysseus-dev/odysseus/blob/2992bf6d368a11472323e47d3bfed91e79cefc6b/src/agent_tools/web_tools.py) expose bounded web search and page fetch with sources and timeouts. These inspected tools do not establish a drop-in fix for Amazon, Flipkart, Zomato or IndiGo interaction failures. Other code has not been exhaustively audited.

Apply useful design principles with focused original repairs and measured comparisons. Do not claim an AJAX model switch or a wholesale framework replacement fixes browser navigation, durable monitoring or receipts.

## Acceptance evidence still required

1. Live exact product search returns a usable provider detail link, with the same result in WhatsApp and dashboard; verify the phone destination separately.
2. Correct a watch, restart its worker, and verify that the same saved task checks the corrected criteria. Existing 31-day elapsed-time test is simulated; scheduled same-day retention has live evidence.
3. Observe an eligible live result, receive one delivered alert, and verify that the next unchanged check does not duplicate it.
4. Pause for human sign-in or missing location, then resume the same browser task with that owner's retained context.
5. Complete a bounded flight search with exact airports, dates and passengers; distinguish observed fare conditions from a booking. No purchase or booking is part of these tests.

Latest exact deployments, failed runs and live evidence are recorded in [the working handoff](../outputs/COMMERCE_OVERNIGHT_HANDOFF.md). Read it before retries; do not repeat unchanged blocked scenarios.

The [pinned Odysseus comparison](ODYSSEUS_COMPARISON_20261004.md) records implementation evidence, limits and same-journey adoption gates. Keep the existing stack until an alternative demonstrates improvement on those journeys.
