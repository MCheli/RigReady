# USB ids of sim hardware

Where the vendor and product ids in `src/features/devices/core/family.ts` come from, and what the name rules in `src/features/fly/core/deviceKind.ts` and `src/features/sharing/core/picture.ts` are based on. Checked 2026-11-11. An id goes into the table only when one of the sources below lists it; a product that none of them lists is left to the vendor rule or to its name.

## Sources

| Short name | What it is | Where |
|---|---|---|
| **kernel** | Linux kernel `drivers/hid/hid-ids.h` and `hid-universal-pidff.c` (the wheel bases the generic force-feedback driver binds to) | https://github.com/torvalds/linux/blob/master/drivers/hid/hid-ids.h , https://github.com/torvalds/linux/blob/master/drivers/hid/hid-universal-pidff.c |
| **SDL** | SDL's lists of wheels, flight sticks and throttles in `src/joystick/SDL_joystick.c` (`initial_wheel_devices`, `initial_flightstick_devices`, `initial_throttle_devices`) | https://github.com/libsdl-org/SDL/blob/main/src/joystick/SDL_joystick.c |
| **usb.ids** | The Linux USB id repository | http://www.linux-usb.org/usb.ids |
| **lhw** | linux-hardware.org, devices seen on real machines, searched by vendor | https://linux-hardware.org/?view=search&vendorid=044f |
| **lsw** | The linux-steering-wheels compatibility table (VID and PID per wheel base) | https://github.com/JacKeTUs/linux-steering-wheels |
| **tmff2** | hid-tmff2, the Thrustmaster wheel driver (`src/hid-tmff2.h`) | https://github.com/Kimplul/hid-tmff2 |
| **ab9** | dcs-linux-vr-ab9, a working AB9 force-feedback setup; its udev rule matches `346e:1000` | https://github.com/Specter242/dcs-linux-vr-ab9 |
| **drv** | Driver databases listing the T-LCM's hardware id | https://drivermax.com/T-LCM-Pedals-Bluetooth-Device-Thrustmaster-USB-VID-044F-PID-B371-MI-01-1_5_6_0-2020-01-27-4459552-driver.htm |
| **DCS** | The default profiles DCS World ships per device, named by the DirectInput product name (`Mods\aircraft\*\Input\*\joystick\*.diff.lua`), read on the owner's PC | - |

## Vendors

