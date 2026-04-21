const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID!
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET!

const authHeader = 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')

export async function createPaymentLink(options: {
  amount: number
  description: string
  customerName: string
  telegramId?: number
  whatsappId?: string
  plan: string
}): Promise<string | null> {
  try {
    const response = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({
        amount: options.amount * 100, // paise
        currency: 'INR',
        description: options.description,
        customer: { name: options.customerName },
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: {
          telegram_id: String(options.telegramId || ''),
          whatsapp_id: options.whatsappId || '',
          plan: options.plan,
        },
        callback_url: 'https://app.askgogo.in/api/payment/verify',
        callback_method: 'get',
        expire_by: Math.floor(Date.now() / 1000) + 86400, // 24 hours
      }),
    })

    const data = await response.json()
    return data.short_url || null
  } catch (err) {
    console.error('Razorpay link creation failed:', err)
    return null
  }
}

export function verifySignature(
  paymentLinkId: string,
  paymentId: string,
  signature: string
): boolean {
  const crypto = require('crypto')
  const payload = `${paymentLinkId}|${paymentId}`
  const expected = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(payload)
    .digest('hex')
  return expected === signature
}