import { describe, expect, it } from "vitest";

import type { WorktreeSetupEvent } from "$lib/acp/types/worktree-setup.js";

import {
	createWorktreeCreationState,
	matchesWorktreeSetupContext,
	reduceWorktreeSetupEvent,
} from "../worktree-setup-events.js";

function createEvent(
	overrides: Partial<WorktreeSetupEvent> = {}
): WorktreeSetupEvent {
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

	it("hides the card after a successful finish", () => {
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
		expect(finished?.isVisible).toBe(false);
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

describe("matchesWorktreeSetupContext", () => {
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
