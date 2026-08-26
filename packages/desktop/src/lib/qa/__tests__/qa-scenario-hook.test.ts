import { makeScenarioSession, streamingReply } from "@acepe/qa-scenario";
import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { makeQaScenarioHandle } from "../qa-scenario-hook.ts";

const parkedSession = () =>
	Effect.runPromise(makeScenarioSession(streamingReply, { autoPlay: false, rate: 0 }));

describe("the QA scenario window handle", () => {
	it("names the scenario it is driving", async () => {
		const session = await parkedSession();
		const handle = makeQaScenarioHandle(session);
		expect(handle.name).toBe("streaming-reply");
		await Effect.runPromise(session.shutdown);
	});

	/**
	 * qa:eval refuses promises, so every function here has to answer with a
	 * plain value. A state() that returned a promise would make the whole
	 * handle unusable from a QA script.
	 */
	it("reads playback state synchronously", async () => {
		const session = await parkedSession();
		const handle = makeQaScenarioHandle(session);
		const state = handle.state();
		expect(state.mode).toBe("paused");
		expect(state.cursor).toBe(0);
		expect(state.total).toBe(streamingReply.steps.length);
		await Effect.runPromise(session.shutdown);
	});

	it("controls answer with a plain string, never a promise", async () => {
		const session = await parkedSession();
		const handle = makeQaScenarioHandle(session);
		for (const answer of [handle.play(), handle.pause(), handle.step(), handle.seek(1), handle.rate(2)]) {
			expect(typeof answer).toBe("string");
		}
		await Effect.runPromise(session.shutdown);
	});

	it("stepping moves the cursor the script can read back", async () => {
		const session = await parkedSession();
		const handle = makeQaScenarioHandle(session);
		handle.step();
		await Effect.runPromise(Effect.sleep("50 millis"));
		expect(handle.state().cursor).toBe(1);
		await Effect.runPromise(session.shutdown);
	});
});
