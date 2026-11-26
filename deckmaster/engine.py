"""Talk to the engine process: build it when sources change, start it on first use, send one request."""

import hashlib
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = ROOT / ".deckmaster"
SOCKET = HOME / "engine.sock"
LOG = HOME / "engine.log"
# Browser table RPCs do not wait for a game decision. Leave decision/fork requests on Forge's own deadline.
REQUEST_TIMEOUTS = {"table": 120, "table_end": 120, "table_state": 30, "view": 30, "shutdown": 3}
STOP_GRACE_SECONDS = 10
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


class EngineTimeout(EngineError):
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


def _connect(timeout=None):
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        client.settimeout(timeout)
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
            _connect(0.2).close()
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
    timeout = REQUEST_TIMEOUTS.get(payload["cmd"])
    client = None
    for attempt in range(3):  # a busy engine can refuse a connection for a moment; don't start a second one
        try:
            client = _connect(timeout)
            break
        except OSError:
            if not SOCKET.exists():
                break
            time.sleep(0.2 * (attempt + 1))
    if client is None:
        if not start:
            raise EngineError("engine isn't running")
        _start()
        client = _connect(timeout)
    deadline = None if timeout is None else time.monotonic() + timeout
    with client:
        try:
            client.sendall((json.dumps(payload) + "\n").encode())
            data = b""
            while not data.endswith(b"\n"):
                if deadline is not None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise socket.timeout()
                    client.settimeout(remaining)
                chunk = client.recv(65536)
                if not chunk:
                    break
                data += chunk
        except socket.timeout as error:
            raise EngineTimeout(f"engine timed out on {payload['cmd']}; see {LOG}") from error
    if not data:
        raise EngineError(f"engine closed the connection; see {LOG}")
    reply = json.loads(data)
    if not reply.get("ok"):
        raise EngineError(reply.get("error", "engine error"))
    return reply


def _pid_file():
    return SOCKET.with_suffix(".pid")


def engine_pid():
    """The PID registered by the server that bound this socket, if known."""
    proc = _started.get(SOCKET)
    if proc is not None and proc.poll() is None:
        return proc.pid
    try:
        return int(_pid_file().read_text())
    except (OSError, ValueError):
        return None


def process_alive(pid):
    proc = _started.get(SOCKET)
    if proc is not None and proc.pid == pid:
        return proc.poll() is None
    # A stale PID file can outlive its JVM. Match the engine and its exact checkout before signaling a PID.
    result = subprocess.run(["ps", "-ww", "-p", str(pid), "-o", "command="], capture_output=True, text=True, check=False)
    suffix = f"deckmaster.engine.Server {RES} {HOME}" + (" table" if MODE else "")
    return result.returncode == 0 and result.stdout.strip().endswith(suffix)


def stop() -> None:
    """Shut the engine down. Only remove its socket once its registered process is gone."""
    pid = engine_pid()
    try:
        inode = SOCKET.stat().st_ino
    except FileNotFoundError:
        inode = None
    try:
        request({"cmd": "shutdown"}, start=False)
    except (EngineError, OSError):
        pass
    deadline = time.monotonic() + STOP_GRACE_SECONDS
    if pid is None:
        while SOCKET.exists():
            try:
                _connect(0.2).close()
            except (FileNotFoundError, ConnectionRefusedError):
                return  # An older engine left a stale socket. The next JVM can reclaim it.
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise EngineError("cannot confirm engine shutdown without its PID")
            time.sleep(0.2)
        return
    while process_alive(pid) and time.monotonic() < deadline:
        time.sleep(0.2)
    if process_alive(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + 5
        while process_alive(pid) and time.monotonic() < deadline:
            time.sleep(0.1)
    if process_alive(pid):
        raise EngineError(f"engine process {pid} did not stop")
    if _pid_file().exists() and _pid_file().read_text().strip() != str(pid):
        return  # A replacement already owns the socket.
    try:
        if inode is not None and SOCKET.stat().st_ino == inode:
            SOCKET.unlink()
    except FileNotFoundError:
        pass
    _pid_file().unlink(missing_ok=True)
    _started.pop(SOCKET, None)


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
