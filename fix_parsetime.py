with open("lib/bot/handlers/reminders.ts", encoding="utf-8") as f:
    content = f.read()

old = """  const match = raw.match(/(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?/i)
  if (!match) return null
  let hour = parseInt(match[1], 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const ampm = match[3]?.toLowerCase()
  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  // Apply smart AM/PM defaults when no explicit AM/PM given
  // ampm is the matched group - if explicit use it, otherwise smart default
  if (ampm) {
    if (ampm.toLowerCase() === 'pm' && hour < 12) hour += 12
    if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0
  } else {
    // No AM/PM: 1-6 = PM, 7-11 = AM, 12 = PM
    if (hour >= 1 && hour <= 6) hour += 12
    // 7-11 stay as AM (no change needed)
    if (hour === 12) hour = 12
  }
  return { hour, minute }
}"""

new = """  const match = raw.match(/(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)/i)
    || raw.match(/\\b(\\d{1,2})(?::(\\d{2}))?\\b(?!\\s*(?:min|hour|day|week|month|year|st|nd|rd|th))/i)
  if (!match) return null
  let hour = parseInt(match[1], 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const ampm = match[3]?.toLowerCase() || null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  // Single clean AM/PM resolution — no double-application
  if (ampm === 'pm' && hour < 12) hour += 12
  else if (ampm === 'am' && hour === 12) hour = 0
  else if (!ampm) {
    // Smart defaults: 1-6 no ampm = PM, 7-11 = AM, 12 = noon PM
    if (hour >= 1 && hour <= 6) hour += 12
    // 7-11 stay as-is (AM), 12 stays as 12 (noon)
  }
  return { hour, minute }
}"""

if old in content:
    content = content.replace(old, new)
    print("Fixed cleanly")
else:
    print("Not found - checking line by line")
    lines = content.split("\\n")
    for i, line in enumerate(lines):
        if "const match = raw.match" in line:
            print(f"Line {i+1}: {line}")

with open("lib/bot/handlers/reminders.ts", "w", encoding="utf-8") as f:
    f.write(content)
