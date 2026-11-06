"""/wifi/tunnel/start for different IPs runs at the same time (GLOSSARY.md:
裝置連線): WiFi 掃描 and 自動連線 send several start-and-connect at once,
and a phone that answers must not wait for a dead saved IP ahead of it to
time out. The device cap and the tunnel registry still hold.
.scratch/wifi-tunnel-parallel-start/issues/01-parallel-tunnel-start.md

Run from the repo root: .venv/Scripts/python.exe tests/device/test_wifi_tunnel_parallel_start.py
TunnelRunner, the port re-scan and the pair-record lookup are fakes: no
network, no phone."""
import asyncio
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from fastapi import HTTPException  # noqa: E402

import api.device as device  # noqa: E402

# ip -> (handshake seconds, the phone's udid, exception start() raises or None)
PLAN: dict[str, tuple[float, str, BaseException | None]] = {}
STARTS: list[str] = []
RUNNERS: list["FakeRunner"] = []


class FakeRunner:
    """start() answers from PLAN; task stays None so the watchdog returns at once."""

    def __init__(self):
        self.task = None
        self.info = None
        self.target_ip = None
        self.target_port = None
        self.running = False
        self.stopped = False
        RUNNERS.append(self)

    def is_running(self):
        return self.running

    async def start(self, udid, ip, port, timeout=20.0):
        STARTS.append(ip)
        delay, _, error = PLAN[ip]
        self.target_ip, self.target_port = ip, port
        await asyncio.sleep(delay)
        if error is not None:
            raise error
        self.running = True
        self.info = {"rsd_address": f"fd00::{ip.rsplit('.', 1)[1]}", "rsd_port": 55555}
        return dict(self.info)

    async def stop(self):
        self.stopped = True
        self.running = False


async def no_ports(ip, *args, **kwargs):
    return []


device.TunnelRunner = FakeRunner
device._scan_ports_for_ip = no_ports
# The real one reads ~/.pymobiledevice3/; here each IP has exactly one phone.
device._build_tunnel_udid_candidates = lambda req: [PLAN[req.ip][1]]


def reset(plan):
    PLAN.clear()
    PLAN.update(plan)
    STARTS.clear()
    RUNNERS.clear()
    device._tunnels.clear()
    device._tunnel_watchdogs.clear()
    device._tunnel_starts_in_flight.clear()
    # Each scenario has its own event loop, and a lock that was waited on
    # stays bound to the loop it was waited on in.
    device._tunnels_lock = asyncio.Lock()


async def send(ip):
    """One /wifi/tunnel/start; an HTTPException comes back as (status, code)."""
    try:
        return await device.wifi_tunnel_start(device.WifiTunnelStartRequest(ip=ip, port=49152))
    except HTTPException as e:
        return (e.status_code, e.detail["code"])


async def timed(*ips):
    """Sends every ip at once, in this order. Returns (result, seconds) per ip."""
    loop = asyncio.get_running_loop()
    t0 = loop.time()

    async def one(ip):
        res = await send(ip)
        return res, loop.time() - t0

    return await asyncio.wait_for(asyncio.gather(*(one(ip) for ip in ips)), timeout=5)


# 1) A dead saved IP ahead of a phone that answers no longer holds it up.
reset({
    "192.168.1.197": (0.5, "PHONE_B", ConnectionRefusedError("phone's WiFi is off")),
    "192.168.1.117": (0.1, "PHONE_A", None),
})
(dead, dead_t), (live, live_t) = asyncio.run(timed("192.168.1.197", "192.168.1.117"))
assert dead == (500, "tunnel_spawn_failed"), dead
assert live["status"] == "started" and live["udid"] == "PHONE_A", live
assert live_t < 0.3, ("the phone that answers must not wait for the dead IP", live_t)
print(f"ok  dead IP first, live IP second: live one back in {live_t:.2f}s")

# 2) Two slow handshakes overlap instead of queueing.
reset({"192.168.1.10": (0.5, "PHONE_A", None), "192.168.1.11": (0.5, "PHONE_B", None)})
results = asyncio.run(timed("192.168.1.10", "192.168.1.11"))
assert [r["status"] for r, _ in results] == ["started", "started"], results
total = max(t for _, t in results)
assert total < 0.8, ("two 0.5s handshakes must overlap", total)
assert set(device._tunnels) == {"PHONE_A", "PHONE_B"}, device._tunnels
print(f"ok  two 0.5s handshakes at once: both started in {total:.2f}s")


