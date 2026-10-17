import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAgentLoopSidecarRuntimeFactory,
  createStdioAgentLoopSidecarConnectionFactory,
  createTcpAgentLoopSidecarConnectionFactory,
  type AgentLoopRuntimeFactory,
  type AgentLoopSidecarTransportObserver,
} from "../agent/index.js";
import { isExternalAgentLoopBinding, type CoreModuleBinding } from "../composition/index.js";
import {
  AgentLoopTcpSidecarSupervisor,
  createSupervisedTcpConnectionFactory,
  isLoopbackHost,
  resolveAgentLoopTcpSuperviseConfig,
  type AgentLoopTcpSuperviseConfig,
} from "./AgentLoopTcpSidecarSupervisor.js";

export type AgentLoopDeploymentTransport = "native" | "stdio" | "tcp";

export type AgentLoopDeploymentProfile =
  | Readonly<{ transport: "native" }>
  | Readonly<{
      transport: "stdio";
      command: string;
      args: readonly string[];
      env: NodeJS.ProcessEnv;
    }>
  | Readonly<{
      transport: "tcp";
      host: string;
      port: number;
      connectTimeoutMs: number | undefined;
      /** Production TCP hello secret. Absent keeps the existing open loopback path. */
      authToken?: string;
      /**
       * Present only when this process should spawn the TCP listener.
       * Absent means reuse an already-listening sidecar (harness compatible).
       */
      supervise?: AgentLoopTcpSuperviseConfig;
    }>;

export type ResolveAgentLoopDeploymentProfileInput = {
  env: Record<string, string | undefined>;
  cwd?: string;
};

/** Application-selected live observer for an external AgentLoop deployment. */
export type AgentLoopDeploymentFactoryOptions = {
  transportObserver?: AgentLoopSidecarTransportObserver;
  expectedModuleId?: string;
  /** Required when `profile.supervise` is set. The supervisor must already be started. */
  tcpSupervisor?: AgentLoopTcpSidecarSupervisor;
};

/**
 * Selects the application-owned AgentLoop deployment provider. The selected
 * provider only changes the loop execution transport: the Gateway and Session
 * stay host-owned and the sidecar still receives a capability-only view.
 */
export function resolveAgentLoopDeploymentProfile(
  input: ResolveAgentLoopDeploymentProfileInput,
): AgentLoopDeploymentProfile {
  const env = input.env;
  const transport = readTransport(env.PILOTDECK_AGENT_LOOP_TRANSPORT);
  if (transport === "native") return Object.freeze({ transport });
  if (transport === "tcp") {
    const cwd = input.cwd ?? process.cwd();
    const supervise = resolveAgentLoopTcpSuperviseConfig({ env, cwd });
    const authToken = optionalTcpAuthToken(env.PILOTDECK_AGENT_LOOP_TCP_TOKEN);
    const host = requiredText(env.PILOTDECK_AGENT_LOOP_TCP_HOST ?? "127.0.0.1", "PILOTDECK_AGENT_LOOP_TCP_HOST");
    if (supervise && !isLoopbackHost(host)) {
      throw new Error("PILOTDECK_AGENT_LOOP_TCP_HOST must be a loopback address when the TCP sidecar supervisor is enabled.");
    }
    return Object.freeze({
      transport,
      host,
      port: tcpPort(env.PILOTDECK_AGENT_LOOP_TCP_PORT, supervise !== undefined),
      connectTimeoutMs: optionalPositiveInteger(env.PILOTDECK_AGENT_LOOP_CONNECT_TIMEOUT_MS),
      ...(authToken ? { authToken } : {}),
      ...(supervise ? { supervise } : {}),
    });
  }

  const cwd = input.cwd ?? process.cwd();
  const sidecarPath = env.PILOTDECK_AGENT_LOOP_SIDECAR_PATH?.trim()
    ? resolve(cwd, env.PILOTDECK_AGENT_LOOP_SIDECAR_PATH)
    : fileURLToPath(new URL("./pilotdeck-agent-loop-sidecar.js", import.meta.url));
  const childEnv: NodeJS.ProcessEnv = { ...env };
  // A stdio child is per-turn. It must not accidentally become a long-lived
  // TCP listener just because its parent has a TCP deployment configuration.
  delete childEnv.PILOTDECK_AGENT_LOOP_TCP_HOST;
  delete childEnv.PILOTDECK_AGENT_LOOP_TCP_PORT;
  delete childEnv.PILOTDECK_AGENT_LOOP_TCP_TOKEN;
  return Object.freeze({
    transport,
    command: requiredText(env.PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND ?? process.execPath, "PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND"),
    args: Object.freeze([sidecarPath]),
    env: childEnv,
  });
}

