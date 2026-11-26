"""Talk to the engine process: build it when sources change, start it on first use, send one request."""

import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = ROOT / ".deckmaster"
SOCKET = HOME / "engine.sock"
LOG = HOME / "engine.log"
MODE = []  # extra arguments for the engine: ["table"] for the table engine (see use_table)
_started = {}  # socket to the detached process this interpreter started, for reaping on stop


def use_table() -> None:
    """Talk to the table engine from here on: a second engine process that hosts networked tables (Forge's full
    model and network server), with its own socket and log, alongside the goldfish engine."""
    global SOCKET, LOG, MODE
    SOCKET, LOG, MODE = HOME / "table.sock", HOME / "table.log", ["table"]
ENGINE = ROOT / "engine"
CLASSPATH = ENGINE / "target" / "classpath.txt"
RES = ROOT / "vendor" / "forge" / "forge-gui" / "res"
FORGE_BUILD = HOME / "forge-build"


def forge_build() -> tuple:
    """The installed Forge build and the one this checkout pins: commit and patch series, as bootstrap names it."""
    pin = re.search(r"^FORGE_COMMIT=(\w+)", (ROOT / "scripts" / "bootstrap-forge.sh").read_text(), re.M).group(1)
    patches = sorted((ROOT / "scripts" / "forge-patches").glob("*.patch"))
    wanted = pin[:8] + "-" + hashlib.sha256(b"".join(p.read_bytes() for p in patches)).hexdigest()[:8]
    installed = None
    if FORGE_BUILD.exists():
        installed = dict(line.split("=", 1) for line in FORGE_BUILD.read_text().split()).get("build")
    return installed, wanted


def local_cards() -> list:
    """The card scripts our patch series adds to Forge (cards it lacks), which records flag."""
    names = []
    for patch in sorted((ROOT / "scripts" / "forge-patches").glob("*.patch")):
        names += re.findall(r"^\+Name:(.+)$", patch.read_text(), re.M)
    return names


class EngineError(Exception):
    pass


def _stale() -> bool:
    if not CLASSPATH.exists():
        return True
    built = CLASSPATH.stat().st_mtime
    sources = [ENGINE / "pom.xml", FORGE_BUILD, *(ENGINE / "src").rglob("*.java")]
    return any(path.exists() and path.stat().st_mtime > built for path in sources)


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
    # sockaddr_un.sun_path includes the terminating NUL.
    limit = 103 if sys.platform == "darwin" else 107
    if len(os.fsencode(SOCKET)) > limit:
        raise EngineError(f"engine socket path too long ({limit} bytes max); use a shorter checkout path")
    if not RES.is_dir():
        raise EngineError("Forge isn't installed; run scripts/bootstrap-forge.sh")
    installed, wanted = forge_build()
    if installed != wanted:
        raise EngineError(f"Forge build {installed or 'none'} isn't this checkout's {wanted}; run scripts/bootstrap-forge.sh")
    if _stale():
        _build()
    classpath = f"{ENGINE / 'target' / 'classes'}:{CLASSPATH.read_text().strip()}"
    env = dict(os.environ)
    if "JAVA_HOME" not in env:
        found = subprocess.run(["/usr/libexec/java_home", "-v", "21"], capture_output=True, text=True)
        if found.returncode == 0:
            env["JAVA_HOME"] = found.stdout.strip()
    java = str(Path(env["JAVA_HOME"]) / "bin" / "java") if "JAVA_HOME" in env else "java"
    with LOG.open("a") as log:
        proc = subprocess.Popen(
            [java, "-Ddeckmaster.forge=" + wanted, "-Ddeckmaster.localCards=" + ", ".join(local_cards()),
             f"-Xmx{os.environ.get('DECKMASTER_HEAP', '2g')}", "-cp", classpath, "deckmaster.engine.Server",
             str(RES), str(HOME), *MODE],
            env=env, start_new_session=True, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise EngineError(f"engine exited during startup ({proc.returncode}); see {LOG}")
        try:
            _connect().close()
            _started[SOCKET] = proc
            return
        except OSError:
            time.sleep(0.2)
    proc.kill()
    proc.wait()
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
    proc = _started.get(SOCKET)
    if proc is not None and proc.poll() is not None:
        del _started[SOCKET]


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
