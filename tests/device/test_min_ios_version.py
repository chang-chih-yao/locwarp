"""DeviceManager.connect must refuse iOS 16 and older with
UnsupportedIosVersionError before opening any tunnel, and must still connect
iOS 17.0. LocWarp only implements the iOS 17+ path (CoreDeviceTunnelProxy +
RSD + DVT); the iOS 16 path (plain usbmux lockdown + classic DDI) was removed
on 2026-11-07, so an iOS 16 phone must get the "requires iOS 17+" error
instead of a half-working connection. The version gate reads MIN_VERSION,
which the API also reports as min_version. The text users see comes from the
frontend's own copy of the number (ios_unsupported in
frontend/src/services/api.ts, device.ios_unsupported_label in
frontend/src/i18n/strings.ts, the device dropdown in DeviceStatus.tsx); this
test doesn't cover those, so change them together with MIN_VERSION.

Run from the repo root: .venv/Scripts/python.exe tests/device/test_min_ios_version.py
list_devices, create_using_usbmux, the device-name cache and _connect_tunnel
are fakes: no network, no phone, nothing written to disk."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import core.device_manager as device_manager  # noqa: E402

PHONE = "00008110-PHONE"
TUNNELS: list[tuple[str, str]] = []


class FakeLockdown:
    def __init__(self, version):
        self.all_values = {"ProductVersion": version, "DeviceName": "Test iPhone"}


def make_create_using_usbmux(version):
    async def fake_create_using_usbmux(serial=None, **kwargs):
        return FakeLockdown(version)
    return fake_create_using_usbmux


async def fake_list_devices():
    return []


async def fake_connect_tunnel(udid, lockdown, ios_version):
    """Records every attempt: an iOS 16 phone must never get this far."""
    TUNNELS.append((udid, ios_version))
    return device_manager._ActiveConnection(
        udid=udid, lockdown=lockdown, ios_version=ios_version)


device_manager.list_devices = fake_list_devices
device_manager._remember_device_name = lambda udid, name: None


async def connect(version):
    """Connect a fresh DeviceManager to a phone reporting *version*."""
    TUNNELS.clear()
    device_manager.create_using_usbmux = make_create_using_usbmux(version)
    dm = device_manager.DeviceManager()
    dm._connect_tunnel = fake_connect_tunnel
    try:
        await dm.connect(PHONE)
    except device_manager.UnsupportedIosVersionError as exc:
        return dm, exc
    return dm, None


# a) iOS 16: refused, no tunnel attempted, nothing stored.
dm, exc = asyncio.run(connect("16.7.12"))
assert exc is not None, "iOS 16.7.12 was not refused"
assert exc.version == "16.7.12", exc.version
assert device_manager.UnsupportedIosVersionError.MIN_VERSION == "17.0"
assert not TUNNELS, TUNNELS
assert PHONE not in dm._connections
print("ok  iOS 16.7.12: refused with UnsupportedIosVersionError, no tunnel opened")

# b) iOS 17.0 is the lowest supported version: it goes through the tunnel.
dm, exc = asyncio.run(connect("17.0"))
assert exc is None, exc
assert TUNNELS == [(PHONE, "17.0")], TUNNELS
assert PHONE in dm._connections
print("ok  iOS 17.0: connected through _connect_tunnel")

print("all ok")
