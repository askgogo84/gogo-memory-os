import * as SecureStore from 'expo-secure-store'

const ACCESS_TOKEN_KEY = 'askgogo.mobile.access_token.v1'
const EXPIRES_AT_KEY = 'askgogo.mobile.expires_at.v1'

export async function saveMobileSession(accessToken: string, expiresAt: string) {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  })
  await SecureStore.setItemAsync(EXPIRES_AT_KEY, expiresAt, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  })
}

export async function getMobileAccessToken(): Promise<string | null> {
  const [token, expiresAt] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(EXPIRES_AT_KEY),
  ])
  if (!token) return null
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    await clearMobileSession()
    return null
  }
  return token
}

export async function clearMobileSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(EXPIRES_AT_KEY),
  ])
}

export async function hasMobileSession() {
  return Boolean(await getMobileAccessToken())
}
