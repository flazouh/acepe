import { describe, expect, it } from "bun:test";

import {
	composeWorkingLineDetails,
	composeWorkingLineText,
	formatWorkingLineElapsed,
	formatWorkingLineTokenCount,
	formatWorkingLineTokens,
	selectWorkingLineVerb,
	selectWorkingLineVerbs,
	WORKING_LINE_VERBS_CLAUDE,
	WORKING_LINE_VERBS_NEUTRAL,
} from "./working-line.js";

describe("selectWorkingLineVerb", () => {
	it("is stable for the same seed and elapsed bucket across repeated calls", () => {
		const first = selectWorkingLineVerb({
			seed: "turn-1",
			elapsedMs: 1200,
			verbs: WORKING_LINE_VERBS_CLAUDE,
		});
		const second = selectWorkingLineVerb({
			seed: "turn-1",
			elapsedMs: 1200,
			verbs: WORKING_LINE_VERBS_CLAUDE,
		});
		expect(first).toBe(second);
		expect(first).not.toBeNull();
	});

	it("rotates to a different verb once elapsed time crosses the rotate interval", () => {
		const verbsSeen = new Set<string | null>();
		for (let tick = 0; tick < 6; tick += 1) {
			verbsSeen.add(
				selectWorkingLineVerb({
					seed: "turn-1",
					elapsedMs: tick * 3000,
					verbs: WORKING_LINE_VERBS_CLAUDE,
				})
			);
		}
		// Six consecutive 3s ticks against a 20-word list should not all land
		// on the same word.
		expect(verbsSeen.size).toBeGreaterThan(1);
	});

	it("does not reshuffle within the same 3s bucket", () => {
		const a = selectWorkingLineVerb({ seed: "turn-1", elapsedMs: 3000, verbs: WORKING_LINE_VERBS_CLAUDE });
		const b = selectWorkingLineVerb({ seed: "turn-1", elapsedMs: 4999, verbs: WORKING_LINE_VERBS_CLAUDE });
		expect(a).toBe(b);
	});

	it("usually differs between two different turn seeds at the same elapsed time", () => {
		const seeds = ["turn-1", "turn-2", "turn-3", "turn-4", "turn-5"];
		const verbs = new Set(
			seeds.map((seed) => selectWorkingLineVerb({ seed, elapsedMs: 0, verbs: WORKING_LINE_VERBS_CLAUDE }))
		);
		expect(verbs.size).toBeGreaterThan(1);
	});

	it("is deterministic across process runs for a fixed seed (regression pin)", () => {
		expect(
			selectWorkingLineVerb({ seed: "turn-42", elapsedMs: 0, verbs: WORKING_LINE_VERBS_CLAUDE })
		).toBe(selectWorkingLineVerb({ seed: "turn-42", elapsedMs: 0, verbs: WORKING_LINE_VERBS_CLAUDE }));
	});

	it("returns null for an empty verb list", () => {
		expect(selectWorkingLineVerb({ seed: "turn-1", elapsedMs: 0, verbs: [] })).toBeNull();
	});

	it("treats a null seed as a valid, stable seed", () => {
		const a = selectWorkingLineVerb({ seed: null, elapsedMs: 0, verbs: WORKING_LINE_VERBS_CLAUDE });
		const b = selectWorkingLineVerb({ seed: null, elapsedMs: 0, verbs: WORKING_LINE_VERBS_CLAUDE });
		expect(a).toBe(b);
		expect(a).not.toBeNull();
	});
});

describe("selectWorkingLineVerbs", () => {
	it("gives Claude Code sessions the richer, native-flavored list", () => {
		expect(selectWorkingLineVerbs(true)).toBe(WORKING_LINE_VERBS_CLAUDE);
	});

	it("gives every other provider the neutral list", () => {
		expect(selectWorkingLineVerbs(false)).toBe(WORKING_LINE_VERBS_NEUTRAL);
	});

	it("keeps the two lists genuinely distinct, not copied verbatim from Claude Code's own", () => {
		const overlap = WORKING_LINE_VERBS_CLAUDE.filter((verb) => WORKING_LINE_VERBS_NEUTRAL.includes(verb));
		expect(overlap).toEqual([]);
	});
});

