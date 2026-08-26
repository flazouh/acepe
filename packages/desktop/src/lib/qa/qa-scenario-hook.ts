/**
 * Driving a replayed scenario from a QA script.
 *
 * `qa:eval` in the QA preload refuses promises, so every function here returns
 * a plain value immediately. Reads are synchronous because the player's state
 * is only Ref reads; the controls start their work and report that they did,
 * and the caller confirms the result by reading state again.
 */

import type { ScenarioPlaybackState, ScenarioSession } from "@acepe/qa-scenario";
import * as Effect from "effect/Effect";

export type QaScenarioHandle = {
	readonly name: string;
	readonly description: string;
	readonly state: () => ScenarioPlaybackState;
	readonly play: () => string;
	readonly pause: () => string;
	readonly step: () => string;
	readonly seek: (index: number) => string;
	readonly rate: (value: number) => string;
};

declare global {
	interface Window {
		__acepeQaScenario?: QaScenarioHandle;
	}
}

const started = (label: string): string => `${label}: started`;

export const makeQaScenarioHandle = (session: ScenarioSession): QaScenarioHandle => ({
	name: session.scenario.meta.name,
	description: session.scenario.meta.description,
	state: () => Effect.runSync(session.controls.state),
	play: () => {
		void Effect.runPromise(session.controls.play);
		return started("play");
	},
	pause: () => {
		void Effect.runPromise(session.controls.pause);
		return started("pause");
	},
	step: () => {
		void Effect.runPromise(session.controls.stepOnce);
		return started("step");
	},
	seek: (index) => {
		void Effect.runPromise(session.controls.seekTo(index));
		return started("seek");
	},
	rate: (value) => {
		void Effect.runPromise(session.controls.setRate(value));
		return started("rate");
	},
});

export const installQaScenarioHook = (session: ScenarioSession): void => {
	window.__acepeQaScenario = makeQaScenarioHandle(session);
};
