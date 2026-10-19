// 19 Oct live: "Jailer qr code" went to general chat ("I don't have a QR code saved") although the PVR ticket
// screenshot with the QR was saved the day before.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
process.env.ANTHROPIC_API_KEY ||= 'fixture-only'
const am = await import('../lib/services/asset-memory')
for (const q of ['Jailer qr code', 'jailer ticket', 'show my Jailer 2 ticket', 'send the movie QR', 'my boarding pass', 'where is my e-ticket for tonight', 'Jailer 2 tickets'])
  assert.equal(am.isAssetRetrievalCommand(q), true, q)
for (const q of ['book tickets for Jailer 2', 'buy 2 tickets for the match', 'cancel my ticket', 'how much are Jailer tickets', 'Book a table for 2 at Toit Indiranagar tomorrow at 7pm', 'what are you working on', 'tickets for coldplay next month available?'])
  assert.equal(am.isAssetRetrievalCommand(q), false, q)
const ticketDoc = {title: 'Jailer 2', doc_type: 'image', summary: 'PVR Orion Mall M-Ticket, AUDI 04, seats K18, K19, K20, booking ID TSAJKDX, QR code', extracted: {}}
const invoice = {title: 'Jailer Traders invoice', doc_type: 'invoice', summary: 'GST invoice', extracted: {}}
assert.equal(am.ticketDocumentBoost('Jailer qr code', ticketDoc), 2)
assert.equal(am.ticketDocumentBoost('Jailer qr code', invoice), 0, 'a non-ticket document with the same word gets no boost')
assert.equal(am.ticketDocumentBoost('Jailer invoice', ticketDoc), 0, 'no boost unless the ask names a ticket/QR')
const src = readFileSync('lib/services/asset-memory.ts', 'utf8')
assert.match(src, /score \+= ticketDocumentBoost\(text, doc\)/)
process.stdout.write('Ticket/QR retrieval: short ticket asks route to saved documents; booking/buying asks do not; ticket docs get a metadata boost.\n')
