// Tiny dependency-free PNG encoder for generated posters, backdrops and avatars.
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

// Two-tone diagonal gradient with soft horizontal bands, seeded by the item id.
export function artwork(key, width, height) {
  const hash = createHash("md5").update(String(key)).digest();
  const hue = (hash[0] / 255) * 360;
  const top = hsl(hue, 0.55, 0.42);
  const bottom = hsl((hue + 40 + (hash[1] / 255) * 80) % 360, 0.6, 0.18);
  const bands = 2 + (hash[2] % 4);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x += 1) {
      const t = Math.min(1, Math.max(0, (y / height) * 0.8 + (x / width) * 0.2));
      const band = 0.06 * Math.sin((y / height) * Math.PI * bands * 2);
      for (let c = 0; c < 3; c += 1) {
        raw[offset++] = Math.max(0, Math.min(255, Math.round(top[c] * (1 - t) + bottom[c] * t + band * 255)));
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
