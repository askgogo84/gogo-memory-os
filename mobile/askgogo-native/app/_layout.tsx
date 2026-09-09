import { View } from 'react-native'
import { Stack } from 'expo-router'

export default function RootLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: '#F6F0E8' }}>
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
    </View>
  )
}
