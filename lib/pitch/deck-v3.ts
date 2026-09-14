export const PITCH_SLIDE_WIDTH = 1280
export const PITCH_SLIDE_HEIGHT = 720
export const PITCH_SLIDE_COUNT = 16

const C = {
  cream: '#F5F3EE',
  brown: '#341D14',
  orange: '#F47B20',
  green: '#4D865D',
  ink: '#2D1A13',
  muted: '#776B64',
  line: '#D9D2C8',
  white: '#FFFFFF',
  pale: '#ECE7DF',
  paleOrange: '#FCE1CC',
  paleGreen: '#DDEBDF',
}

function esc(s: unknown) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function rect(x:number,y:number,w:number,h:number,fill:string,rx=0,stroke='none',sw=1) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
}

function line(x1:number,y1:number,x2:number,y2:number,stroke=C.line,sw=1) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"/>`
}

function txt(x:number,y:number,lines:string|string[],size=24,opts:{fill?:string;family?:string;weight?:number|string;anchor?:'start'|'middle'|'end';italic?:boolean;lh?:number;letter?:number}={}) {
  const arr = Array.isArray(lines) ? lines : [lines]
  const fill = opts.fill || C.ink
  const family = opts.family || 'Arial, Helvetica, sans-serif'
  const weight = opts.weight || 400
  const anchor = opts.anchor || 'start'
  const style = opts.italic ? 'font-style:italic;' : ''
  const lh = opts.lh || Math.round(size * 1.18)
  const letter = opts.letter ?? 0
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${letter}" style="${style}">${arr.map((s,i)=>`<tspan x="${x}" dy="${i===0?0:lh}">${esc(s)}</tspan>`).join('')}</text>`
}

function serif(x:number,y:number,lines:string|string[],size=52,fill=C.ink,italic=false) {
  return txt(x,y,lines,size,{fill,family:'Georgia, Times New Roman, serif',weight:400,italic,lh:Math.round(size*1.12)})
}

function label(n:number,title:string,dark=false) {
  const fill = dark ? '#F69A55' : '#D9792D'
  return txt(65,78,`${String(n).padStart(2,'0')}  —  ${title.toUpperCase()}`,18,{fill,weight:700,letter:1.2})
}

function pill(x:number,y:number,text:string,fill=C.white,color=C.ink,w?:number) {
  const width = w || Math.max(92, text.length*8.2+30)
  return rect(x,y,width,38,fill,19,'#D9D2C8',1) + txt(x+width/2,y+25,text,15,{fill:color,weight:600,anchor:'middle'})
}

function mascot(x:number,y:number,s=1,darkHair=C.brown) {
  const hair = Array.from({length:9},(_,i)=>{
    const a = Math.PI*(0.15 + i*0.087)
    const cx=x+Math.cos(a)*54*s
    const cy=y-35*s-Math.sin(a)*32*s
    return `<circle cx="${cx}" cy="${cy}" r="21" fill="${darkHair}" opacity=".96"/>`
  }).join('')
  return `<g>${hair}<ellipse cx="${x}" cy="${y}" rx="58" ry="78" fill="#FFF9ED" stroke="#E4D9CA" stroke-width="2"/><ellipse cx="${x}" cy="${y+32*s}" rx="25" ry="36" fill="#F9A15D" opacity=".72"/><circle cx="${x-22*s}" cy="${y-5*s}" r="4" fill="#F6D8C1"/><circle cx="${x+22*s}" cy="${y-5*s}" r="4" fill="#F6D8C1"/><path d="M ${x-25*s} ${y-18*s} q ${10*s} ${13*s} ${20*s} 0" fill="none" stroke="#2E1B14" stroke-width="4" stroke-linecap="round"/><path d="M ${x+5*s} ${y-18*s} q ${10*s} ${13*s} ${20*s} 0" fill="none" stroke="#2E1B14" stroke-width="4" stroke-linecap="round"/><circle cx="${x+54*s}" cy="${y+64*s}" r="10" fill="#10A865" stroke="#254F39" stroke-width="3"/></g>`
}

