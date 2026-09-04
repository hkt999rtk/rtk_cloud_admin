"""Local probe policy tests; no live endpoint or credentials."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, Mock
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'web/content/developer-docs/examples/shadow-demo'))
import verify

class Probe:
    def __init__(self,items): self.items=list(items);self.sent=[]
    def publish(self,operation,body): self.sent.append((operation,body))
    def receive(self): return self.items.pop(0) if self.items else None
    def close(self): pass

class Tests(unittest.TestCase):
    def check(self,items):
        s=Probe(items)
        with patch.object(verify,'token',return_value='check'),patch.object(verify.time,'monotonic',side_effect=range(100)):
            verify.probe(s,'device')
        self.assertEqual(s.sent,[('get',{'clientToken':'check'})])
    def test_accepts_only_correlated_read_without_state_logging(self):
        with patch('builtins.print') as output:
            self.check([('x/get/rejected',{'clientToken':'other','code':403}),('x/get/accepted',{'clientToken':'check','version':7,'state':{'secret':'PRIVATE_STATE'}})])
            self.assertNotIn('PRIVATE_STATE',str(output.call_args_list))
    def test_missing_state_is_valid_preflight(self):
        self.check([('x/get/rejected',{'clientToken':'check','code':404})])
    def test_denied_is_failure(self):
        with self.assertRaisesRegex(RuntimeError,'403'):
            self.check([('x/get/rejected',{'clientToken':'check','code':403})])
    def test_timeout_is_not_missing(self):
        with self.assertRaisesRegex(RuntimeError,'deadline'):
            self.check([])
    def test_default_never_starts_mutating_workers(self):
        env={'MQTT_HOST':'example.test','CA_FILE':'example.pem','DEVICE_ID':'device-1'}
        with patch.dict(verify.os.environ,env),patch.object(verify.sys,'argv',['verify.py','--device-token','d','--app-token','a']),patch.object(verify,'Session',return_value=Mock()),patch.object(verify,'probe') as probe,patch.object(verify.subprocess,'Popen') as worker,patch.object(verify.subprocess,'run') as app:
            self.assertEqual(verify.main(),0)
            self.assertEqual(probe.call_count,2);worker.assert_not_called();app.assert_not_called()

if __name__=='__main__': unittest.main()
