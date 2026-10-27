"""Submission-quality demonstration report; every page identifies synthetic data."""
from pathlib import Path
import json
import math
import argparse
from html import escape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.pagesizes import A4

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'output/demo_20261027/demo-data.json').read_text(encoding='utf-8'))
R, BASE = DATA['report'], DATA['baseline']
parser = argparse.ArgumentParser()
parser.add_argument('--product-example', action='store_true', help='70대 1명 대상 조건의 제품 보고서 출력 예시')
PRODUCT = parser.parse_args().product_example
OUT = ROOT / ('output/pdf/ENDEAVOR_70대_보행분석_출력예시_20261027.pdf' if PRODUCT else 'output/pdf/ENDEAVOR_보행분석_시연리포트_20261027.pdf')
OUT.parent.mkdir(parents=True, exist_ok=True)
for name, file in [('PR', 'Pretendard-Regular.ttf'), ('PB', 'Pretendard-Bold.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(ROOT / 'dist/assets' / file)))
W, H = A4
M = 42
CW = W - 2 * M
INK, TEAL, MUTED, LIGHT = map(HexColor, ['#193544', '#237C79', '#526574', '#EDF5F4'])
AMBER = HexColor('#90631E')
C = canvas.Canvas(str(OUT), pagesize=A4)
C.setTitle('ENDEAVOR 70대 보행 분석 보고서 출력 예시' if PRODUCT else 'ENDEAVOR 보행 패턴 분석 리포트 - 가상 데이터 시연용')
C.setAuthor('ENDEAVOR')
style = ParagraphStyle('body', fontName='PR', fontSize=9.4, leading=15, textColor=INK, wordWrap='CJK')
small = ParagraphStyle('small', parent=style, fontSize=8, leading=12, textColor=MUTED)


def text(value, x, y, width=CW, size=None, color=None, bold=False):
    if PRODUCT:
        value = str(value).replace('가상', '예시')
    s = ParagraphStyle('local', parent=style, fontSize=size or style.fontSize, leading=(size or style.fontSize) * 1.55,
                       fontName='PB' if bold else 'PR', textColor=color or INK)
    p = Paragraph(escape(str(value)).replace('\n', '<br/>'), s)
    _, height = p.wrap(width, H)
    assert y - height >= 46, f'Text exceeds footer: {value[:40]}'
    p.drawOn(C, x, y - height)
    return y - height


def page(n, title, subtitle):
    C.setFillColor(TEAL)
    C.rect(M, H - 35, 28, 3, fill=1, stroke=0)
    C.setFont('PB', 10)
    C.drawString(M, H - 58, 'ENDEAVOR')
    C.setFillColor(MUTED)
    C.setFont('PR', 8)
    C.drawRightString(W - M, H - 57, 'GAIT PATTERN REPORT / DEMONSTRATION')
    text(title, M, H - 85, size=23, bold=True)
    text(subtitle, M, H - 126, size=9, color=MUTED)
    C.setStrokeColor(HexColor('#D7E3E5'))
    C.line(M, 42, W - M, 42)
    C.setFont('PR', 7.5)
    C.setFillColor(MUTED)
    C.drawString(M, 27, '제품 기능 설명용 | 보고서 출력 예시' if PRODUCT else '가상 데이터 기반 시연용 | 실제 환자·실측 자료 및 진단서가 아닙니다.')
    C.drawRightString(W - M, 27, f'{n} / 6')
    return H - 165


def section(title, y):
    text(title, M, y, size=12, bold=True)
    return y - 28


def table(rows, widths, y, header=True):
    data = [[Paragraph(escape(str(v).replace('가상', '예시') if PRODUCT else str(v)), small) for v in row] for row in rows]
    t = Table(data, colWidths=widths, hAlign='LEFT')
    commands = [('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 9),
                ('RIGHTPADDING', (0, 0), (-1, -1), 7), ('TOPPADDING', (0, 0), (-1, -1), 8),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 8), ('LINEBELOW', (0, 0), (-1, -1), .4, HexColor('#DFE8EA'))]
    if header:
        commands += [('BACKGROUND', (0, 0), (-1, 0), LIGHT), ('TEXTCOLOR', (0, 0), (-1, 0), TEAL)]
    t.setStyle(TableStyle(commands))
    _, h = t.wrap(CW, H)
    assert y - h >= 51, f'Table exceeds footer ({h})'
    t.drawOn(C, M, y - h)
    return y - h


def f(v, digits=2):
    return f'{v:.{digits}f}' if isinstance(v, (float, int)) and math.isfinite(v) else '-'


def chart(x, y, width, height, series, title, x_label, y_label, x_end=100, x_start=0):
    text(title, x, y, width, 10, bold=True)
    px, py, pw, ph = x + 38, y - height + 50, width - 49, height - 88
    values = [v + sign * (s.get('sd', [0] * len(s['values']))[i])
              for s in series for i, v in enumerate(s['values']) for sign in [-1, 1]]
    lo, hi = min(0, min(values)), max(values)
    if hi - lo < 1e-9:
        hi = lo + 1
    def xx(i, count): return px + pw * i / max(1, count - 1)
    def yy(v): return py + ph * (v - lo) / (hi - lo)
    for j in range(5):
        v = lo + (hi - lo) * j / 4
        C.setStrokeColor(HexColor('#E1E9EB')); C.setLineWidth(.4)
        C.line(px, yy(v), px + pw, yy(v))
        C.setFont('PR', 6.5); C.setFillColor(MUTED)
        C.drawRightString(px - 5, yy(v) - 2, f(v, 1))
    for s in series:
        vals, color = s['values'], s['color']
        if s.get('sd'):
            p = C.beginPath(); p.moveTo(xx(0, len(vals)), yy(vals[0] + s['sd'][0]))
            for i, v in enumerate(vals[1:], 1): p.lineTo(xx(i, len(vals)), yy(v + s['sd'][i]))
            for i in range(len(vals) - 1, -1, -1): p.lineTo(xx(i, len(vals)), yy(vals[i] - s['sd'][i]))
            p.close(); C.setFillColor(Color(color.red, color.green, color.blue, alpha=.10)); C.drawPath(p, fill=1, stroke=0)
        p = C.beginPath()
        for i, v in enumerate(vals):
            (p.moveTo if i == 0 else p.lineTo)(xx(i, len(vals)), yy(v))
        C.setStrokeColor(color); C.setLineWidth(1.3); C.setDash(4, 2) if s.get('dash') else C.setDash()
        C.drawPath(p); C.setDash()
    C.setFillColor(MUTED); C.setFont('PR', 7)
    C.drawString(px, py - 13, str(x_start)); C.drawRightString(px + pw, py - 13, str(x_end))
    C.drawCentredString(px + pw / 2, py - 27, x_label)
    C.drawString(px, y - 23, y_label)
    lx = px
    for s in series:
        C.setFillColor(s['color']); C.setFont('PR', 6.8)
        C.drawString(lx, y - height + 2, s['name']); lx += 92


def pooled(side, key):
    curves = [b['sides'][side]['ensemble'][key] for b in BASE]
    n = sum(a['n'] for a in curves)
    avg = [sum(a['mean'][i] * a['n'] for a in curves) / n for i in range(250)]
    deviation = [math.sqrt(sum((a['n'] - 1) * a['sd'][i] ** 2 + a['n'] * (a['mean'][i] - avg[i]) ** 2 for a in curves) / (n - 1)) for i in range(250)]
    return {'mean': avg, 'sd': deviation}


L, RGT = R['sides']['L'], R['sides']['R']
y = page(1, '보행 패턴 분석 리포트', '측정 종료 후 AI 리포트 자동 생성 서비스 | 외부 제출용 시연 자료')
C.setFillColor(LIGHT); C.roundRect(M, y - 78, CW, 78, 9, fill=1, stroke=0)
text('보고서 출력 예시' if PRODUCT else '가상 데이터 기반 시연용', M + 15, y - 12, CW - 30, 14, TEAL, True)
text('제품 기능 설명용 자료입니다. 70대 1명을 대상 조건으로 설정했으며, 수치와 그래프는 기능 설명을 위한 예시로 실제 참여자의 실측 자료가 아닙니다.' if PRODUCT else '이 문서의 참여자·센서 신호·보행 기록은 기능 시연을 위해 생성했습니다. 실제 측정 결과, 환자 사례 또는 의료진이 작성한 진단서로 사용할 수 없습니다.', M + 15, y - 40, CW - 30, 9)
y -= 101
y = table([['문서 번호', 'EN-EXAMPLE-20261027-01' if PRODUCT else DATA['provenance']['report_id']], ['대상 조건' if PRODUCT else '시연 참여자', '70대 1명 / 사례 설정 CASE-01' if PRODUCT else 'DEMO-001 / 익명 가상 참여자'], ['작성일 / AI 모델', '2026.10.27 / ' + R['ai']['model']], ['구성', '동일 조건 기준 기록 3회 + 비교 기록 1회 / 양발 각 60초']], [119, CW - 119], y, False) - 25
y = section('01  핵심 관찰', y)
y = text('개인 기준선 대비 보행 패턴 변화가 관찰되었습니다.', M, y, CW, 15, TEAL, True) - 11
changes = sorted(R['assessment']['changes'], key=lambda x: x['percent'], reverse=True)
for line in [
    f"왼발 보행 주기 CV는 기준 {f(R['reference']['L']['stride_cv']['mean'])}%에서 {f(L['metrics']['stride_cv'])}%로 증가했습니다.",
    f"왼발 접촉시간 CV는 {f(R['reference']['L']['stance_cv']['mean'])}%에서 {f(L['metrics']['stance_cv'])}%로 증가했습니다.",
    f"양발에서 연구용 증가 기준을 넘은 항목은 {R['assessment']['flags']}개입니다. 이는 질병 확률이나 임상 위험도 등급이 아닙니다."]:
    y = text('• ' + line, M, y, CW, 10) - 8
y -= 7
y = section('02  다음 확인 사항', y)
y = text('동일 조건으로 다시 측정해도 변화가 지속되면 신경과 등 전문 의료진의 평가가 필요합니다. 실제 걷기 불편이나 균형 변화가 있는지 함께 확인하고, 기록을 상담 자료로 활용하세요.', M, y, CW, 10)
text('가상 시나리오의 해석 예시이며, 특정 개인에게 진료 필요성을 판정한 결과가 아닙니다.', M, y - 15, CW, 8, MUTED)
C.showPage()

y = page(2, '측정 조건과 정량 지표', '모든 수치는 합성 센서 신호에 실제 분석 알고리즘을 적용해 계산한 값입니다.')
y = table([['조건', '시연 시나리오 설정'], ['보행 / 속도', '평지 직선 보행 / 1.10 m/s (가상 입력값)'], ['센서 / 전송', '발당 FSR 2개 + MPU6500 자세각 / 20 Hz 모사'], ['기준선', '동일 장착·보정·속도·복약 조건으로 설정한 60초 기록 3회'], ['품질', f"양발 각 60초 / 유효 주기 왼발 {L['quality']['cycles']}회·오른발 {RGT['quality']['cycles']}회 / 누락 0% (시나리오 설정)"]], [105, CW - 105], y) - 18
metrics = [('stride_mean', '같은 발 보행 주기', 's'), ('stride_cv', '보행 주기 CV', '%'), ('stance_mean', 'FSR 접촉시간', 's'), ('stance_cv', '접촉시간 CV', '%'), ('swing_mean', 'FSR 비접촉시간', 's'), ('stance_percent', '주기 내 접촉 비율', '%'), ('front_peak', '앞 FSR 피크', '상대값'), ('front_peak_cv', '앞 FSR 피크 CV', '%'), ('rear_peak_cv', '뒤 FSR 피크 CV', '%'), ('pitch_range', '주기별 피치 범위', '°')]
rows = [['지표', '기준선 L / R', '현재 L / R', '현재 좌우 차이']]
for key, label, unit in metrics:
    rows.append([f'{label} ({unit})', f"{f(R['reference']['L'][key]['mean'])} / {f(R['reference']['R'][key]['mean'])}", f"{f(L['metrics'][key])} / {f(RGT['metrics'][key])}", f(R['asymmetry'][key]) + '%'])
y = table(rows, [153, 122, 118, CW - 393], y) - 13
text('CV = 주기 간 표본 표준편차 / 평균 ×100. 좌우 차이는 발별 요약값 비교이며 좌우 시계의 하드웨어 동기화를 뜻하지 않습니다. FSR 상대값은 N·BW·kPa가 아닙니다.', M, y, CW, 8, MUTED)
C.showPage()

y = page(3, '주기별 접촉 패턴', '보행 주기를 0-100%로 정규화했습니다. 실선은 평균, 음영은 동일인의 주기 간 ±1 SD입니다.')
gap, boxw = 22, (CW - 22) / 2
for row, key in enumerate(['front_norm', 'rear_norm']):
    for col, side in enumerate(['L', 'R']):
        b, current = pooled(side, key), R['sides'][side]['ensemble'][key]
        chart(M + col * (boxw + gap), y - row * 240, boxw, 215,
              [{'values': b['mean'], 'sd': b['sd'], 'color': HexColor('#88969E'), 'name': '기준선 3회'},
               {'values': current['mean'], 'sd': current['sd'], 'color': TEAL if side == 'L' else HexColor('#5B54A6'), 'name': '비교 기록'}],
              ('왼발' if side == 'L' else '오른발') + (' 앞 FSR' if key == 'front_norm' else ' 뒤 FSR'), '보행 주기 (%)', 'FSR 상대값')
text('관찰 포인트: 합성 비교 기록에서는 왼발 앞 FSR 피크와 주기 간 파형 일관성이 기준선과 다르게 설정되었습니다. 250점 보간은 약 50 ms인 원래 전송 간격의 정밀도를 높이지 않습니다.', M, y - 493, CW, 9, MUTED)
C.showPage()

y = page(4, '리듬과 자세 변화', '주기별 시간·신발 피치·FSR 탐색용 주파수 분포를 함께 확인합니다.')
chart(M, y, boxw, 220, [{'values': L['cycles'] and [c['stride'] for c in L['cycles']], 'color': TEAL, 'name': '왼발'}, {'values': [c['stride'] for c in RGT['cycles']], 'color': HexColor('#5B54A6'), 'name': '오른발', 'dash': True}], '현재 기록의 주기별 시간', '발별 주기 순서', '주기 (s)', max(L['quality']['cycles'], RGT['quality']['cycles']), 1)
chart(M + boxw + gap, y, boxw, 220, [{'values': L['ensemble']['pitch_relative']['mean'], 'sd': L['ensemble']['pitch_relative']['sd'], 'color': TEAL, 'name': '왼발'}, {'values': RGT['ensemble']['pitch_relative']['mean'], 'sd': RGT['ensemble']['pitch_relative']['sd'], 'color': HexColor('#5B54A6'), 'name': '오른발', 'dash': True}], '현재 기록의 신발 피치', '보행 주기 (%)', '피치 (°)')
series = [{'values': R['sides'][s]['spectrum']['points'] and [p['y'] for p in R['sides'][s]['spectrum']['points']], 'color': TEAL if s == 'L' else HexColor('#5B54A6'), 'name': '왼발' if s == 'L' else '오른발', 'dash': s == 'R'} for s in ['L', 'R']]
chart(M, y - 254, CW, 230, series, 'FSR 합산 신호의 탐색용 PSD', '주파수 (Hz)', 'PSD (상대값²/Hz)', '2.969', '0.625')
text('위 PSD는 신발 FSR 신호의 탐색용 분석입니다. 허리 가속도 기반 Weiss 연구의 지배 주파수·진폭·폭·기울기와 직접 비교하지 않습니다. 현재 펌웨어에는 원시 가속도·각속도가 없으므로 가속도 PSD·RMS·Jerk를 제공하지 않습니다.', M, y - 501, CW, 9, MUTED)
C.showPage()

y = page(5, 'GPT-6.1 Terra 분석', '실제 OpenAI API가 합성 데이터의 계산 결과를 바탕으로 작성한 설명입니다.')
for key, title in [('summary', '종합 요약'), ('observations', '보행 패턴 관찰'), ('quality', '측정 품질 검토'), ('limitations', '해석 시 주의사항'), ('next_steps', '재측정 및 전문 의료진 상담 조건')]:
    y = section(title, y)
    body = R['ai']['analysis'][key]
    for identifier, label in [('patoz2023', '1'), ('weiss2011', '2'), ('anderson2026', '3')]: body = body.replace(identifier, label)
    y = text(body, M, y, CW, 9.4) - 18
text('AI는 계산 결과를 설명하며 진단 모델이 아닙니다. 안내 문구와 실제 지표를 함께 검토해야 합니다.', M, y, CW, 8, MUTED)
C.showPage()

y = page(6, '판단 근거와 사용 범위', '연구 방법의 응용과 팀의 시연 규칙을 구분했습니다.')
y = section('변화 확인 규칙', y)
y = text('기록 20초 이상·유효 주기 10회 이상·동일 보정·약 20 Hz 등 연구 품질 기준을 통과한 경우에만 비교합니다. 동일 조건의 독립 기준선 3회 이상 대비 CV가 20% 이상 증가한 항목을 표시합니다. 두 항목 이상이면 이상 징후 확인을 안내합니다. 이 규칙은 팀의 연구 설정이며 임상 진단·낙상 위험도 기준이 아닙니다.', M, y, CW, 9) - 20
y = section('자료와 해석의 한계', y)
for line in [
    '이 문서는 가상 참여자와 합성 신호로 만든 시연 예시입니다. 실제 측정·환자/대조군 시험·의료진 판정을 거치지 않았습니다.',
    'FSR 두 지점 신호는 발 전체의 지면반력이나 압력 지도가 아닙니다. 약 20 Hz에서는 짧은 지지 구간이나 작은 CV의 정밀한 비교가 제한됩니다.',
    '현재 장치의 독립 검증·확률 보정된 파킨슨병 예측 모델을 사용하지 않았습니다. 질병 여부·확률·치료 필요성은 이 문서로 결정하지 않습니다.',
    '실제 사용 시 측정 조건과 증상 경과를 함께 확인하고, 같은 조건에서도 보행 변화가 지속되면 전문 의료진과 상담해야 합니다.']:
    y = text('• ' + line, M, y, CW, 8.5) - 9

if PRODUCT:
    y = text('70대는 제품 설명을 위한 대상 조건입니다. 연령별 실제 보행 분포의 재현이나 예측 정확도를 검증한 결과를 뜻하지 않습니다.', M, y, CW, 8.5) - 9
y -= 10
y = section('참고 자료', y)
refs = [
    ('[1] Patoz et al. (2023). Isolating the speed factor is crucial in gait analysis for Parkinson’s disease. Frontiers in Neuroscience. DOI: 10.3389/fnins.2023.1119390', 'https://doi.org/10.3389/fnins.2023.1119390'),
    ('[2] Weiss et al. (2011). Toward Automated, At-Home Assessment of Mobility Among Patients With Parkinson Disease, Using a Body-Worn Accelerometer. DOI: 10.1177/1545968311424869', 'https://doi.org/10.1177/1545968311424869'),
    ('[3] Anderson et al. (2026). WearGait-PD. Scientific Data 13, 440. DOI: 10.1038/s41597-026-06806-2', 'https://doi.org/10.1038/s41597-026-06806-2'),
    ('[4] Parkinson’s Foundation. Getting Diagnosed. 전문 의료진의 임상적 평가에 대한 안내.', 'https://www.parkinson.org/understanding-parkinsons/getting-diagnosed')]
for ref, url in refs:
    top = y; y = text(ref, M, y, CW, 8) - 9
    C.linkURL(url, (M, y, W - M, top), relative=0, thickness=0)
y -= 4
y = text('재현 자료: demo-data.json(설정·원신호·분석·AI 응답), demo-current-samples.csv(합성 비교 기록). 난수 시드 20261027. 모델 ' + R['ai']['model'] + '.', M, y, CW, 8, MUTED)
C.save()
print(OUT)