function svg(body:string,bg=C.cream) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PITCH_SLIDE_WIDTH}" height="${PITCH_SLIDE_HEIGHT}" viewBox="0 0 ${PITCH_SLIDE_WIDTH} ${PITCH_SLIDE_HEIGHT}">${rect(0,0,1280,720,bg)}${body}</svg>`
}

function card(x:number,y:number,w:number,h:number,fill=C.white,rx=20) {
  return rect(x,y,w,h,fill,rx,'#E2DBD2',1)
}

function slide1(){
  return svg(
    txt(65,82,'●  PERSONAL AI OS FOR EVERYDAY LIFE',17,{fill:C.muted,weight:700,letter:1})+
    serif(65,470,'AskGogo',76)+
    serif(66,535,'One Gogo. Everywhere.',27,C.ink,true)+
    txt(65,580,'Plan. Act. Watch.',30,{fill:C.orange,weight:600})+
    pill(65,612,'●  Raising USD 500K · Seed',C.cream,C.ink,270)+
    mascot(900,350,1.28)+
    card(590,205,260,74)+txt(610,235,'Flight price dropped 12%',20,{weight:700})+txt(610,260,'Watching since Tuesday · book?',15,{fill:C.muted})+
    card(925,260,285,82,C.brown,16)+txt(947,294,'Reminder set · 7:00 PM',19,{fill:C.white,weight:700})+txt(947,320,'Call Amma about Diwali tickets',14,{fill:'#EADFD9'})+
    card(720,540,300,56)+txt(740,574,'●  Passport copy saved to memory',16,{fill:C.ink,weight:600})
  )
}

function slide2(){
  return svg(
    label(2,'The shift · The problem',true)+
    serif(65,155,['AI can answer almost anything. Life still does not','run itself.'],50,C.white)+
    line(65,505,535,505,'#68483B')+
    txt(65,550,'Chatbots',24,{fill:'#D9C9C1'})+txt(535,550,'answer',15,{fill:'#D9C9C1',anchor:'end'})+
    line(65,573,535,573,'#68483B')+txt(65,617,'Copilots',24,{fill:'#D9C9C1'})+txt(535,617,'assist',15,{fill:'#D9C9C1',anchor:'end'})+
    line(65,640,535,640,'#D67331')+txt(65,682,'Agents',24,{fill:C.white,weight:700})+txt(535,682,'remember · plan · act · watch',15,{fill:C.orange,anchor:'end'})+
    pill(610,456,'WhatsApp','#4A3127','#EDE4DF',120)+pill(740,456,'Gmail','#4A3127','#EDE4DF',92)+pill(842,456,'Calendar','#4A3127','#EDE4DF',120)+pill(972,456,'Documents','#4A3127','#EDE4DF',135)+
    pill(610,505,'Travel','#4A3127','#EDE4DF',90)+pill(710,505,'Bills','#4A3127','#EDE4DF',78)+pill(798,505,'Shopping','#4A3127','#EDE4DF',110)+pill(918,505,'Reminders','#4A3127','#EDE4DF',120)+
    pill(610,554,'Family tasks','#4A3127','#EDE4DF',125)+
    serif(610,630,['People don’t need app number thirteen. They','need one trusted brain across everything.'],30,C.white)
  ,C.brown)
}

function slide3(){
  return svg(
    label(3,'Why now')+
    serif(65,335,['The pieces exist. The layer','between them does not.'],51)+
    serif(65,455,'1B+',34,C.orange)+txt(65,500,'Meta AI monthly users — consumer AI behaviour is already',16,{fill:C.muted})+txt(65,525,'validated.',16,{fill:C.muted})+
    card(620,205,520,72)+txt(645,248,'LLMs can reason',20,{weight:600})+txt(1110,248,'EXISTS',15,{fill:'#2B9E68',weight:700,anchor:'end'})+
    card(620,292,520,72)+txt(645,335,'Tools can execute',20,{weight:600})+txt(1110,335,'EXISTS',15,{fill:'#2B9E68',weight:700,anchor:'end'})+
    card(620,379,520,92)+txt(645,420,'Users already live in WhatsApp',20,{weight:600})+txt(645,448,'3B+ monthly users',14,{fill:C.muted})+txt(1110,420,'EXISTS',15,{fill:'#2B9E68',weight:700,anchor:'end'})+
    rect(620,486,520,126,C.orange,20)+txt(645,525,['Trusted persistent personal','agent'],24,{fill:C.white,weight:600,lh:31})+txt(645,590,'remembers · plans · acts · watches',14,{fill:'#FFE7D4'})+txt(1000,555,'MISSING',15,{fill:C.white,weight:700})+mascot(1080,555,.55)
  )
}

