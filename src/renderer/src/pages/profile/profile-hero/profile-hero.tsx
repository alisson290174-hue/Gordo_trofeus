import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@renderer/components/icon/icon";
import { userProfileContext } from "@renderer/context";
import { buildGameDetailsPath } from "@renderer/helpers";
import { formatHours } from "@renderer/helpers/ps5-game";
import { FullscreenMediaModal, Link } from "@renderer/components";
import { useTranslation } from "react-i18next";
import { useAppSelector, useToast, useUserDetails } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { AuthPage } from "@shared";
import type { FriendRequestAction } from "@types";
import { EditProfileModal } from "../edit-profile-modal/edit-profile-modal";
import Skeleton from "react-loading-skeleton";
import { UploadBackgroundImageButton } from "../upload-background-image-button/upload-background-image-button";
import "./profile-hero.scss";

type FriendAction =
  | FriendRequestAction
  | ("BLOCK" | "UNDO_FRIENDSHIP" | "SEND");

interface MenuItem {
  key: string;
  label: string;
  icon: string;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * Profile hero (design "Opus — Perfil de troféus"): banner under the top nav, big ringed
 * avatar, name in thin display type, a meta line and pill actions. Destructive actions
 * (undo friendship, block, sign out) live in the "⋯" menu, like the PS5 profile.
 */
export function ProfileHero() {
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showFullscreenAvatar, setShowFullscreenAvatar] = useState(false);
  const [isPerformingAction, setIsPerformingAction] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { isMe, getUserProfile, userProfile, backgroundImage, userStats } =
    useContext(userProfileContext);
  const {
    signOut,
    updateFriendRequestState,
    sendFriendRequest,
    undoFriendship,
    blockUser,
    userDetails,
  } = useUserDetails();
  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const { t, i18n } = useTranslation(["user_profile", "dashboard"]);
  const { showSuccessToast, showErrorToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [isMenuOpen]);

  const handleSignOut = useCallback(async () => {
    setIsPerformingAction(true);
    try {
      await signOut();
      showSuccessToast(t("successfully_signed_out"));
    } finally {
      setIsPerformingAction(false);
    }
    navigate("/");
  }, [navigate, signOut, showSuccessToast, t]);

  const handleFriendAction = useCallback(
    async (userId: string, action: FriendAction) => {
      if (!userProfile) return;
      if (!userDetails) {
        window.electron.openAuthWindow(AuthPage.SignIn);
        return;
      }

      setIsPerformingAction(true);

      try {
        if (action === "UNDO_FRIENDSHIP") {
          await undoFriendship(userId).then(getUserProfile);
          return;
        }

        if (action === "BLOCK") {
          await blockUser(userId).then(() => {
            showSuccessToast(t("user_blocked_successfully"));
            navigate(-1);
          });
          return;
        }

        if (action === "SEND") {
          await sendFriendRequest(userProfile.id).then(getUserProfile);
          return;
        }

        await updateFriendRequestState(userId, action).then(getUserProfile);
      } catch {
        showErrorToast(t("try_again"));
      } finally {
        setIsPerformingAction(false);
      }
    },
    [
      undoFriendship,
      blockUser,
      sendFriendRequest,
      updateFriendRequestState,
      t,
      showErrorToast,
      getUserProfile,
      navigate,
      showSuccessToast,
      userProfile,
      userDetails,
    ]
  );

