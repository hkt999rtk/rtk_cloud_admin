#!/usr/bin/env python3
"""Bounded device simulator supervision with runtime-token renewal. Python 3.10+."""
import argparse
import base64
import json
import os
from pathlib import Path
import random
import signal
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def lifetime(bundle, now=None):
    # Scheduling only: the server is responsible for signature and authorization checks.
    try:
        raw = bundle['access_token'].split('.')[1]
        exp = json.loads(base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4)))['exp']
        if not isinstance(exp, (int, float)) or isinstance(exp, bool):
            raise ValueError()
        return exp - (time.time() if now is None else now)
    except (KeyError, IndexError, ValueError, TypeError):
        raise RuntimeError('Token has no usable expiry; stop and inspect issuance') from None


def validate(bundle):
    if not isinstance(bundle, dict) or not isinstance(bundle.get('mqtt'), dict):
        raise RuntimeError('Token response is missing required MQTT fields')
    if not all(isinstance(value, str) and value for value in (
            bundle.get('access_token'), bundle.get('mqtt', {}).get('username'),
            bundle.get('mqtt', {}).get('client_id'))):
        raise RuntimeError('Token response is missing required MQTT fields')
    if lifetime(bundle) <= 5:
        raise RuntimeError('Token lifetime too short; verify clock and issuance policy')
    return bundle


def post(origin, path, payload, context):
    if not origin.startswith('https://'):
        raise RuntimeError('Token origins must use HTTPS')
    request = urllib.request.Request(origin.rstrip('/') + path,
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    # Do not follow redirects carrying credential bodies to a different origin.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))
    with opener.open(request, timeout=10) as response:
        return validate(json.load(response))


def obtain(current, request_token, refresh_token):
    if current and lifetime(current) > 30:
        try:
            result = refresh_token(current)
            print('RECOVERY reissue succeeded', flush=True)
            return result
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise
    result = request_token()
    print('RECOVERY bootstrap succeeded', flush=True)
    return result


def stop(worker):
    if worker and worker.poll() is None:
        worker.send_signal(signal.SIGINT)
        try:
            worker.wait(timeout=5)
        except subprocess.TimeoutExpired:
            worker.kill()
            worker.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--duration', type=int, default=3600)
    parser.add_argument('--attempts', type=int, default=6)
    args = parser.parse_args()
    if args.duration < 1 or not 1 <= args.attempts <= 10:
        parser.error('duration must be positive; attempts must be 1–10')
    for name in ['DEVICE_TOKEN_BASE', 'API_BASE', 'DEVICE_CERT', 'DEVICE_KEY', 'CA_FILE', 'DEVICE_ID', 'MQTT_HOST']:
        if not os.getenv(name):
            parser.error('Missing environment setting: ' + name)
    worker = None
    current = None
    failures = 0
    deadline = time.monotonic() + args.duration
    try:
        normal = ssl.create_default_context(cafile=os.environ['CA_FILE'])
        mtls = ssl.create_default_context(cafile=os.environ['CA_FILE'])
        mtls.load_cert_chain(os.environ['DEVICE_CERT'], os.environ['DEVICE_KEY'])
        bootstrap = lambda: post(os.environ['DEVICE_TOKEN_BASE'], '/request_token',
            {'scope': 'device', 'devid': os.environ['DEVICE_ID']}, mtls)
        refresh = lambda token: post(os.environ['API_BASE'], '/refresh_token',
            {'refresh_token': token['access_token']}, normal)
        with tempfile.TemporaryDirectory(prefix='rtk-shadow-recovery-') as directory:
            path = Path(directory) / 'device-token.json'
            while time.monotonic() < deadline:
                try:
                    current = obtain(current, bootstrap, refresh)
                    left = lifetime(current)
                    margin = min(60, left / 3)
                    seconds = max(1, int(min(left - margin, deadline - time.monotonic())))
                    path.write_text(json.dumps(current))
                    path.chmod(0o600)
                    worker = subprocess.Popen([sys.executable, str(Path(__file__).with_name('demo.py')),
                        'device', '--token-file', str(path), '--seconds', str(seconds)])
                    try:
                        code = worker.wait(timeout=max(1, min(seconds + 15, deadline-time.monotonic())))
                    except subprocess.TimeoutExpired:
                        stop(worker)
                        code = 0 if time.monotonic() >= deadline else 1
                    if code != 0:
                        raise RuntimeError('Worker exited; reconnect and reconcile within retry budget')
                    failures = 0
                except (urllib.error.URLError, TimeoutError, OSError, ValueError, RuntimeError) as error:
                    stop(worker)
                    if isinstance(error, urllib.error.HTTPError) and error.code not in (401, 429, 500, 502, 503, 504):
                        print(f'RECOVERY terminal HTTP {error.code}; inspect authorization or request')
                        return 1
                    failures += 1
                    if failures >= args.attempts:
                        print('RECOVERY retry budget exhausted; inspect the first failing layer')
                        return 1
                    delay = min(30, 2 ** failures) + random.random()
                    print(f'RECOVERY temporary failure; retry {failures}/{args.attempts}', flush=True)
                    time.sleep(max(0, min(delay, deadline-time.monotonic())))
        return 1 if failures else 0
    except KeyboardInterrupt:
        return 130
    except (OSError, ValueError, RuntimeError):
        print('RECOVERY setup failed; check certificate, key, CA and token settings')
        return 1
    finally:
        stop(worker)


if __name__ == '__main__':
    raise SystemExit(main())
