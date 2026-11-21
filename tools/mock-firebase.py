#!/usr/bin/env python3
# tools/mock-firebase.py — a tiny stand-in for Firebase Realtime Database, for testing
# live sharing on your own computer without a Firebase account.
#
# It understands just what sync.js uses:
#   GET  /path.json                        read
#   GET  /path.json  (Accept: text/event-stream)   live stream of "put" events
#   PUT  /path.json                        replace
#   POST /path.json                        add a child with a new push id → {"name": id}
# Data lives in memory only and disappears when you stop it.
#
# Run:   python3 tools/mock-firebase.py          (listens on http://localhost:9000)
# Then open two tabs at http://localhost:8000/?db=http://localhost:9000

import json
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 9000
DATA = {}
LOCK = threading.Lock()
LISTENERS = []  # (path_keys, queue) for each open stream
COUNTER = [0]


def keys_of(path):
    path = path.split('?')[0]
    if path.endswith('.json'):
        path = path[:-5]
    return [k for k in path.split('/') if k]


def get_at(keys):
    node = DATA
    for k in keys:
        if not isinstance(node, dict) or k not in node:
            return None
        node = node[k]
    return node


def set_at(keys, value):
    global DATA
    if not keys:
        DATA = value if isinstance(value, dict) else {}
        return
    node = DATA
    for k in keys[:-1]:
        if not isinstance(node.get(k), dict):
            node[k] = {}
        node = node[k]
    if value is None:
        node.pop(keys[-1], None)
    else:
        node[keys[-1]] = value


def push_id():
    # Like Firebase: starts with the time, so ids sort in the order they were made.
    COUNTER[0] += 1
    return '-M%013d%04d' % (int(time.time() * 1000), COUNTER[0])


def notify(changed_keys, value):
    for listen_keys, q in list(LISTENERS):
        n = len(listen_keys)
        if changed_keys[:n] == listen_keys:  # change is inside what this stream watches
            rel = '/' + '/'.join(changed_keys[n:])
            q.put({'path': rel, 'data': value})
        elif listen_keys[:len(changed_keys)] == changed_keys:  # a parent was replaced
            q.put({'path': '/', 'data': get_at(listen_keys)})


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def reply(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(length) or b'null')

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        keys = keys_of(self.path)
        if 'text/event-stream' not in (self.headers.get('Accept') or ''):
            with LOCK:
                return self.reply(get_at(keys))
        # Live stream: send everything now, then every change.
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.cors()
        self.end_headers()
        q = queue.Queue()
        with LOCK:
            LISTENERS.append((keys, q))
            q.put({'path': '/', 'data': get_at(keys)})
        try:
            while True:
                try:
                    msg = q.get(timeout=15)
                    self.wfile.write(('event: put\ndata: %s\n\n' % json.dumps(msg)).encode())
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
        value = self.read_body()
        with LOCK:
            set_at(keys, value)
            notify(keys, value)
        self.reply(value)

    def do_POST(self):
        keys = keys_of(self.path)
        value = self.read_body()
        with LOCK:
            new_id = push_id()
            set_at(keys + [new_id], value)
            notify(keys + [new_id], value)
        self.reply({'name': new_id})

    def log_message(self, fmt, *args):
        print('mock-firebase:', fmt % args)


if __name__ == '__main__':
    print('Mock Firebase on http://localhost:%d (in memory, Ctrl+C to stop)' % PORT)
    ThreadingHTTPServer(('localhost', PORT), Handler).serve_forever()
