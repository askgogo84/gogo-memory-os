// Automatic monthly totals from vendor billing APIs (only where AskGogo already holds the credentials).
export async function twilioMonthUsd(which: 'ThisMonth' | 'LastMonth'): Promise<number | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Usage/Records/${which}.json?Category=totalprice`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
      next: { revalidate: 3600 },
    } as any)
    if (!res.ok) return null
    const body: any = await res.json()
    const price = Number(body?.usage_records?.[0]?.price)
    return Number.isFinite(price) ? price : null
  } catch { return null }
}
