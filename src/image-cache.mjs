// On-disk cache for TMDB artwork.
//
// The image path and the bytes both come from the network (the TMDB catalogue and
// the TMDB image CDN), so nothing is written unless:
//  - the size is one of the TMDB sizes we request,
//  - the path is a single TMDB file name (no directories, no traversal),
//  - the response declares an allow-listed image Content-Type,
//  - the body stays under a size cap and its magic bytes match the declared type.
// Cache files are named by a SHA-256 of size + path; the network-supplied file name
// is never used on disk. The extension comes only from the validated image type.
// Files are written atomically (temp file + rename) so a half-written image is never served.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const IMAGE_SIZES = new Set(["w342", "w500", "w780", "w1280"]);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const ALLOWED_CONTENT_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const EXT_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const TMDB_PATH = /^\/([A-Za-z0-9_-]{1,128})\.(jpg|jpeg|png|webp)$/;

// Returns the bare file name for a TMDB image path such as "/abc123.jpg", or null.
export function safeImageName(tmdbPath) {
  const match = typeof tmdbPath === "string" ? TMDB_PATH.exec(tmdbPath) : null;
  return match ? `${match[1]}.${match[2].toLowerCase()}` : null;
}

// Expected MIME type for a validated TMDB path, from its allow-listed extension.
export function expectedType(tmdbPath) {
  const name = safeImageName(tmdbPath);
  return name ? EXT_TYPES[name.slice(name.lastIndexOf(".") + 1)] : null;
}

// Normalises a Content-Type header to a bare, allow-listed MIME type, or null.
export function allowedContentType(header) {
  if (typeof header !== "string") return null;
  const type = header.split(";")[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(type) ? type : null;
}

// Resolves the cache file for a size and TMDB path, or null if either is not allowed.
// The file name is sha256(size + NUL + path) plus an extension from the allow-list.
export function cacheFile(dataDir, size, tmdbPath) {
  const type = expectedType(tmdbPath);
  if (!IMAGE_SIZES.has(size) || !type) return null;
  const hash = crypto.createHash("sha256").update(`${size}\0${safeImageName(tmdbPath)}`).digest("hex");
  const root = path.resolve(dataDir, "images", size);
  const file = path.join(root, `${hash}.${ALLOWED_CONTENT_TYPES.get(type)}`);
  return path.dirname(file) === root ? file : null;
}

// Detects the image type from its magic bytes; returns a MIME type or null.
export function imageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

async function readLimited(response, limit) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error("image too large");
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > limit) throw new Error("image too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

// Returns { buffer, type } for a TMDB image, from the cache when present, otherwise
// fetched from `${imageBase}/${size}${tmdbPath}` and cached after validation.
export async function cachedTmdbImage({ dataDir, imageBase, size, tmdbPath, fetchImpl = fetch, timeoutMs = 15_000 }) {
  const file = cacheFile(dataDir, size, tmdbPath);
  const name = safeImageName(tmdbPath);
  const expected = expectedType(tmdbPath);
  if (!file || !name || !expected) throw new Error("invalid image path");

  try {
    const cached = await fs.readFile(file);
    const type = imageType(cached);
    if (type === expected) return { buffer: cached, type };
  } catch {
    // not cached yet
  }

  const response = await fetchImpl(`${imageBase}/${size}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`image ${response.status}`);
  const declared = allowedContentType(response.headers.get("content-type"));
  if (!declared) throw new Error("response is not an image");
  if (declared !== expected) throw new Error("image type mismatch");
  const buffer = await readLimited(response, MAX_IMAGE_BYTES);
  const type = imageType(buffer);
  if (!type) throw new Error("response is not an image");
  if (type !== declared) throw new Error("image type mismatch");

  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(temp, buffer, { flag: "wx" });
    await fs.rename(temp, file).catch(async (error) => {
      await fs.rm(temp, { force: true });
      throw error;
    });
  } catch {
    // caching is best effort; still serve the validated image
  }
  return { buffer, type };
}
