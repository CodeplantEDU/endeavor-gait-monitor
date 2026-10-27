import {AutoReportQueue} from './auto-report.mjs';
import {makeCSVReport} from './csv-analysis.mjs';

export function installAutoReports({api,protocol,baseline,aiPayload,getParticipant,onSaved}){
  const $=id=>document.getElementById(id),contexts=new Map();
  const panel=document.createElement('div');panel.className='panel spaced';panel.innerHTML='<h3>측정 종료 후 AI 리포트 자동 생성</h3><label class="check"><input id="auto-report-enabled" type="checkbox" checked> GPT-6.1 Terra 분석·리포트 자동 저장</label><p class="caption">정제 CSV 센서값·전체 통계와 분석 요청을 OpenAI로 전송합니다. 주기 수·기준선 조건 없이 분석합니다. 이용 코드·전송 동의를 먼저 설정하세요. 새로고침하거나 참여자를 바꾸면 다시 설정해야 합니다. 브라우저를 열어 둔 동안 처리하며 원시 측정 기록은 먼저 저장합니다.</p><div class="actions spaced"><button id="auto-report-settings" class="secondary">이용 코드·전송 동의 설정</button><button id="auto-report-retry" class="secondary">대기·실패 작업 처리</button><button id="auto-report-open" class="secondary">저장된 리포트 보기</button></div><p id="auto-report-status" class="caption" role="status" aria-live="polite">자동 생성 준비: 이용 코드와 외부 전송 동의를 설정하세요.</p>';
  $('recording-status').after(panel);
  const status=(who,text)=>{if(who===getParticipant())$('auto-report-status').textContent=text;};
  const credentials=()=>({code:$('ai-access').value.trim(),consent:$('ai-consent').checked});
  const save=async(who,report)=>{const item=await api('/api/platform/research',{participant_id:who,report});if(who===getParticipant())onSaved(item);return item;};
  const queue=new AutoReportQueue(save,(report,auth)=>api('/api/ai-analyze',{access_code:auth.code,question:'측정 종료 후 자동 생성하는 보행 분석 리포트입니다. CSV의 앞뒤 FSR과 자세각의 시간 변화, 좌우 차이, 누락·센서 감도·장착 영향을 구분하고 재측정 및 전문 의료진 상담 조건을 정리해 주세요. 주기 수를 분석의 전제조건으로 요구하지 마세요.',report:aiPayload(report)}),task=>status(task.participant,task.report.auto_state==='completed'?'AI 리포트 자동 생성·저장 완료. 건강 리포트 메뉴에서 확인하세요.':task.report.auto_state==='failed'?'AI 리포트 생성·저장 실패: '+task.report.auto_error+' 원시 기록은 보관되어 있습니다. 실패 작업 처리로 재시도하세요.':'GPT-6.1 Terra가 리포트를 작성하고 있습니다. 이 창을 열어 두세요.'));
  function process(retry=false){const who=getParticipant(),auth=credentials();if(!auth.code||!auth.consent||auth.code.startsWith('sk-')){status(who,'AI 리포트 생성 대기: 이용 코드와 외부 전송 동의를 설정하세요. 원시 기록과 분석 초안은 저장됩니다.');return;}void queue.run(who,auth,retry).finally(()=>{if(who!==getParticipant())process();});}
  $('auto-report-settings').onclick=()=>{window.earlybirdNavigate('analysis');$('ai-access').scrollIntoView({behavior:'smooth',block:'center'});$('ai-access').focus();};
  $('auto-report-open').onclick=()=>window.earlybirdNavigate('reports');
  $('auto-report-retry').onclick=()=>process(true);
  $('auto-report-apply').onclick=()=>{const auth=credentials();if(!auth.code||auth.code.startsWith('sk-')||!auth.consent){status(getParticipant(),'이용 코드와 외부 전송 동의를 확인하세요. OpenAI API 키는 입력하지 마세요.');$('ai-status').textContent='자동 리포트 설정: 이용 코드와 전송 동의가 필요합니다.';return;}$('ai-status').textContent='자동 리포트 준비 완료. 다음 측정을 종료하면 자동으로 작성·저장합니다.';status(getParticipant(),'자동 리포트 준비 완료. 다음 측정 종료 후 생성·저장합니다.');process(true);};
  window.addEventListener('earlybird:trial-started',e=>{const d=e.detail;contexts.set(d.started_at,{enabled:$('auto-report-enabled').checked,protocol:structuredClone(protocol())});status(d.participant_id,$('auto-report-enabled').checked?'기록 중. 측정 종료·원시 기록 저장 후 AI 리포트를 자동 생성합니다.':'이번 측정의 AI 자동 리포트는 꺼져 있습니다.');});
  window.addEventListener('earlybird:trial-saved',e=>{void enqueue(e.detail);});
  window.addEventListener('beforeunload',event=>{if(queue.running){event.preventDefault();event.returnValue='';}});
  async function enqueue(d){
    const context=contexts.get(d.started_at)||{enabled:$('auto-report-enabled').checked,protocol:protocol()};contexts.delete(d.started_at);if(!context.enabled)return;
    const who=d.participant_id;
    try{
      const old=await api('/api/platform?participant='+encodeURIComponent(who));const existing=old.researchs?.find(x=>x.report.automatic&&x.report.trial_id===d.trial_id);
      if(existing){queue.add(who,existing.report);if(who===getParticipant())process();return;}
      const [trial,state]=await Promise.all([api('/api/trials/'+encodeURIComponent(d.trial_id)),api('/api/state?participant='+encodeURIComponent(who))]);
      if(trial.participant_id!==who)throw Error('참여자와 측정 기록이 다릅니다.');
      const report={...makeCSVReport(trial,context.protocol),automatic:true,auto_state:'queued'};
      queue.add(who,report);await save(who,report);if(who===getParticipant())process();
    }catch(error){status(who,'자동 리포트 준비 실패: '+error.message+' 원시 기록은 보관되어 있습니다. 대기·실패 작업 처리로 다시 시도하세요.');}
  }
  window.addEventListener('earlybird:participant-changing',()=>{$('auto-report-status').textContent='새 참여자의 자동 리포트에는 이용 코드와 전송 동의를 다시 설정하세요.';});
  return {restore(who,items){for(const item of items)if(item.report.automatic)queue.add(who,item.report);if(queue.tasks.size&&who===getParticipant())process();}};
}
