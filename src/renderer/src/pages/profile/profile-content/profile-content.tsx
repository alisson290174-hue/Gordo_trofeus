import { userProfileContext } from "@renderer/context";
import { readStoredSouvenirSort } from "@renderer/helpers";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ProfileHero } from "../profile-hero/profile-hero";
import {
  useAppDispatch,
  useAppSelector,
  useFormat,
  useUserDetails,
} from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { useTranslation } from "react-i18next";
import type { GameShop } from "@types";
import {
  AuthPage,
  findSouvenirByNotificationTarget,
  isAchievementSouvenirsEnabled,
  useSouvenirContentWarning,
} from "@shared";
import { LockedProfile } from "./locked-profile";
import { ReportProfile } from "../report-profile/report-profile";
import { BadgesBox } from "./badges-box";
import { ProfileSection } from "../profile-section/profile-section";
import {
  buildActivity,
  formatProfilePlaytime,
  ProfileAboutCard,
  ProfileActivityList,
  ProfileFriendsCard,
  ProfileOverview,
  ProfileTrophyBand,
  type TitleResolver,
} from "../ps5/profile-ps5";
import { useLibrary, useTrophySummary } from "@renderer/hooks";
import { DeleteReviewModal } from "@renderer/pages/game-details/modals/delete-review-modal";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { ProfileTabs, type ProfileTabType } from "./profile-tabs";
import { ReviewsTab } from "./reviews-tab";
import { SouvenirsTab } from "./souvenirs-tab";
import { SouvenirLightbox } from "./souvenir-lightbox";
import { useSouvenirActions } from "./use-souvenir-actions";
import { AnimatePresence } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ConfirmationModal } from "@renderer/components";
import { AddFriendModal } from "./add-friend-modal";
import "./profile-content.scss";

interface UserReview {
  id: string;
  reviewHtml: string;
  score: number;
  playTimeInSeconds?: number;
  upvotes: number;
  downvotes: number;
  hasUpvoted: boolean;
  hasDownvoted: boolean;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
  };
  game: {
    title: string;
    iconUrl: string;
    objectId: string;
    shop: GameShop;
  };
  translations: {
    [key: string]: string;
  };
  detectedLanguage: string | null;
}

interface UserReviewsResponse {
  totalCount: number;
  reviews: UserReview[];
}

const getRatingText = (score: number, t: (key: string) => string): string => {
  switch (score) {
    case 1:
      return t("rating_very_negative");
    case 2:
      return t("rating_negative");
    case 3:
      return t("rating_neutral");
    case 4:
      return t("rating_positive");
    case 5:
      return t("rating_very_positive");
    default:
      return "";
  }
};

