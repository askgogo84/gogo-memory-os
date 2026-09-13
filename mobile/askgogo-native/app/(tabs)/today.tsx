import { ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { EmptyState, ScreenTitle } from '../../src/design/components'
import { useTheme } from '../../src/theme'

export default function Today(){const t=useTheme();const i=useSafeAreaInsets();return <ScrollView style={{flex:1,backgroundColor:t.paper}} contentContainerStyle={[s.wrap,{paddingTop:i.top+28,paddingBottom:96+i.bottom}]}><ScreenTitle eyebrow="Today" title="What Gogo found." body="Updates, reminders and watcher changes will collect here without turning Home into a feed."/><EmptyState icon="sunny-outline" title="All quiet for now" body="New findings, reminders and completed work will appear here as Gogo handles your day."/></ScrollView>}
const s=StyleSheet.create({wrap:{paddingHorizontal:20}})
