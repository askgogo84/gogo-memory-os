'use client'

import { useState } from 'react'

const UPLOAD_KEY = 'AGP-2026-09-14-d570c78f1b0846c8915fcaa8e74e79c1'

export default function PitchUploadPage() {
  const [html, setHtml] = useState<File | null>(null)
  const [pptx, setPptx] = useState<File | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function upload(file: File, path: string, contentType: string) {
    const signRes = await fetch('/api/pitch-assets/upload', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pitch-upload-key': UPLOAD_KEY,
      },
      body: JSON.stringify({ path, contentType }),
    })

    const signText = await signRes.text()
    let signed: any = null
    try { signed = JSON.parse(signText) } catch {}
    if (!signRes.ok || !signed?.signedUrl) {
      throw new Error(signed?.error || signText || `Could not prepare upload (${signRes.status})`)
    }

    const form = new FormData()
    form.append('cacheControl', '0')
    form.append('', file)

    const uploadRes = await fetch(signed.signedUrl, {
      method: 'PUT',
      headers: { 'x-upsert': 'true' },
      body: form,
    })
    if (!uploadRes.ok) {
      const errorText = await uploadRes.text()
      throw new Error(errorText || `Direct upload failed (${uploadRes.status})`)
    }

    return signed
  }

  async function run() {
    if (!html) return setStatus('Select the HTML file first.')
    setBusy(true)
    setStatus('Uploading HTML directly to storage…')
    try {
      const htmlResult = await upload(html, 'askgogo-2026/AskGogo-Pitch-Deck.html', 'text/html')
      let pptxResult: any = null
      if (pptx) {
        setStatus('HTML uploaded. Uploading PowerPoint directly to storage…')
        pptxResult = await upload(
          pptx,
          'askgogo-2026/AskGogo_Investor_Deck.pptx',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        )
      }
      setStatus(`Done.\nHTML: ${htmlResult.url}${pptxResult ? `\nPPT: ${pptxResult.url}` : ''}\n\nNow open /pitch and hard refresh.`)
    } catch (err: any) {
      setStatus(`Error: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{minHeight:'100vh',background:'#F5F3EE',color:'#2C1A13',display:'grid',placeItems:'center',padding:24,fontFamily:'Arial, sans-serif'}}>
      <section style={{width:'min(720px,100%)',background:'#fff',border:'1px solid #E7DED3',borderRadius:28,padding:32,boxShadow:'0 24px 70px rgba(44,26,19,.10)'}}>
        <div style={{fontSize:12,letterSpacing:'.14em',textTransform:'uppercase',color:'#EF7A27',fontWeight:700}}>AskGogo pitch updater</div>
        <h1 style={{fontFamily:'Georgia, serif',fontSize:40,lineHeight:1.05,margin:'12px 0'}}>Upload the exact new deck</h1>
        <p style={{color:'#6B635D',lineHeight:1.55,marginBottom:28}}>Select the new HTML and matching PowerPoint. They upload directly to storage, so large deck files no longer pass through Vercel's request-body limit.</p>

        <label style={{display:'block',fontWeight:700,marginBottom:8}}>HTML deck</label>
        <input type="file" accept=".html,text/html" onChange={(e)=>setHtml(e.target.files?.[0] || null)} style={{width:'100%',padding:14,border:'1px solid #D9D0C5',borderRadius:14,marginBottom:22}} />

        <label style={{display:'block',fontWeight:700,marginBottom:8}}>PowerPoint</label>
        <input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={(e)=>setPptx(e.target.files?.[0] || null)} style={{width:'100%',padding:14,border:'1px solid #D9D0C5',borderRadius:14,marginBottom:22}} />

        <button disabled={busy || !html} onClick={run} style={{border:0,borderRadius:999,background:'#EF7A27',color:'#fff',fontWeight:800,fontSize:16,padding:'15px 24px',cursor:busy?'wait':'pointer',opacity:busy||!html?.7:1}}>{busy ? 'Uploading…' : 'Upload deck'}</button>
        {status && <pre style={{whiteSpace:'pre-wrap',marginTop:22,background:'#F8F5F0',borderRadius:14,padding:16,fontSize:13,lineHeight:1.5}}>{status}</pre>}
      </section>
    </main>
  )
}
