"""Behavior checks for the downloadable sample, without cloud credentials."""
import importlib.util
from pathlib import Path
import unittest
import sys
sys.dont_write_bytecode = True
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / 'web/content/developer-docs/examples/shadow-demo/demo.py'
spec = importlib.util.spec_from_file_location('demo', source)
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)

class Session:
    def __init__(self, respond):
        self.sent = []
        self.items = []
        self.respond = respond
    def publish(self, operation, body):
        self.sent.append((operation, body))
        self.respond(self, operation, body)
    def receive(self):
        return self.items.pop(0) if self.items else None
    def reply(self, suffix, body):
        self.items.append(('root/' + suffix, body))

class DemoTests(unittest.TestCase):
    def run_app(self, session, seconds=1):
        with patch.object(demo.time, 'monotonic', side_effect=(n / 100 for n in range(10000))):
            demo.run_app(session, 'on', seconds)
    def run_device(self, session):
        with patch.object(demo.time, 'monotonic', side_effect=(n / 100 for n in range(10000))):
            demo.run_device(session, 1)
    def test_correlated_fresh_convergence_only(self):
        def respond(s, op, body):
            if op == 'update':
                s.reply('update/rejected', {'code':403}) # Uncorrelated is not ours.
                s.reply('update/accepted', {'clientToken': body['clientToken'], 'version':4})
            else:
                state = {'desired':{'power':'on'}, 'reported':{'power':'on'}}
                s.reply('get/accepted', {'clientToken':'other', 'version':5, 'state':state})
                s.reply('get/accepted', {'clientToken':body['clientToken'], 'version':3, 'state':state})
                s.reply('get/accepted', {'clientToken':body['clientToken'], 'version':5, 'state':state})
        with patch('builtins.print') as output:
            self.run_app(Session(respond))
            self.assertEqual(sum('PASS:' in str(call) for call in output.call_args_list), 1)
    def test_accepted_without_device_report_times_out(self):
        def respond(s, op, body):
            s.reply(op+'/accepted', {'clientToken':body['clientToken'], 'version':4, 'state':{'desired':{'power':'on'}}})
        with self.assertRaisesRegex(RuntimeError, 'Timed out'):
            self.run_app(Session(respond))
    def test_correlated_rejection_fails(self):
        def respond(s, op, body):
            s.reply('update/rejected', {'clientToken':body['clientToken'], 'code':403})
        with self.assertRaisesRegex(RuntimeError, '403'):
            self.run_app(Session(respond))
    def test_first_create_duplicate_stale_and_unrelated_delta(self):
        def respond(s, op, body):
            if op == 'get':
                s.reply('get/rejected', {'clientToken':body['clientToken'], 'code':404})
                for version, state in [(2,{'power':'on'}),(2,{'power':'on'}),(1,{'power':'off'}),(3,{'brightness':50})]:
                    s.reply('update/delta', {'version':version, 'state':state})
            else:
                s.reply('update/accepted', {'clientToken':body['clientToken']})
        s=Session(respond)
        with patch('builtins.print') as output:
            self.run_device(s)
            self.assertEqual(sum('DEVICE applied' in str(call) for call in output.call_args_list), 1)
        reports=[b['state']['reported']['power'] for op,b in s.sent if op=='update']
        self.assertEqual(reports, ['off','on','on'])
    def test_unsupported_state_never_reported_as_applied(self):
        def respond(s, op, body):
            s.reply('get/accepted', {'clientToken':body['clientToken'], 'version':1,'state':{'desired':{'power':'invalid'}}})
        s=Session(respond)
        with self.assertRaisesRegex(RuntimeError, 'Unsupported'):
            self.run_device(s)
        self.assertEqual(len(s.sent),1)
    def test_paho_v2_api_constructs(self):
        client=demo.mqtt.Client(demo.mqtt.CallbackAPIVersion.VERSION2,client_id='demo',protocol=demo.mqtt.MQTTv311,clean_session=True)
        client.username_pw_set('test','test')
        self.assertEqual(client._protocol, demo.mqtt.MQTTv311)

if __name__ == '__main__':
    unittest.main()
