import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyQtPadBindings,
  applySdlPadBindings,
  azaharBindings,
  parseXInputHardwareId,
  sdlGuidForXInput,
  setQtIniValue,
  shouldWriteDolphinPad,
  shouldWriteRpcs3Input,
} from "./controller-autoconfig-rules";

describe("controller autoconfig", () => {
  it("builds the SDL GUID Eden itself stores for an XInput pad", () => {
    // Eden wrote this GUID for the 8BitDo pad (USB\VID_2DC8&PID_310B&REV_0114) in XInput mode.
    assert.equal(sdlGuidForXInput("2DC8", "310B", "0114"), "03000000c82d00000b31000014017801");
    assert.deepEqual(parseXInputHardwareId("USB\\VID_2DC8&PID_310B&REV_0114&MI_00"), {
      guid: "03000000c82d00000b31000014017801",
      vendorId: "2dc8",
      productId: "310b",
    });
    assert.equal(parseXInputHardwareId("USB\\VID_2DC8&PID_310B&MI_00"), null);
  });

  it("maps DuckStation/PCSX2 pad 1 only when it's still on the keyboard", () => {
    const keyboard = "[Pad1]\nCross = Keyboard/K\nType = AnalogController\n\n[InputSources]\nSDL = false\n";
    const mapped = applySdlPadBindings(keyboard, { Type: "AnalogController", Cross: "SDL-0/A" });
    assert.match(mapped, /Cross = SDL-0\/A/);
    assert.match(mapped, /\[InputSources\][\s\S]*SDL = true/);

    const userPad = "[Pad1]\nCross = SDL-0/B\n";
    assert.equal(applySdlPadBindings(userPad, { Cross: "SDL-0/A" }), userPad);
  });

  it("writes RPCS3 input only over a keyboard or missing player 1", () => {
    assert.equal(shouldWriteRpcs3Input(null), true);
    assert.equal(shouldWriteRpcs3Input("Player 1 Input:\n  Handler: Keyboard\n"), true);
    assert.equal(shouldWriteRpcs3Input("Player 1 Input:\n  Handler: DualSense\n"), false);
  });

  it("writes Dolphin pads only over a keyboard or missing profile", () => {
    assert.equal(shouldWriteDolphinPad(null), true);
    assert.equal(shouldWriteDolphinPad("[GCPad1]\nDevice = DInput/0/Keyboard Mouse\n"), true);
    assert.equal(shouldWriteDolphinPad("[GCPad1]\nDevice = SDL/0/DualSense\n"), false);
  });

  it("edits Qt ini keys with their \\default flag and keeps existing controller bindings", () => {
    const base = "[UI]\ntheme=dark\n\n[Controls]\nprofiles\\1\\button_a\\default=true\nprofiles\\1\\button_a=\"code:65,engine:keyboard\"\n";
    const next = setQtIniValue(base, "Controls", "profiles\\1\\button_a", '"engine:sdl,button:0"');
    assert.match(next, /profiles\\1\\button_a\\default=false/);
    assert.match(next, /profiles\\1\\button_a="engine:sdl,button:0"/);
    assert.match(next, /\[UI\]\ntheme=dark/);

    const guid = "03000000c82d00000b31000014017801";
    const bindings = Object.fromEntries(
      Object.entries(azaharBindings(guid)).map(([key, value]) => [`profiles\\1\\${key}`, value])
    );
    const configured = applyQtPadBindings(base, "Controls", "profiles\\1\\button_a", bindings);
    assert.match(configured, /profiles\\1\\circle_pad="engine:sdl,guid:03000000c82d00000b31000014017801,port:0,axis_x:0,axis_y:1/);
    // Already on a controller: untouched.
    assert.equal(applyQtPadBindings(configured, "Controls", "profiles\\1\\button_a", bindings), configured);
  });

  it("creates the section in an empty Qt ini", () => {
    assert.equal(
      setQtIniValue("", "Controls", "player_0_connected", "true"),
      "[Controls]\nplayer_0_connected\\default=false\nplayer_0_connected=true"
    );
  });
});
