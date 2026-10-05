import type { ShopAssets } from "@types";
import showcaseList from "@renderer/assets/showcase/showcase.json";

/**
 * Vitrine embutida: ~100 jogos famosos com capa, cabeçalho, fundo e logo dentro do app,
 * pra Início/Catálogo aparecerem na hora (sem esperar o servidor nem a CDN da Steam).
 * Fonte das imagens: Steam CDN, reduzidas e convertidas pra WebP.
 */
export type ShowcaseArtKind = "cover" | "header" | "hero" | "logo";

const artModules = import.meta.glob("../assets/showcase/*.webp", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const ART = new Map<string, Partial<Record<ShowcaseArtKind, string>>>();
for (const path in artModules) {
  const match = path.match(/(\d+)-(cover|header|hero|logo)\.webp$/);
  if (!match) continue;
  const [, objectId, kind] = match;
  const entry = ART.get(objectId) ?? {};
  // Absolute URL so resolveImageSource() doesn't mistake "/src/assets/…" (dev) for a disk path.
  entry[kind as ShowcaseArtKind] = new URL(
    artModules[path],
    window.location.href
  ).href;
  ART.set(objectId, entry);
}

export const getShowcaseArt = (
  game: { shop: string; objectId: string },
  kind: ShowcaseArtKind
): string | null =>
  game.shop === "steam" ? (ART.get(game.objectId)?.[kind] ?? null) : null;

export const SHOWCASE_GAMES: ShopAssets[] = (
  showcaseList as { objectId: string; title: string }[]
).map(({ objectId, title }) => {
  const art = ART.get(objectId) ?? {};
  return {
    objectId,
    shop: "steam",
    title,
    iconUrl: null,
    libraryHeroImageUrl: art.hero ?? null,
    libraryImageUrl: art.cover ?? null,
    logoImageUrl: art.logo ?? null,
    logoPosition: null,
    coverImageUrl: art.cover ?? null,
    downloadSources: [],
  };
});

/** Deterministic-per-session shuffle so "Em alta" and "Mais baixados" differ but don't reshuffle on every render. */
export function pickShowcase(count: number, seed: number): ShopAssets[] {
  const array = [...SHOWCASE_GAMES];
  let state = seed || 1;
  for (let i = array.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array.slice(0, count);
}
