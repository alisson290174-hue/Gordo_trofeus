/**
 * Dev check: which of the user's emulator games have a translation in the online repositories,
 * and which repository files almost match (so the title matcher can be improved).
 * Usage: npx tsx scripts/dev/translation-coverage.ts <library.json>
 */
import fs from "node:fs";
import path from "node:path";

import { matchGameByName, titleWords } from "../../src/main/services/emulators/translation-rules";

const REPOS: { test: RegExp; repo: string; dir: string }[] = [
  { test: /nintendo 64/i, repo: "Traducao-N64", dir: "" },
  { test: /nintendo ds/i, repo: "Traducao-NDS", dir: "" },
  { test: /game\s*boy advance/i, repo: "GBA", dir: "" },
  { test: /playstation portable/i, repo: "Traducao-PSP", dir: "" },
  { test: /^playstation$/i, repo: "Traducao-PS1", dir: "" },
  { test: /playstation 2/i, repo: "Traducao-PS2", dir: "" },
  { test: /wii/i, repo: "Traducao-Wii", dir: "" },
  { test: /gamecube/i, repo: "Traducoes", dir: "GC" },
  { test: /super nintendo/i, repo: "Traducoes", dir: "SNES" },
  { test: /nintendo switch/i, repo: "Traducao-NS", dir: "" },
  { test: /nintendo 3ds/i, repo: "Traducoes", dir: "3DS" },
];

const library = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as { title: string; platform: string | null }[];
const listings = new Map<string, string[]>();
const list = async (repo: string, dir: string) => {
  const key = `${repo}/${dir}`;
  if (!listings.has(key)) {
    const url = `https://huggingface.co/api/models/Joao13TraducoesDublagens/${repo}/tree/main${dir ? `/${encodeURIComponent(dir)}` : ""}`;
    const items = (await (await fetch(url)).json()) as { path: string }[];
    listings.set(key, Array.isArray(items) ? items.map((i) => path.basename(i.path)).filter((n) => /\.(rar|zip|7z)$/i.test(n)) : []);
  }
  return listings.get(key)!;
};

let found = 0;
const near: string[] = [];
for (const game of library) {
  const source = REPOS.find((r) => r.test.test(game.platform ?? ""));
  if (!source || /PT-?BR/i.test(game.title)) continue;
  const files = await list(source.repo, source.dir);
  const hit = files.find((file) => matchGameByName(file, [game]));
  if (hit) {
    found += 1;
    console.log(`ACHA   ${game.platform} | ${game.title}  ->  ${hit}`);
    continue;
  }
  const words = new Set(titleWords(game.title));
  for (const file of files) {
    const fileWords = [...titleWords(file)];
    const shared = fileWords.filter((w) => words.has(w)).length;
    if (shared >= Math.max(2, Math.ceil(words.size * 0.6))) near.push(`QUASE  ${game.platform} | ${game.title}  ~  ${file}`);
  }
}
console.log(`\n${found} jogos com tradução encontrada`);
console.log(near.join("\n"));
