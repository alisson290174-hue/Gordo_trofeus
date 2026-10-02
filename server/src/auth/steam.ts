import openid from "openid";
const { RelyingParty } = openid;
import { config } from "../config.js";

// Discovery identifier for Steam's OpenID provider — NOT the login endpoint itself.
// The "openid" library resolves this to the real provider URL internally.
const STEAM_OPENID_PROVIDER = "https://steamcommunity.com/openid";
const RETURN_URL = `${config.publicBaseUrl}/auth/steam/return`;

const relyingParty = new RelyingParty(
  RETURN_URL,
  config.publicBaseUrl,
  true, // stateless
  false, // strict
  []
);

export function getSteamAuthUrl(): Promise<string> {
  return new Promise((resolve, reject) => {
    relyingParty.authenticate(STEAM_OPENID_PROVIDER, false, (error, authUrl) => {
      if (error || !authUrl) return reject(error ?? new Error("No auth URL returned by Steam"));
      resolve(authUrl);
    });
  });
}

export function verifySteamAssertion(
  fullReturnUrl: string
): Promise<{ authenticated: boolean; claimedIdentifier?: string }> {
  return new Promise((resolve, reject) => {
    relyingParty.verifyAssertion(fullReturnUrl, (error, result) => {
      if (error) return reject(error);
      resolve({
        authenticated: Boolean(result?.authenticated),
        claimedIdentifier: result?.claimedIdentifier,
      });
    });
  });
}

/** claimedIdentifier looks like "https://steamcommunity.com/openid/id/76561198..." */
export function extractSteamId64(claimedIdentifier: string): string | null {
  const match = claimedIdentifier.match(/\/openid\/id\/(\d{17})$/);
  return match ? match[1] : null;
}

export interface SteamPersona {
  personaName: string;
  avatarFull: string;
}

export async function fetchSteamPersona(steamId64: string): Promise<SteamPersona | null> {
  const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/");
  url.searchParams.set("key", config.steamApiKey);
  url.searchParams.set("steamids", steamId64);

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) return null;

  const data = (await response.json()) as {
    response?: { players?: { personaname: string; avatarfull: string }[] };
  };
  const player = data.response?.players?.[0];
  if (!player) return null;

  return { personaName: player.personaname, avatarFull: player.avatarfull };
}
