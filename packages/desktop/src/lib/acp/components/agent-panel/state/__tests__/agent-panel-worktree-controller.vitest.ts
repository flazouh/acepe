import { describe, expect, it } from "vitest";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";
import { AgentPanelWorktreeController } from "../agent-panel-worktree-controller.svelte.js";
import { WorktreeSetupController } from "../worktree-setup-controller.svelte.js";

describe("AgentPanelWorktreeController", () => {
	const stubPanelStore = {} as unknown as PanelStore;
	const stubSessionStore = {
		updateSession: () => undefined,
		disconnectSession: () => undefined,
	} as unknown as SessionStore;
	const worktreeSetup = new WorktreeSetupController();

	const make = () =>
		new AgentPanelWorktreeController({
			getSessionId: () => null,
			getPanelId: () => "panel-1",
			getSessionWorktreePath: () => null,
			getSessionProjectPath: () => "/repo",
			getSessionAgentId: () => "claude-code",
			getWorktreeToggleProjectPath: () => "/repo",
			getHasMessages: () => false,
			getPendingProjectSelection: () => false,
			getPanelPendingWorktreeEnabled: () => null,
			getPanelPreparedWorktreeLaunch: () => null,
			getPendingWorktreeSetup: () => null,
			getAllProjects: () => [],
			panelStore: stubPanelStore,
			sessionStore: stubSessionStore,
			worktreeSetup,
		});

	it("starts with no active worktree path", () => {
		const controller = make();
		expect(controller.effectiveActiveWorktreePath).toBeNull();
		expect(controller.worktreePending).toBe(false);
	});

	it("tracks scoped active worktree when owner project matches toggle path", () => {
		const controller = make();
		controller.handleWorktreeCreated("/repo/.worktrees/feature");
		expect(controller.effectiveActiveWorktreePath).toBe("/repo/.worktrees/feature");
		expect(controller.activeWorktreeName).toBe("feature");
	});

	it("records pre-session worktree failures", () => {
		const controller = make();
		controller.handlePreSessionWorktreeFailure("Worktree creation failed");
		expect(controller.preSessionWorktreeFailure).toBe("Worktree creation failed");
		controller.clearPreSessionWorktreeFailure();
		expect(controller.preSessionWorktreeFailure).toBeNull();
	});
});
