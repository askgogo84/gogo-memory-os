import { View } from 'react-native'
import { Stack } from 'expo-router'
import { ShareIntentProvider } from 'expo-share-intent'
import NativeBootstrap from '../src/native/bootstrap'

export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <View style={{ flex: 1, backgroundColor: '#F6F0E8' }}>
        <NativeBootstrap />
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
      </View>
    </ShareIntentProvider>
  )
}
