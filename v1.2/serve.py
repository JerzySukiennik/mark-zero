#!/usr/bin/env python3
"""Local server for MARK ZERO. ES modules and .glb need http://, not file://.

    python3 serve.py            # serve on 8770 and open a browser
    python3 serve.py 8788       # a different port
    python3 serve.py 8788 -q    # do not open a browser (for scripts and critics)

It must be THREADING. A plain TCPServer handles one request at a time, and a modern
browser opens six keep-alive connections and holds them: the first connection parks
waiting for more requests, and every other file in the game queues behind it forever.
Measured as a page that never finished loading, not guessed.
"""
import http.server, socketserver, os, sys, webbrowser, threading

args = [a for a in sys.argv[1:] if not a.startswith('-')]
quiet = '-q' in sys.argv or '--no-open' in sys.argv
PORT = int(args[0]) if args else 8770
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
                      '.wasm': 'application/wasm', '.mp3': 'audio/mpeg',
                      '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
                      '.json': 'application/json', '.glsl': 'text/plain'}

    def do_POST(self):
        # Dev-only: lets an automated session save frames straight out of the canvas,
        # which is how the promo screenshots and video clips get captured.
        if self.path != '/shot':
            self.send_error(404); return
        import base64, json as _json
        n = int(self.headers.get('Content-Length', 0))
        payload = _json.loads(self.rfile.read(n))
        name = payload['name'].replace('..', '').lstrip('/')
        target = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots', name)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'wb') as f:
            f.write(base64.b64decode(payload['data'].split(',', 1)[1]))
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'ok')

    def end_headers(self):
        # No caching: Jurek reloads the page to see a change, and a cached module is a
        # change that silently did not happen.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    try:
        httpd = Server(('', PORT), H)
    except OSError as e:
        print(f'Port {PORT} is busy ({e}). Try: python3 serve.py {PORT + 1}')
        sys.exit(1)
    url = f'http://localhost:{PORT}/'
    print('MARK ZERO  ->  ' + url + '   (ctrl-C to stop)')
    if not quiet:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped.')


if __name__ == '__main__':
    main()
