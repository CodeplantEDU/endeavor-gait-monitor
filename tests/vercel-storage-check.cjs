// Persistent-profile QA on the real deployment; all seeded records are synthetic.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
(async()=>{
 const base=process.env.EARLYBIRD_TEST_URL||'https://earlybird-gait-monitor.vercel.app',out=path.resolve(__dirname,'../output/vercel');fs.mkdirSync(out,{recursive:true});
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'earlybird-vercel-qa-'));let context,checks=0;
 const eq=(a,b)=>{assert.equal(a,b);checks++;},ok=v=>{assert.ok(v);checks++;};
 const open=async()=>chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,viewport:{width:1440,height:1000},reducedMotion:'reduce',args:['--no-proxy-server']});
 try{
  context=await open();let page=await context.newPage();const errors=[],networkAPI=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))networkAPI.push(r.url());});
  await page.goto(base+'/#dashboard');await page.waitForFunction(()=>document.querySelectorAll('[data-nav]').length===10&&document.getElementById('home-total').textContent!=='—');
  eq(await page.locator('.sidebar-brand img').count(),0);eq(await page.evaluate(()=>isSecureContext),true);eq(await page.evaluate(()=>!!navigator.bluetooth),true);
  const api=async(url,body)=>page.evaluate(async({url,body})=>{const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return{status:r.status,data:await r.json()};},{url,body});
  const p='PERSIST_QA';await page.locator('#participant').fill(p);await page.locator('#participant').dispatchEvent('change');await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('PERSIST_QA'));
  eq((await api('/api/devices',{side:'L',device_id:'SYNTHETIC_PERSIST_L',device_name:'QA ONLY'})).status,200);
  eq((await api('/api/devices',{side:'R',device_id:'SYNTHETIC_PERSIST_L',device_name:'DUPLICATE'})).status,400);
  const calibration=(await api('/api/calibrations',{participant_id:p,side:'L',device_id:'SYNTHETIC_PERSIST_L',uptime:100,front:{zero:100,loaded:1100,noise:1},rear:{zero:100,loaded:1100,noise:1},orientation:{roll:0,pitch:0,yaw:0}})).data;
  const config=(await api('/api/config')).data,keys=['pitch_range','forefoot_peak','heel_peak','pressure_ratio','forefoot_contact','heel_contact','total_contact','interval_mean','interval_sd','interval_cv'];
  const sample={side:'L',front:17,rear:23,roll:1,pitch:2,yaw:3,status:2,pc_timestamp_ms:1700000000000,pc_timestamp:'2023-11-14T22:13:20Z',esp_timestamp:100,sequence:1,calibration_id:calibration.id};
  const payload={participant_id:p,condition:'Normal',trial:1,started_at:'SYNTHETIC',ended_at:'SYNTHETIC',samples:[sample,{...sample,pc_timestamp_ms:1700000012000}],calibration_ids:{L:calibration.id},summary:{L:{metrics:Object.fromEntries(keys.map(k=>[k,1])),quality:{duration:12,missingFraction:0},ready:true,scores:{groups:{movement:null,rotation:80,jerk:null,pressure:80,contact:80,rhythm:80}},overall:80}}};
  const saved=await api('/api/trials',payload);eq(saved.status,200);const bad=structuredClone(payload);bad.samples[0].front=4096;eq((await api('/api/trials',bad)).status,400);eq((await api('/api/state?participant='+p)).data.trials.length,1);
  eq((await api('/api/trials/'+saved.data.id+'/baseline',{})).status,200);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const med=await api('/api/platform/medications',{participant_id:p,name:'QA ONLY',dose_note:'NOT A REAL MEDICINE',times:['08:00'],start_date:today});eq(med.status,200);
  await api('/api/platform/intakes',{participant_id:p,medication_id:med.data.id,date:today,time:'08:00',status:'taken'});
  // Change only the test fixture's stored date to exercise the closed-month report branch.
  await page.evaluate(async id=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('earlybird-research-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction('trials','readwrite'),store=tx.objectStore('trials'),r=store.get(id);r.onsuccess=()=>store.put({...r.result,created_at:'2026-08-16T10:00:00Z'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();},saved.data.id);
  const platform=(await api('/api/platform?participant='+p)).data;eq(platform.reports.length,1);eq(platform.reports[0].automatic,true);eq(platform.reports[0].start,'2026-08-01');eq((await api('/api/platform?participant='+p)).data.reports.length,1);
  const csvPromise=page.waitForEvent('download');await page.evaluate(id=>{const a=document.createElement('a');a.href='/api/trials/'+id+'/raw.csv';a.download='';document.body.append(a);a.click();a.remove();},saved.data.id);await (await csvPromise).saveAs(path.join(out,'raw-synthetic.csv'));ok(fs.readFileSync(path.join(out,'raw-synthetic.csv'),'utf8').includes('fsr_forefoot'));
  const backupPromise=page.waitForEvent('download');await page.locator('#browser-backup').click();await (await backupPromise).saveAs(path.join(out,'browser-backup-synthetic.json'));const backup=JSON.parse(fs.readFileSync(path.join(out,'browser-backup-synthetic.json'),'utf8'));eq(backup.trials.length,1);eq(backup.samples[0].rows.length,2);eq(backup.records.filter(r=>r.kind==='medication').length,1);
  eq(networkAPI.length,0);eq(errors.length,0);await context.close();context=await open();page=await context.newPage();await page.goto(base+'/#dashboard');await page.waitForFunction(()=>document.getElementById('home-total')?.textContent==='1회');eq(await page.locator('#participant').inputValue(),p);
  const persisted=await page.evaluate(async()=>({state:await (await fetch('/api/state?participant=PERSIST_QA')).json(),platform:await (await fetch('/api/platform?participant=PERSIST_QA')).json()}));eq(persisted.state.trials.length,1);eq(persisted.state.trials[0].baseline,true);eq(persisted.platform.medications.length,1);eq(persisted.platform.intakes.length,1);eq(persisted.platform.reports.length,1);
  await page.evaluate(()=>{const p=document.createElement('p');p.className='research-note';p.textContent='QA 전용 합성 기록 · 브라우저 종료 후 저장 유지 검사 · 실제 보행/복약 아님';document.querySelector('.page-title').after(p);});await page.screenshot({path:path.join(out,'persistent-storage-synthetic.png'),fullPage:true});
  const result={url:base,checks,syntheticOnly:true,nativeBluetoothAvailable:true,logoSymbolRemoved:true,persistedAcrossBrowserRestart:true,csvDownload:true,fullBackup:true,monthlyReport:true,networkApiRequests:0,pageErrors:errors};fs.writeFileSync(path.join(out,'storage-result.json'),JSON.stringify(result,null,2));console.log('PASS_VERCEL_STORAGE',JSON.stringify(result));
 }finally{if(context)await context.close();const resolved=path.resolve(profile);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('earlybird-vercel-qa-'))fs.rmSync(resolved,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
