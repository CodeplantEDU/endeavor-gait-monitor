import { SERVICE_UUID, DATA_UUID, decodePacket } from './protocol.mjs';
import { METRICS, GROUPS, SampleStream, captureReference, finishCalibration, analyze, buildBaseline, score, asymmetry, deviation, composite, mean } from './analysis.mjs';

const $ = id => document.getElementById(id);
const SIDES = ['L', 'R'], names = {L: '왼발', R: '오른발'};
const labels = {movement:'움직임', rotation:'발 들림·회전', jerk:'움직임 변화', pressure:'압력 패턴', contact:'접촉시간', rhythm:'리듬 안정성'};
const keysAI = ['pitch_range','forefoot_peak','heel_peak','total_contact','interval_mean'];
const unit = key => key === 'pitch_range' ? '°' : key === 'interval_cv' ? '%' : key.includes('contact') || key.startsWith('interval_') ? 's' : '';
const fmt = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const pcStart = Date.now(), monotonicStart = performance.now();
const now = () => pcStart + performance.now() - monotonicStart;
const analysisSignature = settings => JSON.stringify(['filterSamples','windowSeconds','contactOnFraction','contactOffFraction','minContactSeconds','minIntervals'].map(key=>settings[key]));
let config, state = {devices:{},calibrations:{},trials:[]}, participant = 'P1', selected = 'L';
try { const saved=localStorage.getItem('earlybird-participant'); if (/^[A-Za-z0-9_-]{1,24}$/.test(saved||'')) participant=saved; } catch {}
let trial = null, pending = null, wizard = null, chart = 'pressure', latestSnapshot;
const links = Object.fromEntries(SIDES.map(side => [side, {side, device:null, characteristic:null, rows:[], latest:null, calibration:null, busy:false, want:false, retry:null, delay:2000, invalidCalibration:null}]));