function slide4(){
  const boxes=[
    {x:65,fill:C.brown,title:'Plan',sub:'Goal becomes a task graph.'},
    {x:390,fill:C.orange,title:'Act',sub:'Executes, verifies, pauses when\nconsequential.'},
    {x:715,fill:C.green,title:'Watch',sub:'Monitors, follows up, resumes when\nthings change.'},
  ]
  return svg(label(4,'The product')+serif(65,160,['A persistent personal AI agent that turns natural','language into missions.'],50)+boxes.map((b,i)=>rect(b.x,423,300,230,b.fill,22)+txt(b.x+24,472,`STEP ${['ONE','TWO','THREE'][i]}`,17,{fill:i===1?'#FFE7D4':'#D8CEC8',weight:700,letter:1})+mascot(b.x+245,485,.43)+serif(b.x+24,590,b.title,52,C.white)+txt(b.x+24,628,b.sub.split('\n'),16,{fill:i===1?'#FFE6D2':'#D8CEC8',lh:22})).join(''))
}

function slide5(){
  return svg(
    label(5,'How it works')+
    rect(65,112,330,540,C.white,32,C.brown,7)+txt(95,160,'Gogo',22,{weight:700})+txt(350,160,'ONLINE',15,{fill:'#25A56C',weight:700,anchor:'end'})+
    rect(88,235,280,94,C.brown,12)+txt(105,270,['Plan my trip, find the best option, create the','packing list, remind me, watch the fare and','add the booking to my calendar.'],14,{fill:C.white,lh:20})+
    rect(88,344,280,70,C.pale,12)+txt(105,372,['Mission started — 6 steps. I’ll ask before','anything touches your calendar or money.'],14,{fill:C.ink,lh:20})+
    rect(88,428,280,70,C.pale,12)+txt(105,455,['●  Best option found. Packing list ready.','Reminder set for Thu 8 PM.'],14,{fill:C.ink,lh:20})+
    rect(88,512,280,90,C.orange,12)+txt(105,540,'Add “BLR → DXB · 14–17 Nov” to calendar?',14,{fill:C.white,weight:600})+pill(105,554,'APPROVE',C.white,C.ink,88)+pill(202,554,'NOT NOW',C.orange,C.white,92)+
    rect(88,613,280,52,C.pale,12)+txt(105,643,'Added. Watching the fare — I’ll message you if it drops.',13,{fill:C.ink})+
    serif(450,145,'One sentence becomes a mission that keeps running.',31)+
    ['User intent','Plan','Task graph','Execute','Verify'].map((s,i)=>pill(450+i*137,190,s,i===0?C.brown:C.brown,C.white,120)).join('')+
    txt(578,215,'→',22,{fill:C.muted})+txt(715,215,'→',22,{fill:C.muted})+txt(852,215,'→',22,{fill:C.muted})+txt(989,215,'→',22,{fill:C.muted})+
    pill(450,250,'Approval if needed',C.orange,C.white,170)+pill(640,250,'Resume',C.brown,C.white,105)+pill(765,250,'Watch',C.green,C.white,100)+pill(885,250,'Follow up',C.green,C.white,112)+
    line(450,565,1140,565,C.muted)+txt(450,610,'WHATSAPP   ·   WEB   ·   MOBILE   ·   VOICE',17,{fill:C.ink,weight:700,letter:1.4})+serif(450,662,'Same Gogo. Same memory. Same missions.',30)
  )
}

