// AskGogo inbound email Worker. Bound to Email Routing for in.askgogo.in (catch-all → this Worker).
// Settings › Variables: ASKGOGO_INBOUND_URL = https://app.askgogo.in/api/email/inbound
//                      INBOUND_SECRET      = same value as Vercel EMAIL_INBOUND_SECRET (encrypted secret)
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  return btoa(binary)
}

export default {
  async email(message, env) {
    if (message.rawSize > 8 * 1024 * 1024) { message.setReject('Message too large'); return }
    const raw = await new Response(message.raw).arrayBuffer()
    const res = await fetch(env.ASKGOGO_INBOUND_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-askgogo-inbound-secret': env.INBOUND_SECRET },
      body: JSON.stringify({ to: message.to, from: message.from, raw: toBase64(raw) }),
    })
    // A server error throws so Cloudflare reports a temporary failure and the sending server retries.
    if (res.status >= 500) throw new Error(`AskGogo inbound failed: ${res.status}`)
  },
}
