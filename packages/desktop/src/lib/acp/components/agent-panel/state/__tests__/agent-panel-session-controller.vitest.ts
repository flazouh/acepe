import { describe, expect, it } from "vitest";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";
import { AgentPanelSessionController } from "../agent-panel-session-controller.svelte.js";

/**
 * Tests for AgentPanelSessionController.
 *
 * Uses Vitest (not Bun) because the controller uses Svelte 5 runes, which
 * require Vite preprocessing — same harness rationale as agent-input-state.
 *
 * Reactive scalars are supplied via accessor functions; tests drive them by
 * mutating a plain holder the accessor closes over and asserting the controller
 * reflects the new value at read time.
 */
describe("AgentPanelSessionController", () => {
	const stubSessionStore = {} as unknown as SessionStore;
	const stubPanelStore = {} as unknown as PanelStore;

	const make = (initial: { sessionId?: string | null; panelId?: string | undefined } = {}) => {
		const holder: { sessionId: string | null; panelId: string | undefined } = {
			sessionId: initial.sessionId ?? null,
			panelId: initial.panelId,
		};
		const controller = new AgentPanelSessionController({
			getSessionId: () => holder.sessionId,
			getPanelId: () => holder.panelId,
			sessionStore: stubSessionStore,
			panelStore: stubPanelStore,
		});
		return { controller, holder };
	};

	it("passes through the current sessionId", () => {
		const { controller } = make({ sessionId: "s1" });
		expect(controller.sessionId).toBe("s1");
	});

	it("returns null when there is no session", () => {
		const { controller } = make({ sessionId: null });
		expect(controller.sessionId).toBeNull();
	});

	it("reflects sessionId changes through the accessor at read time", () => {
		const { controller, holder } = make({ sessionId: "s1" });
		expect(controller.sessionId).toBe("s1");
		holder.sessionId = "s2";
		expect(controller.sessionId).toBe("s2");
		holder.sessionId = null;
		expect(controller.sessionId).toBeNull();
	});

	describe("Cluster A — identity / metadata", () => {
		const identity = { projectPath: "/p", agentId: "claude-code", worktreePath: "/wt" };
		const sessionStore = {
			getSessionIdentity: (_id: string) => identity,
			getSessionMetadata: (_id: string) => ({ title: "My session" }),
			getSessionCurrentModelId: (_id: string) => "opus",
		} as unknown as SessionStore;

		const makeWithStore = (sessionId: string | null, panelId?: string) =>
			new AgentPanelSessionController({
				getSessionId: () => sessionId,
				getPanelId: () => panelId,
				sessionStore,
				panelStore: stubPanelStore,
			});

		it("derives identity scalars from the session store", () => {
			const c = makeWithStore("s1");
			expect(c.sessionProjectPath).toBe("/p");
			expect(c.sessionAgentId).toBe("claude-code");
			expect(c.sessionWorktreePath).toBe("/wt");
			expect(c.sessionTitle).toBe("My session");
			expect(c.sessionCurrentModelId).toBe("opus");
		});

		it("returns null identity scalars when there is no session", () => {
			const c = makeWithStore(null);
			expect(c.sessionIdentity).toBeNull();
			expect(c.sessionProjectPath).toBeNull();
			expect(c.sessionAgentId).toBeNull();
			expect(c.sessionTitle).toBeNull();
			expect(c.sessionCurrentModelId).toBeNull();
		});

		it("falls back to the default panel id when panelId is undefined", () => {
			expect(makeWithStore("s1").effectivePanelId).toBe("default-panel");
			expect(makeWithStore("s1", "panel-9").effectivePanelId).toBe("panel-9");
		});

		it("keeps a stable reference for the object-producing sessionIdentity field across reads", () => {
			const c = makeWithStore("s1");
			expect(c.sessionIdentity).toBe(c.sessionIdentity);
		});
	});

	describe("Cluster B — entry presence / status", () => {
		const makeWithEntries = (entryCount: number) => {
			const entries = Array.from({ length: entryCount }, (_, i) => ({
				entryId: `e${i}`,
				role: "user",
			}));
			const sessionStore = {
				getSessionPendingSendIntent: () => null,
				getSessionTranscriptEntries: () => entries,
				getSessionLifecyclePresentation: () => null,
				getSessionAgentPanelCanonicalSource: () => null,
				getSessionAgentPanelSessionSource: () => ({ kind: "uninitialized" }),
				getSessionIdentity: () => null,
				getSessionMetadata: () => null,
				getSessionCurrentModelId: () => null,
			} as unknown as SessionStore;
			const panelStore = { getHotState: () => null } as unknown as PanelStore;
			return new AgentPanelSessionController({
				getSessionId: () => "s1",
				getPanelId: () => "p1",
				sessionStore,
				panelStore,
			});
		};

		it("reports hasMessages true when transcript entries exist", () => {
			const c = makeWithEntries(2);
			expect(c.visibleEntryCount).toBe(2);
			expect(c.knownVisibleEntryCount).toBe(2);
			expect(c.hasMessages).toBe(true);
		});

		it("reports hasMessages false when there are no entries", () => {
			const c = makeWithEntries(0);
			expect(c.hasMessages).toBe(false);
		});
	});
});
