"""DeviceManager.get_location_service on an iOS 17+ phone whose DVT provider
fails to open, e.g. because the Developer Disk Image is not mounted: it must
fall back to LegacyLocationService instead of raising, and the DDI status
check before it must still broadcast ddi_not_mounted with the phone's udid,
because the frontend closes its progress overlay on that event. Both must
hold through the cleanup in
.scratch/device-dead-code/issues/03-dvt-location-service-leftovers.md.

Run from the repo root: .venv/Scripts/python.exe tests/device/test_dvt_location_fallback.py
DvtProvider, MobileImageMounterService, broadcast and the lockdown are fakes:
no network, no phone."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import api.websocket as websocket  # noqa: E402
import core.device_manager as device_manager  # noqa: E402
import pymobiledevice3.services.mobile_image_mounter as mobile_image_mounter  # noqa: E402
from services.location_service import LegacyLocationService  # noqa: E402

PHONE = "00008110-PHONE"
BROADCASTS: list[tuple[str, dict]] = []
DVT_OPENS: list[object] = []


class FakeDvtProvider:
    """Opening DVT fails, as it does when the DDI is not mounted. Each
    attempt is recorded: the real DvtProvider also fails on FakeLockdown, so
    without the record (a) would pass even if this fake were never used or
    DVT were skipped altogether."""

    def __init__(self, lockdown):
        self.lockdown = lockdown

    async def __aenter__(self):
        DVT_OPENS.append(self.lockdown)
        raise RuntimeError("fake DVT failure")


class FakeMounter:
    """Answers that no Personalized DDI is mounted. The DDI check swallows
    any error from this class (a missing lockdown= or connect() included)
    and returns without broadcasting, so check the fake first if (b) fails."""

    def __init__(self, lockdown):
        self.lockdown = lockdown

    async def connect(self):
        pass

    async def is_image_mounted(self, image_type):
        return False

    async def close(self):
        pass


class FakeLockdown:
    """No peer_info, so the DDI check asks mobile_image_mounter instead of
    reading the RSD service list."""


async def fake_broadcast(event_type, data):
    BROADCASTS.append((event_type, data))


# The mounter and broadcast are imported inside the functions that use them,
# so the module attributes are what they pick up.
device_manager.DvtProvider = FakeDvtProvider
mobile_image_mounter.MobileImageMounterService = FakeMounter
websocket.broadcast = fake_broadcast


async def main():
    dm = device_manager.DeviceManager()
    dm._connections[PHONE] = device_manager._ActiveConnection(
        udid=PHONE, lockdown=FakeLockdown(), ios_version="17.4")
    return await dm.get_location_service(PHONE)


loc = asyncio.run(main())

# a) Location simulation stays available over DtSimulateLocation, and only
# after DVT was tried and failed.
assert DVT_OPENS, "DVT was never tried through FakeDvtProvider"
assert isinstance(loc, LegacyLocationService), type(loc)
print("ok  DVT fails: get_location_service falls back to LegacyLocationService")

# b) Only the udid is checked: other fields may come and go.
udids = [data.get("udid") for event, data in BROADCASTS if event == "ddi_not_mounted"]
assert PHONE in udids, BROADCASTS
print("ok  DDI not mounted: ddi_not_mounted is still broadcast with the phone's udid")

print("all ok")
