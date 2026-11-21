#!/usr/bin/env python3
# tools/mock-proxy.py — a fake proxy for testing the report box without a Jev (TypeSafe) key.
#
# It answers like proxy/worker.js (a ReportDraft JSON), but with simple keyword rules
# instead of Jev, so you can test the screen for free and offline:
#   "saw", "seen", "vi", "vu", "看到", "見"     → kind "sighting" (otherwise "message")
#   "searched", "checked", "nobody"             → kind "searched"
#   a number before "min"                       → minutesSince
#   north / east / ... (English only)           → direction
#   maybe / think / sure ...                    → reliability 0.3 / 0.6 / 0.9
#   a nearby place name from context.places     → lat/lng of that place (like Jev's place choice)
#   the word "here"                             → lat/lng = the last-seen point (tests the "pinned" path)
#
# Voice bot (Deepgram / ElevenLabs stand-ins), only with --voice:
#   GET  /voice   → {"listen": true, "speak": true}   (without --voice: both false, like a
#                   proxy with no voice keys, so the app keeps the phone's own voice input)
#   POST /listen  → a fixed sentence, whatever was recorded ("I saw him by Lake Elizabeth...")
#   POST /speak   → a short beep (WAV), so you can hear that the read-back plays
#
# Run:   python3 tools/mock-proxy.py           (listens on http://localhost:9100)
#        python3 tools/mock-proxy.py --voice   (also pretends the voice keys are set)
# Then open http://localhost:8000/?proxy=http://localhost:9100

import io
import json
import math
import re
import struct
import sys
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 9100
VOICE = '--voice' in sys.argv
FAKE_TRANSCRIPT = 'I saw him by Lake Elizabeth 10 minutes ago, blue coat, walking east'


def beep_wav():
    # 0.4 s of a soft 660 Hz tone, as a WAV file in memory.
    rate = 16000
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', int(6000 * math.sin(2 * math.pi * 660 * i / rate)))
                               for i in range(int(rate * 0.4))))
    return buf.getvalue()


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
    place_text = ''
    for p in context.get('places') or []:
        name = str(p.get('name', ''))
        if name and name.lower() in low:
            lat, lng, place_text = p.get('lat'), p.get('lng'), name
            break
    if lat is None and 'here' in low and context.get('lastSeen'):
        lat, lng = context['lastSeen']['lat'], context['lastSeen']['lng']
    coat = re.search(r'(\w+ (coat|jacket|shirt|hat|sweater))', low)
    note = coat.group(1) if coat else ''
    if kind == 'message':
        note = text
    return {
        'kind': kind, 'placeText': place_text, 'lat': lat, 'lng': lng, 'direction': direction,
        'minutesSince': int(m.group(1)) if m else None, 'reliability': reliability, 'note': note,
    }


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def send(self, status, data, content_type='application/json'):
        out = json.dumps(data).encode() if content_type == 'application/json' else data
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(out)))
        self.cors()
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self):
        if self.path.startswith('/voice'):
            self.send(200, {'listen': VOICE, 'speak': VOICE})
        else:
            self.send(404, {'error': 'not_found'})

    def do_POST(self):
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length)
        if self.path.startswith('/listen'):
            if not VOICE:
                return self.send(503, {'error': 'not_configured'})
            print('mock-proxy: got %d bytes of audio (%s)' % (len(raw), self.headers.get('Content-Type')))
            return self.send(200, {'text': FAKE_TRANSCRIPT})
        if self.path.startswith('/speak'):
            if not VOICE:
                return self.send(503, {'error': 'not_configured'})
            print('mock-proxy: would say:', json.loads(raw or b'{}').get('text'))
            return self.send(200, beep_wav(), 'audio/wav')
        body = json.loads(raw or b'{}')
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
    print('Mock proxy on http://localhost:%d (keyword rules, no AI; voice bot %s)' % (PORT, 'ON' if VOICE else 'off'))
    ThreadingHTTPServer(('localhost', PORT), Handler).serve_forever()
