// Understand first (6 Nov): forwarded SMS/alerts are read as what they are, never as instructions.
// The Kotak payment SMS that became a ₹41 split is the anchor case; the rest are the shapes Indian phones get daily.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const sc = await import('../lib/agent/shared-content')

const KOTAK = 'Payment Status: SUCCESS ,Merchant Name: KOTAK MAHINDRA PRIME LIMITED ,Amount: ₹41,898.00 ,Paid By: GOVERDHAN M DODDAMANE ,Amount Details: Savings A/c **********6355 ,HDFC Transaction ID: BAN016310IO0XLNHS9UL ,Reference Number: PIN056310E9529BHHMLK'
const DEBIT = 'Rs.2,450.00 debited from A/c XX6355 on 06-11-26 to SWIGGY via UPI. UPI Ref 631012345678. Not you? Call 18002586161 -HDFC Bank'
const CARD = 'INR 1,250.00 spent on HDFC Bank Card x1712 at AMAZON on 06-Nov-26. Avl bal: not disclosed. If not you, call 18002586161.'
const CREDIT = 'Rs.15,000.00 credited to A/c XX6355 on 05-11-26 by IMPS from DIVYA S. Ref 530512345. -HDFC Bank'
const OTP = '482913 is your OTP for login to Flipkart. Valid for 10 minutes. Do not share with anyone. -Flipkart'
const DELIVERY = 'Your Myntra order is out for delivery today and will be delivered by 7 PM. Tracking ID MYN123456789. Delivery partner: Delhivery.'
const BOOKING = 'Dear Customer, your IndiGo flight 6E 345 BLR-BOM on 09 Nov 2026, 09:55 is confirmed. PNR XR7K2Q. Web check-in opens 48 hrs before departure. Team IndiGo'
const BILL = 'Dear Customer, your Airtel Fiber bill of Rs.1,199 is due on 12 Nov 2026. Pay now to avoid disconnection. Ignore if already paid. -Airtel'
const SECURITY = 'Security alert: A new sign-in to your Google Account on Windows was detected on 6 Nov. If this was you, no action needed. Verify it\'s you at g.co/recover.'
const PROMO = 'Flat 40% off on all shoes this weekend! Use code STEP40 at checkout. T&C apply. To opt-out reply STOP -Myntra'

// 1. Instructions are never shared content, even with money and names in them.
for (const t of ['split 2450 with Divya and Nithin for dinner', 'remind me to pay Airtel on 11 Nov', 'add 1250 amazon to expenses', 'what is this message about?', 'Yes', 'book a table for 4 at Toit tomorrow 8pm', 'can you check if Rs.2,450 debited from A/c XX6355 to SWIGGY was mine?'])
  assert.equal(sc.readShared(t), null, `instruction stays an instruction: ${t}`)
for (const t of ['Hey, yesterday I went to Toit with Divya and Nithin and we spent around 2450 on dinner, it was a great evening and the beer was good',
  'My office is in Koramangala 5th block near the Forum mall, Divya sits on the 3rd floor and Nithin works from home on Fridays. Remember this.',
  'I paid 500 to Divya for the cab and 1200 to Nithin for the tickets, both on 5 Nov, from my HDFC account',
  'Goa trip: 12 to 15 Dec with Divya and Nithin, we want a beach villa in Anjuna under 8000 a night and a scooter'])
  assert.equal(sc.readShared(t), null, `the person's own words are not shared content: ${t.slice(0, 40)}`)
const trailing = `${DEBIT}\nsplit this with Divya`
assert.equal(sc.readShared(trailing), null, 'pasted content followed by an instruction goes to the instruction\'s handler')
console.log('✓ instructions, questions and yes/no never read as shared content')

