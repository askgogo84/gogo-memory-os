import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../src/theme'

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  gogo: 'sparkles-outline', today: 'sunny-outline', memory: 'library-outline', activity: 'pulse-outline', you: 'person-outline',
}

export default function TabsLayout() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  return <Tabs screenOptions={({route})=>({
    headerShown:false,
    tabBarHideOnKeyboard:true,
    tabBarActiveTintColor:t.ink,
    tabBarInactiveTintColor:t.ink3,
    tabBarLabelStyle:{fontSize:11,fontWeight:'600',marginTop:2},
    tabBarIcon:({color,size})=><Ionicons name={icons[route.name] || 'ellipse-outline'} color={color} size={Math.min(size,22)} />,
    tabBarStyle:{height:64+insets.bottom,paddingTop:8,paddingBottom:Math.max(insets.bottom,8),backgroundColor:t.paper,borderTopColor:t.hairline,borderTopWidth:1,elevation:0},
    sceneStyle:{backgroundColor:t.paper},
  })}>
    <Tabs.Screen name="gogo" options={{title:'Gogo'}} />
    <Tabs.Screen name="today" options={{title:'Today'}} />
    <Tabs.Screen name="memory" options={{title:'Memory'}} />
    <Tabs.Screen name="activity" options={{title:'Activity'}} />
    <Tabs.Screen name="you" options={{title:'You'}} />
  </Tabs>
}
