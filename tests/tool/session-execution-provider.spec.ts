import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  NsjailSessionExecutionProvider,
  SessionExecutionLease,
  SessionExecutionProviderError,
  SessionExecutionProviderRegistry,
  type SessionExecutionHandle,
  type SessionExecutionProvider,
  type TrustedSessionBinding,
} from "../../src/tool/index.js";
import { createNodeFsPort } from "../../src/tool/execution-world/NodeFsPort.js";
import { createNodeSandboxedFsPort } from "../../src/tool/execution-world/SandboxedFsPort.js";

function binding(sandboxKey = "sandbox-a"): TrustedSessionBinding {
  return {
    sessionKey: sandboxKey,
    sandboxKey,
    generation: 1,
    storage: {
      workspace: `/var/lib/pilotdeck/sessions/${sandboxKey}/workspace`,
      home: `/var/lib/pilotdeck/sessions/${sandboxKey}/home`,
      temp: `/var/lib/pilotdeck/sessions/${sandboxKey}/tmp`,
    },
    policy: { network: "deny" },
  };
}

function fakeProvider(): SessionExecutionProvider & { creates: number; disposes: number } {
  const provider = {
    id: "fake",
    contractVersion: 1 as const,
    creates: 0,
    disposes: 0,
    async probe() { return { ready: true, providerId: "fake" }; },
    async createSession(): Promise<SessionExecutionHandle> {
      provider.creates += 1;
      return {
        sandboxKey: "sandbox-a",
        generation: 1,
        guestCwd: "/workspace",
        world: {} as SessionExecutionHandle["world"],
        async stop() {},
        async dispose() { provider.disposes += 1; },
      };
    },
    async dispose() {},
  };
  return provider;
}

test("provider registry rejects duplicate ids and disposes providers once", async () => {
  const registry = new SessionExecutionProviderRegistry();
  const provider = fakeProvider();
  registry.register(provider);
  assert.throws(() => registry.register(provider), (error: unknown) =>
    error instanceof SessionExecutionProviderError && error.code === "provider_duplicate");
  await registry.dispose();
  await registry.dispose();
  assert.equal(registry.list().length, 0);
});

test("session lease coalesces concurrent acquire and releases one handle", async () => {
  const provider = fakeProvider();
  const lease = new SessionExecutionLease(provider, binding());
  const [a, b] = await Promise.all([lease.acquire(), lease.acquire()]);
  assert.equal(a, b);
  assert.equal(provider.creates, 1);
  await lease.release();
  await lease.release();
  assert.equal(provider.disposes, 1);
  await assert.rejects(lease.acquire(), (error: unknown) =>
    error instanceof SessionExecutionProviderError && error.code === "session_closed");
});

test("nsjail provider emits a fixed isolated command shape", () => {
  const provider = new NsjailSessionExecutionProvider({
    rootfs: "/opt/pilotdeck/rootfs",
    sessionsRoot: "/var/lib/pilotdeck/sessions",
    probe: false,
  });
  const command = provider.buildCommand({
    executable: "/bin/sh",
    args: ["-c", "id"],
    cwd: "/var/lib/pilotdeck/sessions/a/workspace",
    env: { PATH: "/usr/bin" },
  }, "/usr/bin/nsjail");
  assert.equal(command.executable, "/usr/bin/nsjail");
  assert.ok(command.args.includes("--clone_newpid"));
  assert.ok(command.args.includes("--clone_newnet"));
  assert.ok(command.args.includes("--tmpfsmount"));
  assert.ok(command.args.includes("/workspace"));
  assert.equal(command.args.at(-3), "/bin/sh");
  const networkCommand = provider.buildCommand({ executable: "/bin/true", args: [], cwd: "/workspace", env: {} }, "/usr/bin/nsjail", "allow");
  assert.equal(networkCommand.args.includes("--clone_newnet"), false);
});

test("nsjail provider rejects a workspace outside its session root", async () => {
  const provider = new NsjailSessionExecutionProvider({
    rootfs: "/opt/pilotdeck/rootfs",
    sessionsRoot: "/var/lib/pilotdeck/sessions",
    probe: false,
  });
  await assert.rejects(provider.createSession({
    ...binding("sandbox-a"),
    storage: { ...binding("sandbox-a").storage, workspace: "/var/lib/pilotdeck/sessions-other/workspace" },
  }), (error: unknown) => error instanceof SessionExecutionProviderError && error.code === "session_conflict");
});

test("session filesystem provider rejects reads and writes outside the bound workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "pilotdeck-session-fs-"));
  const workspace = join(root, "workspace");
  const other = join(root, "other");
  mkdirSync(workspace);
  mkdirSync(other);
  writeFileSync(join(other, "secret.txt"), "private");
  const fs = createNodeSandboxedFsPort({
    fs: createNodeFsPort(),
    sandboxMode: "workspace-write",
    workspaceRoot: workspace,
  });
  try {
    assert.throws(() => fs.readFile(join(other, "secret.txt")), (error: unknown) => error instanceof Error && error.message.includes("outside the session workspace"));
    await assert.rejects(fs.writeText(join(other, "out.txt"), "nope"), (error: unknown) => error instanceof Error && error.message.includes("outside the session workspace"));
    await fs.writeText(join(workspace, "own.txt"), "ok");
    assert.equal(await fs.readFile(join(workspace, "own.txt"), { encoding: "utf8" }), "ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
