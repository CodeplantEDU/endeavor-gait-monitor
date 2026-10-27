"""Serve only the sensor website on this PC; no third-party packages required."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import os
import subprocess
import threading
import webbrowser
import csv
import io
import json
import logging
from urllib.parse import urlsplit, parse_qs
from storage import Store

ROOT = Path(__file__).resolve().parent / 'dist'
CONFIG = json.loads((ROOT.parent / 'config.json').read_text(encoding='utf-8'))


class Handler(SimpleHTTPRequestHandler):
    store = None
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript; charset=utf-8'}

    def json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def valid_origin(self):
        port = self.server.server_port
        allowed = {f'127.0.0.1:{port}', f'localhost:{port}'}
        if self.headers.get('Host') not in allowed or self.headers.get('Origin') not in (None, *(f'http://{host}' for host in allowed)):
            raise ValueError('이 PC의 로컬 페이지에서 요청하세요.')

    def do_GET(self):
        url = urlsplit(self.path)
        if not url.path.startswith('/api/'):
            return super().do_GET()
        try:
            self.valid_origin()
            if url.path == '/api/config':
                return self.json_response(CONFIG)
            if url.path == '/api/state':
                return self.json_response(self.store.state(parse_qs(url.query).get('participant', ['P1'])[0]))
            if url.path == '/api/platform':
                return self.json_response(self.store.platform_state(parse_qs(url.query).get('participant', ['P1'])[0]))
            parts = url.path.strip('/').split('/')
            if len(parts) in (3, 4) and parts[:2] == ['api', 'trials']:
                trial = self.store.get_trial(parts[2])
                if len(parts) == 3:
                    return self.json_response(trial)
                if parts[3] in ('raw.csv', 'summary.csv'):
                    return self.export_csv(trial, parts[3])
            self.send_error(404)
        except ValueError as error:
            self.json_response({'error': str(error)}, 400)
        except KeyError as error:
            self.json_response({'error': str(error)}, 404)

    def do_POST(self):
        try:
            self.valid_origin()
            if self.headers.get_content_type() != 'application/json':
                raise ValueError('JSON 요청이 필요합니다.')
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 20_000_000:
                raise ValueError('요청 크기를 확인하세요. 최대 20MB입니다.')
            payload = json.loads(self.rfile.read(length), parse_constant=lambda value: (_ for _ in ()).throw(ValueError('NaN/Infinity는 저장할 수 없습니다.')))
            if not isinstance(payload, dict):
                raise ValueError('JSON 객체가 필요합니다.')
            routes = {'/api/devices': self.store.register, '/api/calibrations': lambda p: self.store.calibration(p, CONFIG), '/api/trials': lambda p: self.store.save_trial(p, CONFIG)}
            if self.path.startswith('/api/platform/'):
                return self.json_response(self.store.platform_action(self.path.removeprefix('/api/platform/'), payload))
            if self.path in routes:
                return self.json_response(routes[self.path](payload))
            parts = self.path.strip('/').split('/')
            if len(parts) == 4 and parts[:2] == ['api', 'trials'] and parts[3] == 'baseline':
                return self.json_response(self.store.set_baseline(parts[2]))
            self.send_error(404)
        except (ValueError, TypeError, AttributeError) as error:
            self.json_response({'error': str(error)}, 400)
        except KeyError as error:
            self.json_response({'error': str(error)}, 404)

    def export_csv(self, trial, kind):
        output = io.StringIO(newline='')
        if kind == 'raw.csv':
            columns = ['participant_id', 'condition', 'trial', 'pc_timestamp', 'pc_timestamp_ms', 'esp_timestamp', 'esp_unwrapped_ms', 'side', 'device_id', 'sequence', 'status', 'fsr_forefoot', 'fsr_heel', 'front', 'rear', 'roll', 'pitch', 'yaw', 'accel_x', 'accel_y', 'accel_z', 'gyro_x', 'gyro_y', 'gyro_z', 'front_norm', 'rear_norm', 'front_norm_filtered', 'rear_norm_filtered', 'roll_relative', 'pitch_relative', 'yaw_relative', 'pitch_relative_filtered', 'missing_before', 'gap_ms', 'calibration_id']
            rows = [{**{k: trial[k] for k in ['participant_id', 'condition', 'trial']}, **sample, 'fsr_forefoot': sample['front'], 'fsr_heel': sample['rear']} for sample in trial['samples']]
        else:
            columns = ['participant_id', 'condition', 'trial', 'side', 'metric', 'value', 'unit', 'calibration_id', 'analysis_window_seconds', 'baseline_mean', 'baseline_sd', 'percent_change', 'z_score']
            rows = []
            for which, summary in trial['summary'].items():
                for key, value in summary['metrics'].items():
                    unit = 'deg' if key == 'pitch_range' else '%' if key == 'interval_cv' else 's' if 'contact' in key or key.startswith('interval_') else 'normalized'
                    reference = summary.get('baseline_reference', {}).get(key, {})
                    change = summary.get('scores', {}).get('deviations', {}).get(key) or {}
                    rows.append({**{k: trial[k] for k in ['participant_id', 'condition', 'trial']}, 'side': which, 'metric': key, 'value': value, 'unit': unit, 'calibration_id': trial['calibration_ids'][which], 'analysis_window_seconds': trial['config_snapshot']['windowSeconds'], 'baseline_mean': reference.get('mean'), 'baseline_sd': reference.get('sd'), 'percent_change': change.get('percent'), 'z_score': change.get('z')})
                for group in ['movement', 'rotation', 'jerk', 'pressure', 'contact', 'rhythm']:
                    rows.append({'participant_id': trial['participant_id'], 'condition': trial['condition'], 'trial': trial['trial'], 'side': which, 'metric': 'score_' + group, 'value': summary.get('scores', {}).get('groups', {}).get(group), 'unit': 'research_score_0_100'})
            first = next(iter(trial['summary'].values()), {})
            rows.append({'participant_id': trial['participant_id'], 'condition': trial['condition'], 'trial': trial['trial'], 'side': 'ALL', 'metric': 'overall_score', 'value': first.get('overall'), 'unit': 'research_score_0_100'})
            for key, value in first.get('asymmetry', {}).items():
                rows.append({'participant_id': trial['participant_id'], 'condition': trial['condition'], 'trial': trial['trial'], 'side': 'L-R', 'metric': 'AI_' + key, 'value': value, 'unit': '%'})
        writer = csv.DictWriter(output, fieldnames=columns, extrasaction='ignore')
        writer.writeheader()
        for row in rows:
            writer.writerow({k: "'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@', '\t', '\r')) else v for k, v in row.items()})
        body = output.getvalue().encode('utf-8-sig')
        self.send_response(200)
        self.send_header('Content-Type', 'text/csv; charset=utf-8')
        self.send_header('Content-Disposition', f'attachment; filename="{trial["id"]}_{kind}"')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


def open_browser(url):
    for base, relative in [
        (os.environ.get('PROGRAMFILES(X86)', ''), 'Microsoft/Edge/Application/msedge.exe'),
        (os.environ.get('PROGRAMFILES', ''), 'Google/Chrome/Application/chrome.exe'),
        (os.environ.get('LOCALAPPDATA', ''), 'Google/Chrome/Application/chrome.exe'),
    ]:
        executable = Path(base) / relative
        if executable.is_file():
            subprocess.Popen([str(executable), '--new-window', url])
            return
    webbrowser.open(url)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    url = f'http://127.0.0.1:{args.port}'
    Handler.store = Store(ROOT.parent / 'data')
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT)))
    except OSError as error:
        print(f'Cannot start {url}: {error}', flush=True)
        raise SystemExit(1)
    print(f'Sensor monitor: {url}\nStop: Ctrl+C', flush=True)
    if args.open:
        threading.Timer(0.5, open_browser, args=(url,)).start()
    stop_reports = threading.Event()
    def report_worker():
        while not stop_reports.is_set():
            try:
                Handler.store.auto_all_reports()
            except Exception:
                logging.exception('Local monthly report generation failed')
            stop_reports.wait(3600)
    threading.Thread(target=report_worker, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_reports.set()
        server.server_close()


if __name__ == '__main__':
    main()
