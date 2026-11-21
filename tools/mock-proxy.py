#!/usr/bin/env python3
# tools/mock-proxy.py — a fake LLM proxy for testing the report box without DeepSeek.
#
# It answers like proxy/worker.js (a ReportDraft JSON), but with simple keyword rules
# instead of an AI, so you can test the screen for free and offline:
#   "saw", "seen", "vi", "vu", "看到", "見"     → kind "sighting" (otherwise "message")
#   "searched", "checked", "nobody"             → kind "searched"
#   a number before "min"                       → minutesSince
#   north / east / ... (English only)           → direction
#   maybe / think / sure ...                    → reliability 0.3 / 0.6 / 0.9
#   the word "here"                             → lat/lng = the last-seen point (tests the "pinned" path)
#
# Run:   python3 tools/mock-proxy.py        (listens on http://localhost:9100)
# Then open http://localhost:8000/?proxy=http://localhost:9100

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 9100
DIRS = [('northeast', 'NE'), ('northwest', 'NW'), ('southeast', 'SE'), ('southwest', 'SW'),
        ('north', 'N'), ('south', 'S'), ('east', 'E'), ('west', 'W')]


def draft_for(text, context):
    low = text.lower()
    kind = 'message'
    if re.search(r'\b(searched|checked|nobody)\b', low):
        kind = 'searched'
    elif re.search(r'\b(saw|seen|vi|vu)\b', low) or '看到' in text or '見' in text:
        kind = 'sighting'
    m = re.search(r'(\d+)\s*(min|minute)', low)
    direction = next((code for word, code in DIRS if word in low), None)
    if re.search(r'\b(maybe|might|not sure)\b', low):
        reliability = 0.3
    elif re.search(r'\b(definitely|sure|certain)\b', low):
        reliability = 0.9
    else:
        reliability = 0.6
    lat = lng = None
    if 'here' in low and context.get('lastSeen'):
        lat, lng = context['lastSeen']['lat'], context['lastSeen']['lng']
    coat = re.search(r'(\w+ (coat|jacket|shirt|hat|sweater))', low)
    note = coat.group(1) if coat else ''
    if kind == 'message':
        note = text
    return {
        'kind': kind, 'placeText': text[:80], 'lat': lat, 'lng': lng, 'direction': direction,
        'minutesSince': int(m.group(1)) if m else None, 'reliability': reliability, 'note': note,
    }


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(length) or b'{}')
        draft = draft_for(str(body.get('text', '')), body.get('context') or {})
        out = json.dumps(draft).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(out)))
        self.cors()
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, fmt, *args):
        print('mock-proxy:', fmt % args)


if __name__ == '__main__':
    print('Mock LLM proxy on http://localhost:%d (keyword rules, no AI)' % PORT)
    ThreadingHTTPServer(('localhost', PORT), Handler).serve_forever()
