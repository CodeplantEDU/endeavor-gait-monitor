"""Local research records. Data remains outside the web-served dist directory."""
from contextlib import closing
from pathlib import Path
import json
import math
import re
import sqlite3
import uuid
from platform_store import PlatformStoreMixin
from datetime import datetime, timezone

CONDITIONS = {'Normal', 'ReducedStride', 'Shuffling', 'Asymmetry'}
METRICS = {'pitch_range', 'forefoot_peak', 'heel_peak', 'pressure_ratio', 'forefoot_contact', 'heel_contact', 'total_contact', 'interval_mean', 'interval_sd', 'interval_cv'}


def number(value, low=-1e15, high=1e15):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('유효한 수치 범위를 확인하세요.')
    return value


def identity(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,24}', value):
        raise ValueError('참여자 코드는 영문·숫자·밑줄·하이픈 1~24자로 입력하세요.')
    return value


def side(value):
    if value not in ('L', 'R'):
        raise ValueError('발 구분은 L 또는 R이어야 합니다.')
    return value


def text(value, maximum=180):
    if not isinstance(value, str) or not 1 <= len(value) <= maximum or any(ord(c) < 32 for c in value):
        raise ValueError('장치 식별 정보를 확인하세요.')
    return value


class Store(PlatformStoreMixin):
    def __init__(self, folder):
        Path(folder).mkdir(parents=True, exist_ok=True)
        self.path = Path(folder) / 'earlybird.sqlite3'
        with closing(self.connect()) as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS devices(side TEXT PRIMARY KEY, device_id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS calibrations(participant TEXT, side TEXT, device_id TEXT, payload TEXT NOT NULL, PRIMARY KEY(participant,side,device_id));
            CREATE TABLE IF NOT EXISTS trials(id TEXT PRIMARY KEY, participant TEXT, created TEXT, baseline INTEGER DEFAULT 0, payload TEXT NOT NULL);
            ''')
            db.commit()

        self.init_platform()

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

    def state(self, participant):
        identity(participant)
        with closing(self.connect()) as db:
            devices = {s: json.loads(p) for s, p in db.execute('SELECT side,payload FROM devices')}
            calibrations = {s: json.loads(p) for s, d, p in db.execute('SELECT side,device_id,payload FROM calibrations WHERE participant=?', (participant,)) if devices.get(s, {}).get('device_id') == d}
            trials = []
            for tid, baseline, payload in db.execute('SELECT id,baseline,payload FROM trials WHERE participant=? ORDER BY created DESC', (participant,)):
                item = json.loads(payload)
                trials.append({k: item[k] for k in ['id', 'participant_id', 'condition', 'trial', 'created_at', 'summary', 'calibration_ids', 'eligible_baseline', 'sample_count', 'config_snapshot']} | {'baseline': bool(baseline)})
        return {'devices': devices, 'calibrations': calibrations, 'trials': trials}

    def register(self, payload):
        item = {'side': side(payload.get('side')), 'device_id': text(payload.get('device_id')), 'device_name': text(payload.get('device_name'), 80)}
        with closing(self.connect()) as db:
            duplicate = db.execute('SELECT side FROM devices WHERE device_id=? AND side<>?', (item['device_id'], item['side'])).fetchone()
            if duplicate:
                raise ValueError('이 장치는 이미 다른 발에 등록되어 있습니다. 반대쪽 ESP32를 선택하세요.')
            try:
                db.execute('INSERT INTO devices VALUES(?,?,?) ON CONFLICT(side) DO UPDATE SET device_id=excluded.device_id,payload=excluded.payload', (item['side'], item['device_id'], json.dumps(item)))
            except sqlite3.IntegrityError as error:
                raise ValueError('같은 장치를 양쪽 발에 등록할 수 없습니다. 다른 ESP32를 선택하세요.') from error
            db.commit()
        return item

    def calibration(self, payload, config):
        participant = identity(payload.get('participant_id'))
        which = side(payload.get('side'))
        device_id = text(payload.get('device_id'))
        with closing(self.connect()) as db:
            registered = db.execute('SELECT device_id FROM devices WHERE side=?', (which,)).fetchone()
            if not registered or registered[0] != device_id:
                raise ValueError('해당 발의 등록 장치와 보정 장치가 다릅니다.')
            item = {'id': str(uuid.uuid4()), 'participant_id': participant, 'side': which, 'device_id': device_id, 'created_at': datetime.now(timezone.utc).isoformat(), 'uptime': number(payload.get('uptime'), 0, 0xffffffff)}
            for key in ['front', 'rear']:
                supplied = payload.get(key, {})
                zero, loaded = number(supplied.get('zero'), 0, 4095), number(supplied.get('loaded'), 0, 4095)
                if loaded - zero <= 1:
                    raise ValueError('FSR 가압 신호가 무부하 기준보다 충분히 높아야 합니다.')
                item[key] = {'zero': zero, 'loaded': loaded, 'noise': number(supplied.get('noise'), 0, 4095), 'span': loaded - zero, 'on': zero + (loaded - zero) * config['contactOnFraction'], 'off': zero + (loaded - zero) * config['contactOffFraction']}
            item['orientation'] = {key: number(payload.get('orientation', {}).get(key), -180, 180) for key in ['roll', 'pitch', 'yaw']}
            db.execute('INSERT OR REPLACE INTO calibrations VALUES(?,?,?,?)', (participant, which, device_id, json.dumps(item)))
            db.commit()
        return item

    def save_trial(self, payload, config):
        participant = identity(payload.get('participant_id'))
        condition = payload.get('condition')
        if condition not in CONDITIONS:
            raise ValueError('보행 조건을 확인하세요.')
        trial = number(payload.get('trial'), 1, 9999)
        if int(trial) != trial:
            raise ValueError('Trial 번호는 정수여야 합니다.')
        samples = payload.get('samples')
        if not isinstance(samples, list) or not 1 <= len(samples) <= 24000:
            raise ValueError('저장할 샘플 수는 1~24000개입니다.')
        times = {}
        for row in samples:
            which = side(row.get('side'))
            for key in ['front', 'rear']:
                value = number(row.get(key), 0, 4095)
                if int(value) != value:
                    raise ValueError('ADC 원시값은 정수여야 합니다.')
            for key, limit in [('roll', 180), ('pitch', 90), ('yaw', 180)]:
                number(row.get(key), -limit, limit)
            number(row.get('status'), 0, 2)
            current = number(row.get('pc_timestamp_ms'), 0, 1e15)
            if current < times.get(which, current):
                raise ValueError('발별 수신 시각은 증가해야 합니다.')
            times[which] = current
            number(row.get('esp_timestamp'), 0, 0xffffffff)
            for key in ['accel_x', 'accel_y', 'accel_z', 'gyro_x', 'gyro_y', 'gyro_z']:
                if row.get(key) is not None:
                    raise ValueError('현재 펌웨어는 원시 가속도·각속도를 전송하지 않습니다.')
            for value in row.values():
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    number(value)
        summary = payload.get('summary', {})
        calibration_ids = payload.get('calibration_ids', {})
        if set(summary) != set(times):
            raise ValueError('측정된 발과 분석 요약의 발 구분이 다릅니다.')
        eligible = condition == 'Normal'
        for which, result in summary.items():
            side(which)
            metrics = result.get('metrics', {})
            if set(metrics) != METRICS:
                raise ValueError('보행 지표 항목을 확인하세요.')
            for value in metrics.values():
                if value is not None:
                    number(value, 0, 1e10)
            quality = result.get('quality', {})
            eligible &= result.get('ready') is True and number(quality.get('duration'), 0, 10000) >= config['minWindowSeconds'] and number(quality.get('missingFraction'), 0, 1) <= config['maxMissingFraction']
            if which not in calibration_ids:
                raise ValueError('측정 당시 캘리브레이션 ID가 필요합니다.')
        item = {'id': str(uuid.uuid4()), 'created_at': datetime.now(timezone.utc).isoformat(), 'participant_id': participant, 'condition': condition, 'trial': int(trial), 'samples': samples, 'summary': summary, 'calibration_ids': calibration_ids, 'eligible_baseline': bool(eligible), 'config_snapshot': config, 'sample_count': len(samples), 'started_at': text(payload.get('started_at')), 'ended_at': text(payload.get('ended_at'))}
        with closing(self.connect()) as db:
            item['calibration_snapshot'] = {}
            for which, cid in calibration_ids.items():
                records = db.execute('SELECT payload FROM calibrations WHERE participant=? AND side=?', (participant, side(which))).fetchall()
                matches = [json.loads(r[0]) for r in records if json.loads(r[0])['id'] == cid]
                if not matches:
                    raise ValueError('저장된 캘리브레이션과 Trial의 보정 ID가 다릅니다.')
                item['calibration_snapshot'][which] = matches[0]
            db.execute('INSERT INTO trials(id,participant,created,payload) VALUES(?,?,?,?)', (item['id'], participant, item['created_at'], json.dumps(item, allow_nan=False)))
            db.commit()
        return item

    def get_trial(self, tid):
        if not re.fullmatch(r'[0-9a-f-]{36}', tid):
            raise ValueError('Trial ID를 확인하세요.')
        with closing(self.connect()) as db:
            row = db.execute('SELECT payload FROM trials WHERE id=?', (tid,)).fetchone()
        if not row:
            raise KeyError('기록을 찾을 수 없습니다.')
        return json.loads(row[0])

    def set_baseline(self, tid):
        trial = self.get_trial(tid)
        if not trial['eligible_baseline']:
            raise ValueError('충분한 보행 데이터가 있는 Normal Trial만 기준선에 추가할 수 있습니다.')
        with closing(self.connect()) as db:
            db.execute('UPDATE trials SET baseline=1 WHERE id=?', (tid,))
            db.commit()
        return {'ok': True}
