with open('lib/services/reel-saver.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Add og:title fetcher before saveReel
marker = "// ── Main saveReel function ────────────────────────────────────────────────────"

fetcher = """// ── Fetch og:title from URL (same source WhatsApp uses for previews) ─────────
async function fetchOgTitle(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'WhatsApp/2.23.20.0',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(/<meta\\s+property="og:title"\\s+content="([^"]+)"/i)
      || html.match(/<meta\\s+content="([^"]+)"\\s+property="og:title"/i)
    if (!m) return null
    // Decode basic HTML entities
    return m[1]
      .replace(/&quot;/g, '"').replace(/&#x27;/g, String.fromCharCode(39))
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  } catch { return null }
}

"""

if marker in content and 'fetchOgTitle' not in content:
    content = content.replace(marker, fetcher + marker)
    print('Fetcher added')
else:
    print('Fetcher skip (exists or marker missing)')

# Use it in saveReel when no caption context
old = """  // Parse creator + caption from WhatsApp body text
  const parsed = parseWhatsAppBodyContext(params.userCaption || '')"""

new = """  // Parse creator + caption from WhatsApp body text
  // If body was a bare URL (no caption), fetch og:title from the URL itself
  let bodyContext = params.userCaption || ''
  if (!bodyContext.trim() && platform === 'instagram') {
    const ogTitle = await fetchOgTitle(params.url)
    if (ogTitle) bodyContext = ogTitle
  }
  const parsed = parseWhatsAppBodyContext(bodyContext)"""

if old in content:
    content = content.replace(old, new)
    print('saveReel updated')
else:
    print('saveReel target NOT found')

with open('lib/services/reel-saver.ts', 'w', encoding='utf-8') as f:
    f.write(content)
