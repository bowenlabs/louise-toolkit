// A tiny PNG encoder for the alt-text fixtures: flat shapes on a flat
// background, drawn at run time so the eval needs no image files, and each
// image has an answer a check can hold the model to (its colors and shapes).
// Node built-ins only.

import { crc32, deflateSync } from "node:zlib";

const COLORS = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [220, 30, 30],
  green: [30, 160, 60],
  blue: [30, 70, 210],
  yellow: [245, 205, 20],
  orange: [245, 130, 20],
  purple: [130, 50, 170],
};

/** Whether pixel (x, y) is inside `shape`. */
function inside(shape, x, y) {
  switch (shape.kind) {
    case "circle":
      return (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.r ** 2;
    case "rect":
      return x >= shape.x && x < shape.x + shape.w && y >= shape.y && y < shape.y + shape.h;
    case "triangle": {
      // Apex at the top center of its box, base along the bottom.
      const t = (y - shape.y) / shape.h;
      const half = (shape.w / 2) * t;
      const mid = shape.x + shape.w / 2;
      return t >= 0 && t <= 1 && x >= mid - half && x <= mid + half;
    }
    default:
      throw new Error(`Unknown shape: ${shape.kind}`);
  }
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Draw `shapes` (later ones on top) over `background`, as PNG bytes. */
export function drawPng({ size = 256, background = "white", shapes }) {
  const row = 1 + size * 3; // a filter byte, then RGB
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = COLORS[background];
      for (const s of shapes) if (inside(s, x, y)) color = COLORS[s.color];
      raw.set(color, y * row + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolor, no interlace
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
