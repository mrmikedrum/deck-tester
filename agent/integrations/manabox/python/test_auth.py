import importlib.util
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("cloud",Path(__file__).with_name("auth.py"))
cloud=importlib.util.module_from_spec(spec)
with patch.dict(os.environ,{"MANABOX_STATE_DIR":str(Path(tempfile.gettempdir())/"mb-unused-test-state")}):
    spec.loader.exec_module(cloud)

class CloudTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.state=patch.object(cloud,"STATE",Path(self.tmp.name)/"private"/"session.json")
        self.state.start()
    def tearDown(self):
        self.state.stop();self.tmp.cleanup()
    def test_permissions_and_refresh(self):
        cloud.save_session({"uid":"user1","id_token":"old","refresh_token":"refresh","expires_at":0})
        self.assertEqual(cloud.STATE.stat().st_mode & 0o777,0o600)
        result={"user_id":"user1","id_token":"new","refresh_token":"rotated","expires_in":"3600"}
        with patch.object(cloud,"request_json",return_value=result) as request:
            self.assertEqual(cloud.fresh_token(),"new")
            self.assertTrue(request.call_args.kwargs["form"])
        self.assertEqual(cloud.load_session()["refresh_token"],"rotated")
    def test_refresh_account_mismatch_preserves_state(self):
        cloud.save_session({"uid":"user1","id_token":"old","refresh_token":"refresh","expires_at":0})
        with patch.object(cloud,"request_json",return_value={"user_id":"other"}):
            with self.assertRaises(ValueError):cloud.fresh_token()
        self.assertEqual(cloud.load_session()["id_token"],"old")
    def test_callback_origin_nonce_and_credentials(self):
        ready=threading.Event();url=[];failures=[]
        def browser(value):url.append(value);ready.set()
        def api(endpoint,body=None,**kwargs):
            if "accounts:lookup" in endpoint:
                return {"users":[{"localId":"user1","email":"test@example.com","emailVerified":True,
                                  "providerUserInfo":[{"providerId":"google.com"}]}]}
            return {"user_id":"user1","id_token":"new","refresh_token":"rotated","expires_in":"3600"}
        def run():
            try:cloud.login("test@example.com")
            except Exception as e:failures.append(e)
        with patch.object(cloud.webbrowser,"open",side_effect=browser),patch.object(cloud,"request_json",side_effect=api):
            thread=threading.Thread(target=run,daemon=True);thread.start()
            self.assertTrue(ready.wait(5))
            parsed=urllib.parse.urlparse(url[0]);origin=f"http://{parsed.netloc}"
            with urllib.request.urlopen(url[0]) as response:
                page=response.read().decode();self.assertIn("signInWithPopup",page)
            body=json.dumps({"id_token":"id","refresh_token":"refresh"}).encode()
            for bad in [{"Origin":"https://evil.example","X-Login-Nonce":parsed.path[1:]},
                        {"Origin":origin,"X-Login-Nonce":"wrong"}]:
                request=urllib.request.Request(origin+"/complete",data=body,headers=bad)
                with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(request)
                self.assertEqual(error.exception.code,403)
            self.assertFalse(cloud.STATE.exists())
            request=urllib.request.Request(origin+"/complete",data=body,
                    headers={"Origin":origin,"X-Login-Nonce":parsed.path[1:],"Content-Type":"application/json"})
            with urllib.request.urlopen(request) as response:self.assertEqual(response.status,200)
            thread.join(5);self.assertFalse(thread.is_alive());self.assertEqual(failures,[])
            self.assertEqual(cloud.load_session()["uid"],"user1")

if __name__=="__main__":unittest.main()
