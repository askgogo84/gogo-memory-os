// Minimal PDF.js canvas primitives for Vercel Node/serverless text extraction.
// Keep this module free of provider, DB, credential and request-time effects.
// Install globals BEFORE evaluating pdf-parse/pdfjs-dist (not after import).

class ServerlessDOMMatrix {
  a=1;b=0;c=0;d=1;e=0;f=0;is2D=true
  constructor(init?:number[]|Float32Array|Float64Array|{a?:number;b?:number;c?:number;d?:number;e?:number;f?:number}){
    if(Array.isArray(init)||ArrayBuffer.isView(init)){
      const v=Array.from(init as ArrayLike<number>)
      this.a=Number(v[0]??1);this.b=Number(v[1]??0);this.c=Number(v[2]??0)
      this.d=Number(v[3]??1);this.e=Number(v[4]??0);this.f=Number(v[5]??0)
    }else if(init&&typeof init==='object'){
      this.a=Number(init.a??1);this.b=Number(init.b??0);this.c=Number(init.c??0)
      this.d=Number(init.d??1);this.e=Number(init.e??0);this.f=Number(init.f??0)
    }
  }
  private set(m:ServerlessDOMMatrix){this.a=m.a;this.b=m.b;this.c=m.c;this.d=m.d;this.e=m.e;this.f=m.f;return this}
  multiply(other:any){
    const o=other instanceof ServerlessDOMMatrix?other:new ServerlessDOMMatrix(other)
    return new ServerlessDOMMatrix([
      this.a*o.a+this.c*o.b,
      this.b*o.a+this.d*o.b,
      this.a*o.c+this.c*o.d,
      this.b*o.c+this.d*o.d,
      this.a*o.e+this.c*o.f+this.e,
      this.b*o.e+this.d*o.f+this.f,
    ])
  }
  multiplySelf(other:any){return this.set(this.multiply(other))}
  preMultiplySelf(other:any){return this.set((other instanceof ServerlessDOMMatrix?other:new ServerlessDOMMatrix(other)).multiply(this))}
  translate(tx=0,ty=0){return this.multiply(new ServerlessDOMMatrix([1,0,0,1,tx,ty]))}
  translateSelf(tx=0,ty=0){return this.set(this.translate(tx,ty))}
  scale(scaleX=1,scaleY=scaleX){return this.multiply(new ServerlessDOMMatrix([scaleX,0,0,scaleY,0,0]))}
  scaleSelf(scaleX=1,scaleY=scaleX){return this.set(this.scale(scaleX,scaleY))}
  rotate(angle=0){
    const r=angle*Math.PI/180,s=Math.sin(r),co=Math.cos(r)
    return this.multiply(new ServerlessDOMMatrix([co,s,-s,co,0,0]))
  }
  rotateSelf(angle=0){return this.set(this.rotate(angle))}
  inverse(){
    const det=this.a*this.d-this.b*this.c
    if(!det)return new ServerlessDOMMatrix([NaN,NaN,NaN,NaN,NaN,NaN])
    return new ServerlessDOMMatrix([
      this.d/det,-this.b/det,-this.c/det,this.a/det,
      (this.c*this.f-this.d*this.e)/det,
      (this.b*this.e-this.a*this.f)/det,
    ])
  }
  invertSelf(){return this.set(this.inverse())}
  transformPoint(point:any={x:0,y:0}){
    const x=Number(point?.x||0),y=Number(point?.y||0)
    return {x:this.a*x+this.c*y+this.e,y:this.b*x+this.d*y+this.f,z:0,w:1}
  }
  toFloat32Array(){return new Float32Array([this.a,this.b,this.c,this.d,this.e,this.f])}
  toFloat64Array(){return new Float64Array([this.a,this.b,this.c,this.d,this.e,this.f])}
}

export function ensurePdfJsServerlessGlobals(){
  const g:any=globalThis as any
  if(typeof g.DOMMatrix==='undefined')g.DOMMatrix=ServerlessDOMMatrix
  if(typeof g.ImageData==='undefined')g.ImageData=class ImageData {
    data:Uint8ClampedArray;width:number;height:number
    constructor(dataOrWidth:any,widthOrHeight:any,heightMaybe?:number){
      if(typeof dataOrWidth==='number'){
        this.width=dataOrWidth;this.height=Number(widthOrHeight||0)
        this.data=new Uint8ClampedArray(this.width*this.height*4)
      }else{
        this.data=dataOrWidth instanceof Uint8ClampedArray?dataOrWidth:new Uint8ClampedArray(dataOrWidth||[])
        this.width=Number(widthOrHeight||0);this.height=Number(heightMaybe||0)
      }
    }
  }
  if(typeof g.Path2D==='undefined')g.Path2D=class Path2D { constructor(_path?:any){} addPath(_path:any,_transform?:any){} }
}


export async function extractServerlessPdfText(pdfBuffer:Buffer,maxChars?:number):Promise<string>{
  ensurePdfJsServerlessGlobals()
  const mod:any=await import('pdf-parse')
  let text=''
  if(typeof mod.PDFParse==='function'){
    const parser=new mod.PDFParse({data:pdfBuffer})
    try{
      const result=await parser.getText()
      text=String(result?.text||'')
    }finally{
      await parser.destroy?.()
    }
  }else{
    const legacy=mod.default||mod
    if(typeof legacy!=='function')throw new Error('workspace_pdf_parser_unavailable')
    const result=await legacy(pdfBuffer)
    text=String(result?.text||'')
  }
  const normalized=text.trim()
  return typeof maxChars==='number'&&Number.isFinite(maxChars)
    ?normalized.slice(0,Math.max(0,Math.floor(maxChars)))
    :normalized
}
