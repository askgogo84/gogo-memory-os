const DECK_URL = 'https://qenhjcooyecmatwducpu.supabase.co/storage/v1/object/public/pitch-assets/askgogo-2026/AskGogo-Pitch-Deck.html'

export const dynamic = 'force-dynamic'

const NAV_BRIDGE = `
<script id="askgogo-pitch-nav-bridge">
(() => {
  let lastMove = 0;
  let touchX = 0;
  let touchY = 0;

  function fire(key) {
    const now = Date.now();
    if (now - lastMove < 500) return;
    lastMove = now;
    const event = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    document.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
  }

  function next() { fire('ArrowRight'); }
  function prev() { fire('ArrowLeft'); }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === 'askgogo:pitch-next') next();
    if (event.data?.type === 'askgogo:pitch-prev') prev();
  });

  window.addEventListener('wheel', (event) => {
    const dominant = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(dominant) < 18) return;
    event.preventDefault();
    dominant > 0 ? next() : prev();
  }, { passive: false });

  window.addEventListener('touchstart', (event) => {
    const t = event.changedTouches[0];
    touchX = t.clientX;
    touchY = t.clientY;
  }, { passive: true });

  window.addEventListener('touchend', (event) => {
    const t = event.changedTouches[0];
    const dx = t.clientX - touchX;
    const dy = t.clientY - touchY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 44) return;
    if (Math.abs(dx) > Math.abs(dy)) dx < 0 ? next() : prev();
    else dy < 0 ? next() : prev();
  }, { passive: true });
})();
</script>`

export async function GET() {
  const upstream = await fetch(DECK_URL, { cache: 'no-store' })
  if (!upstream.ok) {
    return new Response(`Pitch deck unavailable (${upstream.status})`, { status: 502 })
  }

  const source = await upstream.text()
  const html = source.includes('</body>')
    ? source.replace('</body>', `${NAV_BRIDGE}</body>`)
    : `${source}${NAV_BRIDGE}`

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https:; style-src 'self' 'unsafe-inline' data: blob: https:; img-src 'self' data: blob: https:; font-src 'self' data: blob: https:; connect-src 'self' data: blob: https:; frame-src 'self' data: blob: https:; media-src 'self' data: blob: https:; object-src 'none'; base-uri 'none'",
    },
  })
}
