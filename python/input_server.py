#!/usr/bin/env python3
"""
DirectInput reader for RigReady.

Talks to DirectInput 8 directly through ctypes, the same API DCS and the racing sims
use, so it lists exactly the game controllers a game would list (including pedals with
no buttons and button boxes with no axes) and reports each one's instance GUID.

Protocol: newline-delimited JSON on stdin/stdout.
  out: ready {version, devices}, devices, devicesChanged, inputStates {states}, pong, shutdown
  in:  {"command": "enumerate" | "ping" | "stop"}

Uses only the standard library.
"""

import ctypes
import json
import queue
import sys
import threading
import time
import uuid
from ctypes import wintypes as w

VERSION = "directinput-1"
POLL_INTERVAL_MS = 16  # about 60 updates a second (the input tester needs at least 30)
AXIS_DEADZONE = 0.01
RESCAN_INTERVAL_MS = 2000

DIRECTINPUT_VERSION = 0x0800
DI8DEVCLASS_GAMECTRL = 4
DIEDFL_ATTACHEDONLY = 1
DISCL_NONEXCLUSIVE = 0x2
DISCL_BACKGROUND = 0x8
DIDF_ABSAXIS = 1
DIDFT_AXIS = 0x3
DIDFT_BUTTON = 0xC
DIDFT_POV = 0x10
DIDFT_ANYINSTANCE = 0x00FFFF00
DIDFT_OPTIONAL = 0x80000000
DIDOI_ASPECTPOSITION = 0x100
DIPH_DEVICE = 0
DIPH_BYOFFSET = 1
DIPROP_RANGE = 4
DIERR_INPUTLOST = 0x8007001E
DIERR_NOTACQUIRED = 0x8007000C

AXIS_NAMES = ["X", "Y", "Z", "RX", "RY", "RZ", "SLIDER1", "SLIDER2"]
MAX_POVS = 4
MAX_BUTTONS = 128
AXES_BYTES = len(AXIS_NAMES) * 4
POVS_OFFSET = AXES_BYTES
BUTTONS_OFFSET = POVS_OFFSET + MAX_POVS * 4
STATE_SIZE = BUTTONS_OFFSET + MAX_BUTTONS


class GUID(ctypes.Structure):
    _fields_ = [("d1", w.DWORD), ("d2", w.WORD), ("d3", w.WORD), ("d4", ctypes.c_ubyte * 8)]

    def text(self) -> str:
        tail = "".join("%02X" % b for b in self.d4[2:])
        return "%08X-%04X-%04X-%02X%02X-%s" % (self.d1, self.d2, self.d3, self.d4[0], self.d4[1], tail)


def make_guid(text: str) -> GUID:
    g = GUID()
    ctypes.memmove(ctypes.byref(g), uuid.UUID(text).bytes_le, 16)
    return g


class DIDEVICEINSTANCEW(ctypes.Structure):
    _fields_ = [
        ("dwSize", w.DWORD),
        ("guidInstance", GUID),
        ("guidProduct", GUID),
        ("dwDevType", w.DWORD),
        ("tszInstanceName", ctypes.c_wchar * 260),
        ("tszProductName", ctypes.c_wchar * 260),
        ("guidFFDriver", GUID),
        ("wUsagePage", w.WORD),
        ("wUsage", w.WORD),
    ]


class DIDEVCAPS(ctypes.Structure):
    _fields_ = [
        ("dwSize", w.DWORD),
        ("dwFlags", w.DWORD),
        ("dwDevType", w.DWORD),
        ("dwAxes", w.DWORD),
        ("dwButtons", w.DWORD),
        ("dwPOVs", w.DWORD),
        ("dwFFSamplePeriod", w.DWORD),
        ("dwFFMinTimeResolution", w.DWORD),
        ("dwFirmwareRevision", w.DWORD),
        ("dwHardwareRevision", w.DWORD),
        ("dwFFDriverVersion", w.DWORD),
    ]


class DIOBJECTDATAFORMAT(ctypes.Structure):
    _fields_ = [
        ("pguid", ctypes.POINTER(GUID)),
        ("dwOfs", w.DWORD),
        ("dwType", w.DWORD),
        ("dwFlags", w.DWORD),
    ]


class DIDATAFORMAT(ctypes.Structure):
    _fields_ = [
        ("dwSize", w.DWORD),
        ("dwObjSize", w.DWORD),
        ("dwFlags", w.DWORD),
        ("dwDataSize", w.DWORD),
        ("dwNumObjs", w.DWORD),
        ("rgodf", ctypes.POINTER(DIOBJECTDATAFORMAT)),
    ]


