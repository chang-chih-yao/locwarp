"""TunnelRunner.start when the RemotePairing connect fails before the WiFi 通道
is up (GLOSSARY.md: 裝置連線), e.g. 自動連線 trying a saved IP while the
phone's WiFi is off: start() must raise the connect's own error, so
wifi_tunnel_start can move on to the next port or UDID, and asyncio must not
log "Task exception was never retrieved" with the whole traceback once the
finished task is garbage-collected.

Run from the repo root: .venv/Scripts/python.exe tests/device/test_wifi_tunnel_runner.py
The pymobiledevice3 connect is a fake that raises: no network, no phone."""
import asyncio
import gc
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import pymobiledevice3.remote.tunnel_service as tunnel_service  # noqa: E402
from core.wifi_tunnel import TunnelRunner  # noqa: E402


def run(error_type):
    """start() against a connect that raises error_type. Returns the type
    start() raised and the messages the loop's exception handler received."""
    reported: list[str] = []

    async def fake_connect(udid, ip, port):
        raise error_type("fake connect failure")

    tunnel_service.create_core_device_tunnel_service_using_remotepairing = fake_connect

    async def main():
        asyncio.get_running_loop().set_exception_handler(
            lambda loop, ctx: reported.append(ctx["message"]))
        runner = TunnelRunner()
        raised = None
        try:
            await runner.start("00008110-PHONE", "192.0.2.1", 49152, timeout=8.0)
        except BaseException as e:
            raised = type(e)
        del runner
        # The finished task and its exception's traceback reference each
        # other, so only the cycle collector frees the task, and that is
        # when asyncio reports an exception nobody retrieved.
        gc.collect()
        return raised

    return asyncio.run(main()), reported


# 1) pymobiledevice3's own connect timeout: nothing answers on that port.
raised, reported = run(TimeoutError)
assert raised is not None and issubclass(raised, asyncio.TimeoutError), (
    "wifi_tunnel_start's port-level `except asyncio.TimeoutError` must still catch it", raised)
assert reported == [], reported
print("ok  connect timeout: start() raises TimeoutError, nothing logged after gc")

# 2) Any other failure before ready, e.g. the connection is refused.
raised, reported = run(ConnectionRefusedError)
assert raised is ConnectionRefusedError, raised
assert reported == [], reported
print("ok  connect refused: start() raises ConnectionRefusedError, nothing logged after gc")

print("all ok")
