// Presentation copy is based on the supplied ENDEAVOR presentation, poster and application.
export const intro = `
<section data-view-panel="home" class="intro" aria-label="ENDEAVOR 사업 아이템 소개">
  <header class="intro-header"><div class="intro-header-inner">
    <a class="intro-brand" href="#home" aria-label="ENDEAVOR 소개 홈">ENDEAVOR<span>보행 모니터링 프로젝트</span></a>
    <nav class="intro-nav" aria-label="소개 페이지 메뉴">
      <button type="button" data-intro-scroll="intro-about">프로젝트 소개</button>
      <button type="button" data-intro-scroll="intro-process">작동 방식</button>
      <button type="button" data-intro-scroll="intro-story">개발 이야기</button>
    </nav>
    <a class="intro-button intro-button-small" href="#dashboard">대시보드 바로가기 <span aria-hidden="true">↗</span></a>
  </div></header>

  <div class="intro-hero intro-wrap" id="intro-about">
    <div class="intro-hero-copy">
      <span class="intro-tag"><span></span> 파킨슨병 보행 변화에 주목한 스마트 슈즈</span>
      <h1>걸음의 변화를<br>일상의 기록으로.</h1>
      <p>파킨슨병을 겪는 가족을 보며 시작한 질문.<br class="intro-desktop"> 일상 속 걸음의 변화를 기록해 상담에 도움이 되는 자료로 만듭니다.</p>
      <div class="intro-actions"><a class="intro-button" href="#dashboard">대시보드 바로가기 <span aria-hidden="true">↗</span></a><button class="intro-text-link" type="button" data-intro-scroll="intro-why">왜 만들었나요? <span aria-hidden="true">↓</span></button></div>
      <p class="intro-hero-note">선덕고등학교 창업동아리 ENDEAVOR</p>
    </div>
    <figure class="intro-hero-image"><img src="assets/intro/shoe.webp" alt="스마트 슈즈와 인솔, 센서 부품의 구성 이미지"><figcaption>스마트 슈즈와 인솔 구성 · 제공 발표자료</figcaption></figure>
  </div>

  <div class="intro-facts"><div class="intro-wrap intro-facts-inner">
    <div><strong>양발</strong><span>각 신발의 센서 기록</span></div>
    <div><strong>앞 · 뒤</strong><span>발바닥 두 지점의 FSR</span></div>
    <div><strong>약 20 Hz</strong><span>BLE 센서 데이터 전송</span></div>
    <div><strong>AI 리포트</strong><span>CSV 기반 보행 기록 분석</span></div>
  </div></div>

  <div class="intro-wrap intro-section intro-why" id="intro-why">
    <div class="intro-heading"><div><span class="intro-kicker">ENDEAVOR의 시작</span><h2>파킨슨병과 마주한<br>가족의 경험에서.</h2></div><p>제때 알아차린 변화가 한 사람의 일상에 얼마나 중요한지 가까이에서 보며, 팀은 병원 밖에서도 걸음을 꾸준히 기록할 방법을 고민했습니다.</p></div>
    <div class="intro-why-grid">
      <article><span>01 · 문제의식</span><h3>달라진 걸음을<br>기억하기 어렵습니다.</h3><p>파킨슨병에서는 작은 걸음, 걸음을 시작하기 어려운 모습, 균형 문제 등 보행 변화가 나타날 수 있습니다. 하지만 변화의 모습과 시기는 사람마다 다르고, 가족이 매일 관찰하기도 쉽지 않습니다.</p></article>
      <article><span>02 · 개발 동기</span><h3>한 가족의 경험이<br>질문이 되었습니다.</h3><p>사업계획서에 따르면 팀 대표의 가족은 파킨슨병을 비교적 일찍 발견해 치료를 시작했습니다. 이 경험은 일상에서의 변화를 놓치지 않고 기록할 방법을 찾아보는 출발점이 됐습니다.</p></article>
      <article><span>03 · ENDEAVOR의 목표</span><h3>걸음을 기록하고,<br>변화를 함께 살핍니다.</h3><p>양발 센서로 움직임과 발바닥 신호를 기록하고, 그래프와 리포트로 정리합니다. 개인의 이전 기록과 함께 살펴보고 필요할 때 의료진과 상담할 자료를 준비하는 것이 목표입니다.</p></article>
    </div>
    <p class="intro-small-note">보행 변화만으로 파킨슨병을 판단할 수는 없습니다. 증상은 다른 원인으로도 나타날 수 있으며, 질병 진단은 의료진의 평가가 필요합니다. <a href="https://www.ninds.nih.gov/health-information/disorders/parkinsons-disease" target="_blank" rel="noopener noreferrer">파킨슨병과 보행 증상에 관한 참고 자료 · 미국 NINDS ↗</a></p>
  </div>

  <div class="intro-wrap intro-section" id="intro-process">
    <div class="intro-heading"><div><span class="intro-kicker">걸음에서 시작되는 기록</span><h2>보행을 살피는 과정을<br>하나로 연결합니다.</h2></div><p>신발에서 수집한 신호를 브라우저로 전송하고, 그래프와 리포트로 이해하기 쉽게 정리합니다.</p></div>
    <div class="intro-steps">
      <article><span class="intro-step-number">01</span><h3>양발 측정</h3><p>각 발의 앞·뒤 FSR과 MPU6500 자세각을 수집합니다.</p></article>
      <article><span class="intro-step-number">02</span><h3>블루투스 연결</h3><p>두 ESP32를 브라우저에 각각 연결해 기록을 저장합니다.</p></article>
      <article><span class="intro-step-number">03</span><h3>그래프와 분석</h3><p>센서값의 시간 변화와 좌우 차이를 CSV 기반으로 살펴봅니다.</p></article>
      <article><span class="intro-step-number">04</span><h3>리포트 확인</h3><p>AI가 기록과 측정 조건을 정리한 보고서를 저장합니다.</p></article>
    </div>
    <p class="intro-small-note">FSR은 두 지점의 상대 신호입니다. 양발 시계는 하드웨어 동기화되지 않았으며, 현재 펌웨어는 원시 가속도·각속도를 전송하지 않습니다.</p>
  </div>

  <div class="intro-product-band"><div class="intro-wrap intro-product-grid">
    <div><span class="intro-kicker">하드웨어와 서비스</span><h2>신발 속 센서부터<br>보행 기록까지.</h2><p>앞과 뒤의 압력 센서, 움직임을 읽는 관성 센서, 데이터를 전송하는 ESP32를 양발에 구성합니다. 웹 대시보드에서는 실시간 측정과 기록을 확인할 수 있습니다.</p><a class="intro-inline-link" href="#dashboard">대시보드 살펴보기 <span aria-hidden="true">↗</span></a></div>
    <figure><img src="assets/intro/prototype.webp" loading="lazy" alt="스마트 슈즈 시제품과 센서 부품을 놓고 확인하는 개발 과정"><figcaption>스마트 슈즈 시제품 개발 과정 · 제공 신청서</figcaption></figure>
  </div></div>

  <div class="intro-wrap intro-section" id="intro-platform">
    <div class="intro-heading"><div><span class="intro-kicker">한곳에서 보는 일상의 변화</span><h2>측정한 순간부터<br>다음 기록까지.</h2></div><p>수집한 기록을 살펴보고, 변화에 대해 전문가와 이야기할 자료를 준비할 수 있습니다.</p></div>
    <figure class="intro-dashboard-preview"><img src="assets/intro/dashboard.webp" loading="lazy" alt="측정 기록이 없는 ENDEAVOR 대시보드 초기 화면"><figcaption>대시보드 초기 화면 · 기록이 없는 상태</figcaption></figure>
    <div class="intro-feature-list">
      <article><div><span>실시간 측정</span><h3>앞·뒤 FSR과 자세각을<br>화면에서 확인</h3></div><p>왼발과 오른발 장치를 각각 등록하고, 캘리브레이션 후 센서 신호를 실시간으로 확인합니다.</p></article>
      <article><div><span>보행 분석</span><h3>CSV의 흐름을<br>그래프와 AI로 정리</h3></div><p>보행 주기가 잡히지 않아도 CSV를 불러와 시간 변화, 결측, 좌우 차이를 살펴볼 수 있습니다.</p></article>
      <article><div><span>건강 기록</span><h3>보관하고, 다시 보고,<br>상담 자료로 준비</h3></div><p>저장한 기록과 리포트를 다시 열고, 복약 기록과 보호자·의료진에게 전달할 자료를 준비합니다.</p></article>
    </div>
    <p class="intro-small-note">보호자 공유 파일과 방문 케어 요청서는 사용자가 준비하는 기능입니다. 이메일 발송·기관 접수·예약은 현재 연결되어 있지 않습니다.</p>
  </div>

  <div class="intro-story-band" id="intro-story"><div class="intro-wrap intro-section">
    <div class="intro-heading"><div><span class="intro-kicker">만들고, 살피고, 다시 개선하며</span><h2>작은 시도에서<br>스마트 슈즈까지.</h2></div><p>측정 가능성을 확인한 발목 부착형 센서에서 출발해, 신발 안의 압력 정보까지 함께 살피는 방향으로 시제품을 발전시켰습니다.</p></div>
    <div class="intro-story-grid"><figure class="intro-story-wide"><img src="assets/intro/building.webp" loading="lazy" alt="센서와 배선을 연결하며 스마트 슈즈 시제품을 제작하는 과정"><figcaption>센서와 회로 연결 과정 · 제공 발표자료</figcaption></figure><div class="intro-story-copy"><span class="intro-kicker">프로토타입 발전 과정</span><h3>움직임과 착지 정보를<br>함께 살피기 위해</h3><p>발목 부착형 센서와 Arduino 기반 실험을 거쳐, 앞·뒤 FSR과 ESP32를 더한 스마트 슈즈 형태로 발전시켰습니다.</p><div class="intro-evidence"><strong>100<span>회</span></strong><p>학생 5명이 4가지 조건으로 수행한<br>초기 모사 보행 기록<br><small>제공된 제작 포스터 기준</small></p></div></div></div>
    <p class="intro-small-note">초기 모사 보행 기록은 제품의 임상 성능이나 고령자 대상 검증을 의미하지 않습니다.</p>
  </div></div>

  <div class="intro-wrap intro-section" id="intro-direction">
    <div class="intro-heading"><div><span class="intro-kicker">앞으로의 방향</span><h2>개인의 걸음에서<br>지역의 돌봄으로.</h2></div><p>착용 편의와 데이터 품질을 개선하고, 현장의 의견을 바탕으로 활용 가능성을 검토해 나갑니다.</p></div>
    <div class="intro-direction-grid"><div><h3>개인과 보호자</h3><p>보행 기록과 리포트를 일상 속 변화 확인과 상담 준비에 활용합니다.</p></div><div><h3>의료·복지 현장</h3><p>지역 시설과의 협력을 통해 착용성, 데이터 품질, 현장 활용 방식을 검토할 계획입니다.</p></div><div><h3>지속 가능한 모델</h3><p>스마트 슈즈와 개인 기록 서비스에서 기관용 분석 플랫폼으로의 확장을 구상합니다.</p></div></div>
    <div class="intro-photo-pair" aria-label="시제품과 센서 회로 사진">
      <figure><img src="assets/intro/shoe-prototype.webp" loading="lazy" alt="센서와 배터리를 연결한 스마트 슈즈 시제품"><figcaption>센서와 제어부를 연결한 스마트 슈즈 시제품 · 제공 신청서</figcaption></figure>
      <figure><img src="assets/intro/sensor-circuit.webp" loading="lazy" alt="센서와 배선을 연결해 시험하는 회로"><figcaption>센서 회로 연결 및 시험 과정 · 제공 신청서</figcaption></figure>
    </div>
  </div>

  <div class="intro-final"><div class="intro-wrap intro-final-inner"><div><span>ENDEAVOR</span><h2>오늘의 걸음이<br>내일의 기록이 됩니다.</h2><p>보행의 작은 변화를 대시보드에서 확인해 보세요.</p></div><a class="intro-button intro-button-light" href="#dashboard">대시보드 바로가기 <span aria-hidden="true">↗</span></a></div></div>
  <div class="intro-wrap intro-bottom"><strong>ENDEAVOR</strong><p>선덕고등학교 창업동아리 ENDEAVOR · 보행 모니터링 프로젝트</p><p>본 서비스는 연구·개발 단계의 보행 기록 도구이며, 질병 진단이나 파킨슨병 발생 확률을 제공하지 않습니다.</p></div>
</section>`;
