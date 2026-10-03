import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parsePs3UpdateList as parse } from "./ps3-update-list";

const SONY_LIST = `# US
Dest=84;CompatibleSystemSoftwareVersion=4.9300-;
Dest=84;IncrementalUpdateVersion=00010b72-00010b72;ImageVersion=00010b94;SystemSoftwareVersion=4.9300;CDN=http://dus01.ps3.update.playstation.net/update/ps3/image/us/2026_0318_a2b60b6ac1d2e49e230144345616927c/PS3PATCH.PUP;CDN_Timeout=30;
Dest=84;ImageVersion=00010b94;SystemSoftwareVersion=4.9300;CDN=http://dus01.ps3.update.playstation.net/update/ps3/image/us/2026_0318_c0ffee00c0ffee00c0ffee00c0ffee00/PS3UPDAT.PUP;CDN_Timeout=30;`;

describe("PS3 update list", () => {
  it("picks the full image (not the incremental patch) and its MD5 from the path", () => {
    assert.deepEqual(parse(SONY_LIST), {
      url: "http://dus01.ps3.update.playstation.net/update/ps3/image/us/2026_0318_c0ffee00c0ffee00c0ffee00c0ffee00/PS3UPDAT.PUP",
      md5: "c0ffee00c0ffee00c0ffee00c0ffee00",
    });
  });

  it("ignores firmware URLs on any other host", () => {
    assert.equal(
      parse("CDN=http://evil.example/update/ps3/image/us/2026_0318_c0ffee00c0ffee00c0ffee00c0ffee00/PS3UPDAT.PUP;"),
      null
    );
  });
});
