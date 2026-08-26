/**
 * Model for the QA overlay: playback facts to view props.
 *
 * Pure on purpose. What the overlay claims about a replay -- which event went
 * out last, whether the scrubber can move, what the recording is missing -- is
 * exactly the kind of thing that should be provable without mounting anything.
 */

import type { QaScenario, ScenarioPlaybackState } from "@acepe/qa-scenario";
import type { QaOverlayScenarioOption } from "@acepe/ui";

export const QA_OVERLAY_RATE_OPTIONS: ReadonlyArray<number> = [0, 0.5, 1, 2, 4];

export type QaOverlayProps = {
	readonly scenarioName: string;
	readonly scenarioDescription: string;
	readonly playback: string;
	readonly cursor: number;
	readonly total: number;
	readonly lastEventType: string | null;
	readonly rate: number;
	readonly rateOptions: ReadonlyArray<number>;
	readonly scenarios: ReadonlyArray<QaOverlayScenarioOption>;
	readonly missingCalls: ReadonlyArray<string>;
};

/** The event the cursor has just passed, which is the one the app is showing. */
export const lastEmittedType = (scenario: QaScenario, cursor: number): string | null => {
	if (cursor <= 0) {
		return null;
	}
	const step = scenario.steps[cursor - 1];
	return step === undefined ? null : step.event.type;
};

export const qaOverlayScenarioOptions = (
	all: ReadonlyArray<QaScenario>,
	activeName: string
): ReadonlyArray<QaOverlayScenarioOption> =>
	all.map((scenario) => ({
		name: scenario.meta.name,
		description: scenario.meta.description,
		active: scenario.meta.name === activeName,
	}));

export const qaOverlayProps = (input: {
	readonly scenario: QaScenario;
	readonly playback: ScenarioPlaybackState;
	readonly known: ReadonlyArray<QaScenario>;
	readonly missingCalls: ReadonlyArray<string>;
}): QaOverlayProps => ({
	scenarioName: input.scenario.meta.name,
	scenarioDescription: input.scenario.meta.description,
	playback: input.playback.mode,
	cursor: input.playback.cursor,
	total: input.playback.total,
	lastEventType: lastEmittedType(input.scenario, input.playback.cursor),
	rate: input.playback.rate,
	rateOptions: QA_OVERLAY_RATE_OPTIONS,
	scenarios: qaOverlayScenarioOptions(input.known, input.scenario.meta.name),
	missingCalls: input.missingCalls,
});

/**
 * Switching scenario re-boots the app against the new recording. A replay
 * cannot be rewound in place -- the app has already reduced the events it saw
 * -- so the honest way to start over is a fresh load.
 */
export const scenarioSwitchUrl = (search: string, name: string): string => {
	const params = new URLSearchParams(search);
	params.set("qa", name);
	return `?${params.toString()}`;
};
