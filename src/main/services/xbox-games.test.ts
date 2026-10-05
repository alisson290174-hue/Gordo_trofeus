import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePublisherId,
  parseAppUserModelId,
  parseMicrosoftGameConfig,
} from "./xbox-games-core";

describe("xbox games", () => {
  it("computes the package publisher id like Windows does", () => {
    // Real install (Dragon Quest XI S, Xbox app): 39EA002F.DQXISWW_n746a19ndrrjg.
    assert.equal(
      computePublisherId("CN=83076AC8-252A-4004-9255-A4A444BA69F5"),
      "n746a19ndrrjg"
    );
  });

  it("builds the AppUserModelId from an appxmanifest", () => {
    const manifest = `<?xml version="1.0"?>
<Package>
  <Identity Name="39EA002F.DQXISWW" Publisher="CN=83076AC8-252A-4004-9255-A4A444BA69F5" Version="1.0.7.0" ProcessorArchitecture="x64"/>
  <Applications>
    <Application Id="Game" Executable="GameLaunchHelper.exe" EntryPoint="Windows.FullTrustApplication"/>
  </Applications>
</Package>`;
    assert.equal(
      parseAppUserModelId(manifest),
      "39EA002F.DQXISWW_n746a19ndrrjg!Game"
    );
  });

  it("returns null for a manifest without an application", () => {
    assert.equal(
      parseAppUserModelId('<Identity Name="A" Publisher="CN=B"/>'),
      null
    );
  });
});

describe("MicrosoftGame.config", () => {
  it("reads the identity, the PC executable and the display name", () => {
    const config = `<Game configVersion="0">
  <Identity Name="39EA002F.DQXISWW" Publisher="CN=X" Version="1.0.7.0"/>
  <ExecutableList>
    <Executable Name="Game\\Binaries\\Win64\\DRAGON QUEST XI S.exe" TargetDeviceFamily="PC" Id="Game"/>
  </ExecutableList>
  <ShellVisuals DefaultDisplayName="DQXI_S_WW" PublisherDisplayName="SQUARE ENIX"/>
</Game>`;
    assert.deepEqual(parseMicrosoftGameConfig(config), {
      identityName: "39EA002F.DQXISWW",
      executable: String.raw`Game\Binaries\Win64\DRAGON QUEST XI S.exe`,
      displayName: "DQXI_S_WW",
    });
  });

  it("ignores resource-only display names", () => {
    const config = `<Identity Name="A.B"/><Executable Name="a.exe"/><ShellVisuals DefaultDisplayName="ms-resource:Name"/>`;
    assert.equal(parseMicrosoftGameConfig(config)?.displayName, null);
  });
});
