import test from "node:test";
import assert from "node:assert/strict";
import { isAllowed } from "../src/gateway.mjs";

test("reads pass through", () => {
  for (const path of ["/", "/api/getconfig", "/insights-data/wrapped", "/proxy/Items/Images/Primary", "/stats/getAllUserActivity", "/socket.io/?EIO=4"]) {
    assert.equal(isAllowed("GET", path), true, path);
  }
  assert.equal(isAllowed("POST", "/auth/login"), true);
  assert.equal(isAllowed("POST", "/api/getLibraries"), true);
  assert.equal(isAllowed("POST", "/stats/getUserDetails"), true);
});

test("changes and work-starting GETs are refused", () => {
  for (const [method, path] of [
    ["POST", "/api/setconfig"],
    ["PUT", "/alerts-data/settings"],
    ["DELETE", "/api/keys"],
    ["POST", "/api/integrations"],
    ["POST", "/auth/setup-auth"],
    ["GET", "/sync/beginSync"],
    ["GET", "/api/startTask?task=JellyfinSync"],
    ["GET", "/backup/beginBackup"],
    ["GET", "/utils/anything"],
  ]) {
    assert.equal(isAllowed(method, path), false, `${method} ${path}`);
  }
});
