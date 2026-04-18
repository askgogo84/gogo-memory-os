import twilio from 'twilio'

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_NUMBER!

export async function sendWhatsApp(toNumber: string, text: string) {
  try {
    await client.messages.create({
      body: text,
      from: WHATSAPP_FROM,
      to: `whatsapp:${toNumber}`,
    })
    console.log(`✅ WhatsApp sent to ${toNumber}`)
  } catch (err) {
    console.error('WhatsApp send failed:', err)
  }
}