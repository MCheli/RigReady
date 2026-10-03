/**
 * The parts of a monitor's EDID block RigReady uses to tell monitors apart: the serial
 * number, and the model name as a fallback for the name Windows reports.
 *
 * An EDID base block is 128 bytes. Bytes 12..15 hold a 32-bit serial number; four
 * 18-byte descriptors start at byte 54, and a descriptor tagged 0xFF holds the serial as
 * text (what is printed on the monitor's label), one tagged 0xFC the model name.
 */
export interface EdidIdentity {
  /** The text serial when there is one, else the numeric one. Absent when both are empty or zero. */
  serial?: string;
  name?: string;
}

const DESCRIPTORS = [54, 72, 90, 108];

function descriptorText(bytes: Uint8Array, start: number): string {
  let text = '';
  for (let i = start + 5; i < start + 18; i++) {
    const code = bytes[i]!;
    if (code === 0x0a || code === 0) break;
    text += String.fromCharCode(code);
  }
  return text.trim();
}

/** Parses an EDID block given as bytes or as a hex string (as the registry port returns binary values). */
export function parseEdid(edid: Uint8Array | string): EdidIdentity {
  const bytes =
    typeof edid === 'string'
      ? Uint8Array.from((edid.match(/[0-9a-f]{2}/gi) ?? []).map((pair) => parseInt(pair, 16)))
      : edid;
  const identity: EdidIdentity = {};
  if (bytes.length < 128) return identity;
  // Every EDID starts with 00 FF FF FF FF FF FF 00.
  const header = [0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0];
  if (!header.every((value, index) => bytes[index] === value)) return identity;
  let textSerial = '';
  for (const start of DESCRIPTORS) {
    // A display descriptor (not a timing) starts with 00 00 00 <tag>.
    if (bytes[start] !== 0 || bytes[start + 1] !== 0 || bytes[start + 2] !== 0) continue;
    const tag = bytes[start + 3];
    if (tag === 0xff) textSerial = descriptorText(bytes, start);
    else if (tag === 0xfc) identity.name = descriptorText(bytes, start);
  }
  const numeric = (bytes[12]! | (bytes[13]! << 8) | (bytes[14]! << 16) | (bytes[15]! << 24)) >>> 0;
  // Panels without a real serial report 0 (or text that is all zeros): that identifies nothing.
  if (textSerial && !/^0+$/.test(textSerial)) identity.serial = textSerial;
  else if (numeric !== 0) identity.serial = String(numeric);
  if (!identity.name) delete identity.name;
  return identity;
}

/** DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY as a word a user knows. */
export function connectorName(outputTechnology: number): string {
  switch (outputTechnology >>> 0) {
    case 0:
      return 'VGA';
    case 4:
      return 'DVI';
    case 5:
      return 'HDMI';
    case 6:
      return 'LVDS';
    case 10:
    case 11:
    case 12:
    case 13:
      return 'DisplayPort';
    case 15:
      return 'Wireless';
    case 16:
    case 17:
      // "Indirect" displays: a USB graphics adapter (DisplayLink) or a virtual one.
      return 'USB';
    case 0x80000000:
      return 'Internal';
    default:
      return 'Other';
  }
}

/** `\\?\display#reg0319#a&2c1ac5a9&0&uid256#{...}` to the device instance id `DISPLAY\REG0319\A&2C1AC5A9&0&UID256`. */
export function monitorInstanceId(devicePath: string): string | undefined {
  const parts = devicePath.replace(/^\\\\\?\\/, '').split('#');
  if (parts.length < 3 || parts[0]!.toLowerCase() !== 'display') return undefined;
  return `DISPLAY\\${parts[1]!.toUpperCase()}\\${parts[2]!.toUpperCase()}`;
}

/** The USB device an instance id names, when it is one with a real serial number. */
export function usbIdentity(instanceId: string): { usbId: string; usbSerial: string } | undefined {
  const match = /^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})\\([^\\]+)$/i.exec(instanceId);
  if (!match) return undefined;
  const [, vid, pid, suffix] = match;
  // Windows invents suffixes containing '&' when the device reports no serial number.
  if (suffix!.includes('&')) return undefined;
  return { usbId: `${vid!.toUpperCase()}:${pid!.toUpperCase()}`, usbSerial: suffix! };
}