def running_tunnels():
    return [u for u, r in device._tunnels.items() if r.is_running()]


def add_running(udid, ip):
    runner = FakeRunner()
    runner.running, runner.target_ip, runner.target_port = True, ip, 49152
    device._tunnels[udid] = runner
    return runner


# 3) Two tunnels up, two new IPs at once: a handshake in progress holds a
# slot, or both would pass the check and end up as a 4th tunnel.
reset({"192.168.1.20": (0.2, "PHONE_C", None), "192.168.1.21": (0.2, "PHONE_D", None)})
add_running("PHONE_A", "192.168.1.10")
add_running("PHONE_B", "192.168.1.11")
results = [r for r, _ in asyncio.run(timed("192.168.1.20", "192.168.1.21"))]
assert results[0]["status"] == "started", results
assert results[1] == (409, "max_devices_reached"), results
assert len(running_tunnels()) == 3, running_tunnels()
print("ok  2 up + 2 at once: one started, one 409, 3 tunnels")

# 4) Nothing up, four at once: three handshake, the fourth gets 409 at once.
four = ["192.168.1.30", "192.168.1.31", "192.168.1.32", "192.168.1.33"]
reset({ip: (0.2, f"PHONE_{i}", None) for i, ip in enumerate(four)})
results = [r for r, _ in asyncio.run(timed(*four))]
assert STARTS == four[:3], STARTS
assert [r["status"] for r in results[:3]] == ["started"] * 3, results
assert results[3] == (409, "max_devices_reached"), results
assert len(running_tunnels()) == 3, running_tunnels()
print("ok  4 at once from 0: 3 handshake, 1 409, 3 tunnels")

# 5) Same IP twice at once (pinned retry, a page refresh, two tabs): the
# second waits for the first, then finds its tunnel.
reset({"192.168.1.40": (0.2, "PHONE_A", None)})
first, second = [r for r, _ in asyncio.run(timed("192.168.1.40", "192.168.1.40"))]
assert STARTS == ["192.168.1.40"], ("one handshake only", STARTS)
assert first["status"] == "started", first
assert second["status"] == "already_running" and second["udid"] == "PHONE_A", second
assert second["rsd_address"] == first["rsd_address"], (first, second)
assert list(device._tunnels) == ["PHONE_A"], device._tunnels
print("ok  same IP twice at once: one handshake, second already_running")


async def same_ip_first_fails(ip):
    """Same ip twice at once. The first's handshake fails; the plan is fixed
    while it runs, so only a handshake the second makes itself can work."""
    both = asyncio.ensure_future(timed(ip, ip))
    await asyncio.sleep(0.1)  # first mid-handshake, second waiting for it
    _, udid, _ = PLAN[ip]
    PLAN[ip] = (0.1, udid, None)
    return [r for r, _ in await both]


# 6) ...and when the first fails, the second handshakes on its own.
reset({"192.168.1.41": (0.2, "PHONE_A", ConnectionRefusedError("refused"))})
first, second = asyncio.run(same_ip_first_fails("192.168.1.41"))
assert first == (500, "tunnel_spawn_failed"), first
assert second["status"] == "started", second
assert STARTS == ["192.168.1.41", "192.168.1.41"], STARTS
print("ok  same IP twice at once, first fails: second handshakes itself and starts")


class BrokenRunner(FakeRunner):
    def __init__(self):
        raise RuntimeError("unexpected")


async def unexpected_error(ip):
    device.TunnelRunner = BrokenRunner
    try:
        await send(ip)
    except RuntimeError as e:
        return type(e).__name__
    finally:
        device.TunnelRunner = FakeRunner


async def cancelled(ip):
    task = asyncio.create_task(send(ip))
    await asyncio.sleep(0.05)  # mid-handshake
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        return "cancelled"


async def ends_then_retries(ip, first):
    """Runs `first`, a request for ip that doesn't get through, then ip
    again with a handshake that works. Returns how first ended, the
    in-flight registry right after it, and the retry's result."""
    ended = await first(ip)
    left = dict(device._tunnel_starts_in_flight)
    _, udid, _ = PLAN[ip]
    PLAN[ip] = (0.05, udid, None)
    retry = await asyncio.wait_for(send(ip), timeout=2)
    return ended, left, retry


