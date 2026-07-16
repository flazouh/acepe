import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { AgentError } from "$lib/acp/errors/app-error.js";
import {
	installAgentForSelection,
	resolvePostInstallCapabilityMode,
} from "./installable-agent-selection.js";

function createDeferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("installAgentForSelection", () => {
	it("uses canonical capability metadata when the existing panel payload omits provider metadata", () => {
		const mode = resolvePostInstallCapabilityMode({
			projectedProviderMetadata: undefined,
			canonicalProviderMetadata: {
				providerBrand: "claude-code",
				displayName: "Claude Code",
				displayOrder: 10,
				supportsModelDefaults: true,
				variantGroup: "plain",
				defaultAlias: "default",
				reasoningEffortSupport: false,
				preconnectionSlashMode: "startupGlobal",
				preconnectionCapabilityMode: "startupGlobal",
				implicitSessionCreationMode: "allowed",
			},
			requiresPostInstallCatalog: true,
		});

		expect(mode).toBe("startupGlobal");
	});

	it("waits for install and forced capability refresh before selecting the agent", async () => {
		const install = createDeferred<void>();
		const capabilities = createDeferred<void>();
		const installAgent = vi.fn(() => ResultAsync.fromSafePromise(install.promise));
		const refreshPreconnectionCapabilities = vi.fn(() =>
			ResultAsync.fromSafePromise(capabilities.promise)
		);
		const selectAgent = vi.fn();

		const result = installAgentForSelection(
			{
				agentId: "claude-code",
				installRequired: true,
				projectPath: "/projects/acepe",
				preconnectionCapabilityMode: "startupGlobal",
			},
			{
				installAgent,
				refreshPreconnectionCapabilities,
				selectAgent,
			}
		);

		expect(installAgent).toHaveBeenCalledWith("claude-code");
		expect(refreshPreconnectionCapabilities).not.toHaveBeenCalled();
		expect(selectAgent).not.toHaveBeenCalled();

		install.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(refreshPreconnectionCapabilities).toHaveBeenCalledWith(
			{
				agentId: "claude-code",
				hasConnectedSession: false,
				projectPath: "/projects/acepe",
				preconnectionCapabilityMode: "startupGlobal",
			},
			{ force: true }
		);
		expect(selectAgent).not.toHaveBeenCalled();

		capabilities.resolve();
		expect((await result).isOk()).toBe(true);
		expect(selectAgent).toHaveBeenCalledWith("claude-code");
	});

	it("keeps the previous agent selected when installation fails", async () => {
		const installError = new AgentError("install managed agent");
		const installAgent = vi.fn(() => errAsync(installError));
		const refreshPreconnectionCapabilities = vi.fn(() => okAsync(undefined));
		const selectAgent = vi.fn();

		const result = await installAgentForSelection(
			{
				agentId: "managed-agent",
				installRequired: true,
				projectPath: "/projects/acepe",
				preconnectionCapabilityMode: "projectScoped",
			},
			{
				installAgent,
				refreshPreconnectionCapabilities,
				selectAgent,
			}
		);

		expect(result.isErr()).toBe(true);
		expect(refreshPreconnectionCapabilities).not.toHaveBeenCalled();
		expect(selectAgent).not.toHaveBeenCalled();
	});

	it("retries a failed catalog refresh without reinstalling before selecting", async () => {
		const refreshError = new AgentError("refresh managed agent catalog");
		const installAgent = vi.fn(() => okAsync(undefined));
		const refreshPreconnectionCapabilities = vi
			.fn()
			.mockReturnValueOnce(errAsync(refreshError))
			.mockReturnValueOnce(okAsync(undefined));
		const selectAgent = vi.fn();
		const input = {
			agentId: "managed-agent",
			installRequired: false,
			projectPath: "/projects/acepe",
			preconnectionCapabilityMode: "projectScoped" as const,
		};
		const dependencies = {
			installAgent,
			refreshPreconnectionCapabilities,
			selectAgent,
		};

		const first = await installAgentForSelection(input, dependencies);
		expect(first.isErr()).toBe(true);
		expect(installAgent).not.toHaveBeenCalled();
		expect(selectAgent).not.toHaveBeenCalled();

		const second = await installAgentForSelection(input, dependencies);
		expect(second.isOk()).toBe(true);
		expect(installAgent).not.toHaveBeenCalled();
		expect(refreshPreconnectionCapabilities).toHaveBeenCalledTimes(2);
		expect(selectAgent).toHaveBeenCalledOnce();
		expect(selectAgent).toHaveBeenCalledWith("managed-agent");
	});
});
