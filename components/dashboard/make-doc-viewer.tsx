'use client'

// Make: deck and sheet viewers (approved 24 Oct mock, screens 2 and 3). Slides render as light 16:9 pages with
// a thumbnail strip; sheets as a table with a computed total. Downloads come from /api/make/<id>/export.
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Slide = { kicker: string; title: string; points: string[]; notes: string }
type Deck = { format: 'deck'; title: string; slides: Slide[] }
type Sheet = { format: 'sheet'; title: string; columns: string[]; rows: Array<Array<string | number>>; totalColumn: number | null; notes: string; estimateRows: number[] }

const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)
const btn = 'inline-flex min-h-11 items-center rounded-xl border border-[#2A2A2A] px-4 text-[15px] text-[#F2EFEA] hover:border-[#2FB8A6]'

function SlidePage({ s, i, total, title, small }: { s: Slide; i: number; total: number; title: string; small?: boolean }) {
  return <div className={`relative aspect-[16/9] w-full overflow-hidden rounded-lg bg-white text-[#1F2937] ${small ? 'p-2' : 'p-[6%]'}`}>
    <div className="absolute inset-y-0 left-0 w-[1.4%] bg-[#2FB8A6]" />
    {small ? <p className="truncate text-[9px] font-semibold leading-tight">{i === 0 ? title : s.title}</p> : <>
      <p className="text-[clamp(11px,1.6vw,15px)] font-bold text-[#2FB8A6]">{s.kicker || (i === 0 ? 'Overview' : `Slide ${i + 1}`)}</p>
      <h2 className="mt-1 text-[clamp(18px,3.4vw,34px)] font-bold leading-tight">{i === 0 ? title : s.title}</h2>
      {i === 0 && s.title !== title ? <p className="mt-2 text-[clamp(13px,2vw,18px)] text-[#6B7280]">{s.title}</p> : null}
      <ul className={`mt-[3%] space-y-[1.5%] text-[clamp(12px,2vw,19px)] leading-snug ${i === 0 ? 'text-[#6B7280]' : 'list-disc pl-[4%]'}`}>
        {s.points.map((p, k) => <li key={k}>{p}</li>)}
      </ul>
      <span className="absolute bottom-[3%] right-[3%] text-[11px] text-[#6B7280]">{i + 1} / {total}</span>
    </>}
  </div>
}

function DeckView({ deck }: { deck: Deck }) {
  const [at, setAt] = useState(0)
  const s = deck.slides[at]
  return <div className="mt-5">
    <SlidePage s={s} i={at} total={deck.slides.length} title={deck.title} />
    <div className="mt-3 flex items-center justify-between gap-2">
      <button className={btn} disabled={at === 0} onClick={() => setAt(a => Math.max(0, a - 1))} aria-label="Previous slide">←</button>
      <span className="text-[14px] text-[#9A9A9A]">Slide {at + 1} of {deck.slides.length}</span>
      <button className={btn} disabled={at === deck.slides.length - 1} onClick={() => setAt(a => Math.min(deck.slides.length - 1, a + 1))} aria-label="Next slide">→</button>
    </div>
    {s.notes ? <p className="mt-3 rounded-xl border border-[#2A2A2A] p-3 text-[14px] leading-6 text-[#9A9A9A]"><span className="text-[#F2EFEA]">Speaker notes: </span>{s.notes}</p> : null}
    <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
      {deck.slides.map((x, i) => <button key={i} onClick={() => setAt(i)} aria-label={`Slide ${i + 1}`} className={`rounded-lg border-2 ${i === at ? 'border-[#2FB8A6]' : 'border-transparent'}`}>
        <SlidePage s={x} i={i} total={deck.slides.length} title={deck.title} small />
      </button>)}
    </div>
  </div>
}

