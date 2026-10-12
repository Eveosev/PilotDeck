import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

const buildRuntimeSource = readFileSync(new URL("./build-runtime.mjs", import.meta.url), "utf8");

function rewriteExtensionsFromSource(source) {
  const match = source.match(
    /function rewriteUiServerSourceImports\s*\([^)]*\)\s*\{[\s\S]*?const extensions = new Set\(\[([^\]]*)\]\)/,
  );
  assert.ok(match, "rewriteUiServerSourceImports must declare an extensions set");
  return new Set(
    match[1]
      .split(",")
      .map((part) => part.replace(/['"`\s]/g, ""))
      .filter(Boolean),
  );
}

function applyUiServerSourceImportRewrite(serverRoot, extensions) {
  function visit(path) {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) {
        visit(resolve(path, entry));
      }
      return;
    }
    if (!extensions.has(path.slice(path.lastIndexOf(".")))) return;
    const original = readFileSync(path, "utf8");
    const rewritten = original
      .replaceAll("../../src/", "../../dist/src/")
      .replaceAll("../../../src/", "../../../dist/src/");
    if (rewritten !== original) writeFileSync(path, rewritten, "utf8");
  }
  visit(serverRoot);
}

function collectRelativeImportSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /(?:\bimport\b|\bexport\b)[\s\S]*?\bfrom\s*['"](\.[^'"]+)['"]/g,
    /\bimport\s*['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function resolveRelativeImportTarget(fromFile, specifier) {
  const dest = resolve(dirname(fromFile), specifier);
  return [
    dest,
    `${dest}.js`,
    `${dest}.mjs`,
    resolve(dest, "index.js"),
    resolve(dest, "index.mjs"),
  ].find((candidate) => existsSync(candidate));
}

function verifyUiServerRelativeImports(runtimeRoot) {
  const serverRoot = resolve(runtimeRoot, "ui", "server");
  const queue = [];
  const seen = new Set();
  const missing = [];

  function enqueueTree(path) {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) enqueueTree(resolve(path, entry));
      return;
    }
    if (path.endsWith(".js") || path.endsWith(".mjs")) queue.push(path);
  }
  enqueueTree(serverRoot);

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of collectRelativeImportSpecifiers(source)) {
      const resolved = resolveRelativeImportTarget(file, specifier);
      if (!resolved) {
        const targetName = specifier.split("/").pop() || specifier;
        missing.push(
          `${targetName} imported as ${specifier} from ${relative(runtimeRoot, file).replaceAll("\\", "/")}`,
        );
        continue;
      }
      if (!seen.has(resolved)) queue.push(resolved);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Desktop runtime missing relative import target:\n${missing.sort().join("\n")}`);
  }
}

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

test("ui/server relative imports resolve after rewrite, including .mjs (D6)", () => {
  const root = makeRuntimeFixture();
  try {
    const extensions = rewriteExtensionsFromSource(buildRuntimeSource);
    applyUiServerSourceImportRewrite(resolve(root, "ui", "server"), extensions);
    try {
      verifyUiServerRelativeImports(root);
    } catch (error) {
      assert.match(
        String(error?.message || error),
        /publicHostWire\.js/,
        "import-resolution failure must name the missing publicHostWire.js",
      );
      throw error;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
