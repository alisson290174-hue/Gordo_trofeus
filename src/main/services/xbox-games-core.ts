import { createHash } from "node:crypto";

const CROCKFORD_BASE32 = "0123456789abcdefghjkmnpqrstvwxyz";

/** The 13-character publisher id Windows appends to a package name ("…_n746a19ndrrjg"). */
export const computePublisherId = (publisher: string) => {
  const digest = createHash("sha256")
    .update(Buffer.from(publisher, "utf16le"))
    .digest();
  // First 8 bytes as 64 bits, padded with one zero bit to 65 bits = 13 groups of 5.
  let bits = "";
  for (const byte of digest.subarray(0, 8)) {
    bits += byte.toString(2).padStart(8, "0");
  }
  bits += "0";
  let id = "";
  for (let index = 0; index < bits.length; index += 5) {
    id += CROCKFORD_BASE32[Number.parseInt(bits.slice(index, index + 5), 2)];
  }
  return id;
};

const decodeXml = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/** "Name_publisherId!AppId" from an appxmanifest.xml, or null when it isn't a store package. */
export const parseAppUserModelId = (manifestXml: string) => {
  const identity = /<Identity\b([^>]*)>/i.exec(manifestXml)?.[1] ?? "";
  const name = /\bName="([^"]+)"/i.exec(identity)?.[1];
  const publisher = /\bPublisher="([^"]+)"/i.exec(identity)?.[1];
  const appId = /<Application\b[^>]*\bId="([^"]+)"/i.exec(manifestXml)?.[1];
  if (!name || !publisher || !appId) return null;
  return `${name}_${computePublisherId(decodeXml(publisher))}!${appId}`;
};

export interface XboxGameConfig {
  identityName: string;
  executable: string;
  displayName: string | null;
}

/** Name, main PC executable and display name from a MicrosoftGame.config. */
export const parseMicrosoftGameConfig = (
  xml: string
): XboxGameConfig | null => {
  const identityName = /<Identity\b[^>]*\bName="([^"]+)"/i.exec(xml)?.[1];
  const executables = [...xml.matchAll(/<Executable\b([^>]*)>/gi)].map(
    (match) => match[1]
  );
  const pcExecutable =
    executables.find((attributes) =>
      /TargetDeviceFamily="PC"/i.test(attributes)
    ) ?? executables[0];
  const executable = pcExecutable
    ? /\bName="([^"]+)"/i.exec(pcExecutable)?.[1]
    : undefined;
  if (!identityName || !executable) return null;
  const displayName =
    /<ShellVisuals\b[^>]*\bDefaultDisplayName="([^"]+)"/i.exec(xml)?.[1] ??
    null;
  return {
    identityName: decodeXml(identityName),
    executable: decodeXml(executable).replaceAll("/", "\\"),
    displayName:
      displayName && !displayName.startsWith("ms-resource:")
        ? decodeXml(displayName)
        : null,
  };
};
