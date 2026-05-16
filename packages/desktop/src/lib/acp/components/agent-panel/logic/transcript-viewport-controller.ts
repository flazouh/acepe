import type { TranscriptViewportEffect } from "./transcript-viewport-effects.js";
import type {
	TranscriptViewportEvent,
	TranscriptViewportMeasurement,
} from "./transcript-viewport-events.js";
import { orderTranscriptViewportEvents } from "./transcript-viewport-events.js";
import { createRowAnchor, createTailAnchor, type TranscriptViewportAnchor } from "./viewport-anchor.js";
import {
	createEmptyTranscriptViewportRows,
	type TranscriptViewportRowSummary,
} from "./transcript-viewport-row-summary.js";

const NEAR_TAIL_THRESHOLD_PX = 24;

export type TranscriptViewportFollowState = "following" | "detached";

export type TranscriptViewportRendererState =
	| {
			type: "primary";
	  }
	| {
			type: "fallback";
			reason: string;
	  };

export type TranscriptViewportState = {
	sessionId: string | null;
	generation: number;
	renderer: TranscriptViewportRendererState;
	follow: TranscriptViewportFollowState;
	anchor: TranscriptViewportAnchor;
	rows: TranscriptViewportRowSummary;
	pendingSendReveal: boolean;
	programmaticScrollInFlight: boolean;
	lastMeasurement: TranscriptViewportMeasurement | null;
};

export type TranscriptViewportInitialOptions = {
	sessionId: string | null;
	rows?: TranscriptViewportRowSummary;
};

export type TranscriptViewportStep = {
	state: TranscriptViewportState;
	effects: readonly TranscriptViewportEffect[];
};

export function createInitialTranscriptViewportState(
	options: TranscriptViewportInitialOptions
): TranscriptViewportState {
	return {
		sessionId: options.sessionId,
		generation: 0,
		renderer: {
			type: "primary",
		},
		follow: "following",
		anchor: createTailAnchor(),
		rows: options.rows ?? createEmptyTranscriptViewportRows(),
		pendingSendReveal: false,
		programmaticScrollInFlight: false,
		lastMeasurement: null,
	};
}

function isEventCurrent(state: TranscriptViewportState, event: TranscriptViewportEvent): boolean {
	if (event.type === "SessionChanged") {
		return true;
	}
	if (event.sessionId !== state.sessionId) {
		return false;
	}
	if (event.generation === undefined) {
		return true;
	}
	return event.generation === state.generation;
}

function createStaleEventDiagnostic(
	state: TranscriptViewportState,
	event: TranscriptViewportEvent
): TranscriptViewportEffect {
	return {
		type: "ReportDiagnostic",
		sessionId: state.sessionId,
		generation: state.generation,
		code: "stale-event-dropped",
		message: `Dropped ${event.type} for an old session or generation`,
	};
}

function isNearTail(measurement: TranscriptViewportMeasurement): boolean {
	const distanceFromTail =
		measurement.scrollSize - measurement.viewportSize - measurement.scrollOffset;
	return distanceFromTail <= NEAR_TAIL_THRESHOLD_PX;
}

function areMeasurementsEqual(
	left: TranscriptViewportMeasurement,
	right: TranscriptViewportMeasurement
): boolean {
	return (
		left.scrollOffset === right.scrollOffset &&
		left.scrollSize === right.scrollSize &&
		left.viewportSize === right.viewportSize
	);
}

function createDetachedState(
	state: TranscriptViewportState,
	measurement: TranscriptViewportMeasurement,
	anchorKey: string | undefined,
	anchorOffsetPx: number | undefined
): TranscriptViewportState {
	return {
		sessionId: state.sessionId,
		generation: state.generation,
		renderer: state.renderer,
		follow: "detached",
		anchor:
			anchorKey === undefined
				? {
						type: "offset",
						offsetPx: measurement.scrollOffset,
				  }
				: createRowAnchor(anchorKey, anchorOffsetPx ?? measurement.scrollOffset),
		rows: state.rows,
		pendingSendReveal: state.pendingSendReveal,
		programmaticScrollInFlight: false,
		lastMeasurement: measurement,
	};
}

