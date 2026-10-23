// Make exports: a deck to PowerPoint (pptxgenjs), a sheet to Excel (xlsx, with a live SUM formula) or CSV.
import type { Deck, Sheet } from './documents'
import { sheetCsv, sheetTotal } from './documents'

const ACCENT = '2FB8A6', INK = '1F2937', MUTED = '6B7280'

export async function deckToPptx(deck: Deck): Promise<Buffer> {
  const PptxGenJS: any = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE' // 13.33 x 7.5 in
  pptx.title = deck.title
  pptx.company = 'Made with AskGogo'
  deck.slides.forEach((s, i) => {
    const slide = pptx.addSlide()
    slide.background = { color: 'FFFFFF' }
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: ACCENT }, line: { color: ACCENT } })
    if (i === 0) {
      slide.addText(s.kicker || 'Overview', { x: 0.8, y: 2.0, w: 11.5, h: 0.5, fontSize: 16, color: ACCENT, bold: true, fontFace: 'Arial' })
      slide.addText(deck.title, { x: 0.8, y: 2.5, w: 11.5, h: 1.4, fontSize: 40, color: INK, bold: true, fontFace: 'Arial', valign: 'top' })
      if (s.title && s.title !== deck.title) slide.addText(s.title, { x: 0.8, y: 4.0, w: 11.5, h: 0.6, fontSize: 20, color: MUTED, fontFace: 'Arial' })
      if (s.points.length) slide.addText(s.points.map(p => ({ text: p, options: { breakLine: true } })), { x: 0.8, y: 4.7, w: 11.5, h: 1.8, fontSize: 16, color: MUTED, fontFace: 'Arial', valign: 'top' })
    } else {
      slide.addText(s.kicker || `Slide ${i + 1}`, { x: 0.8, y: 0.5, w: 11.5, h: 0.4, fontSize: 14, color: ACCENT, bold: true, fontFace: 'Arial' })
      slide.addText(s.title, { x: 0.8, y: 0.9, w: 11.5, h: 1.0, fontSize: 30, color: INK, bold: true, fontFace: 'Arial', valign: 'top' })
      if (s.points.length) slide.addText(s.points.map(p => ({ text: p, options: { bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 10 } })),
        { x: 0.8, y: 2.1, w: 11.5, h: 4.6, fontSize: 20, color: INK, fontFace: 'Arial', valign: 'top' })
    }
    slide.addText(`${i + 1} / ${deck.slides.length}`, { x: 11.3, y: 6.9, w: 1.6, h: 0.35, fontSize: 10, color: MUTED, align: 'right', fontFace: 'Arial' })
    if (s.notes) slide.addNotes(s.notes)
  })
  const out = await pptx.write({ outputType: 'nodebuffer' })
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer)
}

export async function sheetToXlsx(sheet: Sheet): Promise<Buffer> {
  const XLSX: any = await import('xlsx')
  const rows: any[][] = [sheet.columns, ...sheet.rows.map((r, i) => r.map((c, j) => j === 0 && sheet.estimateRows.includes(i) ? `${c} (est.)` : c))]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const total = sheetTotal(sheet)
  if (sheet.totalColumn !== null && total !== null) {
    const col = XLSX.utils.encode_col(sheet.totalColumn)
    const last = sheet.rows.length + 1
    const totalRow = last + 1
    XLSX.utils.sheet_add_aoa(ws, [['Total']], { origin: `A${totalRow}` })
    ws[`${col}${totalRow}`] = { t: 'n', f: `SUM(${col}2:${col}${last})`, v: total }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow - 1, c: sheet.columns.length - 1 } })
  }
  ws['!cols'] = sheet.columns.map((c, j) => ({ wch: Math.min(40, Math.max(c.length, ...sheet.rows.map(r => String(r[j] ?? '').length)) + 4) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export function sheetToCsv(sheet: Sheet) { return sheetCsv(sheet) }

export function exportFileName(title: string, ext: string) {
  return `${(title || 'askgogo').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'askgogo'}.${ext}`
}
