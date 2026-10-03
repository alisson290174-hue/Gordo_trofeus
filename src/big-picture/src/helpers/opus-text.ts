import { getPlayTimeHoursAndMinutes } from "@shared";
import { resolveBigPictureLanguage } from "../i18n";

/** Dynamic strings (numbers inside) can't go through the exact-text dictionary: pick per language. */
export const tr = (en: string, pt: string) =>
  resolveBigPictureLanguage() === "pt-BR" ? pt : en;

export const formatPlayTime = (milliseconds: number) => {
  const { hours, minutes } = getPlayTimeHoursAndMinutes(milliseconds);
  if (!hours && !minutes) return null;
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
};

export const formatLastPlayed = (date: Date | string | null | undefined) => {
  if (!date) return null;
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return tr("Played today", "Jogado hoje");
  if (days === 1) return tr("Played yesterday", "Jogado ontem");
  if (days < 30) return tr(`Played ${days} days ago`, `Jogado há ${days} dias`);
  const months = Math.floor(days / 30);
  return months <= 1
    ? tr("Played a month ago", "Jogado há um mês")
    : tr(`Played ${months} months ago`, `Jogado há ${months} meses`);
};
