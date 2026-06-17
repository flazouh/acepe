/**
 * SessionMessagingOrchestrator — send-message policy and title side-effects for
 * the session store (see docs/adr/0002).
 */
import { errAsync, type ResultAsync } from "neverthrow";
import type { Attachment } from "../components/agent-input/types/attachment.js";
import type { AppError } from "../errors/app-error.js";
import { ConnectionError, SessionNotFoundError } from "../errors/app-error.js";
import { createLogger } from "../utils/logger.js";
import type { SessionCreationCoordinator } from "./session-creation-coordinator.svelte.js";
import { canActivateCreatedSessionWithFirstPrompt } from "./services/first-send-activation.js";
import type { SessionMessagingService } from "./services/session-messaging-service.js";
import { getTitleUpdateFromUserMessage } from "./session-title-policy.js";
import type { SessionMutableColdUpdates, SessionMetadata } from "./types.js";

const logger = createLogger({
	id: "session-messaging-orchestrator",
	name: "SessionMessagingOrchestrator",
});

export type SessionMessagingOrchestratorDeps = {
	readonly messagingSvc: SessionMessagingService;
	readonly creationCoordinator: SessionCreationCoordinator;
	readonly getSessionIdentity: (sessionId: string) => import("./types.js").SessionIdentity | undefined;
	readonly getSessionMetadata: (sessionId: string) => SessionMetadata | undefined;
	readonly getSessionCanSend: (sessionId: string) => boolean | null;
	readonly getSessionLifecycleStatus: (
		sessionId: string
	) => import("../../services/acp-types.js").SessionGraphLifecycle["status"] | null;
	readonly getGraphTranscriptRevision: (sessionId: string) => number | undefined;
	readonly updateSession: (
		id: string,
		updates: SessionMutableColdUpdates,
		options?: { touchUpdatedAt?: boolean }
	) => void;
};

export class SessionMessagingOrchestrator {
	readonly #deps: SessionMessagingOrchestratorDeps;

	constructor(deps: SessionMessagingOrchestratorDeps) {
		this.#deps = deps;
	}

	sendMessage(
		sessionId: string,
		content: string,
		attachments: readonly Attachment[] = []
	): ResultAsync<void, AppError> {
		const sessionIdentity = this.#deps.getSessionIdentity(sessionId);
		const sessionMetadata = this.#deps.getSessionMetadata(sessionId);
		if (!sessionIdentity) {
			if (this.#deps.creationCoordinator.hasPendingCreation(sessionId)) {
				return this.#deps.messagingSvc
					.sendPendingCreationMessage(sessionId, content, attachments)
					.mapErr((error) => {
						this.#deps.creationCoordinator.completePendingCreation(sessionId);
						return error;
					});
			}
			return errAsync(new SessionNotFoundError(sessionId));
		}
		if (!sessionMetadata) {
			return errAsync(new SessionNotFoundError(sessionId));
		}
		const canonicalCanSend = this.#deps.getSessionCanSend(sessionId);
		logger.info("sendMessage: store entrypoint", {
			sessionId,
			canSend: canonicalCanSend,
			transcriptRevisionBeforeSend: this.#deps.getGraphTranscriptRevision(sessionId) ?? null,
			preview: content.trim().slice(0, 120),
		});

		const send = () =>
			this.#deps.messagingSvc.sendMessage(sessionId, content, attachments).map(() => {
				const currentTitle = this.#deps.getSessionMetadata(sessionId)?.title;
				logger.debug("[sendMessage] After message sent, checking title update", {
					sessionId,
					currentTitle: currentTitle?.substring(0, 100),
				});
				if (!currentTitle) {
					logger.debug("[sendMessage] No current title, skipping title update");
					return;
				}

				const derivedTitle = getTitleUpdateFromUserMessage(currentTitle, content);
				logger.debug("[sendMessage] Title derivation result", {
					derivedTitle,
					willUpdate: !!derivedTitle,
				});
				if (!derivedTitle) {
					logger.debug("[sendMessage] No derived title, skipping update");
					return;
				}

				logger.debug("[sendMessage] Updating session title", { derivedTitle });
				this.#deps.updateSession(sessionId, { title: derivedTitle });
			});

		const canSend = canonicalCanSend === true;
		const lifecycleStatus = this.#deps.getSessionLifecycleStatus(sessionId);
		const canActivateFirstPrompt = canActivateCreatedSessionWithFirstPrompt({
			sessionMetadata,
			lifecycleStatus,
		});

		if (canSend || canActivateFirstPrompt) {
			return send();
		}
		return errAsync(new ConnectionError(sessionId));
	}
}
