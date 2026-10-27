"""Local care workspace. No mail, phone, medical-provider or AI-network calls."""
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
import re
import uuid

KINDS = {'medication', 'intake', 'contact', 'report', 'share', 'care', 'question', 'research'}
SOURCE_PD = 'https://www.parkinson.org/understanding-parkinsons/getting-diagnosed'
SOURCE_MED = 'https://www.nia.nih.gov/health/medicines-and-medication-management/taking-medicines-safely-you-age'


def participant_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,24}', value):
        raise ValueError('참여자 코드를 확인하세요.')
    return value


def string(value, limit=1000, required=True):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ValueError('입력 항목과 글자 수를 확인하세요.')
    return value.strip()


def day(value):
    try:
        result = date.fromisoformat(value)
        if result.isoformat() != value:
            raise ValueError()
        return result
    except (ValueError, TypeError):
        raise ValueError('날짜는 YYYY-MM-DD 형식으로 입력하세요.')


def average(values):
    usable = [x for x in values if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)]
    return sum(usable) / len(usable) if usable else None


class PlatformStoreMixin:
    def init_platform(self):
        with closing(self.connect()) as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS platform_records(id TEXT PRIMARY KEY, participant TEXT NOT NULL, kind TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS platform_participant_kind ON platform_records(participant,kind);
            CREATE TABLE IF NOT EXISTS platform_settings(participant TEXT PRIMARY KEY, payload TEXT NOT NULL);
            ''')
            db.commit()

    def records(self, participant, kind):
        participant_id(participant)
        with closing(self.connect()) as db:
            return [json.loads(row[0]) for row in db.execute('SELECT payload FROM platform_records WHERE participant=? AND kind=? ORDER BY created DESC', (participant, kind))]

    def record(self, participant, record_id, kind=None):
        participant_id(participant)
        with closing(self.connect()) as db:
            row = db.execute('SELECT kind,payload FROM platform_records WHERE participant=? AND id=?', (participant, string(record_id, 100))).fetchone()
        if not row or (kind and row[0] != kind):
            raise KeyError('이 참여자의 기록을 찾을 수 없습니다.')
        return json.loads(row[1])

    def put_record(self, participant, kind, content, record_id=None):
        item = {**content, 'id': record_id or str(uuid.uuid4()), 'participant_id': participant_id(participant), 'kind': kind, 'created_at': content.get('created_at', datetime.now(timezone.utc).isoformat())}
        with closing(self.connect()) as db:
            db.execute('INSERT INTO platform_records VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', (item['id'], participant, kind, item['created_at'], json.dumps(item, ensure_ascii=False, allow_nan=False)))
            db.commit()
        return item

    def platform_settings(self, participant, payload=None):
        participant_id(participant)
        with closing(self.connect()) as db:
            row = db.execute('SELECT payload FROM platform_settings WHERE participant=?', (participant,)).fetchone()
            settings = json.loads(row[0]) if row else {'auto_monthly': True, 'change_score_threshold': 70}
            if payload is not None:
                if not isinstance(payload.get('auto_monthly'), bool):
                    raise ValueError('자동 리포트 설정을 확인하세요.')
                threshold = payload.get('change_score_threshold')
                if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not 0 <= threshold <= 100:
                    raise ValueError('변화 확인 기준은 0~100으로 입력하세요.')
                settings = {'auto_monthly': payload['auto_monthly'], 'change_score_threshold': threshold}
                db.execute('INSERT INTO platform_settings VALUES(?,?) ON CONFLICT(participant) DO UPDATE SET payload=excluded.payload', (participant, json.dumps(settings)))
                db.commit()
        return settings

    def trend(self, participant):
        result = []
        for trial in reversed(self.state(participant)['trials']):
            first = next(iter(trial['summary'].values()), {})
            result.append({key: trial[key] for key in ['id', 'created_at', 'condition', 'trial', 'calibration_ids', 'sample_count']} | {'overall': first.get('overall'), 'sides': {side: {'metrics': summary['metrics'], 'ready': summary.get('ready', False), 'scores': summary.get('scores', {}).get('groups', {})} for side, summary in trial['summary'].items()}})
        return result

    @staticmethod
    def record_date(item):
        # ISO UTC -> Korean calendar date; PC timezone does not change report boundaries.
        return (datetime.fromisoformat(item['created_at']).astimezone(timezone(timedelta(hours=9)))).date()

    def create_report(self, participant, payload, automatic=False):
        start, end = day(payload.get('start')), day(payload.get('end'))
        if end < start or (end - start).days > 366:
            raise ValueError('리포트 기간은 시작일부터 최대 366일로 지정하세요.')
        condition = payload.get('condition', 'All')
        if condition not in {'All', 'Normal', 'ReducedStride', 'Shuffling', 'Asymmetry'}:
            raise ValueError('보행 조건을 확인하세요.')
        trials = [t for t in self.trend(participant) if start <= self.record_date(t) <= end and (condition == 'All' or t['condition'] == condition)]
        if not trials:
            raise ValueError('선택 기간·조건에 저장된 보행 기록이 없습니다. 측정 후 리포트를 생성하세요.')
        threshold = self.platform_settings(participant)['change_score_threshold']
        sides = {}
        keys = ['pitch_range', 'forefoot_peak', 'heel_peak', 'pressure_ratio', 'forefoot_contact', 'heel_contact', 'total_contact', 'interval_mean', 'interval_sd', 'interval_cv']
        for side in ['L', 'R']:
            measured = [t['sides'][side] for t in trials if side in t['sides']]
            sides[side] = {'trial_count': len(measured), 'metrics': {key: average([s['metrics'].get(key) if s['ready'] else None for s in measured]) for key in keys}}
        scores = [t['overall'] for t in trials if isinstance(t['overall'], (float, int)) and math.isfinite(t['overall'])]
        logs = [x for x in self.records(participant, 'intake') if start <= day(x['date']) <= end]
        medication = {'taken_records': sum(x['status'] == 'taken' for x in logs), 'skipped_records': sum(x['status'] == 'skipped' for x in logs), 'note': '사용자가 기록한 횟수이며 실제 복용 여부·치료 효과를 검증하지 않습니다.'}
        content = {'title': string(payload.get('title') or f'{start:%Y.%m.%d} – {end:%Y.%m.%d} 보행·건강 기록', 100), 'start': start.isoformat(), 'end': end.isoformat(), 'condition': condition, 'trial_count': len(trials), 'scored_trials': len(scores), 'average_score': average(scores), 'change_count': sum(x < threshold for x in scores), 'change_score_threshold': threshold, 'sides': sides, 'medication': medication, 'trial_ids': [t['id'] for t in trials], 'calibration_count': len({cid for t in trials for cid in t['calibration_ids'].values()}), 'automatic': automatic, 'limitations': ['개인 보행 기준선 대비 연구용 기록입니다. 질병 진단·위험도·확률이 아닙니다.', '6축 원시 가속도·각속도가 없어 RMS·Jerk는 미측정입니다.', '여러 조건·보정이 섞인 평균은 참고용입니다. 동일 조건·보정의 기록을 비교하세요.']}
        rid = str(uuid.uuid5(uuid.NAMESPACE_URL, f'earlybird:monthly:{participant}:{start}:{end}')) if automatic else None
        return self.put_record(participant, 'report', content, rid)

    def auto_reports(self, participant):
        if not self.platform_settings(participant)['auto_monthly']:
            return
        today = datetime.now(timezone(timedelta(hours=9))).date()
        existing = {(x['start'], x['end']) for x in self.records(participant, 'report') if x['automatic']}
        months = {self.record_date(t).replace(day=1) for t in self.trend(participant)}
        for start in sorted(months):
            next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
            end = next_month - timedelta(days=1)
            if end < today and (start.isoformat(), end.isoformat()) not in existing:
                self.create_report(participant, {'start': start.isoformat(), 'end': end.isoformat()}, automatic=True)

    def auto_all_reports(self):
        with closing(self.connect()) as db:
            participants = [row[0] for row in db.execute('SELECT DISTINCT participant FROM trials')]
        for participant in participants:
            self.auto_reports(participant)

    def platform_state(self, participant):
        participant_id(participant)
        self.auto_reports(participant)
        return {'participant_id': participant, 'settings': self.platform_settings(participant), 'trend': self.trend(participant), **{kind + 's': self.records(participant, kind) for kind in KINDS}, 'ai_mode': 'offline_guidance', 'external_delivery': False}

    def platform_action(self, action, payload):
        participant = participant_id(payload.get('participant_id'))
        if action == 'research':
            report = payload.get('report')
            csv_mode = isinstance(report, dict) and report.get('input_mode') == 'csv'
            if not isinstance(report, dict) or report.get('schema') != 'research-2026-10-25-v1' or report.get('probability', {}).get('value', 0) is not None or len(json.dumps(report, allow_nan=False)) >= (3000000 if csv_mode else 400000):
                raise ValueError('상세 보고서 형식이나 크기를 확인하세요.')
            imported = csv_mode and report.get('source_type') == 'csv_upload' and report.get('trial_id') is None and report.get('automatic') is not True
            if not imported:
                source = self.get_trial(string(report.get('trial_id'), 100))
                if source['participant_id'] != participant:
                    raise ValueError('다른 참여자의 보고서를 저장할 수 없습니다.')
            record_id = f'research:auto:{participant}:{report["trial_id"]}' if report.get('automatic') is True else None
            return self.put_record(participant, 'research', {'report': report}, record_id)
        if action == 'settings':
            return self.platform_settings(participant, payload)
        if action == 'reports':
            return self.create_report(participant, payload)
        if action == 'medications':
            times = payload.get('times')
            if not isinstance(times, list) or not 1 <= len(times) <= 12 or any(not isinstance(t, str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', t) for t in times) or len(set(times)) != len(times):
                raise ValueError('중복 없는 복약 시간(HH:MM)을 1~12개 입력하세요.')
            start = day(payload.get('start_date'))
            end = day(payload['end_date']) if payload.get('end_date') else None
            if end and end < start:
                raise ValueError('종료일은 시작일 이후여야 합니다.')
            return self.put_record(participant, 'medication', {'name': string(payload.get('name'), 80), 'dose_note': string(payload.get('dose_note', ''), 200, False), 'times': sorted(times), 'start_date': start.isoformat(), 'end_date': end.isoformat() if end else None, 'active': True})
        if action == 'intakes':
            med = self.record(participant, payload.get('medication_id'), 'medication')
            date_value, time_value = day(payload.get('date')), payload.get('time')
            if date_value.isoformat() < med['start_date'] or (med['end_date'] and date_value.isoformat() > med['end_date']) or time_value not in med['times']:
                raise ValueError('등록된 복약 일정의 날짜·시간을 확인하세요.')
            if date_value > datetime.now(timezone(timedelta(hours=9))).date():
                raise ValueError('미래 날짜의 복용 완료는 기록할 수 없습니다.')
            if payload.get('status') not in {'taken', 'skipped', 'pending'}:
                raise ValueError('복약 기록 상태를 확인하세요.')
            rid = str(uuid.uuid5(uuid.NAMESPACE_URL, f'earlybird:intake:{participant}:{med["id"]}:{date_value}:{time_value}'))
            return self.put_record(participant, 'intake', {'medication_id': med['id'], 'name': med['name'], 'dose_note': med['dose_note'], 'date': date_value.isoformat(), 'time': time_value, 'status': payload['status'], 'recorded_at': datetime.now(timezone.utc).isoformat()}, rid)
        if action == 'archive-medication':
            med = self.record(participant, payload.get('id'), 'medication')
            med['active'] = False
            return self.put_record(participant, 'medication', med, med['id'])
        if action == 'contacts':
            if payload.get('role') not in {'guardian', 'clinician'}:
                raise ValueError('보호자 또는 의료진 구분을 선택하세요.')
            return self.put_record(participant, 'contact', {'name': string(payload.get('name'), 80), 'role': payload['role'], 'contact_note': string(payload.get('contact_note', ''), 200, False), 'active': True})
        if action == 'archive-contact':
            contact = self.record(participant, payload.get('id'), 'contact')
            contact['active'] = False
            return self.put_record(participant, 'contact', contact, contact['id'])
        if action == 'shares':
            if payload.get('consent') is not True:
                raise ValueError('공유 자료에 포함할 기록을 확인하고 파일 생성에 동의하세요.')
            report = self.record(participant, payload.get('report_id'), 'report')
            contact = self.record(participant, payload.get('contact_id'), 'contact')
            if not contact['active']:
                raise ValueError('사용 중인 공유 대상을 선택하세요.')
            return self.put_record(participant, 'share', {'report_id': report['id'], 'report_snapshot': report, 'recipient': {'name': contact['name'], 'role': contact['role']}, 'note': string(payload.get('note', ''), 500, False), 'status': 'prepared_locally', 'delivered': False})
        if action == 'care':
            preferred = day(payload.get('preferred_date'))
            if preferred < datetime.now(timezone(timedelta(hours=9))).date():
                raise ValueError('희망일은 오늘 이후로 입력하세요.')
            return self.put_record(participant, 'care', {'service': string(payload.get('service'), 80), 'preferred_date': preferred.isoformat(), 'region': string(payload.get('region'), 120), 'requested_to': string(payload.get('requested_to', ''), 120, False), 'note': string(payload.get('note'), 1000), 'status': 'draft', 'submitted': False})
        if action == 'cancel-care':
            item = self.record(participant, payload.get('id'), 'care')
            item['status'] = 'cancelled'
            return self.put_record(participant, 'care', item, item['id'])
        if action == 'questions':
            question = string(payload.get('question'), 1000)
            if re.search('약|복용|복약|용량', question):
                answer = '이 화면은 처방 내용을 직접 등록하고 복약 여부를 기록하는 용도입니다. 약의 종류·용량·복용 시각 변경이나 누락분 처리 방법은 처방한 의료진·약사에게 확인하세요. 자동으로 처방을 제안하지 않습니다.'
                sources = [{'title': 'NIA: Taking Medicines Safely', 'url': SOURCE_MED}]
            elif re.search('파킨슨|진단|위험|병|확률|치료', question):
                answer = '현재 보행 점수만으로 파킨슨병을 진단하거나 위험 확률을 계산할 수 없습니다. 파킨슨병 진단은 병력·증상·신체 진찰 등을 바탕으로 한 임상 평가입니다. 기록한 변화와 궁금한 점을 리포트로 정리해 의료진에게 전달할 수 있습니다.'
                sources = [{'title': "Parkinson’s Foundation: Getting Diagnosed", 'url': SOURCE_PD}]
            elif re.search('보정|캘리|연결|센서|측정', question):
                answer = '실시간 측정에서 왼발·오른발 ESP32를 각각 등록하세요. 각 발을 무부하 기준 자세 4초, 두 FSR 가압 상태 4초로 보정하고 같은 보정에서 Normal 보행 Trial을 3회 이상 수집합니다. 기존 펌웨어는 변경하지 않습니다.'
                sources = [{'title': '이 프로젝트 사용 설명', 'url': '/guide.html'}]
            else:
                data = self.trend(participant)
                latest = next((t['overall'] for t in reversed(data) if isinstance(t['overall'], (float, int))), None)
                answer = f'이 참여자의 저장된 보행 기록은 {len(data)}회입니다. ' + (f'가장 최근 유효 종합점수는 {latest:.0f}/100입니다. ' if latest is not None else '기준선 비교 점수는 아직 없습니다. ') + '점수는 개인 기준선과의 유사도입니다. 장기 추이에서 같은 조건을 선택해 비교하고, 건강 리포트에 질문을 함께 정리하세요. 이 기본 안내는 자유로운 의학 질문에 답하는 AI 모델이 아닙니다.'
                sources = [{'title': '이 프로젝트 사용 설명', 'url': '/guide.html'}]
            return self.put_record(participant, 'question', {'question': question, 'answer': answer, 'sources': sources, 'mode': 'offline_guidance', 'label': '기본 안내 답변 · 규칙 기반'})
        raise KeyError('지원하지 않는 작업입니다.')
