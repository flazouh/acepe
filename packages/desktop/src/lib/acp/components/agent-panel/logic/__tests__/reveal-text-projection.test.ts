import { describe, expect, it } from "bun:test";

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import { createRevealTextProjection } from "../reveal-text-projection.js";
import { scenePatchIdentity } from "../scene-patch.js";

function assistant(id: string, markdown: string): AgentPanelSceneEntryModel {
	return { id, type: "assistant", markdown, isStreaming: true };
}

function user(id: string, text: string): AgentPanelSceneEntryModel {
	return { id, type: "user", text };
}

function markdownOf(entries: readonly AgentPanelSceneEntryModel[], id: string): string {
	const found = entries.find((entry) => entry.id === id);
	if (found?.type !== "assistant") {
		throw new Error(`expected assistant ${id}`);
	}
	return found.markdown;
}

const RUNNING = { sessionId: "s1", turnId: "t1", turnCompleted: false } as const;

describe("createRevealTextProjection", () => {
	it("passes canonical markdown through when non-empty", () => {
		const projection = createRevealTextProjection();
		const result = projection.apply({
			sceneEntries: [user("u1", "Prompt"), assistant("a1", "Hello world")],
			...RUNNING,
		});
		expect(markdownOf(result.entries, "a1")).toBe("Hello world");
	});

	it("renders latest canonical text during monotonic streaming growth", () => {
		const projection = createRevealTextProjection();
		const seen = ["Hel", "Hello", "Hello world"].map(
			(text) =>
				markdownOf(
					projection.apply({ sceneEntries: [assistant("a1", text)], ...RUNNING }).entries,
					"a1"
				)
		);
		expect(seen).toEqual(["Hel", "Hello", "Hello world"]);
	});

	it("holds visible markdown when canonical blanks mid-turn (same-key running replacement)", () => {
		const projection = createRevealTextProjection();
		const first = projection.apply({
			sceneEntries: [assistant("a1", "Partial answer in flight")],
			...RUNNING,
		});
		expect(markdownOf(first.entries, "a1")).toBe("Partial answer in flight");

		const blanked = projection.apply({ sceneEntries: [assistant("a1", "")], ...RUNNING });
		expect(markdownOf(blanked.entries, "a1")).toBe("Partial answer in flight");
	});

	it("snaps to canonical on completion even when empty", () => {
		const projection = createRevealTextProjection();
		projection.apply({ sceneEntries: [assistant("a1", "Visible while running")], ...RUNNING });
		const completed = projection.apply({
			sceneEntries: [assistant("a1", "")],
			sessionId: "s1",
			turnId: "t1",
			turnCompleted: true,
		});
		expect(markdownOf(completed.entries, "a1")).toBe("");
	});

	it("resets held text on turn change (no cross-turn bleed)", () => {
		const projection = createRevealTextProjection();
		projection.apply({ sceneEntries: [assistant("a1", "First turn text")], ...RUNNING });
		const nextTurn = projection.apply({
			sceneEntries: [assistant("a2", "")],
			sessionId: "s1",
			turnId: "t2",
			turnCompleted: false,
		});
		expect(markdownOf(nextTurn.entries, "a2")).toBe("");
	});

	it("resets held text on session change", () => {
		const projection = createRevealTextProjection();
		projection.apply({ sceneEntries: [assistant("a1", "Session one text")], ...RUNNING });
		const otherSession = projection.apply({
			sceneEntries: [assistant("a1", "")],
			sessionId: "s2",
			turnId: "t1",
			turnCompleted: false,
		});
		expect(markdownOf(otherSession.entries, "a1")).toBe("");
	});

	it("returns the same array reference when input is unchanged and nothing is overridden", () => {
		const projection = createRevealTextProjection();
		const input = [assistant("a1", "Stable")];
		const first = projection.apply({ sceneEntries: input, ...RUNNING });
		const second = projection.apply({ sceneEntries: input, ...RUNNING });
		expect(first.entries).toBe(input);
		expect(second.entries).toBe(first.entries);
	});

	it("does not mutate the input scene entries when overriding", () => {
		const projection = createRevealTextProjection();
		projection.apply({ sceneEntries: [assistant("a1", "Held text")], ...RUNNING });
		const blankInput = [assistant("a1", "")];
		const result = projection.apply({ sceneEntries: blankInput, ...RUNNING });
		expect(markdownOf(result.entries, "a1")).toBe("Held text");
		expect(blankInput[0]?.type === "assistant" ? blankInput[0].markdown : null).toBe("");
		expect(result.entries).not.toBe(blankInput);
	});

	it("emits a reveal-scene-patch describing the overridden indices", () => {
		const projection = createRevealTextProjection();
		projection.apply({ sceneEntries: [user("u1", "P"), assistant("a1", "Held text")], ...RUNNING });
		const blankInput = [user("u1", "P"), assistant("a1", "")];
		const result = projection.apply({ sceneEntries: blankInput, ...RUNNING });

		expect(result.scenePatch.kind).toBe("displayScene");
		if (result.scenePatch.kind !== "displayScene") {
			return;
		}
		expect(result.scenePatch.patch.baseSceneEntries).toBe(blankInput);
		expect(result.scenePatch.patch.entriesByIndex.has(1)).toBe(true);
		expect(result.scenePatch.patch.entriesByIndex.has(0)).toBe(false);
	});

	it("emits no patch when nothing is overridden", () => {
		const projection = createRevealTextProjection();
		const input = [assistant("a1", "Plain canonical text")];
		const result = projection.apply({ sceneEntries: input, ...RUNNING });
		expect(result.entries).toBe(input);
		expect(result.scenePatch).toEqual(scenePatchIdentity());
	});
});
