import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio'
import { useShareIntentContext } from 'expo-share-intent'
import { agentApi, type NativeCaptureInput, type NativeCaptureResult } from '../src/agent/api'
import { hasMobileSession } from '../src/auth/session'

const C={bg:'#F6F0E8',paper:'#FFFDF9',ink:'#3A2418',muted:'#8C7769',line:'#E5DAD0',orange:'#F47B20',dark:'#3A2519',mint:'#EAF8EF',blue:'#EDF7FF',lav:'#F0EDFF',red:'#A43B2E'}

type Output={title:string;text:string;good?:boolean}

export default function CaptureAndShare(){
  const router=useRouter()
  const recorder=useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recorderState=useAudioRecorderState(recorder,250)
  const {hasShareIntent,shareIntent,resetShareIntent,error:shareError}=useShareIntentContext()
  const [linked,setLinked]=useState<boolean|null>(null)
  const [busy,setBusy]=useState(false)
  const [caption,setCaption]=useState('')
  const [error,setError]=useState('')
  const [output,setOutput]=useState<Output|null>(null)

  useEffect(()=>{hasMobileSession().then(setLinked).catch(()=>setLinked(false))},[])
  useEffect(()=>{setAudioModeAsync({playsInSilentMode:true,allowsRecording:true}).catch(()=>{})},[])

  const shared=shareIntent as any
  const sharedFiles=Array.isArray(shared?.files)?shared.files:[]
  const sharedText=String(shared?.text||shared?.webUrl||'').trim()
  const shareSummary=useMemo(()=>{
    if(sharedFiles.length)return `${sharedFiles.length} shared file${sharedFiles.length===1?'':'s'} · ${sharedFiles[0]?.fileName||sharedFiles[0]?.mimeType||'file'}`
    if(sharedText)return sharedText.slice(0,180)
    return ''
  },[sharedFiles,sharedText])

  async function runUpload(input:NativeCaptureInput,source:string){
    setBusy(true);setError('');setOutput(null)
    try{
      const result=await agentApi.capture({...input,caption:caption.trim()})
      await handleCaptureResult(result,source)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      return true
    }catch(e:any){setError(e?.message||'Gogo could not process that capture.');await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);return false}
    finally{setBusy(false)}
  }

  async function handleCaptureResult(result:NativeCaptureResult,source:string){
    if(result.kind==='voice'){
      const agent=await agentApi.run(result.transcript,{source,screen:'capture'})
      setOutput({title:'Voice understood',text:`“${result.transcript}”\n\n${agent.text||agent.blockedReason||`${agent.capability} · ${agent.status}`}`,good:agent.status==='completed'})
      return
    }
    setOutput({title:result.title,text:`${result.summary}${result.expiresOn?`\n\nExpiry detected · ${result.expiresOn}`:''}\n\nSaved privately to AskGogo Memory.`,good:true})
  }

  async function startVoice(){
    if(busy||recorderState.isRecording)return
    setError('');setOutput(null)
    try{
      const permission=await AudioModule.requestRecordingPermissionsAsync()
      if(!permission.granted){setError('Microphone permission is needed to record a Gogo voice command.');return}
      await setAudioModeAsync({playsInSilentMode:true,allowsRecording:true})
      await recorder.prepareToRecordAsync()
      recorder.record()
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    }catch(e:any){setError(e?.message||'Could not start recording.')}
  }

  async function stopVoice(){
    if(!recorderState.isRecording)return
    try{
      await recorder.stop()
      await Haptics.selectionAsync()
      const uri=recorder.uri
      if(!uri){setError('The voice recording was not saved. Please try again.');return}
      await runUpload({uri,name:`gogo-voice-${Date.now()}.m4a`,type:'audio/mp4'},'native_voice')
    }catch(e:any){setError(e?.message||'Could not finish the voice note.')}
  }

  async function camera(){
    if(busy)return
    const permission=await ImagePicker.requestCameraPermissionsAsync()
    if(!permission.granted){setError('Camera permission is needed to scan a document.');return}
    const result=await ImagePicker.launchCameraAsync({mediaTypes:['images'],quality:.9,allowsEditing:false})
    if(result.canceled)return
    const a=result.assets[0];if(!a)return
    await runUpload({uri:a.uri,name:a.fileName||`gogo-scan-${Date.now()}.jpg`,type:a.mimeType||'image/jpeg'},'native_camera')
  }

  async function photo(){
    if(busy)return
    const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:.9,allowsEditing:false})
    if(result.canceled)return
    const a=result.assets[0];if(!a)return
    await runUpload({uri:a.uri,name:a.fileName||`gogo-photo-${Date.now()}.jpg`,type:a.mimeType||'image/jpeg'},'native_photo')
  }

  async function file(){
    if(busy)return
    const result=await DocumentPicker.getDocumentAsync({type:['application/pdf','image/*','text/*','application/json','text/csv','audio/*'],copyToCacheDirectory:true,multiple:false})
    if(result.canceled)return
    const a=result.assets[0];if(!a)return
    await runUpload({uri:a.uri,name:a.name||'gogo-file',type:a.mimeType||guessMime(a.name)},'native_file')
  }

  function normalizePath(path:string){return path.startsWith('/')?`file://${path}`:path}

  async function saveShared(){
    if(!hasShareIntent||busy)return
    setBusy(true);setError('');setOutput(null)
    try{
      if(sharedFiles.length){
        const f=sharedFiles[0]
        const ok=await runUpload({uri:normalizePath(String(f.path||'')),name:String(f.fileName||'shared-file'),type:String(f.mimeType||guessMime(f.fileName||''))},'os_share_file')
        if(ok)resetShareIntent()
        return
      }
      if(sharedText){
        const result=await agentApi.run(`Remember this shared item in my memory:\n${sharedText}`,{source:'os_share_text',shareTitle:String(shared?.meta?.title||'')})
        setOutput({title:'Shared item sent to Gogo',text:result.text||'Saved to your AskGogo Memory.',good:result.status==='completed'})
        resetShareIntent();await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        return
      }
      setError('The shared item did not contain readable text or a supported file.')
    }catch(e:any){setError(e?.message||'Could not save the shared item.')}
    finally{setBusy(false)}
  }

  if(linked===null)return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color={C.orange}/><Text style={s.muted}>Opening Capture & Share…</Text></View></SafeAreaView>
  if(!linked)return <SafeAreaView style={s.safe}><View style={s.center}><View style={s.bigIcon}><Ionicons name="link-outline" size={28} color={C.orange}/></View><Text style={s.hero}>Connect AskGogo first.</Text><Text style={s.bodyCenter}>Your shared item stays pending. Link this app to the same AskGogo you use on WhatsApp, then come back here.</Text><Pressable onPress={()=>router.push('/connect' as never)} style={s.primaryWide}><Text style={s.primaryText}>Connect WhatsApp account</Text></Pressable></View></SafeAreaView>

  return <SafeAreaView style={s.safe}>
    <View style={s.header}><Pressable onPress={()=>router.back()} style={s.icon}><Ionicons name="chevron-back" size={19} color={C.ink}/></Pressable><View style={{flex:1}}><Text style={s.title}>Capture & Share</Text><Text style={s.sub}>Voice · camera · files · share sheet</Text></View></View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.heroCard}><Text style={s.kicker}>SEND ANYTHING TO GOGO</Text><Text style={s.heroLight}>Speak it. Scan it. Share it.</Text><Text style={s.heroBody}>Voice commands return through the same Agent OS. Documents are stored in your private AskGogo Memory and become searchable.</Text></View>

      {hasShareIntent&&<View style={s.shareCard}><View style={s.row}><View style={[s.box,{backgroundColor:C.lav}]}><Ionicons name="share-social" size={19} color="#6658B5"/></View><View style={{flex:1}}><Text style={s.cardTitle}>Incoming share</Text><Text style={s.cardText}>{shareSummary||'A shared item is waiting.'}</Text></View></View><View style={s.shareActions}><Pressable disabled={busy} onPress={()=>{resetShareIntent();setOutput(null)}} style={s.secondary}><Text style={s.secondaryText}>Discard</Text></Pressable><Pressable disabled={busy} onPress={saveShared} style={s.primary}>{busy?<ActivityIndicator size="small" color="white"/>:<Text style={s.primaryText}>Save with Gogo</Text>}</Pressable></View></View>}
      {!!shareError&&!hasShareIntent&&<Text style={s.error}>Share receiver: {String((shareError as any)?.message||shareError)}</Text>}

      <Text style={s.label}>OPTIONAL NOTE FOR THIS CAPTURE</Text>
      <TextInput value={caption} onChangeText={setCaption} placeholder="e.g. This is my passport renewal letter" placeholderTextColor="#A49387" style={s.input} maxLength={1200}/>

      <View style={s.grid}>
        <Pressable onPress={recorderState.isRecording?stopVoice:startVoice} disabled={busy} style={[s.tool,recorderState.isRecording&&s.recording]}><View style={[s.toolIcon,{backgroundColor:recorderState.isRecording?'#FFF0EC':C.orange+'18'}]}><Ionicons name={recorderState.isRecording?'stop':'mic'} size={24} color={recorderState.isRecording?C.red:C.orange}/></View><Text style={s.toolTitle}>{recorderState.isRecording?'Stop & send':'Voice to Gogo'}</Text><Text style={s.toolText}>{recorderState.isRecording?`${Math.max(1,Math.round(recorderState.durationMillis/1000))} sec · tap to finish`:'Speak naturally in English or Indian languages.'}</Text></Pressable>
        <Pressable onPress={camera} disabled={busy||recorderState.isRecording} style={s.tool}><View style={[s.toolIcon,{backgroundColor:C.blue}]}><Ionicons name="camera" size={24} color="#4775A8"/></View><Text style={s.toolTitle}>Scan document</Text><Text style={s.toolText}>Tickets, IDs, notes, receipts and paperwork.</Text></Pressable>
        <Pressable onPress={photo} disabled={busy||recorderState.isRecording} style={s.tool}><View style={[s.toolIcon,{backgroundColor:C.mint}]}><Ionicons name="images" size={23} color="#39815D"/></View><Text style={s.toolTitle}>Choose photo</Text><Text style={s.toolText}>Read an existing screenshot or image.</Text></Pressable>
        <Pressable onPress={file} disabled={busy||recorderState.isRecording} style={s.tool}><View style={[s.toolIcon,{backgroundColor:C.lav}]}><Ionicons name="document-attach" size={23} color="#6658B5"/></View><Text style={s.toolTitle}>PDF or file</Text><Text style={s.toolText}>PDF, text, CSV, JSON or audio up to 24 MB.</Text></Pressable>
      </View>

      {busy&&!hasShareIntent&&<View style={s.working}><ActivityIndicator color={C.orange}/><View><Text style={s.cardTitle}>Gogo is processing it…</Text><Text style={s.cardText}>You’ll see the transcript or saved-document summary here.</Text></View></View>}
      {!!error&&<View style={s.errorCard}><Ionicons name="alert-circle-outline" size={19} color={C.red}/><Text style={s.errorText}>{error}</Text></View>}
      {output&&<View style={[s.output,output.good&&{backgroundColor:C.mint}]}><Ionicons name={output.good?'checkmark-circle':'sparkles'} size={22} color={output.good?'#2E9B67':C.orange}/><View style={{flex:1}}><Text style={s.cardTitle}>{output.title}</Text><Text style={s.outputText}>{output.text}</Text></View></View>}

      <View style={s.privacy}><Ionicons name="shield-checkmark-outline" size={18} color="#39815D"/><Text style={s.privacyText}><Text style={{fontWeight:'900'}}>Private by default.</Text> Files go to AskGogo’s existing private document store. Shared items are not acted on until you press Save. Consequential Agent actions still use Safe Mode and approvals.</Text></View>
    </ScrollView>
  </SafeAreaView>
}

