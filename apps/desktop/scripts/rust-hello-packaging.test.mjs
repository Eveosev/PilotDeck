import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { rustHelloOptedIn } from "./rust-hello.mjs";

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

test("rust hello build is opt-in; full pack/dev/dist do not run cargo", () => {
  const argv = ["node", "scripts/build-runtime.mjs"];
  assert.equal(rustHelloOptedIn({ argv, env: {} }), false);
  assert.equal(rustHelloOptedIn({ argv: [...argv, "--rust-only"], env: {} }), true);
  assert.equal(rustHelloOptedIn({ argv, env: { PILOTDECK_DESKTOP_RUST: "1" } }), true);
  assert.equal(rustHelloOptedIn({ argv, env: { PILOTDECK_DESKTOP_REQUIRE_RUST: "1" } }), true);

  const source = readFileSync(new URL("./build-runtime.mjs", import.meta.url), "utf8");
  assert.match(source, /maybeBuildRustHello\(\)/);
  assert.doesNotMatch(source, /buildRustHello\(/);
});