function slide6(){
  const steps=['User','Gogo brain','Planner','Specialist\nagents','Tools &\nconnectors','Validator','Persistent\nruntime']
  return svg(
    label(6,'Autonomous engine · Trust',true)+serif(65,205,'Autonomy without surrendering control.',51,C.white)+mascot(1045,185,.8,'#9A7D73')+
    line(65,340,1130,340,'#6A4A3E',2)+`<circle cx="730" cy="340" r="9" fill="${C.orange}"/>`+
    steps.map((s,i)=>rect(65+i*153,365,140,105,i===6?C.green:'#3C241B',14,'#56382D',1)+txt(80+i*153,410,String(i+1),16,{fill:'#D7C9C2'})+txt(80+i*153,442,s.split('\n'),18,{fill:C.white,weight:600,lh:22})).join('')+
    txt(65,530,'Memory   ·   Retries   ·   Resumability   ·   Idempotency   ·   Audit log   ·   Background watchers',17,{fill:'#CDBCB4'})+
    rect(65,570,340,120,'#3C241B',16,'#56382D')+txt(90,610,'● SAFE ACTIONS',16,{fill:'#3DC47A',weight:700})+txt(90,646,'Autonomous',25,{fill:C.white,weight:600})+txt(90,673,'Research, drafts, lists, reminders',14,{fill:'#CDBCB4'})+
    rect(420,570,340,120,'#3C241B',16,'#56382D')+txt(445,610,'● CONSEQUENTIAL',16,{fill:C.orange,weight:700})+txt(445,646,'Pause and approve',25,{fill:C.white,weight:600})+txt(445,673,'Calendar writes, emails, external actions',14,{fill:'#CDBCB4'})+
    rect(775,570,365,120,C.cream,16)+txt(800,610,'○ MONEY · SUBMISSIONS',16,{fill:C.muted,weight:700})+txt(800,646,'Explicit human control',25,{fill:C.ink,weight:600})+txt(800,673,'Purchases, bookings, financial actions',14,{fill:C.muted})
  ,C.brown)
}

function slide7(){
  const mission=(x:number,title:string,q:string,tags:string[],accent:string)=>card(x,395,300,240)+txt(x+22,438,title,16,{fill:accent,weight:700,letter:.7})+serif(x+22,500,q.split('\n'),25,C.ink)+tags.map((t,i)=>pill(x+22+(i%3)*88,545+Math.floor(i/3)*46,t,i===tags.length-1?C.paleGreen:C.pale,C.ink,82)).join('')
  return svg(label(7,'What Gogo can do')+serif(65,155,['From one-off tasks to life running in the','background.'],50)+mission(65,'MISSION 01 · TRAVEL','“Find me the best BLR → Dubai option\nnext month.”',['Search','Compare','Reason','Watch price','Ask before booking'],C.orange)+mission(390,'MISSION 02 · ROUTINES','“Remember how I do this every month.”',['Learn preference','Create routine','Remind','Execute next time'],C.green)+mission(715,'MISSION 03 · LIFE ADMIN','“Track my expenses and tell me\nwhat changed.”',['Capture','Categorise','Compare','Alert','Follow up'],C.brown)+txt(65,680,'ALSO',16,{fill:C.muted,weight:700})+['Calendar','Documents','Bills','Shopping','Family','Reminders','Meetings','Lists','Renewals'].map((s,i)=>pill(120+i*112,652,s,C.cream,C.ink,100)).join(''))
}

function slide8(){
  return svg(label(8,'India wedge')+serif(65,155,['We start where behaviour','already exists.'],50)+serif(65,470,'500M+',72)+txt(300,470,'WhatsApp users in India',18,{fill:C.muted})+
    ['WhatsApp-native behaviour','UPI','Digital services','Travel','Commerce','Gmail · Calendar','22+ languages','Family coordination'].map((s,i)=>pill(65+(i%5)*155,505+Math.floor(i/5)*48,s,C.white,C.ink,i===0?185:i===7?175:140)).join('')+
    line(65,615,595,615,C.muted)+serif(65,660,'No new behaviour to teach.',28)+serif(330,660,'Gogo lives where users',28,C.orange,true)+serif(65,700,'already live.',28,C.orange,true)+
    rect(735,110,405,575,C.white,40,C.brown,8)+txt(770,160,'Chats',26,{weight:700})+line(760,180,1115,180,C.line)+
    rect(760,190,355,84,'#FDE9D8',0)+mascot(810,232,.35)+txt(855,222,'Gogo',19,{weight:700})+txt(855,248,'Electricity bill due Fri · pay via UPI?',14,{fill:C.muted})+txt(1095,222,'now',14,{fill:C.orange,weight:700,anchor:'end'})+`<circle cx="1090" cy="246" r="12" fill="#16AE68"/>`+txt(1090,251,'1',13,{fill:C.white,weight:700,anchor:'middle'})+
    ['Family|Papa: reached station','Priya|Sending the invoice today','Society group|Water tanker at 4 PM','Kirana store|Order delivered'].map((r,i)=>{const [a,b]=r.split('|');const y=300+i*90;return `<circle cx="810" cy="${y}" r="24" fill="#E7E0D6"/>`+txt(855,y-5,a,18,{weight:600})+txt(855,y+21,b,14,{fill:C.muted})+line(760,y+44,1115,y+44,C.line)}).join('')
  )
}

