with open('app/api/webhooks/whatsapp/route.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old = "        } else if (isInstagramReelPreview(bodyText) || isLinkPreviewCard(bodyText, firstMediaType)) {"

new = "        } else if (isInstagramReelPreview(bodyText) || isLinkPreviewCard(bodyText, firstMediaType) || (detectReelUrl(bodyText) !== null && numMedia > 0)) {"

if old in content:
    content = content.replace(old, new)
    print('Fix applied')
    with open('app/api/webhooks/whatsapp/route.ts', 'w', encoding='utf-8') as f:
        f.write(content)
else:
    print('Not found')
