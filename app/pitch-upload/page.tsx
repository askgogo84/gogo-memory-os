'use client'

import { useState } from 'react'

const UPLOAD_KEY = 'AGP-2026-09-14-d570c78f1b0846c8915fcaa8e74e79c1'

export default function PitchUploadPage() {
  const [html, setHtml] = useState<File | null>(null)
  const [pptx, setPptx] = useState<File | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function upload(file: File, path: string, contentType: string) {
    const form = new FormData()
    form.append('file', file)
    form.append('path', path)
    form.append('contentType', contentType)
    const res = await fetch('/api/pitch-assets/upload', {
      method: 'POST',
      headers: { 'x-pitch-upload-key': UPLOAD_KEY },
      body: form,
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error || `Upload failed (${res.status})`)
    return json
  }

  async function run() {
    if (!html) return setStatus('Select the Claude HTML file first.')
    setBusy(true)
    setStatus('Uploading Claude HTML…')
    try {
      const htmlResult = await upload(html, 'askgogo-2026/AskGogo-Pitch-Deck.html', 'text/html')
      let pptxResult: any = null
      if (pptx) {
        setStatus('HTML uploaded. Uploading PowerPoint…')
        pptxResult = await upload(
          pptx,
          'askgogo-2026/AskGogo_Investor_Deck.pptx',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        )
      }
      setStatus(`Done. HTML: ${htmlResult.url}${pptxResult ? `\nPPT: ${pptxResult.url}` : ''}`)
    } catch (err: any) {
      setStatus(`Error: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{minHeight:'100vh',background:'#F5F3EE',color:'#2C1A13',display:'grid',placeItems:'center',padding:24,fontFamily:'Arial, sans-serif'}}>
      <section style={{width:'min(720px,100%)',background:'#fff',border:'1px solid #E7DED3',borderRadius:28,padding:32,boxShadow:'0 24px 70px rgba(44,26,19,.10)'}}>
        <div style={{fontSize:12,letterSpacing:'.14em',textTransform:'uppercase',color:'#EF7A27',fontWeight:700}}>Temporary AskGogo deck uploader</div>
        <h1 style={{fontFamily:'Georgia, serif',fontSize:40,lineHeight:1.05,margin:'12px 0'}}>Upload Claude's exact HTML deck</h1>
        <p style={{color:'#6B635D',lineHeight:1.55,marginBottom:28}}>Choose the <b>AskGogo Pitch Deck.html</b> file. You can also choose the investor PPT so the final pitch page can offer a download button.</p>

        <label style={{display:'block',fontWeight:700,marginBottom:8}}>Claude HTML</label>
        <input type="file" accept=".html,text/html" onChange={(e)=>setHtml(e.target.files?.[0] || null)} style={{width:'100%',padding:14,border:'1px solid #D9D0C5',borderRadius:14,marginBottom:22}} />

        <label style={{display:'block',fontWeight:700,marginBottom:8}}>PowerPoint (optional but recommended)</label>
        <input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={(e)=>setPptx(e.target.files?.[0] || null)} style={{width:'100%',padding:14,border:'1px solid #D9D0C5',borderRadius:14,marginBottom:22}} />

        <button disabled={busy || !html} onClick={run} style={{border:0,borderRadius:999,background:'#EF7A27',color:'#fff',fontWeight:800,fontSize:16,padding:'15px 24px',cursor:busy?'wait':'pointer',opacity:busy||!html?.7:1}}>{busy ? 'Uploading…' : 'Upload deck'}</button>
        {status && <pre style={{whiteSpace:'pre-wrap',marginTop:22,background:'#F8F5F0',borderRadius:14,padding:16,fontSize:13,lineHeight:1.5}}>{status}</pre>}
      </section>
    </main>
  )
}
