import {VERSION, SOURCES} from './research-analysis.mjs';

export const CSV_COLUMNS=['t_s','side','front','rear','roll','pitch','yaw','front_norm','rear_norm','pitch_relative','status','missing_before'];
export const SENSOR_FIELDS=CSV_COLUMNS.slice(2,10);
const numeric=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Math.abs(Number(v))<=1e15?Number(v):null;
const sideOf=v=>({L:'L',R:'R',LEFT:'L',RIGHT:'R','왼발':'L','오른발':'R'})[String(v??'').trim().toUpperCase()];
const round=v=>Number.isFinite(v)?Number(v.toFixed(4)):null;
const error=message=>{throw Error(message);};

export function parseSensorCSV(text,defaultSide){
  if(typeof text!=='string'||text.length>8000000)error('CSV는 8MB 이하로 선택하세요.');
  text=text.replace(/^\uFEFF/,'');
  const first=text.split(/\r?\n/,1)[0],delimiter=[';', '\t', ','].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&(c===delimiter||c==='\n'||c==='\r')){row.push(cell);cell='';if(c!==delimiter){if(row.some(x=>x.trim()))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}}
    else cell+=c;
  }
  if(quoted)error('CSV 따옴표가 닫히지 않았습니다.');
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  if(rows.length<2||rows.length>50001)error('CSV에는 헤더와 1~50,000개의 데이터 행이 필요합니다.');
  const headers=rows.shift().map(x=>x.trim().toLowerCase());
  if(new Set(headers).size!==headers.length)error('CSV 열 이름이 중복되었습니다.');
  if(!headers.some(k=>['front','rear','fsr_forefoot','fsr_heel','front_norm','rear_norm','roll','pitch','yaw'].includes(k)))error('원시·필터 CSV를 선택하세요. 센서 채널 열(front/rear/roll/pitch/yaw 등)이 필요합니다.');
  const samples=rows.map(values=>{const r=Object.fromEntries(headers.map((k,i)=>[k,values[i]??'']));return {...r,side:sideOf(r.side)||(headers.includes('side')?null:defaultSide)};});
  return cleanSensorSamples(samples);
}

export function cleanSensorSamples(samples){
  if(!Array.isArray(samples)||!samples.length||samples.length>50000)error('센서 데이터는 1~50,000행이어야 합니다.');
  const cleaning={input_rows:samples.length,kept_rows:0,dropped_rows:0,duplicate_rows:0,invalid_cells:0,reordered_rows:0,unknown_side_rows:0,missing_time_rows:0,imputed_cells:0};
  const canonical=[];
  const usesPC=['L','R'].map(side=>samples.some(r=>sideOf(r.side)===side&&(numeric(r.pc_timestamp_ms)!==null||Number.isFinite(Date.parse(r.pc_timestamp)))));
  const canonicalTime=samples.every(r=>numeric(r.t_s)!==null);
  const clock=canonicalTime?'relative_csv_not_hardware_sync':usesPC.every(Boolean)?'pc_common':usesPC.some(Boolean)?'mixed_unsynchronized':'per_foot_unsynchronized';
  for(const r of samples){
    const side=sideOf(r.side);if(!side){cleaning.unknown_side_rows++;continue;}
    const pc=numeric(r.pc_timestamp_ms)??(Number.isFinite(Date.parse(r.pc_timestamp))?Date.parse(r.pc_timestamp):null);
    const t=usesPC[side==='L'?0:1]?pc:numeric(r.t_s)!==null?numeric(r.t_s)*1000:numeric(r.esp_unwrapped_ms)??numeric(r.esp_timestamp)??numeric(r.uptime);
    if(t===null){cleaning.missing_time_rows++;continue;}
    const item={side,t};
    for(const key of [...SENSOR_FIELDS,'status','missing_before']){
      const raw=r[key]??(key==='front'?r.fsr_forefoot:key==='rear'?r.fsr_heel:undefined),value=numeric(raw);
      if(raw!==null&&raw!==undefined&&String(raw).trim()!==''&&value===null)cleaning.invalid_cells++;
      item[key]=value!==null&&Math.abs(value)<=1e9?value:null;
    }
    if(SENSOR_FIELDS.every(k=>item[k]===null))continue;
    canonical.push(item);
  }
  if(!canonical.length)error('시간·발 구분·센서값을 읽을 수 없습니다. 원시 CSV의 side와 pc_timestamp_ms 또는 esp_timestamp 열을 확인하세요.');
  const firstPC=Math.min(...canonical.map(r=>r.t));
  const rows=[];
  for(const side of ['L','R']){
    const foot=canonical.filter(r=>r.side===side),sorted=[...foot].sort((a,b)=>a.t-b.t);
    cleaning.reordered_rows+=foot.filter((r,i)=>r!==sorted[i]).length;
    const origin=canonicalTime?0:clock==='pc_common'?firstPC:sorted[0]?.t;let previous=null;
    for(const r of sorted){if(r.t===previous){cleaning.duplicate_rows++;continue;}previous=r.t;rows.push({...r,t_s:round((r.t-origin)/1000)});}
  }
  cleaning.kept_rows=rows.length;cleaning.dropped_rows=samples.length-rows.length;
  return {rows,cleaning,clock};
}

