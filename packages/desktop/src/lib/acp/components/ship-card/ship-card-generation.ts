/**
 * Ephemeral text generation for Ship Card.
 *
 * Sends a prompt to an ACP agent via a temporary session (hidden from UI),
 * captures the streaming response, and parses the XML into structured data.
 * The session is destroyed after generation completes.
 *
 * Two entry-points:
 *   - `generateShipContent`          – waits for the final result (legacy)
 *   - `generateShipContentStreaming`  – invokes `onUpdate` after every chunk
 */

import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import { AgentError } from "$lib/acp/errors/app-error.js";
import { sharedEventSubscriber } from "$lib/acp/logic/event-subscriber.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { SessionStateEnvelope } from "$lib/services/acp-types.js";
import { backendClient } from "$lib/utils/backend-client.js";
import { parseShipXml, type ShipCardData } from "./ship-card-parser.js";
import {
	initialShipTurnObserverState,
	observeShipTurnEnvelope,
	type ShipTurnObserverState,
} from "./ship-card-turn-observer.js";

const GENERATION_TIMEOUT_MS = 60_000;

const logger = createLogger({ id: "ship-card-generation", name: "ShipCardGeneration" });

// ---------------------------------------------------------------------------
// Shared core that both public functions delegate to.
// ---------------------------------------------------------------------------

function runGeneration(
	prompt: string,
	cwd: string,
	onUpdate: ((data: ShipCardData) => void) | undefined,
	agentId: string | undefined,
	modelId: string | undefined
): Effect.Effect<ShipCardData, AgentError> {
	return backendClient.acp.newSession(cwd, agentId).pipe(
		Effect.mapError((e) => new AgentError("newSession", e)),
		Effect.flatMap((sessionResult) => {
			const ephemeralSessionId = sessionResult.sessionId;
			logger.info("Ship card generation: ephemeral session created", {
				ephemeralSessionId,
				modelId,
			});

			const modelSetup = modelId
				? backendClient.acp
						.setModel(ephemeralSessionId, modelId)
						.pipe(Effect.mapError((e) => new AgentError("setModel", e)))
				: Effect.succeed<void>(undefined);

			return modelSetup.pipe(
				Effect.map(() => ephemeralSessionId),
				Effect.catch((error) =>
					backendClient.acp.closeSession(ephemeralSessionId).pipe(
						Effect.catch(() => Effect.succeed(undefined)),
						Effect.flatMap(() => Effect.fail(error))
					)
				)
			);
		}),
		Effect.flatMap((ephemeralSessionId) => {
			logger.info("Ship card generation: session ready, starting generation", {
				ephemeralSessionId,
			});

			const closeEphemeral = (): void => {
				void Effect.runPromise(backendClient.acp.closeSession(ephemeralSessionId));
			};

			let observed: ShipTurnObserverState = initialShipTurnObserverState;
			let settled = false;
			let resolveStream!: (data: ShipCardData) => void;
			let rejectStream!: (e: Error) => void;

			const streamPromise = new Promise<ShipCardData>((resolve, reject) => {
				resolveStream = resolve;
				rejectStream = reject;
			});
			// The Effect below only attaches a handler once sendPrompt resolves. A
			// provider that dies on the prompt rejects before that, so keep a
			// no-op handler attached from the start.
			void streamPromise.catch(() => undefined);

			const timeoutId = setTimeout(() => {
				if (settled) {
					return;
				}
				settled = true;
				rejectStream(new Error(`Ship card generation timed out after ${GENERATION_TIMEOUT_MS}ms`));
			}, GENERATION_TIMEOUT_MS);

			// The canonical session-state lane is the one the app itself runs on
			// (orchestration-canonical-bridge.ts is its only producer), so the ship
			// card reads the streamed reply and the turn outcome from there.
			const handleEnvelope = (envelope: SessionStateEnvelope): void => {
				if (settled) {
					return;
				}
				const previousText = observed.assistantText;
				observed = observeShipTurnEnvelope(observed, envelope, ephemeralSessionId);

				if (observed.outcome.kind === "failed") {
					settled = true;
					clearTimeout(timeoutId);
					logger.warn("Ship card generation: turn failed", {
						message: observed.outcome.message,
					});
					rejectStream(new Error(observed.outcome.message));
					return;
				}

				const parsed = parseShipXml(observed.assistantText);

				if (observed.outcome.kind === "completed") {
					settled = true;
					clearTimeout(timeoutId);
					logger.info("Ship card generation: turn complete", {
						complete: parsed.complete,
						hasCommitMessage: parsed.commitMessage !== null,
						hasPrTitle: parsed.prTitle !== null,
					});
					if (onUpdate) {
						onUpdate(parsed);
					}
					resolveStream(parsed);
					return;
				}

				if (onUpdate && observed.assistantText !== previousText) {
					onUpdate(parsed);
				}
			};

			return sharedEventSubscriber.subscribeSessionState(handleEnvelope).pipe(
				Effect.mapError((e) => {
					clearTimeout(timeoutId);
					closeEphemeral();
					return new AgentError("subscribe", e instanceof Error ? e : new Error(String(e)));
				}),
				Effect.flatMap((listenerId) => {
					const fullCleanup = (): void => {
						clearTimeout(timeoutId);
						sharedEventSubscriber.unsubscribeById(listenerId);
						closeEphemeral();
					};

					return backendClient.acp
						.sendPrompt(ephemeralSessionId, [{ type: "text", text: prompt }])
						.pipe(
							Effect.mapError((e) => new AgentError("sendPrompt", e)),
							Effect.flatMap(() =>
								fromPromise(
									() => streamPromise,
									(e) => new AgentError("stream", e instanceof Error ? e : new Error(String(e)))
								)
							),
							Effect.map((result) => {
								fullCleanup();
								return result;
							}),
							Effect.mapError((e) => {
								fullCleanup();
								return e;
							})
						);
				})
			);
		})
	);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate commit message + PR content (legacy – no streaming callback).
 */
export function generateShipContent(
	prompt: string,
	cwd: string,
	agentId?: string,
	modelId?: string
): Effect.Effect<ShipCardData, AgentError> {
	return runGeneration(prompt, cwd, undefined, agentId, modelId);
}

/**
 * Generate commit message + PR content with live streaming updates.
 *
 * `onUpdate` is called after every incoming text chunk with the latest
 * incrementally-parsed {@link ShipCardData}. The returned Effect
 * resolves with the final complete data once the agent finishes.
 */
export function generateShipContentStreaming(
	prompt: string,
	cwd: string,
	onUpdate: (data: ShipCardData) => void,
	agentId?: string,
	modelId?: string
): Effect.Effect<ShipCardData, AgentError> {
	return runGeneration(prompt, cwd, onUpdate, agentId, modelId);
}
