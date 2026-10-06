import type {
  ComparedAchievements,
  GameShop,
  UserAchievement,
  UserFriend,
} from "@types";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircleIcon, LockIcon, TrophyIcon } from "@phosphor-icons/react";
import { FocusItem, VerticalFocusGroup } from "../../components";
import { tr } from "../../helpers/opus-text";
import { pickFriend } from "../../layout/friends-panel";
import { NavigationService } from "../../services";
import {
  AchievementRow,
  AvailablePointsBar,
  GAME_ACHIEVEMENTS_LIST_REGION_ID,
  GAME_ACHIEVEMENTS_PAGE_REGION_ID,
  GAME_ACHIEVEMENTS_SUMMARY_FOCUS_ID,
  GameAchievementsHero,
  GameAchievementsSouvenirViewer,
  UserAchievementsSummary,
  getAchievementRowId,
} from "../../components/pages/game-achievements";
import {
  useGameDetails,
  useHeaderTitle,
  useNavigationScreenActions,
  useUserDetails,
} from "../../hooks";
import "./styles.scss";

export default function GameAchievements() {
  const { shop, objectId } = useParams<{ shop: GameShop; objectId: string }>();
  const navigate = useNavigate();
  const { shopDetails, game, achievements, isLoading } = useGameDetails(
    objectId!,
    shop!
  );
  const { userDetails } = useUserDetails();
  const [souvenir, setSouvenir] = useState<UserAchievement | null>(null);
  const [comparison, setComparison] = useState<{
    friend: UserFriend;
    data: ComparedAchievements | null;
    failed: boolean;
  } | null>(null);

  const compareWith = useCallback(
    (friend: UserFriend) => {
      setComparison({ friend, data: null, failed: false });
      globalThis.window.electron
        .getComparedUnlockedAchievements(objectId!, shop!, friend.id)
        .then((data) =>
          setComparison((current) =>
            current?.friend.id === friend.id
              ? { friend, data, failed: false }
              : current
          )
        )
        .catch(() =>
          setComparison((current) =>
            current?.friend.id === friend.id
              ? { friend, data: null, failed: true }
              : current
          )
        );
    },
    [objectId, shop]
  );

  const unlockedCount = useMemo(
    () => achievements.filter((a) => a.unlocked).length,
    [achievements]
  );

  const totalPoints = useMemo(
    () => achievements.reduce((sum, a) => sum + (a.points ?? 0), 0),
    [achievements]
  );

  const firstAchievementRowId = achievements[0]
    ? getAchievementRowId(achievements[0].name)
    : null;

  const earnedPoints = useMemo(
    () =>
      achievements.reduce(
        (sum, a) => sum + (a.unlocked ? (a.points ?? 0) : 0),
        0
      ),
    [achievements]
  );

  useHeaderTitle(shopDetails?.assets?.title);

  const handleSouvenirActivate = useCallback(
    (achievement: UserAchievement) => setSouvenir(achievement),
    []
  );

  const screenActions = useMemo(
    () => ({
      press: {
        b: () => {
          if (souvenir) {
            setSouvenir(null);
            return;
          }
          if (comparison) {
            setComparison(null);
            return;
          }

          navigate(-1);
        },
        // Y: compare this game's trophies with a friend (picked in the friends panel).
        y: () => {
          if (achievements.length === 0) return;
          pickFriend(
            compareWith,
            NavigationService.getInstance().getCurrentFocusId()
          );
        },
      },
    }),
    [achievements.length, compareWith, comparison, navigate, souvenir]
  );

  useNavigationScreenActions(screenActions);

  if (isLoading || !shopDetails) {
    return (
      <VerticalFocusGroup regionId={GAME_ACHIEVEMENTS_PAGE_REGION_ID} asChild>
        <div className="game-achievements-page">
          <p style={{ color: "white", padding: 24 }}>
            {tr("Loading...", "Carregando...")}
          </p>
        </div>
      </VerticalFocusGroup>
    );
  }

  return (
    <VerticalFocusGroup regionId={GAME_ACHIEVEMENTS_PAGE_REGION_ID} asChild>
      <div className="game-achievements-page">
        <GameAchievementsHero shopDetails={shopDetails} game={game} />

        {comparison ? (
          <ComparisonView
            friend={comparison.friend}
            data={comparison.data}
            failed={comparison.failed}
            onExit={() => setComparison(null)}
          />
        ) : achievements.length === 0 ? (
          <div className="game-achievements-page__content">
            <FocusItem
              id={GAME_ACHIEVEMENTS_SUMMARY_FOCUS_ID}
              stealFocusOnAppear
              actions={{ primary: () => navigate(-1) }}
              asChild
            >
              <div className="game-achievements-page__empty">
                <TrophyIcon size={56} weight="duotone" />
                <div>
                  <h2>
                    {tr(
                      "This game has no trophies",
                      "Este jogo não tem troféus"
                    )}
                  </h2>
                  <p>
                    {shop === "launchbox"
                      ? tr(
                          "Console games get trophies through RetroAchievements (PS1, PS2, SNES, N64, GBA, DS…). Switch, 3DS, PS3 and PS4 games have none yet.",
                          "Jogos de console ganham troféus pelo RetroAchievements (PS1, PS2, SNES, N64, GBA, DS…). Jogos de Switch, 3DS, PS3 e PS4 ainda não têm."
                        )
                      : tr(
                          "No trophy list was found for this game.",
                          "Não foi encontrada uma lista de troféus para este jogo."
                        )}
                  </p>
                </div>
              </div>
            </FocusItem>
          </div>
        ) : (
          <div className="game-achievements-page__content">
            <UserAchievementsSummary
              userDetails={userDetails}
              unlockedCount={unlockedCount}
              totalCount={achievements.length}
              stealFocusOnAppear
              navigationOverrides={{
                up: { type: "block" },
                down: firstAchievementRowId
                  ? { type: "item", itemId: firstAchievementRowId }
                  : { type: "block" },
              }}
            />

            <section className="game-achievements-page__list-section">
              <AvailablePointsBar
                earnedPoints={earnedPoints}
                totalPoints={totalPoints}
              />

              <VerticalFocusGroup
                regionId={GAME_ACHIEVEMENTS_LIST_REGION_ID}
                asChild
              >
                <ul className="game-achievements-page__list">
                  {achievements.map((achievement, index) => (
                    <AchievementRow
                      key={achievement.name}
                      achievement={achievement}
                      navigationOverrides={
                        index === 0
                          ? {
                              up: {
                                type: "item",
                                itemId: GAME_ACHIEVEMENTS_SUMMARY_FOCUS_ID,
                              },
                            }
                          : undefined
                      }
                      onSouvenirActivate={handleSouvenirActivate}
                    />
                  ))}
                </ul>
              </VerticalFocusGroup>
            </section>
          </div>
        )}

        {souvenir?.imageUrl ? (
          <GameAchievementsSouvenirViewer
            src={souvenir.imageUrl}
            alt={`${souvenir.displayName} souvenir`}
            onClose={() => setSouvenir(null)}
          />
        ) : null}
      </div>
    </VerticalFocusGroup>
  );
}

