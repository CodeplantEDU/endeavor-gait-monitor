from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler, ROOT


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()

    def test_local_assets_and_module_type(self):
        self.assertEqual(self.server.server_address[0], '127.0.0.1')
        for path in ['/', '/app.mjs', '/protocol.mjs', '/style.css', '/assets/logo-mark.svg', '/assets/Pretendard-Regular.ttf']:
            with urlopen(self.url + path) as response:
                self.assertEqual(response.status, 200)
                self.assertGreater(len(response.read()), 0)
                if path.endswith('.mjs'):
                    self.assertIn('text/javascript', response.headers['Content-Type'])

    def test_source_and_directory_not_exposed(self):
        for path in ['/assets/', '/server.py', '/../server.py', '/%2e%2e/server.py']:
            with self.assertRaises(HTTPError) as error:
                urlopen(self.url + path)
            self.assertEqual(error.exception.code, 404)


if __name__ == '__main__':
    unittest.main()
