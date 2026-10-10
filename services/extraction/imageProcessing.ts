import type { OverlayOptions } from "sharp";

type Sharp = typeof import("sharp").default;
let sharpModule: Promise<Sharp> | undefined;

/** sharp is a native module. It is loaded on first use, so a platform without its binary loses only the image stage. */
const loadSharp = () => (sharpModule ??= import("sharp").then((module) => module.default));

export const TILE = {
  /** Wider images are scaled down to this: text stays readable but the request stays small. */
  maxWidth: 1000,
  /** Height of one tile of a long image. Roughly a screenful, so a table is rarely cut in two. */
  tileHeight: 1400,
  /** Rows shared by neighbouring tiles, so a line of text on a boundary is whole in at least one of them. */
  overlap: 120,
  /** An image up to this tall is read as one piece. */
  singleTileMaxHeight: 1700,
  maxTilesPerImage: 12,
  jpegQuality: 78,
  thumbWidth: 320,
  thumbMaxHeight: 420,
  thumbQuality: 62,
  maxInputPixels: 80_000_000,
} as const;

export type Tile = {
  /** 1-based position of the image in the page's detail section. */
  imageIndex: number;
  /** 1-based position of the tile within its image. */
  tileIndex: number;
  tileCount: number;
  /** "17" for a whole image, "17-2" for the second tile of image 17. */
  label: string;
  width: number;
  height: number;
  /** The tile as sent for the detailed read. */
  bytes: Buffer;
  /** A small version, for the contact sheet. */
  thumb: Buffer;
  /** How much it looks like a table or a notice (white page, dark text) and not like a photograph. 0..1. */
  score: number;
};

export function tileLabel(imageIndex: number, tileIndex: number, tileCount: number) {
  return tileCount > 1 ? `${imageIndex}-${tileIndex}` : String(imageIndex);
}

/** Where to cut an image of this (already resized) height. Pure, so the layout is testable without any pixels. */
export function planTiles(height: number): Array<{ top: number; height: number }> {
  if (height <= TILE.singleTileMaxHeight) return [{ top: 0, height }];

  const step = TILE.tileHeight - TILE.overlap;
  const plan: Array<{ top: number; height: number }> = [];
  let top = 0;
  while (top + TILE.tileHeight < height && plan.length < TILE.maxTilesPerImage - 1) {
    plan.push({ top, height: TILE.tileHeight });
    top += step;
  }
  // The last tile is pinned to the bottom edge, so nothing at the end of the image is lost.
  const last = Math.max(0, height - TILE.tileHeight);
  plan.push({ top: last, height: height - last });
  return plan;
}

const open = (sharp: Sharp, input: Buffer) => sharp(input, { limitInputPixels: TILE.maxInputPixels, failOn: "none" });

/** How much a thumbnail looks like text on a white page: share of near-white pixels, discounted when nothing dark is on it. */
async function looksLikeInfo(sharp: Sharp, thumb: Buffer) {
  // Nearest-neighbour sampling: averaging would blur thin text into grey and hide that the page is mostly white.
  const raw = await sharp(thumb).resize({ width: 48, kernel: "nearest" }).greyscale().raw().toBuffer();
  let white = 0;
  let dark = 0;
  for (const value of raw) {
    if (value > 225) white += 1;
    else if (value < 90) dark += 1;
  }
  const whiteRatio = white / raw.length;
  const darkRatio = dark / raw.length;
  // A blank page has nothing to read; a photograph has little white. Text on a white page has both.
  return Math.round(whiteRatio * (darkRatio > 0.004 ? 1 : 0.3) * 100) / 100;
}

/**
 * Cuts one downloaded image into the tiles that will be read. Long images become several tiles with a little overlap;
 * wide ones are scaled to a width at which text is still legible. Throws when the file cannot be decoded.
 */
