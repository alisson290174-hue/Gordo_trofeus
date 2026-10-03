import { useTranslation } from "react-i18next";
import { Icon } from "@renderer/components/icon/icon";
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { Tooltip } from "react-tooltip";
import { SidebarAddingCustomGameModal } from "@renderer/components/sidebar/sidebar-adding-custom-game-modal";

import {
  useAppDispatch,
  useAppSelector,
  useSearchHistory,
  useSearchSuggestions,
} from "@renderer/hooks";

import "./header.scss";
import { AutoUpdateSubHeader } from "./auto-update-sub-header";
import { ScanGamesModal, type ScanResult } from "./scan-games-modal";
import { setFilters, setLibrarySearchQuery } from "@renderer/features";
import cn from "classnames";
import { SearchDropdown } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import type { GameShop } from "@types";
import type { SuggestionShop } from "@renderer/hooks/use-search-suggestions";
import { debounce } from "lodash-es";
import AppIcon from "@renderer/assets/icons/app-icon-refresh.png";
import { NavProfile } from "./nav-profile";

const NAV_ITEMS: {
  path: string;
  labelKey: string;
  match: (pathname: string) => boolean;
}[] = [
  { path: "/", labelKey: "sidebar:home", match: (p) => p === "/" },
  {
    path: "/library",
    labelKey: "sidebar:library",
    match: (p) => p.startsWith("/library"),
  },
  {
    path: "/catalogue",
    labelKey: "sidebar:catalogue",
    match: (p) => p.startsWith("/catalogue"),
  },
  {
    path: "/downloads",
    labelKey: "sidebar:downloads",
    match: (p) => p.startsWith("/downloads"),
  },
  {
    path: "/trophies",
    labelKey: "dashboard:trophies",
    match: (p) => p.startsWith("/trophies") || p.startsWith("/achievements"),
  },
];

/** Routes whose hero runs under the nav, so the nav keeps its fading gradient there. */
export const isFullBleedPath = (pathname: string) =>
  pathname === "/" ||
  pathname.startsWith("/game/") ||
  pathname.startsWith("/trophies") ||
  (pathname.startsWith("/profile/") && !pathname.endsWith("/compare"));

