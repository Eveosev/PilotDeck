import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import type { SandboxMode, SandboxPort, SandboxedCommand } from "./SandboxPort.js";
import type { ExecutionWorldBundle } from "./ExecutionWorldBundle.js";
import { createNodeExecutionWorldBundle } from "./ExecutionWorldBundle.js";
import { isAbsolute, relative, resolve } from "node:path";
import {
  SessionExecutionProviderError,
  type ProviderReadiness,
  type SessionExecutionHandle,
  type SessionExecutionProvider,
  type TrustedSessionBinding,
} from "./SessionExecutionProvider.js";

export type NsjailProviderOptions = {
  executable?: string;
  rootfs: string;
  sessionsRoot: string;
  sandboxMode?: SandboxMode;
  probe?: boolean;
  /** Optional replacement for the native execution-world composition. */
  worldFactory?: (options: { projectRoot: string; sandboxMode: SandboxMode; sandboxPort: SandboxPort; workspaceRoot: string }) => ExecutionWorldBundle;
};

/**
 * Host-side nsjail provider. It owns readiness, session binding, policy
 * validation, exact argv construction, and session execution-world creation.
 */
export class NsjailSessionExecutionProvider implements SessionExecutionProvider {
  readonly id = "nsjail";
  readonly contractVersion = 1 as const;
  private disposed = false;

  constructor(private readonly options: NsjailProviderOptions) {}

  async probe(): Promise<ProviderReadiness> {
    if (this.disposed) return { ready: false, providerId: this.id, reason: "provider disposed" };
    if (process.platform !== "linux") {
      return { ready: false, providerId: this.id, reason: "nsjail provider requires Linux" };
    }
    try {
      await access(this.options.rootfs, constants.R_OK | constants.X_OK);
      await access(this.options.sessionsRoot, constants.R_OK | constants.W_OK | constants.X_OK);
    } catch (error) {
      return { ready: false, providerId: this.id, reason: `storage unavailable: ${String(error)}` };
    }
    const executable = this.options.executable ?? "nsjail";
    if (!isExecutableAvailable(executable)) {
      return { ready: false, providerId: this.id, reason: `nsjail executable is unavailable: ${executable}` };
    }
    if (this.options.probe === false) return { ready: true, providerId: this.id };
    const command = this.buildCommand({
      executable: "/bin/true",
      args: [],
      cwd: "/workspace",
      env: {},
    }, executable);
    return { ready: command.args.length > 0, providerId: this.id, capabilities: { filesystemIsolation: true, processIsolation: true } };
  }

  async createSession(binding: TrustedSessionBinding): Promise<SessionExecutionHandle> {
    if (this.disposed) throw new SessionExecutionProviderError("nsjail provider is disposed", "provider_unavailable");
    validateBinding(binding, this.options.sessionsRoot);
    if (process.platform !== "linux") throw new SessionExecutionProviderError("nsjail provider requires Linux", "provider_unavailable");
    await Promise.all([
      mkdir(binding.storage.workspace, { recursive: true }),
      mkdir(binding.storage.home, { recursive: true }),
      mkdir(binding.storage.temp, { recursive: true }),
    ]);
    const sandboxPort = this.createSandboxPort();
    const sandboxMode = this.options.sandboxMode ?? "workspace-write";
    const world = (this.options.worldFactory ?? createNodeExecutionWorldBundle)({
      projectRoot: binding.storage.workspace,
      sandboxMode,
      sandboxPort,
      workspaceRoot: binding.storage.workspace,
    });
    let stopped = false;
    return {
      sandboxKey: binding.sandboxKey,
      generation: binding.generation,
      guestCwd: "/workspace",
      world,
      stop: async () => { stopped = true; },
      dispose: async () => { if (!stopped) stopped = true; await world.dispose(); },
    };
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return Promise.resolve();
  }

  createSandboxPort(): SandboxPort {
    return {
      prepare: async (request) => this.buildCommand(request, this.options.executable ?? "nsjail", request.policy.network ?? "deny"),
    };
  }

  /** Construct the fixed nsjail argv used by the future worker launcher. */
  buildCommand(command: SandboxedCommand, nsjailExecutable = this.options.executable ?? "nsjail", network: "deny" | "allow" = "deny"): SandboxedCommand {
    const args = [
        "--quiet",
        "--mode", "o",
        "--cwd", "/workspace",
        "--bindmount_ro", `${this.options.rootfs}:/`,
        "--bindmount", `${command.cwd}:/workspace`,
        "--bindmount", `${command.cwd}:/home/agent`,
        "--tmpfsmount", "/tmp",
        "--disable_proc",
        "--user", "65532",
        "--group", "65532",
        ...(network === "allow" ? ["--disable_clone_newnet"] : []),
        "--",
        command.executable,
        ...command.args,
      ];
    return {
      executable: nsjailExecutable,
      args,
      cwd: command.cwd,
      env: command.env,
    };
  }
}

function isExecutableAvailable(executable: string): boolean {
  if (executable.includes("/")) {
    try {
      return spawnSync(executable, ["--help"], { stdio: "ignore", timeout: 2_000 }).status !== null;
    } catch {
      return false;
    }
  }
  try {
    return spawnSync("which", [executable], { stdio: "ignore", timeout: 2_000 }).status === 0;
  } catch {
    return false;
  }
}

function validateBinding(binding: TrustedSessionBinding, sessionsRoot: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(binding.sandboxKey)) {
    throw new SessionExecutionProviderError("Invalid sandbox key", "session_conflict");
  }
  if (binding.generation < 0 || !Number.isSafeInteger(binding.generation)) {
    throw new SessionExecutionProviderError("Invalid session generation", "session_conflict");
  }
  const sessionRoot = resolve(sessionsRoot, binding.sandboxKey);
  const workspace = resolve(binding.storage.workspace);
  const workspaceRelative = relative(sessionRoot, workspace);
  if (!isAbsolute(workspace) || (workspaceRelative !== "" && (workspaceRelative.startsWith("..") || isAbsolute(workspaceRelative)))) {
    throw new SessionExecutionProviderError("Workspace is outside the session storage root", "session_conflict");
  }
}
