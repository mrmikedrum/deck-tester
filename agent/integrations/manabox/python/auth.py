#!/usr/bin/env python3
"""Personal ManaBox cloud client. Credentials stay in a local mode-0600 file."""
import argparse
import hmac
import json
import os
import secrets
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

API_KEY = "AIzaSyDYv49rjixc2LE5DQqGtKVYrEpOuSqgrPk"  # Public Firebase client config.
PROJECT = "manabox-622c9"
STATE = Path(os.environ["MANABOX_STATE_DIR"]) / "session.json"

def request_json(url, body=None, token=None, form=False):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None
    if body is not None:
        data = (urllib.parse.urlencode(body) if form else json.dumps(body)).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        # Never echo response bodies: they can contain credentials or personal data.
        raise RuntimeError(f"{urllib.parse.urlparse(url).netloc} returned HTTP {exc.code}") from None

def save_session(data):
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(STATE.parent, 0o700)
    fd, path = tempfile.mkstemp(prefix="session-", dir=STATE.parent)
    try:
        with os.fdopen(fd, "w") as file:
            json.dump(data, file)
        os.replace(path, STATE)
    finally:
        if os.path.exists(path):
            os.unlink(path)

def load_session():
    if not STATE.exists():
        raise ValueError("Run login first")
    if STATE.is_symlink() or STATE.stat().st_mode & 0o077:
        raise ValueError("Session must be a private regular file (mode 0600)")
    return json.loads(STATE.read_text())

def fresh_token():
    session = load_session()
    if session["expires_at"] < time.time() + 120:
        result = request_json("https://securetoken.googleapis.com/v1/token?key=" + API_KEY,
                              {"grant_type": "refresh_token", "refresh_token": session["refresh_token"]}, form=True)
        if result.get("user_id") != session["uid"]:
            raise ValueError("Token refresh returned a different user")
        session.update(id_token=result["id_token"], refresh_token=result["refresh_token"],
                       expires_at=time.time() + int(result["expires_in"]))
        save_session(session)
    return session["id_token"]

def login_page(nonce, email):
    config = json.dumps({"apiKey": API_KEY, "authDomain": "auth.manabox.app", "projectId": PROJECT})
    return '''<!doctype html><meta charset="utf-8"><title>Personal ManaBox login</title>
<style>body{font:18px system-ui;max-width:620px;margin:70px auto;padding:24px}button{font:inherit;padding:12px}</style>
<h1>Sign in to your ManaBox account</h1>
<p>Use the same Google account as ManaBox on your iPhone. Google handles your password.
This saves a local session for this script. It does not change any decks.</p>
<button id="login">Continue with Google</button><p id="status"></p>
<script type="module">
import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import {getAuth,setPersistence,inMemoryPersistence,GoogleAuthProvider,signInWithPopup,signOut}
 from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
const auth=getAuth(initializeApp(CONFIG));
const button=document.querySelector('#login'), status=document.querySelector('#status');
await setPersistence(auth,inMemoryPersistence);
button.onclick=async()=>{
 button.disabled=true;
 try {
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account',login_hint:EMAIL});
  const result=await signInWithPopup(auth,provider);
  if(result.user.email.toLowerCase()!==EMAIL.toLowerCase()) throw Error('Choose the requested ManaBox Google account.');
  const response=await fetch('/complete',{method:'POST',headers:{'Content-Type':'application/json','X-Login-Nonce':NONCE},
   body:JSON.stringify({id_token:await result.user.getIdToken(),refresh_token:result.user.refreshToken})});
  if(!response.ok) throw Error('The local script could not verify/save this login.');
  await signOut(auth);
  status.textContent='Signed in. Your session is saved locally; you can close this window.';
 } catch(error) {status.textContent=error.code || error.message;button.disabled=false;}
};
</script>'''.replace("CONFIG", config).replace("EMAIL", json.dumps(email).replace("<", "\\u003c")).replace("NONCE", json.dumps(nonce))

def login(email, open_browser=True):
    nonce = secrets.token_urlsafe(32)
    completed = False
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, code, data=b"", content_type="text/plain"):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.headers.get("Host") != host or self.path != "/" + nonce:
                return self.reply(404)
            self.reply(200, login_page(nonce,email).encode(), "text/html; charset=utf-8")

        def do_POST(self):
            nonlocal completed
            if (self.path != "/complete" or self.headers.get("Host") != host
                or self.headers.get("Origin") != origin
                or not hmac.compare_digest(self.headers.get("X-Login-Nonce", ""), nonce)):
                return self.reply(403)
            try:
                size=int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 32768:
                    return self.reply(413)
                payload=json.loads(self.rfile.read(size))
                verified=request_json("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+API_KEY,
                                      {"idToken":payload["id_token"]})["users"][0]
                if verified.get("email", "").lower()!=email.lower() or not verified.get("emailVerified"):
                    raise ValueError("Account email mismatch or unverified email")
                if not any(p.get("providerId")=="google.com" for p in verified.get("providerUserInfo",[])):
                    raise ValueError("Expected Google-linked account")
                # Exchange refresh token too, verifying both credentials belong to the same user.
                refreshed=request_json("https://securetoken.googleapis.com/v1/token?key="+API_KEY,
                                       {"grant_type":"refresh_token","refresh_token":payload["refresh_token"]}, form=True)
                if refreshed.get("user_id") != verified["localId"]:
                    raise ValueError("Refresh credential account mismatch")
                save_session({"uid":verified["localId"],"email":verified["email"],
                              "id_token":refreshed["id_token"],"refresh_token":refreshed["refresh_token"],
                              "expires_at":time.time()+int(refreshed["expires_in"])})
                completed=True
                self.reply(200,b"Saved")
            except Exception:
                self.reply(400,b"Login verification failed; no session was saved.")
    with HTTPServer(("127.0.0.1", 0), Handler) as server:
        host=f"localhost:{server.server_port}"
        origin="http://"+host
        url=origin+"/"+nonce
        server.timeout=1
        print("Open this local login page:",url,flush=True)
        if open_browser:
            webbrowser.open(url)
        deadline=time.monotonic()+600
        while not completed and time.monotonic()<deadline:
            server.handle_request()
    if not completed:
        raise RuntimeError("Login timed out; run login again")
    print("Session saved locally. No decks were changed.")

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="command",required=True)
    p=sub.add_parser("login");p.add_argument("--email",required=True);p.add_argument("--no-open",action="store_true")
    sub.add_parser("whoami")
    args=parser.parse_args()
    try:
        if args.command=="login":
            login(args.email,not args.no_open)
        elif args.command=="whoami":
            token=fresh_token()
            user=request_json("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+API_KEY,{"idToken":token})["users"][0]
            print(json.dumps({"email":user["email"],"uid":user["localId"],"email_verified":user.get("emailVerified",False)},indent=2))
    except (ValueError,KeyError,OSError,RuntimeError) as error:
        parser.exit(1,str(error)+"\n")

if __name__=="__main__":
    main()
