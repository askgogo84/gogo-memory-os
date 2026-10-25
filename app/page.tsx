import { redirect } from 'next/navigation'

// app.askgogo.in is the app, not the marketing site (that is askgogo.in, a separate repo). The root goes straight to
// the dashboard: signed-in people land on Home, everyone else gets the WhatsApp sign-in page there.
export default function Root() {
  redirect('/dashboard')
}
