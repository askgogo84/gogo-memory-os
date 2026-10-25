with open('app/api/webhooks/whatsapp/route.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old = "import { isInstagramReelPreview, detectReelUrl, detectInstagramPreviewCard, detectLinkedInPreviewCard } from '@/lib/services/reel-saver'"

if old in content:
    print('Import already correct')
else:
    old2 = "import { isInstagramReelPreview, detectReelUrl } from '@/lib/services/reel-saver'"
    new2 = "import { isInstagramReelPreview, detectReelUrl, detectInstagramPreviewCard, detectLinkedInPreviewCard } from '@/lib/services/reel-saver'"
    if old2 in content:
        content = content.replace(old2, new2)
        print('Import fixed')
        with open('app/api/webhooks/whatsapp/route.ts', 'w', encoding='utf-8') as f:
            f.write(content)
    else:
        idx = content.find('reel-saver')
        print('Found at:', idx)
        print(repr(content[idx-50:idx+100]))
