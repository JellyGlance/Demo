import test from "node:test";
import assert from "node:assert/strict";
import { buildDataset, generatedCatalog, seederView } from "../src/dataset.mjs";
import { useDataset, generateHistory } from "../src/seed.mjs";
import { createArrHandler } from "../src/arr.mjs";

test("the dataset is deterministic", () => {
  const a = buildDataset("x", generatedCatalog("x"));
  const b = buildDataset("x", generatedCatalog("x"));
  assert.deepEqual(a.items.map((i) => i.Id), b.items.map((i) => i.Id));
  assert.deepEqual(a.users.map((u) => u.Id), b.users.map((u) => u.Id));
});

test("episodes point at real seasons and series, and none are in the future", () => {
  const { items, byId } = buildDataset();
  const today = new Date().toISOString().slice(0, 10);
  for (const episode of items.filter((i) => i.Type === "Episode")) {
    assert.equal(byId.get(episode.SeasonId)?.Type, "Season");
    assert.equal(byId.get(episode.SeriesId)?.Type, "Series");
    assert.ok(!episode.PremiereDate || episode.PremiereDate.slice(0, 10) <= today);
  }
});

test("history uses the library the services publish", () => {
  const data = buildDataset();
  useDataset(JSON.parse(JSON.stringify(seederView(data))));
  const rows = generateHistory(new Date());
  assert.ok(rows.length > 1000);
  const ids = new Set(data.items.map((i) => i.Id));
  for (const row of rows.slice(0, 500)) assert.ok(ids.has(row.EpisodeId || row.NowPlayingItemId));
  assert.equal(rows.filter((r) => r.ActivityDateInserted > new Date()).length, 0);
});

test("fake apps answer as the app named in the Host header", async () => {
  const handle = createArrHandler(buildDataset());
  const call = (host, path) =>
    new Promise((resolve) => {
      const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { resolve({ status: this.status, body: String(body) }); } };
      handle({ headers: { host }, method: "GET" }, res, new URL(`http://${host}${path}`), "");
    });
  assert.match((await call("sonarr", "/api/v3/system/status")).body, /Sonarr/);
  assert.ok(JSON.parse((await call("qbittorrent", "/api/v2/torrents/info")).body).some((t) => t.state === "stalledDL"));
  assert.ok(JSON.parse((await call("jellyseerr", "/api/v1/request?take=5")).body).results.length === 5);
  assert.ok(JSON.parse((await call("sabnzbd", "/api?mode=queue")).body).queue.slots.length > 0);
});

test("every film and show has a unique id, even with repeated generated names", () => {
  const { items } = buildDataset();
  const titles = items.filter((i) => i.Type === "Movie" || i.Type === "Series");
  assert.equal(new Set(titles.map((i) => i.Id)).size, titles.length);
});
