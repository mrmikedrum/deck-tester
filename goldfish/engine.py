"""Talk to the engine process: build it when sources change, start it on first use, send one request."""

import json
import os
import socket
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = ROOT / ".goldfish"
SOCKET = HOME / "engine.sock"
LOG = HOME / "engine.log"
ENGINE = ROOT / "engine"
CLASSPATH = ENGINE / "target" / "classpath.txt"
RES = ROOT / "vendor" / "forge" / "forge-gui" / "res"


class EngineError(Exception):
    pass


def _stale() -> bool:
    if not CLASSPATH.exists():
        return True
    built = CLASSPATH.stat().st_mtime
    sources = [ENGINE / "pom.xml", *(ENGINE / "src").rglob("*.java")]
    return any(path.stat().st_mtime > built for path in sources)


def _build() -> None:
    HOME.mkdir(exist_ok=True)
    with open(LOG, "a") as log:
        if subprocess.run([str(ROOT / "scripts" / "build-engine.sh")], stdout=log, stderr=log).returncode:
            raise EngineError(f"engine build failed; see {LOG}")
    CLASSPATH.touch()


def _connect():
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        client.connect(str(SOCKET))
    except OSError:
        client.close()
        raise
    return client


def _start() -> None:
    if not RES.is_dir():
        raise EngineError("Forge isn't installed; run scripts/bootstrap-forge.sh")
    if _stale():
        _build()
    classpath = f"{ENGINE / 'target' / 'classes'}:{CLASSPATH.read_text().strip()}"
    env = dict(os.environ)
    if "JAVA_HOME" not in env:
        found = subprocess.run(["/usr/libexec/java_home", "-v", "21"], capture_output=True, text=True)
        if found.returncode == 0:
            env["JAVA_HOME"] = found.stdout.strip()
    java = str(Path(env["JAVA_HOME"]) / "bin" / "java") if "JAVA_HOME" in env else "java"
    # Detach through a shell so the engine outlives this command and isn't our child.
    subprocess.run(["/bin/sh", "-c", 'nohup "$@" >>"$0" 2>&1 </dev/null &', str(LOG),
                    java, f"-Xmx{os.environ.get('GOLDFISH_HEAP', '2g')}", "-cp", classpath, "goldfish.engine.Server", str(RES), str(HOME)], env=env, check=True)
    deadline = time.time() + 90
    while time.time() < deadline:
        try:
            _connect().close()
            return
        except OSError:
            time.sleep(0.2)
    raise EngineError(f"engine didn't start; see {LOG}")


def request(payload: dict, start: bool = True) -> dict:
    """Send one request; start the engine first if it isn't running. Raises EngineError on failure."""
    HOME.mkdir(exist_ok=True)
    client = None
    for attempt in range(3):  # a busy engine can refuse a connection for a moment; don't start a second one
        try:
            client = _connect()
            break
        except OSError:
            if not SOCKET.exists():
                break
            time.sleep(0.2 * (attempt + 1))
    if client is None:
        if not start:
            raise EngineError("engine isn't running")
        _start()
        client = _connect()
    with client:
        client.sendall((json.dumps(payload) + "\n").encode())
        data = b""
        while not data.endswith(b"\n"):
            chunk = client.recv(65536)
            if not chunk:
                break
            data += chunk
    if not data:
        raise EngineError(f"engine closed the connection; see {LOG}")
    reply = json.loads(data)
    if not reply.get("ok"):
        raise EngineError(reply.get("error", "engine error"))
    return reply


def stop() -> None:
    """Shut the engine down and wait until it has gone. Ending it ends every session."""
    try:
        request({"cmd": "shutdown"}, start=False)
    except (EngineError, OSError):
        pass
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            _connect().close()
            time.sleep(0.2)
        except OSError:
            break
    if SOCKET.exists():
        SOCKET.unlink()


def refresh() -> None:
    """Restart an idle engine whose sources changed since it was built, so new games run current code."""
    if not _stale():
        return
    try:
        live = request({"cmd": "sessions"}, start=False)["sessions"]
    except (EngineError, OSError):
        return
    if not live:
        stop()
