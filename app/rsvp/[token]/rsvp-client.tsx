'use client'
// The guest's side of an AskGogo event: read the invitation, answer in two taps, change the answer later.
// Matches the approved mock (10 Nov). Animated figures are our own drawings, per event type, and stay still for
// people who ask their device to reduce motion.
import { useEffect, useMemo, useState } from 'react'

type Invitation = {
  title: string; kind: string; status: 'open' | 'closed' | 'cancelled'
  startsAt: string | null; endsAt: string | null; timezone: string; hostName: string | null; description: string | null; dressCode: string | null
  venueName: string | null; venueAddress: string | null; onlineUrl: string | null; placeHidden: boolean; maxPlusOnes: number; template: number
  guest: { name: string; rsvp: string; plusOnes: number; dietary: string | null; comment: string | null } | null
}
type Reply = 'going' | 'maybe' | 'declined'
const LABEL: Record<Reply, string> = { going: 'Going', maybe: 'Maybe', declined: 'Not going' }
const KICKER: Record<string, string> = { birthday: 'Birthday', anniversary: 'Anniversary', dinner: 'Dinner', outing: 'Outing', meeting: 'Get-together', other: "You're invited" }

function whenLabel(iso: string | null, timeZone: string) {
  if (!iso) return 'Date to be announced'
  try {
    const d = new Date(iso)
    const day = new Intl.DateTimeFormat('en-IN', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(d)
    const time = new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
    return `${day}, ${time}`
  } catch { return new Date(iso).toLocaleString() }
}

/** One small animated drawing per kind of event. Shapes only; colours come from the page tokens. */
function Figure({ kind }: { kind: string }) {
  if (kind === 'birthday') return (
    <svg viewBox="0 0 120 84" className="rsvp-fig" aria-hidden="true">
      <g className="rsvp-bob"><ellipse cx="38" cy="30" rx="14" ry="17" fill="var(--rsvp-accent)" /><path d="M38 47v26" stroke="var(--rsvp-ink-3)" strokeWidth="1.5" fill="none" /></g>
      <g className="rsvp-bob rsvp-late"><ellipse cx="62" cy="24" rx="14" ry="17" fill="var(--rsvp-plum)" /><path d="M62 41v32" stroke="var(--rsvp-ink-3)" strokeWidth="1.5" fill="none" /></g>
      <g className="rsvp-bob rsvp-later"><ellipse cx="86" cy="32" rx="13" ry="16" fill="var(--rsvp-good)" /><path d="M86 48v25" stroke="var(--rsvp-ink-3)" strokeWidth="1.5" fill="none" /></g>
    </svg>)
  if (kind === 'anniversary') return (
    <svg viewBox="0 0 120 84" className="rsvp-fig" aria-hidden="true">
      <path className="rsvp-pulse" d="M46 30c-8-12-26-4-20 10 4 9 20 20 20 20s16-11 20-20c6-14-12-22-20-10z" fill="var(--rsvp-accent)" />
      <path className="rsvp-pulse rsvp-late" d="M82 34c-6-9-19-3-15 7 3 7 15 15 15 15s12-8 15-15c4-10-9-16-15-7z" fill="var(--rsvp-plum)" />
    </svg>)
  if (kind === 'dinner') return (
    <svg viewBox="0 0 120 84" className="rsvp-fig" aria-hidden="true">
      <ellipse cx="60" cy="62" rx="34" ry="9" fill="var(--rsvp-line)" /><path d="M32 60a28 22 0 0 1 56 0z" fill="var(--rsvp-accent)" /><circle cx="60" cy="36" r="3.5" fill="var(--rsvp-plum)" />
      <path className="rsvp-steam" d="M48 28c-4-6 4-8 0-14" stroke="var(--rsvp-ink-3)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path className="rsvp-steam rsvp-late" d="M72 28c-4-6 4-8 0-14" stroke="var(--rsvp-ink-3)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>)
  if (kind === 'outing') return (
    <svg viewBox="0 0 120 84" className="rsvp-fig" aria-hidden="true">
      <g className="rsvp-spin" style={{ transformOrigin: '86px 26px' }}><circle cx="86" cy="26" r="11" fill="var(--rsvp-accent)" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map(a => <path key={a} d="M86 9v-5" stroke="var(--rsvp-accent)" strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${a} 86 26)`} />)}</g>
      <path d="M0 74c20-22 38-22 58-6 16-18 38-20 62-2v18H0z" fill="var(--rsvp-good)" /><path d="M0 80c26-14 50-12 70-4 18-8 34-8 50 0v8H0z" fill="var(--rsvp-plum)" opacity=".55" />
    </svg>)
  return (
    <svg viewBox="0 0 120 84" className="rsvp-fig" aria-hidden="true">
      {[[30, 30, 9, ''], [62, 18, 6, 'rsvp-late'], [88, 40, 11, 'rsvp-later'], [50, 58, 5, 'rsvp-later']].map(([x, y, r, c], i) => (
        <path key={i} className={`rsvp-twinkle ${c}`} style={{ transformOrigin: `${x}px ${y}px` }} fill={i % 2 ? 'var(--rsvp-plum)' : 'var(--rsvp-accent)'}
          d={`M${x} ${Number(y) - Number(r)}l${Number(r) * 0.3} ${Number(r) * 0.7} ${Number(r) * 0.7} ${Number(r) * 0.3}-${Number(r) * 0.7} ${Number(r) * 0.3}-${Number(r) * 0.3} ${Number(r) * 0.7}-${Number(r) * 0.3}-${Number(r) * 0.7}-${Number(r) * 0.7}-${Number(r) * 0.3} ${Number(r) * 0.7}-${Number(r) * 0.3}z`} />))}
    </svg>)
}

function Confetti() {
  const bits = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ left: (i * 37) % 100, delay: (i % 7) * 0.06, hue: i % 3, turn: (i % 5) * 70 })), [])
  return <div className="rsvp-confetti" aria-hidden="true">{bits.map((b, i) => <i key={i} style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, background: ['var(--rsvp-accent)', 'var(--rsvp-plum)', 'var(--rsvp-good)'][b.hue], transform: `rotate(${b.turn}deg)` }} />)}</div>
}

export default function RsvpClient({ token, mode, initial }: { token: string; mode: 'guest' | 'share'; initial: Invitation }) {
  const [inv, setInv] = useState<Invitation>(initial)
  const [activeToken, setActiveToken] = useState(token)
  const [reply, setReply] = useState<Reply | null>((['going', 'maybe', 'declined'] as Reply[]).includes(initial.guest?.rsvp as Reply) ? (initial.guest!.rsvp as Reply) : null)
  const [plus, setPlus] = useState(initial.guest?.plusOnes || 0)
  const [name, setName] = useState(initial.guest?.name || '')
  const [dietary, setDietary] = useState(initial.guest?.dietary || '')
  const [comment, setComment] = useState(initial.guest?.comment || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<Reply | null>(null)
  const [celebrate, setCelebrate] = useState(false)
  const needsName = mode === 'share' && activeToken === token

  // Someone who already answered through the shared link continues on their own personal link.
  useEffect(() => {
    if (mode !== 'share') return
    try {
      const mine = window.localStorage.getItem(`gogo-rsvp:${token.slice(0, 12)}`)
      if (mine && /^[A-Za-z0-9_-]{43}$/.test(mine) && mine !== token) window.location.replace(`/rsvp/${mine}`)
    } catch { /* no storage: the page still works */ }
  }, [mode, token])

  const open = inv.status === 'open'
  const answered = inv.guest && inv.guest.rsvp !== 'none'

  async function send() {
    if (!reply || busy) return
    if (needsName && !name.trim()) { setError('Please enter your name.'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/rsvp/${activeToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, referrerPolicy: 'no-referrer',
        body: JSON.stringify({ status: reply, plusOnes: reply === 'going' ? plus : 0, dietary: reply === 'going' ? dietary : '', comment, name }) })
      const data = await res.json().catch(() => null)
      if (data?.personalToken) {
        setActiveToken(data.personalToken)
        try { window.localStorage.setItem(`gogo-rsvp:${token.slice(0, 12)}`, data.personalToken) } catch { /* fine */ }
        try { window.history.replaceState(null, '', `/rsvp/${data.personalToken}`) } catch { /* fine */ }
      }
      if (data?.invitation) setInv(data.invitation)
      if (!res.ok || !data?.ok) { setError(data?.error || 'That did not work. Please try again.'); return }
      setSaved(reply)
      if (reply === 'going') { setCelebrate(true); window.setTimeout(() => setCelebrate(false), 2600) }
    } catch { setError('No connection. Please try again.') } finally { setBusy(false) }
  }

  const place = [inv.venueName, inv.venueAddress].filter(Boolean).join(', ')
  const doneText = saved === 'going' ? `Thanks${inv.guest?.name ? `, ${inv.guest.name}` : ''}. You are going${inv.guest?.plusOnes ? ` with ${inv.guest.plusOnes} more` : ''}.`
    : saved === 'maybe' ? 'Marked as maybe. You can change this any time before replies close.' : saved === 'declined' ? 'Thanks for letting the host know.' : ''

  return (
    <main className="rsvp-root">
      <style>{CSS}</style>
      {celebrate ? <Confetti /> : null}
      <div className="rsvp-wrap">
        <section className="rsvp-card">
          <Figure kind={inv.kind} />
          <span className="rsvp-kick">{inv.status === 'cancelled' ? 'Cancelled' : KICKER[inv.kind] || KICKER.other}</span>
          <h1 className="rsvp-title">{inv.title}</h1>
          {inv.hostName ? <span className="rsvp-host">Hosted by {inv.hostName}</span> : null}
        </section>

        <dl className="rsvp-facts">
          <dt>When</dt><dd>{whenLabel(inv.startsAt, inv.timezone)}</dd>
          {place || inv.placeHidden ? <><dt>Where</dt><dd>{place || 'Shared after you say Going'}{inv.placeHidden && place ? <span className="rsvp-muted"> · full address after you say Going</span> : null}</dd></> : null}
          {inv.onlineUrl ? <><dt>Online</dt><dd><a href={inv.onlineUrl} rel="noreferrer noopener" target="_blank">Join link</a></dd></> : null}
          {inv.dressCode ? <><dt>Dress</dt><dd>{inv.dressCode}</dd></> : null}
        </dl>
        {inv.description ? <p className="rsvp-desc">{inv.description}</p> : null}

        {inv.status === 'cancelled' ? <div className="rsvp-note rsvp-bad" role="status">This event has been cancelled.</div> : null}
        {inv.status === 'closed' ? <div className="rsvp-note" role="status">Replies are closed.{answered ? ` Your reply: ${LABEL[inv.guest!.rsvp as Reply] || inv.guest!.rsvp}.` : ' Please contact the host directly.'}</div> : null}

        {open ? (
          <>
            {needsName ? <label className="rsvp-field" htmlFor="rsvp-name">Your name<input id="rsvp-name" type="text" value={name} maxLength={80} autoComplete="name" onChange={e => setName(e.target.value)} /></label>
              : inv.guest?.name ? <p className="rsvp-muted">Invitation for <b>{inv.guest.name}</b></p> : null}
            <div className="rsvp-seg" role="group" aria-label="Your reply">
              {(['going', 'maybe', 'declined'] as Reply[]).map(r => <button key={r} type="button" aria-pressed={reply === r} onClick={() => { setReply(r); setSaved(null); setError(''); if (r !== 'going') setPlus(0) }}>{LABEL[r]}</button>)}
            </div>
            {reply === 'going' ? (
              <>
                {inv.maxPlusOnes > 0 ? (
                  <div className="rsvp-step"><span><b>Bringing anyone?</b><br /><span className="rsvp-muted">Up to {inv.maxPlusOnes} more</span></span>
                    <span className="rsvp-ctl"><button type="button" aria-label="One fewer" onClick={() => setPlus(p => Math.max(0, p - 1))}>−</button><output>{plus}</output><button type="button" aria-label="One more" onClick={() => setPlus(p => Math.min(inv.maxPlusOnes, p + 1))}>+</button></span></div>) : null}
                <label className="rsvp-field" htmlFor="rsvp-diet">Food preference (optional)<input id="rsvp-diet" type="text" value={dietary} maxLength={120} placeholder="Vegetarian, no nuts…" onChange={e => setDietary(e.target.value)} /></label>
              </>) : null}
            {reply ? <label className="rsvp-field" htmlFor="rsvp-note">Note to the host (optional)<input id="rsvp-note" type="text" value={comment} maxLength={300} onChange={e => setComment(e.target.value)} /></label> : null}
            <button type="button" className="rsvp-btn" disabled={!reply || busy} onClick={send}>{busy ? 'Sending…' : !reply ? 'Choose a reply' : saved || answered ? 'Update my reply' : 'Send my reply'}</button>
            {error ? <div className="rsvp-note rsvp-bad" role="alert">{error}</div> : null}
            {saved && !error ? <div className="rsvp-note rsvp-good" role="status">{doneText}</div> : null}
          </>) : null}

        {inv.guest?.rsvp === 'going' && inv.status !== 'cancelled' && inv.startsAt ? <a className="rsvp-ghost" href={`/api/rsvp/${activeToken}?format=ics`}>Add to calendar</a> : null}
        <p className="rsvp-foot"><img src="/gogo-float.gif" alt="" width={28} height={28} /> Planned with AskGogo</p>
      </div>
    </main>
  )
}

const CSS = `
.rsvp-root{--rsvp-bg:#f6f1e8;--rsvp-surface:#fffdf9;--rsvp-line:#e6dccb;--rsvp-ink:#16130f;--rsvp-ink-2:#3a342d;--rsvp-ink-3:#6f675d;--rsvp-accent:#ef7a27;--rsvp-accent-deep:#b9540f;--rsvp-accent-tint:#fff0e5;--rsvp-plum:#76556f;--rsvp-plum-tint:#eee6ed;--rsvp-good:#1f7a4d;--rsvp-good-tint:#e2f3ea;--rsvp-bad:#a8372b;--rsvp-bad-tint:#f8e4e1;
 min-height:100dvh;background:var(--rsvp-bg);color:var(--rsvp-ink);font-family:var(--font-onest),system-ui,sans-serif;font-size:16px;line-height:1.5}
.rsvp-wrap{max-width:440px;margin:0 auto;padding:20px 16px 40px;display:flex;flex-direction:column;gap:16px}
.rsvp-card{border-radius:20px;padding:20px 18px 24px;background:linear-gradient(160deg,var(--rsvp-accent-tint),var(--rsvp-plum-tint));border:1px solid var(--rsvp-line);display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;overflow:hidden}
.rsvp-fig{width:150px;height:105px}
.rsvp-kick{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--rsvp-accent-deep)}
.rsvp-title{font-size:30px;font-weight:800;letter-spacing:-.02em;line-height:1.1;margin:0;text-wrap:balance}
.rsvp-host{color:var(--rsvp-ink-2);font-size:15px}
.rsvp-facts{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0;font-size:15px}
.rsvp-facts dt{color:var(--rsvp-ink-3)}.rsvp-facts dd{margin:0;font-weight:600;min-width:0;overflow-wrap:anywhere}
.rsvp-facts a{color:var(--rsvp-accent-deep);font-weight:700}
.rsvp-desc{margin:0;color:var(--rsvp-ink-2);white-space:pre-line;overflow-wrap:anywhere}
.rsvp-muted{color:var(--rsvp-ink-3);font-size:14px;font-weight:400;margin:0}
.rsvp-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.rsvp-seg button,.rsvp-btn,.rsvp-ghost,.rsvp-ctl button{font:inherit;cursor:pointer;border-radius:14px;min-height:50px}
.rsvp-seg button{background:var(--rsvp-surface);border:1.5px solid var(--rsvp-line);color:var(--rsvp-ink);font-weight:700}
.rsvp-seg button[aria-pressed="true"]{background:var(--rsvp-accent);border-color:var(--rsvp-accent);color:#fff}
.rsvp-root :focus-visible{outline:3px solid var(--rsvp-plum);outline-offset:2px}
.rsvp-field{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--rsvp-ink-2)}
.rsvp-field input{font:inherit;font-size:16px;padding:12px;border-radius:14px;border:1.5px solid var(--rsvp-line);background:var(--rsvp-surface);color:var(--rsvp-ink);min-width:0}
.rsvp-step{display:flex;align-items:center;justify-content:space-between;gap:12px}
.rsvp-ctl{display:flex;align-items:center;gap:10px}
.rsvp-ctl button{width:50px;background:var(--rsvp-surface);border:1.5px solid var(--rsvp-line);color:var(--rsvp-ink);font-size:22px;font-weight:700}
.rsvp-ctl output{min-width:2ch;text-align:center;font-weight:800;font-size:20px;font-variant-numeric:tabular-nums}
.rsvp-btn{background:var(--rsvp-ink);color:var(--rsvp-bg);border:0;font-weight:700;width:100%}
.rsvp-btn:disabled{opacity:.45;cursor:default}
.rsvp-ghost{display:flex;align-items:center;justify-content:center;border:1.5px solid var(--rsvp-line);color:var(--rsvp-ink);font-weight:600;text-decoration:none}
.rsvp-note{border-radius:14px;padding:12px 14px;font-size:15px;font-weight:600;background:var(--rsvp-plum-tint);color:var(--rsvp-ink-2)}
.rsvp-good{background:var(--rsvp-good-tint);color:var(--rsvp-good)}.rsvp-bad{background:var(--rsvp-bad-tint);color:var(--rsvp-bad)}
.rsvp-foot{display:flex;align-items:center;justify-content:center;gap:8px;color:var(--rsvp-ink-3);font-size:14px;margin:8px 0 0}
.rsvp-foot img{border-radius:50%}
.rsvp-confetti{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:5}
.rsvp-confetti i{position:absolute;top:-12px;width:9px;height:14px;border-radius:2px;opacity:0}
@media (prefers-reduced-motion:no-preference){
 .rsvp-bob{animation:rsvp-bob 3.2s ease-in-out infinite}.rsvp-pulse{animation:rsvp-pulse 1.8s ease-in-out infinite;transform-origin:center;transform-box:fill-box}
 .rsvp-steam{animation:rsvp-steam 2.4s ease-in-out infinite}.rsvp-spin{animation:rsvp-spin 18s linear infinite}.rsvp-twinkle{animation:rsvp-twinkle 2.2s ease-in-out infinite}
 .rsvp-late{animation-delay:.5s}.rsvp-later{animation-delay:1s}
 .rsvp-confetti i{animation:rsvp-fall 2.2s ease-in forwards}
 .rsvp-seg button,.rsvp-btn{transition:background .15s,transform .1s}.rsvp-seg button:active,.rsvp-btn:active{transform:scale(.98)}
}
@keyframes rsvp-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes rsvp-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes rsvp-steam{0%{opacity:0;transform:translateY(6px)}40%{opacity:.8}100%{opacity:0;transform:translateY(-8px)}}
@keyframes rsvp-spin{to{transform:rotate(360deg)}}
@keyframes rsvp-twinkle{0%,100%{transform:scale(.7);opacity:.5}50%{transform:scale(1.1);opacity:1}}
@keyframes rsvp-fall{0%{opacity:1;top:-12px}100%{opacity:0;top:100%;transform:rotate(540deg)}}
`
