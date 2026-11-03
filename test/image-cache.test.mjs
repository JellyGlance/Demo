import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { allowedContentType, cacheFile, cachedTmdbImage, imageType, safeImageName, MAX_IMAGE_BYTES } from "../src/image-cache.mjs";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "jg-images-"));
const JPEG_HEADERS = { headers: { "content-type": "image/jpeg" } };
const serve = (body, init = JPEG_HEADERS) => async () => new Response(body, init);
const hashName = (size, name, ext) => `${crypto.createHash("sha256").update(`${size}\0${name}`).digest("hex")}.${ext}`;

test("only plain TMDB file names are accepted", () => {
  assert.equal(safeImageName("/abc_DEF-123.jpg"), "abc_DEF-123.jpg");
  for (const bad of ["../etc/passwd", "/../../x.jpg", "/a/b.jpg", "/x.js", "/x.jpg?y", "x.jpg", "/.jpg", "/%2e%2e.jpg", null, 42]) {
    assert.equal(safeImageName(bad), null, String(bad));
  }
});

test("cache files stay inside the cache directory and sizes are allow-listed", () => {
  assert.equal(cacheFile("/data", "w500", "/a.jpg"), path.resolve("/data/images/w500", hashName("w500", "a.jpg", "jpg")));
  assert.equal(cacheFile("/data", "w500", "/a.jpeg"), path.resolve("/data/images/w500", hashName("w500", "a.jpeg", "jpg")));
  assert.notEqual(path.basename(cacheFile("/data", "w342", "/a.jpg")), path.basename(cacheFile("/data", "w500", "/a.jpg")));
  assert.equal(cacheFile("/data", "../../tmp", "/a.jpg"), null);
  assert.equal(cacheFile("/data", "original", "/a.jpg"), null);
  assert.equal(cacheFile("/data", "w500", "/../a.jpg"), null);
});

test("image type comes from magic bytes", () => {
  assert.equal(imageType(JPEG), "image/jpeg");
  assert.equal(imageType(PNG), "image/png");
  assert.equal(imageType(Buffer.from("<html><script>alert(1)</script></html>")), null);
});

test("valid images are fetched, cached and served from cache", async () => {
  const dir = await tmp();
  let calls = 0;
  const fetchImpl = async (url) => { calls++; assert.equal(url, "https://img/w342/p.jpg"); return new Response(JPEG, JPEG_HEADERS); };
  const first = await cachedTmdbImage({ dataDir: dir, imageBase: "https://img", size: "w342", tmdbPath: "/p.jpg", fetchImpl });
  assert.equal(first.type, "image/jpeg");
  const second = await cachedTmdbImage({ dataDir: dir, imageBase: "https://img", size: "w342", tmdbPath: "/p.jpg", fetchImpl });
  assert.deepEqual(second.buffer, JPEG);
  assert.equal(calls, 1);
  assert.deepEqual(await fs.readdir(path.join(dir, "images", "w342")), [hashName("w342", "p.jpg", "jpg")]);
});

test("untrusted paths and non-image responses are never written", async () => {
  const dir = await tmp();
  await assert.rejects(cachedTmdbImage({ dataDir: dir, imageBase: "https://img", size: "w342", tmdbPath: "/../../evil.jpg", fetchImpl: serve(JPEG) }));
  await assert.rejects(cachedTmdbImage({ dataDir: dir, imageBase: "https://img", size: "w342", tmdbPath: "/p.jpg", fetchImpl: serve("<html>nope</html>") }), /not an image/);
  await assert.rejects(cachedTmdbImage({ dataDir: dir, imageBase: "https://img", size: "w342", tmdbPath: "/p.jpg", fetchImpl: serve(JPEG, { headers: { "content-type": "text/html" } }) }), /not an image/);
  await assert.rejects(cachedTmdbImage({ dataDir: dir, imageBase: "https://img", size: "w342", tmdbPath: "/p.jpg", fetchImpl: serve(JPEG, {}) }), /not an image/);
  await assert.rejects(cachedTmdbImage({ dataDir: dir, imageBase: "https://img", size: "w342", tmdbPath: "/p.jpg", fetchImpl: serve(PNG, { headers: { "content-type": "image/png" } }) }), /mismatch/);
  await assert.rejects(cachedTmdbImage({ dataDir: dir, imageBase: "https://img", size: "w342", tmdbPath: "/p.jpg", fetchImpl: serve(PNG) }), /mismatch/);
  await assert.rejects(cachedTmdbImage({ dataDir: dir, imageBase: "https://img", size: "w342", tmdbPath: "/p.jpg", fetchImpl: serve(Buffer.concat([JPEG, Buffer.alloc(MAX_IMAGE_BYTES)])) }), /too large/);
  await assert.rejects(cachedTmdbImage({ dataDir: dir, imageBase: "https://img", size: "w342", tmdbPath: "/p.jpg", fetchImpl: serve(JPEG, { status: 404 }) }), /404/);
  assert.deepEqual(await fs.readdir(dir), []);
});

test("content types are normalised and allow-listed", () => {
  assert.equal(allowedContentType("image/JPEG; charset=binary"), "image/jpeg");
  assert.equal(allowedContentType("image/webp"), "image/webp");
  for (const bad of ["image/svg+xml", "text/html", "", null, undefined]) assert.equal(allowedContentType(bad), null, String(bad));
});