function slide9(){
  return svg(label(9,'Market opportunity')+serif(65,150,'3 billion people already live on the distribution layer.',48)+serif(65,205,'We are building the intelligence layer on top.',46,C.orange,true)+
    line(65,330,365,330,C.muted)+line(390,330,690,330,C.muted)+line(715,330,1140,330,C.muted)+
    serif(65,440,'3B+',72)+txt(65,485,'WhatsApp monthly users',20,{weight:600})+txt(65,520,'GLOBAL DISTRIBUTION',15,{fill:C.muted,weight:700,letter:1})+
    serif(390,440,'1B+',72)+txt(390,485,'Meta AI monthly users',20,{weight:600})+txt(390,520,'AI BEHAVIOUR VALIDATED',15,{fill:C.muted,weight:700,letter:1})+
    serif(715,440,'$21B+',72)+txt(715,485,['AI assistant market by 2030 ·','~44% CAGR'],20,{weight:600,lh:25})+txt(715,545,'CATEGORY TAILWIND',15,{fill:C.muted,weight:700,letter:1})+
    rect(65,585,1075,75,C.brown,16)+mascot(120,623,.34)+serif(170,632,'AskGogo',27,C.white)+txt(300,628,'Memory + reasoning + action + monitoring — on the surface people already use.',16,{fill:'#D9CBC5'})+
    txt(65,692,'Sources: WhatsApp and Meta AI monthly active users — Meta reported figures. AI assistant market size and CAGR — third-party industry estimates, 2030 projection.',11,{fill:C.muted})
  )
}

function slide10(){
  const box=(x:number,fill:string,top:string,big:string,sub:string,foot:string[])=>rect(x,400,300,255,fill,18)+txt(x+25,445,top,16,{fill:fill===C.cream?C.muted:'#F3E9E4',weight:700,letter:1})+serif(x+25,535,big,67,fill===C.cream?C.ink:C.white)+txt(x+25,574,sub,17,{fill:fill===C.cream?C.muted:'#EEDFD8'})+line(x+25,595,x+275,595,fill===C.cream?C.line:'#FFFFFF33')+txt(x+25,625,foot,13,{fill:fill===C.cream?C.muted:'#EEDFD8',lh:20})
  return svg(label(10,'TAM · SAM · SOM')+pill(970,58,'AskGogo bottom-up model',C.cream,C.muted,190)+serif(65,155,['We only need a fraction of the market to build a','large company.'],50)+box(65,C.brown,'GLOBAL TAM','$18B','annual global consumer opportunity',['3B WhatsApp MAU × 10% monetisable','= 300M users × $60 blended ARPU'])+box(390,C.orange,'INDIA SAM','$1.7B','≈ ₹15,000 Cr annual India opportunity',['500M+ WhatsApp users × 10% AI-ready','= 50M users × ₹3,000 blended ARPU'])+box(715,C.green,'5-YEAR SOM','$34M','ARR ≈ ₹300 Cr',['1M paying Indian users × ₹3,000/year','Global path: 5M paid × $60 ≈ $300M ARR']))
}

