import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
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

async function runToResult<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
	return Effect.runPromise(Effect.result(effect));
}

describe("PreconnectionRemoteCommandsState", () => {
	const fetchFn = vi.fn();

	beforeEach(() => {
		fetchFn.mockReset();
	});

	it("loads project-scoped commands before a session exists", async () => {
		fetchFn.mockReturnValueOnce(
			Effect.succeed([makeCommand("compact", "compact the session")])
		);

		const state = new PreconnectionRemoteCommandsState(fetchFn);
		const result = await runToResult(
			state.ensureLoaded({
				agentId: "opencode",
				hasConnectedSession: false,
				projectPath: "/repo",
				preconnectionSlashMode: "projectScoped",
			})
		);

		expect(Result.isSuccess(result)).toBe(true);
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

		const result = await runToResult(
			state.ensureLoaded({
				agentId: "claude-code",
				hasConnectedSession: false,
				projectPath: "/repo",
				preconnectionSlashMode: "startupGlobal",
			})
		);

		expect(Result.isSuccess(result)).toBe(true);
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
		fetchFn.mockReturnValue(Effect.succeed([makeCommand("compact", "compact the session")]));

		const state = new PreconnectionRemoteCommandsState(fetchFn);
		await runToResult(
			state.ensureLoaded({
				agentId: "copilot",
				hasConnectedSession: false,
				projectPath: "/repo",
				preconnectionSlashMode: "projectScoped",
			})
		);

		const second = await runToResult(
			state.ensureLoaded({
				agentId: "copilot",
				hasConnectedSession: false,
				projectPath: "/repo",
				preconnectionSlashMode: "projectScoped",
			})
		);

		expect(Result.isSuccess(second)).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("does not load project-scoped commands after a session is connected", async () => {
		fetchFn.mockReturnValueOnce(
			Effect.succeed([makeCommand("systematic-debugging", "Debug methodically")])
		);

		const state = new PreconnectionRemoteCommandsState(fetchFn);
		const result = await runToResult(
			state.ensureLoaded({
				agentId: "copilot",
				hasConnectedSession: true,
				projectPath: "/repo",
				preconnectionSlashMode: "projectScoped",
			})
		);

		expect(Result.isSuccess(result)).toBe(true);
		expect(fetchFn).not.toHaveBeenCalled();
		expect(
			state.getCommands({
				agentId: "copilot",
				projectPath: "/repo",
				preconnectionSlashMode: "projectScoped",
				skillCommands: [],
			})
		).toEqual([]);
	});

	it("clears the loading marker after a fetch failure", async () => {
		fetchFn.mockReturnValueOnce(
			Effect.fail(new AgentError("acp_list_preconnection_commands", new Error("boom")))
		);

		const state = new PreconnectionRemoteCommandsState(fetchFn);
		const result = await runToResult(
			state.ensureLoaded({
				agentId: "opencode",
				hasConnectedSession: false,
				projectPath: "/repo",
				preconnectionSlashMode: "projectScoped",
			})
		);

		expect(Result.isFailure(result)).toBe(true);
		expect(state.loadingCacheKey).toBeNull();
	});
});

describe("shouldLoadRemotePreconnectionCommands", () => {
	it("loads for project-scoped providers only before a session is connected", () => {
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
		).toBe(false);

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
