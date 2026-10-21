import type { ReactNode } from 'react'

export function Kpis({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode }[] }) {
  return (
    <div className="adm-kpis">
      {items.map(k => (
        <div className="adm-kpi" key={k.label}><div className="l">{k.label}</div><div className="v">{k.value}</div>{k.sub ? <div className="s">{k.sub}</div> : null}</div>
      ))}
    </div>
  )
}
export type Tone = 'ok' | 'bad' | 'warn' | 'n'
export function Pill({ tone = 'n', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${tone === 'n' ? '' : tone}`}>{children}</span>
}
export function Bar({ pct, tone }: { pct: number; tone?: 'ink' | 'warn' }) {
  const w = Math.max(0, Math.min(100, Math.round(pct || 0)))
  return <div className={`adm-bar ${tone || ''}`}><i style={{ width: `${w}%` }} /></div>
}
export function BarList({ rows, empty = 'Nothing yet.', labelWidth = 150 }: { rows: { label: ReactNode; value: number; display: ReactNode; extra?: ReactNode; sub?: ReactNode }[]; empty?: string; labelWidth?: number }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  if (!rows.length) return <div className="adm-list"><div className="adm-row muted">{empty}</div></div>
  return (
    <div className="adm-list">
      {rows.map((r, i) => (
        <div className="adm-row" key={i}>
          <span style={{ flex: `0 0 ${labelWidth}px`, minWidth: 0 }}>{r.label}{r.sub ? <><br /><span className="muted">{r.sub}</span></> : null}</span>
          <Bar pct={(r.value / max) * 100} />
          <span style={{ flex: '0 0 auto', minWidth: 64, textAlign: 'right', fontWeight: 500 }}>{r.display}</span>
          {r.extra ? <span className="muted" style={{ flex: '0 0 auto', minWidth: 44, textAlign: 'right' }}>{r.extra}</span> : null}
        </div>
      ))}
    </div>
  )
}
export function VBars({ values, labels, fmt = (n: number) => String(n), height = 120 }: { values: number[]; labels?: [string, string]; fmt?: (n: number) => string; height?: number }) {
  const max = Math.max(1, ...values)
  return (
    <>
      <div className="vbars">
        {values.map((v, i) => (
          <div key={i} title={fmt(v)}><span>{values.length <= 16 ? fmt(v) : ''}</span><i className={i === values.length - 1 ? 'now' : ''} style={{ height: Math.round((v / max) * height) }} /></div>
        ))}
      </div>
      {labels ? <div className="axis"><span>{labels[0]}</span><span>{labels[1]}</span></div> : null}
    </>
  )
}
export function Head({ title, lede, children }: { title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <div className="adm-head">
      <div><h1>{title}</h1>{lede ? <p className="lede">{lede}</p> : null}</div>
      {children ? <div className="chips">{children}</div> : null}
    </div>
  )
}