const COMPARE_ROW_PREFIX = "compare-row-";

/** This game's trophies side by side: what you have and what the friend has. */
function ComparisonView({
  friend,
  data,
  failed,
  onExit,
}: Readonly<{
  friend: UserFriend;
  data: ComparedAchievements | null;
  failed: boolean;
  onExit: () => void;
}>) {
  const mark = (unlocked: boolean | undefined) =>
    unlocked ? (
      <CheckCircleIcon size={26} weight="fill" className="compare__mark--on" />
    ) : (
      <LockIcon size={22} className="compare__mark--off" />
    );

  if (!data) {
    return (
      <div className="game-achievements-page__content">
        <FocusItem
          id={`${COMPARE_ROW_PREFIX}status`}
          stealFocusOnAppear
          actions={{ primary: onExit }}
          asChild
        >
          <div className="game-achievements-page__empty">
            <TrophyIcon size={56} weight="duotone" />
            <h2>
              {failed
                ? tr(
                    `Could not load ${friend.displayName}'s trophies`,
                    `Não foi possível carregar os troféus de ${friend.displayName}`
                  )
                : tr(
                    `Comparing with ${friend.displayName}…`,
                    `Comparando com ${friend.displayName}…`
                  )}
            </h2>
          </div>
        </FocusItem>
      </div>
    );
  }

  const { owner, target } = data;
  return (
    <div className="game-achievements-page__content compare">
      <header className="compare__header">
        <div className="compare__side">
          <span className="compare__label">{tr("You", "Você")}</span>
          <strong>
            {owner.unlockedAchievementCount}/{owner.totalAchievementCount}
          </strong>
        </div>
        <span className="compare__vs">vs</span>
        <div className="compare__side compare__side--friend">
          {target.profileImageUrl ? (
            <img src={target.profileImageUrl} alt="" />
          ) : null}
          <span className="compare__label">{target.displayName}</span>
          <strong>
            {target.unlockedAchievementCount}/{target.totalAchievementCount}
          </strong>
        </div>
      </header>

      <div className="compare__columns" aria-hidden="true">
        <span />
        <span />
        <span>{tr("You", "Você")}</span>
        <span>{target.displayName}</span>
      </div>

      <VerticalFocusGroup regionId="game-achievements-compare" asChild>
        <ul className="compare__list">
          {data.achievements.map((achievement, index) => (
            <FocusItem
              key={`${achievement.displayName}-${index}`}
              id={`${COMPARE_ROW_PREFIX}${index}`}
              stealFocusOnAppear={index === 0}
              asChild
            >
              <li className="compare__row">
                <img src={achievement.icon} alt="" loading="lazy" />
                <div className="compare__text">
                  <span className="compare__name">
                    {achievement.displayName}
                  </span>
                  <span className="compare__description">
                    {achievement.hidden && !achievement.description
                      ? tr("Hidden trophy", "Troféu oculto")
                      : achievement.description}
                  </span>
                </div>
                <span className="compare__cell">
                  {mark(achievement.ownerStat?.unlocked)}
                </span>
                <span className="compare__cell">
                  {mark(achievement.targetStat.unlocked)}
                </span>
              </li>
            </FocusItem>
          ))}
        </ul>
      </VerticalFocusGroup>
    </div>
  );
}
