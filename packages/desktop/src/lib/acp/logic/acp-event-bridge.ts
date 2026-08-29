import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { appRpcClient } from "$lib/rpc/app-client.js";
import type { JsonValue } from "$lib/services/converted-session-types.js";
import type { SessionGraphRevision } from "../../services/acp-types.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import type { AcpError } from "../errors/index.js";
import { createLogger } from "../utils/logger.js";
import {
	makeProjectPathResolver,
	OrchestrationCanonicalBridge,
} from "./orchestration-canonical-bridge.js";

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
 */
export function realignCanonicalSession(sessionId: string, revision: SessionGraphRevision): void {
	liveBridge?.realignSession(sessionId, revision);
}

export function openAcpEventSource(
	onEnvelope: (envelope: AcpEventEnvelope) => void
): Effect.Effect<() => void, AcpError> {
	return appRpcClient().pipe(
		Effect.flatMap((client) => {
			const bridge = new OrchestrationCanonicalBridge(makeProjectPathResolver(client));
			liveBridge = bridge;
			const enqueueEnvelope = createAcpEventDrain(onEnvelope);
			const consume = client.events(0).pipe(
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
