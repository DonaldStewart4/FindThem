#!/usr/bin/env python3
# tools/mock-firebase.py — a tiny stand-in for Firebase Realtime Database, for testing
# live sharing on your own computer without a Firebase account.
#
# It understands just what sync.js uses:
#   GET    /path.json                              read
#   GET    /path.json  (Accept: text/event-stream) live stream of "put" / "patch" changes
#   PUT    /path.json                              replace
#   POST   /path.json                              add a child with a new push id → {"name": id}
#   PATCH  /path.json                              write several places at once ("a/b": value)
#   DELETE /path.json                              remove
# Data lives in memory only and disappears when you stop it.
#
# It enforces the same rules as firebase-rules.json (and sync.js's checkEvent / checkCase /
# checkSearcher): a write the rules would refuse gets 401 {"error": "Permission denied"} and
# changes nothing. tests/sync.test.js sends the same good and bad events to sync.js, to the
# rules file and to this mock, and checks that all three agree. If you change a rule, change
# all three.
#
# How the rules are applied here: after a write, every "slot" it touched is checked whole:
#   searches/<32 hex>/case                  written once, never changed, must be a valid case
#   searches/<32 hex>/events/<20-char id>   added once, never changed or deleted, valid event
#   searches/<32 hex>/searchers/<16 hex>    overwritten freely, or deleted; valid position
# Anything else (the root, a whole search, the whole events list, unknown keys) can't be
# written. Reads are allowed only inside searches/<32 hex>.
#
# Run:   python3 tools/mock-firebase.py              (listens on http://localhost:9000)
#        python3 tools/mock-firebase.py --port 0     (any free port; prints which)
# Then open two tabs at http://localhost:8000/?db=http://localhost:9000

import copy
import json
import math
import queue
import random
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 9000
DATA = {}
LOCK = threading.Lock()
LISTENERS = []  # (path_keys, queue) for each open stream

# ---- The rules (the same numbers as firebase-rules.json and sync.js) ---------------------

MIN_TIME = 1600000000000       # ms: Sept 2020
MAX_TIME = 10000000000000      # ms: year 2286 (sync.js's static limit)
MAX_FUTURE_MS = 3600000        # the database refuses times more than 1 h after its own clock

SEARCH_ID = re.compile(r'[0-9a-f]{32}')
SEARCHER_ID = re.compile(r'[0-9a-f]{16}')
PUSH_ID = re.compile(r'[-0-9A-Za-z_]{20}')
SECTOR = re.compile(r'r[0-9]{1,3}c[0-9]{1,3}')
TASK = re.compile(r'[0-9A-Za-z:_-]{1,64}')
CID = re.compile(r'[0-9A-Za-z_.:-]{1,64}')
VERSION = re.compile(r'[0-9A-Za-z._-]{1,40}')
TRACK_INDEX = re.compile(r'0|[1-9][0-9]{0,2}|1[0-9]{3}')  # 0..1999
DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
TRAVEL = ['walking', 'car', 'bus', 'unknown']
# Case fields a 'caseUpdate' may change; the ones listed in CLEARABLE may leave 'value' out.
CASE_UPDATE_FIELDS = ['minutes', 'minutesAt', 'direction', 'mobility', 'familiarPlaces', 'travel', 'description']
CLEARABLE = ['direction', 'familiarPlaces', 'description']


def now_ms():
    return time.time() * 1000


def is_num(v):
    # JSON numbers only: Python's True/False are ints, but not numbers to Firebase.
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def js_len(s):
    # String length the way JavaScript (and Firebase rules) count it: UTF-16 code units,
    # so an emoji counts as 2, the same as in sync.js.
    return len(s.encode('utf-16-le', 'surrogatepass')) // 2


def num(lo, hi):
    return lambda v: is_num(v) and lo <= v <= hi


def text(max_len, min_len=0):
    return lambda v: isinstance(v, str) and min_len <= js_len(v) <= max_len


def pattern(rx):
    return lambda v: isinstance(v, str) and rx.fullmatch(v) is not None


def one_of(values):
    return lambda v: not isinstance(v, (bool, dict, list)) and v in values


def time_now(v):
    return is_num(v) and MIN_TIME <= v <= now_ms() + MAX_FUTURE_MS


def lat(v):
    return is_num(v) and -90 <= v <= 90


def lng(v):
    return is_num(v) and -180 <= v <= 180


