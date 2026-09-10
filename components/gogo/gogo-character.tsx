'use client'

import { useId } from 'react'

export type GogoState = 'calm'|'listening'|'thinking'|'remembering'|'acting'|'watching'|'found'|'approval'|'secure'|'done'|'breathing'|'sleeping'

type Props = {
  state?: GogoState
  size?: number
  dark?: boolean
  animate?: boolean
  showStatus?: boolean
  className?: string
}

const EYES: Record<GogoState, 'closed'|'open'|'up'|'happy'|'flat'|'half'> = {
  calm:'closed', listening:'open', thinking:'up', remembering:'closed', acting:'open', watching:'half',
  found:'happy', approval:'open', secure:'closed', done:'happy', breathing:'closed', sleeping:'flat',
}

const ANIM: Record<GogoState,string> = {
  calm:'gogoBreath 5s ease-in-out infinite',
  listening:'gogoLean 3s ease-in-out infinite',
  thinking:'gogoBreath 4s ease-in-out infinite',
  remembering:'gogoBreath 4s ease-in-out infinite',
  acting:'gogoBob 1.1s ease-in-out infinite',
  watching:'none',
  found:'gogoBob 2.2s ease-in-out infinite',
  approval:'gogoBreath 4s ease-in-out infinite',
  secure:'gogoBreath 5s ease-in-out infinite',
  done:'gogoBreath 5s ease-in-out infinite',
  breathing:'gogoBreathDeep 8s ease-in-out infinite',
  sleeping:'gogoSway 7s ease-in-out infinite',
}

