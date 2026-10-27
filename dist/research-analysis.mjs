import { mean, sd, asymmetry, wrap } from './analysis.mjs';

export const VERSION = 'research-2026-10-25-v1';
export const SOURCES = [
  {id:'patoz2023', title:'Patoz et al. (2023) · 속도를 통제한 보행 비교', url:'https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2023.1119390/full', method:'같은 발의 연속 접촉으로 주기를 정의하고 CV·좌우 대칭성을 분석. 100 Hz, 발당 8개 압력 센서, 힘 20 N 접촉 기준. 보행 속도 차이를 통제해야 함.'},
  {id:'weiss2011', title:'Weiss et al. (2011) · 허리 가속도 주파수 분석', url:'https://journals.sagepub.com/doi/10.1177/1545968311424869', method:'허리의 3축 가속도를 256 Hz로 측정하고 0.5–3 Hz PSD를 분석. 현재 신발의 FSR·자세각과 측정 위치·물리량이 다름.'},
  {id:'anderson2026', title:'Anderson et al. (2026) · WearGait-PD', url:'https://www.nature.com/articles/s41597-026-06806-2', method:'동일 발 접촉 사이 주기를 250개 보간점으로 정규화하는 방법을 응용. 여기의 SD는 한 사람의 주기 간 SD이며 논문의 참가자 간 SD와 다름.'},
];
export const FIELDS = {
  stride_mean:['같은 발 보행 주기','s'], stride_cv:['보행 주기 CV','%'],
  stance_mean:['FSR 접촉 시간','s'], stance_cv:['FSR 접촉 시간 CV','%'],
  swing_mean:['FSR 비접촉 시간','s'], stance_percent:['주기 내 접촉 비율','%'],
  cadence:['환산 보행률','걸음/분'], front_peak:['앞 FSR 주기 피크','상대값'], rear_peak:['뒤 FSR 주기 피크','상대값'],
  front_peak_cv:['앞 FSR 피크 CV','%'], rear_peak_cv:['뒤 FSR 피크 CV','%'],
  heel_to_toe:['뒤→앞 접촉 시작 시차','s'], heel_first:['뒤쪽 먼저 감지한 비율','%'], pitch_range:['주기별 피치 범위','°'],
};
export const LIMITATIONS = [
  '이 서비스는 개인 기준선 대비 보행 패턴 변화와 상담 필요성을 안내합니다. 파킨슨병 여부는 전문 의료진의 진료로 확인해야 하며, 집단 평균·z-score·AI 설명을 질병 확률로 해석하지 않습니다.',
  '앞·뒤 FSR의 두 지점 신호는 발 전체 지면반력이나 압력 분포 지도가 아닙니다. 상대값을 N·BW·kPa로 환산하지 않습니다. 논문의 첫째·둘째 힘 피크는 앞·뒤 FSR 피크를 뜻하지 않습니다.',
  'MPU6500의 롤·피치·요만 수신합니다. 3축 원시 가속도·각속도가 없어 가속도 PSD·RMS·Jerk·검증된 동결보행 탐지는 제공하지 않습니다. Yaw는 상대각이며 드리프트가 발생할 수 있습니다.',
  '약 20 Hz 전송의 시간 간격은 약 50 ms입니다. 짧은 지지 구간과 작은 CV를 정밀하게 측정하기 어렵습니다. 250점 보간은 시간 해상도를 높이지 않습니다.',
  '0.1–2.0초 범위를 벗어나거나 누락을 가로지르는 주기는 제외합니다. 느린 보행·정지 구간도 제외될 수 있어 제외 주기가 있으면 변화 단계를 보류합니다. 남은 주기만으로 질병이 없다고 판단하지 않습니다.',
  '좌우 ESP32의 시계는 하드웨어 동기화되지 않았습니다. 양발·한발 지지시간은 산출하지 않으며 좌우 비교는 공통 PC 수신 시간 범위의 발별 요약값에 한정합니다.',
  '속도·직선/회전·신발·장착·보정·약물 상태가 결과에 영향을 줍니다. 변화 확인 단계는 팀의 연구 규칙이며 임상적 질병·낙상 위험도 등급이 아닙니다.',
];
export const PROBABILITY = Object.freeze({value:null, status:'unavailable', reason:'현재 하드웨어에 대한 독립 검증 및 확률 보정된 파킨슨병 예측 모델 없음'});
export const STUDY_VALUES = [
  {source:'Patoz 2023 · Table 2',metric:'보행 주기 (s)',control:'1.107 ± 0.080',pd:'1.071 ± 0.081',p:'0.04'},
  {source:'Patoz 2023 · Table 2',metric:'보행 주기 CV (%)',control:'2.1 ± 0.6',pd:'2.2 ± 0.8',p:'0.37'},
  {source:'Patoz 2023 · Table 2',metric:'입각기 시간 CV (%)',control:'2.9 ± 0.9',pd:'3.4 ± 1.3',p:'0.05'},
  {source:'Weiss 2011 · Table 1 (OFF)',metric:'허리 가속도 지배 주파수 (Hz)',control:'1.84 ± 0.15',pd:'1.71 ± 0.13',p:'0.009'},
];
const cv = a => a.length >= 3 && mean(a) > 1e-8 ? 100 * sd(a) / mean(a) : null;
const time = r => r.esp_unwrapped_ms ?? r.esp_timestamp ?? r.uptime;
const valid = r => r.status === 2 && r.calibration_id && ['front_norm','rear_norm','pitch_relative','pc_timestamp_ms'].every(k=>Number.isFinite(r[k])) && Number.isFinite(time(r));
const broken = (a,b,c) => !a || !valid(a) || !valid(b) || b.calibration_id!==a.calibration_id || b.device_id!==a.device_id || b.reboot || b.missing_before>0 || time(b)<=time(a) || time(b)-time(a)>c.maxGapMs || b.pc_timestamp_ms-a.pc_timestamp_ms>c.maxGapMs;

