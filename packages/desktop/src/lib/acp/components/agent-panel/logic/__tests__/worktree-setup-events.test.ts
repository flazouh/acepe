import { describe, expect, it } from "vitest";

import type { WorktreeSetupEvent } from "$lib/acp/types/worktree-setup.js";

import {
	createWorktreeCreationState,
	createWorktreeSetupMatchContext,
	createWorktreeSetupStartedEvent,
	matchesWorktreeSetupContext,
	projectWorktreeSetupRunEvents,
	reduceWorktreeSetupEvent,
} from "../worktree-setup-events.js";

function createEvent(overrides: Partial<WorktreeSetupEvent> = {}): WorktreeSetupEvent {
	return {
		kind: "started",
		projectPath: "/repo",
		worktreePath: "/wt/repo-a",
		command: null,
		commandCount: 2,
		commandIndex: null,
		stream: null,
		chunk: null,
		success: null,
		exitCode: null,
		error: null,
		...overrides,
	};
}

describe("reduceWorktreeSetupEvent", () => {
	it("creates a visible worktree creation state before setup commands begin", () => {
		const creating = createWorktreeCreationState({
			projectPath: "/repo",
		});

		expect(creating.isVisible).toBe(true);
		expect(creating.status).toBe("creating-worktree");
		expect(creating.worktreePath).toBe(null);
		expect(creating.activeCommand).toBe(null);
		expect(creating.outputText).toBe("");
	});

	it("replaces worktree creation state when setup starts", () => {
		const creating = createWorktreeCreationState({
			projectPath: "/repo",
			worktreePath: "/wt/repo-a",
		});
		const started = reduceWorktreeSetupEvent(creating, createEvent());

		expect(started.status).toBe("running");
		expect(started.commandCount).toBe(2);
		expect(started.activeCommand).toBe(null);
	});

	it("keeps the card visible and appends live output while setup is running", () => {
		const started = reduceWorktreeSetupEvent(null, createEvent());
		const commandStarted = reduceWorktreeSetupEvent(
			started,
			createEvent({
				kind: "command-started",
				command: "bun install",
				commandIndex: 1,
			})
		);
		const withOutput = reduceWorktreeSetupEvent(
			commandStarted,
			createEvent({
				kind: "output",
				command: "bun install",
				commandIndex: 1,
				stream: "stdout",
				chunk: "installed 42 packages\n",
			})
		);

		expect(withOutput).not.toBeNull();
		expect(withOutput?.isVisible).toBe(true);
		expect(withOutput?.status).toBe("running");
		expect(withOutput?.activeCommand).toBe("bun install");
		expect(withOutput?.activeCommandIndex).toBe(1);
		expect(withOutput?.outputText).toContain("$ bun install");
		expect(withOutput?.outputText).toContain("installed 42 packages");
	});

	it("keeps a successful finish on screen while it still has output to show", () => {
		const running = reduceWorktreeSetupEvent(
			reduceWorktreeSetupEvent(null, createEvent()),
			createEvent({
				kind: "command-started",
				command: "bun install",
				commandIndex: 1,
			})
		);

		const finished = reduceWorktreeSetupEvent(
			running,
			createEvent({
				kind: "finished",
				command: "bun install",
				commandIndex: 1,
				success: true,
			})
		);

		expect(finished).not.toBeNull();
		expect(finished?.status).toBe("succeeded");
		expect(finished?.isVisible).toBe(true);
		expect(finished?.outputText).toContain("$ bun install");
	});

	it("hides a successful finish that produced no output at all", () => {
		const finished = reduceWorktreeSetupEvent(
			null,
			createEvent({
				kind: "finished",
				commandCount: 0,
				success: true,
			})
		);

		expect(finished.status).toBe("succeeded");
		expect(finished.isVisible).toBe(false);
		expect(finished.outputText).toBe("");
	});

	it("keeps the card visible after a failed finish and stores the error", () => {
		const running = reduceWorktreeSetupEvent(
			reduceWorktreeSetupEvent(null, createEvent()),
			createEvent({
				kind: "command-started",
				command: "bun install",
				commandIndex: 1,
			})
		);

		const finished = reduceWorktreeSetupEvent(
			running,
			createEvent({
				kind: "finished",
				command: "bun install",
				commandIndex: 1,
				success: false,
				error: "bun install failed",
			})
		);

		expect(finished).not.toBeNull();
		expect(finished?.status).toBe("failed");
		expect(finished?.isVisible).toBe(true);
		expect(finished?.error).toBe("bun install failed");
		expect(finished?.outputText).toContain("bun install failed");
	});
});

