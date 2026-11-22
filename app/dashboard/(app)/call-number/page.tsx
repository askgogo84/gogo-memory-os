import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { generalCallPickerEnabled } from '@/lib/agent/general-call-places-phone'
import { CallNumberPicker } from './picker'

export const dynamic = 'force-dynamic'

export default async function CallNumberPage() {
  const session = await getSession()
  if (!generalCallPickerEnabled(session?.telegramId)) notFound()
  return <main className="mx-auto max-w-xl space-y-5 px-4 py-8">
    <h1 className="text-2xl font-semibold">Check a business phone number</h1>
    <p>Select the business in Google’s Place ID Finder. Copy its Place ID, then enter the listing name and locality here.</p>
    <a className="underline" target="_blank" rel="noreferrer" href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder">Open Google’s Place ID Finder ↗</a>
    <CallNumberPicker />
  </main>
}
