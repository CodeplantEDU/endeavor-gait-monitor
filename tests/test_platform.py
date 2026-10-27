"""Care-platform integration tests with isolated synthetic research records."""
import json
import unittest
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
import test_api as api_tests
from contextlib import closing
from storage import Store


class PlatformTest(unittest.TestCase):
    setUp = api_tests.ApiTest.setUp
    tearDown = api_tests.ApiTest.tearDown
    call = api_tests.ApiTest.call
    prepare = api_tests.ApiTest.prepare

    def action(self, action, **fields):
        return self.call('/api/platform/' + action, {'participant_id': 'TEST', **fields})

    def today(self):
        return datetime.now(timezone(timedelta(hours=9))).date().isoformat()

    def test_imported_csv_report_is_scoped_and_does_not_require_a_trial(self):
        report = {'schema': 'research-2026-10-25-v1', 'input_mode': 'csv', 'source_type': 'csv_upload', 'trial_id': None, 'probability': {'value': None}, 'csv': {'text': 't_s,side,front\n0,L,1\n'}}
        self.action('research', report=report)
        self.assertEqual(len(self.store.platform_state('TEST')['researchs']), 1)
        self.assertEqual(self.store.platform_state('OTHER')['researchs'], [])
        with self.assertRaises(HTTPError):
            self.action('research', report={**report, 'automatic': True})
        with self.assertRaises(HTTPError):
            self.action('research', report={**report, 'probability': {'value': 0.7}})

    def report(self):
        self.call('/api/trials', self.prepare())
        return self.action('reports', start=self.today(), end=self.today())

    def test_research_report_persists_and_rejects_probability_or_cross_participant(self):
        trial = self.call('/api/trials', self.prepare())
        report = {'schema': 'research-2026-10-25-v1', 'trial_id': trial['id'], 'probability': {'value': None}, 'condition': 'Normal'}
        self.action('research', report=report)
        self.assertEqual(len(Store(self.folder.name).platform_state('TEST')['researchs']), 1)
        self.assertEqual(Store(self.folder.name).platform_state('OTHER')['researchs'], [])
        first = self.action('research', report={**report, 'automatic': True, 'auto_state': 'queued'})
        second = self.action('research', report={**report, 'automatic': True, 'auto_state': 'completed'})
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(len(Store(self.folder.name).platform_state('TEST')['researchs']), 2)
        with self.assertRaises(HTTPError):
            self.call('/api/platform/research', {'participant_id': 'OTHER', 'report': report})
        with self.assertRaises(HTTPError):
            self.action('research', report={**report, 'probability': {'value': 0.9}})

    def test_medication_validation_durable_idempotent_check_and_isolation(self):
        med = self.action('medications', name='SYNTHETIC MED', dose_note='test label only', times=['08:00', '13:00'], start_date=self.today())
        a = self.action('intakes', medication_id=med['id'], date=self.today(), time='08:00', status='taken')
        b = self.action('intakes', medication_id=med['id'], date=self.today(), time='08:00', status='skipped')
        self.assertEqual(a['id'], b['id'])
        self.assertEqual(len(Store(self.folder.name).platform_state('TEST')['intakes']), 1)
        with self.assertRaises(HTTPError): self.action('medications', name='bad', times=['25:00'], start_date=self.today())
        with self.assertRaises(HTTPError): self.call('/api/platform/intakes', {'participant_id': 'OTHER', 'medication_id': med['id'], 'date': self.today(), 'time': '08:00', 'status': 'taken'})
        future = (datetime.now(timezone(timedelta(hours=9))).date() + timedelta(days=1)).isoformat()
        with self.assertRaises(HTTPError): self.action('intakes', medication_id=med['id'], date=future, time='08:00', status='taken')
        self.action('archive-medication', id=med['id'])
        state = self.store.platform_state('TEST')
        self.assertFalse(state['medications'][0]['active']); self.assertEqual(state['intakes'][0]['status'], 'skipped')

    def test_report_uses_actual_records_and_never_fills_missing_scores(self):
        with self.assertRaises(HTTPError): self.action('reports', start=self.today(), end=self.today())
        report = self.report()
        self.assertEqual(report['trial_count'], 1); self.assertEqual(report['average_score'], 75)
        self.assertEqual(report['sides']['R']['metrics']['pitch_range'], None)
        self.assertEqual(self.store.platform_state('OTHER')['reports'], [])

    def test_automatic_monthly_reports_are_closed_month_only_and_not_duplicated(self):
        trial = self.call('/api/trials', self.prepare())
        trial['created_at'] = '2026-08-16T10:00:00+00:00'
        with closing(self.store.connect()) as db:
            db.execute('UPDATE trials SET created=?,payload=? WHERE id=?', (trial['created_at'], json.dumps(trial), trial['id']))
            db.commit()
        state = self.store.platform_state('TEST')
        self.assertEqual(len(state['reports']), 1)
        self.assertTrue(state['reports'][0]['automatic'])
        self.assertEqual(state['reports'][0]['start'], '2026-08-01')
        self.assertEqual(state['reports'][0]['end'], '2026-08-31')
        self.assertEqual(len(Store(self.folder.name).platform_state('TEST')['reports']), 1)

    def test_share_requires_explicit_file_consent_and_remains_undelivered(self):
        report = self.report(); contact = self.action('contacts', name='QA GUARDIAN', role='guardian')
        with self.assertRaises(HTTPError): self.action('shares', report_id=report['id'], contact_id=contact['id'], consent=False)
        item = self.action('shares', report_id=report['id'], contact_id=contact['id'], consent=True, note='<script>test</script>')
        self.assertFalse(item['delivered']); self.assertEqual(item['status'], 'prepared_locally')
        self.assertEqual(item['report_snapshot']['trial_count'], 1)
        self.action('archive-contact', id=contact['id'])
        with self.assertRaises(HTTPError): self.action('shares', report_id=report['id'], contact_id=contact['id'], consent=True)

    def test_care_is_a_local_draft_and_questions_identify_non_ai_guidance(self):
        care = self.action('care', preferred_date=self.today(), service='QA care', region='QA area', note='QA only')
        self.assertFalse(care['submitted']); self.assertEqual(care['status'], 'draft')
        self.assertEqual(self.action('cancel-care', id=care['id'])['status'], 'cancelled')
        for question in ['센서 보정 방법', '약 복용 방법', '파킨슨병 진단', '내 보행 기록 요약']:
            result = self.action('questions', question=question)
            self.assertEqual(result['mode'], 'offline_guidance'); self.assertTrue(result['sources'])
        self.assertFalse(self.store.platform_state('TEST')['external_delivery'])

    def test_settings_bounds_and_participant_separation(self):
        self.action('settings', auto_monthly=False, change_score_threshold=65)
        state = Store(self.folder.name).platform_state('TEST')
        self.assertEqual(state['settings']['change_score_threshold'], 65)
        self.assertFalse(state['settings']['auto_monthly'])
        self.assertEqual(self.store.platform_state('OTHER')['settings']['change_score_threshold'], 70)
        with self.assertRaises(HTTPError): self.action('settings', auto_monthly=True, change_score_threshold=101)


if __name__ == '__main__': unittest.main()
