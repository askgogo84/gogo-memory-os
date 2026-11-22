'use client'

import { useActionState } from 'react'
import { lookUpBusinessNumber, type PickerResult } from './actions'

const initial: PickerResult = { kind: 'empty' }
const fields = [
  { name: 'businessName', label: 'Business name on the listing', max: 90 },
  { name: 'locality', label: 'Locality and city', max: 90 },
  { name: 'placeId', label: 'Google Place ID', max: 80 },
]

export function CallNumberPicker() {
  const [result, action, pending] = useActionState(lookUpBusinessNumber, initial)
  return <>
    <form action={action} className="space-y-4">
      {fields.map(field => <label key={field.name} className="block">
        {field.label}
        <input required name={field.name} maxLength={field.max} className="mt-1 block w-full rounded border border-current bg-transparent p-2" />
      </label>)}
      <button type="submit" disabled={pending} className="rounded bg-teal-700 px-4 py-2 text-white disabled:opacity-60">
        {pending ? 'Checking…' : 'Check listing'}
      </button>
    </form>
    <section aria-live="polite" aria-busy={pending}>
      {!pending && result.kind === 'error' && <p>{result.message}</p>}
      {!pending && result.kind === 'found' && <div className="space-y-2 rounded border p-4">
        <h2 className="text-lg font-semibold">{result.name}</h2>
        <p>{result.address}</p>
        <p className="select-all text-xl">{result.phone}</p>
        <a className="underline" target="_blank" rel="noreferrer" href={result.mapUrl}>View listing on Google Maps ↗</a>
        <p>If this is the right business and number, reply with the number in your original AskGogo chat. If the chat prompt has expired, repeat your request with the number. AskGogo will show the plan for your approval.</p>
      </div>}
    </section>
  </>
}
