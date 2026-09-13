import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ScreenTitle, SectionLabel, SettingRow } from '../../src/design/components'
import { useTheme } from '../../src/theme'

export default function Activity(){const t=useTheme();const r=useRouter();const i=useSafeAreaInsets();return <ScrollView style={{flex:1,backgroundColor:t.paper}} contentContainerStyle={[s.wrap,{paddingTop:i.top+28,paddingBottom:96+i.bottom}]}><ScreenTitle eyebrow="Activity" title="What Gogo is doing." body="Active work, watchers, retries and completed actions live here."/><SectionLabel>Working</SectionLabel><SettingRow icon="sparkles-outline" title="Agent Hub" subtitle="Open live goals, ideas, approvals and autonomous work" onPress={()=>r.push('/agent-safe')}/><SectionLabel>Watching</SectionLabel><SettingRow icon="eye-outline" title="Watchers" subtitle="Open live monitoring and background activity" onPress={()=>r.push('/agent-safe')}/><SectionLabel>Done today</SectionLabel><SettingRow icon="checkmark-circle-outline" title="Recent activity" subtitle="Review what Gogo completed" onPress={()=>r.push('/agent-safe')}/></ScrollView>}
const s=StyleSheet.create({wrap:{paddingHorizontal:20}})