/** Creates the formal external-loop provider selected by the deployment profile. */
export function createAgentLoopDeploymentFactory(
  profile: AgentLoopDeploymentProfile,
  options: AgentLoopDeploymentFactoryOptions = {},
): AgentLoopRuntimeFactory | undefined {
  if (profile.transport === "native") return undefined;
  if (profile.transport === "tcp") {
    const connect = profile.supervise
      ? createSupervisedTcpConnectionFactory(requiredSupervisor(options.tcpSupervisor), profile.connectTimeoutMs)
      : createTcpAgentLoopSidecarConnectionFactory({
          host: profile.host,
          port: profile.port,
          ...(profile.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: profile.connectTimeoutMs }),
        });
    return createAgentLoopSidecarRuntimeFactory({
      connect,
      ...(profile.authToken ? { tcpAuthToken: profile.authToken } : {}),
      expectedModuleId: options.expectedModuleId,
      transportObserver: options.transportObserver,
    });
  }
  return createAgentLoopSidecarRuntimeFactory({
    connect: createStdioAgentLoopSidecarConnectionFactory({
      command: profile.command,
      args: profile.args,
      env: profile.env,
    }),
    expectedModuleId: options.expectedModuleId,
    transportObserver: options.transportObserver,
  });
}

/** Resolve a per-runtime YAML binding without changing the legacy environment fallback. */
export function createAgentLoopBindingFactory(
  binding: CoreModuleBinding | undefined,
  options: AgentLoopDeploymentFactoryOptions = {},
): AgentLoopRuntimeFactory | undefined {
  if (!isExternalAgentLoopBinding(binding)) return undefined;
  const bindingOptions = { ...options, expectedModuleId: binding.implementationId };
  if (binding.transport === "module-tcp-v2") {
    const authToken = optionalTcpAuthToken(process.env.PILOTDECK_AGENT_LOOP_TCP_TOKEN);
    return createAgentLoopDeploymentFactory({
      transport: "tcp",
      host: binding.host!,
      port: binding.port!,
      connectTimeoutMs: binding.connectTimeoutMs,
      ...(authToken ? { authToken } : {}),
    }, bindingOptions);
  }
  return createAgentLoopDeploymentFactory({
    transport: "stdio",
    command: binding.command!,
    args: binding.args ?? [],
    env: { ...process.env, ...binding.env },
  }, bindingOptions);
}

function readTransport(value: string | undefined): AgentLoopDeploymentTransport {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized === "" || normalized === "native") return "native";
  if (normalized === "stdio" || normalized === "tcp") return normalized;
  throw new Error("PILOTDECK_AGENT_LOOP_TRANSPORT must be native, stdio, or tcp.");
}

function requiredText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  return normalized;
}

function tcpPort(value: string | undefined, supervise: boolean): number {
  if (value === undefined || value.trim() === "") {
    if (supervise) return 0;
    throw new Error("PILOTDECK_AGENT_LOOP_TCP_PORT is required when transport is tcp.");
  }
  if (supervise && value.trim() === "0") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PILOTDECK_AGENT_LOOP_TCP_PORT must be an integer between 1 and 65535.");
  }
  return parsed;
}

function requiredSupervisor(supervisor: AgentLoopTcpSidecarSupervisor | undefined): AgentLoopTcpSidecarSupervisor {
  if (!supervisor) {
    throw new Error(
      "TCP sidecar supervise is enabled. Start AgentLoopTcpSidecarSupervisor and pass it to createAgentLoopDeploymentFactory.",
    );
  }
  return supervisor;
}

function optionalTcpAuthToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  return token ? token : undefined;
}

function optionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("PILOTDECK_AGENT_LOOP_CONNECT_TIMEOUT_MS must be a positive integer.");
  }
  return parsed;
}
