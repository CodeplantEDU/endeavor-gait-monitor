"""Synthetic records in an isolated temporary SQLite database; no participant data."""
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import copy
import json
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler, ROOT, CONFIG
from storage import Store, METRICS


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.store = Store(self.folder.name)
        self.handler = type('TestHandler', (Handler,), {'store': self.store})
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(self.handler, directory=str(ROOT)))
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.worker.join(); self.folder.cleanup()

    def call(self, path, payload=None, headers=None):
        request = Request(self.url + path, data=json.dumps(payload).encode() if payload is not None else None, headers=headers or ({'Content-Type': 'application/json'} if payload is not None else {}))
        with urlopen(request) as response:
            return json.load(response)

    def prepare(self):
        for which in ['L', 'R']:
            self.call('/api/devices', {'side': which, 'device_id': 'TEST_' + which, 'device_name': 'SYNTHETIC TEST DEVICE'})
        calibration = self.call('/api/calibrations', {'participant_id': 'TEST', 'side': 'L', 'device_id': 'TEST_L', 'uptime': 100, 'front': {'zero': 100, 'loaded': 1100, 'noise': 1}, 'rear': {'zero': 100, 'loaded': 1100, 'noise': 1}, 'orientation': {'roll': 0, 'pitch': 0, 'yaw': 0}})
        sample = {'side': 'L', 'front': 100, 'rear': 100, 'roll': 0, 'pitch': 1, 'yaw': -1, 'status': 2, 'pc_timestamp_ms': 100000, 'pc_timestamp': '1970-01-01T00:01:40Z', 'esp_timestamp': 100, 'sequence': 1, 'calibration_id': calibration['id']}
        summary = {'metrics': {key: 1 for key in METRICS}, 'quality': {'duration': 12, 'missingFraction': 0}, 'ready': True, 'scores': {'groups': {'rotation': 75, 'movement': None, 'jerk': None}}, 'overall': 75}
        return {'participant_id': 'TEST', 'condition': 'Normal', 'trial': 1, 'started_at': 'TEST_START', 'ended_at': 'TEST_END', 'samples': [sample, dict(sample, pc_timestamp_ms=112000)], 'summary': {'L': summary}, 'calibration_ids': {'L': calibration['id']}}

    def test_registration_duplicate_and_calibration_persistence(self):
        self.prepare()
        with self.assertRaises(HTTPError):
            self.call('/api/devices', {'side': 'R', 'device_id': 'TEST_L', 'device_name': 'DUPLICATE'})
        state = Store(self.folder.name).state('TEST')
        self.assertEqual(state['devices']['R']['device_id'], 'TEST_R')
        self.assertEqual(state['calibrations']['L']['front']['on'], 250)
        self.assertEqual(Store(self.folder.name).state('OTHER')['calibrations'], {})

    def test_trial_save_baseline_and_csv_roundtrip(self):
        trial = self.call('/api/trials', self.prepare())
        self.assertTrue(trial['eligible_baseline'])
        self.assertEqual(trial['calibration_snapshot']['L']['front']['span'], 1000)
        self.call(f'/api/trials/{trial["id"]}/baseline', {})
        self.assertTrue(self.call('/api/state?participant=TEST')['trials'][0]['baseline'])
        for filename in ['raw.csv', 'summary.csv']:
            with urlopen(self.url + f'/api/trials/{trial["id"]}/{filename}') as response:
                content = response.read().decode('utf-8-sig')
                self.assertEqual(response.status, 200)
                self.assertIn('participant_id', content)
                self.assertIn('TEST', content)
                self.assertIn('fsr_forefoot' if filename == 'raw.csv' else 'score_movement', content)
        self.assertEqual(Store(self.folder.name).get_trial(trial['id'])['samples'][0]['yaw'], -1)

    def test_non_normal_and_incomplete_trials_cannot_be_baseline(self):
        payload = self.prepare(); payload['condition'] = 'Shuffling'
        trial = self.call('/api/trials', payload)
        self.assertFalse(trial['eligible_baseline'])
        with self.assertRaises(HTTPError): self.call(f'/api/trials/{trial["id"]}/baseline', {})

    def test_invalid_data_origin_and_path_rejected(self):
        payload = self.prepare()
        for mutate in [lambda p: p.update(participant_id='../escape'), lambda p: p['samples'][0].update(front=4096), lambda p: p['samples'][0].update(accel_x=1), lambda p: p['samples'][1].update(pc_timestamp_ms=0)]:
            bad = copy.deepcopy(payload); mutate(bad)
            with self.assertRaises(HTTPError) as error: self.call('/api/trials', bad)
            self.assertEqual(error.exception.code, 400)
        with self.assertRaises(HTTPError): self.call('/api/devices', {}, {'Content-Type': 'application/json', 'Origin': 'https://unrelated.example'})
        with self.assertRaises(HTTPError): self.call('/api/state?participant=../escape')
        for path in ['/data/earlybird.sqlite3', '/storage.py', '/config.json']:
            with self.assertRaises(HTTPError): urlopen(self.url + path)


if __name__ == '__main__': unittest.main()
