// Dashboard visual root. The Final-Dark design is the canonical customer UI.
// Auth remains in app/dashboard/(app)/layout.tsx; /dashboard itself stays public
// for OTP/token redemption.

import type { Viewport } from 'next'

// Dark browser bar and notch-safe area for the dashboard, so the installed app looks like one piece.
export const viewport: Viewport = { themeColor: '#0b0b0b', viewportFit: 'cover' }

export default function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className="dashboard-root theme-dark final-dark flex min-h-full flex-1 flex-col">{children}</div>
}
