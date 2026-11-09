// 6 Nov live: a forwarded HDFC/CCAvenue confirmation ("Payment Status: SUCCESS, Merchant Name: KOTAK MAHINDRA PRIME
// LIMITED, Amount: ₹41,898.00 …") became "Expense added to With Amount: Total ₹41, unequal split". Instinct read it as a
// payment, said what it does not prove, and offered to find the merchant's receipt in Gmail.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const pc = await import('../lib/agent/payment-confirmation')
const sms = 'Payment Status: SUCCESS ,Merchant Name: KOTAK MAHINDRA PRIME LIMITED ,Amount: ₹41,898.00 ,Paid By: GOVERDHAN M DODDAMANE ,Amount Details: Savings A/c **********6355 ,HDFC Transaction ID: BAN016310IO0XLNHS9UL ,Reference Number: PIN056310E9529BHHMLK'
const p = pc.parsePaymentConfirmation(sms)!
assert.deepEqual({ ...p }, { status: 'success', merchant: 'Kotak Mahindra Prime', amount: 41898, amountText: '₹41,898', payer: 'Goverdhan M Doddamane', bank: 'HDFC', accountLast4: '6355', transactionId: 'BAN016310IO0XLNHS9UL', reference: 'PIN056310E9529BHHMLK', mode: null })
assert.equal(pc.confirmationReply(p), "The confirmation shows ₹41,898 paid successfully to Kotak Mahindra Prime from HDFC …6355. It doesn't by itself confirm Kotak Mahindra Prime has credited it against your loan.\n\nWant me to check for their receipt in your email?")
const upi = pc.parsePaymentConfirmation('You have paid ₹1,250.00 to Swiggy via UPI. UPI Ref No 331245678901')!
assert.equal(upi.merchant, 'Swiggy'); assert.equal(upi.mode, 'UPI'); assert.equal(upi.transactionId, '331245678901')
assert.match(pc.confirmationReply(upi), /paid successfully to Swiggy via UPI\. It doesn't by itself confirm Swiggy has recorded it on their side\./)
const bescom = pc.parsePaymentConfirmation('Rs 599.00 debited from A/c XX6355 on 06-11-26 to BESCOM. UPI Ref 629987654321. Not you? Call 18002586161')!
assert.equal(bescom.merchant, 'Bescom'); assert.equal(bescom.accountLast4, '6355')
const failed = pc.parsePaymentConfirmation('Payment of ₹12,450 to Kotak Mahindra Prime failed. Txn ID KMP88812345. Insufficient funds')!
assert.equal(failed.status, 'failed'); assert.match(pc.confirmationReply(failed), /^This shows a \*failed\* payment of ₹12,450 to Kotak Mahindra Prime\. Nothing was paid/)
for (const t of ['split 1200 dinner with Divya and Nithin', 'spent 450 on lunch', 'Transaction ID: abc', 'remind me to pay the EMI on 10th', 'I paid 500 to Nithin for the cab']) assert.equal(pc.parsePaymentConfirmation(t), null, t)
console.log('✓ bank, UPI and gateway confirmations are read as payments; split and expense lines are not')

// The receipt check: what Gmail proves.
assert.equal(pc.receiptQuery(p), '("41,898" OR "41898" OR "PIN056310E9529BHHMLK" OR "BAN016310IO0XLNHS9UL") "Kotak" "Mahindra" newer_than:10d -in:spam')
const gateway = { from: 'CCAvenue <no-reply@ccavenue.com>', subject: 'Payment order successful - 6856147904', snippet: 'Rs 41,898.00 to Kotak Mahindra Prime Limited. CCAvenue reference 114972842493' }
const merchant = { from: 'Kotak Mahindra Prime <customercare@kotakprime.com>', subject: 'Payment received against your loan', snippet: 'We have received Rs 41,898 towards loan account' }
assert.match(pc.receiptVerdict(p, [gateway]), /^Found the gateway's confirmation: CCAvenue: "Payment order successful - 6856147904": ₹41,898 to Kotak Mahindra Prime, payment successful\.\n\nNo receipt from Kotak Mahindra Prime itself yet\. The payment went through on the gateway's side; the loan credit is still unconfirmed\./)
assert.match(pc.receiptVerdict(p, [gateway, merchant]), /^Found it\. Kotak Mahindra Prime: "Payment received against your loan"\. That's Kotak Mahindra Prime's own confirmation of the ₹41,898, so this payment is settled on their side too\.\nThe gateway confirmation is there as well/)
assert.match(pc.receiptVerdict(p, []), /^No email about this ₹41,898 payment to Kotak Mahindra Prime in the last 10 days/)
// 6 Nov live: the only email was HDFC's own NetBanking confirmation; that is the bank's side, not nothing.
assert.match(pc.receiptVerdict(p, [{ from: 'HDFC Bank InstaAlerts <alerts@hdfcbank.bank.in>', subject: 'Confirmation of Payment Using HDFC NetBanking', snippet: 'We confirm that your payment has been successfully processed. Amount: Rs. 41898.00 Account No: **********6355' }]), /^Found your bank's confirmation: HDFC Bank InstaAlerts: "Confirmation of Payment Using HDFC NetBanking": ₹41,898 to Kotak Mahindra Prime, payment successful\.\n\nNo receipt from Kotak Mahindra Prime itself yet\. The payment went through on your bank's side; the loan credit is still unconfirmed\./)
assert.match(pc.receiptVerdict(p, [{ from: 'Amazon Pay India <no-reply@amazonpay.in>', subject: 'Payment Reminder', snippet: 'loan repayment of 41,898 due' }]), /none from Kotak Mahindra Prime or a payment gateway/)
console.log('✓ the Gmail check separates the gateway receipt from the merchant\'s own confirmation, as Instinct did')

// Wiring: before the brain and the split parser on both surfaces; the Google wording for access grants.
const wa = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8'), dash = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
// Since the understand-first gate (shared-content, 6 Nov) the confirmation runs inside tryShared and the receipt "yes" inside takeSharedFollowUp.
assert.ok(wa.indexOf("lib/agent/shared-content") < wa.indexOf("m.takeImageOffer("), 'WhatsApp: shared-content gate before the image-offer yes')
assert.match(dash, /m\.tryShared\(user\.telegram_id,text\)\)\|\|\(text\.length<=24\?m\.takeSharedFollowUp\(actor,text\)/)
const sc = readFileSync('lib/agent/shared-content.ts', 'utf8')
assert.match(sc, /if \(r\.kind === 'payment'\) return tryPaymentConfirmation\(telegramId, text\)/); assert.match(sc, /\|\| takeReceiptCheck\(actor, text\)/)
assert.match(readFileSync('lib/feature-intents-legacy.ts', 'utf8'), /!PAYMENT_CONFIRMATION\.test\(text\) && parseSplitIntent\(text\)/, 'split parser never sees a confirmation')
const brain = await import('../lib/agent/brain')
assert.ok(brain.isExactCommand(sms), 'the brain never chats about a forwarded confirmation')
const ma = await import('../lib/email/mail-alerts'); const { scoreEmail } = await import('../lib/email/attention')
const google = { id: 'g1', messageId: 'g1', threadId: '1a1afaade6795cd4', from: 'Google <no-reply@accounts.google.com>', subject: 'Security alert', snippet: "You allowed Instinct access to some of your Google Account data goverdhan.md@gmail.com If you didn't allow Instinct access to some of your Google Account data, someone else may be trying to access", internalDate: Date.now(), labelIds: ['INBOX'] }
assert.match(ma.composeAlert('security', scoreEmail(google as any, {}), { name: 'Goverdhan' }), /^🔐 Security\nGoverdhan, Google says \*Instinct\* was granted access to your account\./, 'Google\'s real wording (6 Nov live said only "security alert")')
console.log('✓ wired before the brain and the split parser; the Google access-grant email names the app')
console.log('Payment confirmation (6 Nov) checks passed')
