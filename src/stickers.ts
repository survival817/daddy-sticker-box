import rawStickers from "../stickers.json";
import type { Env, PickResult, Sticker, StickerView } from "./types";

export const STICKERS: Sticker[] = rawStickers.map((item) => ({
  id: item.id,
  file: item.file,
  tags: [...item.tags],
  meaning: item.meaning,
  usage_hint: item.usage_hint,
}));

const TAG_WEIGHT = 10;
const TEXT_WEIGHT = 1;

export function stickerUrl(env: Env, file: string): string {
  return `https://cdn.jsdelivr.net/gh/${encodeURIComponent(env.GH_USER)}/${encodeURIComponent(env.GH_REPO)}@main/stickers/${encodeURIComponent(file)}`;
}

export function toView(env: Env, sticker: Sticker): StickerView {
  return {
    id: sticker.id,
    tags: [...sticker.tags],
    meaning: sticker.meaning,
    usage_hint: sticker.usage_hint,
    url: stickerUrl(env, sticker.file),
  };
}

export function listStickers(env: Env, tag?: string): StickerView[] {
  const wanted = tag?.trim() ?? "";
  const rows = wanted ? STICKERS.filter((sticker) => sticker.tags.includes(wanted)) : STICKERS;
  return rows.map((sticker) => toView(env, sticker));
}

export function findSticker(id: string): Sticker | undefined {
  const wanted = id.trim();
  return STICKERS.find((sticker) => sticker.id === wanted);
}

// Tags outweigh meaning and usage_hint. Substrings count, so a Chinese
// query like "有点吃醋" hits the tag "吃醋".
export function scoreSticker(sticker: Sticker, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  let score = 0;
  for (const tag of sticker.tags) {
    const needle = tag.toLowerCase();
    if (!needle) continue;
    if (q.includes(needle)) score += TAG_WEIGHT * needle.length;
    else if (needle.includes(q)) score += TAG_WEIGHT * q.length;
  }
  score += TEXT_WEIGHT * textOverlap(q, sticker.meaning.toLowerCase());
  score += TEXT_WEIGHT * textOverlap(q, sticker.usage_hint.toLowerCase());
  return score;
}

export function pickSticker(query: string, rng: () => number = Math.random): PickResult {
  let best = 0;
  const ranked: { sticker: Sticker; score: number }[] = [];
  for (const sticker of STICKERS) {
    const score = scoreSticker(sticker, query);
    ranked.push({ sticker, score });
    if (score > best) best = score;
  }
  if (best <= 0) {
    return { sticker: choose(STICKERS, rng), matched: false, score: 0 };
  }
  const top = ranked.filter((row) => row.score === best).map((row) => row.sticker);
  return { sticker: choose(top, rng), matched: true, score: best };
}

function textOverlap(query: string, text: string): number {
  const length = longestCommonRun(query, text);
  return length >= 2 ? length : 0;
}

function longestCommonRun(query: string, text: string): number {
  let best = 0;
  const qLen = query.length;
  const tLen = text.length;
  for (let i = 0; i < qLen; i++) {
    for (let j = 0; j < tLen; j++) {
      let k = 0;
      while (
        i + k < qLen &&
        j + k < tLen &&
        query.charCodeAt(i + k) === text.charCodeAt(j + k)
      ) {
        k += 1;
      }
      if (k > best) best = k;
      if (best === qLen) return best;
    }
  }
  return best;
}

function choose<T>(items: readonly T[], rng: () => number): T {
  const index = Math.floor(rng() * items.length);
  const picked = items[index];
  if (picked !== undefined) return picked;
  const first = items[0];
  if (first === undefined) throw new Error("nothing to choose");
  return first;
}
