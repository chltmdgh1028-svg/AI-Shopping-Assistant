// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildContactSheet, labelSvg, planTiles, SHEET, TILE, tileImage, tileLabel } from "@/services/extraction/imageProcessing";

/** A white page with rows of dark text-like bars: what a size chart or a notice looks like. */
async function tableImage(width: number, height: number) {
  const bars = Array.from({ length: Math.floor(height / 60) }, (_, row) => `<rect x="40" y="${row * 60 + 20}" width="${width - 80}" height="14" fill="#222"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/>${bars}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

/** A fully coloured picture: what a photograph looks like to a "mostly white?" check. */
const photoImage = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#7a5c46" } }).jpeg().toBuffer();

describe("planTiles", () => {
  it("reads a normal image as one piece", () => {
    expect(planTiles(900)).toEqual([{ top: 0, height: 900 }]);
    expect(planTiles(TILE.singleTileMaxHeight)).toHaveLength(1);
  });

  it("cuts a long image into overlapping tiles that cover it from top to bottom", () => {
    const plan = planTiles(5000);
    expect(plan.length).toBeGreaterThan(3);
    expect(plan[0].top).toBe(0);
    const last = plan[plan.length - 1];
    expect(last.top + last.height).toBe(5000);

    for (const [index, tile] of plan.entries()) {
      expect(tile.height).toBeLessThanOrEqual(TILE.tileHeight);
      if (index > 0) {
        const previous = plan[index - 1];
        // Neighbouring tiles share some rows, and no gap is left between them.
        expect(tile.top).toBeLessThan(previous.top + previous.height);
        expect(tile.top).toBeGreaterThan(previous.top);
      }
    }
  });

  it("never makes more tiles than the cap, however tall the image", () => {
    expect(planTiles(60_000).length).toBeLessThanOrEqual(TILE.maxTilesPerImage);
  });
});

describe("tileImage", () => {
  it("splits a long image into labelled tiles that each keep the width", async () => {
    const tiles = await tileImage(await tableImage(860, 5000), 3);
    expect(tiles.map((tile) => tile.label)).toEqual(tiles.map((_, index) => `3-${index + 1}`));
    expect(tiles.every((tile) => tile.tileCount === tiles.length && tile.imageIndex === 3)).toBe(true);
    for (const tile of tiles) {
      expect(tile.width).toBe(860);
      expect(tile.height).toBeLessThanOrEqual(TILE.tileHeight);
      expect((await sharp(tile.bytes).metadata()).height).toBe(tile.height);
    }
  });

  it("labels a one-piece image with just its number", async () => {
    const [tile] = await tileImage(await tableImage(800, 900), 12);
    expect(tile.label).toBe("12");
    expect(tileLabel(12, 1, 1)).toBe("12");
    expect(tileLabel(12, 2, 4)).toBe("12-2");
  });

  it("scales a very wide image down to a readable width and compresses it as JPEG", async () => {
    const original = await tableImage(2400, 1200);
    const [tile] = await tileImage(original, 1);
    expect(tile.width).toBe(TILE.maxWidth);
    expect(tile.bytes[0]).toBe(0xff);
    expect(tile.bytes[1]).toBe(0xd8);
    expect(tile.bytes.length).toBeLessThan(original.length);
  });

  it("never enlarges a small image", async () => {
    const [tile] = await tileImage(await tableImage(500, 400), 1);
    expect(tile.width).toBe(500);
  });

  it("makes a thumbnail that fits the contact-sheet cell", async () => {
    const [tile] = await tileImage(await tableImage(1000, 1400), 1);
    const meta = await sharp(tile.thumb).metadata();
    expect(meta.width).toBeLessThanOrEqual(TILE.thumbWidth);
    expect(meta.height).toBeLessThanOrEqual(TILE.thumbMaxHeight);
  });

  it("scores a white page of text far above a photograph or a blank page", async () => {
    const [table] = await tileImage(await tableImage(800, 900), 1);
    const [photo] = await tileImage(await photoImage(800, 900), 2);
    const [blank] = await tileImage(await sharp({ create: { width: 800, height: 900, channels: 3, background: "#fff" } }).jpeg().toBuffer(), 3);
    expect(table.score).toBeGreaterThan(0.5);
    expect(photo.score).toBeLessThan(0.1);
    expect(blank.score).toBeLessThan(table.score);
  });

  it("rejects bytes that are not an image", async () => {
    await expect(tileImage(Buffer.from("this is not an image"), 1)).rejects.toThrow();
  });
});

describe("contact sheet", () => {
  const cell = async (label: string) => ({ label, thumb: await sharp({ create: { width: 300, height: 380, channels: 3, background: "#4a6fa5" } }).jpeg().toBuffer() });

  it("lays the cells out in a grid", async () => {
    const cells = await Promise.all(["1", "2", "3", "4", "5"].map(cell));
    const meta = await sharp(await buildContactSheet(cells)).metadata();
    const slotW = SHEET.cellWidth + SHEET.gap;
    const slotH = SHEET.cellHeight + SHEET.gap;
    expect(meta.width).toBe(SHEET.columns * slotW + SHEET.gap);
    expect(meta.height).toBe(2 * slotH + SHEET.gap); // five cells in four columns: two rows
  });

  it("draws each cell's number as a yellow badge in its corner", async () => {
    const sheet = await buildContactSheet([await cell("17-2"), await cell("8")]);
    const { data, info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [data[(y * info.width + x) * info.channels], data[(y * info.width + x) * info.channels + 1], data[(y * info.width + x) * info.channels + 2]];

    // Just inside the first cell's top-left corner is the badge background, not the blue thumbnail.
    const [r, g, b] = pixel(SHEET.gap + 3, SHEET.gap + 3);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(180);
    expect(b).toBeLessThan(140);
    // The same spot in the second cell is a badge too, and the middle of a cell is the thumbnail.
    const [r2] = pixel(SHEET.cellWidth + 2 * SHEET.gap + 3, SHEET.gap + 3);
    expect(r2).toBeGreaterThan(200);
    const [rm] = pixel(SHEET.gap + 150, SHEET.gap + 200);
    expect(rm).toBeLessThan(120);
  });

  it("holds a full sheet within a size a model can take in one image", async () => {
    const cells = await Promise.all(Array.from({ length: SHEET.cellsPerSheet }, (_, index) => cell(String(index + 1))));
    const sheet = await buildContactSheet(cells);
    const meta = await sharp(sheet).metadata();
    expect(meta.width).toBeLessThan(1500);
    expect(meta.height).toBeLessThan(1500);
    expect(sheet.length).toBeLessThan(500_000);
  });
});

describe("label badge", () => {
  it("is drawn from shapes, not text, so it does not depend on installed fonts", () => {
    const svg = labelSvg("17-2");
    expect(svg).toContain("<rect");
    expect(svg).not.toContain("<text");
  });

  it("grows with the label and ignores characters it cannot draw", () => {
    const width = (label: string) => Number(labelSvg(label).match(/ width="(\d+)"/)?.[1]);
    expect(width("17-2")).toBeGreaterThan(width("7"));
    expect(labelSvg("a7b")).toEqual(labelSvg("7"));
  });

  it("renders to a real image", async () => {
    const meta = await sharp(Buffer.from(labelSvg("123-4"))).metadata();
    expect(meta.width).toBeGreaterThan(60);
    expect(meta.height).toBeGreaterThan(30);
  });
});