export function interpolate(rows,key,t) {
  let a=0,b=rows.length-1;
  while(b-a>1){const m=(a+b)>>1;if(time(rows[m])<=t)a=m;else b=m;}
  const span=time(rows[b])-time(rows[a]);
  return span>0 ? rows[a][key]+(rows[b][key]-rows[a][key])*Math.max(0,Math.min(1,(t-time(rows[a]))/span)) : rows[a][key];
}
function ensemble(rows,cycles,key) {
  const curves=cycles.map(c=>{const part=rows.slice(c.a,c.b+1).map(r=>({...r}));
    if(key==='pitch_relative') for(let i=1;i<part.length;i++)part[i][key]=part[i-1][key]+wrap(part[i][key]-part[i-1][key]);
    return Array.from({length:250},(_,i)=>interpolate(part,key,time(part[0])+(time(part.at(-1))-time(part[0]))*i/249));});
  return {n:curves.length,mean:Array.from({length:curves.length?250:0},(_,i)=>mean(curves.map(c=>c[i]))),sd:Array.from({length:curves.length?250:0},(_,i)=>sd(curves.map(c=>c[i]))??0)};
}

// Exploratory FSR Welch PSD; it is not the lower-back accelerometer method of Weiss.
export function spectrum(rows,config) {
  let start=0,bestStart=0,bestLength=0;
  for(let i=0;i<rows.length;i++){if(!valid(rows[i])){start=i+1;continue;}if(broken(rows[i-1],rows[i],config))start=i;const length=i-start+1;if(length>bestLength){bestStart=start;bestLength=length;}}
  let longest=rows.slice(bestStart,bestStart+bestLength);
  if(longest.length<2 || time(longest.at(-1))-time(longest[0])<10000)return {available:false,reason:'PSD에는 누락 없는 연속 보정 신호 10초가 필요합니다.',points:[]};
  longest=longest.filter(r=>time(r)>=time(longest.at(-1))-60000);
  const hz=(longest.length-1)*1000/(time(longest.at(-1))-time(longest[0]));
  if(hz<18 || hz>22)return {available:false,reason:'실효 샘플링이 18–22 Hz 범위를 벗어났습니다.',points:[]};
  const fs=20,n=128,series=[];
  for(let t=time(longest[0]);t<=time(longest.at(-1));t+=50)series.push(interpolate(longest,'front_norm',t)+interpolate(longest,'rear_norm',t));
  const weights=Array.from({length:n},(_,i)=>0.5-0.5*Math.cos(2*Math.PI*i/(n-1))),energy=weights.reduce((a,w)=>a+w*w,0),powers=Array(n/2+1).fill(0);let blocks=0;
  for(let start=0;start+n<=series.length;start+=n/2){const block=series.slice(start,start+n),m=mean(block);blocks++;
    for(let k=0;k<powers.length;k++){let re=0,im=0;for(let j=0;j<n;j++){const v=(block[j]-m)*weights[j],angle=2*Math.PI*k*j/n;re+=v*Math.cos(angle);im-=v*Math.sin(angle);}powers[k]+=(k===0||k===n/2?1:2)*(re*re+im*im)/(fs*energy);}}
  const points=powers.map((v,k)=>({x:k*fs/n,y:v/blocks})).filter(p=>p.x>=0.5&&p.x<=3),peak=points.reduce((a,b)=>b.y>a.y?b:a,points[0]);
  return {available:true,channel:'FSR 합산 상대 신호',method:'20 Hz 선형 리샘플 · Hann 128점 · 50% 중첩 Welch · 0.5–3 Hz',resolution:fs/n,blocks,points,dominant_hz:peak.y>1e-10?peak.x:null,peak_psd:peak.y,unit:'상대값²/Hz'};
}

