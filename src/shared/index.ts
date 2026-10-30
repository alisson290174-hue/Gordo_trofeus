import {
  ptBR,
  enUS,
  es,
  fr,
  pl,
  hu,
  tr,
  ru,
  it,
  be,
  zhCN,
  da,
  el,
  vi,
  ja,
  sl,
} from "date-fns/locale";

import { charMap } from "./char-map";
import { format } from "date-fns";
import { AchievementNotificationInfo } from "@types";
import { getAchievementTier } from "./achievement-tier";

export * from "./archive-org";
export * from "./constants";
export {
  shouldAutoStartSteamSync,
  type SteamAutoStartRunStatus,
} from "./should-auto-start-steam-sync";
export * from "./steam-session";
export * from "./window-layout";
export {
  getDisplayedPlayTimeInMilliseconds,
  getPlayTimeHoursAndMinutes,
  mergeLocalAndRemotePlayTime,
} from "./playtime";
export * from "./cloud-save-access";
export * from "./controller-support";
export * from "./artwork-resolver";
export * from "./download-directories";
export * from "./html-sanitizer";
export * from "./language-flags";
export * from "./use-souvenir-content-warning";
export * from "./retroarch-platform";
export * from "./tracker-list";
export * from "./souvenirs";
export * from "./souvenir-sync";
export * from "./achievement-tier";
export * from "./game-title";

export class UserNotLoggedInError extends Error {
  constructor() {
    super("user not logged in");
    this.name = "UserNotLoggedInError";
  }
}

export class SubscriptionRequiredError extends Error {
  constructor() {
    super("user does not have hydra cloud subscription");
    this.name = "SubscriptionRequiredError";
  }
}

const FORMAT = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || isNaN(bytes) || bytes <= 0) {
    return `0 ${FORMAT[0]}`;
  }

  const byteKBase = 1024;

  const base = Math.floor(Math.log(bytes) / Math.log(byteKBase));

  const formatedByte = bytes / byteKBase ** base;

  return `${Math.trunc(formatedByte * 10) / 10} ${FORMAT[base]}`;
};

export const parseBytes = (sizeString: string | null): number | null => {
  if (!sizeString) return null;

  const regex = /^([\d.,]+)\s*([A-Za-z]+)$/;
  const match = regex.exec(sizeString.trim());
  if (!match) return null;

  const value = Number.parseFloat(match[1].replaceAll(",", "."));
  const unit = match[2].toUpperCase();

  if (Number.isNaN(value)) return null;

  const unitIndex = FORMAT.indexOf(unit);
  if (unitIndex === -1) return null;

  const byteKBase = 1024;
  return Math.round(value * Math.pow(byteKBase, unitIndex));
};

export const formatBytesToMbps = (bytesPerSecond: number): string => {
  const bitsPerSecond = bytesPerSecond * 8;
  const mbps = bitsPerSecond / 1e6;
  return `${Math.trunc(mbps * 10) / 10} Mbps`;
};

export const pipe =
  <T>(...fns: ((arg: T) => any)[]) =>
  (arg: T) =>
    fns.reduce((prev, fn) => fn(prev), arg);

export const removeReleaseYearFromName = (name: string) =>
  name.replace(/\(\d{4}\)/g, "");

export const removeSymbolsFromName = (name: string) =>
  name.replace(/[^A-Za-z 0-9]/g, "");

export const removeSpecialEditionFromName = (name: string) =>
  name.replace(
    /(The |Digital )?(GOTY|Deluxe|Standard|Ultimate|Definitive|Enhanced|Collector's|Premium|Digital|Limited|Game of the Year|Reloaded|[0-9]{4}) Edition/gi,
    ""
  );

export const removeDuplicateSpaces = (name: string) =>
  name.replace(/\s{2,}/g, " ");

export const replaceDotsWithSpace = (name: string) => name.replace(/\./g, " ");

export const replaceNbspWithSpace = (name: string) =>
  name.replace(new RegExp(String.fromCharCode(160), "g"), " ");

export const replaceUnderscoreWithSpace = (name: string) =>
  name.replace(/_/g, " ");

const charMapPattern = new RegExp(Object.keys(charMap).join("|"), "g");

const COMBINING_MARKS = /[\u0300-\u036f]/g;

export const removeDiacritics = (value: string) =>
  value
    .normalize("NFC")
    .replace(charMapPattern, (match) => charMap[match])
    .normalize("NFD")
    .replace(COMBINING_MARKS, "");

export const formatName = pipe<string>(
  (str) => str.replace(charMapPattern, (match) => charMap[match]),
  (str) => str.toLowerCase(),
  removeReleaseYearFromName,
  removeSpecialEditionFromName,
  replaceUnderscoreWithSpace,
  replaceDotsWithSpace,
  replaceNbspWithSpace,
  (str) => str.replace(/DIRECTOR'S CUT/gi, ""),
  (str) => str.replace(/Friend's Pass/gi, ""),
  removeSymbolsFromName,
  removeDuplicateSpaces,
  (str) => str.trim()
);

export const getDateLocale = (language: string) => {
  if (language.startsWith("pt")) return ptBR;
  if (language.startsWith("es")) return es;
  if (language.startsWith("fr")) return fr;
  if (language.startsWith("hu")) return hu;
  if (language.startsWith("pl")) return pl;
  if (language.startsWith("tr")) return tr;
  if (language.startsWith("ru")) return ru;
  if (language.startsWith("it")) return it;
  if (language.startsWith("be")) return be;
  if (language.startsWith("zh")) return zhCN;
  if (language.startsWith("da")) return da;
  if (language.startsWith("el")) return el;
  if (language.startsWith("vi")) return vi;
  if (language.startsWith("ja")) return ja;
  if (language.startsWith("sl")) return sl;

  return enUS;
};

export const getReviewTranslationLanguage = (language: string) =>
  language.split("-")[0].toLowerCase();

export const formatDate = (
  date: number | Date | string,
  language: string
): string => {
  if (isNaN(new Date(date).getDate())) return "N/A";
  return format(date, language == "en" ? "MM-dd-yyyy" : "dd/MM/yyyy");
};

export const generateAchievementCustomNotificationTest = (
  t: any,
  language: string | undefined,
  iconUrl: string,
  options: {
    isHidden?: boolean;
    isPlatinum?: boolean;
    globalUnlockPercent?: number | null;
  } = {}
): AchievementNotificationInfo => {
  const globalUnlockPercent = options.globalUnlockPercent ?? null;
  const isPlatinum = options.isPlatinum ?? false;

  return {
    title: t("test_achievement_notification_title", {
      ns: "notifications",
      lng: language ?? "en",
    }),
    description: t("test_achievement_notification_description", {
      ns: "notifications",
      lng: language ?? "en",
    }),
    iconUrl,
    points: 2440,
    isHidden: options.isHidden ?? false,
    isRare:
      getAchievementTier({ isPlatinum: false, globalUnlockPercent }) === "gold",
    isPlatinum,
    globalUnlockPercent,
  };
};
export * from "./emulator-systems";
export * from "./local-url";
