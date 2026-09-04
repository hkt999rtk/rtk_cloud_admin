#!/usr/bin/env python3
"""Read-only Shadow probes; --exercise explicitly changes the tutorial Shadow."""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from types import SimpleNamespace
from demo import Session, token


def probe(session, role):
    correlation = token()
    session.publish('get', {'clientToken': correlation})
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        item = session.receive()
        if not item:
            continue
        topic, body = item
        if body.get('clientToken') != correlation:
            continue
        if topic.endswith('/get/accepted'):
            print(f"CHECK {role}: GET accepted, version={body.get('version')}")
            return
        if topic.endswith('/get/rejected'):
            if body.get('code') == 404:
                print(f'CHECK {role}: Shadow missing (404), creation not tested')
                return
            raise RuntimeError(f"CHECK {role}: GET rejected, code={body.get('code')}")
    raise RuntimeError(f'CHECK {role}: response deadline expired')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device-token', required=True)
    parser.add_argument('--app-token', required=True)
    parser.add_argument('--exercise', action='store_true')
    args = parser.parse_args()
    for name in ['MQTT_HOST', 'CA_FILE', 'DEVICE_ID']:
        if not os.getenv(name):
            parser.error('Missing environment setting: '+name)
    shadow = os.getenv('SHADOW_NAME', 'tutorial')
    if args.exercise and shadow != 'tutorial':
        parser.error('--exercise is restricted to the dedicated tutorial Shadow')
    worker = None
    try:
        for role, path in [('device', args.device_token), ('app', args.app_token)]:
            session = Session(SimpleNamespace(token_file=path, device_id=os.environ['DEVICE_ID'],
                shadow=shadow, role='check-'+role, host=os.environ['MQTT_HOST'],
                port=int(os.getenv('MQTT_PORT','8883')), ca_file=os.environ['CA_FILE']))
            try:
                probe(session,role)
            finally:
                session.close()
        print('PASS: read-only probes completed')
        if args.exercise:
            demo = str(Path(__file__).with_name('demo.py'))
            worker = subprocess.Popen([sys.executable,demo,'device','--token-file',args.device_token,'--seconds','60'])
            result = subprocess.run([sys.executable,demo,'app','--token-file',args.app_token,'--power','on','--seconds','45'],timeout=65)
            if result.returncode != 0:
                raise RuntimeError('Control exercise failed; inspect current state before retry')
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        print(str(error) if isinstance(error,RuntimeError) else 'CHECK failed: '+type(error).__name__)
        return 1
    finally:
        if worker and worker.poll() is None:
            worker.send_signal(signal.SIGINT)
            try:
                worker.wait(timeout=5)
            except subprocess.TimeoutExpired:
                worker.kill();worker.wait()


if __name__ == '__main__':
    raise SystemExit(main())
