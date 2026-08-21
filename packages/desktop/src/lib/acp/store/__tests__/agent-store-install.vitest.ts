import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	installAgent: vi.fn(),
	listAgents: vi.fn(),
	listen: vi.fn(),
	toastError: vi.fn(),
	uninstallAgent: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: mocks.listen,
}));

vi.mock("svelte-sonner", () => ({
	toast: {
		error: mocks.toastError,
	},
}));

vi.mock("../api.js", () => ({
	api: {
		installAgent: mocks.installAgent,
		listAgents: mocks.listAgents,
		uninstallAgent: mocks.uninstallAgent,
	},
}));

import { AgentError } from "../../errors/app-error.js";
import { AgentStore } from "../agent-store.svelte.js";

describe("AgentStore installAgent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listen.mockResolvedValue(vi.fn());
	});

	it("returns success only after the installed availability has refreshed", async () => {
		mocks.installAgent.mockReturnValue(Effect.succeed(undefined));
		mocks.listAgents.mockReturnValue(
			Effect.succeed([
				{
					id: "claude-code",
					name: "Claude Code",
					availability_kind: { kind: "installable" as const, installed: true },
				},
			])
		);

		const store = new AgentStore();
		const result = await Effect.runPromise(Effect.result(store.installAgent("claude-code")));

		expect(Result.isSuccess(result)).toBe(true);
		expect(mocks.installAgent).toHaveBeenCalledWith("claude-code");
		expect(mocks.listAgents).toHaveBeenCalledOnce();
		expect(store.agents[0]?.availability_kind).toEqual({
			kind: "installable",
			installed: true,
		});
	});

	it("returns failure without refreshing availability and clears install progress", async () => {
		const installError = new AgentError("install claude-code");
		mocks.installAgent.mockReturnValue(Effect.fail(installError));

		const store = new AgentStore();
		const result = await Effect.runPromise(Effect.result(store.installAgent("claude-code")));

		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure).toBe(installError);
		}
		expect(mocks.listAgents).not.toHaveBeenCalled();
		expect(store.isInstalling("claude-code")).toBe(false);
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Failed to install agent: Agent operation failed: install claude-code"
		);
	});

	it("keeps post-install catalog readiness failed until a retry begins and completes", () => {
		const store = new AgentStore();

		store.beginAgentInstallationReadiness("claude-code");
		expect(store.getAgentInstallationReadiness("claude-code")).toEqual({
			status: "pending",
		});

		store.failAgentInstallationReadiness("claude-code", "Catalog refresh failed");
		expect(store.getAgentInstallationReadiness("claude-code")).toEqual({
			status: "failed",
			message: "Catalog refresh failed",
		});

		store.beginAgentInstallationReadiness("claude-code");
		expect(store.getAgentInstallationReadiness("claude-code")).toEqual({
			status: "pending",
		});

		store.completeAgentInstallationReadiness("claude-code");
		expect(store.getAgentInstallationReadiness("claude-code")).toBeNull();
	});
});
