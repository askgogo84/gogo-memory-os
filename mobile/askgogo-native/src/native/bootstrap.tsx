import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { useShareIntentContext } from 'expo-share-intent'
import { notificationPath, registerForGogoNotifications } from './notifications'

export default function NativeBootstrap(){
  const router=useRouter()
  const {hasShareIntent}=useShareIntentContext()

  useEffect(()=>{
    let alive=true
    const timer=setTimeout(()=>{
      registerForGogoNotifications().catch((err:any)=>console.log('GOGO_NOTIFICATION_BOOTSTRAP_SKIPPED',String(err?.message||err)))
    },1200)
    const responseSub=Notifications.addNotificationResponseReceivedListener(response=>{
      const path=notificationPath(response)
      if(path)router.push(path as never)
    })
    Notifications.getLastNotificationResponseAsync().then(response=>{
      if(!alive)return
      const path=notificationPath(response)
      if(path)router.push(path as never)
    }).catch(()=>{})
    return()=>{alive=false;clearTimeout(timer);responseSub.remove()}
  },[router])

  useEffect(()=>{
    if(hasShareIntent)router.push('/capture' as never)
  },[hasShareIntent,router])

  return null
}
