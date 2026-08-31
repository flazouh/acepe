/**
 * One event source per page, fanned out to every consumer.
 *
 * The Electrobun transport is a single broadcast channel: every "events" push
 * reaches every registered listener, and each `client.events(0)` call also
 * asks the Bun side for its own full replay. Two consumers therefore meant
 * two interleaved replays on one channel, tripping the client's
 * gapless-sequence check (RpcEventSequenceGapError) and killing one stream --
 * and two OrchestrationCanonicalBridge instances, with the reopen realign
 * landing on whichever happened to register last. Live evidence 2026-08-31:
 * EventSubscriber's stream died at boot while InboundRequestHandler's
 * survived, so every canonical session-state envelope was translated by a
 * bridge whose consumer discards that envelope kind, and the panel went deaf
 * to live events until the next reload.
 *
 * This helper wraps the real opener so the underlying source stands up once,
 * every subscriber's callback receives every envelope, and the source is torn
 * down only when the last subscriber detaches.
 */
import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";

export interface SharedEventSource<Envelope, Error> {
	readonly open: (onEnvelope: (envelope: Envelope) => void) => Effect.Effect<() => void, Error>;
}

export function shareEventSource<Envelope, Error>(
	openUnderlying: (
		onEnvelope: (envelope: Envelope) => void
	) => Effect.Effect<() => void, Error>,
	toError: (error: unknown) => Error
): SharedEventSource<Envelope, Error> {
	const callbacks = new Set<(envelope: Envelope) => void>();
	let stopUnderlying: (() => void) | null = null;
	let standing: Promise<void> | null = null;

	const detach = (onEnvelope: (envelope: Envelope) => void): void => {
		callbacks.delete(onEnvelope);
		if (callbacks.size === 0 && stopUnderlying !== null) {
			stopUnderlying();
			stopUnderlying = null;
		}
	};

	return {
		open: (onEnvelope) => {
			callbacks.add(onEnvelope);
			if (stopUnderlying === null && standing === null) {
				standing = Effect.runPromise(
					openUnderlying((envelope) => {
						for (const callback of callbacks) {
							callback(envelope);
						}
					}).pipe(
						Effect.map((stop) => {
							// The last subscriber may have detached while the source was
							// still standing up; honor that by stopping immediately.
							if (callbacks.size === 0) {
								stop();
								return;
							}
							stopUnderlying = stop;
						})
					)
				).finally(() => {
					standing = null;
				});
			}
			const awaited = standing;
			if (awaited === null) {
				return Effect.succeed(() => {
					detach(onEnvelope);
				});
			}
			return fromPromise(() => awaited, toError).pipe(
				Effect.map(() => () => {
					detach(onEnvelope);
				}),
				Effect.mapError((error) => {
					detach(onEnvelope);
					return error;
				})
			);
		},
	};
}
