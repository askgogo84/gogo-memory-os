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
      const onConnect = segments[0] === 'connect'
      if (!linked && !onConnect) router.replace('/connect')
      if (linked && onConnect) router.replace('/')
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
