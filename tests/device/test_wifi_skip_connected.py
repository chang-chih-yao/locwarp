"""/wifi/tunnel/start-and-connect with skip_connected (自動連線 and WiFi 掃描,
GLOSSARY.md: 裝置連線) must leave an already-connected phone alone: no
connect_wifi_tunnel (it disconnects a connected UDID first, which would cut
a USB link or a running route), no new sim engine, and a tunnel it had to
open just to learn the UDID is closed again. Without the flag the manual
WiFi panel / USB-to-WiFi switch keeps working as before.

Run from the repo root: .venv/Scripts/python.exe tests/device/test_wifi_skip_connected.py
wifi_tunnel_start, the device manager and app_state are fakes: no network,
no phone."""
import asyncio
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import api.device as device  # noqa: E402

PHONE = "00008110-PHONE"
IP = "192.168.1.50"


class FakeConn:
    def __init__(self, connection_type):
        self.connection_type = connection_type


class FakeDM:
    def __init__(self, connections):
        self._connections = dict(connections)
        self.disconnected: list[str] = []
        self.wifi_connects: list[tuple] = []

    async def disconnect(self, udid):
        self.disconnected.append(udid)
        self._connections.pop(udid, None)

    async def connect_wifi_tunnel(self, rsd_address, rsd_port):
        # Same order as DeviceManager.connect_wifi_tunnel: a connected UDID
        # is disconnected before the WiFi connection replaces it.
        self.wifi_connects.append((rsd_address, rsd_port))
        if PHONE in self._connections:
            await self.disconnect(PHONE)
        self._connections[PHONE] = FakeConn("Network")
        return types.SimpleNamespace(udid=PHONE, name="iPhone", ios_version="18.1")


class FakeAppState:
    def __init__(self, dm, engines):
        self.device_manager = dm
        self.simulation_engines = dict(engines)
        self._primary_udid = next(iter(engines), None)
        self.engines_created: list[str] = []

    async def create_engine_for_device(self, udid):
        self.engines_created.append(udid)
        self.simulation_engines.setdefault(udid, object())


class FakeRunner:
    def __init__(self):
        self.stopped = False
        self.target_ip = IP
        self.target_port = 49152

    def is_running(self):
        return not self.stopped

    async def stop(self):
        self.stopped = True


def run(*, status, connections, skip_connected):
    """Sends one start-and-connect with wifi_tunnel_start answering `status`
    for PHONE. Returns what the test inspects."""
    engine = object()
    dm = FakeDM(connections)
    state = FakeAppState(dm, {PHONE: engine} if PHONE in connections else {})
    main_mod = types.ModuleType("main")
    main_mod.app_state = state
    sys.modules["main"] = main_mod

    device._tunnels.clear()
    device._tunnel_watchdogs.clear()
    runner = FakeRunner()
    if status == "already_running":
        device._tunnels[PHONE] = runner

    async def fake_start(req):
        if status == "started":
            # The real start registers the new runner under the resolved UDID.
            device._tunnels[PHONE] = runner
        return {"status": status, "udid": PHONE, "port": req.port,
                "rsd_address": "fd00::1", "rsd_port": 55555}

    device.wifi_tunnel_start = fake_start
    req = device.WifiTunnelStartRequest(ip=IP, port=49152, skip_connected=skip_connected)
    res = asyncio.run(device.wifi_tunnel_start_and_connect(req))
    return types.SimpleNamespace(res=res, dm=dm, state=state, engine=engine, runner=runner)


# 1) Phone already on this WiFi tunnel (e.g. a page refresh mid-route).
r = run(status="already_running", connections={PHONE: FakeConn("Network")}, skip_connected=True)
assert r.res == {"status": "already_connected", "udid": PHONE}, r.res
assert r.dm.wifi_connects == [], ("connect_wifi_tunnel must not run", r.dm.wifi_connects)
assert r.dm.disconnected == [], ("the connection must stay up", r.dm.disconnected)
assert r.state.simulation_engines.get(PHONE) is r.engine, "the running engine must not be replaced"
assert r.state.engines_created == [], r.state.engines_created
assert device._tunnels.get(PHONE) is r.runner and not r.runner.stopped, "its own tunnel must stay up"
print("ok  flag + already_running + connected: already_connected, nothing touched")

# 2) Tunnel survived but the device connection dropped: reconnect as before.
r = run(status="already_running", connections={}, skip_connected=True)
assert r.dm.wifi_connects == [("fd00::1", 55555)], r.dm.wifi_connects
assert r.res["status"] == "connected", r.res
print("ok  flag + already_running + not in dm._connections: connect_wifi_tunnel runs")

# 3) Phone plugged in over USB and also on this WiFi.
r = run(status="started", connections={PHONE: FakeConn("USB")}, skip_connected=True)
assert r.res == {"status": "already_connected", "udid": PHONE}, r.res
# Checking the fake dm alone would miss it: the USB disconnect happens
# inside connect_wifi_tunnel.
assert r.dm.wifi_connects == [], ("connect_wifi_tunnel must not run", r.dm.wifi_connects)
assert r.dm.disconnected == [], ("USB must stay connected", r.dm.disconnected)
assert r.dm._connections[PHONE].connection_type == "USB", r.dm._connections
assert PHONE not in device._tunnels and r.runner.stopped, "the tunnel just opened must be closed"
assert r.state.simulation_engines.get(PHONE) is r.engine, "the USB engine must not be replaced"
print("ok  flag + started + on USB: already_connected, new tunnel closed, USB untouched")

# 4) No flag: the manual WiFi panel still switches a USB phone to WiFi.
r = run(status="started", connections={PHONE: FakeConn("USB")}, skip_connected=False)
assert r.dm.wifi_connects == [("fd00::1", 55555)], r.dm.wifi_connects
assert r.res["status"] == "connected", r.res
assert r.dm._connections[PHONE].connection_type == "Network", r.dm._connections
print("ok  no flag + started + on USB: connect_wifi_tunnel runs (USB -> WiFi)")

# 5) The frontend skips candidates at a tunnelled phone's LAN IP, so status
# must report it (the RSD address is the tunnel's own IPv6, not the LAN IP).
device._tunnels.clear()
runner = FakeRunner()
runner.info = {"rsd_address": "fd00::1", "rsd_port": 55555}
device._tunnels[PHONE] = runner
st = asyncio.run(device.wifi_tunnel_status())
assert st["tunnels"][0]["target_ip"] == IP and st["tunnels"][0]["target_port"] == 49152, st
print("ok  /wifi/tunnel/status reports each tunnel's target_ip / target_port")

print("all ok")