class DIDEVICEOBJECTINSTANCEW(ctypes.Structure):
    _fields_ = [
        ("dwSize", w.DWORD),
        ("guidType", GUID),
        ("dwOfs", w.DWORD),
        ("dwType", w.DWORD),
        ("dwFlags", w.DWORD),
        ("tszName", ctypes.c_wchar * 260),
        ("dwFFMaxForce", w.DWORD),
        ("dwFFForceResolution", w.DWORD),
        ("wCollectionNumber", w.WORD),
        ("wDesignatorIndex", w.WORD),
        ("wUsagePage", w.WORD),
        ("wUsage", w.WORD),
        ("dwDimension", w.DWORD),
        ("wExponent", w.WORD),
        ("wReportId", w.WORD),
    ]


class DIPROPRANGE(ctypes.Structure):
    _fields_ = [
        ("dwSize", w.DWORD),
        ("dwHeaderSize", w.DWORD),
        ("dwObj", w.DWORD),
        ("dwHow", w.DWORD),
        ("lMin", w.LONG),
        ("lMax", w.LONG),
    ]


IID_IDirectInput8W = make_guid("BF798031-483A-4DA2-AA99-5D64ED369700")
AXIS_GUIDS = [
    make_guid("A36D02E0-C9F3-11CF-BFC7-444553540000"),  # X
    make_guid("A36D02E1-C9F3-11CF-BFC7-444553540000"),  # Y
    make_guid("A36D02E2-C9F3-11CF-BFC7-444553540000"),  # Z
    make_guid("A36D02F4-C9F3-11CF-BFC7-444553540000"),  # Rx
    make_guid("A36D02F5-C9F3-11CF-BFC7-444553540000"),  # Ry
    make_guid("A36D02E3-C9F3-11CF-BFC7-444553540000"),  # Rz
    make_guid("A36D02E4-C9F3-11CF-BFC7-444553540000"),  # Slider
    make_guid("A36D02E4-C9F3-11CF-BFC7-444553540000"),  # Slider
]
GUID_POV = make_guid("A36D02F2-C9F3-11CF-BFC7-444553540000")


def build_data_format() -> DIDATAFORMAT:
    """The layout of DIJOYSTATE2 trimmed to what we read: 8 axes, 4 POVs, 128 buttons."""
    count = len(AXIS_NAMES) + MAX_POVS + MAX_BUTTONS
    objects = (DIOBJECTDATAFORMAT * count)()
    n = 0
    for i in range(len(AXIS_NAMES)):
        objects[n] = DIOBJECTDATAFORMAT(
            ctypes.pointer(AXIS_GUIDS[i]), i * 4, DIDFT_OPTIONAL | DIDFT_AXIS | DIDFT_ANYINSTANCE, DIDOI_ASPECTPOSITION
        )
        n += 1
    for i in range(MAX_POVS):
        objects[n] = DIOBJECTDATAFORMAT(
            ctypes.pointer(GUID_POV), POVS_OFFSET + i * 4, DIDFT_OPTIONAL | DIDFT_POV | DIDFT_ANYINSTANCE, 0
        )
        n += 1
    for i in range(MAX_BUTTONS):
        objects[n] = DIOBJECTDATAFORMAT(None, BUTTONS_OFFSET + i, DIDFT_OPTIONAL | DIDFT_BUTTON | DIDFT_ANYINSTANCE, 0)
        n += 1
    fmt = DIDATAFORMAT()
    fmt.dwSize = ctypes.sizeof(DIDATAFORMAT)
    fmt.dwObjSize = ctypes.sizeof(DIOBJECTDATAFORMAT)
    fmt.dwFlags = DIDF_ABSAXIS
    fmt.dwDataSize = STATE_SIZE
    fmt.dwNumObjs = count
    fmt.rgodf = ctypes.cast(objects, ctypes.POINTER(DIOBJECTDATAFORMAT))
    fmt._objects_keepalive = objects  # the format points into this array
    return fmt


def method(obj, index, *argtypes):
    """Bound COM method by vtable index, returning HRESULT as an unsigned number."""
    vtable = ctypes.cast(obj, ctypes.POINTER(ctypes.c_void_p))[0]
    address = ctypes.cast(vtable, ctypes.POINTER(ctypes.c_void_p))[index]
    fn = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, *argtypes)(address)
    return lambda *args: fn(obj, *args) & 0xFFFFFFFF


ENUM_CALLBACK = ctypes.WINFUNCTYPE(w.BOOL, ctypes.POINTER(DIDEVICEINSTANCEW), ctypes.c_void_p)


def log(message: str) -> None:
    sys.stderr.write(message + "\n")
    sys.stderr.flush()


def send_message(msg_type: str, data: dict) -> None:
    try:
        print(json.dumps({"type": msg_type, **data}), flush=True)
    except Exception as e:  # stdout closed: the parent is gone
        log(f"Error sending message: {e}")