function stats(values){
  if(!values.length)return {n:0,min:null,max:null,mean:null,sd:null,median:null,p05:null,p95:null};
  const sorted=[...values].sort((a,b)=>a-b),mean=values.reduce((a,b)=>a+b,0)/values.length;
  const q=p=>{const i=(sorted.length-1)*p,a=Math.floor(i);return sorted[a]+(sorted[Math.ceil(i)]-sorted[a])*(i-a);};
  return {n:values.length,min:round(sorted[0]),max:round(sorted.at(-1)),mean:round(mean),sd:values.length>1?round(Math.sqrt(values.reduce((n,v)=>n+(v-mean)**2,0)/(values.length-1))):null,median:round(q(.5)),p05:round(q(.05)),p95:round(q(.95))};
}

export function summarizeCSV(clean){
  const sides={};
  for(const side of ['L','R']){
    const rows=clean.rows.filter(r=>r.side===side);if(!rows.length)continue;
    const intervals=rows.slice(1).map((r,i)=>round(r.t_s-rows[i].t_s)),duration=rows.at(-1).t_s-rows[0].t_s;
    sides[side]={samples:rows.length,duration_seconds:round(duration),effective_hz:duration>0?round((rows.length-1)/duration):null,gaps_over_200ms:intervals.filter(x=>x>.2).length,max_gap_seconds:intervals.length?Math.max(...intervals):null,reported_missing:rows.reduce((n,r)=>n+Math.max(0,r.missing_before||0),0),imu_not_ready:rows.filter(r=>r.status!==null&&r.status!==2).length,channels:Object.fromEntries(SENSOR_FIELDS.map(k=>[k,{...stats(rows.map(r=>r[k]).filter(Number.isFinite)),missing_cells:rows.filter(r=>r[k]===null).length}]))};
  }
  return {sides,clock:clean.clock,cleaning:clean.cleaning,method:'숫자 열만 보존·발별 시간 정렬·동일 시각 중복 제거·빈칸과 공백 유지. 임의 대체값 및 주기 수 조건 없음.'};
}

export const encodeSensorCSV=rows=>[CSV_COLUMNS.join(','),...rows.map(r=>CSV_COLUMNS.map(k=>k==='side'?r[k]:Number.isFinite(r[k])?String(round(r[k])):'').join(','))].join('\n');
export function makeCSVReport(trial,protocol={}){
  const clean=trial.cleaned||cleanSensorSamples(trial.samples),summary=summarizeCSV(clean);
  const text=encodeSensorCSV(clean.rows);
  if(text.length>2500000)error('정제된 CSV가 2.5MB를 넘습니다. 원본은 보관되며 파일을 나누어 분석해 주세요.');
  return {schema:VERSION,input_mode:'csv',source_type:trial.source_type||'trial',created_at:new Date().toISOString(),trial_id:trial.id??null,condition:trial.condition||'unknown',protocol,csv:{text,summary},probability:{value:null,status:'clinical_evaluation'},sources:SOURCES};
}

export function csvForAI(text,sourceCleaning){
  const clean=parseSensorCSV(text),summary=summarizeCSV(clean);
  // shortcut: bound prompt size on long recordings; always disclose retained rows and interval.
  const step=Math.max(1,Math.ceil(clean.rows.length/3000)),sampled=clean.rows.filter((_,i)=>i%step===0||i===clean.rows.length-1);
  const cleaning={};for(const key of Object.keys(clean.cleaning)){const n=sourceCleaning?.[key];if(Number.isInteger(n)&&n>=0&&n<=10000000)cleaning[key]=n;}
  return {mode:'csv',summary,source_cleaning:cleaning,transmitted_rows:sampled.length,cleaned_total_rows:clean.rows.length,representative_step:step,csv:encodeSensorCSV(sampled),notes:step===1?'정제된 전체 CSV 행입니다.':'전체 정제 기록의 통계와 시간 간격을 넓혀 선택한 CSV 행입니다. 대표 행 사이 공백을 원래 신호의 끊김이나 실제 보행 주기로 해석하지 마세요.'};
}
