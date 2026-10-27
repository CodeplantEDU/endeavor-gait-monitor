// Native physical BLE smoke check on the isolated QA server. No simulated device/data.
const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const{pathToFileURL}=require('node:url');
(async()=>{
 const{decodePacket}=await import(pathToFileURL(path.resolve(__dirname,'../dist/protocol.mjs')));
 const browser=await chromium.launch({channel:'msedge',headless:false,args:['--no-proxy-server']});const context=await browser.newContext({viewport:{width:1440,height:1100}});
 await context.addInitScript(()=>{
  window.physicalFrames=[];
  const proto=globalThis.BluetoothRemoteGATTCharacteristic?.prototype;if(!proto)return;const add=proto.addEventListener;
  proto.addEventListener=function(type,listener,options){const result=add.call(this,type,listener,options);if(type==='characteristicvaluechanged'&&!this.physicalObserver){this.physicalObserver=true;add.call(this,type,event=>{if(physicalFrames.length<3000)physicalFrames.push({at:Date.now(),bytes:Array.from(new Uint8Array(event.target.value.buffer,event.target.value.byteOffset,event.target.value.byteLength))});});}return result;};
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const cdp=await context.newCDPSession(page);await cdp.send('DeviceAccess.enable');let selecting=false;
 cdp.on('DeviceAccess.deviceRequestPrompted',async event=>{console.log('PHYSICAL_CHOOSER',JSON.stringify(event.devices));const device=event.devices.find(d=>d.name==='FSR-MPU-ESP32'||d.id.toUpperCase()==='8C:94:DF:6D:AC:5E');if(device&&!selecting){selecting=true;await cdp.send('DeviceAccess.selectPrompt',{id:event.id,deviceId:device.id});console.log('SELECTED_PHYSICAL_ESP32',device.name);}});
 try{
  await page.goto((process.env.EARLYBIRD_QA_URL||'http://127.0.0.1:8768')+'/#measurement');await page.waitForFunction(()=>document.querySelectorAll('.score-card').length===6);
  assert.equal(await page.evaluate(()=>navigator.bluetooth.requestDevice.toString().includes('[native code]')),true);
  await page.locator('#participant').fill('HW_CHECK');await Promise.all([page.waitForResponse(r=>r.url().includes('participant=HW_CHECK')),page.locator('#participant').dispatchEvent('change')]);
  // Register temporarily as L solely for the transport check; physical foot identity is unverified.
  await page.locator('#connect-L').click();await page.waitForFunction(()=>document.getElementById('imu-status').textContent==='상보 필터 작동 중',null,{timeout:45000});
  await page.waitForFunction(()=>!document.getElementById('notice').classList.contains('error'));
  assert.equal(await page.locator('#status-R').innerText(),'미등록');
  console.log('PHYSICAL_STREAM_READY');let matched=0;const domChecks=[];
  for(let i=0;i<12;i++){
   await page.waitForTimeout(1000);
   const current=await page.evaluate(()=>({shown:Object.fromEntries(['front','rear','roll','pitch','yaw'].map(id=>[id,document.getElementById(id).textContent])),frames:physicalFrames.slice(-40),score:document.getElementById('overall-score').textContent}));
   assert.equal(current.score,'—');
   const match=current.frames.map(f=>decodePacket(new DataView(Uint8Array.from(f.bytes).buffer))).find(p=>p.status===2&&String(p.front)===current.shown.front&&String(p.rear)===current.shown.rear&&p.roll.toFixed(2)===current.shown.roll&&p.pitch.toFixed(2)===current.shown.pitch&&p.yaw.toFixed(2)===current.shown.yaw);
   assert.ok(match,'DOM values must match a recent actual BLE packet');matched++;domChecks.push(current.shown);
  }
  const frames=await page.evaluate(()=>physicalFrames);const packets=frames.map(f=>decodePacket(new DataView(Uint8Array.from(f.bytes).buffer))).filter(p=>p.status===2);
  assert.ok(packets.length>=100);assert.deepEqual(errors,[]);
  const ranges=Object.fromEntries(['front','rear','roll','pitch','yaw'].map(k=>[k,{min:Math.min(...packets.map(p=>p[k])),max:Math.max(...packets.map(p=>p[k]))}]));
  const result={capturedAt:new Date().toISOString(),transport:'native Web Bluetooth, real ESP32, no mocked values',physicalDeviceCount:1,footIdentity:'unverified; temporarily assigned L only in the isolated QA database',readyPackets:packets.length,domChecksMatched:matched,ranges,last:packets.at(-1),calibrationOrHumanGaitTestPerformed:false,pageErrors:errors};
  const out=path.resolve(__dirname,'../output/hardware');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'earlybird-real-ble-result.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(out,'earlybird-real-ble-packets.json'),JSON.stringify(frames));
  await page.evaluate(()=>{const p=document.createElement('p');p.className='research-note';p.textContent='실물 BLE 수신 확인 · 임시 왼발 슬롯 · 실제 착용 발 구분과 보정·보행 실험은 미실행';document.querySelector('main').prepend(p);});
  await page.screenshot({path:path.join(out,'earlybird-real-ble.png'),fullPage:true});console.log('PASS_REAL_BLE_EARLYBIRD',JSON.stringify(result));
 }catch(error){console.log('PHYSICAL_PAGE_STATE',await page.locator('body').innerText().catch(()=>''));throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