  const copyFriendCode = useCallback(() => {
    if (!userProfile?.id) return;
    globalThis.window.electron.clipboard.writeText(userProfile.id);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1400);
  }, [userProfile]);

  const handleAvatarClick = useCallback(() => {
    if (userProfile?.profileImageUrl) {
      setShowFullscreenAvatar(true);
    } else if (isMe) {
      setShowEditProfileModal(true);
    }
  }, [isMe, userProfile?.profileImageUrl]);

  const currentGame = useMemo(() => {
    if (isMe) {
      return gameRunning
        ? { title: gameRunning.title, objectId: gameRunning.objectId, shop: gameRunning.shop }
        : null;
    }
    return userProfile?.currentGame ?? null;
  }, [isMe, userProfile, gameRunning]);

  const relation = userProfile?.relation ?? null;
  const isFriend = relation?.status === "ACCEPTED";

  const { buttons, menu } = useMemo(() => {
    const buttons: JSX.Element[] = [];
    const menu: MenuItem[] = [];
    if (!userProfile) return { buttons, menu };

    if (isMe) {
      buttons.push(
        <button key="edit" type="button" className="pf-hero__pill" onClick={() => setShowEditProfileModal(true)} disabled={isPerformingAction}>
          <Icon name="pencil" size={16} />
          {t("edit_profile")}
        </button>,
        <button key="code" type="button" className="pf-hero__pill" onClick={copyFriendCode}>
          <Icon name={isCopied ? "check" : "copy"} size={16} />
          {isCopied ? t("copied") : t("dashboard:friend_code")}
        </button>
      );
      menu.push({ key: "signout", label: t("sign_out"), icon: "sign-out", danger: true, onSelect: handleSignOut });
      return { buttons, menu };
    }

    if (userDetails) {
      buttons.push(
        <button key="compare" type="button" className="pf-hero__pill pf-hero__pill--primary" onClick={() => navigate(`/profile/${userProfile.id}/compare`)}>
          <Icon name="trophy" size={17} />
          {t("dashboard:compare_trophies")}
        </button>
      );
    }

    if (relation == null) {
      buttons.push(
        <button key="add" type="button" className="pf-hero__pill" onClick={() => handleFriendAction(userProfile.id, "SEND")} disabled={isPerformingAction}>
          <Icon name="person-add" size={16} />
          {t("add_friend")}
        </button>
      );
    } else if (isFriend) {
      buttons.push(
        <span key="friends" className="pf-hero__pill pf-hero__pill--static">
          <Icon name="check" size={16} />
          {t("dashboard:friends_label")}
        </span>
      );
      menu.push({ key: "undo", label: t("undo_friendship"), icon: "x-circle", danger: true, onSelect: () => handleFriendAction(userProfile.id, "UNDO_FRIENDSHIP") });
    } else if (relation.BId === userProfile.id) {
      buttons.push(
        <button key="cancel" type="button" className="pf-hero__pill" onClick={() => handleFriendAction(relation.BId, "CANCEL")} disabled={isPerformingAction}>
          <Icon name="x-circle-fill" size={16} />
          {t("cancel_request")}
        </button>
      );
    } else {
      buttons.push(
        <button key="accept" type="button" className="pf-hero__pill" onClick={() => handleFriendAction(relation.AId, "ACCEPTED")} disabled={isPerformingAction}>
          <Icon name="check-circle-fill" size={16} />
          {t("accept_request")}
        </button>,
        <button key="ignore" type="button" className="pf-hero__pill" onClick={() => handleFriendAction(relation.AId, "REFUSED")} disabled={isPerformingAction}>
          <Icon name="x-circle-fill" size={16} />
          {t("ignore_request")}
        </button>
      );
    }

    menu.push({ key: "block", label: t("block_user"), icon: "blocked", danger: true, onSelect: () => handleFriendAction(userProfile.id, "BLOCK") });
    return { buttons, menu };
  }, [userProfile, isMe, isPerformingAction, t, copyFriendCode, isCopied, handleSignOut, userDetails, navigate, relation, isFriend, handleFriendAction]);

  const eyebrow = isMe
    ? t("dashboard:your_profile")
    : isFriend
      ? t("dashboard:friend")
      : t("dashboard:player");

  const metaItems = [
    userStats ? t("dashboard:games_count", { count: userStats.libraryCount }) : null,
    userStats?.totalPlayTimeInSeconds?.value
      ? t("dashboard:played_hours", {
          hours: formatHours(userStats.totalPlayTimeInSeconds.value * 1000, i18n.language),
        })
      : null,
    userProfile ? t("dashboard:karma_n", { count: userProfile.karma }) : null,
  ].filter(Boolean) as string[];

  const initial = (userProfile?.displayName ?? "").charAt(0).toUpperCase();

  return (
    <>
      <EditProfileModal visible={showEditProfileModal} onClose={() => setShowEditProfileModal(false)} />

      <FullscreenMediaModal
        visible={showFullscreenAvatar}
        onClose={() => setShowFullscreenAvatar(false)}
        src={userProfile?.profileImageUrl}
        alt={userProfile?.displayName}
      />

      <section className="pf-hero">
        <div className="pf-hero__art">
          {backgroundImage ? (
            <img
              src={backgroundImage}
              alt=""
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div className="pf-hero__art-default" />
          )}
        </div>
        <div className="pf-hero__shade" />

        {isMe && <UploadBackgroundImageButton />}

        <div className="pf-hero__identity">
          <button type="button" className="pf-hero__avatar" onClick={handleAvatarClick}>
            {userProfile?.profileImageUrl ? (
              <img src={userProfile.profileImageUrl} alt={userProfile.displayName} />
            ) : (
              <span>{initial}</span>
            )}
            {currentGame && <span className="pf-hero__online" />}
          </button>

          <div className="pf-hero__text">
            <span className="pf-hero__eyebrow">{eyebrow}</span>
            {userProfile ? (
              <h1 className="pf-hero__name">{userProfile.displayName}</h1>
            ) : (
              <Skeleton width={260} height={60} />
            )}
            <div className="pf-hero__meta">
              {currentGame && (
                <span className="pf-hero__playing">
                  <span className="pf-hero__playing-dot" />
                  {t("dashboard:playing")}{" "}
                  <Link to={buildGameDetailsPath({ ...currentGame })}>{currentGame.title}</Link>
                </span>
              )}
              {metaItems.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>

          <div className="pf-hero__actions">
            {buttons}
            {menu.length > 0 && (
              <div className="pf-hero__menu" ref={menuRef}>
                <button
                  type="button"
                  className="pf-hero__round"
                  aria-label={t("dashboard:more")}
                  onClick={() => setIsMenuOpen((open) => !open)}
                >
                  <Icon name="kebab-horizontal" size={18} />
                </button>
                {isMenuOpen && (
                  <div className="pf-hero__dropdown">
                    {menu.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`pf-hero__dropdown-item${item.danger ? " pf-hero__dropdown-item--danger" : ""}`}
                        onClick={() => {
                          setIsMenuOpen(false);
                          item.onSelect();
                        }}
                        disabled={isPerformingAction}
                      >
                        <Icon name={item.icon} size={16} />
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
