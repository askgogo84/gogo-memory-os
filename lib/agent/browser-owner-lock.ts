import { randomBytes } from 'node:crypto'

/** Reserve the same owner lock used by human takeover before touching Chromium or egress. */
export type BrowserOwnerRelease=(()=>Promise<void>)&{reserveHandoff:()=>Promise<string>}
export async function acquireBrowserOwnerLock(sandbox:any):Promise<BrowserOwnerRelease>{
  const token=randomBytes(18).toString('base64url')
  const hold=String.raw`const fs=require('fs'),token=process.argv[1];
if(fs.existsSync('gogo-handoff-transfer'))process.exit(1);
fs.writeFileSync('gogo-browser-held-'+token,'ready');
const deadline=Date.now()+20*60*1000;
setInterval(()=>{if(Date.now()>deadline||fs.existsSync('gogo-browser-release-'+token))process.exit(0)},50);`
  await sandbox.runCommand({cmd:'flock',args:['-n','--close','gogo-handoff.lock','node','-e',hold,'--',token],detached:true} as any)
  let acquired=false
  for(let attempt=0;attempt<5;attempt++){
    await new Promise(r=>setTimeout(r,100))
    const check=await sandbox.runCommand({cmd:'node',args:['-e',"process.exit(require('fs').existsSync('gogo-browser-held-'+process.argv[1])?0:1)",'--',token]})
    if(check.exitCode===0){acquired=true;break}
  }
  if(!acquired){
    // Cancel a delayed acquisition too; it must not become an orphan lock.
    await sandbox.writeFiles([{path:`gogo-browser-release-${token}`,content:Buffer.from('release')}]).catch(()=>{})
    throw new Error('browser_handoff_in_use')
  }
  const release=async()=>{
    await sandbox.writeFiles([{path:`gogo-browser-release-${token}`,content:Buffer.from('release')}]).catch(()=>{})
    await new Promise(r=>setTimeout(r,150))
  }
  return Object.assign(release,{reserveHandoff:async()=>{
    const reservation=randomBytes(24).toString('base64url')
    // Written while this process still owns flock. Every later automated owner
    // checks it under flock and exits; only this takeover token can consume it.
    await sandbox.writeFiles([{path:'gogo-handoff-transfer',content:Buffer.from(reservation)}])
    return reservation
  }})
}