describe("projectWorktreeSetupRunEvents", () => {
	function foldRun(run: Parameters<typeof projectWorktreeSetupRunEvents>[0]) {
		let state = reduceWorktreeSetupEvent(
			createWorktreeCreationState({ projectPath: run.projectPath }),
			createWorktreeSetupStartedEvent({
				projectPath: run.projectPath,
				worktreePath: run.worktreePath,
			})
		);
		for (const event of projectWorktreeSetupRunEvents(run)) {
			state = reduceWorktreeSetupEvent(state, event);
		}
		return state;
	}

	it("drives the card to a terminal success state carrying every command's output", () => {
		const state = foldRun({
			projectPath: "/repo",
			worktreePath: "/wt/repo-a",
			success: true,
			error: null,
			commands: [
				{
					command: "echo ACEPE_SETUP_MARKER",
					success: true,
					stdout: "ACEPE_SETUP_MARKER\n",
					stderr: "",
					exitCode: 0,
				},
				{
					command: "echo second",
					success: true,
					stdout: "second\n",
					stderr: "",
					exitCode: 0,
				},
			],
		});

		expect(state.status).toBe("succeeded");
		expect(state.worktreePath).toBe("/wt/repo-a");
		expect(state.commandCount).toBe(2);
		expect(state.error).toBe(null);
		expect(state.outputText).toContain("$ echo ACEPE_SETUP_MARKER");
		expect(state.outputText).toContain("ACEPE_SETUP_MARKER");
		expect(state.outputText).toContain("$ echo second");
		expect(state.outputText).toContain("second");
		expect(state.isVisible).toBe(true);
	});

	it("drives the card to failed and shows the failing command's stderr", () => {
		const state = foldRun({
			projectPath: "/repo",
			worktreePath: "/wt/repo-a",
			success: false,
			error: "ACEPE_SETUP_BOOM",
			commands: [
				{
					command: "echo starting",
					success: true,
					stdout: "starting\n",
					stderr: "",
					exitCode: 0,
				},
				{
					command: "echo ACEPE_SETUP_BOOM >&2; exit 3",
					success: false,
					stdout: "",
					stderr: "ACEPE_SETUP_BOOM\n",
					exitCode: 3,
				},
			],
		});

		expect(state.status).toBe("failed");
		expect(state.isVisible).toBe(true);
		expect(state.error).toBe("ACEPE_SETUP_BOOM");
		expect(state.outputText).toContain("starting");
		expect(state.outputText).toContain("$ echo ACEPE_SETUP_BOOM >&2; exit 3");
		expect(state.outputText).toContain("ACEPE_SETUP_BOOM");
	});

	it("emits nothing but a silent success when the project configures no setup commands", () => {
		const state = foldRun({
			projectPath: "/repo",
			worktreePath: "/wt/repo-a",
			success: true,
			error: null,
			commands: [],
		});

		expect(state.status).toBe("succeeded");
		expect(state.isVisible).toBe(false);
		expect(state.outputText).toBe("");
	});
});

describe("matchesWorktreeSetupContext", () => {
	it("does not subscribe panels without an explicit in-flight setup", () => {
		const context = createWorktreeSetupMatchContext({
			pendingSetupProjectPath: null,
			pendingSetupWorktreePath: null,
		});

		expect(context.projectPaths).toEqual([]);
		expect(context.worktreePaths).toEqual([]);
		expect(matchesWorktreeSetupContext(createEvent(), context)).toBe(false);
	});

	it("tracks the initiating panel by project path before the worktree path is known", () => {
		const context = createWorktreeSetupMatchContext({
			pendingSetupProjectPath: "/repo",
			pendingSetupWorktreePath: null,
		});

		expect(matchesWorktreeSetupContext(createEvent(), context)).toBe(true);
	});

	it("continues tracking the same panel by worktree path after setup starts", () => {
		const context = createWorktreeSetupMatchContext({
			pendingSetupProjectPath: "/repo",
			pendingSetupWorktreePath: "/wt/repo-a",
		});

		expect(matchesWorktreeSetupContext(createEvent(), context)).toBe(true);
		expect(matchesWorktreeSetupContext(createEvent({ worktreePath: "/wt/repo-b" }), context)).toBe(
			false
		);
	});

	it("drops a card that never learned the worktree path the panel now waits on", () => {
		const context = createWorktreeSetupMatchContext({
			pendingSetupProjectPath: "/repo",
			pendingSetupWorktreePath: "/wt/repo-a",
		});

		expect(matchesWorktreeSetupContext({ projectPath: "/repo", worktreePath: null }, context)).toBe(
			false
		);
	});

	it("prefers worktree path matching when the panel already knows a worktree", () => {
		expect(
			matchesWorktreeSetupContext(createEvent(), {
				projectPaths: ["/repo"],
				worktreePaths: ["/wt/repo-a"],
			})
		).toBe(true);

		expect(
			matchesWorktreeSetupContext(createEvent({ worktreePath: "/wt/repo-b" }), {
				projectPaths: ["/repo"],
				worktreePaths: ["/wt/repo-a"],
			})
		).toBe(false);
	});

	it("falls back to project path matching before the worktree path is known", () => {
		expect(
			matchesWorktreeSetupContext(createEvent(), {
				projectPaths: ["/repo"],
				worktreePaths: [],
			})
		).toBe(true);

		expect(
			matchesWorktreeSetupContext(createEvent({ projectPath: "/other-repo" }), {
				projectPaths: ["/repo"],
				worktreePaths: [],
			})
		).toBe(false);
	});
});
