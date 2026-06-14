import re
with open("app/api/webhooks/whatsapp/route.ts", encoding="utf-8") as f:
    content = f.read()

old = "    const bodyText = String(formData.get('Body') || '')"
new = "    const bodyText = String(formData.get('Body') || '').slice(0, 2000) // Security: cap input length"

if old in content:
    content = content.replace(old, new)
    print("Security cap applied")
else:
    print("Already applied or different pattern")

with open("app/api/webhooks/whatsapp/route.ts", "w", encoding="utf-8") as f:
    f.write(content)