class Device:
    def __init__(self, pointer, info: dict, axis_slots: list):
        self.pointer = pointer
        self.info = info
        self.axis_slots = axis_slots  # indexes into AXIS_NAMES that this device has
        self.buffer = (ctypes.c_ubyte * STATE_SIZE)()
        self.previous = None
        self.failures = 0

    def release(self) -> None:
        try:
            method(self.pointer, 8)()  # Unacquire
            method(self.pointer, 2)()  # Release
        except Exception:
            pass

    def read(self):
        poll = method(self.pointer, 25)
        get_state = method(self.pointer, 9, w.DWORD, ctypes.c_void_p)
        poll()
        hr = get_state(STATE_SIZE, ctypes.byref(self.buffer))
        if hr in (DIERR_INPUTLOST, DIERR_NOTACQUIRED):
            method(self.pointer, 7)()  # Acquire
            poll()
            hr = get_state(STATE_SIZE, ctypes.byref(self.buffer))
        if hr != 0:
            self.failures += 1
            return None
        self.failures = 0
        raw = bytes(self.buffer)
        axes = []
        for slot in self.axis_slots:
            value = int.from_bytes(raw[slot * 4 : slot * 4 + 4], "little", signed=True) / 32767.0
            value = max(-1.0, min(1.0, value))
            axes.append(0.0 if abs(value) < AXIS_DEADZONE else round(value, 4))
        hats = []
        for i in range(self.info["numHats"]):
            pov = int.from_bytes(raw[POVS_OFFSET + i * 4 : POVS_OFFSET + i * 4 + 4], "little")
            hats.append(pov_to_hat(pov))
        buttons = [raw[BUTTONS_OFFSET + i] & 0x80 != 0 for i in range(self.info["numButtons"])]
        return {
            "index": self.info["index"],
            "name": self.info["name"],
            "axes": axes,
            "buttons": buttons,
            "hats": hats,
            "timestamp": int(time.time() * 1000),
        }


def pov_to_hat(pov: int) -> list:
    """DirectInput POV (hundredths of a degree, 0xFFFF low word when centred) to [x, y]."""
    if pov & 0xFFFF == 0xFFFF:
        return [0, 0]
    sector = int(((pov % 36000) + 2250) // 4500) % 8
    return [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]][sector]