def track(v):
    # Firebase stores a list as { "0": .., "1": .. }; it may come in either way.
    items = list(enumerate(v)) if isinstance(v, list) else list(v.items()) if isinstance(v, dict) else None
    if not items:
        return False
    for k, x in items:
        if TRACK_INDEX.fullmatch(str(k)) is None:
            return False
        if not (is_num(x) and x % 1 == 0 and 0 <= x <= 999999):
            return False
    return True


EVENT_FIELDS = {
    'type': text(20),
    'at': time_now,
    'cid': pattern(CID),
    'by': text(40),
    'sectorId': pattern(SECTOR),
    'minutes': num(1, 600),
    'lat': lat,
    'lng': lng,
    'direction': one_of(DIRECTIONS),
    'minutesSince': num(0, 1440),
    'reliability': one_of([0.3, 0.6, 0.9]),
    'note': text(300),
    'text': text(300, 1),
    'taskId': pattern(TASK),
    'searcherId': pattern(SEARCHER_ID),
    'partnerId': pattern(SEARCHER_ID),
    'to': text(40),
    'toId': pattern(SEARCHER_ID),
    'expiresAt': is_num,  # checked against 'at' below
    'searchMin': num(0, 600),
    'fraction': num(0, 1),
    'track': track,
    'field': lambda v: isinstance(v, str) and v in CASE_UPDATE_FIELDS,
    'value': lambda v: True,  # checked in check_event, like the case field it replaces
}

# type → (required fields, optional fields), besides type, at, cid and by.
EVENT_TYPES = {
    'searched': (['sectorId', 'minutes'], []),
    'sighting': (['lat', 'lng', 'minutesSince', 'reliability'], ['direction', 'note']),
    'message': (['text'], []),
    'assigned': ([], ['sectorId', 'taskId', 'to', 'toId', 'searcherId', 'partnerId', 'expiresAt', 'searchMin', 'track']),
    'released': (['searcherId', 'taskId'], ['track', 'fraction']),
    'completed': (['searcherId', 'taskId', 'minutes'], ['track', 'partnerId']),
    'caseUpdate': (['field'], ['value']),
    'found': (['lat', 'lng'], ['note']),
}


def check_event(ev):
    if not isinstance(ev, dict):
        return 'not-an-object'
    shape = EVENT_TYPES.get(ev.get('type')) if isinstance(ev.get('type'), str) else None
    if shape is None:
        return 'unknown-type'
    required, optional = shape
    allowed = set(['type', 'at', 'cid', 'by'] + required + optional)
    for k, v in ev.items():
        if k not in allowed:
            return 'extra:' + k
        if not EVENT_FIELDS[k](v):
            return 'bad:' + k
    for k in ['at'] + required:
        if k not in ev:
            return 'missing:' + k
    if ev['type'] == 'assigned':
        if 'taskId' not in ev and 'sectorId' not in ev:
            return 'missing:taskId'
        if 'searcherId' not in ev and 'toId' not in ev and 'to' not in ev:
            return 'missing:searcherId'
        if 'expiresAt' in ev and not (ev['at'] < ev['expiresAt'] <= ev['at'] + 86400000):
            return 'bad:expiresAt'
    if ev['type'] == 'caseUpdate':
        if 'value' in ev:
            if not CASE_FIELDS[ev['field']](ev['value']):
                return 'bad:value'
        elif ev['field'] not in CLEARABLE:
            return 'missing:value'
    return None


def only_keys(obj, keys):
    return all(k in keys for k in obj)


def familiar(v):
    items = list(enumerate(v)) if isinstance(v, list) else list(v.items()) if isinstance(v, dict) else None
    if items is None:
        return False
    for k, p in items:
        if re.fullmatch(r'[0-2]', str(k)) is None or not isinstance(p, dict):
            return False
        if not (lat(p.get('lat')) and lng(p.get('lng')) and only_keys(p, ['lat', 'lng', 'label'])):
            return False
        if 'label' in p and not text(100)(p['label']):
            return False
    return True


CASE_FIELDS = {
    'lastSeen': lambda v: isinstance(v, dict) and lat(v.get('lat')) and lng(v.get('lng')) and only_keys(v, ['lat', 'lng']),
    'minutes': num(1, 1440),
    'direction': one_of(DIRECTIONS),
    'mobility': one_of(['normal', 'slow', 'walker']),
    'familiarPlaces': familiar,
    'seed': lambda v: is_num(v) and v % 1 == 0 and 0 <= v <= 4294967295,
    'createdAt': time_now,
    'minutesAt': num(MIN_TIME, MAX_TIME),
    'area': one_of(['demo', 'live']),
    'startedBy': text(40),
    'startedAt': num(MIN_TIME, MAX_TIME),
    'engineVersion': pattern(VERSION),
    'travel': one_of(TRAVEL),
    'description': text(300),
}
CASE_REQUIRED = ['lastSeen', 'minutes', 'mobility', 'seed', 'createdAt', 'engineVersion']