function slide11(){
  const stage=(x:number,fill:string,top:string,big:string,desc:string[])=>rect(x,300,245,235,fill,18,fill===C.cream?'#D7D0C7':'none')+txt(x+20,338,top,15,{fill:fill===C.orange?'#FFE5D0':fill===C.brown?'#EADDD7':C.muted,weight:700,letter:1})+serif(x+20,395,big,36,fill===C.orange||fill===C.brown?C.white:C.ink)+txt(x+20,432,desc,15,{fill:fill===C.orange?'#FFE5D0':fill===C.brown?'#EADDD7':C.muted,lh:21})
  return svg(label(11,'India → world')+serif(65,155,'India is the wedge. The architecture is global.',50)+stage(65,C.orange,'LAUNCH MARKET','India',['500M+ WhatsApp users · UPI ·','travel · commerce ·','Gmail/Calendar · local services ·','multiple languages'])+stage(320,C.brown,'MARKET #2','UAE',['WhatsApp-native · high','consumer ARPU · large','expatriate population · travel-','heavy · English, Arabic, Indian','languages'])+stage(575,C.white,'NEXT','MENA · SEA · LATAM',['WhatsApp-heavy markets with','the same playbook'])+stage(830,C.cream,'THEN','Global',['A global personal-agent','platform'])+
    line(65,555,1075,555,C.line)+txt(65,595,'WHAT STAYS THE SAME',15,{fill:C.green,weight:700,letter:1})+['Agent brain','Memory','Runtime','Safety','Watchers','UX'].map((s,i)=>pill(65+i*107,610,s,C.paleGreen,C.ink,98)).join('')+
    txt(650,595,'WHAT CHANGES',15,{fill:C.orange,weight:700,letter:1})+['Local integrations','Payments','Providers','Languages'].map((s,i)=>pill(650+i*135,610,s,C.paleOrange,C.ink,125)).join('')+serif(65,695,'One operating system.',28)+serif(330,695,'Country-specific rails.',28,C.orange,true))
}

function slide12(){
  const c=(x:number,title:string,desc:string,ask=false)=>rect(x,420,245,205,ask?C.orange:C.white,18,'#E2DBD2')+txt(x+20,465,title,18,{fill:ask?C.white:C.ink,weight:700})+txt(x+20,500,desc.split('\n'),15,{fill:ask?'#FFE9D8':C.muted,lh:22})+(ask?mascot(x+200,455,.4):'')
  return svg(label(12,'Competition · Why we win')+serif(65,155,'Others start with models, platforms or workflows.',48)+serif(65,212,'AskGogo starts with the person’s life.',46,C.orange,true)+c(65,'ChatGPT / Claude','Excellent intelligence. Primarily\nassistant and chat centred.')+c(325,'Meta / Muse','Validates the personal-agent\ncategory. Platform-scale\ndistribution.')+c(585,'Zapier / automation','Powerful automation. Workflow\nand tool centric.')+c(845,'AskGogo','Personal, persistent, WhatsApp-\nfirst. Memory + action +\nwatchers. India-first\nintegrations. Human approval\narchitecture.',true)+line(65,648,1140,648,C.line)+txt(65,690,'DEFENSIBILITY',15,{fill:C.muted,weight:700})+['Personal memory graph','Persistent runtime','Local integrations','Behaviour data','Same brain across surfaces'].map((s,i)=>pill(175+i*200,665,s,C.brown,C.white,185)).join(''))
}

function slide13(){
  return svg(label(13,'Business model · Today')+serif(65,155,['Subscriptions first, then','services.'],50)+
    [100,175,265,365].map((h,i)=>rect(65+i*125,605-h,110,h,[C.white,'#D8CFBF',C.orange,C.brown][i],12)).join('')+
    ['Free','Essential','Plus','Pro'].map((s,i)=>txt(65+i*125,640,s,18,{weight:600})).join('')+
    line(65,660,530,660,C.line)+txt(65,695,'LATER',15,{fill:C.muted,weight:700})+pill(130,670,'Family',C.cream,C.muted,80)+pill(220,670,'Concierge',C.cream,C.muted,105)+pill(335,670,'Partner / API revenue',C.cream,C.muted,165)+
    card(625,110,515,575)+txt(655,155,'LIVE TODAY',16,{fill:C.green,weight:700,letter:1})+
    ['● WhatsApp architecture','● Web dashboard','● Memory','● Reminders','● Lists','● Calendar','● Approvals','● Background watchers'].map((s,i)=>pill(655+(i%2)*210,180+Math.floor(i/2)*45,s,C.pale,C.ink,195)).join('')+
    line(655,365,1110,365,C.line)+txt(655,405,'● IN TESTING',16,{fill:C.orange,weight:700})+txt(655,445,'Persistent autonomous runtime',26,{weight:600})+line(655,610,1110,610,C.line)+txt(655,650,['Built by repeat founders with marketplace and product','execution experience.'],15,{fill:C.muted,lh:21})+mascot(1080,150,.35)
  )
}

