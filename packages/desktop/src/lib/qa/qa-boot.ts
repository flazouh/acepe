/**
 * Booting the app against a replayed scenario instead of the live server.
 *
 * The swap happens at `provideAppRpcClient`, the app's one transport seam, so
 * everything above it is the real thing: the same stores, the same envelope
 * reducer, the same components, the same streaming timing. Only the server and
 * the agent are absent.
 */

import { makeScenarioSession } from "@acepe/qa-scenario";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { provideAppRpcClient } from "$lib/rpc/app-client.ts";
import type { QaMode } from "./qa-mode.ts";
import { findScenario, listScenarios } from "./scenario-library.ts";

export class QaScenarioNotFound extends Schema.TaggedError<QaScenarioNotFound>()(
	"QaScenarioNotFound",
	{
		name: Schema.String,
		known: Schema.Array(Schema.String),
	}
) {
	override get message(): string {
		return `No QA scenario named '${this.name}'. This build knows: ${this.known.join(", ")}`;
	}
}

export const startQaScenario = Effect.fn("startQaScenario")(function* (mode: QaMode) {
	const scenario = yield* findScenario(mode.scenario);
	if (scenario === null) {
		const known = yield* listScenarios();
		return yield* new QaScenarioNotFound({
			name: mode.scenario,
			known: known.map((entry) => entry.meta.name),
		});
	}
	const session = yield* makeScenarioSession(scenario, {
		autoPlay: mode.autoPlay,
		rate: mode.rate,
	});
	provideAppRpcClient(session.client);
	return session;
});
