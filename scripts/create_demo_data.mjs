import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {analyzeTrial,FIELDS} from '../dist/research-analysis.mjs';
import {mean,sd} from '../dist/analysis.mjs';
import {validateReport,explain} from '../api/ai-analyze.mjs';
const out='output/demo_20261027';mkdirSync(out,{recursive:true});
const config=JSON.parse(readFileSync('config.json','utf8'));let seed=20261027;
const random=()=>((seed=(1664525*seed+1013904223)>>>0)+.5)/4294967296;
const normal=()=>Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random());
function generate(trial,current=false){const samples=[];for(const side of ['L','R']){const left=side==='L',cycles=[];let t=-.5;while(t<62){const stride=Math.max(.85,Math.min(1.5,1.12+normal()*(current?(left?.075:.05):.026))),stance=Math.max(.52,Math.min(.72,.62+normal()*(current?.022:.006)));cycles.push({t,stride,stance,front:Math.max(.35,.84+(current&&left?-.14:0)+normal()*(current?(left?.075:.038):.020)),rear:Math.max(.4,.93+normal()*(current?(left?.065:.035):.022)),angle:current?(left?14:17):19});t+=stride;}
let c=0;for(let i=0;i<=1200;i++){const time=i/20;while(c+1<cycles.length&&cycles[c+1].t<=time)c++;const cycle=cycles[c],phase=(time-cycle.t)/cycle.stride;const rear=phase>=.02&&phase<cycle.stance*.62?cycle.rear*Math.sin(Math.PI*(phase-.02)/(cycle.stance*.62-.02))**.35:0,front=phase>=.18&&phase<cycle.stance?cycle.front*Math.sin(Math.PI*(phase-.18)/(cycle.stance-.18))**.45:0;const pc=Date.parse('2026-10-27T10:00:00+09:00')+trial*120000+i*50;
samples.push({side,status:2,device_id:'SIMULATED_'+side,calibration_id:'SIMULATED_CAL_'+side,sequence:i,pc_timestamp_ms:pc,pc_timestamp:new Date(pc).toISOString(),esp_unwrapped_ms:trial*100000+i*50,esp_timestamp:trial*100000+i*50,missing_before:0,front_norm:front,rear_norm:rear,pitch_relative:cycle.angle*Math.sin(2*Math.PI*phase),front:Math.round(100+front*1100),rear:Math.round(100+rear*1100),roll:1.5*Math.sin(2*Math.PI*phase),pitch:cycle.angle*Math.sin(2*Math.PI*phase),yaw:0,accel_x:null,accel_y:null,accel_z:null,gyro_x:null,gyro_y:null,gyro_z:null});}}
return{id:'DEMO-'+trial,participant_id:'DEMO-001',condition:'Normal',config_snapshot:config,calibration_ids:{L:'SIMULATED_CAL_L',R:'SIMULATED_CAL_R'},samples};}
const protocol={straight:true,speed_mps:1.10,matched:true};
const baselineTrials=[1,2,3].map(n=>generate(n)),baseline=baselineTrials.map(t=>analyzeTrial(t,config,protocol));
const reference=Object.fromEntries(['L','R'].map(side=>[side,Object.fromEntries(Object.keys(FIELDS).map(k=>{const values=baseline.map(r=>r.sides[side].metrics[k]).filter(Number.isFinite);return[k,{n:values.length,mean:mean(values),sd:sd(values)}];}))]));
const trial=generate(4,true),report=analyzeTrial(trial,config,protocol,reference);
for(const r of [...baseline,report])for(const side of ['L','R'])if(!r.sides[side].quality.usable)throw Error('Demo quality failed '+JSON.stringify(r.sides[side].quality));
if(report.assessment.flags<2)throw Error('Demo must illustrate actual computed changes');
process.env.OPENAI_MODEL='gpt-6.1-terra';
report.ai=await explain(validateReport(report),'외부 제출용 시연 보고서를 위한 가상 데이터입니다. 실제 환자·실측 사례가 아닙니다. 제공된 계산값에 근거해 관찰, 측정 한계, 동일 조건 재측정, 변화가 지속될 때의 전문 의료진 상담 조건을 전문적인 한국어로 간결하게 정리하세요. 진단·개인 질병 확률·치료 지시는 작성하지 마세요.');
const bundle={provenance:{type:'synthetic',label:'가상 시연 데이터 · 실제 환자/실측 아님',seed:20261027,report_id:'EN-GAIT-DEMO-20261027-01',scenario:'동일 조건의 기준 기록 3회와 보행 변동성이 증가한 60초 비교 기록',sampling_hz:20,duration_seconds:60,created_date:'2026-10-27'},config,report,baseline,trial,baselineTrials};
writeFileSync(out+'/demo-data.json',JSON.stringify(bundle,null,2));
const keys=['side','pc_timestamp_ms','esp_timestamp','front','rear','roll','pitch','yaw','front_norm','rear_norm','pitch_relative'];
writeFileSync(out+'/demo-current-samples.csv','\ufeff'+[keys.join(','),...trial.samples.map(r=>keys.map(k=>r[k]).join(','))].join('\r\n'));
console.log(JSON.stringify({model:report.ai.model,flags:report.assessment.flags,status:report.assessment.headline,L:report.sides.L.metrics,R:report.sides.R.metrics,path:out+'/demo-data.json',synthetic:true}));