function guessMime(name:string){const n=String(name||'').toLowerCase();if(n.endsWith('.pdf'))return'application/pdf';if(n.endsWith('.png'))return'image/png';if(n.endsWith('.jpg')||n.endsWith('.jpeg'))return'image/jpeg';if(n.endsWith('.webp'))return'image/webp';if(n.endsWith('.csv'))return'text/csv';if(n.endsWith('.json'))return'application/json';if(n.endsWith('.txt')||n.endsWith('.md'))return'text/plain';if(n.endsWith('.m4a'))return'audio/mp4';if(n.endsWith('.mp3'))return'audio/mpeg';if(n.endsWith('.wav'))return'audio/wav';return'application/octet-stream'}

const s=StyleSheet.create({safe:{flex:1,backgroundColor:C.bg},center:{flex:1,alignItems:'center',justifyContent:'center',padding:26,gap:11},muted:{fontSize:11,color:C.muted},header:{height:68,paddingHorizontal:15,flexDirection:'row',gap:10,alignItems:'center',borderBottomWidth:1,borderBottomColor:C.line},icon:{width:38,height:38,borderRadius:15,backgroundColor:C.paper,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.line},title:{fontFamily:'serif',fontSize:20,fontWeight:'700',color:C.ink},sub:{fontSize:8.5,color:C.muted},content:{padding:16,paddingBottom:65},heroCard:{borderRadius:27,backgroundColor:C.dark,padding:19},kicker:{fontSize:8,fontWeight:'900',letterSpacing:1.25,color:'#F4A56D'},heroLight:{fontFamily:'serif',fontSize:29,lineHeight:34,fontWeight:'700',color:'white',marginTop:8},heroBody:{fontSize:10,lineHeight:16,color:'#D9C9BE',marginTop:7,maxWidth:320},shareCard:{marginTop:12,borderRadius:21,padding:14,backgroundColor:'#F8F5FF',borderWidth:1,borderColor:'#DDD7F4'},row:{flexDirection:'row',gap:10,alignItems:'flex-start'},box:{width:40,height:40,borderRadius:13,alignItems:'center',justifyContent:'center'},cardTitle:{fontSize:11,fontWeight:'800',color:C.ink},cardText:{fontSize:9,lineHeight:14,color:C.muted,marginTop:2},shareActions:{flexDirection:'row',gap:8,marginTop:12},secondary:{flex:1,minHeight:40,borderRadius:13,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center'},secondaryText:{fontSize:9,fontWeight:'800',color:C.ink},primary:{flex:1.25,minHeight:40,borderRadius:13,backgroundColor:C.dark,alignItems:'center',justifyContent:'center'},primaryWide:{minHeight:50,borderRadius:16,backgroundColor:C.dark,alignItems:'center',justifyContent:'center',paddingHorizontal:20,marginTop:8},primaryText:{fontSize:10,fontWeight:'900',color:'white'},label:{fontSize:8,fontWeight:'900',letterSpacing:1.05,color:C.muted,marginTop:18,marginBottom:7},input:{height:49,borderRadius:15,borderWidth:1,borderColor:C.line,backgroundColor:C.paper,paddingHorizontal:13,fontSize:11,color:C.ink},grid:{flexDirection:'row',flexWrap:'wrap',gap:9,marginTop:12},tool:{width:'48.5%',minHeight:158,borderRadius:21,padding:14,backgroundColor:C.paper,borderWidth:1,borderColor:C.line},recording:{borderColor:'#E3A199',backgroundColor:'#FFF9F7'},toolIcon:{width:48,height:48,borderRadius:16,alignItems:'center',justifyContent:'center'},toolTitle:{fontSize:11,fontWeight:'900',color:C.ink,marginTop:12},toolText:{fontSize:8.5,lineHeight:13,color:C.muted,marginTop:4},working:{marginTop:12,borderRadius:18,padding:13,backgroundColor:'#FFF8F0',flexDirection:'row',gap:10,alignItems:'center'},error:{fontSize:9,color:C.red,marginTop:10},errorCard:{marginTop:12,borderRadius:16,padding:12,backgroundColor:'#FFF0EC',flexDirection:'row',gap:8},errorText:{flex:1,fontSize:9,lineHeight:14,color:C.red},output:{marginTop:12,borderRadius:19,padding:14,backgroundColor:'#FFF8F0',flexDirection:'row',gap:9,alignItems:'flex-start'},outputText:{fontSize:9.5,lineHeight:15,color:C.ink,marginTop:4},privacy:{marginTop:17,borderRadius:18,padding:13,backgroundColor:'#EFF8F2',flexDirection:'row',gap:8,alignItems:'flex-start'},privacyText:{flex:1,fontSize:8.5,lineHeight:13,color:C.muted},bigIcon:{width:58,height:58,borderRadius:20,backgroundColor:'#FFF1E5',alignItems:'center',justifyContent:'center'},hero:{fontFamily:'serif',fontSize:27,fontWeight:'700',color:C.ink,textAlign:'center'},bodyCenter:{fontSize:11,lineHeight:17,color:C.muted,textAlign:'center',maxWidth:330}})
