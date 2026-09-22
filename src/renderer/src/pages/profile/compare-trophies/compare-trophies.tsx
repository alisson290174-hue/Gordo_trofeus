import { useEffect, useMemo, useState } from "react";
import { Icon } from "@renderer/components/icon/icon";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import type { UserGame } from "@types";
import { useUserDetails } from "@renderer/hooks";
import { buildGameDetailsPath } from "@renderer/helpers";
import { VerticalCoverCard, Button } from "@renderer/components";
import TierBadgePlatinum from "@renderer/assets/achievements/tier-badge-platinum.png";
import { AuthPage } from "@shared";
import "./compare-trophies.scss";

interface PlatinumGamesResponse {
  games: UserGame[];
  total: number;
}

const fetchPlatinumGames = (userId: string) =>
  window.electron.hydraApi
    .get<PlatinumGamesResponse>(`/users/${userId}/games/platinum`, {
      needsAuth: false,
    })
    .then((response) => response?.games ?? [])
    .catch(() => []);

function PlatinumColumn({
  title,
  games,
  isLoading,
  sharedObjectIds,
}: Readonly<{
  title: string;
  games: UserGame[];
  isLoading: boolean;
  sharedObjectIds: Set<string>;
}>) {
  const { t } = useTranslation("user_profile");
  const navigate = useNavigate();

  return (
    <div className="compare-trophies__column">
      <h3 className="compare-trophies__column-title">{title}</h3>

      {isLoading ? (
        <div className="compare-trophies__grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="compare-trophies__card-skeleton"
            />
          ))}
        </div>
      ) : games.length === 0 ? (
        <p className="compare-trophies__empty">{t("compare_trophies_empty")}</p>
      ) : (
        <div className="compare-trophies__grid">
          {games.map((game) => (
            <VerticalCoverCard
              key={`${game.shop}-${game.objectId}`}
              gameTitle={game.title}
              coverImageUrls={[game.libraryImageUrl, game.coverImageUrl]}
              className={
                sharedObjectIds.has(`${game.shop}-${game.objectId}`)
                  ? "compare-trophies__card--shared"
                  : undefined
              }
              onClick={() => navigate(buildGameDetailsPath(game))}
            >
              <img
                src={TierBadgePlatinum}
                alt=""
                className="compare-trophies__card-badge"
              />
            </VerticalCoverCard>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CompareTrophies() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation("user_profile");
  const { userDetails } = useUserDetails();

  const [theirGames, setTheirGames] = useState<UserGame[]>([]);
  const [myGames, setMyGames] = useState<UserGame[]>([]);
  const [theirName, setTheirName] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!userId || !userDetails) return;

    setIsLoading(true);

    Promise.all([
      fetchPlatinumGames(userId),
      fetchPlatinumGames(userDetails.id),
      window.electron.hydraApi
        .get<{ displayName: string }>(`/users/${userId}`, { needsAuth: false })
        .catch(() => null),
    ]).then(([theirs, mine, profile]) => {
      setTheirGames(theirs);
      setMyGames(mine);
      setTheirName(profile?.displayName ?? "");
      setIsLoading(false);
    });
  }, [userId, userDetails]);

  const sharedObjectIds = useMemo(() => {
    const myKeys = new Set(myGames.map((g) => `${g.shop}-${g.objectId}`));
    const theirKeys = new Set(theirGames.map((g) => `${g.shop}-${g.objectId}`));
    return new Set([...myKeys].filter((key) => theirKeys.has(key)));
  }, [myGames, theirGames]);

  if (!userDetails) {
    return (
      <div className="compare-trophies compare-trophies--signed-out">
        <p>{t("compare_trophies_sign_in_required")}</p>
        <Button
          theme="outline"
          onClick={() => window.electron.openAuthWindow(AuthPage.SignIn)}
        >
          <Icon name="sign-in"  />
        </Button>
      </div>
    );
  }

  return (
    <div className="compare-trophies">
      <div className="compare-trophies__header">
        <button
          type="button"
          className="compare-trophies__back"
          onClick={() => navigate(-1)}
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <h2>{t("compare_trophies_title")}</h2>
      </div>

      {sharedObjectIds.size > 0 && (
        <p className="compare-trophies__shared-count">
          {t("compare_trophies_shared_count", {
            count: sharedObjectIds.size,
          })}
        </p>
      )}

      <div className="compare-trophies__columns">
        <PlatinumColumn
          title={t("compare_trophies_my_platinums")}
          games={myGames}
          isLoading={isLoading}
          sharedObjectIds={sharedObjectIds}
        />
        <PlatinumColumn
          title={t("compare_trophies_their_platinums", {
            displayName: theirName,
          })}
          games={theirGames}
          isLoading={isLoading}
          sharedObjectIds={sharedObjectIds}
        />
      </div>
    </div>
  );
}
