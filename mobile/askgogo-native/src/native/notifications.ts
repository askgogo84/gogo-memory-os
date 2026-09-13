import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { agentApi } from '../agent/api'
import { hasMobileSession } from '../auth/session'

const INSTALLATION_KEY='askgogo.mobile.installation_id.v1'

Notifications.setNotificationHandler({
  handleNotification:async()=>({
    shouldShowBanner:true,
    shouldShowList:true,
    shouldPlaySound:true,
    shouldSetBadge:false,
  }),
})

function makeInstallationId(){return `gogo-${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`}

export async function getInstallationId(){
  let id=await SecureStore.getItemAsync(INSTALLATION_KEY)
  if(id)return id
  id=makeInstallationId()
  await SecureStore.setItemAsync(INSTALLATION_KEY,id,{keychainAccessible:SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY})
  return id
}

export async function registerForGogoNotifications(){
  if(!(await hasMobileSession()))return {registered:false,reason:'no_session'} as const
  if(Platform.OS==='android'){
    await Notifications.setNotificationChannelAsync('gogo-updates',{
      name:'Gogo updates',
      importance:Notifications.AndroidImportance.HIGH,
      vibrationPattern:[0,220,120,220],
      lightColor:'#F47B20',
      sound:'default',
    })
  }
  const current=await Notifications.getPermissionsAsync()
  const requested=current.status==='granted'?current:await Notifications.requestPermissionsAsync()
  const permissionStatus=String(requested.status||'undetermined')
  let nativePushToken:string|null=null
  let expoPushToken:string|null=null
  if(permissionStatus==='granted'){
    try{
      const native=await Notifications.getDevicePushTokenAsync()
      nativePushToken=typeof native.data==='string'?native.data:JSON.stringify(native.data)
    }catch(err:any){console.log('GOGO_NATIVE_PUSH_TOKEN_UNAVAILABLE',String(err?.message||err))}
    const projectId=(Constants as any)?.expoConfig?.extra?.eas?.projectId ?? (Constants as any)?.easConfig?.projectId
    if(projectId){
      try{expoPushToken=(await Notifications.getExpoPushTokenAsync({projectId})).data}
      catch(err:any){console.log('GOGO_EXPO_PUSH_TOKEN_UNAVAILABLE',String(err?.message||err))}
    }
  }
  const installationId=await getInstallationId()
  await agentApi.registerDevice({installationId,expoPushToken,nativePushToken,permissionStatus})
  return {registered:true,permissionStatus,installationId,expoPushToken:Boolean(expoPushToken),nativePushToken:Boolean(nativePushToken)} as const
}

export function notificationPath(response:Notifications.NotificationResponse|null|undefined){
  const value=response?.notification?.request?.content?.data?.path
  return typeof value==='string'&&value.startsWith('/')?value:null
}
