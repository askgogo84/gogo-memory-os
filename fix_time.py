with open("lib/bot/handlers/reminders.ts", encoding="utf-8") as f:
    content = f.read()

# Fix applySmartAmPm - 10 should stay as 10 (AM), not get +12
old = """function applySmartAmPm(hour: number, hasAmPm: boolean, ampm?: string): number {
  if (hasAmPm && ampm) {
    if (ampm.toLowerCase() === 'pm' && hour !== 12) return hour + 12
    if (ampm.toLowerCase() === 'am' && hour === 12) return 0
    return hour
  }
  // Smart defaults: 1-6 without AM/PM = PM (daytime work hours), 7-11 = AM, 12 = PM
  if (hour >= 1 && hour <= 6) return hour + 12  // 1->13, 2->14 ... 6->18
  if (hour === 12) return 12  // noon
  return hour  // 7-11 stay as AM
}"""

new = """function applySmartAmPm(hour: number, hasAmPm: boolean, ampm?: string): number {
  if (hasAmPm && ampm) {
    if (ampm.toLowerCase() === 'pm' && hour !== 12) return hour + 12
    if (ampm.toLowerCase() === 'am' && hour === 12) return 0
    return hour
  }
  // Smart defaults when no AM/PM given:
  // 1-6 = PM (afternoon work hours), 7-11 = AM (morning), 12 = PM (noon)
  if (hour >= 1 && hour <= 6) return hour + 12
  if (hour === 12) return 12
  return hour  // 7, 8, 9, 10, 11 stay as AM
}"""

if old in content:
    content = content.replace(old, new)
    print("applySmartAmPm - already correct, checking parseTimePart...")
else:
    print("Function not found as expected - checking what is there")

# The real bug: parseTimePart returns raw hour without calling applySmartAmPm
# Find the final return and ensure it calls applySmartAmPm
old2 = """  // Apply smart AM/PM defaults when no explicit AM/PM given
  const resolvedHour = ampm ? hour : applySmartAmPm(hour, false)
  return { hour: resolvedHour, minute }"""

new2 = """  // Apply smart AM/PM defaults when no explicit AM/PM given
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
  return { hour, minute }"""

if old2 in content:
    content = content.replace(old2, new2)
    print("parseTimePart return fixed")
else:
    # Find what is actually there
    idx = content.find("Apply smart AM/PM")
    if idx > -1:
        print("Found at:", idx)
        print(repr(content[idx:idx+200]))
    else:
        print("Not found - searching for resolvedHour")
        idx2 = content.find("resolvedHour")
        print("resolvedHour at:", idx2)
        if idx2 > -1:
            print(repr(content[idx2-50:idx2+150]))

with open("lib/bot/handlers/reminders.ts", "w", encoding="utf-8") as f:
    f.write(content)
