/**
 * Every scenario this build can replay.
 *
 * Authored scenarios come from `@acepe/qa-scenario` as TypeScript, so the
 * compiler checks them. Captured scenarios are ndjson files under
 * `packages/qa-scenario/scenarios/`, read at build time through Vite's glob so
 * nothing has to touch the filesystem at runtime.
 */

import type { QaScenario } from "@acepe/qa-scenario";
import { authoredScenarios, decodeScenario } from "@acepe/qa-scenario";
import * as Effect from "effect/Effect";

const capturedFiles = import.meta.glob<string>(
	"../../../../qa-scenario/scenarios/*.ndjson",
	{ query: "?raw", import: "default", eager: true },
);

const capturedScenarios = Effect.fn("capturedScenarios")(function* () {
	const scenarios: Array<QaScenario> = [];
	for (const text of Object.values(capturedFiles)) {
		scenarios.push(yield* decodeScenario(text));
	}
	return scenarios;
});

export const listScenarios = Effect.fn("listScenarios")(function* () {
	const captured = yield* capturedScenarios();
	return authoredScenarios.concat(captured);
});

export const findScenario = Effect.fn("findScenario")(function* (name: string) {
	const all = yield* listScenarios();
	return all.find((scenario) => scenario.meta.name === name) ?? null;
});
