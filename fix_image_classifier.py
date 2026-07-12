with open("app/api/webhooks/whatsapp/route.ts", encoding="utf-8") as f:
    content = f.read()

old = """                model: 'claude-haiku-4-5', max_tokens: 10,
                messages: [{ role: 'user', content: [
                  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
                  { type: 'text', text: 'Does this image contain food or a meal? Reply only: YES or NO' }
                ]}]
              })
              const ans = check.content[0]?.type === 'text' ? check.content[0].text.trim() : 'NO'
              // Check for foreign text in response or direct YES/NO
              const upperAns = ans.toUpperCase()
              isFoodImage = upperAns.includes('YES') && !upperAns.includes('FOREIGN') && !upperAns.includes('JAPANESE') && !upperAns.includes('CHINESE') && !upperAns.includes('ARABIC')"""

new = """                model: 'claude-haiku-4-5', max_tokens: 20,
                messages: [{ role: 'user', content: [
                  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
                  { type: 'text', text: 'Classify this image into exactly ONE category. Reply with only the category word:\\n- FOOD (a plate, bowl, drink, or meal that is the main subject)\\n- DOCUMENT (handwritten notes, printed text, receipts, screenshots, forms, lists)\\n- OTHER (people, places, objects, products, anything else)\\n\\nIf the main subject is handwriting or text on paper or a screen, it is DOCUMENT, not FOOD. Reply with one word only.' }
                ]}]
              })
              const ans = check.content[0]?.type === 'text' ? check.content[0].text.trim() : 'OTHER'
              const upperAns = ans.toUpperCase()
              // Only treat as food if explicitly classified FOOD — everything else is a note
              isFoodImage = upperAns.includes('FOOD') && !upperAns.includes('DOCUMENT')"""

if old in content:
    content = content.replace(old, new)
    print("Image classifier fixed - now uses FOOD/DOCUMENT/OTHER categories")
    with open("app/api/webhooks/whatsapp/route.ts", "w", encoding="utf-8") as f:
        f.write(content)
else:
    print("Target not found - checking")
    idx = content.find("Does this image contain food")
    print(f"Found at: {idx}")
    if idx > -1:
        print(repr(content[idx-100:idx+200]))