export function ProfileContent() {
  const {
    userProfile,
    isMe,
    userStats,
    getUserStats,
    souvenirs,
    souvenirsTotal,
    hasReachedSouvenirLimit,
    souvenirsHiddenReason,
    hasMoreSouvenirs,
    isLoadingSouvenirs,
    getUserSouvenirs,
    loadMoreSouvenirs,
    updateSouvenir,
    removeSouvenir,
  } = useContext(userProfileContext);
  const { userDetails } = useUserDetails();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const requestedSouvenir = searchParams.get("souvenir");
  const attemptedDeepLinkPagesRef = useRef(new Set<string>());
  const souvenirsEnabled = useAppSelector((state) =>
    isAchievementSouvenirsEnabled(
      state.userPreferences.value?.enableAchievementSouvenirs,
      window.electron.platform
    )
  );
  const disableNsfwAlert = useAppSelector(
    (state) => state.userPreferences.value?.disableNsfwAlert === true
  );

  const [activeTab, setActiveTab] = useState<ProfileTabType>(
    requestedTab === "souvenirs" ? "souvenirs" : "overview"
  );
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const { summary: trophySummary } = useTrophySummary(userProfile?.id);
  const { library } = useLibrary();
  // Classics come back from the server with their disc serial as title; the local library
  // knows the real name.
  const resolveTitle = useCallback<TitleResolver>(
    (shop, objectId, fallback) => {
      const local = library.find(
        (game) => game.shop === shop && game.objectId === objectId
      );
      // Steam names carry trademark marks ("BioShock™ Remastered") — noise in a trophy list.
      const title = local?.title || fallback;
      return title ? title.replace(/[™®©]/g, "").trim() : title;
    },
    [library]
  );

  const titledSouvenirs = useMemo(
    () =>
      souvenirs.map((item) => ({
        ...item,
        gameTitle: resolveTitle(item.shop, item.objectId, item.gameTitle),
      })),
    [souvenirs, resolveTitle]
  );

  // User reviews state
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [reviewsTotalCount, setReviewsTotalCount] = useState(0);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const [votingReviews, setVotingReviews] = useState<Set<string>>(new Set());
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [reviewToDelete, setReviewToDelete] = useState<string | null>(null);

  const dispatch = useAppDispatch();

  const { t, i18n } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();
  const {
    likingKeys,
    visibilityKeys,
    deletingKeys,
    reportingKeys,
    reportedKeys,
    likeSouvenir,
    changeSouvenirVisibility,
    deleteSouvenir,
    reportSouvenir,
  } = useSouvenirActions({
    ownerUserId: userProfile?.id,
    canLike: Boolean(userDetails),
    canReport: Boolean(userDetails) && !isMe,
    updateSouvenir,
    removeSouvenir,
  });
  const {
    openSouvenirKey,
    openSouvenirIndex,
    openSouvenir: souvenir,
    pendingSouvenir,
    requestOpenSouvenir,
    confirmContentWarning,
    dismissContentWarning,
    closeSouvenir,
  } = useSouvenirContentWarning({
    souvenirs,
    disableNsfwAlert,
    ownerUserId: userProfile?.id,
  });

  const clearRequestedSouvenir = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("souvenir");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    attemptedDeepLinkPagesRef.current.clear();
  }, [requestedSouvenir, userProfile?.id]);

  useEffect(() => {
    if (!requestedSouvenir || !userProfile?.id) return;

    setActiveTab("souvenirs");
    const normalizedTarget = requestedSouvenir.toLowerCase();
    const match = findSouvenirByNotificationTarget(
      souvenirs,
      requestedSouvenir
    );

    if (match) {
      requestOpenSouvenir(match);
      clearRequestedSouvenir();
      return;
    }

    if (isLoadingSouvenirs) return;
    const pageKey = `${normalizedTarget}:${souvenirs.length}`;
    if (hasMoreSouvenirs && !attemptedDeepLinkPagesRef.current.has(pageKey)) {
      attemptedDeepLinkPagesRef.current.add(pageKey);
      void loadMoreSouvenirs(readStoredSouvenirSort());
      return;
    }

    clearRequestedSouvenir();
  }, [
    clearRequestedSouvenir,
    hasMoreSouvenirs,
    isLoadingSouvenirs,
    loadMoreSouvenirs,
    requestOpenSouvenir,
    requestedSouvenir,
    souvenirs,
    userProfile?.id,
  ]);

  const formatPlayTime = (playTimeInSeconds: number) => {
    const minutes = playTimeInSeconds / 60;

    if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
      return t("amount_minutes", {
        amount: minutes.toFixed(0),
      });
    }

    const hours = minutes / 60;
    return t("amount_hours", { amount: numberFormatter.format(hours) });
  };

  useEffect(() => {
    dispatch(setHeaderTitle(""));

    if (userProfile) {
      dispatch(setHeaderTitle(userProfile.displayName));
    }
  }, [userProfile, dispatch]);

  useEffect(() => {
    if (userProfile) {
      getUserStats();
    }
  }, [getUserStats, userProfile]);

  // Clear reviews state and reset tab when switching users
  useEffect(() => {
    setReviews([]);
    setReviewsTotalCount(0);
    setIsLoadingReviews(false);
    setActiveTab(requestedTab === "souvenirs" ? "souvenirs" : "overview");
  }, [requestedTab, userProfile?.id]);

  const fetchUserReviews = useCallback(async () => {
    if (!userProfile?.id) return;

    setIsLoadingReviews(true);
    try {
      const response = await window.electron.hydraApi.get<UserReviewsResponse>(
        `/users/${userProfile.id}/reviews`,
        { needsAuth: false }
      );
      setReviews(response.reviews);
      setReviewsTotalCount(response.totalCount);
    } finally {
      setIsLoadingReviews(false);
    }
  }, [userProfile?.id]);

  useEffect(() => {
    fetchUserReviews();
  }, [fetchUserReviews, userDetails?.id]);

  const handleDeleteReview = async (reviewId: string) => {
    try {
      const reviewToDeleteObj = reviews.find(
        (review) => review.id === reviewId
      );
      if (!reviewToDeleteObj) return;

      await window.electron.hydraApi.delete(
        `/games/${reviewToDeleteObj.game.shop}/${reviewToDeleteObj.game.objectId}/reviews/${reviewId}`
      );
      // Remove the review from the local state
      setReviews((prev) => prev.filter((review) => review.id !== reviewId));
      setReviewsTotalCount((prev) => prev - 1);
    } catch (error) {
      console.error("Failed to delete review:", error);
    }
  };

  const handleDeleteClick = (reviewId: string) => {
    setReviewToDelete(reviewId);
    setDeleteModalVisible(true);
  };

  const handleDeleteConfirm = () => {
    if (reviewToDelete) {
      handleDeleteReview(reviewToDelete);
      setReviewToDelete(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteModalVisible(false);
    setReviewToDelete(null);
  };

  const handleVoteReview = async (reviewId: string, isUpvote: boolean) => {
    if (!userDetails) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    if (votingReviews.has(reviewId)) return;

    setVotingReviews((prev) => new Set(prev).add(reviewId));

    const review = reviews.find((r) => r.id === reviewId);
    if (!review) {
      setVotingReviews((prev) => {
        const next = new Set(prev);
        next.delete(reviewId);
        return next;
      });
      return;
    }

    const wasUpvoted = review.hasUpvoted;
    const wasDownvoted = review.hasDownvoted;

    // Optimistic update
    setReviews((prev) =>
      prev.map((r) => {
        if (r.id !== reviewId) return r;

        let newUpvotes = r.upvotes;
        let newDownvotes = r.downvotes;
        let newHasUpvoted = r.hasUpvoted;
        let newHasDownvoted = r.hasDownvoted;

        if (isUpvote) {
          if (wasUpvoted) {
            // Remove upvote
            newUpvotes--;
            newHasUpvoted = false;
          } else {
            // Add upvote
            newUpvotes++;
            newHasUpvoted = true;
            if (wasDownvoted) {
              // Remove downvote if it was downvoted
              newDownvotes--;
              newHasDownvoted = false;
            }
          }
        } else if (wasDownvoted) {
          // Remove downvote
          newDownvotes--;
          newHasDownvoted = false;
        } else {
          // Add downvote
          newDownvotes++;
          newHasDownvoted = true;
          if (wasUpvoted) {
            // Remove upvote if it was upvoted
            newUpvotes--;
            newHasUpvoted = false;
          }
        }

        return {
          ...r,
          upvotes: newUpvotes,
          downvotes: newDownvotes,
          hasUpvoted: newHasUpvoted,
          hasDownvoted: newHasDownvoted,
        };
      })
    );

    try {
      const endpoint = isUpvote ? "upvote" : "downvote";
      await window.electron.hydraApi.put(
        `/games/${review.game.shop}/${review.game.objectId}/reviews/${reviewId}/${endpoint}`
      );
    } catch (error) {
      console.error("Failed to vote on review:", error);

      // Rollback optimistic update on error
      setReviews((prev) =>
        prev.map((r) => {
          if (r.id !== reviewId) return r;
          return {
            ...r,
            upvotes: review.upvotes,
            downvotes: review.downvotes,
            hasUpvoted: review.hasUpvoted,
            hasDownvoted: review.hasDownvoted,
          };
        })
      );
    } finally {
      setTimeout(() => {
        setVotingReviews((prev) => {
          const newSet = new Set(prev);
          newSet.delete(reviewId);
          return newSet;
        });
      }, 500);
    }
  };

  const usersAreFriends = useMemo(() => {
    return userProfile?.relation?.status === "ACCEPTED";
  }, [userProfile]);

  const content = (() => {
    if (!userProfile) return null;

    const shouldLockProfile =
      userProfile.profileVisibility === "PRIVATE" ||
      (userProfile.profileVisibility === "FRIENDS" && !usersAreFriends);

    if (!isMe && shouldLockProfile) {
      return <LockedProfile />;
    }

    const activity = buildActivity(
      trophySummary,
      userProfile.recentGames ?? [],
      souvenirs,
      resolveTitle
    );

    const aboutRows = [
      userStats?.totalPlayTimeInSeconds?.value
        ? {
            label: t("playtime", { ns: "dashboard" }),
            value: formatProfilePlaytime(
              userStats.totalPlayTimeInSeconds.value,
              i18n.language
            ),
          }
        : null,
      userStats
        ? {
            label: t("library_games", { ns: "dashboard" }),
            value: String(userStats.libraryCount),
          }
        : null,
      {
        label: t("user_reviews"),
        value: String(reviewsTotalCount),
      },
      {
        label: t("karma", { ns: "dashboard" }),
        value: String(userProfile.karma),
      },
    ].filter(Boolean) as { label: string; value: string }[];

    return (
      <section className="profile-content__section">
        <div className="profile-content__main">
          <ProfileTabs
            activeTab={activeTab}
            reviewsTotalCount={reviewsTotalCount}
            souvenirsCount={souvenirsTotal}
            onTabChange={setActiveTab}
          />

          <div className="profile-content__tab-panels">
            <AnimatePresence mode="wait">
              {activeTab === "overview" && (
                <ProfileOverview
                  summary={trophySummary}
                  souvenirs={souvenirs}
                  souvenirsTotal={souvenirsTotal}
                  recentGames={userProfile.recentGames ?? []}
                  isMe={isMe}
                  onSeeSouvenirs={() => setActiveTab("souvenirs")}
                  onOpenSouvenir={requestOpenSouvenir}
                  onSeeActivity={() => setActiveTab("activity")}
                  resolveTitle={resolveTitle}
                />
              )}

              {activeTab === "activity" && (
                <ProfileActivityList items={activity} />
              )}

              {activeTab === "reviews" && (
                <ReviewsTab
                  reviews={reviews}
                  isLoadingReviews={isLoadingReviews}
                  votingReviews={votingReviews}
                  userDetailsId={userDetails?.id}
                  formatPlayTime={formatPlayTime}
                  getRatingText={getRatingText}
                  onVote={handleVoteReview}
                  onDelete={handleDeleteClick}
                />
              )}

              {activeTab === "souvenirs" && (
                <SouvenirsTab
                  achievements={titledSouvenirs}
                  hasReachedLimit={hasReachedSouvenirLimit}
                  hiddenReason={souvenirsHiddenReason}
                  canLike={Boolean(userDetails)}
                  hasMore={hasMoreSouvenirs}
                  isLoading={isLoadingSouvenirs}
                  isEnabled={souvenirsEnabled}
                  isMe={isMe}
                  userId={userProfile.id}
                  visibility={userProfile.souvenirsVisibility}
                  hasActiveSubscription={Boolean(
                    userProfile.hasActiveSubscription
                  )}
                  disableNsfwAlert={disableNsfwAlert}
                  likingKeys={likingKeys}
                  onSouvenirClick={requestOpenSouvenir}
                  onLikeClick={(item) => void likeSouvenir(item)}
                  onReload={getUserSouvenirs}
                  onLoadMore={loadMoreSouvenirs}
                  onOpenSettings={() =>
                    navigate(
                      "/settings?tab=content_gameplay#achievement-souvenirs"
                    )
                  }
                />
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="profile-content__right-content">
          <ProfileFriendsCard
            friends={userProfile.friends}
            total={userStats?.friendsCount || userProfile.friends.length}
            isMe={isMe}
            onAdd={() => setShowAddFriendModal(true)}
            canCompare={Boolean(userDetails)}
          />
          <ProfileAboutCard rows={aboutRows} />
          {userProfile.badges.length > 0 && (
            <ProfileSection
              title={t("badges")}
              count={userProfile.badges.length}
              defaultOpen={true}
            >
              <BadgesBox />
            </ProfileSection>
          )}
          <ReportProfile />
        </div>

        <DeleteReviewModal
          visible={deleteModalVisible}
          onClose={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
        />
      </section>
    );
  })();

  return (
    <div>
      <ProfileHero />

      {userProfile && (
        <div className="profile-content__band">
          <ProfileTrophyBand summary={trophySummary} />
        </div>
      )}

      {content}

      <AddFriendModal
        visible={showAddFriendModal}
        onClose={() => setShowAddFriendModal(false)}
      />

      <SouvenirLightbox
        souvenir={
          souvenir && {
            ...souvenir,
            gameTitle: resolveTitle(
              souvenir.shop,
              souvenir.objectId,
              souvenir.gameTitle
            ),
          }
        }
        items={titledSouvenirs}
        index={openSouvenirIndex}
        isOwner={isMe}
        canLike={Boolean(userDetails)}
        isLiking={Boolean(openSouvenirKey && likingKeys.has(openSouvenirKey))}
        isUpdatingVisibility={Boolean(
          openSouvenirKey && visibilityKeys.has(openSouvenirKey)
        )}
        isDeleting={Boolean(
          openSouvenirKey && deletingKeys.has(openSouvenirKey)
        )}
        isReporting={Boolean(
          openSouvenirKey && reportingKeys.has(openSouvenirKey)
        )}
        isReported={Boolean(
          openSouvenirKey && reportedKeys.has(openSouvenirKey)
        )}
        isContentWarningVisible={Boolean(pendingSouvenir)}
        onClose={closeSouvenir}
        onNavigate={(index) => {
          const nextSouvenir = souvenirs[index];
          return nextSouvenir ? requestOpenSouvenir(nextSouvenir) : false;
        }}
        onLike={(item) => void likeSouvenir(item)}
        onVisibilityChange={(item) => void changeSouvenirVisibility(item)}
        onDelete={deleteSouvenir}
        onReport={reportSouvenir}
      />

      <ConfirmationModal
        visible={Boolean(pendingSouvenir)}
        title={t("souvenir_content_warning_title")}
        descriptionText={t("souvenir_content_warning_description", {
          title: pendingSouvenir?.gameTitle ?? t("unknown_game"),
        })}
        confirmButtonLabel={t("allow_nsfw_content", {
          ns: "game_details",
        })}
        cancelButtonLabel={t("refuse_nsfw_content", {
          ns: "game_details",
        })}
        onConfirm={confirmContentWarning}
        onClose={dismissContentWarning}
        clickOutsideToClose={false}
      />
    </div>
  );
}