# 7) However a request ends, it gives its slot back and doesn't leave a
# later request for the same IP waiting for good.
IP = "192.168.1.50"
for first, error, expected in [
    (send, ConnectionRefusedError("refused"), (500, "tunnel_spawn_failed")),
    (send, asyncio.TimeoutError(), (500, "tunnel_timeout")),
    (unexpected_error, None, "RuntimeError"),
    (cancelled, None, "cancelled"),
]:
    reset({IP: (0.3, "PHONE_A", error)})
    ended, left, retry = asyncio.run(ends_then_retries(IP, first))
    assert ended == expected, (expected, ended)
    assert left == {}, (expected, "in-flight entry left behind", left)
    assert retry["status"] == "started", (expected, retry)
    print(f"ok  ended with {expected}: slot given back, the same IP connects next time")


async def cancelled_waiting_to_register(ip):
    task = asyncio.create_task(send(ip))
    await asyncio.sleep(0.05)  # mid-handshake, past the opening checks
    await device._tunnels_lock.acquire()
    try:
        await asyncio.sleep(0.2)  # handshake done, now waiting for the lock
        assert not task.done(), task
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        else:
            raise AssertionError("the request should have been cancelled")
    finally:
        device._tunnels_lock.release()


# 8) A runner that came up but never got registered has no owner: nothing
# else would ever stop it.
reset({"192.168.1.60": (0.1, "PHONE_A", None)})
asyncio.run(cancelled_waiting_to_register("192.168.1.60"))
assert len(RUNNERS) == 1 and RUNNERS[0].stopped, "the unregistered runner must be stopped"
assert device._tunnels == {}, device._tunnels
assert device._tunnel_starts_in_flight == {}, device._tunnel_starts_in_flight
print("ok  cancelled while waiting to register: its runner is stopped, nothing registered")

# 9) One phone at two IPs (e.g. a saved one and the one mDNS just found),
# both handshaking at once: the first to register keeps the phone.
reset({"192.168.1.70": (0.1, "PHONE_A", None), "192.168.1.71": (0.2, "PHONE_A", None)})
early, late = [r for r, _ in asyncio.run(timed("192.168.1.70", "192.168.1.71"))]
early_runner, late_runner = RUNNERS
assert early["status"] == "started", early
assert late["status"] == "already_running" and late["udid"] == "PHONE_A", late
assert late["rsd_address"] == early["rsd_address"] and late["port"] == early["port"], (early, late)
assert device._tunnels == {"PHONE_A": early_runner}, device._tunnels
assert late_runner.stopped and not early_runner.stopped, "the late duplicate must be closed"
print("ok  two IPs, same phone, at once: one tunnel kept, the late one closed")


async def stale_entry_mid_handshake(ip, udid):
    """A stopped runner (with its watchdog) shows up under udid while ip
    handshakes. Returns the result, the stale runner and its watchdog."""
    task = asyncio.create_task(send(ip))
    await asyncio.sleep(0.05)
    stale = FakeRunner()  # never started: is_running() is False
    stale_wd = asyncio.create_task(asyncio.sleep(3600))
    device._tunnels[udid] = stale
    device._tunnel_watchdogs[udid] = stale_wd
    res = await asyncio.wait_for(task, timeout=2)
    await asyncio.sleep(0)
    return res, stale, stale_wd


# 10) A stale entry for the phone is replaced, not mistaken for a running
# tunnel (which would answer already_running with a dead tunnel's info).
reset({"192.168.1.80": (0.2, "PHONE_A", None)})
res, stale, stale_wd = asyncio.run(stale_entry_mid_handshake("192.168.1.80", "PHONE_A"))
assert res["status"] == "started", res
assert device._tunnels["PHONE_A"] is RUNNERS[0] and RUNNERS[0].running, device._tunnels
assert stale.stopped, "the stale runner must be torn down"
assert stale_wd.cancelled(), "the stale runner's watchdog must be cancelled"
assert device._tunnel_watchdogs["PHONE_A"] is not stale_wd, device._tunnel_watchdogs
print("ok  stale entry for the phone mid-handshake: torn down, new tunnel registered")