function revealTailEffect(
	state: TranscriptViewportState,
	reason: Extract<TranscriptViewportEffect, { type: "RevealTail" }>["reason"],
	force: boolean
): TranscriptViewportEffect {
	return {
		type: "RevealTail",
		sessionId: state.sessionId,
		generation: state.generation,
		force,
		reason,
	};
}

function revealRowEffect(
	state: TranscriptViewportState,
	targetKey: string,
	align: "start" | "center" | "end",
	reason: Extract<TranscriptViewportEffect, { type: "RevealRow" }>["reason"]
): TranscriptViewportEffect {
	return {
		type: "RevealRow",
		sessionId: state.sessionId,
		generation: state.generation,
		targetKey,
		align,
		reason,
	};
}

function withFollowing(state: TranscriptViewportState): TranscriptViewportState {
	return {
		sessionId: state.sessionId,
		generation: state.generation,
		renderer: state.renderer,
		follow: "following",
		anchor: createTailAnchor(),
		rows: state.rows,
		pendingSendReveal: state.pendingSendReveal,
		programmaticScrollInFlight: state.programmaticScrollInFlight,
		lastMeasurement: state.lastMeasurement,
	};
}

function withRows(
	state: TranscriptViewportState,
	rows: TranscriptViewportRowSummary
): TranscriptViewportState {
	return {
		sessionId: state.sessionId,
		generation: state.generation,
		renderer: state.renderer,
		follow: state.follow,
		anchor: state.anchor,
		rows,
		pendingSendReveal: state.pendingSendReveal,
		programmaticScrollInFlight: state.programmaticScrollInFlight,
		lastMeasurement: state.lastMeasurement,
	};
}

function withPendingSendReveal(
	state: TranscriptViewportState,
	pendingSendReveal: boolean
): TranscriptViewportState {
	return {
		sessionId: state.sessionId,
		generation: state.generation,
		renderer: state.renderer,
		follow: state.follow,
		anchor: state.anchor,
		rows: state.rows,
		pendingSendReveal,
		programmaticScrollInFlight: state.programmaticScrollInFlight,
		lastMeasurement: state.lastMeasurement,
	};
}

function withProgrammaticScrollInFlight(
	state: TranscriptViewportState,
	programmaticScrollInFlight: boolean
): TranscriptViewportState {
	return {
		sessionId: state.sessionId,
		generation: state.generation,
		renderer: state.renderer,
		follow: state.follow,
		anchor: state.anchor,
		rows: state.rows,
		pendingSendReveal: state.pendingSendReveal,
		programmaticScrollInFlight,
		lastMeasurement: state.lastMeasurement,
	};
}

function shouldRevealTailForExplicitReveal(
	state: TranscriptViewportState,
	targetKey: string
): boolean {
	return (
		state.rows.reason === "waiting-row-appended" &&
		state.rows.lastKey !== null &&
		state.rows.lastKey !== targetKey
	);
}

function reduceRowsChanged(
	state: TranscriptViewportState,
	rows: TranscriptViewportRowSummary
): TranscriptViewportStep {
	const nextRowsState = withRows(state, rows);
	if (nextRowsState.pendingSendReveal) {
		const followingState = withProgrammaticScrollInFlight(
			withPendingSendReveal(withFollowing(nextRowsState), false),
			true
		);
		if (rows.reason === "waiting-row-appended") {
			return {
				state: followingState,
				effects: [revealTailEffect(followingState, "send-started", true)],
			};
		}
		const targetKey = rows.latestUserKey ?? rows.lastKey;
		if (targetKey !== null) {
			return {
				state: followingState,
				effects: [revealRowEffect(followingState, targetKey, "end", "send-started")],
			};
		}
		return {
			state: followingState,
			effects: [revealTailEffect(followingState, "send-started", true)],
		};
	}

	if (nextRowsState.follow === "following" && rows.count > 0) {
		const followingState = withProgrammaticScrollInFlight(nextRowsState, true);
		return {
			state: followingState,
			effects: [revealTailEffect(followingState, "rows-changed-following", false)],
		};
	}

	if (nextRowsState.anchor.type === "row") {
		return {
			state: nextRowsState,
			effects: [
				{
					type: "PreserveAnchor",
					sessionId: nextRowsState.sessionId,
					generation: nextRowsState.generation,
					anchorKey: nextRowsState.anchor.rowKey,
					offsetPx: nextRowsState.anchor.offsetPx,
				},
			],
		};
	}

	return {
		state: nextRowsState,
		effects: [],
	};
}

