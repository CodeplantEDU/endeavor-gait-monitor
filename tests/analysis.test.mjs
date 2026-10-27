// Synthetic engineering fixtures only; these are not human gait or clinical validation data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SampleStream, captureReference, finishCalibration, analyze, buildBaseline, deviation, score, asymmetry, composite } from '../dist/analysis.mjs';
const config=JSON.parse(fs.readFileSync(new URL('../config.json',import.meta.url)));
const calibration={front:{zero:100,loaded:1100,span:1000},rear:{zero:100,loaded:1100,span:1000},orientation:{roll:0,pitch:0,yaw:0}};
function fixture({seconds=24,period=1,gap=false}={}) {
  const stream=new SampleStream(config), rows=[];
  for(let i=0;i<seconds*20;i++) {
    if(gap&&i>=180&&i<200)continue;
    const t=i/20,phase=(t%period)/period;
    rows.push(stream.push({status:2,sequence:i,uptime:i*50,front:phase>=.2&&phase<.7?1100:100,rear:phase<.3?1100:100,roll:0,pitch:8*Math.sin(2*Math.PI*t/period),yaw:0},1_700_000_000_000+i*50,calibration));
  }
  return rows;
}
test('calibration uses measured span; circular angle mean handles +/-180 boundary',()=>{
  const samples=Array.from({length:80},(_,i)=>({status:2,pc_timestamp_ms:i*50,front:100,rear:120,roll:i%2?179.5:-179.5,pitch:1,yaw:i%2?179:-179}));
  const free=captureReference(samples,config),loaded=captureReference(samples.map(s=>({...s,front:1100,rear:1120})),config);
  const saved=finishCalibration(free,loaded,config);
  assert.ok(Math.abs(Math.abs(saved.orientation.roll)-180)<.01);
  assert.equal(saved.front.on,250);assert.equal(saved.front.off,180);assert.equal(saved.rear.span,1000);
  assert.throws(()=>finishCalibration(free,free,config));
  assert.throws(()=>captureReference(samples.slice(0,2),config));
  assert.throws(()=>captureReference(samples.map((s,i)=>({...s,pitch:i%2?10:-10})),config));
});
test('five-sample filtering preserves raw values and missing channels remain null',()=>{
  const stream=new SampleStream(config);
  let last;
  for(let i=0;i<5;i++)last=stream.push({status:2,sequence:i,uptime:i*50,front:100+i*100,rear:100,roll:0,pitch:i,yaw:0},100000+i*50,calibration);
  assert.equal(last.front,500);assert.equal(last.front_norm,.4);assert.equal(last.front_norm_filtered,.2);
  for(const key of ['accel_x','accel_y','accel_z','gyro_x','gyro_y','gyro_z'])assert.equal(last[key],null);
});
test('sequence wrap, uptime wrap and reboot are distinguished; duplicate packets ignored',()=>{
  const stream=new SampleStream(config), packet={status:2,sequence:65535,uptime:0xfffffff0,front:100,rear:100,roll:0,pitch:0,yaw:0};
  stream.push(packet,100000,calibration);
  const wrapped=stream.push({...packet,sequence:0,uptime:34},100050,calibration);
  assert.equal(wrapped.reboot,false);assert.equal(wrapped.missing_before,0);assert.equal(wrapped.esp_unwrapped_ms,0x100000000+34);
  assert.equal(stream.push({...packet,sequence:0,uptime:34},100060,calibration),null);
  const reset=stream.push({...packet,sequence:1,uptime:0},100100,calibration);
  assert.equal(reset.reboot,true);assert.equal(reset.front_norm,undefined);
});
test('periodic synthetic pressure gives separate contact events, pitch range and zero interval CV',()=>{
  const result=analyze(fixture(),config);
  assert.equal(result.ready,true);assert.ok(result.events.heel.length>=15);assert.ok(result.events.forefoot.length>=15);
  assert.ok(result.metrics.pitch_range>10);assert.ok(result.metrics.total_contact>result.metrics.heel_contact);
  assert.equal(result.metrics.interval_mean,1);assert.ok(result.metrics.interval_cv<1e-7);
  assert.equal(result.metrics.pressure_ratio,1);
});
test('incomplete or constant contact never creates invented strike intervals or a score',()=>{
  const rows=fixture({seconds:3});assert.equal(analyze(rows,config).ready,false);
  const constant=fixture().map(r=>({...r,front_norm_filtered:1,rear_norm_filtered:1}));
  const result=analyze(constant,config);assert.equal(result.events.heel.length,0);assert.equal(result.metrics.interval_cv,null);assert.equal(result.ready,false);
  assert.equal(composite([score(result,{},config)],null,config),null);
});
test('packet gaps reset filters and interval calculations never span the gap',()=>{
  const rows=fixture({gap:true}),gapRow=rows.find(r=>r.missing_before>0);
  assert.equal(gapRow.missing_before,20);assert.equal(gapRow.front_norm_filtered,gapRow.front_norm);
  const result=analyze(rows,config);assert.ok(result.quality.gaps>0);assert.equal(result.metrics.interval_mean,1);
});
test('baseline needs independent trials; score mapping and zero variance guards are explicit',()=>{
  const one=buildBaseline([{pitch_range:10}],3);assert.equal(deviation(10,one.pitch_range,config),null);
  const ref=buildBaseline([{pitch_range:9},{pitch_range:10},{pitch_range:11}],3).pitch_range;
  assert.equal(deviation(10,ref,config).score,100);assert.ok(deviation(12,ref,config).score<20);
  assert.equal(deviation(0,{ready:true,mean:0,sd:0},config).score,null);
  const result=analyze(fixture(),config), baseline=buildBaseline([result.metrics,result.metrics,result.metrics],3);
  const groups=score(result,baseline,config).groups;assert.equal(groups.movement,null);assert.equal(groups.jerk,null);
});
test('left/right AI handles missing data and zero denominators without fabricating symmetry',()=>{
  assert.equal(asymmetry(0,0),null);assert.equal(asymmetry(null,1),null);assert.equal(asymmetry(5,5),0);assert.ok(Math.abs(asymmetry(10,20)-66.6666667)<1e-6);
});
