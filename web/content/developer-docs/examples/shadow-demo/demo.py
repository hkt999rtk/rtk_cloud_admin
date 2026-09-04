#!/usr/bin/env python3
"""Two-principal RTK Shadow simulator. Requires Python 3.10+ and paho-mqtt 2.1.0."""
import argparse
import json
import os
from pathlib import Path
import queue
import ssl
import threading
import time
import uuid

import paho.mqtt.client as mqtt


def token():
    return "demo-" + uuid.uuid4().hex


class Session:
    def __init__(self, args):
        credentials = json.loads(Path(args.token_file).read_text())
        self.root = f"$vc/devices/{args.device_id}/shadow/name/{args.shadow}"
        self.messages = queue.Queue(maxsize=256)
        self.ready = threading.Event()
        self.failure = None
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                  client_id=credentials['mqtt']['client_id'] + '-demo-' + args.role,
                                  protocol=mqtt.MQTTv311, clean_session=True)
        self.client.username_pw_set(credentials['mqtt']['username'], credentials['access_token'])
        self.client.tls_set(ca_certs=args.ca_file, cert_reqs=ssl.CERT_REQUIRED)
        self.client.on_connect = self.on_connect
        self.client.on_subscribe = self.on_subscribe
        self.client.on_disconnect = self.on_disconnect
        self.client.on_message = self.on_message
        self.client.connect(args.host, args.port, keepalive=60)
        self.client.loop_start()
        if not self.ready.wait(15) or self.failure:
            self.close()
            raise RuntimeError(self.failure or 'Timed out waiting for connection and SUBACK')

    def on_connect(self, client, userdata, flags, reason, properties):
        if reason.is_failure:
            self.failure = 'MQTT CONNECT rejected; check credentials and mqtt capability'
            self.ready.set()
            return
        suffixes = ['get/accepted', 'get/rejected', 'update/accepted', 'update/rejected', 'update/delta']
        rc, _ = client.subscribe([(self.root + '/' + suffix, 1) for suffix in suffixes])
        if rc != mqtt.MQTT_ERR_SUCCESS:
            self.failure = 'Could not submit subscriptions'
            self.ready.set()

    def on_subscribe(self, client, userdata, mid, reasons, properties):
        if not reasons or any(reason.is_failure for reason in reasons):
            self.failure = 'SUBACK rejected; check exact topics and iot_shadow permission'
        self.ready.set()

    def on_disconnect(self, client, userdata, flags, reason, properties):
        # This bounded tutorial exits on disconnect rather than hiding recovery policy.
        self.failure = 'Disconnected; obtain current credentials and restart the demo'

    def on_message(self, client, userdata, message):
        try:
            body = json.loads(message.payload)
            if not isinstance(body, dict):
                raise ValueError('Expected an object')
            self.messages.put_nowait((message.topic, body))
        except (ValueError, queue.Full):
            self.failure = 'Invalid JSON or full receive queue; stop and inspect the integration'

    def publish(self, operation, body):
        result = self.client.publish(self.root + '/' + operation, json.dumps(body), qos=1, retain=False)
        if result.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError('Publish could not be queued')
        result.wait_for_publish(timeout=10)
        if not result.is_published():
            raise RuntimeError('Transport acknowledgement timed out; mutation outcome is unknown')

    def receive(self):
        if self.failure:
            raise RuntimeError(self.failure)
        try:
            return self.messages.get(timeout=0.25)
        except queue.Empty:
            return None

    def close(self):
        self.client.disconnect()
        self.client.loop_stop()


def run_device(session, seconds):
    actual = 'off'  # Simulated physical state on process startup; no real hardware is controlled.
    newest = -1
    startup = token()
    pending = set()
    session.publish('get', {'clientToken': startup})
    deadline = time.monotonic() + seconds

    def report():
        correlation = token()
        pending.add(correlation)
        session.publish('update', {'state': {'reported': {'power': actual}}, 'clientToken': correlation})

    print('DEVICE ready: simulated power=off', flush=True)
    while time.monotonic() < deadline:
        item = session.receive()
        if not item:
            continue
        topic, body = item
        correlation = body.get('clientToken')
        if topic.endswith('/rejected'):
            if correlation == startup and body.get('code') == 404:
                report()
            elif correlation == startup or correlation in pending:
                raise RuntimeError(f"Device Shadow request rejected: code={body.get('code')}")
            continue
        if topic.endswith('/update/accepted') and correlation in pending:
            pending.remove(correlation)
            print('DEVICE reported accepted', flush=True)
            continue
        if topic.endswith('/get/accepted') and correlation == startup:
            desired = body.get('state', {}).get('desired', {})
        elif topic.endswith('/update/delta'):
            desired = body.get('state', {})
            if 'power' not in desired:
                continue
        else:
            continue
        version = body.get('version', -1)
        if version < newest:
            continue
        newest = version
        wanted = desired.get('power')
        if wanted is not None and wanted not in ('on', 'off'):
            raise RuntimeError('Unsupported desired power; actual state was not changed')
        if wanted is not None and actual != wanted:
            actual = wanted  # Replace with a hardware operation AND readback in real firmware.
            print(f'DEVICE applied power={actual}', flush=True)
        report()
    print('DEVICE demo duration complete', flush=True)


def run_app(session, power, seconds):
    update = token()
    get = None
    accepted_version = None
    next_get = 0
    session.publish('update', {'state': {'desired': {'power': power}}, 'clientToken': update})
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if accepted_version is not None and time.monotonic() >= next_get:
            get = token()
            session.publish('get', {'clientToken': get})
            next_get = time.monotonic() + 2
        item = session.receive()
        if not item:
            continue
        topic, body = item
        correlation = body.get('clientToken')
        if topic.endswith('/rejected') and correlation is not None and correlation in (update, get):
            raise RuntimeError(f"App Shadow request rejected: code={body.get('code')}")
        if topic.endswith('/update/accepted') and correlation == update:
            accepted_version = body['version']
            print('APP desired accepted; waiting for reported state', flush=True)
        if topic.endswith('/get/accepted') and correlation == get and accepted_version is not None:
            state = body.get('state', {})
            if (body.get('version', -1) >= accepted_version
                    and state.get('desired', {}).get('power') == power
                    and state.get('reported', {}).get('power') == power):
                print(f'PASS: desired=reported={power}', flush=True)
                return
    raise RuntimeError('Timed out waiting for convergence; read current state before retrying')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('role', choices=['device', 'app'])
    parser.add_argument('--token-file', required=True)
    parser.add_argument('--host', default=os.getenv('MQTT_HOST'))
    parser.add_argument('--port', type=int, default=int(os.getenv('MQTT_PORT', '8883')))
    parser.add_argument('--ca-file', default=os.getenv('CA_FILE'))
    parser.add_argument('--device-id', default=os.getenv('DEVICE_ID'))
    parser.add_argument('--shadow', default=os.getenv('SHADOW_NAME', 'tutorial'))
    parser.add_argument('--power', choices=['on', 'off'], default='on')
    parser.add_argument('--seconds', type=int, default=120)
    args = parser.parse_args()
    if not all([args.host, args.ca_file, args.device_id]) or args.seconds < 1:
        parser.error('Set MQTT_HOST, CA_FILE, DEVICE_ID and a positive duration')
    session = None
    try:
        session = Session(args)
        if args.role == 'device':
            run_device(session, args.seconds)
        else:
            run_app(session, args.power, args.seconds)
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        # Never dump token files, client passwords, or raw payloads.
        print('ERROR:', str(error) if isinstance(error, RuntimeError) else type(error).__name__)
        return 1
    finally:
        if session:
            session.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