export function GogoCharacter({state='calm',size=72,dark=false,animate=true,showStatus,className=''}:Props){
  const rawId=useId().replace(/:/g,'')
  const bodyId=`gogo-body-${rawId}`
  const coreId=`gogo-core-${rawId}`
  const hairId=`gogo-hair-${rawId}`
  const eyes=EYES[state]
  const active=['listening','thinking','acting','watching','found','remembering'].includes(state)
  const status=showStatus ?? (active || state==='approval')
  const bodyStroke=dark?'rgba(255,255,255,.12)':'rgba(70,45,30,.10)'
  const ringStroke=dark?'#201B18':'#F5F3EE'

  return <span className={`inline-block shrink-0 leading-none ${className}`} style={{width:size,height:size}} aria-label={`Gogo — ${state}`} role="img">
    <svg viewBox="0 0 120 120" width="100%" height="100%" style={{overflow:'visible',display:'block'}}>
      <defs>
        <radialGradient id={bodyId} cx="40%" cy="30%" r="80%"><stop offset="0" stopColor="#FFFBF3"/><stop offset=".6" stopColor="#F3E7D3"/><stop offset="1" stopColor="#E4D3B9"/></radialGradient>
        <radialGradient id={coreId} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#FFB06A" stopOpacity=".95"/><stop offset=".55" stopColor="#EF7A27" stopOpacity=".55"/><stop offset="1" stopColor="#EF7A27" stopOpacity="0"/></radialGradient>
        <radialGradient id={hairId} cx="40%" cy="35%" r="75%"><stop offset="0" stopColor="#4A2E20"/><stop offset="1" stopColor="#2C1A13"/></radialGradient>
      </defs>

      {state==='breathing'&&<><circle cx="60" cy="70" r="50" fill="none" stroke="#EF7A27" strokeOpacity=".35" style={{transformBox:'fill-box',transformOrigin:'center',animation:animate?'gogoRing 8s ease-out infinite':'none'}}/><circle cx="60" cy="70" r="50" fill="none" stroke="#EF7A27" strokeOpacity=".22" style={{transformBox:'fill-box',transformOrigin:'center',animation:animate?'gogoRing 8s ease-out 4s infinite':'none'}}/></>}
      {state==='secure'&&<path d="M60 6 C80 14 96 16 108 18 C108 60 96 92 60 114 C24 92 12 60 12 18 C24 16 40 14 60 6Z" fill="#F6F1E8" fillOpacity={dark ? .08 : .55} stroke="#EF7A27" strokeOpacity=".5" strokeWidth="2.5" strokeDasharray="6 5" style={{transformBox:'fill-box',transformOrigin:'center',animation:animate?'gogoGlow 4s ease-in-out infinite':'none'}}/>}
      {state==='thinking'&&<g style={{transformBox:'fill-box',transformOrigin:'center',animation:animate?'gogoOrbit 6s linear infinite':'none'}}><circle cx="60" cy="16" r="3.2" fill="#EF7A27"/><circle cx="104" cy="60" r="2.4" fill="#EF7A27" fillOpacity=".7"/><circle cx="18" cy="72" r="1.8" fill="#EF7A27" fillOpacity=".5"/></g>}

      <g style={{transformBox:'fill-box',transformOrigin:'center 90%',animation:animate?ANIM[state]:'none',opacity:state==='sleeping'?.82:1}}>
        <g fill={`url(#${hairId})`}><circle cx="24" cy="52" r="9"/><circle cx="28" cy="40" r="10.5"/><circle cx="38" cy="30" r="11"/><circle cx="51" cy="23" r="11.5"/><circle cx="66" cy="22" r="12"/><circle cx="81" cy="28" r="11"/><circle cx="92" cy="39" r="10.5"/><circle cx="96" cy="52" r="9"/><circle cx="60" cy="32" r="13"/><circle cx="44" cy="40" r="10"/><circle cx="78" cy="38" r="10"/></g>
        <path d="M60 34 C84 34 100 52 101 76 C102 100 84 113 60 113 C36 113 18 100 19 76 C20 52 36 34 60 34Z" fill={`url(#${bodyId})`} stroke={bodyStroke} strokeWidth="1.5"/>
        <circle cx="60" cy="92" r="23" fill={`url(#${coreId})`} style={{animation:animate?`gogoGlow ${state==='remembering'||state==='found'?'1.6s':state==='sleeping'?'9s':'4s'} ease-in-out infinite`:'none'}}/>
        <circle cx="42" cy="72" r="4.5" fill="#EF7A27" fillOpacity=".18"/><circle cx="78" cy="72" r="4.5" fill="#EF7A27" fillOpacity=".18"/>

        {eyes==='closed'&&<path d="M43 63 q5 4 10 0 M67 63 q5 4 10 0" fill="none" stroke="#2C1A13" strokeWidth="2.6" strokeLinecap="round"/>}
        {(eyes==='open'||eyes==='up')&&<><circle cx="48" cy={eyes==='up'?60:64} r={state==='listening'?3.8:3.3} fill="#2C1A13"/><circle cx="72" cy={eyes==='up'?60:64} r={state==='listening'?3.8:3.3} fill="#2C1A13"/><circle cx="49.2" cy={eyes==='up'?58.8:62.8} r="1" fill="#FFFBF3"/><circle cx="73.2" cy={eyes==='up'?58.8:62.8} r="1" fill="#FFFBF3"/></>}
        {eyes==='happy'&&<><path d="M43 65 q5 -5 10 0 M67 65 q5 -5 10 0" fill="none" stroke="#2C1A13" strokeWidth="2.6" strokeLinecap="round"/><path d="M55 74 q5 3 10 0" fill="none" stroke="#2C1A13" strokeWidth="2" strokeLinecap="round" strokeOpacity=".7"/></>}
        {eyes==='flat'&&<path d="M44 64 h8 M68 64 h8" fill="none" stroke="#2C1A13" strokeWidth="2.6" strokeLinecap="round"/>}
        {eyes==='half'&&<><circle cx="48" cy="64" r="3.2" fill="#2C1A13"/><circle cx="72" cy="64" r="3.2" fill="#2C1A13"/><path d="M43 61 h10 M67 61 h10" stroke="#F3E7D3" strokeWidth="3.2" strokeLinecap="round"/></>}

        {(state==='breathing'||state==='calm')&&<><ellipse cx="30" cy="98" rx="7" ry="5" fill="#F3E7D3" stroke="#E4D3B9"/><ellipse cx="90" cy="98" rx="7" ry="5" fill="#F3E7D3" stroke="#E4D3B9"/></>}
        {state==='acting'&&<ellipse cx="96" cy="72" rx="6" ry="7.5" fill="#F3E7D3" stroke="#E4D3B9" style={{transformBox:'fill-box',transformOrigin:'bottom center',animation:animate?'gogoWave 1.2s ease-in-out infinite':'none'}}/>}
        {state==='approval'&&<g style={{transformBox:'fill-box',transformOrigin:'center',animation:animate?'gogoBob 3s ease-in-out infinite':'none'}}><rect x="38" y="86" width="44" height="28" rx="6" fill="#fff" stroke="#E4D3B9" strokeWidth="1.2"/><rect x="44" y="93" width="22" height="3" rx="1.5" fill="#2C1A13" fillOpacity=".75"/><rect x="44" y="100" width="14" height="3" rx="1.5" fill="#2C1A13" fillOpacity=".35"/><circle cx="73" cy="100" r="5" fill="#EF7A27"/><path d="M70.5 100 l2 2 l3.5 -4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></g>}
      </g>

      {state==='remembering'&&<g style={{transformBox:'fill-box',transformOrigin:'center',animation:animate?'gogoMemory 3.2s cubic-bezier(.4,0,.2,1) infinite':'none'}}><rect x="48" y="72" width="24" height="14" rx="4" fill="#fff" stroke="#EF7A27" strokeWidth="1.2"/><rect x="52" y="77" width="12" height="2.2" rx="1" fill="#EF7A27"/><rect x="52" y="81" width="8" height="2.2" rx="1" fill="#2C1A13" fillOpacity=".3"/></g>}
      {state==='found'&&<g style={{transformBox:'fill-box',transformOrigin:'center',animation:animate?'gogoSpark 3s ease-in-out infinite':'none'}}><path d="M98 18 l2.5 6 l6 2.5 l-6 2.5 l-2.5 6 l-2.5 -6 l-6 -2.5 l6 -2.5Z" fill="#EF7A27"/></g>}
      {state==='done'&&<><circle cx="98" cy="96" r="11" fill="#2FAE6A" stroke={ringStroke} strokeWidth="3"/><path d="M92.5 96 l4 4 l7.5 -8" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></>}
      {status&&<circle cx="98" cy="102" r="7" fill="#2FAE6A" stroke={ringStroke} strokeWidth="3" style={{animation:animate?'gogoPulse 2s ease-in-out infinite':'none'}}/>}
    </svg>
  </span>
}