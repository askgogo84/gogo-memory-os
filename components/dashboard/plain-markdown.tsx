// 23 Oct live: Make reports showed raw markdown ("# Private Research Brief", "**Unable to verify.**", "---").
// A tiny, safe renderer for the subset Gogo writes: headings, bullets, numbered lines, rules, **bold** and links.
// React elements only (no HTML injection). Emphasis comes from weight, never italics (house style), so *x* is plain.
import type { ReactNode } from 'react'

const URL_RE = /(https?:\/\/[^\s)<>"']+)/g

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g)
  parts.forEach((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) { out.push(<strong key={`${keyBase}-b${i}`} className="font-semibold">{part.slice(2, -2)}</strong>); return }
    const plain = part.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1$2').replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:!?]|$)/g, '$1$2')
    plain.split(URL_RE).forEach((bit, j) => {
      if (/^https?:\/\//.test(bit)) out.push(<a key={`${keyBase}-u${i}-${j}`} href={bit} target="_blank" rel="noopener noreferrer" className="break-all text-[#2fb8a6] underline-offset-2 hover:underline">{bit}</a>)
      else if (bit) out.push(bit)
    })
  })
  return out
}

export function PlainMarkdown({ text, className = '' }: { text: string; className?: string }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  const flushPara = () => { if (para.length) { blocks.push(<p key={`p${blocks.length}`} className="break-words">{inline(para.join(' '), `p${blocks.length}`)}</p>); para = [] } }
  const flushList = () => {
    if (!list) return
    const Tag = list.ordered ? 'ol' : 'ul'
    blocks.push(<Tag key={`l${blocks.length}`} className={`${list.ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`}>{list.items.map((it, i) => <li key={i} className="break-words">{inline(it, `l${blocks.length}-${i}`)}</li>)}</Tag>)
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const h = line.match(/^(#{1,4})\s+(.+)$/)
    const bullet = line.match(/^\s*[-•*]\s+(.+)$/)
    const num = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (!line.trim()) { flushPara(); flushList(); continue }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); flushList(); blocks.push(<hr key={`r${blocks.length}`} className="border-[#2A2A2A]"/>); continue }
    if (h) {
      flushPara(); flushList()
      const level = h[1].length
      const cls = level === 1 ? 'text-[20px] font-semibold' : level === 2 ? 'text-[17px] font-semibold' : 'text-[15px] font-semibold'
      blocks.push(<p key={`h${blocks.length}`} role="heading" aria-level={Math.min(level + 2, 6)} className={`${cls} break-words text-[#F2EFEA]`}>{inline(h[2].replace(/\*\*/g, ''), `h${blocks.length}`)}</p>)
      continue
    }
    if (bullet || num) {
      flushPara()
      const ordered = Boolean(num && !bullet)
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push((bullet ? bullet[1] : num![1]).trim())
      continue
    }
    flushList()
    para.push(line.trim())
  }
  flushPara(); flushList()
  return <div className={`flex flex-col gap-3 ${className}`}>{blocks}</div>
}
