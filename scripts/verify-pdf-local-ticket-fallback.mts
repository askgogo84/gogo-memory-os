import assert from 'node:assert/strict'
import { classifyPdfTextLocally, extractPdfTextLocally, ensurePdfJsServerlessGlobals } from '../lib/services/pdf-reader'
import { parseFlightTicketTextSafe } from '../lib/services/pdf-reader-whatsapp'

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
const parsed=parseFlightTicketTextSafe(etihadText)
assert.ok(parsed)
assert.equal(parsed?.type,'flight')
assert.equal(parsed?.flights.length,2)
assert.deepEqual(parsed?.flights.map(f=>[f.from,f.to,f.date,f.departure,f.arrival,f.flightNo,f.pnr]),[
  ['Bengaluru','Abu Dhabi','27 Sep 2026','22:15','00:35','EY239','B8XIQC'],
  ['Abu Dhabi','New York','28 Sep 2026','02:35','08:35','EY1','B8XIQC'],
])
assert.deepEqual(parsed?.passengers,['Divyashree Urs'])

assert.equal(classifyPdfTextLocally('Invoice number 123. Total USD 55.00. Thank you for your purchase.'),null)
assert.equal(parseFlightTicketTextSafe('This is a normal document with no booking reference.'),null)


// Actual PDF.js runtime regression: Vercel Node does not provide browser canvas
// globals. The helper must install enough server-side globals for text extraction
// before pdf-parse/pdfjs is imported.
;(globalThis as any).DOMMatrix=undefined
;(globalThis as any).ImageData=undefined
;(globalThis as any).Path2D=undefined
ensurePdfJsServerlessGlobals()
assert.equal(typeof (globalThis as any).DOMMatrix,'function')
assert.equal(typeof (globalThis as any).ImageData,'function')
assert.equal(typeof (globalThis as any).Path2D,'function')
const tinyPdf=Buffer.from('JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCAzMDAgMjAwIF0gL1BhcmVudCA2IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNiAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwOTIwMTgxNjEyKzAwJzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwOTIwMTgxNjEyKzAwJzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAxNzEKPj4Kc3RyZWFtCkdhcm84XSswRWgmNENsWmlmbjJPRzhLYTctT0llRTklTGtKPl9qPDZuR2UyJDhyU0k5MS9qXmVOOFQ8S1EkIT5CWXJXL2I9RyVtQiI9a29QJD0nSEMpQyFmcEIpKy45WUM0VVgpYUYyNXAvazFba1QlM0NNXV1pXSlPO2FNMUosdCdRJSxIJWZCZ2dSU0JLbldbaWJKSDlBWCRwImNbXzUyNTJIXEYiX2J+PmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDYxIDAwMDAwIG4gCjAwMDAwMDAwOTIgMDAwMDAgbiAKMDAwMDAwMDE5OSAwMDAwMCBuIAowMDAwMDAwMzkyIDAwMDAwIG4gCjAwMDAwMDA0NjAgMDAwMDAgbiAKMDAwMDAwMDcyMSAwMDAwMCBuIAowMDAwMDAwNzgwIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPGMzYjZhOGE3ZDAyZDg5OGE2NjI1NTcyMTAyZGRmODhjPjxjM2I2YThhN2QwMmQ4OThhNjYyNTU3MjEwMmRkZjg4Yz5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNSAwIFIKL1Jvb3QgNCAwIFIKL1NpemUgOAo+PgpzdGFydHhyZWYKMTA0MQolJUVPRgo=','base64')
const tinyText=await extractPdfTextLocally(tinyPdf)
assert.match(tinyText,/Booking reference TEST12/)
assert.match(tinyText,/BLR 22:15 27 Sep 2026/)

// Regression guard: aircraft models must never become flight numbers.
assert.equal(parseFlightTicketTextSafe(`
BLR 22:15 27 Sep 2026 Boeing 787-9 AUH 00:35 28 Sep 2026
Booking reference B8XIQC
EY 239 • Etihad
` )?.flights[0]?.flightNo,'EY239')

console.log('PDF local ticket fallback regression passed')
