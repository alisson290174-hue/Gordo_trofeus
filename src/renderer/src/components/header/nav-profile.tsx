import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthPage } from "@shared";
import { Icon } from "@renderer/components/icon/icon";
import { useLibrary, useToast, useUserDetails } from "@renderer/hooks";
import { countPlatinums } from "@renderer/helpers/ps5-game";
import TierBadgePlatinum from "@renderer/assets/achievements/tier-badge-platinum.png";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";

export function NavProfile() {
  const navigate = useNavigate();
  const { t } = useTranslation(["sidebar", "user_profile", "dashboard"]);
  const { userDetails, signOut } = useUserDetails();
  const { library } = useLibrary();
  const { showSuccessToast } = useToast();

  const [open, setOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const platinumCount = useMemo(() => countPlatinums(library), [library]);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleAvatarClick = () => {
    if (!userDetails) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    setOpen((prev) => !prev);
  };

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setOpen(false);
    try {
      await signOut();
      showSuccessToast(t("user_profile:successfully_signed_out"));
    } finally {
      setIsSigningOut(false);
    }
    navigate("/");
  };

  const initial = (userDetails?.displayName ?? "B").charAt(0).toUpperCase();

  // Signed out (a friend's first run): say so plainly instead of a bare "B" avatar.
  if (!userDetails) {
    return (
      <div className="nav-profile" ref={containerRef}>
        <button
          type="button"
          className="nav-profile__sign-in"
          onClick={() => window.electron.openAuthWindow(AuthPage.SignIn)}
        >
          <SteamLogo aria-hidden="true" />
          <span>{t("sidebar:sign_in_with_steam")}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="nav-profile" ref={containerRef}>
      <button
        type="button"
        className="nav-profile__avatar"
        onClick={handleAvatarClick}
        title={userDetails ? userDetails.displayName : t("sidebar:sign_in")}
      >
        {userDetails?.profileImageUrl ? (
          <img src={userDetails.profileImageUrl} alt="" />
        ) : (
          <span>{initial}</span>
        )}
      </button>

      <button
        type="button"
        className="nav-profile__platinum"
        onClick={() => navigate("/trophies")}
        title={t("dashboard:platinum")}
      >
        <img src={TierBadgePlatinum} alt="" />
        <span>{platinumCount}</span>
      </button>

      {open && userDetails && (
        <div className="nav-profile__dropdown">
          <div className="nav-profile__dropdown-name">
            {userDetails.displayName}
          </div>

          <button
            type="button"
            className="nav-profile__dropdown-item"
            onClick={() => go(`/profile/${userDetails.id}`)}
          >
            <Icon name="person" size={16} />
            <span>{t("user_profile:see_profile")}</span>
          </button>

          <button
            type="button"
            className="nav-profile__dropdown-item"
            onClick={() => go("/trophies")}
          >
            <Icon name="trophy" size={16} />
            <span>{t("dashboard:trophies")}</span>
          </button>

          <button
            type="button"
            className="nav-profile__dropdown-item"
            onClick={() => go("/notifications")}
          >
            <Icon name="bell" size={16} />
            <span>{t("sidebar:notifications")}</span>
          </button>

          <button
            type="button"
            className="nav-profile__dropdown-item"
            onClick={() => {
              setOpen(false);
              window.electron.openFriendsWindow();
            }}
          >
            <Icon name="people" size={16} />
            <span>{t("sidebar:friends")}</span>
          </button>

          <div className="nav-profile__dropdown-separator" />

          <button
            type="button"
            className="nav-profile__dropdown-item nav-profile__dropdown-item--danger"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            <Icon name="sign-out" size={16} />
            <span>{t("user_profile:sign_out")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
