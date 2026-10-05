const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const isSubsequence = (title: string, query: string) => {
  let index = 0;
  for (let i = 0; i < title.length && index < query.length; i++) {
    if (title[i] === query[index]) index++;
  }
  return index === query.length;
};

/**
 * Library search. Titles containing every typed word win ("mario" → Mario games only); the loose
 * in-order-letters match only kicks in when nothing contains the words, so typos still find games
 * without flooding real queries with unrelated titles (Mercenaries, Rayman… for "mario").
 */
export const filterGamesBySearch = <T extends { title?: string | null }>(
  games: T[],
  rawQuery: string
): T[] => {
  const query = normalize(rawQuery).trim();
  if (!query) return games;

  const words = query.split(/\s+/);
  const contained = games.filter((game) => {
    const title = normalize(game.title ?? "");
    return words.every((word) => title.includes(word));
  });
  if (contained.length > 0) return contained;

  const compactQuery = query.replace(/\s+/g, "");
  return games.filter((game) =>
    isSubsequence(normalize(game.title ?? ""), compactQuery)
  );
};
