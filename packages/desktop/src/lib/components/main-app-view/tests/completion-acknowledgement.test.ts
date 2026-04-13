import { describe, expect, it } from "bun:test";

import {
	acknowledgeExplicitPanelReveal,
	applyCompletionAttentionAction,
	performExplicitPanelReveal,
	resolveCompletionAttentionAction,
} from "../logic/completion-acknowledgement.js";

describe("resolveCompletionAttentionAction", () => {
	it("does not acknowledge completion on passive panel focus", () => {
		expect(resolveCompletionAttentionAction({ kind: "panel-focused" })).toBe("noop");
	});

	it("acknowledges explicit reveal actions", () => {
		expect(resolveCompletionAttentionAction({ kind: "explicit-reveal" })).toBe("mark_seen");
	});

	it("marks completion unseen when it finishes off-panel", () => {
		expect(
			resolveCompletionAttentionAction({ kind: "turn-complete", panelIsFocused: false })
		).toBe("mark_unseen");
	});

	it("keeps completion seen when it finishes on the focused panel", () => {
		expect(
			resolveCompletionAttentionAction({ kind: "turn-complete", panelIsFocused: true })
		).toBe("mark_seen");
	});
});

describe("applyCompletionAttentionAction", () => {
	it("applies seen and unseen transitions without side effects for noop", () => {
		const calls: string[] = [];
		const unseenStore = {
			markSeen(panelId: string) {
				calls.push(`seen:${panelId}`);
			},
			markUnseen(panelId: string) {
				calls.push(`unseen:${panelId}`);
			},
		};

		applyCompletionAttentionAction(unseenStore, "panel-1", { kind: "panel-focused" });
		applyCompletionAttentionAction(unseenStore, "panel-1", { kind: "explicit-reveal" });
		applyCompletionAttentionAction(unseenStore, "panel-2", {
			kind: "turn-complete",
			panelIsFocused: false,
		});

		expect(calls).toEqual(["seen:panel-1", "unseen:panel-2"]);
	});
});

describe("acknowledgeExplicitPanelReveal", () => {
	it("marks seen for agent panels opened explicitly", () => {
		const calls: string[] = [];
		const unseenStore = {
			markSeen(panelId: string) {
				calls.push(`seen:${panelId}`);
			},
			markUnseen(panelId: string) {
				calls.push(`unseen:${panelId}`);
			},
		};

		acknowledgeExplicitPanelReveal(unseenStore, { id: "panel-1", sessionId: "session-1" });

		expect(calls).toEqual(["seen:panel-1"]);
	});

	it("ignores non-session panels", () => {
		const calls: string[] = [];
		const unseenStore = {
			markSeen(panelId: string) {
				calls.push(`seen:${panelId}`);
			},
			markUnseen(panelId: string) {
				calls.push(`unseen:${panelId}`);
			},
		};

		acknowledgeExplicitPanelReveal(unseenStore, { id: "panel-1", sessionId: null });

		expect(calls).toEqual([]);
	});
});

describe("performExplicitPanelReveal", () => {
	it("runs the reveal action and acknowledges agent panels", () => {
		const calls: string[] = [];
		const unseenStore = {
			markSeen(panelId: string) {
				calls.push(`seen:${panelId}`);
			},
			markUnseen(panelId: string) {
				calls.push(`unseen:${panelId}`);
			},
		};
		let revealCount = 0;

		performExplicitPanelReveal(unseenStore, { id: "panel-1", sessionId: "session-1" }, () => {
			revealCount += 1;
		});

		expect(revealCount).toBe(1);
		expect(calls).toEqual(["seen:panel-1"]);
	});

	it("still runs the reveal action for non-session panels without acknowledging", () => {
		const calls: string[] = [];
		const unseenStore = {
			markSeen(panelId: string) {
				calls.push(`seen:${panelId}`);
			},
			markUnseen(panelId: string) {
				calls.push(`unseen:${panelId}`);
			},
		};
		let revealCount = 0;

		performExplicitPanelReveal(unseenStore, { id: "panel-1", sessionId: null }, () => {
			revealCount += 1;
		});

		expect(revealCount).toBe(1);
		expect(calls).toEqual([]);
	});
});
