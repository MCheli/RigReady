#!/usr/bin/env python3
"""
Virtual controller helper for RigReady.

Plugs one virtual Xbox 360 controller or DualShock 4 into the ViGEmBus driver through
ViGEmClient.dll (loaded from the path given with --client) and hands it the reports
RigReady sends. The driver must already be installed by the user; this never installs
anything and needs no administrator rights.

Protocol: newline-delimited JSON on stdin/stdout.
  in:  {"command": "plug", "kind": "xbox360" | "ds4"}
       {"command": "report", "lx", "ly", "rx", "ry": -1..1 (up and right positive),
        "lt", "rt": 0..1, "buttons": XInput bit mask}
       {"command": "unplug" | "status" | "stop"}
  out: ready {version}, plugged {kind}, unplugged, status {plugged, kind, reports},
       error {code, message}

When stdin closes (RigReady ended, however it ended) the controller is unplugged and the
helper exits. The driver also removes the controller when this process ends.

Uses only the standard library.
"""

import ctypes
import json
import sys

VERSION = "vigem-1"

VIGEM_ERROR_NONE = 0x20000000
VIGEM_ERRORS = {
    0xE0000001: ("pad.driver", "The ViGEmBus driver is not installed."),
    0xE0000002: ("pad.slots", "The ViGEmBus driver has no free controller slot."),
    0xE0000003: ("pad.target", "The virtual controller could not be created."),
    0xE0000005: ("pad.connected", "The virtual controller is already plugged in."),
    0xE0000008: ("pad.version", "The installed ViGEmBus driver is a version this helper cannot use."),
    0xE0000009: ("pad.access", "The ViGEmBus driver could not be opened."),
    0xE0000012: ("pad.connected", "The ViGEmBus driver is already connected."),
}

# XInput button bits (the report RigReady sends) and their DualShock 4 counterparts.
XUSB_DPAD_UP, XUSB_DPAD_DOWN, XUSB_DPAD_LEFT, XUSB_DPAD_RIGHT = 0x1, 0x2, 0x4, 0x8
XUSB_TO_DS4 = {
    0x0010: 1 << 13,  # Start -> Options
    0x0020: 1 << 12,  # Back -> Share
    0x0040: 1 << 14,  # L3
    0x0080: 1 << 15,  # R3
    0x0100: 1 << 8,  # LB -> L1
    0x0200: 1 << 9,  # RB -> R1
    0x1000: 1 << 5,  # A -> Cross
    0x2000: 1 << 6,  # B -> Circle
    0x4000: 1 << 4,  # X -> Square
    0x8000: 1 << 7,  # Y -> Triangle
}
XUSB_GUIDE = 0x0400
DS4_TRIGGER_LEFT, DS4_TRIGGER_RIGHT = 1 << 10, 1 << 11
DS4_SPECIAL_PS = 1 << 0
# The DualShock 4 d-pad is a hat: north 0, clockwise to north-west 7, none 8.
DS4_DPAD = {
    (0, 1): 0,
    (1, 1): 1,
    (1, 0): 2,
    (1, -1): 3,
    (0, -1): 4,
    (-1, -1): 5,
    (-1, 0): 6,
    (-1, 1): 7,
}


class XUSB_REPORT(ctypes.Structure):
    _fields_ = [
        ("wButtons", ctypes.c_ushort),
        ("bLeftTrigger", ctypes.c_ubyte),
        ("bRightTrigger", ctypes.c_ubyte),
        ("sThumbLX", ctypes.c_short),
        ("sThumbLY", ctypes.c_short),
        ("sThumbRX", ctypes.c_short),
        ("sThumbRY", ctypes.c_short),
    ]


class DS4_REPORT(ctypes.Structure):
    _fields_ = [
        ("bThumbLX", ctypes.c_ubyte),
        ("bThumbLY", ctypes.c_ubyte),
        ("bThumbRX", ctypes.c_ubyte),
        ("bThumbRY", ctypes.c_ubyte),
        ("wButtons", ctypes.c_ushort),
        ("bSpecial", ctypes.c_ubyte),
        ("bTriggerL", ctypes.c_ubyte),
        ("bTriggerR", ctypes.c_ubyte),
    ]


