"""start.py must not crash when its stdout is a pipe in a code page without
✓ / ✗ (cp950 on Traditional Chinese Windows), e.g. an agent running
`uv run start.py` in the background. Those two characters print as "?"; every
other byte stays in the pipe's own encoding, because readers such as
PowerShell decode a native program's output with that code page.
.scratch/start-py-pipe-encoding/issues/01-checkmark-crash-when-piped.md

Run from the repo root: .venv/Scripts/python.exe tests/launcher/test_start_piped_output.py
Starts no services: only check_tool runs, in a child process."""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

env = dict(os.environ)
env.pop("PYTHONUTF8", None)  # the old workaround; PYTHONIOENCODING below wins over it for stdout anyway
env["PYTHONIOENCODING"] = "cp950"  # the pipe encoding on a zh-TW machine, whatever this machine's locale
# check_tool("python") must find this interpreter, whatever PATH holds.
env["PATH"] = os.path.dirname(sys.executable) + os.pathsep + env.get("PATH", "")

child = subprocess.run(
    [sys.executable, "-c",
     "import start; "
     "start.check_tool('python', 'x'); "
     "start.check_tool('locwarp-no-such-tool', '隨 Node.js 一起安裝')"],
    cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
)

assert child.returncode == 0, (
    "piped cp950 stdout must not crash the launcher",
    child.returncode, child.stderr.decode("cp950", "replace"),
)
print("ok  check_tool with stdout piped as cp950: exit 0")

# Hand-written expected text: "?" where ✓ / ✗ were, Chinese in cp950.
# backslashreplace would give "[\u2713]", UTF-8 would change the Chinese bytes.
expected = [
    "  [?] 已找到 python".encode("cp950"),
    "  [?] 找不到 locwarp-no-such-tool，請先安裝：隨 Node.js 一起安裝".encode("cp950"),
]
assert child.stdout.splitlines() == expected, (child.stdout, expected)
# ASCII only: this script's own stdout may be the same kind of pipe.
print("ok  check and cross marks print as ?, Chinese stays cp950")

print("all ok")