export async function tileImage(input: Buffer, imageIndex: number): Promise<Tile[]> {
  const sharp = await loadSharp();
  const meta = await open(sharp, input).metadata();
  if (!meta.width || !meta.height) throw new Error("image has no size");

  const scale = Math.min(1, TILE.maxWidth / meta.width);
  const width = Math.max(1, Math.round(meta.width * scale));
  const height = Math.max(1, Math.round(meta.height * scale));
  const plan = planTiles(height);

  const tiles: Tile[] = [];
  for (const [position, cut] of plan.entries()) {
    const tileHeight = Math.max(1, Math.min(cut.height, height - cut.top));
    let pipeline = open(sharp, input).resize({ width, withoutEnlargement: true });
    // Only crop when there is something to crop: a single tile is the whole (resized) image.
    if (plan.length > 1) pipeline = pipeline.extract({ left: 0, top: cut.top, width, height: tileHeight });
    const bytes = await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: TILE.jpegQuality }).toBuffer();
    const thumb = await sharp(bytes).resize({ width: TILE.thumbWidth, height: TILE.thumbMaxHeight, fit: "inside" }).jpeg({ quality: TILE.thumbQuality }).toBuffer();
    tiles.push({
      imageIndex,
      tileIndex: position + 1,
      tileCount: plan.length,
      label: tileLabel(imageIndex, position + 1, plan.length),
      width,
      height: tileHeight,
      bytes,
      thumb,
      score: await looksLikeInfo(sharp, thumb),
    });
  }
  return tiles;
}

// Seven-segment digits drawn as rectangles: no font is needed, so the number is legible wherever this runs.
const segments: Record<string, string> = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg" };
const DIGIT = { width: 16, height: 28, thick: 4, gap: 6, pad: 6 };

/** An SVG badge showing a label such as "17-2": black digits on yellow. */
export function labelSvg(label: string): string {
  const { width, height, thick, gap, pad } = DIGIT;
  const chars = [...label].filter((char) => char === "-" || segments[char]);
  const total = pad * 2 + chars.length * width + Math.max(0, chars.length - 1) * gap;
  const rects: string[] = [];

  chars.forEach((char, index) => {
    const x = pad + index * (width + gap);
    const y = pad;
    const horizontal = (top: number) => `<rect x="${x}" y="${y + top}" width="${width}" height="${thick}"/>`;
    const vertical = (left: number, top: number) => `<rect x="${x + left}" y="${y + top}" width="${thick}" height="${height / 2 - thick / 2}"/>`;
    if (char === "-") {
      rects.push(horizontal(height / 2 - thick / 2));
      return;
    }
    const on = segments[char];
    if (on.includes("a")) rects.push(horizontal(0));
    if (on.includes("g")) rects.push(horizontal(height / 2 - thick / 2));
    if (on.includes("d")) rects.push(horizontal(height - thick));
    if (on.includes("f")) rects.push(vertical(0, 0));
    if (on.includes("b")) rects.push(vertical(width - thick, 0));
    if (on.includes("e")) rects.push(vertical(0, height / 2 + thick / 2));
    if (on.includes("c")) rects.push(vertical(width - thick, height / 2 + thick / 2));
  });

  const w = Math.max(total, pad * 2 + width);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height + pad * 2}"><rect width="100%" height="100%" fill="#ffe14a"/><g fill="#000">${rects.join("")}</g></svg>`;
}

export const SHEET = { columns: 4, cellWidth: TILE.thumbWidth, cellHeight: TILE.thumbMaxHeight, gap: 8, cellsPerSheet: 12 } as const;

/**
 * Packs thumbnails into one image, each with its number drawn in the corner, so a model can say "17-2 looks like a size
 * table" from a single low-resolution picture instead of reading every image.
 */
export async function buildContactSheet(cells: Array<{ label: string; thumb: Buffer }>, columns: number = SHEET.columns): Promise<Buffer> {
  const sharp = await loadSharp();
  const rows = Math.max(1, Math.ceil(cells.length / columns));
  const slotW = SHEET.cellWidth + SHEET.gap;
  const slotH = SHEET.cellHeight + SHEET.gap;
  const composites: OverlayOptions[] = [];

  for (const [index, cell] of cells.entries()) {
    const left = (index % columns) * slotW + SHEET.gap;
    const top = Math.floor(index / columns) * slotH + SHEET.gap;
    composites.push({ input: cell.thumb, left, top });
    composites.push({ input: Buffer.from(labelSvg(cell.label)), left, top });
  }

  return sharp({ create: { width: columns * slotW + SHEET.gap, height: rows * slotH + SHEET.gap, channels: 3, background: "#c9c9c9" } })
    .composite(composites)
    .jpeg({ quality: 70 })
    .toBuffer();
}
