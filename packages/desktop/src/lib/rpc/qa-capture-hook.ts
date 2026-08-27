/**
 * Capturing a real session as a replayable QA scenario.
 *
 * The capture runs inside the app and through the app's own RpcClient, so what
 * lands in the file is exactly what the server answered -- not a second
 * implementation of the read path that could drift from it.
 *
 * `qa:eval` in the QA preload refuses promises, so this is a start/read pair
 * instead of one async call: `start` kicks off the collection and returns, and
 * the CLI polls progress until it reports done.
 *
 * The reads are paged. A library's history runs to thousands of events, and one
 * call carrying all of them past the preload's 5s eval deadline fails the whole
 * capture at the last step, after the collection already succeeded.
 */

import type { OrchestrationEvent, RpcSessionSnapshot, SessionId } from "@acepe/contracts";
import { librarySnapshotRequest, sessionSnapshotRequest } from "@acepe/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { appRpcClient } from "./app-client.ts";

export type QaCaptureSnapshot = {
	readonly scopeKey: string;
	readonly snapshot: RpcSessionSnapshot;
};

export type QaCaptureState = {
	/** True once the historical replay went quiet and the snapshots arrived. */
	readonly done: boolean;
	readonly error: string | null;
	readonly sessionId: string | null;
	readonly events: ReadonlyArray<OrchestrationEvent>;
	readonly snapshots: ReadonlyArray<QaCaptureSnapshot>;
};

/** Small enough to poll every few hundred ms while the collection runs. */
export type QaCaptureProgress = {
	readonly done: boolean;
	readonly error: string | null;
	readonly sessionId: string | null;
	readonly eventCount: number;
};

declare global {
	interface Window {
		__acepeQaCaptureStart?: (sessionId: string, quietMs: number) => string;
		__acepeQaCaptureProgress?: () => QaCaptureProgress;
		__acepeQaCaptureReadEvents?: (
			offset: number,
			limit: number,
		) => ReadonlyArray<OrchestrationEvent>;
		__acepeQaCaptureReadSnapshots?: () => ReadonlyArray<QaCaptureSnapshot>;
	}
}

/**
 * A scenario named for one session carries that session's events. Everything
 * that is not session-scoped is kept because the shell reads it while booting,
 * but another session's turns belong in another scenario -- and a whole
 * library's history is both wrong here and too big to move.
 */
export const belongsToCapture = (
	event: OrchestrationEvent,
	sessionId: SessionId,
): boolean => event.aggregateKind !== "session" || event.aggregateId === sessionId;

const idle: QaCaptureState = {
	done: false,
	error: null,
	sessionId: null,
	events: [],
	snapshots: [],
};

let state: QaCaptureState = idle;

const replace = (next: QaCaptureState): void => {
	state = next;
};

const withError = (reason: string): void => {
	replace({
		done: true,
		error: reason,
		sessionId: state.sessionId,
		events: state.events,
		snapshots: state.snapshots,
	});
};

/**
 * The server replays history from sequence 0 and then goes live on the same
 * stream, with no marker between the two. A quiet window is the honest
 * boundary: a historical dump arrives in one burst, so the first gap longer
 * than `quietMs` is the end of it.
 */
const collect = (sessionId: SessionId, quietMs: number) =>
	Effect.gen(function* () {
		const client = yield* appRpcClient();
		const collected: Array<OrchestrationEvent> = [];
		let lastAt = yield* Clock.currentTimeMillis;

		const listener = yield* Effect.forkDetach(
			client.events(0).pipe(
				Stream.runForEach((event) =>
					Clock.currentTimeMillis.pipe(
						Effect.map((at) => {
							// The quiet window tracks every event, not just the kept
							// ones: the burst is over when the server stops sending,
							// which has nothing to do with which session they are for.
							lastAt = at;
							if (belongsToCapture(event, sessionId) === true) {
								collected.push(event);
							}
						}),
					),
				),
			),
		);

		let quiet = false;
		while (quiet === false) {
			yield* Effect.sleep(Duration.millis(quietMs));
			const at = yield* Clock.currentTimeMillis;
			quiet = at - lastAt >= quietMs;
		}

		const session = yield* client.snapshot(sessionSnapshotRequest(sessionId));
		const library = yield* client.snapshot(librarySnapshotRequest());
		yield* Fiber.interrupt(listener);

		replace({
			done: true,
			error: null,
			sessionId,
			events: collected,
			snapshots: [
				{ scopeKey: `session:${sessionId}`, snapshot: session },
				{ scopeKey: "library", snapshot: library },
			],
		});
	});

export const installQaCaptureHook = (): void => {
	window.__acepeQaCaptureStart = (sessionId, quietMs) => {
		replace({ done: false, error: null, sessionId, events: [], snapshots: [] });
		// The collection and the QA socket share one Electrobun bridge, and
		// `events(0)` replays the whole history through it. Starting that inside
		// the eval's own turn queues this call's answer behind the replay, so the
		// caller waits out its deadline for a string that was ready immediately.
		// A macrotask lets the answer go first.
		setTimeout(() => {
			void Effect.runPromise(
				collect(sessionId as SessionId, quietMs > 0 ? quietMs : 400).pipe(
					Effect.catchCause((cause) => Effect.sync(() => withError(String(cause)))),
				),
			);
		}, 0);
		return sessionId;
	};
	window.__acepeQaCaptureProgress = () => ({
		done: state.done,
		error: state.error,
		sessionId: state.sessionId,
		eventCount: state.events.length,
	});
	window.__acepeQaCaptureReadEvents = (offset, limit) =>
		state.events.slice(offset, offset + limit);
	window.__acepeQaCaptureReadSnapshots = () => state.snapshots;
};
