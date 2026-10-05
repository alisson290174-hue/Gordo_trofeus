import { getIniLine, setIniValue } from "./duckstation-souvenir-config-value";

/**
 * Pure rules behind the controller autoconfig (GUIDs, bindings, "is this already mapped?"),
 * kept free of Electron/logger imports so they can be unit-tested.
 */

export interface XInputPad {
  /** SDL GUID as Eden/Azahar store it, e.g. "03000000c82d00000b31000014017801". */
  guid: string;
  vendorId: string;
  productId: string;
}

const le16 = (hex: string) => hex.slice(2, 4) + hex.slice(0, 2);

/** SDL's GUID for a pad driven through XInput: USB bus, VID, PID, revision, then 'x' + 0x01. */
export const sdlGuidForXInput = (
  vendorId: string,
  productId: string,
  revision: string
) =>
  `03000000${le16(vendorId)}0000${le16(productId)}0000${le16(revision)}7801`.toLowerCase();

/** "USB\VID_2DC8&PID_310B&REV_0114&MI_00" → the pad's GUID. */
export const parseXInputHardwareId = (hardwareId: string): XInputPad | null => {
  const match = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})&REV_([0-9A-F]{4})/i.exec(
    hardwareId
  );
  if (!match) return null;
  const [, vendorId, productId, revision] = match;
  return {
    guid: sdlGuidForXInput(vendorId, productId, revision),
    vendorId: vendorId.toLowerCase(),
    productId: productId.toLowerCase(),
  };
};

// ---- DuckStation / PCSX2 (SDL pad index 0) ----

export const DUCKSTATION_PAD: Record<string, string> = {
  Type: "AnalogController",
  Up: "SDL-0/DPadUp",
  Right: "SDL-0/DPadRight",
  Down: "SDL-0/DPadDown",
  Left: "SDL-0/DPadLeft",
  Triangle: "SDL-0/Y",
  Circle: "SDL-0/B",
  Cross: "SDL-0/A",
  Square: "SDL-0/X",
  Select: "SDL-0/Back",
  Start: "SDL-0/Start",
  L1: "SDL-0/LeftShoulder",
  R1: "SDL-0/RightShoulder",
  L2: "SDL-0/+LeftTrigger",
  R2: "SDL-0/+RightTrigger",
  L3: "SDL-0/LeftStick",
  R3: "SDL-0/RightStick",
  LLeft: "SDL-0/-LeftX",
  LRight: "SDL-0/+LeftX",
  LDown: "SDL-0/+LeftY",
  LUp: "SDL-0/-LeftY",
  RLeft: "SDL-0/-RightX",
  RRight: "SDL-0/+RightX",
  RDown: "SDL-0/+RightY",
  RUp: "SDL-0/-RightY",
  SmallMotor: "SDL-0/SmallMotor",
  LargeMotor: "SDL-0/LargeMotor",
};

export const PCSX2_PAD: Record<string, string> = {
  Type: "DualShock2",
  Up: "SDL-0/DPadUp",
  Right: "SDL-0/DPadRight",
  Down: "SDL-0/DPadDown",
  Left: "SDL-0/DPadLeft",
  Triangle: "SDL-0/FaceNorth",
  Circle: "SDL-0/FaceEast",
  Cross: "SDL-0/FaceSouth",
  Square: "SDL-0/FaceWest",
  Select: "SDL-0/Back",
  Start: "SDL-0/Start",
  L1: "SDL-0/LeftShoulder",
  L2: "SDL-0/+LeftTrigger",
  R1: "SDL-0/RightShoulder",
  R2: "SDL-0/+RightTrigger",
  L3: "SDL-0/LeftStick",
  R3: "SDL-0/RightStick",
  LUp: "SDL-0/-LeftY",
  LRight: "SDL-0/+LeftX",
  LDown: "SDL-0/+LeftY",
  LLeft: "SDL-0/-LeftX",
  RUp: "SDL-0/-RightY",
  RRight: "SDL-0/+RightX",
  RDown: "SDL-0/+RightY",
  RLeft: "SDL-0/-RightX",
  Analog: "SDL-0/Guide",
  LargeMotor: "SDL-0/LargeMotor",
  SmallMotor: "SDL-0/SmallMotor",
};

