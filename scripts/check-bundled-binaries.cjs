/**
 * electron-builder beforePack: refuse to package an installer without the binaries the app needs.
 * The native addon and Ludusavi are gitignored build outputs, so they silently went missing from
 * every release up to v1.0.14 (no torrent downloads, cloud save or process detection).
 *
 * Third-party binaries we did not build are pinned by SHA-256.
 *   - native addon:  node scripts/build-native-addon.cjs   (needs Rust + VS Build Tools)
 *   - Ludusavi:      official GitHub release v0.29.0 (win64 zip, 11 398 107 bytes)
 *   - Legendary:     binaries/legendary (also verified at runtime)
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..");

const REQUIRED = [
  { file: "hydra-native/hydra-native.node", hint: "node scripts/build-native-addon.cjs" },
  { file: "hydra-native/hydra_torrent_bridge.dll", hint: "node scripts/build-native-addon.cjs" },
  { file: "hydra-native/vcruntime140.dll", hint: "node scripts/build-native-addon.cjs" },
  {
    file: "ludusavi/ludusavi.exe",
    sha256: "6ec719bc8efc181de2e13f7823a902f66e8ee35c0e317f24dd10336811b491e5",
    hint: "extract ludusavi-v0.29.0-win64.zip from github.com/mtkennerly/ludusavi into ludusavi/",
  },
  {
    file: "binaries/legendary/legendary.exe",
    sha256: "6be77857dc0a6dd33ea7442ce8b5291944ec6da53757f81ca95b57ce794baf5b",
    hint: "Legendary 0.21.1 from github.com/legendary-gl/legendary",
  },
];

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

exports.default = async function checkBundledBinaries(context) {
  if (context?.electronPlatformName && context.electronPlatformName !== "win32") return;

  const problems = [];
  for (const { file, sha256: expected, hint } of REQUIRED) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) {
      problems.push(`missing ${file} → ${hint}`);
    } else if (expected && sha256(full) !== expected) {
      problems.push(`unexpected SHA-256 for ${file} → ${hint}`);
    }
  }

  if (problems.length) {
    throw new Error(`Bundled binaries check failed:\n  - ${problems.join("\n  - ")}`);
  }
  console.log("  • bundled binaries OK (native addon, torrent bridge, Ludusavi, Legendary)");
};

if (require.main === module) {
  exports.default().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
