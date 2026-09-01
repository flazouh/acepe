import { librarySnapshotRequest } from "@acepe/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { appRpcClient } from "$lib/rpc/app-client.js";
import type { JsonValue } from "$lib/services/converted-session-types.js";
import type { SessionGraphRevision } from "../../services/acp-types.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import { type AcpError, ProtocolError } from "../errors/index.js";
import { createLogger } from "../utils/logger.js";
import {
	makeProjectPathResolver,
	OrchestrationCanonicalBridge,
} from "./orchestration-canonical-bridge.js";
import { shareEventSource } from "./shared-event-source.js";

const logger = createLogger({
	id: LOGGER_IDS.EVENT_SUBSCRIBER,
	name: "ACP Event Bridge",
});

export interface AcpEventEnvelope {
	seq: number;
	eventName: string;
	sessionId: string | null;
	payload: JsonValue;
	priority: string;
	droppable: boolean;
	emittedAtMs: number;
}

export type AcpEventDrainScheduler = (callback: () => void) => void;

export interface AcpEventDrainOptions {
	readonly maxBatchSize?: number;
	readonly maxBatchMs?: number;
	readonly now?: () => number;
	readonly schedule?: AcpEventDrainScheduler;
}

const DEFAULT_EVENT_DRAIN_BATCH_SIZE = 12;
const DEFAULT_EVENT_DRAIN_BATCH_MS = 8;

function scheduleMacrotask(callback: () => void): void {
	setTimeout(callback, 0);
}

export function createAcpEventDrain(
	onEnvelope: (envelope: AcpEventEnvelope) => void,
	options: AcpEventDrainOptions = {}
): (envelope: AcpEventEnvelope) => void {
	const queue: AcpEventEnvelope[] = [];
	const maxBatchSize = options.maxBatchSize ?? DEFAULT_EVENT_DRAIN_BATCH_SIZE;
	const maxBatchMs = options.maxBatchMs ?? DEFAULT_EVENT_DRAIN_BATCH_MS;
	const now = options.now ?? (() => performance.now());
	const schedule = options.schedule ?? scheduleMacrotask;
	let scheduled = false;

	const drain = () => {
		scheduled = false;
		const startedAt = now();
		let processed = 0;

		while (queue.length > 0) {
			const nextEnvelope = queue.shift();
			if (nextEnvelope === undefined) {
				break;
			}

			onEnvelope(nextEnvelope);
			processed += 1;

			if (processed >= maxBatchSize || now() - startedAt >= maxBatchMs) {
				break;
			}
		}

		if (queue.length > 0 && !scheduled) {
			scheduled = true;
			schedule(drain);
		}
	};

	return (envelope) => {
		queue.push(envelope);
		if (scheduled) {
			return;
		}
		scheduled = true;
		schedule(drain);
	};
}

// Electrobun has no eventsUrl to hand out (acp.getEventBridgeInfo is
// honestly unsupportedOnContract -- see backend-client/acp.ts's header
// comment): there is no Rust-side SSE bridge any more. Session updates ride
// the contract's own `events` RPC stream instead. OrchestrationCanonicalBridge
// (orchestration-canonical-bridge.ts) does the actual translation from
// OrchestrationEvent into the SessionStateEnvelope traffic the store
// consumes; this function's job is just standing the stream up and handing
// translated envelopes to the same onEnvelope callback the (now retired)
// SSE path used, so EventSubscriber.ts needs no changes at all.
/**
 * The bridge behind the page's one event stream.
 *
 * Held here because a reopen has to be able to tell it where it moved a
 * session, and there is exactly one event source per page. Null until the
 * stream is standing, and a realign for a session the bridge is not following
 * is a no-op rather than an error.
 */
let liveBridge: OrchestrationCanonicalBridge | null = null;

