import { getOrCacheSteamGame, type SteamGameRow } from "./steam-lookup.js";

/**
 * Hand-picked list of well-known games for the home "Populares"/"Mais baixados" rails.
 *
 * Steam's own `featuredcategories` top-sellers are full of coming-soon/announced titles that have
 * no library art yet, which made the home page look like a wall of placeholders. This curated pool
 * is instead all released, recognizable games whose `library_600x900.jpg` is confirmed to exist,
 * so every card shows a real cover. Add appids here to grow the rail — verify the cover exists
 * (https://cdn.cloudflare.steamstatic.com/steam/apps/<appid>/library_600x900.jpg → 200) first.
 */
const POPULAR_APPIDS: number[] = [
  // Rockstar / open world
  1174180, // Red Dead Redemption 2
  271590, // Grand Theft Auto V
  // CD Projekt
  292030, // The Witcher 3: Wild Hunt
  1091500, // Cyberpunk 2077
  // FromSoftware
  1245620, // ELDEN RING
  2622380, // ELDEN RING NIGHTREIGN
  814380, // Sekiro
  374320, // Dark Souls III
  1627720, // Lies of P
  1325200, // Nioh 2
  // Sony PC ports
  1593500, // God of War
  2322010, // God of War Ragnarök
  1817070, // Marvel's Spider-Man Remastered
  1817190, // Spider-Man: Miles Morales
  2215430, // Ghost of Tsushima
  1151640, // Horizon Zero Dawn
  2420110, // Horizon Forbidden West
  1190460, // Death Stranding
  1259420, // Days Gone
  // Ubisoft — Assassin's Creed
  2208920, // AC Valhalla
  812140, // AC Odyssey
  582160, // AC Origins
  // Square Enix — Final Fantasy
  1462040, // FF VII Remake Intergrade
  2909400, // FF VII Rebirth
  2515020, // FF XVI
  637650, // FF XV
  524220, // NieR: Automata
  1687950, // Persona 5 Royal
  // Capcom
  2050650, // Resident Evil 4 (Remake)
  1196590, // Resident Evil Village
  883710, // Resident Evil 2 (Remake)
  418370, // Resident Evil 7
  582010, // Monster Hunter: World
  1446780, // Monster Hunter Rise
  601150, // Devil May Cry 5
  1364780, // Street Fighter 6
  // Recent big hits
  1562430, // Dredge
  990080, // Hogwarts Legacy
  1086940, // Baldur's Gate 3
  2358720, // Black Myth: Wukong
  1623730, // Palworld
  553850, // Helldivers 2
  1426210, // It Takes Two
  2138710, // Sifu
  1778820, // Tekken 8
  // Bethesda / id
  489830, // Skyrim Special Edition
  377160, // Fallout 4
  782330, // DOOM Eternal
  // Survival / co-op / multiplayer
  892970, // Valheim
  264710, // Subnautica
  534380, // Dying Light 2
  1326470, // Sons of the Forest
  252490, // Rust
  381210, // Dead by Daylight
  739630, // Phasmophobia
  // Indies / evergreen
  367520, // Hollow Knight
  1030300, // Hollow Knight: Silksong
  1145360, // Hades
  1145350, // Hades II
  413150, // Stardew Valley
  105600, // Terraria
  268910, // Cuphead
  504230, // Celeste
  620, // Portal 2
  870780, // Control
  632470, // Disco Elysium
  323190, // Frostpunk
  294100, // RimWorld
  427520, // Factorio
  976310, // Mortal Kombat 11
  1551360, // Forza Horizon 5
  1139900, // Ghostrunner
];

function shuffled<T>(source: readonly T[]): T[] {
  const array = [...source];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/** Resolves appids to real cached rows, fetching any the background sync hasn't reached yet. Only
 * returns games that resolved successfully (and therefore have cover art from the curated list). */
async function resolveGames(appids: number[], take: number): Promise<SteamGameRow[]> {
  const games: SteamGameRow[] = [];
  for (const appid of appids) {
    if (games.length >= take) break;
    const game = await getOrCacheSteamGame(appid);
    if (game) games.push(game);
  }
  return games;
}

/** "Populares" — a fresh shuffle of the curated pool each call, so the rail feels alive. */
export async function getCuratedTopSellers(take: number): Promise<SteamGameRow[]> {
  return resolveGames(shuffled(POPULAR_APPIDS), take);
}

/** "Mais baixados da semana" — a different shuffle of the same curated pool of known games. */
export async function getCuratedNewReleases(take: number): Promise<SteamGameRow[]> {
  return resolveGames(shuffled(POPULAR_APPIDS), take);
}