function reduceUserScroll(
	state: TranscriptViewportState,
	measurement: TranscriptViewportMeasurement,
	anchorKey: string | undefined,
	anchorOffsetPx: number | undefined
): TranscriptViewportStep {
	if (state.programmaticScrollInFlight && state.follow === "following") {
		const settledAtTail = isNearTail(measurement);
		if (!settledAtTail && state.lastMeasurement !== null) {
			if (areMeasurementsEqual(state.lastMeasurement, measurement)) {
				return {
					state: createDetachedState(state, measurement, anchorKey, anchorOffsetPx),
					effects: [],
				};
			}
		}
		return {
			state: {
				sessionId: state.sessionId,
				generation: state.generation,
				renderer: state.renderer,
				follow: state.follow,
				anchor: state.anchor,
				rows: state.rows,
				pendingSendReveal: state.pendingSendReveal,
				programmaticScrollInFlight: !settledAtTail,
				lastMeasurement: measurement,
			},
			effects: [],
		};
	}

	if (measurement.scrollSize <= measurement.viewportSize && state.follow === "detached") {
		return {
			state: {
				sessionId: state.sessionId,
				generation: state.generation,
				renderer: state.renderer,
				follow: state.follow,
				anchor: state.anchor,
				rows: state.rows,
				pendingSendReveal: state.pendingSendReveal,
				programmaticScrollInFlight: state.programmaticScrollInFlight,
				lastMeasurement: measurement,
			},
			effects: [],
		};
	}

	if (isNearTail(measurement)) {
		return {
			state: {
				sessionId: state.sessionId,
				generation: state.generation,
				renderer: state.renderer,
				follow: "following",
				anchor: createTailAnchor(),
				rows: state.rows,
				pendingSendReveal: state.pendingSendReveal,
				programmaticScrollInFlight: false,
				lastMeasurement: measurement,
			},
			effects: [],
		};
	}

	return {
		state: createDetachedState(state, measurement, anchorKey, anchorOffsetPx),
		effects: [],
	};
}

