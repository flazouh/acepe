import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "$lib/acp/errors/app-error.js";
import type { AvailableCommand } from "$lib/acp/types/available-command.js";
import {
	PreconnectionRemoteCommandsState,
	shouldLoadRemotePreconnectionCommands,
} from "./preconnection-remote-commands-state.svelte.js";

function makeCommand(name: string, description: string): AvailableCommand {
	return {
		name,
		description,
	};
}

describe("PreconnectionRemoteCommandsState", () => {
	const fetchFn = vi.fn();

	beforeEach(() => {
		fetchFn.mockReset();
	});

	it("loads project-scoped commands before a session exists", async () => {
		fetchFn.mockReturnValueOnce(okAsync([makeCommand("compact", "compact the session")]));

		const state = new PreconnectionRemoteCommandsState(fetchFn);
		const result = await state.ensureLoaded({
			agentId: "opencode",
			hasConnectedSession: false,
			projectPath: "/repo",
			preconnectionSlashMode: "projectScoped",
		});

		expect(result.isOk()).toBe(true);
		expect(fetchFn).toHaveBeenCalledWith("/repo", "opencode");
		expect(
			state.getCommands({
				agentId: "opencode",
				projectPath: "/repo",
				preconnectionSlashMode: "projectScoped",
				skillCommands: [makeCommand("ce:brainstorm", "Brainstorm")],
			})
		).toEqual([makeCommand("compact", "compact the session")]);
	});

	it("falls back to startup-global commands for non-project-scoped providers", async () => {
		const state = new PreconnectionRemoteCommandsState(fetchFn);
		const skillCommands = [makeCommand("ce:brainstorm", "Brainstorm")];

		const result = await state.ensureLoaded({
			agentId: "claude-code",
			hasConnectedSession: false,
			projectPath: "/repo",
			preconnectionSlashMode: "startupGlobal",
		});

		expect(result.isOk()).toBe(true);
		expect(fetchFn).not.toHaveBeenCalled();
		expect(
			state.getCommands({
				agentId: "claude-code",
				projectPath: "/repo",
				preconnectionSlashMode: "startupGlobal",
				skillCommands,
			})
		).toEqual(skillCommands);
	});

	it("does not refetch commands when the same agent and project are already loaded", async () => {
		fetchFn.mockReturnValue(okAsync([makeCommand("compact", "compact the session")]));

		const state = new PreconnectionRemoteCommandsState(fetchFn);
		await state.ensureLoaded({
			agentId: "copilot",
			hasConnectedSession: false,
			projectPath: "/repo",
			preconnectionSlashMode: "projectScoped",
		});

		const second = await state.ensureLoaded({
			agentId: "copilot",
			hasConnectedSession: false,
			projectPath: "/repo",
			preconnectionSlashMode: "projectScoped",
		});

		expect(second.isOk()).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("loads project-scoped commands even after a session is connected", async () => {
		fetchFn.mockReturnValueOnce(
			okAsync([makeCommand("systematic-debugging", "Debug methodically")])
		);

		const state = new PreconnectionRemoteCommandsState(fetchFn);
		const result = await state.ensureLoaded({
			agentId: "copilot",
			hasConnectedSession: true,
			projectPath: "/repo",
			preconnectionSlashMode: "projectScoped",
		});

		expect(result.isOk()).toBe(true);
		expect(fetchFn).toHaveBeenCalledWith("/repo", "copilot");
		expect(
			state.getCommands({
				agentId: "copilot",
				projectPath: "/repo",
				preconnectionSlashMode: "projectScoped",
				skillCommands: [],
			})
		).toEqual([makeCommand("systematic-debugging", "Debug methodically")]);
	});

	it("clears the loading marker after a fetch failure", async () => {
		fetchFn.mockReturnValueOnce(
			errAsync(new AgentError("acp_list_preconnection_commands", new Error("boom")))
		);

		const state = new PreconnectionRemoteCommandsState(fetchFn);
		const result = await state.ensureLoaded({
			agentId: "opencode",
			hasConnectedSession: false,
			projectPath: "/repo",
			preconnectionSlashMode: "projectScoped",
		});

		expect(result.isErr()).toBe(true);
		expect(state.loadingCacheKey).toBeNull();
	});
});

describe("shouldLoadRemotePreconnectionCommands", () => {
	it("loads for project-scoped providers whenever a project path is present", () => {
		expect(
			shouldLoadRemotePreconnectionCommands({
				agentId: "opencode",
				hasConnectedSession: false,
				projectPath: "/repo",
				preconnectionSlashMode: "projectScoped",
				alreadyLoaded: false,
				alreadyLoading: false,
			})
		).toBe(true);

		expect(
			shouldLoadRemotePreconnectionCommands({
				agentId: "opencode",
				hasConnectedSession: true,
				projectPath: "/repo",
				preconnectionSlashMode: "projectScoped",
				alreadyLoaded: false,
				alreadyLoading: false,
			})
		).toBe(true);

		expect(
			shouldLoadRemotePreconnectionCommands({
				agentId: "claude-code",
				hasConnectedSession: false,
				projectPath: "/repo",
				preconnectionSlashMode: "startupGlobal",
				alreadyLoaded: false,
				alreadyLoading: false,
			})
		).toBe(false);
	});
});
