import { useMemo, useState } from 'react'
import { Alert, Image, Linking, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'

const C = {
  bg: '#F6F0E8', paper: '#FFFDF9', ink: '#3A2418', muted: '#8C7769',
  line: 'rgba(58,36,24,.10)', orange: '#F47B20', orangeSoft: '#FFF0E4',
  cocoa: '#3A2519', mint: '#EAF8EF', blue: '#EDF7FF', lavender: '#F0EDFF',
}
const GOGO = 'https://app.askgogo.in/gogo-float.gif'

type Tab = 'home'|'today'|'memory'|'organize'|'you'

const NavButton = ({tab, active, icon, label, onPress}:{tab:Tab;active:Tab;icon:any;label:string;onPress:(t:Tab)=>void}) => (
  <Pressable onPress={()=>onPress(tab)} style={[s.navButton, active===tab && s.navActive]}>
    <Ionicons name={icon} size={21} color={active===tab ? C.orange : C.muted}/>
    <Text style={[s.navLabel, active===tab && {color:C.orange}]}>{label}</Text>
  </Pressable>
)

export default function App() {
  const [tab,setTab] = useState<Tab>('home')
  const [chatOpen,setChatOpen] = useState(false)
  const [message,setMessage] = useState('')
  const [sent,setSent] = useState<string[]>([])

  const changeTab=(t:Tab)=>{ Haptics.selectionAsync(); setTab(t) }
  const send=()=>{
    const v=message.trim(); if(!v) return
    setSent(x=>[...x,v]); setMessage(''); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  return <SafeAreaView style={s.safe}>
    <View style={s.app}>
      <View style={s.topbar}>
        <View style={s.brandRow}><Image source={{uri:GOGO}} style={s.logo}/><Text style={s.brand}>AskGogo</Text></View>
        <View style={s.topActions}><Pressable style={s.circleBtn}><Ionicons name="moon-outline" size={18} color={C.muted}/></Pressable><Pressable style={s.circleBtn}><Ionicons name="ellipsis-horizontal" size={18} color={C.muted}/></Pressable></View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {tab==='home' && <Home onChat={()=>setChatOpen(true)} />}
        {tab==='today' && <Today />}
        {tab==='memory' && <Memory />}
        {tab==='organize' && <Organize />}
        {tab==='you' && <You />}
      </ScrollView>

      <Pressable onPress={()=>setChatOpen(true)} style={s.gogoFab}><Image source={{uri:GOGO}} style={s.gogoFabImage}/></Pressable>

      <View style={s.bottomNav}>
        <NavButton tab="home" active={tab} icon="home-outline" label="Home" onPress={changeTab}/>
        <NavButton tab="today" active={tab} icon="calendar-outline" label="Today" onPress={changeTab}/>
        <NavButton tab="memory" active={tab} icon="albums-outline" label="Memory" onPress={changeTab}/>
        <NavButton tab="organize" active={tab} icon="grid-outline" label="Organise" onPress={changeTab}/>
        <NavButton tab="you" active={tab} icon="person-outline" label="You" onPress={changeTab}/>
      </View>
    </View>

    <Modal visible={chatOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>setChatOpen(false)}>
      <SafeAreaView style={s.chatSafe}>
        <View style={s.chatHead}><Image source={{uri:GOGO}} style={s.chatAvatar}/><View><Text style={s.chatTitle}>Gogo</Text><Text style={s.chatSub}>● same memory · private to you</Text></View><Pressable style={s.close} onPress={()=>setChatOpen(false)}><Ionicons name="close" size={20}/></Pressable></View>
        <ScrollView contentContainerStyle={s.messages}>
          <Bubble gogo>Good afternoon. I’ve got your day and your memory here. What do you want off your mind?</Bubble>
          <Bubble>Remind me Friday at 8 AM to book the New York hotel.</Bubble>
          <Bubble gogo>Done ✓  Hotel booking · Friday · 8:00 AM</Bubble>
          {sent.map((x,i)=><Bubble key={i}>{x}</Bubble>)}
          {sent.map((_,i)=><Bubble gogo key={'g'+i}>Got it. I’ll keep that with the same AskGogo memory.</Bubble>)}
        </ScrollView>
        <View style={s.chatInputRow}><Pressable style={s.attach}><Ionicons name="add" size={22}/></Pressable><TextInput value={message} onChangeText={setMessage} placeholder="Message Gogo naturally…" style={s.chatInput} returnKeyType="send" onSubmitEditing={send}/><Pressable onPress={send} style={s.mic}><Ionicons name={message.trim()?'arrow-up':'mic'} size={19} color="white"/></Pressable></View>
      </SafeAreaView>
    </Modal>
  </SafeAreaView>
}

function Home({onChat}:{onChat:()=>void}){
  return <>
    <View style={s.hero}>
      <Text style={s.eyebrow}>● EVERYTHING IS CONNECTED</Text>
      <Text style={s.heroTitle}>Good afternoon, Gogo.</Text>
      <Text style={s.heroText}>Your day, memory and loose ends are already here. Tell Gogo what matters.</Text>
      <Image source={{uri:GOGO}} style={s.heroGogo}/>
      <Pressable onPress={onChat} style={s.askbar}><Text style={s.askPlaceholder}>Ask Gogo anything…</Text><View style={s.askSend}><Ionicons name="arrow-up" size={18} color="white"/></View></Pressable>
    </View>
    <Section title="Do it quickly" right="same memory everywhere"/>
    <View style={s.quickRow}>
      <Quick icon="bulb-outline" title="Remember" sub="save anything"/>
      <Quick icon="alarm-outline" title="Remind" sub="one-time / repeat"/>
      <Quick icon="scan-outline" title="Scan" sub="photo / PDF"/>
      <Quick icon="mic-outline" title="Speak" sub="voice action"/>
    </View>
    <Section title="Your second brain" right="now"/>
    <View style={s.darkCard}><View style={{flex:1}}><Text style={s.darkTitle}>Nothing urgent is slipping.</Text><Text style={s.darkText}>Your next event is at 2:00 PM. One reminder is due before then.</Text><View style={s.pillRow}><Pill dark>1 reminder</Pill><Pill dark>3 events</Pill><Pill dark>23 memories</Pill></View></View><Text style={{fontSize:27}}>☀</Text></View>
    <View style={s.twoCols}><Mini title="Memory found" sub="Passport · expires Oct 2033"/><Mini title="Travel ready" sub="BLR → Dubai · Fri 09:15"/></View>
  </>
}

function Today(){
  const events=[['10:00 AM','Call Mom','Reminder · 1 follow-up nudge'],['11:30 AM','Product review','Google Calendar · 45 min'],['2:00 PM','Tipplr onboarding call','Calendar · Bengaluru'],['6:00 PM','Drink water','Recurring reminder']]
  return <><Text style={s.kicker}>TUESDAY · YOUR DAILY BRIEF</Text><Text style={s.pageTitle}>Your day, already organised.</Text><View style={s.darkCard}><View><Text style={s.darkTitle}>29° · Sunny</Text><Text style={s.darkText}>Bengaluru · no travel disruption detected</Text></View><Text style={{fontSize:28}}>☀</Text></View><Section title="What matters today" right="4 items"/><View style={s.card}>{events.map((e,i)=><View key={i} style={s.event}><View style={s.dot}/><View><Text style={s.eventTime}>{e[0]}</Text><Text style={s.eventTitle}>{e[1]}</Text><Text style={s.eventSub}>{e[2]}</Text></View></View>)}</View><View style={s.softCard}><Text style={s.kicker}>GOGO NOTICED</Text><Text style={s.cardTitle}>Your passport is fine.</Text><Text style={s.cardText}>Expiry is October 2033. I’ll bring it back when it becomes relevant.</Text></View></>
}

function Memory(){
  const items=[['🛂','Passport','Expiry · October 2033'],['📄','Leave & License','ASPIRE COWORKS · ends 04 Jul 2027'],['✈','Dubai flight','BLR → DXB · 09:15'],['🔗','Christopher Ward watch','Saved product link + note']]
  return <><Text style={s.kicker}>YOUR SECOND BRAIN</Text><Text style={s.pageTitle}>Find it the way you remember it.</Text><View style={s.search}><Ionicons name="search-outline" size={18} color={C.muted}/><Text style={s.searchText}>Ask “where is my lease?”</Text></View><View style={s.categoryGrid}><Category bg="#FFF5EA" icon="document-text-outline" title="Documents" sub="12 saved"/><Category bg={C.blue} icon="people-outline" title="People & context" sub="8 remembered"/><Category bg={C.lavender} icon="airplane-outline" title="Travel" sub="4 trips"/><Category bg={C.mint} icon="link-outline" title="Links & notes" sub="19 saved"/></View><Section title="Recent memory" right="semantic, not folders"/><View style={s.card}>{items.map((x,i)=><View key={i} style={s.memoryItem}><View style={s.memIcon}><Text>{x[0]}</Text></View><View style={{flex:1}}><Text style={s.itemTitle}>{x[1]}</Text><Text style={s.itemSub}>{x[2]}</Text></View></View>)}</View></>
}

function Organize(){
  const tasks=[['Send investor update','Today · 4:30 PM'],['Follow up with Srinivas','Tomorrow · 10:00 AM'],['Book hotel in New York','Before Sep 25']]
  return <><Text style={s.kicker}>ORGANISE WITHOUT ORGANISING</Text><Text style={s.pageTitle}>Gogo keeps the structure.</Text><View style={s.segment}><Text style={s.segmentOn}>Tasks</Text><Text style={s.segmentOff}>Lists</Text><Text style={s.segmentOff}>Calendar</Text></View><View style={s.card}>{tasks.map((t,i)=><View key={i} style={s.task}><View style={s.check}/><View><Text style={s.itemTitle}>{t[0]}</Text><Text style={s.itemSub}>{t[1]}</Text></View></View>)}</View><Section title="Lists" right="shared everywhere"/><View style={s.twoCols}><Mini title="Groceries · 6" sub="Milk · fruit · coffee…"/><Mini title="NY trip · 9" sub="Watch · hotel · meetings…"/></View><Section title="This week" right="calendar"/><View style={s.card}><View style={s.week}>{['M 7','T 8','W 9','T 10','F 11','S 12','S 13'].map((d,i)=><View key={i} style={[s.day,i===1&&s.dayOn]}><Text style={[s.dayText,i===1&&{color:C.orange,fontWeight:'800'}]}>{d}</Text></View>)}</View></View></>
}

function You(){
  return <><View style={s.profile}><Image source={{uri:GOGO}} style={s.profileGogo}/><Text style={s.profileName}>Gogo</Text><Text style={s.profileSub}>One account · WhatsApp + web + mobile</Text><View style={s.plan}><Text style={s.planText}>✦ Power · ₹499/month</Text></View></View><Section title="Your Gogo" right="make it yours"/><View style={s.card}><Menu icon="school-outline" title="Learn with Gogo" sub="3 of 16 lessons explored"/><Menu icon="people-circle-outline" title="Your Circle" sub="People you remind and share with"/><Menu icon="cafe-outline" title="Personalise Gogo" sub="Calm companion · coffee"/><Menu icon="git-merge-outline" title="Integrations" sub="Calendar · Gmail · CreditIQ"/><Menu icon="card-outline" title="Usage & plan" sub="Power · manage subscription"/><Menu icon="lock-closed-outline" title="Privacy & memory controls" sub="Masked by default · delete anytime"/></View><Pressable onPress={()=>Linking.openURL('https://app.askgogo.in/dashboard/learn')} style={s.linkBtn}><Text style={s.linkBtnText}>Open current Learn with Gogo →</Text></Pressable></>
}

function Section({title,right}:{title:string;right?:string}){return <View style={s.section}><Text style={s.sectionTitle}>{title}</Text><Text style={s.sectionRight}>{right}</Text></View>}
function Quick({icon,title,sub}:{icon:any;title:string;sub:string}){return <Pressable onPress={()=>Haptics.selectionAsync()} style={s.quick}><View style={s.quickIcon}><Ionicons name={icon} size={18} color={C.orange}/></View><Text style={s.quickTitle}>{title}</Text><Text style={s.quickSub}>{sub}</Text></Pressable>}
function Pill({children,dark}:{children:any;dark?:boolean}){return <View style={[s.pill,dark&&s.pillDark]}><Text style={[s.pillText,dark&&{color:'white'}]}>{children}</Text></View>}
function Mini({title,sub}:{title:string;sub:string}){return <View style={s.mini}><Text style={s.itemTitle}>{title}</Text><Text style={s.itemSub}>{sub}</Text></View>}
function Category({bg,icon,title,sub}:{bg:string;icon:any;title:string;sub:string}){return <View style={[s.category,{backgroundColor:bg}]}><Ionicons name={icon} size={21} color={C.ink}/><Text style={s.catTitle}>{title}</Text><Text style={s.itemSub}>{sub}</Text></View>}
function Menu({icon,title,sub}:{icon:any;title:string;sub:string}){return <Pressable style={s.menu} onPress={()=>Alert.alert(title,'This native module is part of the first app build and will be connected to the existing AskGogo API.') }><View style={s.menuIcon}><Ionicons name={icon} size={18} color={C.orange}/></View><View style={{flex:1}}><Text style={s.itemTitle}>{title}</Text><Text style={s.itemSub}>{sub}</Text></View><Ionicons name="chevron-forward" size={18} color="#B5A397"/></Pressable>}
function Bubble({children,gogo}:{children:any;gogo?:boolean}){return <View style={[s.bubble,gogo?s.gogoBubble:s.meBubble]}><Text style={[s.bubbleText,!gogo&&{color:'white'}]}>{children}</Text></View>}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg},app:{flex:1,backgroundColor:C.bg},topbar:{height:58,paddingHorizontal:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brandRow:{flexDirection:'row',alignItems:'center',gap:8},logo:{width:30,height:30},brand:{fontFamily:'serif',fontSize:20,fontWeight:'700',color:C.ink},topActions:{flexDirection:'row',gap:8},circleBtn:{width:34,height:34,borderRadius:17,borderWidth:1,borderColor:C.line,backgroundColor:'rgba(255,255,255,.7)',alignItems:'center',justifyContent:'center'},content:{paddingHorizontal:16,paddingBottom:120},hero:{minHeight:238,borderRadius:28,backgroundColor:'#FFF9F3',padding:20,overflow:'hidden',borderWidth:1,borderColor:C.line},eyebrow:{fontSize:9,fontWeight:'800',letterSpacing:1.3,color:'#7C9A82'},heroTitle:{fontFamily:'serif',fontSize:31,fontWeight:'700',lineHeight:34,color:C.ink,marginTop:7,maxWidth:250},heroText:{fontSize:11.5,lineHeight:17,color:C.muted,maxWidth:235,marginTop:5},heroGogo:{position:'absolute',right:4,bottom:4,width:128,height:128},askbar:{position:'absolute',left:16,right:16,bottom:15,height:48,borderRadius:18,backgroundColor:'white',borderWidth:1,borderColor:C.line,flexDirection:'row',alignItems:'center',paddingLeft:14,paddingRight:7},askPlaceholder:{flex:1,fontSize:11,color:'#9E8B7E'},askSend:{width:35,height:35,borderRadius:13,backgroundColor:C.orange,alignItems:'center',justifyContent:'center'},section:{marginTop:18,marginBottom:10,paddingHorizontal:2,flexDirection:'row',justifyContent:'space-between',alignItems:'flex-end'},sectionTitle:{fontFamily:'serif',fontSize:20,fontWeight:'700',color:C.ink},sectionRight:{fontSize:9,color:C.muted},quickRow:{flexDirection:'row',gap:7},quick:{flex:1,minHeight:78,borderRadius:18,borderWidth:1,borderColor:C.line,backgroundColor:'rgba(255,255,255,.75)',padding:9},quickIcon:{width:29,height:29,borderRadius:10,backgroundColor:C.orangeSoft,alignItems:'center',justifyContent:'center',marginBottom:7},quickTitle:{fontSize:9.5,fontWeight:'800',color:C.ink},quickSub:{fontSize:7.5,color:C.muted,marginTop:2},darkCard:{borderRadius:22,backgroundColor:C.cocoa,padding:15,flexDirection:'row',gap:10},darkTitle:{fontFamily:'serif',fontSize:18,fontWeight:'700',color:'white'},darkText:{fontSize:10,lineHeight:15,color:'#D9C9BE',marginTop:4},pillRow:{flexDirection:'row',flexWrap:'wrap',gap:6,marginTop:10},pill:{paddingHorizontal:8,paddingVertical:5,borderRadius:999,backgroundColor:'#F3ECE5'},pillDark:{backgroundColor:'#574135'},pillText:{fontSize:8,color:C.ink},twoCols:{flexDirection:'row',gap:8},mini:{flex:1,padding:12,borderRadius:18,borderWidth:1,borderColor:C.line,backgroundColor:'white'},kicker:{fontSize:9,fontWeight:'800',letterSpacing:1.5,color:C.orange,marginTop:3},pageTitle:{fontFamily:'serif',fontSize:31,fontWeight:'700',lineHeight:34,color:C.ink,marginTop:5,marginBottom:14},card:{borderRadius:22,borderWidth:1,borderColor:C.line,backgroundColor:'rgba(255,255,255,.82)',padding:14},softCard:{borderRadius:22,borderWidth:1,borderColor:C.line,backgroundColor:'#FFF9F0',padding:15,marginTop:10},cardTitle:{fontFamily:'serif',fontSize:17,fontWeight:'700',color:C.ink,marginTop:4},cardText:{fontSize:10.5,lineHeight:16,color:C.muted,marginTop:3},event:{flexDirection:'row',gap:12,paddingBottom:17,position:'relative'},dot:{width:8,height:8,borderRadius:4,backgroundColor:C.orange,marginTop:6},eventTime:{fontSize:8.5,color:C.muted,fontWeight:'800'},eventTitle:{fontSize:11,fontWeight:'800',color:C.ink,marginTop:2},eventSub:{fontSize:9,color:C.muted,marginTop:1},search:{height:48,borderRadius:17,backgroundColor:'white',borderWidth:1,borderColor:C.line,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:14,marginBottom:10},searchText:{fontSize:11,color:C.muted},categoryGrid:{flexDirection:'row',flexWrap:'wrap',gap:9},category:{width:'48.5%',minHeight:104,borderRadius:20,borderWidth:1,borderColor:C.line,padding:14},catTitle:{fontSize:11.5,fontWeight:'800',color:C.ink,marginTop:18},memoryItem:{flexDirection:'row',alignItems:'center',gap:11,paddingVertical:11,borderBottomWidth:1,borderBottomColor:C.line},memIcon:{width:38,height:38,borderRadius:13,backgroundColor:C.orangeSoft,alignItems:'center',justifyContent:'center'},itemTitle:{fontSize:11,fontWeight:'800',color:C.ink},itemSub:{fontSize:8.5,color:C.muted,marginTop:2},segment:{flexDirection:'row',gap:5,backgroundColor:'#EEE5DD',padding:4,borderRadius:14,marginBottom:11},segmentOn:{flex:1,textAlign:'center',backgroundColor:'white',borderRadius:11,paddingVertical:8,fontSize:9,fontWeight:'800',color:C.ink},segmentOff:{flex:1,textAlign:'center',paddingVertical:8,fontSize:9,fontWeight:'800',color:C.muted},task:{flexDirection:'row',gap:10,paddingVertical:11,borderBottomWidth:1,borderBottomColor:C.line},check:{width:21,height:21,borderRadius:7,borderWidth:1.5,borderColor:'#CBB9AB'},week:{flexDirection:'row',justifyContent:'space-between'},day:{width:38,height:42,borderRadius:13,alignItems:'center',justifyContent:'center'},dayOn:{backgroundColor:C.orangeSoft},dayText:{fontSize:9,color:C.muted},profile:{borderRadius:22,borderWidth:1,borderColor:C.line,backgroundColor:'white',alignItems:'center',padding:18},profileGogo:{width:76,height:76},profileName:{fontFamily:'serif',fontSize:27,fontWeight:'700',color:C.ink},profileSub:{fontSize:9.5,color:C.muted,marginTop:2},plan:{backgroundColor:C.cocoa,borderRadius:999,paddingHorizontal:12,paddingVertical:7,marginTop:10},planText:{fontSize:9,color:'white',fontWeight:'800'},menu:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:12,borderBottomWidth:1,borderBottomColor:C.line},menuIcon:{width:36,height:36,borderRadius:12,backgroundColor:C.orangeSoft,alignItems:'center',justifyContent:'center'},linkBtn:{marginTop:12,height:48,borderRadius:16,backgroundColor:C.cocoa,alignItems:'center',justifyContent:'center'},linkBtnText:{color:'white',fontSize:10,fontWeight:'800'},bottomNav:{position:'absolute',left:10,right:10,bottom:10,height:78,borderRadius:28,backgroundColor:'rgba(255,255,255,.95)',borderWidth:1,borderColor:C.line,flexDirection:'row',padding:7},navButton:{flex:1,borderRadius:19,alignItems:'center',justifyContent:'center',gap:3},navActive:{backgroundColor:C.orangeSoft},navLabel:{fontSize:7.5,fontWeight:'700',color:C.muted},gogoFab:{position:'absolute',right:17,bottom:96,width:62,height:62,borderRadius:31,backgroundColor:C.orange,padding:5,shadowColor:'#F47B20',shadowOpacity:.3,shadowRadius:12,shadowOffset:{width:0,height:8},elevation:9},gogoFabImage:{width:'100%',height:'100%'},chatSafe:{flex:1,backgroundColor:'#F7F0E8'},chatHead:{height:76,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:18,borderBottomWidth:1,borderBottomColor:C.line},chatAvatar:{width:45,height:45},chatTitle:{fontFamily:'serif',fontSize:19,fontWeight:'700',color:C.ink},chatSub:{fontSize:8.5,color:C.muted},close:{marginLeft:'auto',width:34,height:34,borderRadius:17,borderWidth:1,borderColor:C.line,backgroundColor:'white',alignItems:'center',justifyContent:'center'},messages:{padding:17},bubble:{maxWidth:'82%',paddingHorizontal:13,paddingVertical:11,borderRadius:17,marginBottom:9},gogoBubble:{backgroundColor:'white',borderWidth:1,borderColor:C.line,alignSelf:'flex-start'},meBubble:{backgroundColor:C.cocoa,alignSelf:'flex-end'},bubbleText:{fontSize:11,lineHeight:16,color:C.ink},chatInputRow:{marginHorizontal:14,marginBottom:14,height:52,borderRadius:18,backgroundColor:'white',borderWidth:1,borderColor:C.line,flexDirection:'row',alignItems:'center',paddingHorizontal:7,gap:8},attach:{width:34,height:34,borderRadius:12,backgroundColor:'#F4ECE5',alignItems:'center',justifyContent:'center'},chatInput:{flex:1,fontSize:11,color:C.ink},mic:{width:34,height:34,borderRadius:12,backgroundColor:C.orange,alignItems:'center',justifyContent:'center'}
})