| Vendor id | Maker | Family | Source |
|---|---|---|---|
| 4098 | WinWing (WINCTRL) | flight | the owner's rig (recorded) |
| 3344 | Virpil | flight | SDL (VPC MT-50CM3 sticks, VMAX throttle) |
| 231D | VKB | flight | SDL (Gunfighter Mk.III, Gladiator NXT Evo) |
| 06A3 | Saitek (and Logitech's Saitek line) | flight, apart from its wheels | usb.ids, kernel |
| 0738 | Mad Catz (Saitek X-55, X-56) | flight, apart from its wheels | usb.ids, SDL |
| 068E | CH Products | flight | usb.ids |
| 294B | Honeycomb Aeronautical | flight | kept from before (not in these lists) |
| 131D | NaturalPoint | flight | kept from before |
| 0EB7 | Fanatec (Endor AG) | racing | usb.ids, SDL, lsw |
| 346E | Moza | racing, apart from its flight gear | kernel, SDL, lsw |
| 3670 | Simagic (EVO bases) | racing | lsw (EVO Sport 0500, EVO 0501, EVO Pro 0502) |
| 30B7 | Heusinkveld | racing | kept from before |
| 2433 | Asetek SimSports | racing | kernel, SDL, lsw (the same id also covers Asetek's coolers, which are not game controllers) |
| 3416 | Cammus | racing | kernel, SDL, lsw |
| 10F5 | Turtle Beach | by product (its headsets share the id) | kernel, SDL |
| 044F | Thrustmaster | by product | see below |
| 046D | Logitech | by product | see below |
| 16D0 | MCS (shared; Simucube uses it) | by product | SDL, lsw |
| 0483 | STMicroelectronics (shared; older Simagic bases and VRS use it) | by product | SDL, kernel, lsw |

## Products

| Id | Product | Family | Source |
|---|---|---|---|
| 044F:0400 | HOTAS Cougar | flight | usb.ids |
| 044F:0402, 0404 | HOTAS Warthog stick, throttle | flight | usb.ids, SDL, lhw |
| 044F:0405 | TCA Sidestick Airbus ("T.A320 Pilot") | flight | lhw |
| 044F:0406 | TCA Sidestick Airbus, left hand ("T.A320 Copilot") | flight | lhw |
| 044F:0407, 0408 | TCA Quadrant Airbus ("TCA Q-Eng 1&2", "TCA Q-Eng 3&4") | flight | lhw |
| 044F:0409 | TCA Yoke Boeing | flight | lhw |
| 044F:040A | TCA Quadrant Boeing 1&2 | flight | lhw |
| 044F:B106, B107 | T.Flight Stick X | flight | lhw |
| 044F:B108 | T.Flight HOTAS X | flight | usb.ids, lhw |
| 044F:B109 | T.Flight HOTAS (PS3) | flight | lhw |
| 044F:B10A | T.16000M | flight | usb.ids, SDL, lhw |
| 044F:B351, B352 | Cougar MFD 1, 2 | flight | usb.ids, lhw |
| 044F:B678 | T.Flight Rudder Pedals | flight | usb.ids, lhw |
| 044F:B679 | T-Rudder | flight | usb.ids, lhw |
| 044F:B67B | T.Flight HOTAS | flight | lhw |
| 044F:B67C | T.Flight HOTAS 4 | flight | lhw |
| 044F:B687 | TWCS throttle | flight | usb.ids, lhw |
| 044F:B68C, B68D | T.Flight HOTAS One | flight | lhw |
| 044F:B68F | T-Pendular-Rudder (TPR) | flight | lhw, the owner's rig |
| 044F:B371 | T-LCM pedals | racing | drv, lhw ("Sim Pedals") |
| 044F:B653 | RGT Force Feedback Clutch | racing | usb.ids, lsw |
| 044F:B65D | Thrustmaster FFB wheel (wheels before their own mode starts) | racing | SDL, lhw |
| 044F:B65E | T500 RS | racing | SDL |
| 044F:B660 | T500 RS gear shift | racing | lhw |
| 044F:B664, B669 | TX (initial mode, active mode) | racing | SDL, lsw |
| 044F:B668 | T80 | racing | lhw |
| 044F:B66D, B66E, B66F | T300 RS (PS4 mode, normal, advanced) | racing | SDL, lsw, tmff2 |
| 044F:B671 | Ferrari 458 Spider | racing | lhw |
| 044F:B677 | T150 | racing | usb.ids, SDL |
| 044F:B67E, B67F | TMX (Xbox protocol, PC) | racing | SDL, lhw |
| 044F:B689 | TS-PC Racer | racing | tmff2 |
| 044F:B691, B692 | TS-XW (initial, active) | racing | SDL, tmff2 |
| 044F:B696 | T248 | racing | SDL, lsw, tmff2 |
| 044F:B69A | T248X | racing | lhw |
| 044F:B69C | T128X | racing | lhw |
| 046D:C214 | Attack 3 | flight | usb.ids |
| 046D:C215 | Extreme 3D Pro | flight | usb.ids, SDL |
| 046D:C287 | Flight System G940 | flight | usb.ids |
| 046D:C2A8 | X52 (Logitech era) | flight | kept from before; not found in these lists |
| 046D:C24F, C260 | G29 (PS3, PS4 mode) | racing | kernel, SDL, lsw |
| 046D:C261, C262 | G920 (initial, active) | racing | SDL, lsw |
| 046D:C266, C267, C26D, C26E | G923 (PC, PlayStation, Xbox) | racing | SDL, lsw |
| 046D:C268, C269, C272 | Pro Racing Wheel | racing | SDL, lsw |
| 046D:C294, C295, C298, C299, C29A, C29B, CA03 | Driving Force, MOMO Force, DFP, G25, DFGT, G27, MOMO Racing | racing | SDL, lsw, kernel |
| 06A3:0200, 0501, 0506, 0805, FF04 | Saitek Racing Wheel, R100, R220, R440 | racing | usb.ids |
| 0738:4530, 4730 | Mad Catz MC2 wheel | racing | usb.ids |
| 10F5:7077 | VelocityOne Race | racing | kernel, lsw |
| 10F5:7084 | "Turtle Beach VelocityOne", in the flight-stick list | flight | SDL |
| 10F5:7085 | VelocityOne Throttle | flight | SDL |
| 346E:1000 | Moza AB9 FFB base | flight | ab9 |
| 346E:0000, 0002, 0004, 0005, 0006 (and 0010-0016) | Moza R16/R21, R9, R5, R3, R12 | racing (by vendor) | kernel, SDL, lsw |
| 16D0:0D5A | Simucube 1 | racing | SDL, lsw |
| 16D0:0D5F, 0D60, 0D61 | Simucube 2 Ultimate, Pro, Sport | racing | SDL, lsw (the Sport also appears in Assetto Corsa EVO's input file on the owner's PC) |
| 0483:0522 | Simagic M10, Alpha Mini, Alpha, Alpha U | racing | SDL, lsw |
| 0483:A355 | VRS DirectForce Pro | racing | kernel, SDL, lsw |
| 2433:F300, F301, F303, F306 | Asetek Invicta, Forte, La Prima, Tony Kanaan | racing (by vendor) | kernel, SDL, lsw |
| 3416:0301, 0302 | Cammus C5, C12 | racing (by vendor) | kernel, SDL, lsw |

## Not found, so not in the table

- Moza's MTP throttle panel, MTLP take-off and landing panel, AB6 base and MH16 grip: no public list gives their product ids. They are told apart by name instead (`MOZA MTP Throttle Panel`, `MOZA MTLP Take-off Landing Pane`, `MOZA AB9 FFB Base` are the names DCS ships default profiles for). Any other Moza device stays racing.
- Thrustmaster T818, T-GT II, TCA Officer Pack throttle variants and the T-LCM Pro: no reliable id found (a forum post says the T818 reports the T248's id; not used). They fall back to no family, so a new setup keeps them whatever the game, and their names still give the right picture.
- Turtle Beach VelocityOne Rudder and VelocityOne Flight (yoke): ids not listed. No family; the name gives the picture.
- Leo Bodnar boards, Heusinkveld and Fanatec product by product: the vendor rule covers the last two.

## Names

The name rules give a picture and a word, not a family. They follow what the devices call themselves (DirectInput product names, as in the DCS profile names and the lhw listing): "TCA Sidestick Airbus", "T.A320 Pilot", "TCA YOKE BOEING", "TCA Q-Eng 1&2", "MOZA AB9 FFB Base". The MTLP's name is cut to "Landing Pane" by DirectInput's 32-character limit, so it is matched by "MTLP". "Simagic Alpha" is a wheel base, so the wheel rule (which knows Simagic) comes before the stick rule (which knows Virpil's Alpha grip). Yokes have their own kind in the rig strip; the share picture, which has fewer pictures, draws a yoke as a stick.
