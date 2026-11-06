// Synthetic-only regression for #1325 false paid outcomes in bank/gateway/merchant receipts.
// No network, provider, Gmail, credentials, payment or user account actions.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { parsePaymentConfirmation, receiptVerdict } = await import('../lib/agent/payment-confirmation')
const payment = parsePaymentConfirmation('Payment Status: SUCCESS, Merchant Name: KOTAK MAHINDRA PRIME LIMITED, Amount: ₹41,898.00, HDFC Transaction ID: BAN016310IO0XLNHS9UL')!
assert.ok(payment, 'synthetic forwarded confirmation must parse')

const bankFrom = 'HDFC Bank InstaAlerts <alerts@hdfcbank.bank.in>'
const gatewayFrom = 'CCAvenue <no-reply@ccavenue.com>'
const merchantFrom = 'Kotak Mahindra Prime <customercare@kotakprime.com>'
let count = 0
const unconfirmed = (name: string, mails: {from:string,subject:string,snippet:string}[]) => {
  const answer = receiptVerdict(payment, mails)
  assert.doesNotMatch(answer, /payment successful|paid successfully|settled on their side|payment went through|The payment went through|That's Kotak Mahindra Prime's own confirmation/i, name + ': ' + answer)
  count++
  console.log('PASS ' + name)
}
const accepted = (name: string, mails: {from:string,subject:string,snippet:string}[], pattern: RegExp) => {
  assert.match(receiptVerdict(payment, mails), pattern, name)
  count++
  console.log('PASS ' + name)
}
unconfirmed('bank failure in snippet despite confirmation subject', [{
  from: bankFrom, subject: 'Confirmation of Payment Using HDFC NetBanking',
  snippet: 'Your payment of Rs. 41898 to Kotak Mahindra Prime could not be processed.',
}])
unconfirmed('bank subject explicitly says failed', [{
  from: bankFrom, subject: 'Payment failed',
  snippet: 'Your payment of Rs. 41898 to Kotak Mahindra Prime was processed by the payment system.',
}])
unconfirmed('payment not processed negates positive processed token', [{
  from: bankFrom, subject: 'Payment confirmation',
  snippet: 'Your payment of Rs. 41898 to Kotak Mahindra Prime was not processed.',
}])
unconfirmed('gateway reminder is not proof even with matching amount', [{
  from: 'Amazon Pay India <no-reply@amazonpay.in>', subject: 'Payment Reminder',
  snippet: 'Your loan payment of 41,898 to Kotak Mahindra Prime is due on Friday.',
}])
unconfirmed('gateway pending confirmation is not a completed receipt', [{
  from: gatewayFrom, subject: 'Payment confirmation',
  snippet: 'Your transaction for Rs 41,898 is pending. We will process it after verification.',
}])
unconfirmed('merchant-name match must not turn failed mail into settled claim', [{
  from: merchantFrom, subject: 'Payment failed',
  snippet: 'Your payment of 41,898 to Kotak Mahindra Prime was declined by the bank.',
}])
unconfirmed('reversed bank payment must not count as success', [{
  from: bankFrom, subject: 'Payment reversal',
  snippet: 'Transaction for Rs 41,898 was reversed after being successfully processed.',
}])
unconfirmed('receipt subject does not establish paid status when snippet rejects it', [{
  from: merchantFrom, subject: 'Payment received',
  snippet: 'Payment of 41,898 could not be processed; please retry.',
}])
accepted('completed HDFC NetBanking payment remains evidence from bank', [{
  from: bankFrom, subject: 'Confirmation of Payment Using HDFC NetBanking',
  snippet: 'We confirm that your payment has been successfully processed. Amount Rs 41898.00.',
}], /^Found your bank's confirmation:/)
accepted('completed gateway payment remains evidence from gateway', [{
  from: gatewayFrom, subject: 'Payment order successful - 6856147904',
  snippet: 'Rs 41,898.00 to Kotak Mahindra Prime Limited. CCAvenue reference 114972842493.',
}], /^Found the gateway's confirmation:/)
accepted('merchant received loan payment remains evidence on merchant side', [{
  from: merchantFrom, subject: 'Payment received against your loan',
  snippet: 'We have received Rs 41,898 towards loan account.',
}], /^Found it\./)
accepted('negative bank notice is skipped when a separate genuine confirmation exists', [
  { from: bankFrom, subject: 'Payment failed', snippet: 'Your payment of Rs 41898 was not processed.' },
  { from: bankFrom, subject: 'Confirmation of Payment Using HDFC NetBanking', snippet: 'Payment Rs 41898 successfully processed.' },
], /^Found your bank's confirmation:/)
console.log(`Payment negative-status original-module regressions PASS (${count})`)
