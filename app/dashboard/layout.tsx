// Pass-through layout for the WHOLE /dashboard tree — the public token-redeemer
// (app/dashboard/page.tsx) AND the guarded (app) group. It intentionally does NO
// auth (the guard lives in (app)/layout.tsx); its only job is to stamp every
// dashboard page with `.dashboard-root`, which:
//   1. scopes the global dark-mode flip OUT of the dashboard (globals.css), and
//   2. forces light color-scheme + the cream/ink tokens inside.
// flex-1 keeps the height chain intact so (app)'s min-h-full still fills.

export default function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className="dashboard-root flex min-h-full flex-1 flex-col">{children}</div>
}
