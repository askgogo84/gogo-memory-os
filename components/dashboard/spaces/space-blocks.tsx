// Server-rendered Space blocks (approved Spaces mock, 375px first). Pure presentation: data comes from resolveSpace.
import type { Space, SpaceBlock } from '@/lib/spaces/schema'
import type { BlockData, Tone } from '@/lib/spaces/sources'

const TONE: Record<Tone, string> = { warn: 'final-dark-amber', crit: 'final-dark-danger', good: 'final-dark-success', plum: 'final-dark-teal' }
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)); return m < 1 ? 'just now' : `${m} min ago` }

function Body({ block, data }: { block: SpaceBlock; data: BlockData | undefined }) {
  if (!block.source) return <p className="text-[15px] leading-relaxed text-[#d6d6d1] whitespace-pre-wrap">{block.text || ''}</p>
  if (!data) return <p className="final-dark-muted text-[14px]">Not read yet.</p>
  if (data.status === 'error') return <p className="final-dark-danger text-[14px]">{data.message}</p>
  if (data.status === 'not_connected') return <div className="text-[14px]"><p className="final-dark-muted">{data.message}</p>{!/Turned off/.test(data.message) && <a href="/dashboard/connections" className="final-dark-teal mt-2 inline-block font-medium">Connect</a>}</div>
  if (data.status === 'empty') return <p className="final-dark-muted text-[14px]">{data.message}</p>
  return <>
    {data.stats && <div className="flex flex-wrap gap-5">{data.stats.map(s => <div key={s.label}><div className="text-[26px] font-semibold leading-none text-[#f2f2ee]">{s.n}</div><div className="final-dark-muted mt-1 text-[12.5px]">{s.label}</div></div>)}</div>}
    {data.items && <ul className="divide-y divide-[#1f1f1f]">{data.items.map((it, i) => <li key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      {it.time !== undefined && <span className="final-dark-muted w-[64px] shrink-0 pt-[1px] text-[13px] tabular-nums">{it.time}</span>}
      <div className="min-w-0 flex-1"><div className="text-[15px] text-[#ececea] break-words">{it.title}</div>{it.sub && <div className="final-dark-muted mt-0.5 text-[13px] break-words">{it.sub}</div>}</div>
      {it.pill && <span className={`final-dark-pill shrink-0 rounded-full px-2 py-0.5 text-[11.5px] ${TONE[it.pill.tone]}`}>{it.pill.text}</span>}
    </li>)}</ul>}
    {data.table && <div className="-mx-1 overflow-x-auto"><table className="w-full min-w-[320px] text-left text-[13.5px]"><thead><tr>{data.table.columns.map(c => <th key={c} className="final-dark-muted px-1 pb-2 font-medium">{c}</th>)}</tr></thead><tbody>{data.table.rows.map((r, i) => <tr key={i} className="border-t border-[#1f1f1f]">{r.map((c, j) => <td key={j} className="px-1 py-2 text-[#ececea]">{c}</td>)}</tr>)}</tbody></table></div>}
    {data.note && <p className="text-[14.5px] leading-relaxed text-[#d6d6d1] whitespace-pre-wrap">{data.note}</p>}
  </>
}

export function SpaceBlocks({ space, data }: { space: Space; data: Record<string, BlockData> }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{space.blocks.map(b => {
    const d = data[b.id]
    return <section key={b.id} className={`final-dark-card p-4 ${b.span === 2 ? 'md:col-span-2' : ''}`}>
      <div className="mb-3 flex items-baseline justify-between gap-2"><h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#bdbdb8]">{b.title}</h2>{d && 'readAt' in d && <span className="final-dark-muted text-[11.5px]">{ago(d.readAt)}</span>}</div>
      <Body block={b} data={d}/>
    </section>
  })}</div>
}
