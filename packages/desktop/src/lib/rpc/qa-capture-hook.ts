/**
 * Capturing a real session as a replayable QA scenario.
 *
 * The capture runs inside the app and through the app's own RpcClient, so what
 * lands in the file is exactly what the server answered -- not a second
 * implementation of the read path that could drift from it.
 *
 * `qa:eval` in the QA preload refuses promises, so this is a start/read pair
 * instead of one async call: `start` kicks off the collection and returns, and
 * the CLI polls `read` until it reports done.
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

/** The cheap half of the pair: polled every few hundred ms, so it stays small. */
export type QaCaptureProgress = {
	readonly done: boolean;
	readonly error: string | null;
	readonly eventCount: number;
};

declare global {
	interface Window {
		__acepeQaCaptureStart?: (sessionId: string, quietMs: number) => string;
		__acepeQaCaptureProgress?: () => QaCaptureProgress;
		__acepeQaCaptureRead?: () => QaCaptureState;
	}
}

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
							collected.push(event);
							lastAt = at;
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
		void Effect.runPromise(
			collect(sessionId as SessionId, quietMs > 0 ? quietMs : 400).pipe(
				Effect.catchCause((cause) => Effect.sync(() => withError(String(cause)))),
			),
		);
		return sessionId;
	};
	window.__acepeQaCaptureProgress = () => ({
		done: state.done,
		error: state.error,
		eventCount: state.events.length,
	});
	window.__acepeQaCaptureRead = () => state;
};
