export interface Sticker {
  id: string;
  file: string;
  tags: string[];
  meaning: string;
  usage_hint: string;
}

export interface Env {
  GH_USER: string;
  GH_REPO: string;
}

export interface StickerView {
  id: string;
  tags: string[];
  meaning: string;
  usage_hint: string;
  url: string;
}

export interface PickResult {
  sticker: Sticker;
  matched: boolean;
  score: number;
}