/** True when a pad section already points at a controller (anything but the keyboard). */
const padSectionUsesController = (
  content: string,
  section: string,
  keys: string[]
) =>
  keys.some((key) => {
    const line = getIniLine(content, section, key);
    return line !== null && /=\s*(SDL|XInput|DInput)-/i.test(line);
  });

/** Pure: binds Pad1 to the first SDL controller unless a controller is already mapped. */
export const applySdlPadBindings = (
  content: string,
  bindings: Record<string, string>
): string => {
  const keys = Object.keys(bindings).filter((key) => key !== "Type");
  if (padSectionUsesController(content, "Pad1", keys)) return content;
  let next = content;
  for (const [key, value] of Object.entries(bindings))
    next = setIniValue(next, "Pad1", key, value);
  next = setIniValue(next, "InputSources", "SDL", "true");
  return next;
};

/**
 * XInput flavour of an SDL pad map: Windows numbers Xbox-class pads 0-3 in plug order and never
 * shuffles them, while SDL indexes move whenever another HID device is present (a pad bound to
 * "SDL-2" silently stops working). PCSX2's SDL face names become XInput's A/B/X/Y.
 */
const XINPUT_FACE: Record<string, string> = {
  FaceSouth: "A",
  FaceEast: "B",
  FaceWest: "X",
  FaceNorth: "Y",
};

export const toXInputBindings = (
  bindings: Record<string, string>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(bindings).map(([key, value]) => [
      key,
      value.replace(
        /^SDL-0\/(.+)$/,
        (_m, name: string) => `XInput-0/${XINPUT_FACE[name] ?? name}`
      ),
    ])
  );

/**
 * Pure: binds Pad1 to XInput pad 0. Rewrites keyboard / empty maps and SDL maps (whose index
 * drifts); a map already on XInput is the user's and stays.
 */
export const applyXInputPadBindings = (
  content: string,
  sdlBindings: Record<string, string>
): string => {
  const bindings = toXInputBindings(sdlBindings);
  const keys = Object.keys(bindings).filter((key) => key !== "Type");
  const alreadyXInput = keys.some((key) => {
    const line = getIniLine(content, "Pad1", key);
    return line !== null && /=\s*XInput-/i.test(line);
  });
  if (alreadyXInput) return content;
  let next = content;
  for (const [key, value] of Object.entries(bindings))
    next = setIniValue(next, "Pad1", key, value);
  next = setIniValue(next, "InputSources", "XInput", "true");
  return next;
};

// ---- RPCS3 ----

export const RPCS3_XINPUT_PLAYER1 = `Player 1 Input:
  Handler: XInput
  Device: XInput Pad #1
  Config:
    Left Stick Left: LS X-
    Left Stick Down: LS Y-
    Left Stick Right: LS X+
    Left Stick Up: LS Y+
    Right Stick Left: RS X-
    Right Stick Down: RS Y-
    Right Stick Right: RS X+
    Right Stick Up: RS Y+
    Start: Start
    Select: Back
    PS Button: Guide
    Square: X
    Cross: A
    Circle: B
    Triangle: Y
    Left: Left
    Down: Down
    Right: Right
    Up: Up
    R1: RB
    R2: RT
    R3: RS
    L1: LB
    L2: LT
    L3: LS
    Enable Vibration: true
  Buddy Device: ""
`;

/** Pure: an RPCS3 input file whose player 1 is the keyboard (or missing) gets the Xbox pad. */
export const shouldWriteRpcs3Input = (content: string | null) => {
  if (!content) return true;
  const handler = /Player 1 Input:\s*\n\s*Handler:\s*"?([^"\n]+)"?/
    .exec(content)?.[1]
    ?.trim();
  return !handler || handler === "Keyboard" || handler === "Null";
};

