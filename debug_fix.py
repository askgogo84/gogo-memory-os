with open('app/api/webhooks/whatsapp/route.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old = "    console.log('WhatsApp inbound:', { fromRaw, from, profileName, numMedia, messageSid: inboundMessageSid, body: String(formData.get('Body') || ''), mediaType: String(formData.get('MediaContentType0') || ''), allKeys: [...formData.keys()].join(',') })"

new = "    console.log('RAW_TWILIO:', Object.fromEntries([...formData.entries()]))\n" + old

if old in content:
    content = content.replace(old, new)
    print('Fix applied')
    with open('app/api/webhooks/whatsapp/route.ts', 'w', encoding='utf-8') as f:
        f.write(content)
else:
    print('Target not found - searching...')
    idx = content.find('WhatsApp inbound')
    print(f'Found at index: {idx}')
    print(repr(content[idx-4:idx+50]))