export function analyzeFoot(rows,config) {
  const metrics=Object.fromEntries(Object.keys(FIELDS).map(k=>[k,null])), contacts=[];
  let front=false,rear=false,open=null,segment=0,last=null;
  let intervals=0,durationMs=0,maxGap=0;
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    if(last && valid(last) && valid(r) && time(r)>time(last)){const dt=time(r)-time(last);maxGap=Math.max(maxGap,dt);if(!broken(last,r,config)){durationMs+=dt;intervals++;}}
    const split=broken(last,r,config);if(split){front=false;rear=false;open=null;segment++;}
    if(!valid(r)){last=r;continue;}
    front=r.front_norm>=config.contactOnFraction?true:r.front_norm<=config.contactOffFraction?false:front;
    rear=r.rear_norm>=config.contactOnFraction?true:r.rear_norm<=config.contactOffFraction?false:rear;
    if((front||rear)&&!open)open={a:i,segment,known:!split,frontOn:null,rearOn:null};
    if(open){if(front&&open.frontOn===null)open.frontOn=time(r);if(rear&&open.rearOn===null)open.rearOn=time(r);}
    if(!front&&!rear&&open){const seconds=(time(r)-time(rows[open.a]))/1000;if(open.known&&seconds>=config.minContactSeconds)contacts.push({...open,to:i,stance:seconds});open=null;}
    last=r;
  }
  const cycles=[];let rejected=0;
  for(let i=0;i<contacts.length-1;i++){
    const e=contacts[i],next=contacts[i+1],stride=(time(rows[next.a])-time(rows[e.a]))/1000;
    // WearGait duration exclusion is adapted; no lost-frame span is accepted.
    if(e.segment!==next.segment||stride<0.1||stride>2||e.stance>=stride){rejected++;continue;}
    const part=rows.slice(e.a,next.a+1),pitch=[part[0].pitch_relative];for(let j=1;j<part.length;j++)pitch.push(pitch.at(-1)+wrap(part[j].pitch_relative-part[j-1].pitch_relative));
    cycles.push({a:e.a,b:next.a,ic_ms:time(rows[e.a]),stride,stance:e.stance,swing:stride-e.stance,stance_percent:100*e.stance/stride,front_peak:Math.max(...part.slice(0,-1).map(r=>r.front_norm)),rear_peak:Math.max(...part.slice(0,-1).map(r=>r.rear_norm)),heel_to_toe:e.frontOn!==null&&e.rearOn!==null?(e.frontOn-e.rearOn)/1000:null,heel_first:e.rearOn!==null&&(e.frontOn===null||e.rearOn<e.frontOn),pitch_range:Math.max(...pitch)-Math.min(...pitch)});
  }
  const pick=k=>cycles.map(s=>s[k]).filter(Number.isFinite);
  if(cycles.length>=3){for(const[k,f]of Object.entries({stride_mean:'stride',stance_mean:'stance',swing_mean:'swing',stance_percent:'stance_percent',front_peak:'front_peak',rear_peak:'rear_peak',heel_to_toe:'heel_to_toe',pitch_range:'pitch_range'}))metrics[k]=mean(pick(f));
    metrics.stride_cv=cv(pick('stride'));metrics.stance_cv=cv(pick('stance'));metrics.front_peak_cv=cv(pick('front_peak'));metrics.rear_peak_cv=cv(pick('rear_peak'));metrics.cadence=120/metrics.stride_mean;metrics.heel_first=100*cycles.filter(c=>c.heel_first).length/cycles.length;}
  const good=rows.filter(valid),missing=rows.reduce((n,r)=>n+(Number.isFinite(r.missing_before)?r.missing_before:0),0),pcDuration=rows.length>1?(rows.at(-1).pc_timestamp_ms-rows[0].pc_timestamp_ms)/1000:0;
  const quality={samples:rows.length,valid_samples:good.length,duration:pcDuration,effective_hz:durationMs>0?intervals*1000/durationMs:null,missing_fraction:missing/Math.max(1,rows.length+missing),max_gap_ms:maxGap,cycles:cycles.length,rejected_cycles:rejected,segments:segment};
  const issues=[];if(good.length!==rows.length||!good.length)issues.push('미보정 또는 MPU 미준비 샘플');if(pcDuration<20)issues.push('기록 20초 미만');if(cycles.length<10)issues.push('유효 주기 10회 미만');if(rejected)issues.push('제외 주기 포함 · 느린 보행·정지·누락 여부 확인');if(quality.missing_fraction>config.maxMissingFraction)issues.push('패킷 누락 10% 초과');if(quality.effective_hz===null||quality.effective_hz<18||quality.effective_hz>22)issues.push('샘플링 속도 확인 필요');if(new Set(good.map(r=>r.calibration_id)).size>1)issues.push('서로 다른 보정 포함');
  quality.usable=issues.length===0;quality.issues=issues;
  return {metrics,quality,cycles,ensemble:Object.fromEntries(['front_norm','rear_norm','pitch_relative'].map(k=>[k,ensemble(rows,cycles,k)])),spectrum:spectrum(rows,config)};
}

