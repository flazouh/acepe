/**
 * What a scenario actually puts on screen.
 *
 * The replay runs through the app's own RpcClient and the rows come out of the
 * app's own transcript projection, so a graded expectation covers the real path
 * from event to row. A change in either end shows up here.
 */

import { sessionSnapshotRequest } from "@acepe/contracts";
import type { QaScenario } from "@acepe/qa-scenario";
import { makeScenarioSession } from "@acepe/qa-scenario";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { transcriptRowsFromSessionSnapshot } from "$lib/viewport/transcript-from-snapshot.ts";

export class ScenarioHasNoSession extends Schema.TaggedError<ScenarioHasNoSession>()(
	"ScenarioHasNoSession",
	{
		scenario: Schema.String,
	}
) {
	override get message(): string {
		return `Scenario '${this.scenario}' names no session, so it has no transcript to grade`;
	}
}

/**
 * Replays the whole scenario with no waiting, then reads the transcript the app
 * would show. Rate 0 keeps this cheap enough to run on every CI push.
 */
export const transcriptFromScenario = Effect.fn("transcriptFromScenario")(function* (
	scenario: QaScenario
) {
	const sessionId = scenario.meta.capturedFromSessionId;
	if (sessionId === null) {
		return yield* new ScenarioHasNoSession({ scenario: scenario.meta.name });
	}
	const session = yield* makeScenarioSession(scenario, { autoPlay: true, rate: 0 });
	yield* session.controls.awaitDrained;
	const snapshot = yield* session.client.snapshot(sessionSnapshotRequest(sessionId));
	yield* session.shutdown;
	return transcriptRowsFromSessionSnapshot(snapshot);
});

/** The graded shape: plain JSON, so the harness normalizer can diff it. */
export const transcriptJson = Effect.fn("transcriptJson")(function* (scenario: QaScenario) {
	const rows = yield* transcriptFromScenario(scenario);
	return yield* Schema.encodeUnknownEffect(Schema.Json)(rows);
});