function SheetView({ sheet }: { sheet: Sheet }) {
  const tc = sheet.totalColumn
  const total = tc === null ? null : sheet.rows.reduce((sum, r) => sum + (typeof r[tc] === 'number' ? r[tc] as number : Number(String(r[tc]).replace(/[^\d.-]/g, '')) || 0), 0)
  const cell = (v: string | number, j: number) => typeof v === 'number' ? (j === tc ? `₹${inr(v)}` : inr(v)) : v
  return <div className="mt-5 overflow-x-auto rounded-xl border border-[#2A2A2A]">
    <table className="w-full min-w-[480px] border-collapse text-[15px] text-[#F2EFEA]">
      <thead><tr className="bg-[#161616]">{sheet.columns.map((c, j) => <th key={j} className={`px-3 py-2 text-left font-semibold ${j === tc ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>
      <tbody>
        {sheet.rows.map((r, i) => <tr key={i} className="border-t border-[#2A2A2A]">
          {r.map((c, j) => <td key={j} className={`px-3 py-2 ${typeof c === 'number' ? 'text-right tabular-nums' : ''}`}>
            {cell(c, j)}{j === 0 && sheet.estimateRows.includes(i) ? <span className="ml-2 rounded bg-[#221D13] px-1.5 py-0.5 text-[11px] text-[#d9a441]">est.</span> : null}
          </td>)}
        </tr>)}
        {total !== null ? <tr className="border-t-2 border-[#2FB8A6] font-semibold">
          {sheet.columns.map((_, j) => <td key={j} className={`px-3 py-2 ${j === tc ? 'text-right tabular-nums' : ''}`}>{j === 0 ? 'Total' : j === tc ? `₹${inr(total)}` : ''}</td>)}
        </tr> : null}
      </tbody>
    </table>
  </div>
}

function EditBox({ id, kind }: { id: string; kind: 'deck' | 'sheet' }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function submit() {
    const instruction = text.trim()
    if (!instruction || busy) return
    setBusy(true); setMsg('')
    try {
      const res = await fetch(`/api/make/${encodeURIComponent(id)}/edit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction }) })
      if (res.ok) { setText(''); setMsg('Updated.'); router.refresh() }
      else setMsg(res.status === 502 ? 'I could not apply that. Try saying it another way.' : 'Could not update this right now.')
    } catch { setMsg('Could not update this right now.') }
    setBusy(false)
  }
  return <div className="mt-5 rounded-xl border border-[#2A2A2A] p-4">
    <label htmlFor="make-edit" className="text-[14px] text-[#F2EFEA]">Change it</label>
    <textarea id="make-edit" rows={2} value={text} onChange={e => setText(e.target.value)} maxLength={400}
      placeholder={kind === 'deck' ? 'e.g. make slide 3 shorter, add a slide on pricing' : 'e.g. make the hotel ₹5,000 a night, add a row for snacks'}
      className="mt-2 w-full rounded-xl border border-[#2A2A2A] bg-[#111111] p-3 text-[16px] leading-6 text-[#F2EFEA]" />
    <div className="mt-2 flex items-center gap-3">
      <button onClick={submit} disabled={busy || !text.trim()} className={btn}>{busy ? 'Updating…' : 'Update'}</button>
      {msg ? <span className="text-[14px] text-[#9A9A9A]">{msg}</span> : null}
    </div>
    <p className="mt-2 text-[13px] text-[#9A9A9A]">You can also say it to Gogo in chat right after it was made.</p>
  </div>
}

export function MakeDocViewer({ id, doc, request, sources, updatedAt }: { id: string; doc: Deck | Sheet; request: string; sources: string[]; updatedAt: string | null }) {
  const href = (f: string) => `/api/make/${encodeURIComponent(id)}/export?format=${f}`
  return <div>
    <p className="mt-5 text-[13px] uppercase tracking-wide text-[#2FB8A6]">{doc.format === 'deck' ? `Slides · ${doc.slides.length}` : `Sheet · ${doc.rows.length} rows`}</p>
    <h1 className="mt-1 break-words font-serif text-3xl text-[#F2EFEA]">{doc.title}</h1>
    {updatedAt ? <p className="mt-1 text-[13px] text-[#9A9A9A]">Updated {new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(updatedAt))}</p> : null}
    <div className="mt-4 flex flex-wrap gap-2">
      {doc.format === 'deck' ? <>
        <a className={btn} href={href('pptx')}>Download PowerPoint</a>
      </> : <>
        <a className={btn} href={href('xlsx')}>Download Excel</a>
        <a className={btn} href={href('csv')}>Download CSV</a>
      </>}
    </div>
    {doc.format === 'deck' ? <DeckView deck={doc} /> : <SheetView sheet={doc} />}
    {doc.format === 'sheet' && doc.notes ? <p className="mt-3 text-[14px] text-[#9A9A9A]">{doc.notes}</p> : null}
    <EditBox id={id} kind={doc.format} />
    {request ? <p className="mt-3 text-[13px] text-[#9A9A9A]">You asked: “{request.slice(0, 300)}”</p> : null}
    {sources.length ? <div className="mt-4"><p className="text-[13px] text-[#9A9A9A]">Facts from</p>
      <ul className="mt-1 space-y-1">{sources.map(u => <li key={u}><a className="break-all text-[13px] text-[#2FB8A6]" href={u} target="_blank" rel="noreferrer">{u}</a></li>)}</ul></div> : null}
  </div>
}
