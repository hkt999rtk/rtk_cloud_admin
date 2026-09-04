"""Recovery policy tests use fake issuance functions, never real credentials."""
import base64
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
sys.dont_write_bytecode = True
p=Path(__file__).resolve().parents[1]/'web/content/developer-docs/examples/shadow-demo/recover.py'
spec=importlib.util.spec_from_file_location('recover',p)
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

def bundle(exp):
    payload=base64.urlsafe_b64encode(json.dumps({'exp':exp}).encode()).decode().rstrip('=')
    return {'access_token':'x.'+payload+'.x','mqtt':{'username':'test','client_id':'test'}}

class RecoveryTests(unittest.TestCase):
    def test_expiry_is_seconds(self):
        self.assertEqual(r.lifetime(bundle(1060),now=1000),60)
    def test_invalid_expiry_fails(self):
        with self.assertRaises(RuntimeError):r.lifetime({'access_token':'not-a-token'})
    def test_valid_reissue_does_not_bootstrap(self):
        bootstrap=Mock();refresh=Mock(return_value=bundle(1200))
        with patch.object(r.time,'time',return_value=1000):
            self.assertEqual(r.obtain(bundle(1100),bootstrap,refresh),bundle(1200))
        bootstrap.assert_not_called()
    def test_expired_token_bootstraps_without_refresh(self):
        bootstrap=Mock(return_value=bundle(1200));refresh=Mock()
        with patch.object(r.time,'time',return_value=1000):r.obtain(bundle(999),bootstrap,refresh)
        bootstrap.assert_called_once();refresh.assert_not_called()
    def test_401_falls_back_once(self):
        bootstrap=Mock(return_value=bundle(1200));refresh=Mock(side_effect=HTTPError('https://example.test',401,'denied',{},None))
        with patch.object(r.time,'time',return_value=1000):r.obtain(bundle(1100),bootstrap,refresh)
        bootstrap.assert_called_once()
    def test_403_never_bootstraps_to_broaden_authority(self):
        bootstrap=Mock();refresh=Mock(side_effect=HTTPError('https://example.test',403,'forbidden',{},None))
        with patch.object(r.time,'time',return_value=1000):
            with self.assertRaises(HTTPError):r.obtain(bundle(1100),bootstrap,refresh)
        bootstrap.assert_not_called()
    def test_repeated_worker_failure_exhausts_budget_and_cleans_file(self):
        worker=Mock();worker.wait.return_value=1;worker.poll.return_value=1
        captured=[]
        def launch(command):
            path=Path(command[command.index('--token-file')+1]);captured.append(path)
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            return worker
        env={name:'test' for name in ['DEVICE_TOKEN_BASE','API_BASE','DEVICE_CERT','DEVICE_KEY','CA_FILE','DEVICE_ID','MQTT_HOST']}
        with patch.dict(r.os.environ,env), patch.object(r.sys,'argv',['recover.py','--attempts','2']), patch.object(r.ssl,'create_default_context'), patch.object(r,'post',return_value=bundle(r.time.time()+120)), patch.object(r.subprocess,'Popen',side_effect=launch), patch.object(r.time,'sleep'):
            self.assertEqual(r.main(),1)
        self.assertEqual(len(captured),2)
        self.assertTrue(all(not path.exists() for path in captured))
    def test_missing_mqtt_metadata_rejected(self):
        with self.assertRaises(RuntimeError):r.validate({'access_token':'x'})

if __name__=='__main__':unittest.main()
