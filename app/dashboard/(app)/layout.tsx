import { redirect } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { TabBar } from '@/components/dashboard/tab-bar'
import { SideRail } from '@/components/dashboard/side-rail'

// ── The guarded dashboard shell ───────────────────────────────────────────────
// Everything under this (app) route group is signed-in-only. The guard lives
// HERE, once, so the five tab pages don't each re-implement it. The public
// token-redeemer at app/dashboard/page.tsx sits OUTSIDE this group on purpose —
// it must stay reachable without a session (it's the only way to get one).
//
// (app) is a route group: it never appears in the URL. /dashboard/today etc.
//
// Identity is only ever the session's telegram_id, resolved server-side. No
// account is ever addressable by editing a URL.

export const dynamic = 'force-dynamic'

export default async function DashboardShell({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (!session) redirect('/dashboard')

  return (
    // Cream/ink scoped to the shell so the app reads warm regardless of the OS
    // dark-mode preference the global body honours. Desktop = same layout,
    // centred at 480px (app-flow §8). pb clears the fixed tab bar.
    //
    // w-full is load-bearing: this is a flex item with mx-auto, and an auto
    // cross-axis margin cancels align-items:stretch — without an explicit width
    // the cream column shrinks to its CONTENT width, so a page with narrow content
    // (Lists) shows body-white bands down both sides while a wide one (Today) looks
    // full-bleed. w-full pins it to min(100%, 480px) regardless of content.
    // SideRail is fixed to the viewport's left edge and only shows on lg+; below
    // lg it is display:none, so the mobile layout is untouched. It lives outside
    // the centred column deliberately — a flex child here (the container is
    // flex-col) would stack under <main>, and pushing the column would shift the
    // reminder-thread gutter. Kept as a fixed sibling, it never enters the flow.
    // At lg the column grows to the design's 1180px frame (mockup 1i) and gains a
    // 212px LEFT PADDING — not a margin — to clear the fixed SideRail. Padding is
    // load-bearing here: the shell is mx-auto-centred, so a margin-left would be
    // cancelled by the auto centring, whereas padding keeps the 1180 frame centred
    // and reproduces the design's internal split (212 rail + 968 content). Below lg
    // both lg:-prefixes are inert, so the mobile column is unchanged. (Wide-viewport
    // note: the rail is fixed to the VIEWPORT edge, so past 1180px the centred
    // content drifts right of it — re-anchoring the rail is a later pass.)
    <div className="mx-auto flex min-h-full w-full max-w-[480px] flex-1 flex-col bg-gogo-cream font-sans text-gogo-ink lg:max-w-[1180px] lg:pl-[212px]">
      <SideRail />
      {/* lg padding matches the design content-area (26 / 28 / 30). pb drops from
          the tab-bar clearance (pb-24 ≈ 96px) to 30px — there's no bottom bar on
          desktop, so that 96px was dead space under the content. */}
      <main className="flex-1 px-5 pt-6 pb-24 lg:px-7 lg:pb-[30px] lg:pt-[26px]">{children}</main>
      <TabBar />
    </div>
  )
}