describe("formatWorkingLineTokenCount", () => {
	it("shows small counts verbatim", () => {
		expect(formatWorkingLineTokenCount(0)).toBe("0");
		expect(formatWorkingLineTokenCount(48)).toBe("48");
		expect(formatWorkingLineTokenCount(999)).toBe("999");
	});

	it("compacts thousands with one decimal place", () => {
		expect(formatWorkingLineTokenCount(1400)).toBe("1.4k");
		expect(formatWorkingLineTokenCount(1000)).toBe("1k");
	});

	it("compacts tens of thousands with no decimal place", () => {
		expect(formatWorkingLineTokenCount(12_345)).toBe("12k");
	});

	it("compacts millions", () => {
		expect(formatWorkingLineTokenCount(2_500_000)).toBe("2.5m");
	});

	it("clamps negative or non-finite input to 0", () => {
		expect(formatWorkingLineTokenCount(-5)).toBe("0");
		expect(formatWorkingLineTokenCount(Number.NaN)).toBe("0");
	});
});

describe("formatWorkingLineTokens", () => {
	it("returns null when there is no real usage reading yet -- never fabricates a zero", () => {
		expect(formatWorkingLineTokens(null)).toBeNull();
	});

	it("formats a real reading with the compact count", () => {
		expect(formatWorkingLineTokens(1400)).toBe("1.4k tokens");
	});

	it("formats zero as a real reading once one has actually arrived", () => {
		expect(formatWorkingLineTokens(0)).toBe("0 tokens");
	});
});

describe("formatWorkingLineElapsed", () => {
	it("shows seconds under a minute", () => {
		expect(formatWorkingLineElapsed(3000)).toBe("3s");
		expect(formatWorkingLineElapsed(59_000)).toBe("59s");
	});

	it("shows minutes and seconds at or beyond a minute", () => {
		expect(formatWorkingLineElapsed(60_000)).toBe("1m 0s");
		expect(formatWorkingLineElapsed(72_000)).toBe("1m 12s");
	});

	it("floors sub-second elapsed time", () => {
		expect(formatWorkingLineElapsed(3999)).toBe("3s");
	});

	it("clamps negative elapsed time to 0s", () => {
		expect(formatWorkingLineElapsed(-100)).toBe("0s");
	});
});

describe("composeWorkingLineDetails", () => {
	it("joins all three pieces with the middle dot, tokens prefixed with the up arrow", () => {
		expect(
			composeWorkingLineDetails({
				elapsed: "12s",
				tokens: "1.4k tokens",
				interruptHint: "ctrl+c to interrupt",
			})
		).toBe("(12s · ↑ 1.4k tokens · ctrl+c to interrupt)");
	});

	it("omits the tokens segment entirely when there is no reading yet", () => {
		expect(
			composeWorkingLineDetails({ elapsed: "12s", tokens: null, interruptHint: "ctrl+c to interrupt" })
		).toBe("(12s · ctrl+c to interrupt)");
	});

	it("omits the interrupt hint when the caller has none to give", () => {
		expect(composeWorkingLineDetails({ elapsed: "12s", tokens: null, interruptHint: null })).toBe(
			"(12s)"
		);
	});

	it("returns null when every piece is null", () => {
		expect(composeWorkingLineDetails({ elapsed: null, tokens: null, interruptHint: null })).toBeNull();
	});
});

describe("composeWorkingLineText", () => {
	it("appends an ellipsis to the verb and the parenthetical details", () => {
		expect(composeWorkingLineText({ verb: "Puzzling", details: "(12s)" })).toBe("Puzzling… (12s)");
	});

	it("still shows the verb with an ellipsis when there are no details yet", () => {
		expect(composeWorkingLineText({ verb: "Puzzling", details: null })).toBe("Puzzling…");
	});

	it("returns null when there is no verb (e.g. an empty verb list)", () => {
		expect(composeWorkingLineText({ verb: null, details: "(12s)" })).toBeNull();
	});
});
