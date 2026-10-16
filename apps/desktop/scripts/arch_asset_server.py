#!/usr/bin/env python3
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


parser = argparse.ArgumentParser()
parser.add_argument("directory")
parser.add_argument("port_file")
arguments = parser.parse_args()
handler = partial(QuietHandler, directory=str(Path(arguments.directory).resolve()))
with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
    Path(arguments.port_file).write_text(f"{server.server_port}\n", encoding="ascii")
    server.serve_forever()
