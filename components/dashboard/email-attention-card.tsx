'use client'
// "Emails that need you" in chat (approved mock, 23 Oct): one row per email with why it was picked and
// Draft reply / Remind me / Not important. Each button sends the same words a WhatsApp user would type.
import type { ParsedAttentionCard } from '@/lib/email/attention'

export function EmailAttentionCard({ card, onAction }: { card: ParsedAttentionCard; onAction?: (text: string) => void }) {
  const head = card.count ? `${card.count} email${card.count === 1 ? ' needs' : 's need'} you` : 'Nothing in your email needs you right now.'
  return <div className="min-w-0">
    <div className="text-[16px] leading-[1.6] text-[#dcdad5] sm:text-[17px]">{head}</div>
    {card.items.length > 0 && <div className="mt-3 overflow-hidden rounded-[16px] border border-[#2f2f2f]">
      {card.items.map(item => <div key={item.index} className="border-b border-[#1f1f1f] px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="truncate text-[15px] font-semibold text-[#f2efea]">{item.sender}</div>
          {item.when && <div className="shrink-0 text-[12px] text-[#a8a8a4]">{item.when}</div>}
        </div>
        <div className="mt-1 text-[15px] leading-[1.45] text-[#dcdad5]">{item.ask}</div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-[#8be6d8]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          <span>{item.why}</span>
        </div>
        {onAction && <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Actions for email ${item.index}`}>
          <button type="button" onClick={() => onAction(`draft ${item.index}`)} className="min-h-10 rounded-full bg-[#4cd0bd] px-4 text-[14px] font-semibold text-[#0b0b0b]">Draft reply</button>
          <button type="button" onClick={() => onAction(`remind ${item.index}`)} className="min-h-10 rounded-full border border-[#2f2f2f] px-4 text-[14px] font-semibold text-[#f2efea]">Remind me</button>
          <button type="button" onClick={() => onAction(`not important ${item.index}`)} className="min-h-10 rounded-full border border-[#2f2f2f] px-4 text-[14px] font-medium text-[#a8a8a4]">Not important</button>
        </div>}
      </div>)}
      {card.skipped && <div className="flex min-h-12 items-center px-4 text-[14px] text-[#a8a8a4]">{card.skipped}</div>}
    </div>}
    {!card.items.length && card.skipped && <div className="mt-2 text-[14px] text-[#a8a8a4]">{card.skipped}</div>}
    {card.items.length > 0 && <div className="mt-2 text-[13px] text-[#a8a8a4]">Tap Not important and I'll learn. Ask "why 1" any time.</div>}
  </div>
}
