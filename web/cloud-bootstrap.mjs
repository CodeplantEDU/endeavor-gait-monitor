import { installBrowserAPI } from './browser-store.mjs';
try {
 await installBrowserAPI();
 await import('./platform.mjs');
 await import('./app.mjs');
 await import('./research.mjs');
 const $=id=>document.getElementById(id);
 const sidebar=document.querySelector('.sidebar-bottom');sidebar.innerHTML='<span class="local-dot"></span> 이 브라우저에 기록<p>다른 기기·PC 서버와 자동 동기화하지 않습니다.<br>브라우저 데이터 삭제 전 백업하세요.</p><button id="browser-backup" class="secondary">전체 기록 JSON 백업</button><a href="guide.html" target="_blank" rel="noopener">사용 방법 ↗</a>';
 $('browser-backup').addEventListener('click',async()=>{try{const data=await window.earlybirdBrowserBackup(),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='ENDEAVOR_browser_backup_'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){$('notice').hidden=false;$('notice').textContent='백업 실패: '+e.message;}});
 const topNote=document.querySelector('.global-research-note');topNote.textContent='이 브라우저에 데이터를 저장합니다. PC 서버·다른 기기와 자동 동기화하지 않습니다. 점수는 개인 보행 기준 대비 연구용 비교이며 질병 진단 결과가 아닙니다.';
 const labels=[...document.querySelectorAll('p')];for(const p of labels)if(p.textContent.includes('PC 서버가 켜진 동안 매시간'))p.textContent='지난달까지의 저장 기록이 있으면 월별 리포트를 자동 생성합니다. 사이트를 열 때와 열린 동안 매시간 확인합니다. 사이트를 닫으면 생성 작업이 멈춥니다.';
 document.querySelector('footer span:last-child').textContent='저장 위치: 이 브라우저의 IndexedDB';
 let lastMonthCheck=Date.now();setInterval(()=>{if(Date.now()-lastMonthCheck>=3600000){lastMonthCheck=Date.now();const p=$('participant').value;void fetch('/api/platform?participant='+encodeURIComponent(p));}},60000);
}catch(error){const notice=document.getElementById('notice');if(notice){notice.hidden=false;notice.textContent='브라우저 저장소 초기화 실패: '+error.message+' 저장소 사용을 허용한 Chrome 또는 Edge에서 다시 여세요.';notice.classList.add('error');}}