class DirectInput:
    def __init__(self):
        self.dinput8 = ctypes.WinDLL("dinput8")
        kernel32 = ctypes.WinDLL("kernel32")
        kernel32.GetModuleHandleW.restype = ctypes.c_void_p
        user32 = ctypes.WinDLL("user32")
        user32.GetDesktopWindow.restype = ctypes.c_void_p
        self.window = ctypes.c_void_p(user32.GetDesktopWindow())
        self.pointer = ctypes.c_void_p()
        hr = self.dinput8.DirectInput8Create(
            ctypes.c_void_p(kernel32.GetModuleHandleW(None)),
            DIRECTINPUT_VERSION,
            ctypes.byref(IID_IDirectInput8W),
            ctypes.byref(self.pointer),
            None,
        )
        if hr != 0:
            raise OSError("DirectInput8Create failed with 0x%08X" % (hr & 0xFFFFFFFF))
        self.format = build_data_format()
        self.devices = []

    def enumerate(self) -> list:
        """Attached game controllers as DirectInput reports them, in a stable order."""
        found = []

        def on_device(instance, _ref):
            i = instance.contents
            found.append(
                {
                    "guid": i.guidInstance.text(),
                    "productGuid": i.guidProduct.text(),
                    # Not stripped: games key files on the exact product name.
                    "name": i.tszProductName,
                    "instanceName": i.tszInstanceName,
                }
            )
            return 1

        callback = ENUM_CALLBACK(on_device)
        hr = method(self.pointer, 4, w.DWORD, ENUM_CALLBACK, ctypes.c_void_p, w.DWORD)(
            DI8DEVCLASS_GAMECTRL, callback, None, DIEDFL_ATTACHEDONLY
        )
        if hr != 0:
            raise OSError("EnumDevices failed with 0x%08X" % hr)
        found.sort(key=lambda d: (d["name"].lower(), d["guid"]))
        return found

    def open_all(self) -> list:
        for device in self.devices:
            device.release()
        self.devices = []
        for index, entry in enumerate(self.enumerate()):
            try:
                self.devices.append(self.open(index, entry))
            except Exception as e:
                log(f"Could not open {entry['name']}: {e}")
        return [d.info for d in self.devices]

    def open(self, index: int, entry: dict) -> Device:
        pointer = ctypes.c_void_p()
        instance = make_guid(entry["guid"])
        hr = method(self.pointer, 3, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p)(
            ctypes.byref(instance), ctypes.byref(pointer), None
        )
        if hr != 0:
            raise OSError("CreateDevice failed with 0x%08X" % hr)
        hr = method(pointer, 11, ctypes.POINTER(DIDATAFORMAT))(ctypes.byref(self.format))
        if hr != 0:
            raise OSError("SetDataFormat failed with 0x%08X" % hr)
        # Background + non-exclusive: read while another window (or the game) has focus.
        method(pointer, 13, ctypes.c_void_p, w.DWORD)(self.window, DISCL_BACKGROUND | DISCL_NONEXCLUSIVE)
        caps = DIDEVCAPS()
        caps.dwSize = ctypes.sizeof(DIDEVCAPS)
        method(pointer, 3, ctypes.POINTER(DIDEVCAPS))(ctypes.byref(caps))

        get_object = method(pointer, 14, ctypes.POINTER(DIDEVICEOBJECTINSTANCEW), w.DWORD, w.DWORD)
        axis_slots = []
        for slot in range(len(AXIS_NAMES)):
            info = DIDEVICEOBJECTINSTANCEW()
            info.dwSize = ctypes.sizeof(DIDEVICEOBJECTINSTANCEW)
            if get_object(ctypes.byref(info), slot * 4, DIPH_BYOFFSET) == 0:
                axis_slots.append(slot)

        axis_range = DIPROPRANGE(ctypes.sizeof(DIPROPRANGE), 16, 0, DIPH_DEVICE, -32767, 32767)
        method(pointer, 6, ctypes.c_void_p, ctypes.c_void_p)(ctypes.c_void_p(DIPROP_RANGE), ctypes.byref(axis_range))
        method(pointer, 7)()  # Acquire

        product = entry["productGuid"]
        info = {
            "index": index,
            "name": entry["name"],
            "guid": entry["guid"],
            "productGuid": product,
            # The product GUID is {PPPPVVVV-0000-0000-0000-504944564944} for HID devices.
            "vendorId": product[4:8] if product.endswith("504944564944") else "",
            "productId": product[0:4] if product.endswith("504944564944") else "",
            "numAxes": len(axis_slots),
            "numButtons": min(int(caps.dwButtons), MAX_BUTTONS),
            "numHats": min(int(caps.dwPOVs), MAX_POVS),
            "axisNames": [AXIS_NAMES[s] for s in axis_slots],
        }
        return Device(pointer, info, axis_slots)

    def changed(self) -> bool:
        try:
            now = {d["guid"] for d in self.enumerate()}
        except Exception as e:
            log(f"rescan failed: {e}")
            return False
        return now != {d.info["guid"] for d in self.devices}

    def close(self) -> None:
        for device in self.devices:
            device.release()
        self.devices = []
        method(self.pointer, 2)()


def state_changed(previous, state) -> bool:
    if previous is None:
        return True
    if previous["buttons"] != state["buttons"] or previous["hats"] != state["hats"]:
        return True
    return any(abs(a - b) > AXIS_DEADZONE for a, b in zip(previous["axes"], state["axes"]))


def read_commands(commands: "queue.Queue", stop: threading.Event) -> None:
    while not stop.is_set():
        line = sys.stdin.readline()
        if not line:  # the parent closed stdin
            commands.put({"command": "stop"})
            return
        line = line.strip()
        if not line:
            continue
        try:
            commands.put(json.loads(line))
        except json.JSONDecodeError as e:
            log(f"Invalid JSON command: {e}")


def main() -> None:
    di = DirectInput()
    send_message("ready", {"version": VERSION, "devices": di.open_all()})

    commands: "queue.Queue" = queue.Queue()
    stop = threading.Event()
    threading.Thread(target=read_commands, args=(commands, stop), daemon=True).start()

    last_poll = 0.0
    last_scan = time.time() * 1000
    try:
        while not stop.is_set():
            while not commands.empty():
                command = commands.get_nowait().get("command")
                if command == "enumerate":
                    send_message("devices", {"devices": di.open_all()})
                elif command == "ping":
                    send_message("pong", {"timestamp": int(time.time() * 1000)})
                elif command == "stop":
                    stop.set()
                else:
                    log(f"Unknown command: {command}")

            now = time.time() * 1000
            if now - last_scan >= RESCAN_INTERVAL_MS:
                last_scan = now
                if di.changed():
                    send_message("devicesChanged", {"devices": di.open_all()})

            if now - last_poll >= POLL_INTERVAL_MS:
                last_poll = now
                states = []
                for device in di.devices:
                    state = device.read()
                    if state is not None and state_changed(device.previous, state):
                        device.previous = state
                        states.append(state)
                if states:
                    send_message("inputStates", {"states": states})

            time.sleep(0.005)
    except KeyboardInterrupt:
        pass
    finally:
        di.close()
        send_message("shutdown", {})


if __name__ == "__main__":
    main()
