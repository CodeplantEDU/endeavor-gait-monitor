// Synthetic UI integration checks. Run tests/qa_server.py first; production data is not used.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1440,height:1100}});
 await context.addInitScript(()=>{
  const runId=Date.now(),devices={},characteristics={},counters={L:0,R:0},modes={L:'free',R:'free'};window.qaModes=modes;window.qaNext='L';window.qaTrial=0;
  for(const side of ['L','R']){
   const device=new EventTarget(),characteristic=new EventTarget();device.id='SYNTHETIC_'+side+'_'+runId;device.name='SYNTHETIC QA '+side;devices[side]=device;characteristics[side]=characteristic;
   characteristic.startNotifications=async()=>characteristic;
   device.gatt={connected:false,connect:async()=>{device.gatt.connected=true;return{getPrimaryService:async()=>({getCharacteristic:async()=>characteristic})};},disconnect:()=>{device.gatt.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}};
  }
  window.qaDisconnect=side=>devices[side].gatt.disconnect();
  Object.defineProperty(navigator,'bluetooth',{value:{requestDevice:async()=>devices[window.qaNext],getDevices:async()=>Object.values(devices)},configurable:true});
  window.addEventListener('DOMContentLoaded',()=>setInterval(()=>{for(const side of ['L','R']){
   if(!devices[side].gatt.connected||modes[side]==='silent')continue;
   const i=counters[side]++,t=i/20,phase=(t/(1+.09*Math.sin(t/5)+(side==='R'?.015:0)))%1;
   const walk=modes[side]==='walk',loaded=modes[side]==='loaded';
   const front=loaded?1100:walk&&phase>=.2&&phase<.7?1100:100;
   const rear=loaded?1120:walk&&phase<.3?1120:120;
   const v=new DataView(new ArrayBuffer(18));v.setUint8(0,1);v.setUint8(1,2);v.setUint16(2,i%65536,true);v.setUint32(4,100000+i*50,true);v.setUint16(8,front,true);v.setUint16(10,rear,true);v.setInt16(12,200,true);v.setInt16(14,Math.round((3+(walk?(6+window.qaTrial*.3)*Math.sin(2*Math.PI*t):0))*100),true);v.setInt16(16,100,true);characteristics[side].value=v;characteristics[side].dispatchEvent(new Event('characteristicvaluechanged'));
  }},50));
 });
 const participant='QA_'+Date.now();const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.EARLYBIRD_TEST_URL||'http://127.0.0.1:8767';
 await page.clock.install();await page.goto(base+'/#measurement');
 await page.waitForFunction(()=>document.querySelectorAll('.score-card').length===6);
 let checks=0;const eq=(a,b)=>{assert.equal(a,b);checks++;};
 eq(await page.locator('#overall-score').innerText(),'—');eq(await page.locator('#start-trial').isDisabled(),true);
 await page.locator('#participant').fill(participant);await Promise.all([page.waitForFunction(()=>window.earlybirdNavigate),page.locator('#participant').dispatchEvent('change')]);
 await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('QA_'));await page.locator('#connect-L').click();await page.clock.runFor(600);
 await page.waitForFunction(()=>document.getElementById('status-L').textContent==='실시간 수신');eq(await page.locator('#front').innerText(),'100');
 await page.locator('#connect-R').click();await page.clock.runFor(100);eq((await page.locator('#notice').innerText()).includes('서로 다른'),true);
 async function calibrate(side,failedLoad=false){
  await page.evaluate(()=>earlybirdNavigate('measurement'));
  await page.locator('#select-'+side).click();await page.locator('#calibrate').click();await page.locator('#cal-capture').click();await page.clock.runFor(4100);
  console.log('CALIBRATION_STAGE',side,await page.locator('#cal-stage').innerText(),await page.locator('#cal-feedback').innerText());eq((await page.locator('#cal-stage').innerText()).includes('2 / 2'),true);
  if(failedLoad){await page.locator('#cal-capture').click();await page.clock.runFor(4100);eq((await page.locator('#cal-feedback').innerText()).includes('부족'),true);}
  await page.evaluate(s=>qaModes[s]='loaded',side);await page.clock.runFor(100);
  await page.locator('#cal-capture').click();await page.clock.runFor(4100);
  await page.locator('#calibration-dialog').waitFor({state:'hidden'});
  eq((await page.locator('#calibration-status').innerText()).includes('보정 적용됨'),true);
 }
 await calibrate('L',true);
 await page.evaluate(()=>qaNext='R');await page.locator('#connect-R').click();await page.clock.runFor(600);await page.waitForFunction(()=>document.getElementById('status-R').textContent==='실시간 수신');
 await calibrate('R');await page.evaluate(()=>{qaModes.L='walk';qaModes.R='walk';});
 await page.locator('#auto-report-enabled').uncheck();
 for(let index=1;index<=3;index++){
  await page.evaluate(()=>earlybirdNavigate('measurement'));
  await page.evaluate(n=>qaTrial=n,index);await page.locator('#start-trial').click();await page.clock.runFor(16000);await page.locator('#stop-trial').click();
  await page.evaluate(()=>earlybirdNavigate('analysis'));
  await page.waitForFunction(n=>document.querySelectorAll('.history-row').length===n,index);
  const button=page.getByRole('button',{name:'정상 기준선에 추가',exact:true});eq(await button.count(),1);await button.click();
  await page.waitForFunction(n=>Array.from(document.querySelectorAll('.history-row button')).filter(x=>x.textContent==='기준선에 추가됨').length===n,index);
  console.log('SYNTHETIC_NORMAL_TRIAL_SAVED',index);
 }
 await page.clock.runFor(700);
 eq(await page.locator('#score-movement').innerText(),'—');eq(await page.locator('#score-jerk').innerText(),'—');
 assert.notEqual(await page.locator('#overall-score').innerText(),'—');checks++;
 assert.notEqual(await page.locator('#asymmetry-ai').innerText(),'—');checks++;
 const state=await page.evaluate(async p=>(await fetch('/api/state?participant='+p)).json(),participant);eq(state.trials.length,3);eq(state.trials.filter(t=>t.baseline).length,3);eq(Object.keys(state.devices).length,2);
 const raw=await page.evaluate(async id=>(await fetch('/api/trials/'+id+'/raw.csv')).text(),state.trials[0].id);assert.ok(raw.includes('accel_x'));assert.ok(raw.includes('SYNTHETIC_L'));assert.ok(raw.includes('SYNTHETIC_R'));checks+=3;
 const summaryCsv=await page.evaluate(async id=>(await fetch('/api/trials/'+id+'/summary.csv')).text(),state.trials[2].id);eq(summaryCsv.includes('baseline_sd,percent_change,z_score'),true);
 await page.locator('#analysis-select-L').click();await page.clock.runFor(500);
 await page.evaluate(()=>{const banner=document.createElement('p');banner.textContent='QA 검증용 합성 센서 데이터 · 실제 보행 실험 결과가 아닙니다.';banner.className='research-note';document.querySelector('main').prepend(banner);});
 const out=path.resolve(__dirname,'../output/playwright');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'earlybird-synthetic-desktop.png'),fullPage:true});
 await page.locator('#ai-access').fill(fs.readFileSync(path.resolve(__dirname,'../output/AI_ACCESS_CODE.txt'),'utf8').trim());await page.locator('#ai-consent').check();await page.locator('#auto-report-apply').click();
 await page.evaluate(()=>earlybirdNavigate('measurement'));await page.locator('#auto-report-enabled').check();await page.locator('#condition').selectOption('Shuffling');await page.locator('#start-trial').click();await page.clock.runFor(16000);
 await page.evaluate(()=>{window.qaSavedFetch=window.fetch;window.fetch=(url,options)=>String(url).endsWith('/api/trials')&&options?.method==='POST'?Promise.reject(Error('SYNTHETIC_SAVE_FAILURE')):window.qaSavedFetch(url,options);});await page.locator('#stop-trial').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('저장 실패'));
 eq(await page.locator('#backup-pending').isVisible(),true);eq(await page.locator('#start-trial').isDisabled(),true);
 await page.evaluate(()=>window.fetch=window.qaSavedFetch);await page.locator('#retry-save').click();await page.waitForFunction(()=>document.querySelectorAll('.history-row').length===4);
 const retried=await page.evaluate(async p=>(await fetch('/api/state?participant='+p)).json(),participant);eq(retried.trials.find(t=>t.condition==='Shuffling').eligible_baseline,false);eq(await page.locator('#retry-save').isVisible(),false);
 await page.waitForFunction(()=>document.getElementById('auto-report-status').textContent.includes('자동 생성·저장 완료'),null,{timeout:65000});const autoState=await page.evaluate(async p=>(await fetch('/api/platform?participant='+p)).json(),participant);eq(autoState.researchs.filter(x=>x.report.automatic).length,1);eq(autoState.researchs[0].report.ai.model,'gpt-6.1-terra');eq(autoState.researchs[0].report.auto_state,'completed');eq(autoState.researchs[0].report.probability.value,null);await page.evaluate(d=>window.dispatchEvent(new CustomEvent('earlybird:trial-saved',{detail:d})),{participant_id:participant,trial_id:autoState.researchs[0].report.trial_id,started_at:'DUPLICATE_EVENT'});const dedup=await page.evaluate(async p=>(await fetch('/api/platform?participant='+p)).json(),participant);eq(dedup.researchs.filter(x=>x.report.automatic).length,1);
 await page.locator('#disconnect-R').click();await page.clock.runFor(600);eq(await page.locator('#asymmetry-ai').innerText(),'—');
 await page.evaluate(()=>qaModes.L='silent');await page.clock.runFor(2600);eq(await page.locator('#front').innerText(),'—');eq(await page.locator('#overall-score').innerText(),'—');
 await page.evaluate(()=>qaModes.L='walk');await page.clock.runFor(600);assert.notEqual(await page.locator('#front').innerText(),'—');checks++;
 await page.evaluate(()=>qaDisconnect('L'));await page.clock.runFor(3500);eq(await page.locator('#status-L').innerText(),'실시간 수신');
 await page.locator('#participant').fill('OTHER');await Promise.all([page.waitForFunction(()=>window.earlybirdNavigate),page.locator('#participant').dispatchEvent('change')]);await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('OTHER'));await page.clock.runFor(600);eq(await page.locator('#overall-score').innerText(),'—');eq((await page.locator('#calibration-status').innerText()).includes('보정 전'),true);
 eq(await page.locator('#last-summary').innerText(),'');await page.setViewportSize({width:375,height:812});eq(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(out,'earlybird-synthetic-mobile.png'),fullPage:true});
 eq(errors.length,0);console.log('PASS_EARLYBIRD_SYNTHETIC_UI',JSON.stringify({checks,trials:4,baselineTrials:3,deviceCount:2,pageErrors:errors}));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
