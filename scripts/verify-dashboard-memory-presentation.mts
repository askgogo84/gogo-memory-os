import { buildMemoryDisplayTitle } from '../lib/dashboard/memory'

const cases = [
  [
    { doc_type:'image', title:'The image shows a product for car care. It is a dashboard and tyre polish.', extracted:{}, mime:'image/jpeg' },
    false,
    'Car care product',
  ],
  [
    { doc_type:'image', title:'The document appears to be an official notice or guideline. It includes a list of documents or requirements.', extracted:{}, mime:'image/jpeg' },
    false,
    'Official notice / guideline',
  ],
  [
    { doc_type:'passport', title:'Passport AB1234567', extracted:{ assetType:'passport', fields:{ name:'Goverdhan M D' } }, mime:'application/pdf' },
    true,
    "Goverdhan M's Passport",
  ],
  [
    { doc_type:'image', title:'A very long generated sentence that keeps going with far too many words and should never become the visual headline on a memory card.', extracted:{}, mime:'image/jpeg' },
    false,
    'Saved image',
  ],
] as const

let failed = 0
for (const [doc, sensitive, expected] of cases) {
  const got = buildMemoryDisplayTitle(doc as any, sensitive)
  if (got !== expected) {
    failed++
    console.error(`✗ ${JSON.stringify(doc.title)} got=${JSON.stringify(got)} expected=${JSON.stringify(expected)}`)
  } else {
    console.log(`✓ ${JSON.stringify(doc.title)} → ${JSON.stringify(got)}`)
  }
}

if (failed) process.exit(1)
console.log('✅ Dashboard Memory presentation checks passed')