// ---- Dolphin ----

export const DOLPHIN_GCPAD = `[GCPad1]
Device = XInput/0/Gamepad
Buttons/A = \`Button A\`
Buttons/B = \`Button B\`
Buttons/X = \`Button X\`
Buttons/Y = \`Button Y\`
Buttons/Z = \`Shoulder R\`
Buttons/Start = Start
Main Stick/Up = \`Left Y+\`
Main Stick/Down = \`Left Y-\`
Main Stick/Left = \`Left X-\`
Main Stick/Right = \`Left X+\`
Main Stick/Calibration = 100.00 141.42 100.00 141.42 100.00 141.42 100.00 141.42
C-Stick/Up = \`Right Y+\`
C-Stick/Down = \`Right Y-\`
C-Stick/Left = \`Right X-\`
C-Stick/Right = \`Right X+\`
C-Stick/Calibration = 100.00 141.42 100.00 141.42 100.00 141.42 100.00 141.42
Triggers/L = \`Trigger L\`
Triggers/R = \`Trigger R\`
Triggers/L-Analog = \`Trigger L\`
Triggers/R-Analog = \`Trigger R\`
D-Pad/Up = \`Pad N\`
D-Pad/Down = \`Pad S\`
D-Pad/Left = \`Pad W\`
D-Pad/Right = \`Pad E\`
Rumble/Motor = \`Motor L\`|\`Motor R\`
`;

export const DOLPHIN_WIIMOTE = `[Wiimote1]
Source = 1
Device = XInput/0/Gamepad
Buttons/A = \`Button A\`
Buttons/B = \`Trigger R\`
Buttons/1 = \`Button X\`
Buttons/2 = \`Button Y\`
Buttons/- = Back
Buttons/+ = Start
Buttons/Home = Guide
D-Pad/Up = \`Pad N\`
D-Pad/Down = \`Pad S\`
D-Pad/Left = \`Pad W\`
D-Pad/Right = \`Pad E\`
IR/Up = \`Right Y+\`
IR/Down = \`Right Y-\`
IR/Left = \`Right X-\`
IR/Right = \`Right X+\`
Shake/X = \`Button B\`
Shake/Y = \`Button B\`
Shake/Z = \`Button B\`
Extension = Nunchuk
Nunchuk/Buttons/C = \`Shoulder L\`
Nunchuk/Buttons/Z = \`Trigger L\`
Nunchuk/Stick/Up = \`Left Y+\`
Nunchuk/Stick/Down = \`Left Y-\`
Nunchuk/Stick/Left = \`Left X-\`
Nunchuk/Stick/Right = \`Left X+\`
Rumble/Motor = \`Motor L\`|\`Motor R\`
`;

/** Pure: a Dolphin pad profile is replaced only when it's missing or bound to the keyboard. */
export const shouldWriteDolphinPad = (content: string | null) => {
  if (!content) return true;
  const device = /^\s*Device\s*=\s*(.+)$/m.exec(content)?.[1]?.trim() ?? "";
  return device === "" || /Keyboard/i.test(device);
};

// ---- Azahar / Eden ----

/** Qt ini "key=value" (no spaces), with the matching "key\default=false" Qt writes alongside. */
export const setQtIniValue = (
  content: string,
  section: string,
  key: string,
  value: string
) => {
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  let start = lines.findIndex((line) => line.trim() === `[${section}]`);
  if (start === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "")
      lines.push("");
    lines.push(`[${section}]`);
    start = lines.length - 1;
  }
  let end = lines.findIndex(
    (line, index) => index > start && line.trim().startsWith("[")
  );
  if (end === -1) end = lines.length;

  const upsert = (name: string, val: string) => {
    for (let index = start + 1; index < end; index += 1) {
      if (lines[index].startsWith(`${name}=`)) {
        lines[index] = `${name}=${val}`;
        return;
      }
    }
    lines.splice(end, 0, `${name}=${val}`);
    end += 1;
  };
  upsert(`${key}\\default`, "false");
  upsert(key, value);
  return lines.join("\n");
};