def put_stale(udid):
    """A stopped runner and its watchdog under udid; call inside a loop."""
    stale = FakeRunner()
    stale_wd = asyncio.create_task(asyncio.sleep(3600))
    device._tunnels[udid] = stale
    device._tunnel_watchdogs[udid] = stale_wd
    return stale, stale_wd


async def stale_entry_before(ip, udid):
    stale, stale_wd = put_stale(udid)
    res = await asyncio.wait_for(send(ip), timeout=2)
    await asyncio.sleep(0)
    return res, stale, stale_wd


# 11) A stale entry the walk finds before handshaking is torn down then,
# whether or not the handshake works.
reset({"192.168.1.85": (0.05, "PHONE_A", ConnectionRefusedError("refused"))})
res, stale, stale_wd = asyncio.run(stale_entry_before("192.168.1.85", "PHONE_A"))
assert res == (500, "tunnel_spawn_failed"), res
assert stale.stopped and stale_wd.cancelled(), "the stale runner and its watchdog must be torn down"
assert device._tunnels == {}, device._tunnels
print("ok  stale entry before the handshake: torn down even though the handshake fails")


async def replaced_while_waiting_for_lock(ip, udid):
    """While the request waits for the lock to tear down udid's stale entry,
    a running tunnel for udid takes its place (a watchdog restart, or the
    phone's other IP). asyncio.Lock hands the lock over in arrival order,
    so the replacement, queued first, gets in before the request."""
    lock = device._tunnels_lock
    put_stale(udid)
    restarted = FakeRunner()
    restarted.running, restarted.target_ip, restarted.target_port = True, "192.168.1.99", 49152

    async def replace():
        async with lock:
            device._tunnels[udid] = restarted

    await lock.acquire()
    request = asyncio.create_task(send(ip))
    await asyncio.sleep(0.01)  # request queued for its opening checks
    other = asyncio.create_task(replace())
    await asyncio.sleep(0.01)  # replace() queued behind it
    lock.release()
    res = await asyncio.wait_for(request, timeout=2)
    await other
    return res, restarted


# 12) ...but not if it is running by the time the request holds the lock:
# that's this phone's live tunnel, so skip it like any other running one.
reset({"192.168.1.86": (0.05, "PHONE_A", None)})
res, restarted = asyncio.run(replaced_while_waiting_for_lock("192.168.1.86", "PHONE_A"))
assert device._tunnels.get("PHONE_A") is restarted and not restarted.stopped, (
    "the running tunnel must not be torn down", device._tunnels)
assert STARTS == [], ("a phone with a running tunnel is skipped, not handshaked", STARTS)
assert res == (500, "tunnel_spawn_failed"), res
print("ok  stale entry replaced by a running one while waiting: left alone, candidate skipped")


class FakeDM:
    """Just enough for /wifi/tunnel/stop: no device connections, no USB phones."""

    def __init__(self):
        self._connections = {}

    async def discover_devices(self):
        return []


main_mod = types.ModuleType("main")
main_mod.app_state = types.SimpleNamespace(
    device_manager=FakeDM(), simulation_engines={}, _primary_udid=None,
)
sys.modules["main"] = main_mod


async def stop_while_other_handshakes(ip, udid_to_stop):
    """Stops udid_to_stop while ip handshakes. Returns the stop's result,
    how long it took, and ip's result."""
    task = asyncio.create_task(send(ip))
    await asyncio.sleep(0.05)
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    stop = device.wifi_tunnel_stop(device.WifiTunnelStopRequest(udid=udid_to_stop))
    res = await asyncio.wait_for(stop, timeout=3)
    took = loop.time() - t0
    return res, took, await asyncio.wait_for(task, timeout=3)


# 13) Stop Tunnel on one phone doesn't wait for another phone's handshake.
reset({"192.168.1.90": (1.0, "PHONE_B", None)})
old = add_running("PHONE_A", "192.168.1.10")
res, took, started = asyncio.run(stop_while_other_handshakes("192.168.1.90", "PHONE_A"))
assert res == {"status": "stopped", "udids": ["PHONE_A"]}, res
assert took < 0.3, ("Stop Tunnel must not wait for the handshake", took)
assert old.stopped, "the stopped tunnel's runner must be stopped"
assert started["status"] == "started" and list(device._tunnels) == ["PHONE_B"], (started, device._tunnels)
print(f"ok  Stop Tunnel while another IP handshakes: back in {took:.2f}s")

print("all ok")
