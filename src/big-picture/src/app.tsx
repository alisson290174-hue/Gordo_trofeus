import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Outlet,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router-dom";
import {
  BIG_PICTURE_APP_LAYER_ID,
  BIG_PICTURE_CONTENT_REGION_ID,
  BIG_PICTURE_SHELL_REGION_ID,
  getBigPictureContentEntryRegionIdFromPathname,
  ButtonHints,
  ConsoleOverlays,
  FriendsPanel,
  Header,
  normalizeBigPicturePathname,
  QuickMenu,
  TopNav,
} from "./layout";
import { IS_DESKTOP } from "./constants";
import { useBigPictureToast, useNavigation, useUserPreferences } from "./hooks";
import {
  InputModeProvider,
  NavigationHistoryBridge,
  NavigationLayer,
  NavigationAutoScrollBridge,
  NavigationInputProvider,
  NavigationStateBridge,
  NavigationDiagnostics,
  VerticalFocusGroup,
  BigPictureToastHost,
  CloudGiftNotificationModal,
  VirtualKeyboardProvider,
} from "./components";
import {
  initializeBigPictureRunningGamesStore,
  useInputModeStore,
} from "./stores";
import { NavigationAudioService, NavigationService } from "./services";
import { BigPictureI18nBridge, ensureBigPictureI18nResources } from "./i18n";

import "./styles/globals.scss";

const lastFocusByPathname = new Map<string, string>();

export default function App() {
  ensureBigPictureI18nResources();

  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const { showErrorToast } = useBigPictureToast();
  const { nodes, regions, setFocusRegion } = useNavigation();
  const userPreferences = useUserPreferences();
  const inputMode = useInputModeStore((state) => state.mode);
  const [pendingRouteFocusPathname, setPendingRouteFocusPathname] = useState<
    string | null
  >(pathname);
  const isCataloguePage =
    normalizeBigPicturePathname(pathname).startsWith("/catalogue");

  useEffect(() => {
    if (!IS_DESKTOP) {
      document.documentElement.style.colorScheme = "dark";
      return;
    }

    initializeBigPictureRunningGamesStore();
  }, []);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    return globalThis.window.electron.onNavigate((path) => {
      if (path.startsWith("/big-picture")) {
        navigate(path);
      }
    });
  }, [navigate]);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    const unsubscribeExtractionFailed =
      globalThis.window.electron.onExtractionFailed(
        (_shop, _objectId, failure) => {
          if (failure?.reason === "unsupported-format") {
            showErrorToast(
              t("extraction_unsupported_format_title", { ns: "downloads" }),
              {
                message: t("extraction_unsupported_format_description", {
                  ns: "downloads",
                  format: failure.format,
                }),
              }
            );
            return;
          }

          if (failure?.reason === "file-not-found") {
            showErrorToast(
              t("extraction_file_not_found_title", { ns: "downloads" }),
              {
                message: t("extraction_file_not_found_description", {
                  ns: "downloads",
                }),
              }
            );
            return;
          }

          showErrorToast(t("extraction_failed_title", { ns: "downloads" }), {
            message: t("extraction_failed_description", { ns: "downloads" }),
          });
        }
      );

    const unsubscribeExecutableNotFound =
      globalThis.window.electron.onGameExecutableNotFound(() => {
        showErrorToast(
          t("executable_not_found_title", { ns: "game_details" }),
          {
            message: t("executable_not_found_big_picture_description", {
              ns: "game_details",
            }),
          }
        );
      });

    return () => {
      unsubscribeExtractionFailed();
      unsubscribeExecutableNotFound();
    };
  }, [showErrorToast, t]);

  useEffect(() => {
    setPendingRouteFocusPathname(pathname);
  }, [pathname]);

  // Remember the focused item of each screen, so B (back) lands where you were, like a console.
  useEffect(() => {
    const navigation = NavigationService.getInstance();
    return navigation.subscribe(() => {
      const focusId = navigation.getCurrentFocusId();
      if (focusId && !focusId.startsWith("top-nav")) {
        lastFocusByPathname.set(pathname, focusId);
      }
    });
  }, [pathname]);

  useEffect(() => {
    if (pendingRouteFocusPathname !== pathname) return;

    const entryRegionId =
      getBigPictureContentEntryRegionIdFromPathname(pathname);
    if (!entryRegionId) return;

    const hasRegion = regions.some((region) => region.id === entryRegionId);
    if (!hasRegion) return;

    const rememberedId =
      navigationType === "POP" ? lastFocusByPathname.get(pathname) : undefined;
    if (
      rememberedId &&
      NavigationService.getInstance().setFocus(rememberedId) === rememberedId
    ) {
      setPendingRouteFocusPathname(null);
      return;
    }

    const focusedId = setFocusRegion(entryRegionId, "right", {
      preferRememberedFocus: false,
    });

    if (focusedId) {
      setPendingRouteFocusPathname(null);
    }
  }, [
    navigationType,
    nodes,
    pathname,
    pendingRouteFocusPathname,
    regions,
    setFocusRegion,
  ]);

  useEffect(() => {
    NavigationAudioService.getInstance().setEnabled(
      (userPreferences?.bigPictureSoundsEnabled ?? true) &&
        inputMode === "gamepad"
    );
  }, [userPreferences?.bigPictureSoundsEnabled, inputMode]);

  return (
    <Fragment>
      <NavigationStateBridge />
      <NavigationAutoScrollBridge />
      <NavigationHistoryBridge />

      <NavigationInputProvider>
        <div id="big-picture">
          <BigPictureI18nBridge />

          <NavigationLayer
            layerId={BIG_PICTURE_APP_LAYER_ID}
            rootRegionId={BIG_PICTURE_SHELL_REGION_ID}
            initialFocusRegionId={BIG_PICTURE_CONTENT_REGION_ID}
          >
            <VerticalFocusGroup
              regionId={BIG_PICTURE_SHELL_REGION_ID}
              autoScrollMode="auto"
              asChild
            >
              <div className="big-picture__app">
                <div className="big-picture__layout">
                  <TopNav />

                  <VerticalFocusGroup
                    regionId={BIG_PICTURE_CONTENT_REGION_ID}
                    autoScrollMode="auto"
                    asChild
                  >
                    <div className="big-picture__body">
                      {isCataloguePage && <Header />}

                      <article className="big-picture__content">
                        <Outlet />
                      </article>
                    </div>
                  </VerticalFocusGroup>

                  <ButtonHints />
                  <VirtualKeyboardProvider />
                </div>
              </div>
            </VerticalFocusGroup>
          </NavigationLayer>

          <QuickMenu />
          <FriendsPanel />
          <ConsoleOverlays />
          <InputModeProvider />
          <NavigationDiagnostics />
          <BigPictureToastHost />
          <CloudGiftNotificationModal />
        </div>
      </NavigationInputProvider>
    </Fragment>
  );
}
