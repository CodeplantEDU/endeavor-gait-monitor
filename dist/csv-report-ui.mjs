import {parseSensorCSV,SENSOR_FIELDS} from './csv-analysis.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number.isFinite(v)?v.toFixed(2):'—';
const labels={front:'앞 FSR ADC',rear:'뒤 FSR ADC',roll:'롤 (°)',pitch:'피치 (°)',yaw:'요 (°)',front_norm:'앞 FSR 보정 상대값',rear_norm:'뒤 FSR 보정 상대값',pitch_relative:'기준 대비 피치 (°)'};
export function csvAssessment(report){return {headline:report.ai?.analysis.summary||'CSV 정제 완료 · 주기 수와 관계없이 AI 분석 가능',action:report.ai?.analysis.next_steps||'아래 CSV AI 분석 버튼으로 기록의 변화와 좌우 차이를 확인하세요. 고정 접촉 임계값·기준선 3회·주기 10회 조건으로 차단하지 않습니다.'};}
export function csvResultHTML(report){
  const summary=report.csv.summary,rows=parseSensorCSV(report.csv.text).rows,clean=summary.cleaning;
  const plot=key=>{
    const available=rows.filter(r=>Number.isFinite(r[key]));if(!available.length)return '<p class="empty">이 채널은 CSV에 없습니다.</p>';
    const lo=Math.min(...available.map(r=>r[key])),rawHi=Math.max(...available.map(r=>r[key])),hi=rawHi===lo?lo+1:rawHi,end=Math.max(...rows.map(r=>r.t_s),.001);
    let svg=`<svg viewBox="0 0 800 250" role="img" aria-label="${esc(labels[key])} 시간 그래프"><text x="55" y="20">${esc(labels[key])}</text>`;
    for(let i=0;i<5;i++)svg+=`<path d="M60 ${40+i*40}H740" stroke="#e2eaed"/><text x="52" y="${44+i*40}" text-anchor="end">${num(hi-(hi-lo)*i/4)}</text>`;
    for(const side of ['L','R']){const foot=rows.filter(r=>r.side===side),step=Math.max(1,Math.ceil(foot.length/600));let path='',last=null,open=false;
      for(let i=0;i<foot.length;i++){const r=foot[i];if(r[key]===null){open=false;last=null;continue;}const gap=last&&r.t_s-last.t_s>.2;last=r;if(gap)open=false;if(i%step&&i!==foot.length-1)continue;path+=(open?'L':'M')+(60+680*r.t_s/end).toFixed(2)+','+(200-160*(r[key]-lo)/(hi-lo)).toFixed(2);open=true;}
      svg+=`<path d="${path}" stroke="${side==='L'?'#247c79':'#5b54a6'}" stroke-width="2" fill="none"${side==='R'?' stroke-dasharray="6 3"':''}/>`;
    }
    return svg+`<text x="60" y="224">0</text><text x="740" y="224" text-anchor="end">${num(end)}</text><text x="400" y="245" text-anchor="middle">경과 시간 (초)</text></svg><p class="caption">왼발 초록 · 오른발 보라 · 결측 구간은 선을 끊어 표시</p>`;
  };
  return `<article class="research-document"><div class="panel"><p class="eyebrow">CSV SENSOR ANALYSIS</p><h3>CSV 기반 보행 기록 분석</h3><p>원본 ${clean.input_rows}행 → 정제 ${clean.kept_rows}행 · 중복 ${clean.duplicate_rows}행 · 잘못된 숫자 ${clean.invalid_cells}칸 · 시간 정렬 변경 ${clean.reordered_rows}행 · 임의 보충 ${clean.imputed_cells}칸</p><p class="caption">센서값은 채널별로 분석합니다. 빈칸·긴 누락 구간은 만들어 채우지 않습니다. 원본 기록은 유지합니다.</p><div class="table-wrap"><table><thead><tr><th>발</th><th>측정 구간 (초)</th><th>행 수</th><th>평균 수신 Hz</th><th>200ms 초과 공백</th></tr></thead><tbody>${Object.entries(summary.sides).map(([s,a])=>`<tr><td>${s==='L'?'왼발':'오른발'}</td><td>${num(a.duration_seconds)}</td><td>${a.samples}</td><td>${num(a.effective_hz)}</td><td>${a.gaps_over_200ms}</td></tr>`).join('')}</tbody></table></div></div><div class="research-chart-grid">${['front','rear','pitch','roll','yaw'].filter(k=>Object.values(summary.sides).some(a=>a.channels[k].n)).map(k=>`<div class="panel spaced"><h3>${labels[k]} 시간 변화</h3>${plot(k)}</div>`).join('')}</div><div class="panel spaced"><h3>채널별 분포</h3><div class="table-wrap"><table><thead><tr><th>발 / 채널</th><th>최솟값</th><th>중앙값</th><th>최댓값</th><th>표준편차</th><th>결측 칸</th></tr></thead><tbody>${Object.entries(summary.sides).flatMap(([s,a])=>SENSOR_FIELDS.filter(k=>a.channels[k].n).map(k=>{const c=a.channels[k];return `<tr><td>${s} / ${labels[k]}</td><td>${num(c.min)}</td><td>${num(c.median)}</td><td>${num(c.max)}</td><td>${num(c.sd)}</td><td>${c.missing_cells}</td></tr>`;})).join('')}</tbody></table></div><p>좌우 FSR 크기 차이에는 센서 감도·신발 장착·보정 차이가 영향을 줍니다. 좌우 시계는 하드웨어 동기화되지 않았으므로 같은 시각의 값이 정확히 대응한다고 가정하지 않습니다.</p><p class="caption">${esc(summary.method)}</p></div></article>`;
}