export function reduceTranscriptViewportEvent(
	state: TranscriptViewportState,
	event: TranscriptViewportEvent
): TranscriptViewportStep {
	if (!isEventCurrent(state, event)) {
		return {
			state,
			effects: [createStaleEventDiagnostic(state, event)],
		};
	}

	switch (event.type) {
		case "SessionChanged":
			return {
				state: {
					sessionId: event.sessionId,
					generation: state.generation + 1,
					renderer: {
						type: "primary",
					},
					follow: "following",
					anchor: createTailAnchor(),
					rows: createEmptyTranscriptViewportRows(),
					pendingSendReveal: false,
					programmaticScrollInFlight: false,
					lastMeasurement: null,
				},
				effects: [],
			};
		case "RowsChanged":
			return reduceRowsChanged(state, event.rows);
		case "UserScroll":
			return reduceUserScroll(state, event.measurement, event.anchorKey, event.anchorOffsetPx);
		case "UserWheel":
		case "UserNavigationScroll":
			return reduceUserScroll(
				withProgrammaticScrollInFlight(state, false),
				event.measurement,
				event.anchorKey,
				event.anchorOffsetPx
			);
		case "ScrollMeasured":
		case "ViewportResized":
			return {
				state: {
					sessionId: state.sessionId,
					generation: state.generation,
					renderer: state.renderer,
					follow: state.follow,
					anchor: state.anchor,
					rows: state.rows,
					pendingSendReveal: state.pendingSendReveal,
					programmaticScrollInFlight: state.programmaticScrollInFlight,
					lastMeasurement: event.measurement,
				},
				effects: [],
			};
		case "SendStarted": {
			const followingState = withProgrammaticScrollInFlight(withFollowing(state), true);
			if (event.targetKey !== undefined) {
				return {
					state: withPendingSendReveal(followingState, false),
					effects: [revealRowEffect(followingState, event.targetKey, "end", "send-started")],
				};
			}
			return {
				state: withPendingSendReveal(followingState, true),
				effects: [revealTailEffect(followingState, "send-started", true)],
			};
		}
		case "PanelActivated": {
			const followingState = withProgrammaticScrollInFlight(withFollowing(state), true);
			if (event.targetKey !== undefined) {
				return {
					state: followingState,
					effects: [revealRowEffect(followingState, event.targetKey, "end", "panel-activated")],
				};
			}
			return {
				state: followingState,
				effects: [revealTailEffect(followingState, "panel-activated", true)],
			};
		}
		case "ExplicitRevealRequested": {
			const revealState = withProgrammaticScrollInFlight(withFollowing(state), true);
			if (shouldRevealTailForExplicitReveal(state, event.targetKey)) {
				return {
					state: revealState,
					effects: [revealTailEffect(revealState, "rows-changed-following", false)],
				};
			}
			return {
				state: revealState,
				effects: [revealRowEffect(revealState, event.targetKey, "end", "explicit-reveal")],
			};
		}
		case "PublicScrollCommand":
			if (event.command === "top" && state.rows.firstKey !== null) {
				const topState = {
					sessionId: state.sessionId,
					generation: state.generation,
					renderer: state.renderer,
					follow: "detached" as const,
					anchor: createRowAnchor(state.rows.firstKey, 0),
					rows: state.rows,
					pendingSendReveal: state.pendingSendReveal,
					programmaticScrollInFlight: false,
					lastMeasurement: state.lastMeasurement,
				};
				return {
					state: topState,
					effects: [revealRowEffect(topState, state.rows.firstKey, "start", "public-scroll-top")],
				};
			}
			if (event.command === "bottom") {
				const followingState = withProgrammaticScrollInFlight(withFollowing(state), true);
				return {
					state: followingState,
					effects: [revealTailEffect(followingState, "public-scroll-bottom", true)],
				};
			}
			const followState = withProgrammaticScrollInFlight(withFollowing(state), true);
			return {
				state: followState,
				effects: [revealTailEffect(followState, "public-follow", true)],
			};
		case "RendererFailed":
			return {
				state: {
					sessionId: state.sessionId,
					generation: state.generation,
					renderer: {
						type: "fallback",
						reason: event.reason,
					},
					follow: state.follow,
					anchor: state.anchor,
					rows: state.rows,
					pendingSendReveal: state.pendingSendReveal,
					programmaticScrollInFlight: state.programmaticScrollInFlight,
					lastMeasurement: state.lastMeasurement,
				},
				effects: [
					{
						type: "SwitchRenderer",
						sessionId: state.sessionId,
						generation: state.generation,
						renderer: "fallback",
						reason: event.reason,
					},
				],
			};
		case "RendererRecovered":
			const recoveredState = {
				sessionId: state.sessionId,
				generation: state.generation,
				renderer: {
					type: "primary" as const,
				},
				follow: state.follow,
				anchor: state.anchor,
				rows: state.rows,
				pendingSendReveal: state.pendingSendReveal,
				programmaticScrollInFlight: state.programmaticScrollInFlight,
				lastMeasurement: state.lastMeasurement,
			};
			if (state.anchor.type === "offset") {
				return {
					state: recoveredState,
					effects: [
						{
							type: "SwitchRenderer",
							sessionId: state.sessionId,
							generation: state.generation,
							renderer: "primary",
						},
						{
							type: "ApplyScrollOffset",
							sessionId: state.sessionId,
							generation: state.generation,
							offsetPx: state.anchor.offsetPx,
							reason: "fallback-recovery",
						},
					],
				};
			}
			if (state.anchor.type === "row") {
				return {
					state: recoveredState,
					effects: [
						{
							type: "SwitchRenderer",
							sessionId: state.sessionId,
							generation: state.generation,
							renderer: "primary",
						},
						{
							type: "PreserveAnchor",
							sessionId: state.sessionId,
							generation: state.generation,
							anchorKey: state.anchor.rowKey,
							offsetPx: state.anchor.offsetPx,
						},
					],
				};
			}
			return {
				state: {
					sessionId: state.sessionId,
					generation: state.generation,
					renderer: {
						type: "primary",
					},
					follow: state.follow,
					anchor: state.anchor,
					rows: state.rows,
					pendingSendReveal: state.pendingSendReveal,
					programmaticScrollInFlight: state.programmaticScrollInFlight,
					lastMeasurement: state.lastMeasurement,
				},
				effects: [
					{
						type: "SwitchRenderer",
						sessionId: state.sessionId,
						generation: state.generation,
						renderer: "primary",
					},
				],
			};
		case "AdapterAnchorMissing":
			return {
				state: {
					sessionId: state.sessionId,
					generation: state.generation,
					renderer: state.renderer,
					follow: state.follow,
					anchor: {
						type: "offset",
						offsetPx: event.fallbackOffsetPx,
					},
					rows: state.rows,
					pendingSendReveal: state.pendingSendReveal,
					programmaticScrollInFlight: state.programmaticScrollInFlight,
					lastMeasurement: state.lastMeasurement,
				},
				effects: [
					{
						type: "ApplyScrollOffset",
						sessionId: state.sessionId,
						generation: state.generation,
						offsetPx: event.fallbackOffsetPx,
						reason: "anchor-missing",
					},
					{
						type: "ReportDiagnostic",
						sessionId: state.sessionId,
						generation: state.generation,
						code: "anchor-missing",
						message: `Anchor ${event.anchorKey} was not measurable`,
					},
				],
			};
		case "RendererHealthProbeReported":
			if (!event.healthy && event.reason !== undefined) {
				return reduceTranscriptViewportEvent(state, {
					type: "RendererFailed",
					sessionId: state.sessionId,
					generation: state.generation,
					reason: event.reason,
				});
			}
			return {
				state,
				effects: [],
			};
		case "EffectSkipped":
			return {
				state,
				effects: [
					{
						type: "ReportDiagnostic",
						sessionId: state.sessionId,
						generation: state.generation,
						code: "effect-skipped",
						message: `${event.effectType} skipped: ${event.reason}`,
					},
				],
			};
		case "RendererMounted":
			return {
				state,
				effects: [
					{
						type: "ProbeRendererHealth",
						sessionId: state.sessionId,
						generation: state.generation,
					},
				],
			};
		case "RowResized":
			if (state.follow === "following") {
				const followingState = withProgrammaticScrollInFlight(state, true);
				return {
					state: followingState,
					effects: [revealTailEffect(followingState, "rows-changed-following", false)],
				};
			}
			if (state.anchor.type === "row") {
				return {
					state,
					effects: [
						{
							type: "PreserveAnchor",
							sessionId: state.sessionId,
							generation: state.generation,
							anchorKey: state.anchor.rowKey,
							offsetPx: state.anchor.offsetPx,
						},
					],
				};
			}
			return {
				state,
				effects: [],
			};
		case "EffectApplied":
			return {
				state,
				effects: [],
			};
	}
}

export function reduceTranscriptViewportBatch(
	state: TranscriptViewportState,
	events: readonly TranscriptViewportEvent[]
): TranscriptViewportStep {
	let nextState = state;
	const effects: TranscriptViewportEffect[] = [];
	for (const event of orderTranscriptViewportEvents(events)) {
		const result = reduceTranscriptViewportEvent(nextState, event);
		nextState = result.state;
		for (const effect of result.effects) {
			effects.push(effect);
		}
	}
	return {
		state: nextState,
		effects,
	};
}
