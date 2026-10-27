"""Isolated browser-QA server. Temporary data is never written to the research database."""
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import argparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler, ROOT
from storage import Store

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8767)
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix='earlybird-qa-') as folder:
    handler = type('QAHandler', (Handler,), {'store': Store(folder)})
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(handler, directory=str(ROOT)))
    print(f'QA only: http://127.0.0.1:{args.port} (temporary database)', flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
