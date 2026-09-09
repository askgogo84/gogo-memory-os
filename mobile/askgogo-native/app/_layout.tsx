import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { hasMobileSession } from '../src/auth/session'

export default function RootLayout() {
  const router = useRouter()
  const segments = useSegments()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const linked = await hasMobileSession()
      if (!alive) return
      const first = segments[0]
      const onConnect = first === 'connect'
      const atRoot = !first
      if (!linked && !onConnect) router.replace('/connect')
      // Until every visual dashboard tab is connected to live data, linked users
      // land on the real Agent Hub instead of static preview cards.
      if (linked && (onConnect || atRoot)) router.replace('/agent')
      setReady(true)
    })()
    return () => { alive = false }
  }, [segments, router])

  if (!ready) return <View style={{ flex: 1, backgroundColor: '#F6F0E8' }} />

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
    </>
  )
}