def check_case(c):
    if not isinstance(c, dict):
        return 'not-an-object'
    for k, v in c.items():
        if k not in CASE_FIELDS:
            return 'extra:' + k
        if not CASE_FIELDS[k](v):
            return 'bad:' + k
    for k in CASE_REQUIRED:
        if k not in c:
            return 'missing:' + k
    return None


SEARCHER_FIELDS = {'lat': lat, 'lng': lng, 'at': time_now, 'name': text(40)}


def check_searcher(s):
    if not isinstance(s, dict):
        return 'not-an-object'
    for k, v in s.items():
        if k not in SEARCHER_FIELDS:
            return 'extra:' + k
        if not SEARCHER_FIELDS[k](v):
            return 'bad:' + k
    for k in ['lat', 'lng', 'at']:
        if k not in s:
            return 'missing:' + k
    return None


def slot_of(keys):
    # The slot a path is in: ('case', sid) / ('events', sid, id) / ('searchers', sid, id),
    # or None if the rules don't allow writing there.
    if len(keys) < 3 or keys[0] != 'searches' or SEARCH_ID.fullmatch(keys[1]) is None:
        return None
    kind = keys[2]
    if kind == 'case':
        return ('searches', keys[1], 'case')
    if kind == 'events' and len(keys) >= 4 and PUSH_ID.fullmatch(keys[3]):
        return ('searches', keys[1], 'events', keys[3])
    if kind == 'searchers' and len(keys) >= 4 and SEARCHER_ID.fullmatch(keys[3]):
        return ('searches', keys[1], 'searchers', keys[3])
    return None


def check_slot(slot, old, new):
    # None if this change to one slot is allowed, else a reason.
    kind = slot[2]
    if kind == 'case':
        if old is not None:
            return 'case-already-written'
        if new is None:
            return 'delete'
        return check_case(new)
    if kind == 'events':
        if old is not None:
            return 'event-already-exists'
        if new is None:
            return 'delete'
        return check_event(new)
    if new is None:  # a searcher may remove their own dot
        return None
    return check_searcher(new)


# ---- The data tree --------------------------------------------------------------------------


def keys_of(path):
    path = path.split('?')[0]
    if path.endswith('.json'):
        path = path[:-5]
    return [k for k in path.split('/') if k]


def get_at(root, keys):
    node = root
    for k in keys:
        if isinstance(node, list) and k.isdigit() and int(k) < len(node):
            node = node[int(k)]
        elif isinstance(node, dict) and k in node:
            node = node[k]
        else:
            return None
    return node


def without_nulls(value):
    # Firebase never stores null: a null field is simply not there (and [] or {} vanish too).
    if isinstance(value, dict):
        out = {k: without_nulls(v) for k, v in value.items()}
        out = {k: v for k, v in out.items() if v is not None}
        return out or None
    if isinstance(value, list):
        items = [without_nulls(v) for v in value]
        if all(v is None for v in items):
            return None
        if any(v is None for v in items):  # a list with gaps is stored as { "0": .., "2": .. }
            return {str(i): v for i, v in enumerate(items) if v is not None}
        return items
    return value


def set_at(root, keys, value):
    # Returns the new root (root itself is changed in place where possible).
    value = without_nulls(value)
    if not keys:
        return value if isinstance(value, dict) else {}
    node = root
    for k in keys[:-1]:
        if not isinstance(node.get(k), dict):
            node[k] = {}
        node = node[k]
    if value is None:
        node.pop(keys[-1], None)
    else:
        node[keys[-1]] = value
    return root


def try_writes(writes):
    # writes: [(keys, value)]. Applies them all, or none if any slot they touch breaks the
    # rules. Returns None on success, else the reason.
    global DATA
    slots = []
    for keys, _ in writes:
        slot = slot_of(keys)
        if slot is None:
            return 'no-write-rule'
        if slot not in slots:
            slots.append(slot)
    new_root = copy.deepcopy(DATA)
    for keys, value in writes:
        new_root = set_at(new_root, keys, value)
    for slot in slots:
        reason = check_slot(slot, get_at(DATA, list(slot)), get_at(new_root, list(slot)))
        if reason:
            return reason
    DATA = new_root
    return None


