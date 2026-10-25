import sys
with open("lib/bot/handlers/reminders.ts", encoding="utf-8") as f:
    content = f.read()

old = """  const when = new Date()
  if (unit.startsWith('min')) when.setMinutes(when.getMinutes() + value)
  else if (unit.startsWith('hour')) when.setHours(when.getHours() + value)
  else if (unit.startsWith('day')) when.setDate(when.getDate() + value)

  return { kind: 'one_time', remindAtIso: when.toISOString(), message: cleanMessageText(text) }
}

function parseDailyRecurring"""

new = """  const when = new Date()
  if (unit.startsWith('min')) when.setMinutes(when.getMinutes() + value)
  else if (unit.startsWith('hour')) when.setHours(when.getHours() + value)
  else if (unit.startsWith('day')) when.setDate(when.getDate() + value)

  if (unit.startsWith('day')) {
    const textWithoutRelative = text.replace(/\\bin\\s+\\d+\\s+(days?|hours?|mins?|minutes?)\\b/gi, '')
    const timeOverride = parseTimePart(textWithoutRelative)
    if (timeOverride) when.setHours(timeOverride.hour, timeOverride.minute, 0, 0)
  }

  return { kind: 'one_time', remindAtIso: when.toISOString(), message: cleanMessageText(text) }
}

function parseDailyRecurring"""

if old in content:
    content = content.replace(old, new)
    print("Reminder time fix applied")
else:
    print("Target not found - may already be applied")

with open("lib/bot/handlers/reminders.ts", "w", encoding="utf-8") as f:
    f.write(content)