function slide14(){
  const phase=(x:number,top:string,lines:string[])=>card(x,460,300,150)+txt(x+20,500,top,16,{fill:top.startsWith('0–6')?C.orange:C.muted,weight:700,letter:.5})+txt(x+20,535,lines,16,{fill:C.ink,lh:25})
  return svg(label(14,'The round')+serif(65,185,'$500K',78)+txt(65,225,'USD · SEED',18,{fill:C.muted,weight:700,letter:1})+serif(330,180,'Gets us from working product to repeatable market.',30)+phase(65,'0–6 MONTHS',['Harden autonomous runtime','Deep India integrations','Launch paid plans'])+phase(390,'6–12 MONTHS',['India consumer growth','100K activated users · 10K paid','Family & power-user workflows'])+phase(715,'12–18 MONTHS',['UAE launch','Country expansion playbook','Institutional seed / Series A'])+
    rect(65,635,405,20,C.brown,10)+rect(470,635,255,20,C.orange,0)+rect(725,635,205,20,C.green,0)+rect(930,635,110,20,'#BDB3AA',0)+rect(1040,635,75,20,'#D8CFBF',10)+
    txt(65,688,'● 40% Product & autonomous backend   ● 25% Integrations & infrastructure   ● 20% India GTM   ● 10% UAE launch   ● 5% Compliance & admin',13,{fill:C.muted})
  )
}

function slide15(){
  const person=(x:number,initial:string,color:string,name:string,role:string,desc:string[])=>card(x,215,205,385)+`<circle cx="${x+52}" cy="270" r="34" fill="${color}"/>`+serif(x+52,280,initial,28,C.white)+txt(x+22,342,name,18,{weight:700})+txt(x+22,372,role,15,{fill:color,weight:700})+txt(x+22,412,desc,14,{fill:C.muted,lh:22})
  return svg(label(15,'Why this team')+serif(65,155,['Serial entrepreneurs.','Repeat builders.'],50)+line(65,345,455,345,C.line)+txt(65,390,'Repeat-founder\nexecution'.split('\n'),22,{weight:700,lh:28})+txt(265,390,['Built, sold and operated before'],15,{fill:C.muted})+line(65,440,455,440,C.line)+txt(65,485,'Marketplace\nscale'.split('\n'),22,{weight:700,lh:28})+txt(265,485,['Consumer product and supply-side','operations'],15,{fill:C.muted,lh:20})+line(65,535,455,535,C.line)+txt(65,580,['India','ecosystem ·','GCC','relationships'],22,{weight:700,lh:28})+txt(265,580,['The two launch markets, already','networked'],15,{fill:C.muted,lh:20})+
    person(500,'G',C.orange,'Goverdhan MD','CO-FOUNDER',['Deep expertise in','Indian fintech, AI','product development','and startup','ecosystems. Prior','exit via acquisition.','Moves fast with AI-','native tooling.'])+
    person(720,'M',C.brown,'Mathew Varkey','CO-FOUNDER',['Product and growth','leader. Bangalore-','based operator with','hands-on experience','across SaaS products','and go-to-market','execution in Indian','and UAE markets.'])+
    person(940,'S',C.green,'Srinivas Jayaram','CO-FOUNDER',['Technical co-founder.','Brings engineering','depth and systems','thinking to AskGogo’s','agent runtime,','memory','architecture and AI','integration stack.'])
  )
}

