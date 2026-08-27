import { describe, expect, it } from "bun:test";
import { firstDivergence } from "@acepe/harness";
import { authoredScenarios } from "@acepe/qa-scenario";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { transcriptJson } from "../scenario-transcript.ts";
import { EXPECTED_SCENARIO_TRANSCRIPTS } from "./expected-scenario-transcripts.ts";

/**
 * Grading a level-2 replay: every scenario runs through the app's own client
 * and its own transcript projection, and the result is diffed against a blessed
 * expectation with the harness normalizer. When this fails it names the exact
 * field that moved, which is the difference between a useful regression signal
 * and "something changed".
 *
 * Re-bless deliberately with `bun run qa:bless`, then read the diff.
 */
describe("scenario transcripts", () => {
	it("every authored scenario has a blessed transcript", () => {
		const blessed = Object.keys(EXPECTED_SCENARIO_TRANSCRIPTS).sort();
		const authored = authoredScenarios.map((scenario) => scenario.meta.name).sort();
		expect(blessed).toEqual(authored);
	});

	/**
	 * A grader that never reports anything is worse than no grader. This proves
	 * the diff actually fires and names where the two transcripts part company.
	 */
	it("names the path where two different transcripts diverge", async () => {
		const [first, second] = authoredScenarios;
		if (first === undefined || second === undefined) {
			throw new Error("this test needs at least two authored scenarios");
		}
		const actual = await Effect.runPromise(transcriptJson(first));
		const wrong = EXPECTED_SCENARIO_TRANSCRIPTS[second.meta.name] ?? null;
		const divergence = firstDivergence(wrong, actual, first.meta.name);
		expect(Option.isSome(divergence)).toBe(true);
		expect(
			Option.getOrElse(
				Option.map(divergence, (found) => found.path),
				() => ""
			)
		).toContain(first.meta.name);
	});

	for (const scenario of authoredScenarios) {
		it(`${scenario.meta.name} replays to the transcript it was blessed with`, async () => {
			const actual = await Effect.runPromise(transcriptJson(scenario));
			const expected = EXPECTED_SCENARIO_TRANSCRIPTS[scenario.meta.name] ?? null;
			const divergence = firstDivergence(expected, actual, scenario.meta.name);
			expect(
				Option.match(divergence, {
					onNone: () => "no divergence",
					onSome: (found) =>
						`${found.path}: expected ${JSON.stringify(found.expected)}, got ${JSON.stringify(found.actual)}`,
				})
			).toBe("no divergence");
		});

		it(`${scenario.meta.name} replays the same way twice`, async () => {
			const first = await Effect.runPromise(transcriptJson(scenario));
			const second = await Effect.runPromise(transcriptJson(scenario));
			expect(Option.isNone(firstDivergence(first, second, scenario.meta.name))).toBe(true);
		});
	}
});
