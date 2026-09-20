import { PropsWithChildren } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { radius, statusColor, useTheme } from '../theme'

export function ScreenTitle({ eyebrow, title, body }: { eyebrow?: string; title: string; body?: string }) {
  const t = useTheme()
  return <View style={s.titleWrap}>
    {eyebrow ? <Text style={[s.eyebrow,{color:t.ink3}]}>{eyebrow.toUpperCase()}</Text> : null}
    <Text style={[s.title,{color:t.ink}]}>{title}</Text>
    {body ? <Text style={[s.body,{color:t.ink2}]}>{body}</Text> : null}
  </View>
}

export function StatusDot({ kind = 'done' }: { kind?: keyof typeof statusColor }) {
  return <View style={[s.dot,{backgroundColor:statusColor[kind]}]} />
}

export function QuietCard({ children, onPress }: PropsWithChildren<{ onPress?: () => void }>) {
  const t = useTheme()
  const content = <View style={[s.card,{backgroundColor:t.surface,borderColor:t.hairline}]}>{children}</View>
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content
}

export function SectionLabel({ children }: PropsWithChildren) {
  const t = useTheme()
  return <Text style={[s.section,{color:t.ink3}]}>{children}</Text>
}

export function SettingRow({ icon, title, subtitle, onPress, trailing }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string; onPress?: () => void; trailing?: string }) {
  const t = useTheme()
  return <Pressable onPress={onPress} style={[s.row,{borderBottomColor:t.rowLine}]}>
    <View style={[s.iconBox,{backgroundColor:t.surface}]}><Ionicons name={icon} size={19} color={t.ink2} /></View>
    <View style={{flex:1}}>
      <Text style={[s.rowTitle,{color:t.ink}]}>{title}</Text>
      {subtitle ? <Text style={[s.rowSub,{color:t.ink3}]}>{subtitle}</Text> : null}
    </View>
    {trailing ? <Text style={[s.trailing,{color:t.ink3}]}>{trailing}</Text> : <Ionicons name="chevron-forward" size={18} color={t.ink3} />}
  </Pressable>
}

export function AskInput({ value, onChangeText, onSend, onAttach, onMic }: { value:string; onChangeText:(v:string)=>void; onSend:()=>void; onAttach:()=>void; onMic:()=>void }) {
  const t=useTheme()
  return <View style={[s.ask,{backgroundColor:t.surface,borderColor:t.hairline}]}>
    <Pressable onPress={onAttach} hitSlop={10}><Ionicons name="add" size={24} color={t.ink2} /></Pressable>
    <TextInput value={value} onChangeText={onChangeText} onSubmitEditing={onSend} placeholder="Ask Gogo anything…" placeholderTextColor={t.ink3} style={[s.input,{color:t.ink}]} returnKeyType="send" />
    <Pressable onPress={onMic} hitSlop={10}><Ionicons name="mic-outline" size={21} color={t.ink2} /></Pressable>
    <Pressable onPress={onSend} style={s.send}><Ionicons name="arrow-up" size={19} color="#fff" /></Pressable>
  </View>
}

export function EmptyState({ icon='sparkles-outline', title, body }: { icon?: keyof typeof Ionicons.glyphMap; title:string; body:string }) {
  const t=useTheme()
  return <View style={s.empty}>
    <View style={[s.emptyIcon,{backgroundColor:t.surface}]}><Ionicons name={icon} size={28} color={t.ink2} /></View>
    <Text style={[s.emptyTitle,{color:t.ink}]}>{title}</Text>
    <Text style={[s.emptyBody,{color:t.ink2}]}>{body}</Text>
  </View>
}

const s=StyleSheet.create({
  titleWrap:{gap:7,marginBottom:24}, eyebrow:{fontSize:11,fontWeight:'700',letterSpacing:1.2}, title:{fontSize:34,lineHeight:39,fontWeight:'700',letterSpacing:-1}, body:{fontSize:15,lineHeight:22,maxWidth:330},
  dot:{width:8,height:8,borderRadius:99}, card:{borderWidth:1,borderRadius:radius.card,padding:18}, section:{fontSize:11,fontWeight:'700',letterSpacing:1.05,textTransform:'uppercase',marginTop:28,marginBottom:8},
  row:{minHeight:66,flexDirection:'row',alignItems:'center',gap:12,borderBottomWidth:StyleSheet.hairlineWidth},iconBox:{width:38,height:38,borderRadius:12,alignItems:'center',justifyContent:'center'},rowTitle:{fontSize:16,fontWeight:'600'},rowSub:{fontSize:12,marginTop:3},trailing:{fontSize:13},
  ask:{minHeight:60,borderWidth:1,borderRadius:18,paddingLeft:14,paddingRight:7,flexDirection:'row',alignItems:'center',gap:9},input:{flex:1,fontSize:15,paddingVertical:13},send:{width:42,height:42,borderRadius:21,backgroundColor:'#F26B1D',alignItems:'center',justifyContent:'center'},
  empty:{alignItems:'center',paddingTop:64,paddingHorizontal:28},emptyIcon:{width:58,height:58,borderRadius:22,alignItems:'center',justifyContent:'center'},emptyTitle:{fontSize:22,fontWeight:'700',marginTop:18,textAlign:'center'},emptyBody:{fontSize:15,lineHeight:22,marginTop:8,textAlign:'center',maxWidth:300},
})