const getQtIniValue = (content: string, key: string) =>
  content
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${key}=`))
    ?.slice(key.length + 1) ?? null;

const sdl = (guid: string, params: string) =>
  `"engine:sdl,guid:${guid},port:0,${params}"`;

/** 3DS buttons on the Xbox layout (A=A, B=B, …), as Azahar's "profiles\1" entries. */
export const azaharBindings = (guid: string): Record<string, string> => ({
  button_a: sdl(guid, "button:0"),
  button_b: sdl(guid, "button:1"),
  button_x: sdl(guid, "button:2"),
  button_y: sdl(guid, "button:3"),
  button_l: sdl(guid, "button:4"),
  button_r: sdl(guid, "button:5"),
  button_select: sdl(guid, "button:6"),
  button_start: sdl(guid, "button:7"),
  button_home: sdl(guid, "button:10"),
  button_zl: sdl(guid, "axis:2,direction:+,threshold:0.5"),
  button_zr: sdl(guid, "axis:5,direction:+,threshold:0.5"),
  button_up: sdl(guid, "hat:0,direction:up"),
  button_down: sdl(guid, "hat:0,direction:down"),
  button_left: sdl(guid, "hat:0,direction:left"),
  button_right: sdl(guid, "hat:0,direction:right"),
  circle_pad: sdl(guid, "axis_x:0,axis_y:1,deadzone:0.100000"),
  c_stick: sdl(guid, "axis_x:3,axis_y:4,deadzone:0.100000"),
});

/** Switch buttons on the same layout Eden's own auto-map produces for an XInput pad. */
export const edenBindings = (guid: string): Record<string, string> => ({
  player_0_button_a: sdl(guid, "pad:0,button:0"),
  player_0_button_b: sdl(guid, "pad:0,button:1"),
  player_0_button_x: sdl(guid, "pad:0,button:2"),
  player_0_button_y: sdl(guid, "pad:0,button:3"),
  player_0_button_l: sdl(guid, "pad:0,button:4"),
  player_0_button_r: sdl(guid, "pad:0,button:5"),
  player_0_button_minus: sdl(guid, "button:6"),
  player_0_button_plus: sdl(guid, "button:7"),
  player_0_button_lstick: sdl(guid, "button:8"),
  player_0_button_rstick: sdl(guid, "button:9"),
  player_0_button_home: sdl(guid, "button:10"),
  player_0_button_zl: sdl(guid, "pad:0,axis:2,threshold:0.500000"),
  player_0_button_zr: sdl(guid, "pad:0,axis:5,threshold:0.500000"),
  player_0_button_dup: sdl(guid, "hat:0,direction:up"),
  player_0_button_ddown: sdl(guid, "hat:0,direction:down"),
  player_0_button_dleft: sdl(guid, "hat:0,direction:left"),
  player_0_button_dright: sdl(guid, "hat:0,direction:right"),
  player_0_lstick: sdl(
    guid,
    "axis_x:0,axis_y:1,invert_x:+,invert_y:+,offset_x:-0.000000,offset_y:0.000000,deadzone:0.150000"
  ),
  player_0_rstick: sdl(
    guid,
    "axis_x:3,axis_y:4,invert_x:+,invert_y:+,offset_x:-0.000000,offset_y:0.000000,deadzone:0.150000"
  ),
  player_0_connected: "true",
});

/** Pure: Qt-ini emulators keep any controller binding; keyboard/missing ones get the pad. */
export const applyQtPadBindings = (
  content: string,
  section: string,
  probeKey: string,
  bindings: Record<string, string>
) => {
  const current = getQtIniValue(content, probeKey);
  if (current && /engine:sdl/.test(current)) return content;
  let next = content;
  for (const [key, value] of Object.entries(bindings))
    next = setQtIniValue(next, section, key, value);
  return next;
};
