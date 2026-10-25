with open("lib/bot/handlers/reminders.ts", encoding="utf-8") as f:
    content = f.read()

# Strip trailing context phrases that leak into task text
old = """    .replace(/[,.]?\\s*\\b(okay|ok|yeah|yep|right)\\b\\.?$/gi, '')
    .replace(/\\bplease\\b/gi, '')"""

new = """    .replace(/[,.]?\\s*\\b(okay|ok|yeah|yep|right)\\b\\.?$/gi, '')
    .replace(/[,.]?\\s*\\bwill\\s+(pick|collect|get|grab|bring|come|be)\\b.{0,60}$/gi, '')
    .replace(/[,.]?\\s*\\b(pick it up|collect it|come by|drop by|swing by).{0,60}$/gi, '')
    .replace(/[,.]?\\s*\\bfrom you\\b.{0,40}$/gi, '')
    .replace(/\\bplease\\b/gi, '')"""

if old in content:
    content = content.replace(old, new)
    print("Task text cleanup fixed")
else:
    print("Target not found")

with open("lib/bot/handlers/reminders.ts", "w", encoding="utf-8") as f:
    f.write(content)
