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
});