/**
 * Tells the live bridge that a session's graph now sits at `revision`.
 *
 * The reopen hydration installs a graph whose revision comes from the contract
 * snapshot -- the server's own sequence -- while the bridge counts a session's
 * revisions from zero. Without this the two never met, and every event after a
 * reopen was refused as stale.
 *
 * `serverSequenceWatermark` is the snapshot's snapshotSequence: the last
 * server event the hydrated graph already folds. The bridge skips session
 * events at or below it, so a re-delivery of the session's own history --
 * e.g. a capture run's events(0) replay pushed into the same broadcast
 * channel -- cannot reset a session this reopen already moved (see
 * OrchestrationCanonicalBridge.realignSession).
 */
export function realignCanonicalSession(
	sessionId: string,
	revision: SessionGraphRevision,
	serverSequenceWatermark: number
): void {
	liveBridge?.realignSession(sessionId, revision, serverSequenceWatermark);
}

function openUnderlyingAcpEventSource(
	onEnvelope: (envelope: AcpEventEnvelope) => void
): Effect.Effect<() => void, AcpError> {
	return appRpcClient().pipe(
		Effect.flatMap((client) =>
			client.snapshot(librarySnapshotRequest()).pipe(
				Effect.mapError(
					(error) => new ProtocolError(`Event source snapshot failed: ${String(error)}`, error)
				),
				Effect.map((snapshot) => ({ client, fromSequence: snapshot.snapshotSequence }))
			)
		),
		// Tail subscription, like every other store (settings/library/review/
		// voice all ride events(snapshotSequence)): the past is the reopen
		// hydration's domain (reopen-snapshot-graph.ts builds it from the
		// contract snapshot), and this bridge's own header scopes it to
		// sessions created live in this app run. Replaying the whole log from
		// 0 here re-translated thousands of already-hydrated events through
		// the store's reactive state on every page load -- measured live
		// 2026-09-01 as minutes of a pegged WebContent process before the
		// panel answered at all.
		Effect.flatMap(({ client, fromSequence }) => {
			const bridge = new OrchestrationCanonicalBridge(makeProjectPathResolver(client));
			liveBridge = bridge;
			const enqueueEnvelope = createAcpEventDrain(onEnvelope);
			const consume = client.events(fromSequence).pipe(
				Stream.runForEach((event) =>
					bridge.translate(event).pipe(
						Effect.map((envelopes) => {
							for (const envelope of envelopes) {
								enqueueEnvelope(envelope);
							}
						})
					)
				),
				Effect.catchCause((cause) =>
					Effect.sync(() => {
						logger.warn("Orchestration events stream ended", { error: Cause.pretty(cause) });
					})
				)
			);
			return consume.pipe(
				Effect.forkDetach,
				Effect.map((fiber) => () => {
					liveBridge = null;
					Effect.runFork(Fiber.interrupt(fiber));
				})
			);
		})
	);
}

/**
 * The page's one shared event source.
 *
 * Every consumer (EventSubscriber's session-state fan-out, the inbound
 * request handler) subscribes here instead of opening its own stream: the
 * Electrobun transport is a single broadcast channel, so a second
 * `client.events(0)` call meant a second full replay interleaved on that
 * channel (tripping the gapless-sequence check and killing one stream) and a
 * second OrchestrationCanonicalBridge, with the reopen realign landing on
 * whichever registered last. One underlying stream means one replay, one
 * bridge, and one `liveBridge` for realignCanonicalSession to hit -- see
 * shared-event-source.ts's header for the live evidence.
 */
const sharedAcpEventSource = shareEventSource<AcpEventEnvelope, AcpError>(
	openUnderlyingAcpEventSource,
	(error) => new ProtocolError(`Event source subscription failed: ${String(error)}`, error)
);

export function openAcpEventSource(
	onEnvelope: (envelope: AcpEventEnvelope) => void
): Effect.Effect<() => void, AcpError> {
	return sharedAcpEventSource.open(onEnvelope);
}
