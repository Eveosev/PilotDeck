/**
 * Regression for check-web-node-test-scan.mjs against a temp fixture
 * vite config. Does not modify ui/vite.config.js.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { listWebUiNodeTestFiles } from "../web-node-test-files.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CHECK = join(REPO_ROOT, "scripts/check-web-node-test-scan.mjs");
const REAL_UI_CONFIG = join(REPO_ROOT, "ui/vite.config.js");

function writeFixture({ extra, replaceAbort, broken } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "t-ci-f3-scan-"));
  const configPath = join(dir, "vite.config.js");
  if (broken) {
    writeFileSync(configPath, "export default {\n  test: { exclude: [] },\n  this_is_a_syntax_error(\n");
    return { dir, configPath };
  }
  let files = listWebUiNodeTestFiles();
  if (replaceAbort) {
    files = files.map((file) =>
      file === "server/module-request-abort.test.js" ? replaceAbort : file,
    );
  }
  const exclude = ["e2e/**", "node_modules/**", "dist/**", ...(extra ? [extra] : []), ...files];
  writeFileSync(configPath, `export default { test: { exclude: ${JSON.stringify(exclude)} } };\n`);
  return { dir, configPath };
}

function runCheck(configPath) {
  const result = spawnSync(process.execPath, [CHECK], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, CHECK_WEB_NODE_TEST_SCAN_UI_CONFIG: configPath },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function withFixture(opts, fn) {
  const { dir, configPath } = writeFixture(opts);
  try {
    return fn(runCheck(configPath), configPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("F1: !(src)/**/projects.test.js is drift exit 1", () => {
  withFixture({ extra: "!(src)/**/projects.test.js" }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /server\/projects\.test\.js/);
    assert.match(output, /extra vs node --test/);
  });
});

test("F1: !(src)/routes/config.test.js is drift exit 1", () => {
  withFixture({ extra: "!(src)/routes/config.test.js" }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /server\/routes\/config\.test\.js/);
    assert.match(output, /extra vs node --test/);
  });
});

test("F1: !x is skipped exit 0", () => {
  withFixture({ extra: "!x" }, ({ status, output }) => {
    assert.equal(status, 0);
    assert.match(output, /ok: 8 files/);
    assert.doesNotMatch(output, /extra vs node --test/);
  });
});

test("F1: !server/does-not-exist.test.js is skipped exit 0", () => {
  withFixture({ extra: "!server/does-not-exist.test.js" }, ({ status, output }) => {
    assert.equal(status, 0);
    assert.match(output, /ok: 8 files/);
  });
});

test("F2: syntax error in config reports file:line exit 1", () => {
  withFixture({ broken: true }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /vite\.config\.js:\d+/);
  });
});

test("m3: server/{x}.test.js missing brace exit 0", () => {
  withFixture({ extra: "server/{x}.test.js" }, ({ status, output }) => {
    assert.equal(status, 0);
    assert.match(output, /ok: 8 files/);
  });
});

test("m3: server/does-not-exist.test.js missing literal exit 0", () => {
  withFixture({ extra: "server/does-not-exist.test.js" }, ({ status, output }) => {
    assert.equal(status, 0);
    assert.match(output, /ok: 8 files/);
  });
});

test("m3: server/routes/{config,x}.test.js drift exit 1", () => {
  withFixture({ extra: "server/routes/{config,x}.test.js" }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /server\/routes\/config\.test\.js/);
  });
});

test("m3: server/routes/@(config).test.js drift exit 1", () => {
  withFixture({ extra: "server/routes/@(config).test.js" }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /server\/routes\/config\.test\.js/);
  });
});

test("m3: server/routes/config.test.js literal drift exit 1", () => {
  withFixture({ extra: "server/routes/config.test.js" }, ({ status, output }) => {
    assert.equal(status, 1);
    assert.match(output, /server\/routes\/config\.test\.js/);
  });
});

test("N1: brace equivalent abort exit 0", () => {
  withFixture(
    { replaceAbort: "server/{module-request-abort,module-request-abort}.test.js" },
    ({ status, output }) => {
      assert.equal(status, 0);
      assert.match(output, /ok: 8 files/);
    },
  );
});

test("N1: extglob equivalent abort exit 0", () => {
  withFixture({ replaceAbort: "server/@(module-request-abort).test.js" }, ({ status, output }) => {
    assert.equal(status, 0);
    assert.match(output, /ok: 8 files/);
  });
});

test("fixture runner does not modify ui/vite.config.js", () => {
  const before = spawnSync("git", ["hash-object", REAL_UI_CONFIG], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  withFixture({ extra: "!(src)/**/projects.test.js" }, ({ status }) => {
    assert.equal(status, 1);
  });
  const after = spawnSync("git", ["hash-object", REAL_UI_CONFIG], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(after.stdout, before.stdout);
});
