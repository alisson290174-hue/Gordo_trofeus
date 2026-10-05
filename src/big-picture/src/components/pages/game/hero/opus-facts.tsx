import type { LibraryGame, ShopDetailsWithAssets } from "@types";
import { getDisplayedPlayTimeInMilliseconds } from "@shared";
import { PlatformBadge } from "@renderer/components/platform-badge/platform-badge";
import {
  formatLastPlayed,
  formatPlayTime,
  tr,
} from "../../../../helpers/opus-text";

const hasTranslation = (game: LibraryGame) =>
  /\bPT-?BR\b/i.test(game.title) ||
  (game.discs ?? []).some((disc) => /\bPT-?BR\b/i.test(disc.fileName ?? ""));

/** Console · studio · year, shown above the title (approved Big Picture board 2). */
export function GameEyebrow({
  game,
  shopDetails,
}: Readonly<{ game: LibraryGame | null; shopDetails: ShopDetailsWithAssets }>) {
  const year = shopDetails.release_date?.date?.match(/\d{4}/)?.[0] ?? null;
  const studio = shopDetails.developers?.[0] ?? null;
  const meta = [studio, year].filter(Boolean).join(" · ");
  return (
    <div className="opus-game__eyebrow">
      <PlatformBadge
        game={
          game ?? { shop: shopDetails.assets?.shop ?? "steam", platform: null }
        }
        className="opus-game__badge"
      />
      {meta && <span>{meta}</span>}
    </div>
  );
}

/** Play time, trophies and language: the summary cards under the actions. Display only. */
export function GameFacts({ game }: Readonly<{ game: LibraryGame | null }>) {
  if (!game) return null;
  const playTime = formatPlayTime(getDisplayedPlayTimeInMilliseconds(game));
  const lastPlayed = formatLastPlayed(game.lastTimePlayed);
  const total = game.achievementCount ?? 0;
  const unlocked = game.unlockedAchievementCount ?? 0;
  const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0;
  const translated = hasTranslation(game);

  return (
    <div className="opus-game__facts">
      <div className="opus-game__fact">
        <span className="opus-game__fact-label">
          {tr("PLAY TIME", "TEMPO DE JOGO")}
        </span>
        <span className="opus-game__fact-value">
          {playTime ?? tr("Not played yet", "Ainda não jogado")}
        </span>
        {lastPlayed && (
          <span className="opus-game__fact-note">{lastPlayed}</span>
        )}
      </div>

      {total > 0 && (
        <div className="opus-game__fact opus-game__fact--wide">
          <div className="opus-game__fact-row">
            <span className="opus-game__fact-label">
              {tr("TROPHIES", "TROFÉUS")}
            </span>
            <span className="opus-game__fact-note">
              {tr(`${unlocked} of ${total}`, `${unlocked} de ${total}`)} ·{" "}
              {percent}%
            </span>
          </div>
          <div className="opus-game__bar">
            <div style={{ width: `${percent}%` }} />
          </div>
          <span className="opus-game__fact-note">
            {percent === 100
              ? tr("Platinum earned", "Platina conquistada")
              : tr(`${total - unlocked} to go`, `Faltam ${total - unlocked}`)}
          </span>
        </div>
      )}

      {translated && (
        <div className="opus-game__fact">
          <span className="opus-game__fact-label">
            {tr("LANGUAGE", "IDIOMA")}
          </span>
          <span className="opus-game__fact-value">
            {tr("PT-BR translation", "Tradução PT-BR")}
          </span>
          <span className="opus-game__fact-note opus-game__fact-note--ok">
            {tr("Installed", "Instalada")}
          </span>
        </div>
      )}
    </div>
  );
}