function notice(message, error = false) { $('notice').hidden = !message; $('notice').textContent = message; $('notice').classList.toggle('error', error); }
async function api(path, payload) {
  const response = await fetch(path, payload === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '서버 요청이 실패했습니다.');
  return result;
}
async function loadState(reset = false) {
  state = await api(`/api/state?participant=${encodeURIComponent(participant)}`);
  if (reset) $('last-summary').replaceChildren();
  for (const side of SIDES) {
    const link = links[side], saved = state.calibrations[side];
    const next = saved && saved.id !== link.invalidCalibration && (!link.device || saved.device_id === link.device.id) ? saved : null;
    if (reset || link.calibration?.id !== next?.id) { link.rows = []; if (link.stream) link.stream.filtered = []; }
    link.calibration = next;
  }
  renderHistory();
  window.dispatchEvent(new CustomEvent('earlybird:state',{detail:{participant,state}}));
}
function fresh(link) { return !!link.device?.gatt.connected && !!link.latest && now() - link.latest.pc_timestamp_ms <= config.staleMs; }
function cleanListeners(link) {
  if (link.characteristic) link.characteristic.removeEventListener('characteristicvaluechanged', link.receive);
  link.characteristic = null;
  if (link.device) link.device.removeEventListener('gattserverdisconnected', link.lost);
}
function lost(side) {
  const link = links[side]; cleanListeners(link);
  if (wizard?.side === side) { wizard = null; $('calibration-dialog').close(); notice(`${names[side]} 연결이 끊겨 보정을 취소했습니다.`,true); }
  if (link.want && !link.retry) {
    link.retry = setTimeout(async () => {
      link.retry = null;
      if (!link.want || link.busy) return;
      link.busy = true;
      try { await attach(side); link.delay = 2000; notice(`${names[side]} BLE 재연결 완료.`); }
      catch { cleanListeners(link); if (link.device?.gatt.connected) link.device.gatt.disconnect(); link.delay = Math.min(15000, link.delay * 2); }
      finally { link.busy = false; if (!link.device?.gatt.connected) lost(side); }
    }, link.delay);
  }
  render();
}
async function attach(side) {
  const link = links[side]; cleanListeners(link);
  link.lost = () => lost(side);
  link.device.addEventListener('gattserverdisconnected', link.lost);
  const server = await link.device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  link.characteristic = await service.getCharacteristic(DATA_UUID);
  link.receive = event => received(side, event.target.value);
  link.characteristic.addEventListener('characteristicvaluechanged', link.receive);
  await link.characteristic.startNotifications();
  if (!link.device.gatt.connected) throw Error('연결이 끊겼습니다.');
}
async function connect(side) {
  const link = links[side]; if (link.busy) return;
  let attaching = false;
  link.busy = true; render();
  try {
    let device;
    if (!link.device?.gatt.connected && state.devices[side] && navigator.bluetooth.getDevices) device = (await navigator.bluetooth.getDevices()).find(d => d.id === state.devices[side].device_id);
    if (!device) device = await navigator.bluetooth.requestDevice({filters:[{services:[SERVICE_UUID]}]});
    const other = links[side === 'L' ? 'R' : 'L'];
    if (other.device?.id === device.id) throw Error('반대쪽 발에 연결한 장치입니다. 각 발의 서로 다른 ESP32를 선택하세요.');
    await api('/api/devices',{side,device_id:device.id,device_name:device.name || 'FSR-MPU-ESP32'});
    link.want = false; clearTimeout(link.retry); link.retry = null;
    if (link.device?.gatt.connected) { cleanListeners(link); link.device.gatt.disconnect(); }
    if (link.device?.id !== device.id) { link.stream = new SampleStream(config); link.rows=[]; link.latest=null; }
    link.device=device; link.want=true; link.delay=2000;
    attaching = true; await loadState(); await attach(side);
    notice(`${names[side]} 등록·연결 완료. 보정 후 실험을 시작하세요.`);
  } catch (error) {
    notice(error.name === 'NotFoundError' ? '장치 선택을 취소했습니다.' : error.message,true);
    if (attaching) { cleanListeners(link); if (link.device?.gatt.connected) link.device.gatt.disconnect(); }
    if (link.want && link.device && !link.device.gatt.connected) lost(side);
  } finally { link.busy=false; render(); }
}
function disconnect(side) {
  const link = links[side]; link.want=false; clearTimeout(link.retry); link.retry=null;
  cleanListeners(link); if (link.device?.gatt.connected) link.device.gatt.disconnect();
  render();
}
function received(side, value) {
  const link=links[side];
  try {
    const packet=decodePacket(value), receivedAt=now();
    if (!link.latest && link.calibration && packet.uptime < link.calibration.uptime && link.calibration.uptime - packet.uptime < 0x80000000) {
      link.invalidCalibration=link.calibration.id; link.calibration=null;
      notice(`${names[side]} ESP32 재시작이 감지되었습니다. 센서를 다시 보정하세요.`,true);
    }
    const row=link.stream.push(packet,receivedAt,link.calibration); if (!row) return;
    if (row.reboot) { link.invalidCalibration=link.calibration?.id; link.calibration=null; notice(`${names[side]} 재부팅으로 보정을 해제했습니다.`,true); }
    Object.assign(row,{side,device_id:link.device.id,calibration_id:link.calibration?.id ?? null});
    link.latest=row; link.rows.push(row); link.rows=link.rows.filter(s=>s.pc_timestamp_ms>=receivedAt-60000);
    if (wizard?.side===side && wizard.capturing) wizard.samples.push(row);
    if (trial && trial.sides.includes(side)) {
      trial.samples.push({...row});
      if (trial.samples.length>=24000) void stopTrial();
    }
  } catch (error) { notice(`${names[side]}: ${error.message}`,true); }
}
function snapshot() {
  const analysis={}, scored={}, baseline={};
  let end=now(), overlap=false, start=end-config.windowSeconds*1000;
  if (SIDES.every(s=>fresh(links[s]) && links[s].calibration)) {
    end=Math.min(...SIDES.map(s=>links[s].latest.pc_timestamp_ms));
    start=Math.max(end-config.windowSeconds*1000,...SIDES.map(s=>links[s].rows[0]?.pc_timestamp_ms ?? end)); overlap=true;
  }
  for (const side of SIDES) {
    const link=links[side];
    analysis[side]=analyze(link.rows.filter(r=>r.pc_timestamp_ms>=start),config,end);
    if (!fresh(link)) { analysis[side].ready=false; analysis[side].reason='실시간 수신을 기다리고 있습니다.'; }
    const observations=state.trials.filter(t=>t.baseline && t.calibration_ids[side]===link.calibration?.id && analysisSignature(t.config_snapshot)===analysisSignature(config)).map(t=>t.summary[side]?.metrics).filter(Boolean);
    baseline[side]=buildBaseline(observations,config.baselineMinTrials);
    scored[side]=score(analysis[side],baseline[side],config);
  }
  const ai=Object.fromEntries(Object.keys(METRICS).map(k=>[k,overlap && SIDES.every(s=>analysis[s].ready) ? asymmetry(analysis.L.metrics[k],analysis.R.metrics[k]) : null]));
  const aiValues=keysAI.map(k=>ai[k]).filter(Number.isFinite), aiMean=aiValues.length===keysAI.length ? mean(aiValues):null;
  const aiObservations=state.trials.filter(t=>t.baseline && analysisSignature(t.config_snapshot)===analysisSignature(config) && SIDES.every(s=>t.calibration_ids[s]===links[s].calibration?.id && t.summary[s]?.ready)).map(t=> {
    const values=keysAI.map(k=>asymmetry(t.summary.L.metrics[k],t.summary.R.metrics[k]));
    return values.every(Number.isFinite)?mean(values):null;
  }).filter(Number.isFinite);
  const aiReference=buildBaseline(aiObservations.map(x=>({pitch_range:x})),config.baselineMinTrials).pitch_range;
  const aiScore=deviation(aiMean,aiReference,config)?.score ?? null;
  return {analysis,scored,baseline,ai,aiMean,aiScore,overlap,overall:composite(SIDES.map(s=>scored[s]),aiScore,config)};
}
function render() {
  if (!config) return;
  const timestamp=now(), busy=!!trial || !!pending || !!wizard;
  for (const side of SIDES) {
    const link=links[side], registered=state.devices[side], connected=link.device?.gatt.connected;
    const badge=$(`status-${side}`);
    badge.textContent=link.busy ? '연결 중' : fresh(link) ? (link.latest.status===2 ? '실시간 수신' : link.latest.status===1 ? 'MPU 보정 중' : 'MPU 오류') : connected ? '수신 대기·중단' : link.retry ? '재연결 대기' : registered ? '등록됨·미연결':'미등록';
    badge.classList.toggle('live',fresh(link)&&link.latest.status===2);
    $(`device-${side}`).textContent=registered ? `${registered.device_name} · 식별자 …${registered.device_id.slice(-8)}`:`${names[side]} ESP32를 선택하세요.`;
    $(`quality-${side}`).textContent=link.latest ? `마지막 패킷 #${link.latest.sequence} · 누락 추정 ${link.stream.missing}개 · ${Math.max(0,(timestamp-link.latest.pc_timestamp_ms)/1000).toFixed(1)}초 전`:'수신 대기';
    $(`connect-${side}`).disabled=!navigator.bluetooth || !isSecureContext || link.busy || !!wizard || (!!trial && connected) || !!pending;
    $(`connect-${side}`).textContent=connected ? '등록 변경' : registered ? `${names[side]} 재연결`:`${names[side]} 등록·연결`;
    $(`disconnect-${side}`).disabled=!connected && !link.retry;
    $(`select-${side}`).setAttribute('aria-pressed',String(side===selected));
    document.getElementById(`analysis-select-${side}`)?.setAttribute('aria-pressed',String(side===selected));
  }
  const link=links[selected], live=fresh(link), sample=live?link.latest:null;
  for (const key of ['front','rear','roll','pitch','yaw']) $(key).textContent=sample && (['front','rear'].includes(key)||sample.status===2) ? (['front','rear'].includes(key)?String(sample[key]):fmt(sample[key])):'—';
  for (const [id,key] of [['front-normalized','front_norm'],['rear-normalized','rear_norm']]) $(id).textContent=Number.isFinite(sample?.[key])?`보정 상대값 ${fmt(sample[key]*100,1)}% · 임상 압력 단위 아님`:'보정 전 또는 수신 대기';
  for (const key of ['roll','pitch','yaw']) $(`${key}-relative`).textContent=Number.isFinite(sample?.[`${key}_relative`])?`기준점 대비 ${fmt(sample[`${key}_relative`])}°`:'기준점 전 또는 수신 대기';
  $('status').textContent=live?'실시간 수신 중':link.device?.gatt.connected?'데이터 수신 멈춤':'연결 대기';
  $('imu-status').textContent=sample?['MPU6500 응답 없음','정지 상태 보정 중','상보 필터 작동 중'][sample.status]:'수신 대기';
  $('updated').textContent=sample?new Date(sample.pc_timestamp_ms).toLocaleTimeString('ko-KR',{hour12:false}):'수신 전';
  $('message').textContent=sample?.status===0?'FSR은 수신되지만 MPU6500이 준비되지 않았습니다.':sample?.status===1?'ESP32의 자이로 편차 보정 중입니다. 센서를 정지시키세요.':'자세 기준점은 웹에서 보정하며 Yaw는 상대 회전입니다. 센서 재부팅 후 다시 보정하세요.';
  $('calibration-status').textContent=`${names[selected]} · ${link.calibration ? '보정 적용됨 · '+new Date(link.calibration.created_at).toLocaleTimeString('ko-KR',{hour12:false}):'보정 전'}`;
  $('calibrate').disabled=!live || sample?.status!==2 || busy;
  for (const id of ['participant','condition','trial-number']) $(id).disabled=busy;
  $('start-trial').disabled=busy || !SIDES.some(s=>fresh(links[s])&&links[s].latest.status===2&&links[s].calibration);
  $('stop-trial').disabled=!trial;
  $('retry-save').hidden=!pending;
  $('backup-pending').hidden=!pending;
  $('recording-status').textContent=trial ? `기록 중 · ${((timestamp-trial.start)/1000).toFixed(1)}초 · ${trial.samples.length}개 샘플 · ${trial.sides.map(s=>names[s]).join(' / ')}`:pending?'미저장 데이터가 메모리에 남아 있습니다. 저장을 다시 시도하거나 임시 JSON을 내려받으세요.':'기록 대기 · 원시 가속도·각속도 열은 미수신 항목이므로 CSV에서도 빈칸입니다.';
  if (trial && timestamp-trial.start>=config.maxTrialSeconds*1000) void stopTrial();
  window.dispatchEvent(new CustomEvent("earlybird:samples",{detail:{participant,condition:trial?.condition||$("condition").value,samples:SIDES.flatMap(s=>fresh(links[s])?links[s].rows:[])}}));
  latestSnapshot=snapshot();
  const result=latestSnapshot, chosen=result.analysis[selected], ref=result.baseline[selected];
  $('overall-score').textContent=fmt(result.overall,0);
  const bands=config.scoreBands;
  $('overall-label').textContent=Number.isFinite(result.overall)?(result.overall>=bands[0]?'기준선과 유사':result.overall>=bands[1]?'기준선 대비 변화':result.overall>=bands[2]?'변화 관찰 필요':'기준선과 큰 차이'):'보행 데이터·정상 기준선 필요';
  const available=Object.values(result.scored[selected].groups).filter(Number.isFinite).length;
  $('score-coverage').textContent=`${names[selected]} 점수 ${available}/6개 · ${SIDES.filter(s=>fresh(links[s])).length}/2개 발 수신 · 전체 점수는 사용 가능한 항목의 가중 평균`;
  $('baseline-count').textContent=`${names[selected]} Normal 기준선 ${ref.pitch_range.n}/${config.baselineMinTrials}회 이상`;
  $('analysis-reason').textContent=(chosen.reason||'최근 20초에서 완료된 접촉 구간을 분석합니다.')+` ${names[selected]} 완료 접촉: 뒤꿈치 ${chosen.events.heel.length}회 / 전족부 ${chosen.events.forefoot.length}회 / 전체 ${chosen.events.total.length}회. 원시 가속도·각속도 미수신으로 움직임 RMS와 Jerk는 계산하지 않습니다.`;
  for (const key of Object.keys(GROUPS)) {
    $(`score-${key}`).textContent=fmt(result.scored[selected].groups[key],0);
    $(`reason-${key}`).textContent=key==='movement'?'3축 가속도 미수신':key==='jerk'?'가속도·시간 미분 신호 없음':!chosen.ready?'보정·보행 데이터 필요':ref.pitch_range.n<config.baselineMinTrials?'동일 보정의 Normal 기준선 필요':!Number.isFinite(result.scored[selected].groups[key])?'분산·완료 이벤트 부족':'기준선 평균/SD 대비 유사도';
  }
  for (const key of Object.keys(METRICS)) {
    $(`m-L-${key}`).textContent=fmt(result.analysis.L.metrics[key])+unit(key);
    $(`m-R-${key}`).textContent=fmt(result.analysis.R.metrics[key])+unit(key);
    $(`m-ref-${key}`).textContent=ref[key].n?`${fmt(ref[key].mean)} ± ${fmt(ref[key].sd)} (n=${ref[key].n})`:'—';
    $(`m-pct-${key}`).textContent=fmt(result.scored[selected].deviations[key]?.percent)+'%';
    $(`m-z-${key}`).textContent=fmt(result.scored[selected].deviations[key]?.z);
    $(`ai-${key}`).textContent=fmt(result.ai[key]);
  }
  $('asymmetry-ai').textContent=fmt(result.aiMean,1); $('asymmetry-score').textContent=fmt(result.aiScore,0);
  $('asymmetry-status').textContent=Number.isFinite(result.aiMean)?'피치 범위·전족부/뒤꿈치 피크·전체 접촉시간·간격의 AI 평균입니다. PC 수신시각 정렬이며 정밀 하드웨어 동기화가 아닙니다.':'좌우 모두 같은 PC 시간 구간에서 충분한 완료 보행 이벤트가 필요합니다. 한쪽 데이터로 좌우 값을 만들지 않습니다.';
  drawPlots();
}
function element(tag,text,className) { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className; return node; }
function buildTables() {
  for (const [key,label] of Object.entries(labels)) {
    const card=element('article',undefined,'panel score-card'+(['movement','jerk'].includes(key)?' unavailable':''));
    card.append(element('h3',label)); const value=element('p',undefined,'reading'), number=element('span','—'); number.id=`score-${key}`; value.append(number,element('small','/100'));
    const reason=element('p','', 'caption');reason.id=`reason-${key}`;card.append(value,reason);$('score-cards').append(card);
  }
  for (const [key,label] of Object.entries(METRICS)) {
    const row=element('tr');row.append(element('td',label));
    for(const prefix of ['L','R','ref','pct','z']){const cell=element('td','—');cell.id=`m-${prefix}-${key}`;row.append(cell);} $('metric-table').append(row);
    const ai=element('tr');ai.append(element('td',label));const cell=element('td','—');cell.id=`ai-${key}`;ai.append(cell);$('ai-table').append(ai);
  }
}
function drawPlots() {
  const fields=chart==='pressure'?[['front_norm_filtered','전족부 상대 신호'],['rear_norm_filtered','뒤꿈치 상대 신호']]:[['pitch_relative_filtered','기준점 대비 피치 (°)']];
  $('plot-pressure').setAttribute('aria-pressed',String(chart==='pressure'));$('plot-pitch').setAttribute('aria-pressed',String(chart==='pitch'));
  let any=false;
  for(let index=0;index<2;index++) {
    const container=$(index?'chart-two':'chart-one');container.replaceChildren();container.hidden=!fields[index];if(!fields[index])continue;
    const [field,label]=fields[index], end=now(), start=end-config.windowSeconds*1000;
    const series=SIDES.map(s=>fresh(links[s])?links[s].rows.filter(r=>r.pc_timestamp_ms>=start&&Number.isFinite(r[field])):[]), all=series.flat().map(r=>r[field]);
    any ||= all.length>1;let low=chart==='pressure'?0:Math.min(...all,0), high=Math.max(...all,chart==='pressure'?1:1);if(high-low<0.01)high=low+1;
    const heading=element('div');heading.append(element('span',label),element('span',`${fmt(low)} ~ ${fmt(high)}`));container.append(heading);
    const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 900 150');svg.setAttribute('role','img');svg.setAttribute('aria-label',label+' 왼발·오른발 실시간 그래프');
    for(let n=1;n<4;n++){const line=document.createElementNS(ns,'line');line.setAttribute('x1','0');line.setAttribute('x2','900');line.setAttribute('y1',String(n*37.5));line.setAttribute('y2',String(n*37.5));line.setAttribute('class','grid');svg.append(line);}
    series.forEach((rows,sideIndex)=>{const path=document.createElementNS(ns,'path');let d='';const step=Math.max(1,Math.ceil(rows.length/240));for(let i=0;i<rows.length;i+=step){const row=rows[i], previous=rows[Math.max(0,i-step)];const broken=!i||rows.slice(Math.max(0,i-step+1),i+1).some((r,j,a)=>r.missing_before>0||(j&&r.pc_timestamp_ms-a[j-1].pc_timestamp_ms>config.maxGapMs))||row.pc_timestamp_ms-previous.pc_timestamp_ms>config.maxGapMs*step;d+=(broken?'M':'L')+((row.pc_timestamp_ms-start)/(end-start)*900).toFixed(1)+','+(145-(row[field]-low)/(high-low)*140).toFixed(1)+' ';}path.setAttribute('d',d);path.setAttribute('class',sideIndex?'right-line':'left-line');svg.append(path);});container.append(svg);
  }
  $('plot-empty').hidden=any;
}
function openCalibration() {
  wizard={side:selected,stage:'free',capturing:false,samples:[],unloaded:null};
  $('cal-title').textContent=`${names[selected]} 센서 캘리브레이션`;
  $('cal-stage').textContent='1 / 2 · 무부하 및 기준 자세';
  $('cal-instruction').textContent='두 FSR에 힘이 가해지지 않도록 발을 바닥에서 떼고, 센서를 원하는 기준 자세로 정지시키세요. 이 자세의 Roll·Pitch·Yaw를 웹 기준점으로 저장합니다.';
  $('cal-feedback').textContent='준비 후 측정을 시작하세요.';$('cal-progress').value=0;$('cal-capture').disabled=false;
  $('calibration-dialog').showModal();render();
}
async function capture() {
  const current=wizard;if(!current||current.capturing)return;
  current.capturing=true;current.samples=[];$('cal-capture').disabled=true;$('cal-feedback').textContent='정지 상태로 측정 중입니다.';
  const started=performance.now(), duration=config.calibrationSeconds*1000;
  const timer=setInterval(()=>$('cal-progress').value=Math.min(100,(performance.now()-started)/duration*100),100);
  try {
    await new Promise(resolve=>setTimeout(resolve,duration));
    if(wizard!==current||!$('calibration-dialog').open)return;
    const reference=captureReference(current.samples,config);
    if(current.stage==='free') {
      current.unloaded=reference;current.stage='loaded';
      $('cal-stage').textContent='2 / 2 · 두 FSR 가압';
      $('cal-instruction').textContent='전족부와 뒤꿈치 FSR 모두에 하중이 걸리도록 편하게 서서 정지하세요. 책상 위 시제품이면 두 FSR을 동시에 누른 채 센서 자세를 고정하세요. 이 값은 정규화용 상대 가압 기준이며 체중·압력 단위로 환산하지 않습니다.';
      $('cal-feedback').textContent='무부하 기준 저장됨. 가압 상태에서 다시 측정하세요.';$('cal-progress').value=0;
    } else {
      const link=links[current.side], result=finishCalibration(current.unloaded,reference,config);
      const saved=await api('/api/calibrations',{participant_id:participant,side:current.side,device_id:link.device.id,uptime:link.latest.uptime,...result});
      link.invalidCalibration=null;link.calibration=saved;link.rows=[];link.stream.filtered=[];
      wizard=null;$('calibration-dialog').close();await loadState();notice(`${names[current.side]} 캘리브레이션을 PC에 저장했습니다. Normal 조건으로 기준선을 수집하세요.`);
    }
  } catch(error){if(wizard===current)$('cal-feedback').textContent=error.message;}
  finally{clearInterval(timer);current.capturing=false;$('cal-capture').disabled=false;render();}
}
function startTrial() {
  const sides=SIDES.filter(s=>fresh(links[s])&&links[s].latest.status===2&&links[s].calibration);
  if(!sides.length)return notice('연결과 캘리브레이션을 먼저 완료하세요.',true);
  const number=Number($('trial-number').value);if(!Number.isInteger(number)||number<1||number>9999)return notice('Trial 번호를 확인하세요.',true);
  trial={participant_id:participant,condition:$('condition').value,trial:number,start:now(),started_at:new Date().toISOString(),samples:[],sides,calibration_ids:Object.fromEntries(sides.map(s=>[s,links[s].calibration.id]))};
  window.dispatchEvent(new CustomEvent('earlybird:trial-started',{detail:{participant_id:participant,started_at:trial.started_at}}));
  for(const side of SIDES){links[side].rows=[];links[side].stream.filtered=[];}
  notice(`기록 시작 · ${sides.map(s=>names[s]).join(' / ')}. 실제로 수행하는 조건을 기록하세요.`);render();
}
async function stopTrial() {
  if(!trial)return;const finished=trial;trial=null;
  if(!finished.samples.length){notice('수신된 샘플이 없어 저장하지 않았습니다.',true);render();return;}
  const snap=snapshot(), actualSides=[...new Set(finished.samples.map(s=>s.side))];
  pending={participant_id:finished.participant_id,condition:finished.condition,trial:finished.trial,started_at:finished.started_at,ended_at:new Date().toISOString(),samples:finished.samples,calibration_ids:finished.calibration_ids,summary:Object.fromEntries(actualSides.map(s=>[s,{...snap.analysis[s],scores:snap.scored[s],baseline_reference:snap.baseline[s],asymmetry:snap.ai,overall:snap.overall}]))};
  await savePending();
}
async function savePending() {
  if(!pending)return;
  try {
    const saved=await api('/api/trials',pending);pending=null;
    window.dispatchEvent(new CustomEvent('earlybird:trial-saved',{detail:{participant_id:saved.participant_id,trial_id:saved.id,started_at:saved.started_at}}));
    await loadState();
    $('trial-number').value=Math.min(9999,saved.trial+1);
    $('last-summary').replaceChildren(element('strong',`저장 완료 · ${saved.participant_id} / ${saved.condition} / Trial ${saved.trial}`),element('p',`${saved.sample_count}개 원시·필터 샘플. 요약은 마지막 ${config.windowSeconds}초 분석입니다. 아래 CSV에서 전체 기록을 확인하세요.`));
    notice('Trial을 PC에 저장했습니다. 적격 Normal 기록이면 기준선에 추가할 수 있습니다.');
  } catch(error){notice('저장 실패: '+error.message+' 원시 기록은 메모리에 유지됩니다.',true);}
  render();
}
function renderHistory() {
  $('history').replaceChildren();if(!state.trials.length){$('history').append(element('p','저장된 기록이 없습니다.','caption'));return;}
  for(const item of state.trials){const row=element('div',undefined,'history-row'), details=element('div');details.append(element('strong',`${item.participant_id} · ${item.condition} · Trial ${item.trial}`),element('p',`${new Date(item.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · ${item.sample_count}개 · ${Object.keys(item.summary).map(s=>names[s]).join(' / ')}`,'caption'));const actions=element('div',undefined,'links');for(const [file,label] of [['raw.csv','원시·필터 CSV'],['summary.csv','요약 CSV']]){const a=element('a',label);a.href=`/api/trials/${item.id}/${file}`;a.download='';actions.append(a);}const button=element('button',item.baseline?'기준선에 추가됨':item.eligible_baseline?'정상 기준선에 추가':'기준선 추가 불가','secondary');button.disabled=item.baseline||!item.eligible_baseline;button.addEventListener('click',async()=>{try{await api(`/api/trials/${item.id}/baseline`,{});await loadState();render();notice('Normal 기준선에 추가했습니다. 동일 보정으로 3회 이상 모으면 점수를 계산합니다.');}catch(e){notice(e.message,true);}});actions.append(button);row.append(details,actions);$('history').append(row);}
}
async function boot() {
  $('participant').value=participant;config=await api('/api/config');for(const side of SIDES)links[side].stream=new SampleStream(config);buildTables();await loadState();
  for(const side of SIDES){$(`connect-${side}`).addEventListener('click',()=>connect(side));$(`disconnect-${side}`).addEventListener('click',()=>disconnect(side));$(`select-${side}`).addEventListener('click',()=>{selected=side;render();});}
  $('calibrate').addEventListener('click',openCalibration);$('cal-capture').addEventListener('click',capture);$('calibration-dialog').addEventListener('close',()=>{wizard=null;render();});
  $('start-trial').addEventListener('click',startTrial);$('stop-trial').addEventListener('click',()=>void stopTrial());$('retry-save').addEventListener('click',()=>void savePending());
  $('backup-pending').addEventListener('click',()=>{if(!pending)return;const url=URL.createObjectURL(new Blob([JSON.stringify(pending)],{type:'application/json'}));const a=element('a');a.href=url;a.download=`ENDEAVOR_${pending.participant_id}_trial${pending.trial}_unsaved.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  $('participant').addEventListener('change',async()=>{const entered=$('participant').value.trim();if(!/^[A-Za-z0-9_-]{1,24}$/.test(entered)){$('participant').value=participant;return notice('참여자 코드를 영문·숫자·밑줄·하이픈 1~24자로 입력하세요.',true);}participant=entered;window.dispatchEvent(new CustomEvent('earlybird:participant-changing',{detail:{participant}}));try{localStorage.setItem('earlybird-participant',participant);}catch{}try{await loadState(true);render();notice(`${participant}의 발별 보정·기준선·기록을 불러왔습니다.`);}catch(e){notice(e.message,true);}});
  for(const choice of ['pressure','pitch'])$(`plot-${choice}`).addEventListener('click',()=>{chart=choice;drawPlots();});
  setInterval(render,500);render();
  if(!navigator.bluetooth||!isSecureContext){for(const side of SIDES)$(`connect-${side}`).disabled=true;notice('Web Bluetooth를 지원하는 이 PC의 Chrome·Edge에서 로컬 주소를 열어 주세요.',true);}
}
window.addEventListener('beforeunload',event=>{if(trial||pending){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{for(const side of SIDES)disconnect(side);});
boot().catch(error=>notice('초기화 실패: '+error.message+' Python 서버를 재시작한 뒤 새로고침하세요.',true));
