// Legacy /calendar entry must not convert a caller-supplied numeric owner ID into a
// signed Google OAuth state. Only possession of a current, server-issued connect
// token may identify the account, consistent with /api/calendar/connect.
import { verifyCalendarConnectToken } from './google-calendar'

export function calendarOwnerForLegacyEntry(params: URLSearchParams): number | null {
  const token = params.get('token') || ''
  const owner = verifyCalendarConnectToken(token)
  // Legacy BigInt/unsafe numeric aliases must never change the chosen account.
  return typeof owner === 'number' && Number.isSafeInteger(owner) && owner !== 0 ? owner : null
}
