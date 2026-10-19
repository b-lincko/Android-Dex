/**
 * Dependency-free PNG encoder used for screenshots in headless/demo mode.
 * Real captures arrive from the companion as raw H.264/PNG; when no device is
 * attached the bridge renders a deterministic "virtual desktop" frame so
 * automated screenshot tests still produce real, valid image files.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {(x:number, y:number) => [number,number,number]} pixel
 */
export function encodePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[offset] = r & 0xff;
      raw[offset + 1] = g & 0xff;
      raw[offset + 2] = b & 0xff;
      offset += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Deterministic virtual-desktop render: gradient wallpaper, taskbar, window cards. */
export function renderVirtualDesktop({ width = 1280, height = 800, accent = [58, 134, 255], windows = [] } = {}) {
  const cards = windows.length ? windows : [
    { x: 0.06, y: 0.12, w: 0.3, h: 0.62, color: [61, 220, 132] },
    { x: 0.4, y: 0.18, w: 0.38, h: 0.44, color: [29, 185, 84] },
    { x: 0.68, y: 0.5, w: 0.26, h: 0.28, color: [98, 100, 167] },
  ];
  return encodePng(width, height, (x, y) => {
    const nx = x / width;
    const ny = y / height;
    let r = Math.round(9 + nx * 8 + accent[0] * 0.06);
    let g = Math.round(10 + ny * 10 + accent[1] * 0.05);
    let b = Math.round(14 + (1 - ny) * 18 + accent[2] * 0.07);
    if (y > height - 64) { r = 18; g = 19; b = 24; }
    if (y > height - 64 && y < height - 62) { r = 55; g = 57; b = 66; }
    for (const card of cards) {
      const cx = nx * width >= card.x * width && nx * width <= (card.x + card.w) * width;
      const cy = ny * height >= card.y * height && ny * height <= (card.y + card.h) * height;
      if (cx && cy) {
        const header = ny * height < card.y * height + 26;
        if (header) { [r, g, b] = [card.color[0] * 0.5, card.color[1] * 0.5, card.color[2] * 0.5].map(Math.round); }
        else { [r, g, b] = [20, 21, 26]; }
        const borderX = Math.min(nx * width - card.x * width, (card.x + card.w) * width - nx * width);
        const borderY = Math.min(ny * height - card.y * height, (card.y + card.h) * height - ny * height);
        if (borderX < 2 || borderY < 2) [r, g, b] = card.color;
      }
    }
    return [r, g, b];
  });
}