export function assessChange(sides,reference,comparable=false) {
  const changes=[];
  for(const side of ['L','R'])for(const key of ['stride_cv','stance_cv','front_peak_cv','rear_peak_cv']){
    const value=sides[side]?.metrics[key],base=reference?.[side]?.[key];
    if(Number.isFinite(value)&&base?.n>=3&&base.mean>1e-8){const percent=100*(value-base.mean)/base.mean;changes.push({side,key,value,baseline:base.mean,n:base.n,percent,flag:percent>=20});}
  }
  const usable=Object.values(sides).length>0&&Object.values(sides).every(s=>s.quality.usable),flags=changes.filter(c=>c.flag).length;
  const zeroReference=Object.values(reference||{}).some(s=>['stride_cv','stance_cv','front_peak_cv','rear_peak_cv'].some(k=>s[k]?.n>=3&&s[k].mean===0));
  const status=!usable?'측정 품질 확인':!comparable?'측정 조건 확인':!changes.length?(zeroReference?'기준선 변동성 0 · 상대 비교 보류':'동일 조건 기준선 필요'):flags>=2?'반복 변화 확인':flags===1?'한 지표 변화 관찰':'설정 기준 내 변화';
  const headline=!usable?'보행 패턴을 확인할 측정이 더 필요합니다':!comparable?'동일한 보행 조건인지 확인해 주세요':!changes.length?'개인 기준선 기록을 더 확인해 주세요':flags>=2?'개인 기준선 대비 보행 패턴 이상 징후가 발견되었습니다':flags===1?'개인 기준선 대비 보행 패턴 변화가 관찰되었습니다':'설정한 변화 기준을 넘는 항목이 없습니다';
  return {status,headline,flags,changes,rule:'팀 연구 규칙: 동일 조건의 독립 기준선 3회 이상 대비 CV가 20% 이상 증가한 항목을 표시. 2개 이상이면 이상 징후 확인 안내. 질병·낙상 위험도 기준 아님.',action:!usable?'재보정·연결 상태 확인 후 다시 기록하세요. 현재 데이터만으로 이상 여부를 판단하지 않습니다.':!comparable?'직선 보행·속도·보정·복약 조건을 확인한 뒤 다시 비교하세요.':!changes.length&&zeroReference?'기준선 CV가 0인 지표의 상대 증가율은 계산하지 않습니다. 보행 원수치와 반복 측정 기록을 확인하세요.':!changes.length?'같은 조건의 Normal 보행 기록을 3회 이상 모아 개인 기준선을 준비하세요.':flags>=2?'같은 조건으로 다시 측정해도 변화가 지속되면 신경과 등 전문 의료진의 평가가 필요합니다. 보행 변화의 원인은 진료를 통해 확인해야 하므로 이 보고서를 상담 자료로 활용하세요.':flags===1?'표시된 지표를 확인하고 같은 조건에서 다시 측정하세요. 변화가 반복되거나 실제 걷기에 불편이 있으면 전문 의료진과 상담하세요.':'같은 조건의 기록을 이어서 비교하세요. 이 결과만으로 질병이 없다고 판단할 수는 없습니다.'};
}
export function analyzeTrial(trial,config,protocol={},reference={}) {
  protocol={straight:false,speed_mps:null,matched:false,...protocol};
  const raw={};for(const side of ['L','R'])raw[side]=(trial.samples||[]).filter(r=>r.side===side);
  const present=Object.keys(raw).filter(s=>raw[s].length),start=Math.max(...present.map(s=>raw[s][0].pc_timestamp_ms)),end=Math.min(...present.map(s=>raw[s].at(-1).pc_timestamp_ms)),overlap=present.length===2&&end>start;
  const sides=Object.fromEntries(present.map(s=>[s,analyzeFoot(overlap?raw[s].filter(r=>r.pc_timestamp_ms>=start&&r.pc_timestamp_ms<=end):raw[s],config)]));
  const ai=Object.fromEntries(Object.keys(FIELDS).map(k=>[k,overlap&&['L','R'].every(s=>sides[s]?.quality.usable)?asymmetry(sides.L.metrics[k],sides.R.metrics[k]):null]));
  const comparable=protocol.straight===true&&Number.isFinite(protocol.speed_mps)&&protocol.speed_mps>0&&protocol.matched===true;
  return {schema:VERSION,created_at:new Date().toISOString(),trial_id:trial.id??null,condition:trial.condition??'unknown',protocol,sides,asymmetry:ai,overlap,reference,assessment:assessChange(sides,reference,comparable),probability:{...PROBABILITY},limitations:[...LIMITATIONS],sources:SOURCES};
}
