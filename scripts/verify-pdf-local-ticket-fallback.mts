import assert from 'node:assert/strict'
import { classifyPdfTextLocally, parseFlightTicketText } from '../lib/services/pdf-reader'

const etihadText=`
All times are local to each city
Bengaluru Abu Dhabi
BLR
22:15
27 Sep 2026
03h 50m • Non-stop
Boeing 787-9
AUH
00:35
28 Sep 2026
Kempegowda Intl
Terminal 2
Zayed International Airport
Terminal A
Connection: 2 hours 0 minutes
Abu Dhabi New York
AUH
02:35
28 Sep 2026
14h 00m • Non-stop
Airbus A350-1000
JFK
08:35
28 Sep 2026
Zayed International Airport
Terminal A
John F Kennedy Intl
Terminal 4
Divyashree Urs
Thank you for your booking.
We look forward to welcoming you soon.
Booking reference B8XIQC
Other airlines OYXRNO(1S)
Ticket number 607 7453700171
Date of issue 05 Jul 2026
Issuing office Pricelinecom Inc
BLR
27 Sep
EY 239
AUH
28 Sep
EY 1
JFK
EY 239 • Etihad
Status CONFIRMED
EY 1 • Etihad
Status CONFIRMED
Electronic ticket receipt
`

assert.equal(classifyPdfTextLocally(etihadText),'TICKET')
const parsed=parseFlightTicketText(etihadText)
assert.ok(parsed)
assert.equal(parsed?.type,'flight')
assert.equal(parsed?.flights.length,2)
assert.deepEqual(parsed?.flights.map(f=>[f.from,f.to,f.date,f.departure,f.arrival,f.flightNo,f.pnr]),[
  ['Bengaluru','Abu Dhabi','27 Sep 2026','22:15','00:35','EY239','B8XIQC'],
  ['Abu Dhabi','New York','28 Sep 2026','02:35','08:35','EY1','B8XIQC'],
])
assert.deepEqual(parsed?.passengers,['Divyashree Urs'])

assert.equal(classifyPdfTextLocally('Invoice number 123. Total USD 55.00. Thank you for your purchase.'),null)
assert.equal(parseFlightTicketText('This is a normal document with no booking reference.'),null)

console.log('PDF local ticket fallback regression passed')
