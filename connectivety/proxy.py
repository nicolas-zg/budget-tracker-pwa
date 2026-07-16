#!/usr/bin/env python3
"""
Static file server + API proxy for the barrier-free routing spike.
Keeps the OJP token server-side and avoids browser CORS restrictions.

Usage: python3 proxy.py [port]  (default: 8766)
"""
import sys
import os
import mimetypes
import urllib.request
import urllib.error
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

TOKEN   = 'eyJvcmciOiI2NDA2NTFhNTIyZmEwNTAwMDEyOWJiZTEiLCJpZCI6ImNlNWNkMDVkM2M5MzQwZDM5N2ExZmI3NWY1Y2UzYmQyIiwiaCI6Im11cm11cjEyOCJ9'
OJP_URL = 'https://api.opentransportdata.swiss/ojp20'

# aufzugzustand (real-time elevator status) no longer exists on data.sbb.ch — H1 finding.
# Using prm_stop_places instead: static BehiG accessibility data per platform, sloid-keyed.
# Stations (verified via OJP LocationInformation):
#   ZH HB=3000, Altstetten=3001, Stadelhofen=3003, Oerlikon=3006, Enge=3010, Wiedikon=3011
_SLOID_PARTS = ['3000', '3001', '3003', '3006', '3010', '3011']
_WHERE = ' OR '.join(f"sloid like 'ch:1:sloid:{s}%'" for s in _SLOID_PARTS)
PRM_URL = (
    'https://data.sbb.ch/api/explore/v2.1/catalog/datasets/prm_stop_places/records'
    f'?where={urllib.parse.quote(_WHERE)}&limit=100'
)

STATIC_ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(fmt % args)

    def send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        if self.path == '/proxy/prm':
            self._proxy_get(PRM_URL, 'application/json')
        else:
            self._serve_static()

    def do_POST(self):
        if self.path == '/proxy/ojp':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            req = urllib.request.Request(
                OJP_URL,
                data=body,
                headers={
                    'Content-Type': 'application/xml',
                    'Authorization': f'Bearer {TOKEN}',
                },
                method='POST',
            )
            try:
                with urllib.request.urlopen(req) as resp:
                    data = resp.read()
                    self.send_response(200)
                    self.send_cors()
                    self.send_header('Content-Type', 'application/xml; charset=utf-8')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
            except urllib.error.HTTPError as e:
                data = e.read()
                self.send_response(e.code)
                self.send_cors()
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(data)
        else:
            self.send_error(404)

    def _proxy_get(self, url, content_type):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'barrier-free-spike/1.0'})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
            self.send_response(200)
            self.send_cors()
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as e:
            body = e.read()
            print(f'[proxy] upstream HTTP {e.code} for {url}: {body[:200]}')
            self.send_response(e.code)
            self.send_cors()
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            print(f'[proxy] error fetching {url}: {e}')
            self.send_response(502)
            self.send_cors()
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(str(e).encode())

    def _serve_static(self):
        path = self.path.split('?')[0]
        if path == '/':
            path = '/index.html'
        filepath = os.path.join(STATIC_ROOT, path.lstrip('/'))
        if not os.path.isfile(filepath):
            self.send_error(404)
            return
        mime, _ = mimetypes.guess_type(filepath)
        with open(filepath, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_cors()
        self.send_header('Content-Type', mime or 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    server = HTTPServer(('', port), Handler)
    print(f'Serving on http://localhost:{port}  (Ctrl+C to stop)')
    server.serve_forever()
