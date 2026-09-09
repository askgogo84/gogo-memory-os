import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { hasMobileSession } from '../src/auth/session'

export default function RootLayout() {
  const router = useRouter()
  const segments = useSegments()
  const rootNavigationState = useRootNavigationState()
  const [checked, setChecked] = useState(false)
  const [linked, setLinked] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const hasSession = await hasMobileSession()
        if (!alive) return
        setLinked(hasSession)
      } catch (error) {
        // A SecureStore/device issue must never crash first launch. Treat the
        // device as unlinked and let the user reconnect safely.
        console.warn('MOBILE_SESSION_CHECK_FAILED', error)
        if (!alive) return
        setLinked(false)
      } finally {
        if (alive) setChecked(true)
      }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    // Expo Router requires the root navigator to be mounted before replace().
    // The previous implementation redirected while returning only a blank View,
    // which could terminate the app on first launch in an installed APK.
    if (!checked || !rootNavigationState?.key) return

    const first = segments[0]
    const onConnect = first === 'connect'
    const atRoot = !first

    if (!linked && !onConnect) {
      router.replace('/connect')
      return
    }

    // Until every visual dashboard tab is connected to live data, linked users
    // land on the real Agent Hub instead of static preview cards.
    if (linked && (onConnect || atRoot)) {
      router.replace('/agent')
    }
  }, [checked, linked, rootNavigationState?.key, segments, router])

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
      {!checked && <View pointerEvents="none" style={styles.bootCover} />}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F6F0E8',
  },
  bootCover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F6F0E8',
  },
})
