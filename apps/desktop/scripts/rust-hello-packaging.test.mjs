import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("desktop extraResources stages rust/ without adding rust to mac signIgnore", () => {
  const extraResources = desktopPackage.build.extraResources;
  assert.ok(
    extraResources.some((entry) => entry.from === "resources/rust" && entry.to === "rust"),
    'extraResources must include { from: "resources/rust", to: "rust" }',
  );
  assert.deepEqual(desktopPackage.build.mac.signIgnore, [
    "Contents/Resources/runtime/node_modules/playwright-core/\\.local-browsers/",
  ]);
});