def send_message(msg_type: str, data: dict) -> None:
    try:
        print(json.dumps({"type": msg_type, **data}), flush=True)
    except Exception as e:  # stdout closed: the parent is gone
        sys.stderr.write(f"Error sending message: {e}\n")


def clamp(value, low, high) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if number != number:  # NaN
        return 0.0
    return max(low, min(high, number))


def stick16(value) -> int:
    return int(round(clamp(value, -1.0, 1.0) * 32767))


def stick8(value, flip=False) -> int:
    v = clamp(value, -1.0, 1.0)
    if flip:
        v = -v
    return max(0, min(255, int(round(128 + v * 127))))


def trigger8(value) -> int:
    return int(round(clamp(value, 0.0, 1.0) * 255))


def xusb_report(command: dict) -> XUSB_REPORT:
    r = XUSB_REPORT()
    r.wButtons = int(clamp(command.get("buttons", 0), 0, 0xFFFF))
    r.bLeftTrigger = trigger8(command.get("lt", 0))
    r.bRightTrigger = trigger8(command.get("rt", 0))
    r.sThumbLX = stick16(command.get("lx", 0))
    r.sThumbLY = stick16(command.get("ly", 0))
    r.sThumbRX = stick16(command.get("rx", 0))
    r.sThumbRY = stick16(command.get("ry", 0))
    return r


def ds4_report(command: dict) -> DS4_REPORT:
    """The same report for a DualShock 4: its sticks have 0 at the top, so Y is turned round."""
    buttons_in = int(clamp(command.get("buttons", 0), 0, 0xFFFF))
    r = DS4_REPORT()
    r.bThumbLX = stick8(command.get("lx", 0))
    r.bThumbLY = stick8(command.get("ly", 0), flip=True)
    r.bThumbRX = stick8(command.get("rx", 0))
    r.bThumbRY = stick8(command.get("ry", 0), flip=True)
    lt = trigger8(command.get("lt", 0))
    rt = trigger8(command.get("rt", 0))
    r.bTriggerL = lt
    r.bTriggerR = rt
    buttons = 0
    for bit, ds4 in XUSB_TO_DS4.items():
        if buttons_in & bit:
            buttons |= ds4
    if lt > 0:
        buttons |= DS4_TRIGGER_LEFT
    if rt > 0:
        buttons |= DS4_TRIGGER_RIGHT
    x = (1 if buttons_in & XUSB_DPAD_RIGHT else 0) - (1 if buttons_in & XUSB_DPAD_LEFT else 0)
    y = (1 if buttons_in & XUSB_DPAD_UP else 0) - (1 if buttons_in & XUSB_DPAD_DOWN else 0)
    buttons |= DS4_DPAD.get((x, y), 8)
    r.wButtons = buttons
    r.bSpecial = DS4_SPECIAL_PS if buttons_in & XUSB_GUIDE else 0
    return r


