import type { ExecutionWorldBundle } from "../tool/execution-world/ExecutionWorldBundle.js";

export type SessionIsolationPolicy = {
  network: "deny" | "allow";
  maxMemoryBytes?: number;
  maxPids?: number;
  maxCpuSeconds?: number;
  workspaceBytes?: number;
};

/**
 * Trusted, host-side binding. Never construct this from model/tool input.
 *
 * This is an internal PilotDeck composition value. It is not a Gateway wire
 * payload and is intentionally not part of the @pilotdeck/sdk API.
 */
export type TrustedSessionBinding = {
  sessionKey: string;
  sandboxKey: string;
  generation: number;
  storage: { workspace: string; home: string; temp: string };
  policy: SessionIsolationPolicy;
};

export type ProviderReadiness = {
  ready: boolean;
  providerId: string;
  reason?: string;
  capabilities?: Readonly<Record<string, boolean>>;
};

export type SessionExecutionHandle = {
  readonly sandboxKey: string;
  readonly generation: number;
  readonly guestCwd: "/workspace";
  readonly world: ExecutionWorldBundle;
  stop(reason: string): Promise<void>;
  dispose(): Promise<void>;
};

/**
 * Host composition Port implemented by an execution-sandbox module.
 *
 * The Gateway owns session identity, leases and lifecycle; a provider module
 * owns the OS/process implementation. SDK callers can request tool-policy
 * restrictions, but cannot select or construct this provider.
 */
export interface SessionExecutionProvider {
  readonly id: string;
  readonly contractVersion: 1;
  probe(): Promise<ProviderReadiness>;
  createSession(binding: TrustedSessionBinding): Promise<SessionExecutionHandle>;
  dispose(): Promise<void>;
}

export class SessionExecutionProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "provider_unavailable"
      | "provider_duplicate"
      | "provider_missing"
      | "session_conflict"
      | "session_closed",
  ) {
    super(message);
    this.name = "SessionExecutionProviderError";
  }
}

/** Project-scoped provider registry. Provider selection is host configuration. */
export class SessionExecutionProviderRegistry {
  private readonly providers = new Map<string, SessionExecutionProvider>();
  private state: "active" | "disposed" = "active";

  register(provider: SessionExecutionProvider): void {
    this.assertActive();
    if (this.providers.has(provider.id)) {
      throw new SessionExecutionProviderError(`Execution provider already registered: ${provider.id}`, "provider_duplicate");
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): SessionExecutionProvider {
    this.assertActive();
    const provider = this.providers.get(id);
    if (!provider) throw new SessionExecutionProviderError(`Execution provider not found: ${id}`, "provider_missing");
    return provider;
  }

  list(): readonly SessionExecutionProvider[] {
    return [...this.providers.values()];
  }

  async dispose(): Promise<void> {
    if (this.state === "disposed") return;
    this.state = "disposed";
    const results = await Promise.allSettled([...this.providers.values()].map((provider) => provider.dispose()));
    this.providers.clear();
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Failed to dispose execution providers.");
  }

  private assertActive(): void {
    if (this.state === "disposed") throw new SessionExecutionProviderError("Execution provider registry is disposed.", "provider_unavailable");
  }
}
