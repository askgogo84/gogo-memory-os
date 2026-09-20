import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg'

export type GogoState = 'calm'|'listening'|'thinking'|'remembering'|'acting'|'watching'|'found'|'approval'|'secure'|'done'|'breathing'|'sleeping'

type Props={state?:GogoState;size?:number}
const BROWN='#2C1A13', CREAM='#F3E7D3', ORANGE='#EF7A27', GREEN='#2FAE6A', CHEEK='#F7C9A8'

export function Gogo({state='calm',size=72}:Props){
  const active=['listening','thinking','remembering','acting','watching'].includes(state)
  const happy=state==='found'||state==='done'
  const closed=['calm','secure','breathing'].includes(state)
  const flat=state==='sleeping'
  const half=state==='watching'
  return <Svg width={size} height={size} viewBox="0 0 120 120" accessibilityLabel={`Gogo ${state}`}>
    {state==='breathing'?<><Circle cx="60" cy="66" r="48" fill="none" stroke={ORANGE} strokeOpacity=".08" strokeWidth="2"/><Circle cx="60" cy="66" r="40" fill="none" stroke={ORANGE} strokeOpacity=".12" strokeWidth="2"/></>:null}
    <G fill={BROWN}>
      <Circle cx="24" cy="52" r="9"/><Circle cx="28" cy="40" r="10.5"/><Circle cx="38" cy="30" r="11"/><Circle cx="51" cy="23" r="11.5"/><Circle cx="66" cy="22" r="12"/><Circle cx="81" cy="28" r="11"/><Circle cx="92" cy="39" r="10.5"/><Circle cx="96" cy="52" r="9"/><Circle cx="60" cy="32" r="13"/>
    </G>
    <Path d="M60 34 C84 34 100 52 101 76 C102 100 84 113 60 113 C36 113 18 100 19 76 C20 52 36 34 60 34Z" fill={CREAM}/>
    <Circle cx="60" cy="92" r="20" fill={ORANGE} fillOpacity={state==='found'||state==='remembering'?'.95':'.75'}/>
    {size>=40?<><Circle cx="39" cy="77" r="5" fill={CHEEK} fillOpacity=".18"/><Circle cx="81" cy="77" r="5" fill={CHEEK} fillOpacity=".18"/></>:null}
    {happy?<><Path d="M42 62 q5 7 11 0" fill="none" stroke={BROWN} strokeWidth="2.6" strokeLinecap="round"/><Path d="M67 62 q5 7 11 0" fill="none" stroke={BROWN} strokeWidth="2.6" strokeLinecap="round"/></>:closed?<><Path d="M43 63 q5 4 10 0" fill="none" stroke={BROWN} strokeWidth="2.6" strokeLinecap="round"/><Path d="M67 63 q5 4 10 0" fill="none" stroke={BROWN} strokeWidth="2.6" strokeLinecap="round"/></>:flat?<><Line x1="43" y1="64" x2="53" y2="64" stroke={BROWN} strokeWidth="2.6" strokeLinecap="round"/><Line x1="67" y1="64" x2="77" y2="64" stroke={BROWN} strokeWidth="2.6" strokeLinecap="round"/></>:half?<><Path d="M43 64 q5 2 10 0" fill="none" stroke={BROWN} strokeWidth="2.6" strokeLinecap="round"/><Path d="M67 64 q5 2 10 0" fill="none" stroke={BROWN} strokeWidth="2.6" strokeLinecap="round"/></>:<><Circle cx="48" cy="63" r="2.8" fill={BROWN}/><Circle cx="72" cy="63" r="2.8" fill={BROWN}/></>}
    {happy?<Path d="M54 75 q6 5 12 0" fill="none" stroke={BROWN} strokeWidth="2.2" strokeLinecap="round"/>:null}
    {state==='thinking'?<><Circle cx="48" cy="100" r="2.6" fill={ORANGE}/><Circle cx="60" cy="104" r="2.6" fill={ORANGE}/><Circle cx="72" cy="100" r="2.6" fill={ORANGE}/></>:null}
    {state==='remembering'?<><Rect x="78" y="42" width="20" height="15" rx="4" fill="#FFFBF3" stroke={BROWN} strokeOpacity=".28"/><Line x1="82" y1="47" x2="93" y2="47" stroke={ORANGE} strokeWidth="2"/><Line x1="82" y1="52" x2="89" y2="52" stroke={BROWN} strokeOpacity=".4" strokeWidth="1.5"/></>:null}
    {state==='acting'?<><Path d="M86 88 C98 78 101 65 98 54" fill="none" stroke={CREAM} strokeWidth="11" strokeLinecap="round"/><Circle cx="98" cy="51" r="6" fill={CREAM}/></>:null}
    {state==='approval'?<><Path d="M30 88 C36 82 41 80 46 81" fill="none" stroke={CREAM} strokeWidth="9" strokeLinecap="round"/><Path d="M90 88 C84 82 79 80 74 81" fill="none" stroke={CREAM} strokeWidth="9" strokeLinecap="round"/><Rect x="43" y="72" width="34" height="24" rx="5" fill="#FFFBF3" stroke={BROWN} strokeOpacity=".22"/><Line x1="49" y1="80" x2="70" y2="80" stroke={ORANGE} strokeWidth="2"/><Line x1="49" y1="87" x2="65" y2="87" stroke={BROWN} strokeOpacity=".35" strokeWidth="1.5"/></>:null}
    {state==='secure'?<Path d="M60 45 L84 54 V70 C84 86 74 97 60 104 C46 97 36 86 36 70 V54 Z" fill="none" stroke={BROWN} strokeWidth="2" strokeDasharray="5 5" strokeOpacity=".55"/>:null}
    {state==='found'?<Path d="M91 45 l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={ORANGE}/>:null}
    {state==='done'?<><Circle cx="93" cy="92" r="10" fill={GREEN}/><Path d="M88 92 l4 4 7-8" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></>:null}
    {active?<Circle cx="99" cy="91" r="7" fill={GREEN}/>:null}
  </Svg>
}

export function stateForHome(state?:string):GogoState{
  if(state==='waiting')return 'approval'
  if(state==='working')return 'acting'
  if(state==='watching')return 'watching'
  if(state==='ready')return 'done'
  return 'calm'
}

export function stateForItem(kind?:string):GogoState{
  if(kind==='approval')return 'approval'
  if(kind==='working')return 'acting'
  if(kind==='watching')return 'watching'
  if(kind==='idea')return 'found'
  if(kind==='done')return 'done'
  return 'calm'
}