export function Header() {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const scanButtonTooltipId = useId();
  const addCustomGameTooltipId = useId();
  const [showAddGameModal, setShowAddGameModal] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const { draggingDisabled } = useAppSelector(
    (state) => state.window
  );

  const catalogueSearchValue = useAppSelector(
    (state) => state.catalogueSearch.filters.title
  );

  const librarySearchValue = useAppSelector(
    (state) => state.library.searchQuery
  );

  const isOnLibraryPage = location.pathname.startsWith("/library");
  const isOnCataloguePage = location.pathname.startsWith("/catalogue");

  const isLibraryScanSupported =
    window.electron.platform === "win32" ||
    window.electron.platform === "linux";

  const searchValue = isOnLibraryPage
    ? librarySearchValue
    : catalogueSearchValue;

  const [localSearchValue, setLocalSearchValue] = useState(searchValue);
  const deferredSearchValue = useDeferredValue(localSearchValue);

  const dispatch = useAppDispatch();

  const debouncedLibrarySearch = useMemo(
    () =>
      debounce((value: string) => {
        dispatch(setLibrarySearchQuery(value));
      }, 180),
    [dispatch]
  );

  const debouncedCatalogueSearch = useMemo(
    () =>
      debounce((value: string) => {
        dispatch(setFilters({ title: value }));
      }, 250),
    [dispatch]
  );

  const [isFocused, setIsFocused] = useState(false);
  const [isDropdownVisible, setIsDropdownVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState({
    x: 0,
    y: 0,
  });
  const [showScanModal, setShowScanModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanRequestId, setScanRequestId] = useState<string | null>(null);

  const { t } = useTranslation("header");

  const [suggestionShop, setSuggestionShop] = useState<SuggestionShop>("steam");

  const { addToHistory, removeFromHistory, clearHistory, getRecentHistory } =
    useSearchHistory();

  const { suggestions, isLoading: isLoadingSuggestions } = useSearchSuggestions(
    deferredSearchValue,
    isOnLibraryPage,
    isDropdownVisible && isFocused && !isOnCataloguePage,
    suggestionShop
  );

  const historyItems = getRecentHistory(
    isOnLibraryPage ? "library" : "catalogue",
    3
  );

  const isFullBleedRoute = isFullBleedPath(location.pathname);

  // Over a hero the nav is a see-through gradient; once the page scrolls it turns solid so
  // content sliding underneath doesn't collide with the menu.
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const scroller = document.getElementById("scrollableDiv");
    if (!scroller) return;

    const handleScroll = () => setIsScrolled(scroller.scrollTop > 40);
    handleScroll();
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, [location.pathname]);

  const totalItems = historyItems.length + suggestions.length;

  useEffect(() => {
    setLocalSearchValue(searchValue);
  }, [searchValue, isOnLibraryPage, isOnCataloguePage]);

  useEffect(() => {
    return () => {
      debouncedLibrarySearch.cancel();
      debouncedCatalogueSearch.cancel();
    };
  }, [debouncedCatalogueSearch, debouncedLibrarySearch]);

  const updateDropdownPosition = () => {
    if (searchContainerRef.current) {
      const rect = searchContainerRef.current.getBoundingClientRect();
      setDropdownPosition({
        x: rect.left,
        y: rect.bottom,
      });
    }
  };

  const focusInput = () => {
    setIsFocused(true);
    inputRef.current?.focus();
  };

  const handleFocus = () => {
    if (isFocused && isDropdownVisible) {
      updateDropdownPosition();
      return;
    }

    setIsFocused(true);
    setActiveIndex(-1);
    setTimeout(() => {
      updateDropdownPosition();
      setIsDropdownVisible(true);
    }, 220);
  };

  const handleBlur = () => {
    setTimeout(() => {
      setIsFocused(false);
      setIsDropdownVisible(false);
      setActiveIndex(-1);
    }, 200);
  };

  const handleSearch = (value: string) => {
    debouncedLibrarySearch.cancel();
    debouncedCatalogueSearch.cancel();

    if (isOnLibraryPage) {
      dispatch(setLibrarySearchQuery(value.slice(0, 255)));
    } else {
      dispatch(setFilters({ title: value.slice(0, 255) }));
    }
    setActiveIndex(-1);
  };

  const handleInputChange = (value: string) => {
    const normalizedValue = value.slice(0, 255);

    setLocalSearchValue(normalizedValue);
    setActiveIndex(-1);

    if (isOnLibraryPage) {
      debouncedCatalogueSearch.cancel();
      debouncedLibrarySearch(normalizedValue);
    } else {
      debouncedLibrarySearch.cancel();
      debouncedCatalogueSearch(normalizedValue);
    }
  };

  const executeSearch = (query: string) => {
    setLocalSearchValue(query.slice(0, 255));
    const context = isOnLibraryPage ? "library" : "catalogue";
    if (query.trim()) {
      addToHistory(query, context);
    }
    handleSearch(query);

    if (!isOnLibraryPage && !location.pathname.startsWith("/catalogue")) {
      navigate("/catalogue");
    }

    setIsDropdownVisible(false);
    inputRef.current?.blur();
  };

  const handleSelectHistory = (query: string) => {
    executeSearch(query);
  };

  const handleSelectSuggestion = (suggestion: {
    title: string;
    objectId: string;
    shop: GameShop;
  }) => {
    setIsDropdownVisible(false);
    inputRef.current?.blur();
    navigate(buildGameDetailsPath(suggestion));
  };

  const handleClearSearch = () => {
    debouncedLibrarySearch.cancel();
    debouncedCatalogueSearch.cancel();

    setLocalSearchValue("");

    if (isOnLibraryPage) {
      dispatch(setLibrarySearchQuery(""));
    } else {
      dispatch(setFilters({ title: "" }));
    }
    setActiveIndex(-1);
  };

  const handleClearSearchMouseDown = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
  };

  const handleRemoveHistoryItem = (query: string) => {
    removeFromHistory(query);
  };

  const handleClearHistory = () => {
    clearHistory();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < totalItems) {
        if (activeIndex < historyItems.length) {
          handleSelectHistory(historyItems[activeIndex].query);
        } else {
          const suggestionIndex = activeIndex - historyItems.length;
          handleSelectSuggestion(suggestions[suggestionIndex]);
        }
      } else if (localSearchValue.trim()) {
        executeSearch(localSearchValue);
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev < totalItems - 1 ? prev + 1 : prev));
      if (!isDropdownVisible) {
        setIsDropdownVisible(true);
        updateDropdownPosition();
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev > -1 ? prev - 1 : -1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsDropdownVisible(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  };

  const handleCloseDropdown = () => {
    setIsDropdownVisible(false);
    setActiveIndex(-1);
  };

  const handleStartScan = async (
    additionalDirectories: string[] = [],
    includeDefaultDirectories = true,
    addGamesToLibrary = true
  ) => {
    if (isScanning) return;

    const requestId = crypto.randomUUID();

    setIsScanning(true);
    setScanRequestId(requestId);
    setScanResult(null);

    try {
      const result = await window.electron.scanInstalledGames(
        additionalDirectories,
        includeDefaultDirectories,
        addGamesToLibrary,
        requestId
      );
      setScanResult(result);
    } finally {
      setIsScanning(false);
      setScanRequestId(null);
    }
  };

  const handleCancelScan = () => {
    if (scanRequestId) window.electron.cancelScanInstalledGames(scanRequestId);
  };

  const handleClearScanResult = () => {
    setScanResult(null);
  };

  useEffect(() => {
    if (!isDropdownVisible) return;

    const handleResize = () => {
      updateDropdownPosition();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isDropdownVisible]);

  useEffect(() => {
    if (searchParams.get("openScanModal") === "true") {
      setShowScanModal(true);
      searchParams.delete("openScanModal");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <>
      <div
        className={cn("top-nav", {
          "top-nav--solid": !isFullBleedRoute || isScrolled,
        })}
      >
        <header
          className={cn("header", {
            "header--dragging-disabled": draggingDisabled,
            "header--is-windows": window.electron.platform === "win32",
          })}
        >
          <button
            type="button"
            className="header__brand"
            onClick={() => navigate("/")}
          >
            <img src={AppIcon} alt="" />
            <span>Opus</span>
          </button>

          <nav className="header__nav">
            {NAV_ITEMS.map((item) => {
              const isActive = item.match(location.pathname);

              return (
                <button
                  key={item.path}
                  type="button"
                  className={cn("header__nav-item", {
                    "header__nav-item--active": isActive,
                  })}
                  onClick={() => navigate(item.path)}
                >
                  <span>{t(item.labelKey)}</span>
                  <span className="header__nav-dot" />
                </button>
              );
            })}
          </nav>

          <section className="header__actions">
            {isOnLibraryPage && (
              <button
                type="button"
                className="header__icon-button"
                onClick={() => setShowAddGameModal(true)}
                data-tooltip-id={addCustomGameTooltipId}
                data-tooltip-content={t("sidebar:add_custom_game_tooltip")}
                data-tooltip-place="bottom"
              >
                <Icon name="plus" size={20} />
              </button>
            )}

            {isOnLibraryPage && isLibraryScanSupported && (
              <button
                type="button"
                className={cn("header__icon-button", {
                  "header__icon-button--scanning": isScanning,
                })}
                onClick={() => setShowScanModal(true)}
                data-tooltip-id={scanButtonTooltipId}
                data-tooltip-content={t("scan_games_tooltip")}
                data-tooltip-place="bottom"
              >
                <Icon name="sync" size={20} />
              </button>
            )}

            <div
              ref={searchContainerRef}
              className={cn("header__search", {
                "header__search--focused": isFocused,
                "header__search--filled": Boolean(localSearchValue),
              })}
            >
              <button
                type="button"
                className="header__search-icon"
                onClick={focusInput}
                aria-label={t("search")}
              >
                <Icon name="search" size={20} />
              </button>

              <input
                ref={inputRef}
                type="text"
                name="search"
                placeholder={
                  isOnLibraryPage ? t("search_library") : t("search")
                }
                value={localSearchValue}
                className="header__search-input"
                onChange={(event) => handleInputChange(event.target.value)}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
              />

              {localSearchValue && (
                <button
                  type="button"
                  onMouseDown={handleClearSearchMouseDown}
                  onClick={handleClearSearch}
                  className="header__search-icon"
                >
                  <Icon name="x" size={16} />
                </button>
              )}
            </div>

            <button
              type="button"
              className={cn("header__icon-button", {
                "header__icon-button--active":
                  location.pathname.startsWith("/settings"),
              })}
              onClick={() => navigate("/settings")}
              title={t("sidebar:settings")}
            >
              <Icon name="settings" size={20} />
            </button>

            <NavProfile />
          </section>
        </header>

        <AutoUpdateSubHeader />
      </div>

      {isOnLibraryPage && (
        <Tooltip id={addCustomGameTooltipId} style={{ zIndex: 1 }} />
      )}

      {isOnLibraryPage && isLibraryScanSupported && (
        <Tooltip id={scanButtonTooltipId} style={{ zIndex: 1 }} />
      )}

      <SearchDropdown
        visible={
          isDropdownVisible &&
          (localSearchValue.trim().length > 0 ||
            historyItems.length > 0 ||
            suggestions.length > 0 ||
            isLoadingSuggestions)
        }
        position={dropdownPosition}
        historyItems={historyItems}
        suggestions={suggestions}
        isLoadingSuggestions={isLoadingSuggestions}
        suggestionShop={suggestionShop}
        onSuggestionShopChange={setSuggestionShop}
        showShopSwitch={!isOnLibraryPage}
        onSelectHistory={handleSelectHistory}
        onSelectSuggestion={handleSelectSuggestion}
        onRemoveHistoryItem={handleRemoveHistoryItem}
        onClearHistory={handleClearHistory}
        onClose={handleCloseDropdown}
        activeIndex={activeIndex}
        currentQuery={deferredSearchValue}
        searchContainerRef={searchContainerRef}
      />

      <ScanGamesModal
        visible={showScanModal}
        onClose={() => setShowScanModal(false)}
        isScanning={isScanning}
        scanResult={scanResult}
        onStartScan={handleStartScan}
        onCancelScan={handleCancelScan}
        onClearResult={handleClearScanResult}
      />

      <SidebarAddingCustomGameModal
        visible={showAddGameModal}
        onClose={() => setShowAddGameModal(false)}
      />
    </>
  );
}