function slide16(){
  return svg(label(16,'Vision',true)+serif(65,160,['The trusted AI layer between you','and your digital life.'],50,C.white)+
    pill(65,258,'what matters','#4A3127','#D9CBC5',120)+pill(195,258,'what is pending','#4A3127','#D9CBC5',145)+pill(350,258,'what has changed','#4A3127','#D9CBC5',155)+pill(515,258,'what needs action','#4A3127','#D9CBC5',150)+pill(65,305,'what can safely run on its own',C.green,C.white,245)+
    line(65,420,650,420,'#6A4A3E')+serif(65,500,'AskGogo',48,C.white)+serif(245,495,'One Gogo. Everywhere.',26,'#D8C7BF',true)+txt(65,555,'Plan. Act. Watch.',31,{fill:C.orange,weight:600})+txt(65,600,'USD 500K SEED   ·   INDIA → UAE → WORLD',17,{fill:'#E5D7D0',weight:700,letter:1})+serif(65,650,'Your life shouldn’t need another app. It needs an',27,'#E5D7D0')+serif(65,690,'operating agent.',27,C.white,true)+mascot(1015,520,1.22,'#8D746D')+txt(1015,695,'WATCHING · ALWAYS ON',16,{fill:'#64B57A',weight:700,anchor:'middle',letter:1})
  ,C.brown)
}

export function renderPitchSlideSvg(index:number) {
  const fns=[slide1,slide2,slide3,slide4,slide5,slide6,slide7,slide8,slide9,slide10,slide11,slide12,slide13,slide14,slide15,slide16]
  const fn=fns[index-1] || slide1
  return fn()
}

export function renderPitchDeckHtml() {
  const slides=Array.from({length:PITCH_SLIDE_COUNT},(_,i)=>`<section class="slide" data-slide="${i+1}">${renderPitchSlideSvg(i+1)}</section>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><title>AskGogo Pitch Deck v3</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${C.brown};font-family:Arial,Helvetica,sans-serif}.deck{position:fixed;inset:0;display:grid;place-items:center}.slide{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:${C.cream}}.slide.active{display:flex}.slide svg{width:100%;height:100%;object-fit:contain}.nav{position:fixed;left:18px;right:18px;bottom:14px;display:flex;align-items:center;justify-content:space-between;z-index:20;pointer-events:none}.nav button{pointer-events:auto;border:1px solid rgba(255,255,255,.35);background:rgba(45,26,19,.82);color:white;width:42px;height:42px;border-radius:50%;font-size:20px;cursor:pointer}.count{background:rgba(45,26,19,.78);color:#fff;padding:8px 12px;border-radius:999px;font-size:12px;letter-spacing:.08em}.hint{position:fixed;top:14px;right:16px;background:rgba(255,255,255,.78);backdrop-filter:blur(8px);border:1px solid rgba(45,26,19,.12);color:${C.ink};padding:7px 11px;border-radius:999px;font-size:11px;z-index:20}@media(max-width:760px){.hint{display:none}}</style></head><body><div class="deck">${slides}</div><div class="hint">← → keys · swipe · scroll</div><div class="nav"><button id="prev" aria-label="Previous slide">‹</button><span class="count" id="count"></span><button id="next" aria-label="Next slide">›</button></div><script>(()=>{const slides=[...document.querySelectorAll('.slide')];let i=0,last=0,startY=null;const count=document.getElementById('count');function show(n){i=(n+slides.length)%slides.length;slides.forEach((s,j)=>s.classList.toggle('active',j===i));count.textContent=(i+1)+' / '+slides.length}function go(d){const now=Date.now();if(now-last<350)return;last=now;show(i+d)}document.getElementById('next').onclick=()=>go(1);document.getElementById('prev').onclick=()=>go(-1);addEventListener('keydown',e=>{if(['ArrowRight','PageDown',' '].includes(e.key))go(1);if(['ArrowLeft','PageUp'].includes(e.key))go(-1)});addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>18)go(e.deltaY>0?1:-1)},{passive:true});addEventListener('touchstart',e=>startY=e.touches[0]?.clientY??null,{passive:true});addEventListener('touchend',e=>{if(startY==null)return;const d=startY-(e.changedTouches[0]?.clientY??startY);startY=null;if(Math.abs(d)>40)go(d>0?1:-1)},{passive:true});show(0)})();</script></body></html>`
}