class Bus:
    def __init__(self, client_path: str):
        dll = ctypes.CDLL(client_path)
        self.dll = dll
        dll.vigem_alloc.restype = ctypes.c_void_p
        dll.vigem_alloc.argtypes = ()
        dll.vigem_free.argtypes = (ctypes.c_void_p,)
        dll.vigem_connect.restype = ctypes.c_uint
        dll.vigem_connect.argtypes = (ctypes.c_void_p,)
        dll.vigem_disconnect.argtypes = (ctypes.c_void_p,)
        dll.vigem_target_x360_alloc.restype = ctypes.c_void_p
        dll.vigem_target_x360_alloc.argtypes = ()
        dll.vigem_target_ds4_alloc.restype = ctypes.c_void_p
        dll.vigem_target_ds4_alloc.argtypes = ()
        dll.vigem_target_free.argtypes = (ctypes.c_void_p,)
        dll.vigem_target_add.restype = ctypes.c_uint
        dll.vigem_target_add.argtypes = (ctypes.c_void_p, ctypes.c_void_p)
        dll.vigem_target_remove.restype = ctypes.c_uint
        dll.vigem_target_remove.argtypes = (ctypes.c_void_p, ctypes.c_void_p)
        dll.vigem_target_x360_update.restype = ctypes.c_uint
        dll.vigem_target_x360_update.argtypes = (ctypes.c_void_p, ctypes.c_void_p, XUSB_REPORT)
        dll.vigem_target_ds4_update.restype = ctypes.c_uint
        dll.vigem_target_ds4_update.argtypes = (ctypes.c_void_p, ctypes.c_void_p, DS4_REPORT)
        self.client = None
        self.target = None
        self.kind = None
        self.reports = 0

    def connect(self):
        """None when connected, else (code, message)."""
        if self.client:
            return None
        client = self.dll.vigem_alloc()
        if not client:
            return ("pad.memory", "Out of memory.")
        result = self.dll.vigem_connect(client)
        if result != VIGEM_ERROR_NONE:
            self.dll.vigem_free(client)
            return describe(result)
        self.client = client
        return None

    def plug(self, kind: str):
        if kind not in ("xbox360", "ds4"):
            return ("pad.kind", f"Unknown controller kind: {kind}")
        failed = self.connect()
        if failed:
            return failed
        self.unplug()
        target = self.dll.vigem_target_x360_alloc() if kind == "xbox360" else self.dll.vigem_target_ds4_alloc()
        if not target:
            return ("pad.memory", "Out of memory.")
        result = self.dll.vigem_target_add(self.client, target)
        if result != VIGEM_ERROR_NONE:
            self.dll.vigem_target_free(target)
            return describe(result)
        self.target = target
        self.kind = kind
        self.reports = 0
        return None

    def report(self, command: dict) -> None:
        if not self.target:
            return
        if self.kind == "xbox360":
            result = self.dll.vigem_target_x360_update(self.client, self.target, xusb_report(command))
        else:
            result = self.dll.vigem_target_ds4_update(self.client, self.target, ds4_report(command))
        if result == VIGEM_ERROR_NONE:
            self.reports += 1

    def unplug(self) -> None:
        if self.target:
            self.dll.vigem_target_remove(self.client, self.target)
            self.dll.vigem_target_free(self.target)
        self.target = None
        self.kind = None
        self.reports = 0

    def close(self) -> None:
        self.unplug()
        if self.client:
            self.dll.vigem_disconnect(self.client)
            self.dll.vigem_free(self.client)
        self.client = None


def describe(code: int):
    return VIGEM_ERRORS.get(code, ("pad.error", "ViGEmBus refused (0x%08X)." % code))


def main() -> None:
    args = sys.argv[1:]
    if len(args) != 2 or args[0] != "--client":
        sys.stderr.write("usage: pad_server.py --client <ViGEmClient.dll>\n")
        sys.exit(2)
    try:
        bus = Bus(args[1])
    except OSError as e:
        sys.stderr.write(f"ViGEmClient.dll could not be loaded: {e}\n")
        sys.exit(3)
    send_message("ready", {"version": VERSION})
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                command = json.loads(line)
            except json.JSONDecodeError as e:
                sys.stderr.write(f"Invalid JSON command: {e}\n")
                continue
            name = command.get("command") if isinstance(command, dict) else None
            if name == "report":
                bus.report(command)
            elif name == "plug":
                failed = bus.plug(command.get("kind"))
                if failed:
                    send_message("error", {"code": failed[0], "message": failed[1]})
                else:
                    send_message("plugged", {"kind": bus.kind})
            elif name == "unplug":
                bus.unplug()
                send_message("unplugged", {})
            elif name == "status":
                data = {"plugged": bus.target is not None, "reports": bus.reports}
                if bus.kind:
                    data["kind"] = bus.kind
                send_message("status", data)
            elif name == "stop":
                break
            else:
                sys.stderr.write(f"Unknown command: {name}\n")
    except KeyboardInterrupt:
        pass
    finally:
        # stdin closed, stop asked, or anything else: never leave a controller behind.
        bus.close()


if __name__ == "__main__":
    main()
