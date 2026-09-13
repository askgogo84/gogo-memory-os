import { Keyboard, TouchableWithoutFeedback, View } from 'react-native'
import { Stack } from 'expo-router'
import { ShareIntentProvider } from 'expo-share-intent'
import NativeBootstrap from '../src/native/bootstrap'

export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
          <NativeBootstrap />
          <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: '#FFFFFF' } }} />
        </View>
      </TouchableWithoutFeedback>
    </ShareIntentProvider>
  )
}