def new_push_id():
    # Like Firebase: 8 characters of time, then 12 random ones.
    chars = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'
    t = int(now_ms())
    head = ''
    for _ in range(8):
        head = chars[t % 64] + head
        t //= 64
    return head + ''.join(random.choice(chars) for _ in range(12))


def notify(changed_keys, value, kind='put'):
    for listen_keys, q in list(LISTENERS):
        n = len(listen_keys)
        if changed_keys[:n] == listen_keys:  # change is inside what this stream watches
            rel = '/' + '/'.join(changed_keys[n:])
            q.put((kind, {'path': rel, 'data': value}))
        elif listen_keys[:len(changed_keys)] == changed_keys:  # a parent was replaced
            q.put(('put', {'path': '/', 'data': get_at(DATA, listen_keys)}))


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def reply(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def denied(self, reason):
        print('mock-firebase: refused (%s)' % reason)
        self.reply({'error': 'Permission denied'}, 401)

    def read_body(self):
        # Returns (ok, value). Firebase answers 400 to a body that isn't JSON.
        length = int(self.headers.get('Content-Length') or 0)
        try:
            return True, json.loads(self.rfile.read(length) or b'null')
        except ValueError:
            self.reply({'error': "Invalid data; couldn't parse JSON object."}, 400)
            return False, None

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def readable(self, keys):
        return len(keys) >= 2 and keys[0] == 'searches' and SEARCH_ID.fullmatch(keys[1]) is not None

    def do_GET(self):
        keys = keys_of(self.path)
        if not self.readable(keys):
            return self.denied('no-read-rule')
        if 'text/event-stream' not in (self.headers.get('Accept') or ''):
            with LOCK:
                return self.reply(get_at(DATA, keys))
        # Live stream: send everything now, then every change.
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.cors()
        self.end_headers()
        q = queue.Queue()
        with LOCK:
            LISTENERS.append((keys, q))
            q.put(('put', {'path': '/', 'data': get_at(DATA, keys)}))
        try:
            while True:
                try:
                    kind, msg = q.get(timeout=15)
                    self.wfile.write(('event: %s\ndata: %s\n\n' % (kind, json.dumps(msg))).encode())
                except queue.Empty:
                    self.wfile.write(b'event: keep-alive\ndata: null\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with LOCK:
                LISTENERS.remove((keys, q))

    def do_PUT(self):
        keys = keys_of(self.path)
        ok, value = self.read_body()
        if not ok:
            return
        with LOCK:
            reason = try_writes([(keys, value)])
            if reason:
                return self.denied(reason)
            notify(keys, get_at(DATA, keys))
            self.reply(get_at(DATA, keys))

    def do_DELETE(self):
        keys = keys_of(self.path)
        with LOCK:
            reason = try_writes([(keys, None)])
            if reason:
                return self.denied(reason)
            notify(keys, None)
            self.reply(None)

    def do_POST(self):
        keys = keys_of(self.path)
        ok, value = self.read_body()
        if not ok:
            return
        with LOCK:
            new_id = new_push_id()
            reason = try_writes([(keys + [new_id], value)])
            if reason:
                return self.denied(reason)
            notify(keys + [new_id], get_at(DATA, keys + [new_id]))
            self.reply({'name': new_id})

    def do_PATCH(self):
        # Each key may be a path ("events/-Nab…"); all are written together, or none.
        keys = keys_of(self.path)
        ok, value = self.read_body()
        if not ok:
            return
        if not isinstance(value, dict) or not value:
            return self.reply({'error': 'Invalid data; PATCH needs an object.'}, 400)
        writes = [(keys + [k for k in sub.split('/') if k], v) for sub, v in value.items()]
        with LOCK:
            reason = try_writes(writes)
            if reason:
                return self.denied(reason)
            stored = {sub: get_at(DATA, w[0]) for sub, w in zip(value.keys(), writes)}
            notify(keys, stored, kind='patch')
            self.reply(value)

    def log_message(self, fmt, *args):
        print('mock-firebase:', fmt % args)


if __name__ == '__main__':
    if '--port' in sys.argv:
        PORT = int(sys.argv[sys.argv.index('--port') + 1])
    server = ThreadingHTTPServer(('localhost', PORT), Handler)
    print('Mock Firebase on http://localhost:%d (in memory, Ctrl+C to stop)' % server.server_address[1], flush=True)
    server.serve_forever()
