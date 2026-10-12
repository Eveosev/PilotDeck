import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  rewriteUiServerSourceImports,
  verifyRuntime,
  verifyRuntimeUiServerRelativeImports,
} from "./build-runtime.mjs";

const buildRuntimeScript = fileURLToPath(new URL("./build-runtime.mjs", import.meta.url));

function makeRuntimeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pilotdeck-ui-imports-"));
  const serverRoot = resolve(root, "ui", "server");
  mkdirSync(serverRoot, { recursive: true });
  mkdirSync(resolve(root, "dist", "src", "composition"), { recursive: true });
  writeFileSync(
    resolve(serverRoot, "pilotdeck-host-capability-gateway.mjs"),
    "export { encodeHostCapabilityStream, isHostCapabilityStreamBody } from '../../src/composition/publicHostWire.js';\n",
  );
  writeFileSync(
    resolve(serverRoot, "pilotdeck-host-remote-transport.mjs"),
    "import { PUBLIC_HOST_WIRE_OPERATIONS } from '../../src/composition/publicHostWire.js';\nexport const ops = PUBLIC_HOST_WIRE_OPERATIONS;\n",
  );
  writeFileSync(
    resolve(serverRoot, "index.js"),
    "import './pilotdeck-host-capability-gateway.mjs';\nimport './pilotdeck-host-remote-transport.mjs';\n",
  );
  writeFileSync(
    resolve(root, "dist", "src", "composition", "publicHostWire.js"),
    "export const PUBLIC_HOST_WIRE_OPERATIONS = [];\nexport function encodeHostCapabilityStream() {}\nexport function isHostCapabilityStreamBody() { return false; }\n",
  );
  return root;
}

function makeTransitiveMissingFixture() {
  const root = mkdtempSync(join(tmpdir(), "pilotdeck-ui-imports-missing-"));
  const serverRoot = resolve(root, "ui", "server");
  mkdirSync(serverRoot, { recursive: true });
  writeFileSync(resolve(serverRoot, "index.js"), "import './mid.mjs';\n");
  writeFileSync(
    resolve(serverRoot, "mid.mjs"),
    "import { leaf } from './does-not-exist-leaf.js';\nexport const value = leaf;\n",
  );
  return root;
}

test("ui/server relative imports resolve after rewrite, including .mjs (D6)", () => {
  const root = makeRuntimeFixture();
  try {
    rewriteUiServerSourceImports(resolve(root, "ui", "server"));
    try {
      verifyRuntimeUiServerRelativeImports(root);
    } catch (error) {
      assert.match(
        String(error?.message || error),
        /publicHostWire\.js/,
        "import-resolution failure must name the missing publicHostWire.js",
      );
      throw error;
    }
    const gateway = readFileSync(
      resolve(root, "ui", "server", "pilotdeck-host-capability-gateway.mjs"),
      "utf8",
    );
    assert.match(gateway, /dist\/src\/composition\/publicHostWire\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifier throws when a transitively imported file is missing (R2-1)", () => {
  const root = makeTransitiveMissingFixture();
  try {
    assert.throws(
      () => verifyRuntimeUiServerRelativeImports(root),
      (error) => {
        assert.match(String(error?.message || error), /does-not-exist-leaf\.js/);
        assert.match(String(error?.message || error), /missing relative import target/);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyRuntime is the exported staged-runtime verifier", () => {
  assert.equal(typeof verifyRuntime, "function");
  const root = makeRuntimeFixture();
  try {
    rewriteUiServerSourceImports(resolve(root, "ui", "server"));
    assert.throws(
      () => verifyRuntime(root),
      /staged prerequisite missing/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isExecutedAsMain is true when the script is run via a symlink (R2-2)", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pilotdeck-build-runtime-link-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const link = resolve(root, "build-runtime-link.mjs");
  symlinkSync(buildRuntimeScript, link);
  const result = spawnSync(process.execPath, [link, "--probe-main"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, "executed-as-main\n");
});
