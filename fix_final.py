with open("lib/bot/handlers/reminders.ts", encoding="utf-8") as f:
    content = f.read()

# The double-application is the bug - lines 164-165 AND 171-173 both run
# Simple fix: remove the duplicate block (lines 169-179), keep only 164-165
old = """  if (ampm === 'pm' && hour < 12) hour += 12
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

new = """  if (ampm === 'pm' && hour < 12) hour += 12
  else if (ampm === 'am' && hour === 12) hour = 0
  else if (!ampm) {
    // Smart defaults: 1-6 = PM, 7-11 = AM, 12 = noon
    if (hour >= 1 && hour <= 6) hour += 12
  }

  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}"""

if old in content:
    content = content.replace(old, new)
    print("Fixed")
    with open("lib/bot/handlers/reminders.ts", "w", encoding="utf-8") as f:
        f.write(content)
else:
    print("Not found")
    # Show exact chars around the issue
    idx = content.find("if (ampm === 'pm' && hour < 12) hour += 12")
    print(f"Found at index: {idx}")
    print(repr(content[idx:idx+50]))