// 2. Each shape gets its kind, its facts, and its one offer.
const k = (t: string) => sc.readShared(t)
assert.equal(k(KOTAK)?.kind, 'payment', 'the Kotak SMS is a payment, not a split')
assert.deepEqual([k(DEBIT)?.kind, k(DEBIT)?.amount?.text, k(DEBIT)?.merchant, k(DEBIT)?.sender, k(DEBIT)?.offer], ['bank_debit', '₹2,450.00', 'Swiggy', 'HDFC Bank', 'log_expense'])
assert.deepEqual([k(CARD)?.kind, k(CARD)?.merchant, k(CARD)?.offer], ['bank_debit', 'Amazon', 'log_expense'])
assert.deepEqual([k(CREDIT)?.kind, k(CREDIT)?.offer], ['bank_credit', null])
assert.deepEqual([k(OTP)?.kind, k(OTP)?.offer, k(OTP)?.sender], ['otp', null, 'Flipkart'])
assert.deepEqual([k(DELIVERY)?.kind, k(DELIVERY)?.detail, k(DELIVERY)?.ref, k(DELIVERY)?.offer], ['delivery', 'out for delivery', 'MYN123456789', 'check_order'])
assert.deepEqual([k(BOOKING)?.kind, k(BOOKING)?.ref, k(BOOKING)?.offer], ['booking', 'XR7K2Q', 'save_booking'])
assert.deepEqual([k(BILL)?.kind, k(BILL)?.amount?.text, k(BILL)?.date, k(BILL)?.offer], ['bill_due', '₹1,199', '12 Nov 2026', 'remind_bill'])
assert.deepEqual([k(SECURITY)?.kind, k(SECURITY)?.offer], ['security', null])
assert.deepEqual([k(PROMO)?.kind, k(PROMO)?.offer], ['promo', null])
console.log('✓ payment, debit, credit, OTP, delivery, booking, bill, security, promo each read correctly with one offer or none')

// 3. Wording: what it states, what it does not prove, the one question last.
const say = (t: string) => sc.sharedReply(sc.readShared(t)!)
assert.match(say(DEBIT), /^HDFC Bank says \*₹2,450\.00\* left your account to Swiggy on 06-11-26\. That's the bank's side; it doesn't by itself confirm Swiggy received it\.\n\nWant me to log it as an expense\?$/)
assert.match(say(OTP), /^That's a one-time code from Flipkart\. I don't save these, and no one from AskGogo will ever ask you for one\.$/)
assert.match(say(DELIVERY), /says a parcel is out for delivery today \(ref MYN123456789\)\. The message doesn't say which order/)
assert.match(say(DELIVERY), /Want me to check your email for the latest on it\?$/)
assert.match(say(BOOKING), /^That's a booking confirmation from IndiGo, ref XR7K2Q on 09 Nov 2026\. It confirms the booking, not that payment has settled/)
assert.match(say(BILL), /^Airtel says \*₹1,199\* is due on 12 Nov 2026\. I can't tell from this whether it's already paid\.\n\nWant a reminder the day before\?$/)
assert.match(say(CREDIT), /came into your account from Divya S on 05-11-26\. Nothing to do\.$/)
assert.match(say(SECURITY), /^Google says a security event|is reporting a security event/)
assert.match(say(PROMO), /^That's a promotion from Myntra\. Nothing to do unless you want it\.$/)
for (const t of [DEBIT, CARD, CREDIT, OTP, DELIVERY, BOOKING, BILL, SECURITY, PROMO]) assert.ok(say(t).length < 330, `short: ${say(t).length}`)
console.log('✓ each reply: the message\'s own facts, what Gogo cannot tell, at most one question, under 330 chars')

// 4. The day-before reminder lands at 9 am IST the day before, never in the past.
const now = Date.parse('2026-11-06T10:00:00+05:30')
assert.equal(sc.dayBeforeAt9('12 Nov 2026', now, 'Asia/Kolkata'), '2026-11-11T03:30:00.000Z')
assert.equal(sc.dayBeforeAt9('12-11-26', now, 'Asia/Kolkata'), '2026-11-11T03:30:00.000Z')
assert.equal(sc.dayBeforeAt9('5 Nov', now, 'Asia/Kolkata'), '2027-11-04T03:30:00.000Z', 'a dateless past day rolls to next year')
assert.equal(sc.dayBeforeAt9('06-11-2026', now, 'Asia/Kolkata'), null, 'due today: no day-before slot left')
console.log('✓ bill reminders at 9 am the day before')

// 5. Wired before every action handler on both surfaces, only on Vercel, with the "yes" follow-up.
const wa = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8'), dash = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
assert.match(wa, /@\/lib\/agent\/shared-content/); assert.match(wa, /m\.tryShared\(String\(resolvedUser\.telegramId\), text\)/); assert.match(wa, /m\.takeSharedFollowUp\(/)
assert.match(dash, /@\/lib\/agent\/shared-content/); assert.match(dash, /m\.tryShared\(user\.telegram_id,text\)/); assert.match(dash, /m\.takeSharedFollowUp\(/)
assert.ok(!/@\/lib\/agent\/payment-confirmation'\)\.then/.test(wa) && !/@\/lib\/agent\/payment-confirmation'\)\.then/.test(dash), 'payment flow now runs inside shared-content, not as a second hook')
console.log('✓ wired on WhatsApp and the dashboard; payment confirmations flow through the same gate')
console.log('Shared content (6 Nov) checks passed')
