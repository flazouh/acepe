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
import { EventSubscriber } from "$lib/acp/logic/event-subscriber.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { SessionUpdate, TurnErrorData } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { parseShipXml, type ShipCardData } from "./ship-card-parser.js";

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
	return tauriClient.acp.newSession(cwd, agentId).pipe(
		Effect.mapError((e) => new AgentError("newSession", e)),
		Effect.flatMap((sessionResult) => {
			const ephemeralSessionId = sessionResult.sessionId;
			logger.info("Ship card generation: ephemeral session created", {
				ephemeralSessionId,
				modelId,
			});

			const modelSetup = modelId
				? tauriClient.acp
						.setModel(ephemeralSessionId, modelId)
						.pipe(Effect.mapError((e) => new AgentError("setModel", e)))
				: Effect.succeed<void>(undefined);

			return modelSetup.pipe(
				Effect.map(() => ephemeralSessionId),
				Effect.catch((error) =>
					tauriClient.acp.closeSession(ephemeralSessionId).pipe(
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
				void Effect.runPromise(tauriClient.acp.closeSession(ephemeralSessionId));
			};

			let accumulated = "";
			let resolveStream!: (data: ShipCardData) => void;
			let rejectStream!: (e: Error) => void;

			const streamPromise = new Promise<ShipCardData>((resolve, reject) => {
				resolveStream = resolve;
				rejectStream = reject;
			});

			const timeoutId = setTimeout(() => {
				rejectStream(new Error(`Ship card generation timed out after ${GENERATION_TIMEOUT_MS}ms`));
			}, GENERATION_TIMEOUT_MS);

			const extractTurnErrorMessage = (error: TurnErrorData): string =>
				typeof error === "string" ? error : error.message;

			const subscriber = new EventSubscriber();

			const handleUpdate = (update: SessionUpdate): void => {
				const updateSessionId = (update as { session_id?: string | null }).session_id;
				if (updateSessionId !== ephemeralSessionId) return;

				if (update.type === "agentMessageChunk" && update.chunk.content.type === "text") {
					accumulated += update.chunk.content.text;
					if (onUpdate) {
						onUpdate(parseShipXml(accumulated));
					}
				} else if (update.type === "turnComplete") {
					clearTimeout(timeoutId);
					const parsed = parseShipXml(accumulated);
					logger.info("Ship card generation: turn complete", {
						complete: parsed.complete,
						hasCommitMessage: parsed.commitMessage !== null,
						hasPrTitle: parsed.prTitle !== null,
					});
					if (onUpdate) {
						onUpdate(parsed);
					}
					resolveStream(parsed);
				} else if (update.type === "turnError") {
					clearTimeout(timeoutId);
					const message = extractTurnErrorMessage(update.error);
					logger.warn("Ship card generation: turn error", { message });
					rejectStream(new Error(message));
				}
			};

			return subscriber.subscribe(handleUpdate).pipe(
				Effect.mapError((e) => {
					clearTimeout(timeoutId);
					closeEphemeral();
					return new AgentError("subscribe", e instanceof Error ? e : new Error(String(e)));
				}),
				Effect.flatMap((listenerId) => {
					const fullCleanup = (): void => {
						clearTimeout(timeoutId);
						subscriber.unsubscribeById(listenerId);
						closeEphemeral();
					};

					return tauriClient.acp
						.sendPrompt(ephemeralSessionId, [{ type: "text", text: prompt }])
						.pipe(
							Effect.mapError((e) => new AgentError("sendPrompt", e)),
							Effect.flatMap(() =>
								fromPromise(
									() => streamPromise,
									(e) =>
										new AgentError("stream", e instanceof Error ? e : new Error(String(e)))
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
