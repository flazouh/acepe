import { toast } from "svelte-sonner";
import { shouldClearPersistedDraftBeforeAsyncSend } from "$lib/components/main-app-view/components/content/logic/empty-state-send-state.js";
import { findErrorReference } from "$lib/errors/error-reference.js";
import { PanelConnectionEvent } from "../../types/panel-connection-state.js";
import { SoundEffect } from "../../types/sounds.js";
import { playSound } from "../../utils/sound.js";
import { prepareWorktreePathForPendingSend } from "./services/index.js";
import {
	formatPreSessionSendFailure,
	restoreComposerStateAfterFailedSend,
	type ComposerRestoreSnapshot,
} from "./logic/first-send-recovery.js";
import { prepareMessageForSend, type PreparedMessage } from "./logic/message-preparation.js";
import { createPendingUserEntry } from "./logic/pending-user-entry.js";
import { SessionCreationError } from "./errors/agent-input-error.js";
import type { Attachment } from "./types/attachment.js";
import type { AgentInputControllerHost } from "./agent-input-controller-host.js";

function cloneAttachmentForRestore(attachment: Attachment): Attachment {
	if (attachment.content !== undefined) {
		return {
			id: attachment.id,
			type: attachment.type,
			path: attachment.path,
			displayName: attachment.displayName,
			extension: attachment.extension,
			content: attachment.content,
		};
	}

	return {
		id: attachment.id,
		type: attachment.type,
		path: attachment.path,
		displayName: attachment.displayName,
		extension: attachment.extension,
	};
}

export interface AgentInputController {
	notifyDraftChange(draft: string): void;
	clearDraft(): void;
	captureAndClearInput(): PreparedMessage | null;
	createComposerRestoreSnapshot(): ComposerRestoreSnapshot;
	applyComposerRestoreSnapshot(snapshot: ComposerRestoreSnapshot): void;
	handleSend(): Promise<void>;
	handleSteer(): void;
	handlePrimaryButtonClick(): void;
	retrySend(): void;
	restoreQueuedMessage(draft: string, attachments: readonly Attachment[]): void;
}

export function createAgentInputController(host: AgentInputControllerHost): AgentInputController {
	function notifyDraftChange(draft: string) {
		const props = host.getProps();
		if (!props.panelId) return;
		const existing = host.getDraftDebounceTimer();
		if (existing) {
			clearTimeout(existing);
		}
		host.setDraftDebounceTimer(
			setTimeout(() => {
				const p = host.getProps();
				if (p.panelId) {
					host.panelStore.setMessageDraft(p.panelId, draft);
				}
			}, 500)
		);
	}

	function clearDraft() {
		const props = host.getProps();
		if (props.panelId) {
			const t = host.getDraftDebounceTimer();
			if (t) {
				clearTimeout(t);
				host.setDraftDebounceTimer(null);
			}
			host.setLastDraftValue("");
			host.panelStore.setMessageDraft(props.panelId, "");
			host.logger.info("[first-send-trace] cleared persisted draft", {
				panelId: props.panelId,
				sessionId: props.sessionId ?? null,
			});
		}
	}

	function createComposerRestoreSnapshot(): ComposerRestoreSnapshot {
		const { inputState } = host;
		const inlineTextEntries: Array<[string, string]> = [];
		for (const [refId, text] of inputState.inlineTextMap.entries()) {
			inlineTextEntries.push([refId, text]);
		}

		const attachments = inputState.attachments.map((attachment) =>
			cloneAttachmentForRestore(attachment)
		);

		return {
			draft: inputState.message,
			attachments,
			inlineTextEntries,
		};
	}

	function applyComposerRestoreSnapshot(snapshot: ComposerRestoreSnapshot): void {
		const t = host.getDraftDebounceTimer();
		if (t) {
			clearTimeout(t);
			host.setDraftDebounceTimer(null);
		}

		restoreComposerStateAfterFailedSend(host.inputState, snapshot);
		host.setLastDraftValue(snapshot.draft);
		const props = host.getProps();
		if (props.panelId) {
			host.panelStore.setMessageDraft(props.panelId, snapshot.draft);
		}
		host.syncEditorFromMessage(host.inputState.message.length);
		queueMicrotask(() => host.getEditorRef()?.focus());
		host.logger.info("[first-send-trace] restored composer snapshot", {
			panelId: props.panelId ?? null,
			sessionId: props.sessionId ?? null,
			draftLength: snapshot.draft.length,
			attachmentCount: snapshot.attachments.length,
			inlineTextCount: snapshot.inlineTextEntries.length,
		});
	}

	function captureAndClearInput(): PreparedMessage | null {
		const { inputState } = host;
		const result = prepareMessageForSend(
			inputState.message,
			inputState.inlineTextMap,
			inputState.attachments
		);
		if (result.isErr()) return null;
		const messageLength = inputState.message.length;
		const attachmentCount = inputState.attachments.length;

		inputState.message = "";
		inputState.clearAttachments();
		inputState.clearInlineTextMap();
		host.syncEditorFromMessage(0);

		if (inputState.textareaRef) {
			inputState.textareaRef.style.height = "auto";
			inputState.textareaRef.style.overflowY = "hidden";
		}

		queueMicrotask(() => {
			const props = host.getProps();
			host.logger.info("[first-send-trace] captureAndClearInput", {
				panelId: props.panelId ?? null,
				sessionId: props.sessionId ?? null,
				messageLength,
				attachmentCount,
			});
		});

		return result.value;
	}

	async function handleSend() {
		const t0 = performance.now();
		const props = host.getProps();
		const composerInteraction = host.getComposerInteraction();
		const defaultSubmitAction = composerInteraction.defaultSubmitAction;

		if (defaultSubmitAction === "none") {
			return;
		}

		if (defaultSubmitAction === "steer") {
			handleSteer();
			return;
		}

		if (defaultSubmitAction === "queue") {
			if (!props.sessionId) {
				return;
			}
			const { inputState } = host;
			const result = prepareMessageForSend(
				inputState.message,
				inputState.inlineTextMap,
				inputState.attachments
			);
			if (result.isErr()) return;
			const accepted = host.messageQueueStore.enqueue(
				props.sessionId,
				result.value.content,
				result.value.imageAttachments
			);
			if (!accepted) return;
			inputState.message = "";
			inputState.clearAttachments();
			inputState.clearInlineTextMap();
			clearDraft();
			return;
		}

		const sessionIdForDispatch = props.sessionId;
		if (sessionIdForDispatch) {
			host.sessionStore.composerBeginDispatch(sessionIdForDispatch);
		}
		const restoreSnapshot = createComposerRestoreSnapshot();
		const isPreSessionSend = Boolean(props.panelId) && !props.sessionId;

		const prepared = captureAndClearInput();
		if (!prepared) {
			if (sessionIdForDispatch) {
				host.sessionStore.composerEndDispatch(sessionIdForDispatch);
			}
			return;
		}
		const shouldClearDraftEarly = shouldClearPersistedDraftBeforeAsyncSend({
			panelId: props.panelId,
			sessionId: props.sessionId,
		});
		if (shouldClearDraftEarly) {
			clearDraft();
		}
		if (!props.panelId) {
			host.inputState.message = "";
		}
		const overridePanelId = props.onWillSend?.();
		const effectivePanelId =
			overridePanelId !== undefined && overridePanelId !== null ? overridePanelId : props.panelId;
		if (isPreSessionSend && effectivePanelId && props.projectPath && props.selectedAgentId) {
			host.connectionStore.send(effectivePanelId, {
				type: PanelConnectionEvent.START_CONNECTION,
				projectPath: props.projectPath,
				agentId: props.selectedAgentId,
				title: props.projectName ?? undefined,
			});
		}

		if (effectivePanelId && !props.sessionId) {
			host.panelStore.setPendingUserEntry(effectivePanelId, createPendingUserEntry(prepared.content));
		}

		playSound(SoundEffect.Paste);
		queueMicrotask(() => {
			host.logger.info("handleSend: preparing send", {
				panelId: props.panelId,
				sessionId: props.sessionId ?? null,
				contentLength: prepared.content.length,
				isPreSessionSend,
				t_ms: Math.round(performance.now() - t0),
			});
		});

		let worktreePathForSend: string | undefined = props.worktreePath ?? undefined;
		let preparedWorktreeLaunch = props.preparedWorktreeLaunch ?? null;
		if (!worktreePathForSend && props.worktreePending && props.projectPath) {
			const selectedAgentId = props.selectedAgentId;
			if (!selectedAgentId) {
				if (effectivePanelId) {
					host.panelStore.clearPendingWorktreeSetup(effectivePanelId);
					host.panelStore.clearPendingUserEntry(effectivePanelId);
				}
				if (effectivePanelId && props.onSendError) {
					host.panelStore.setPendingComposerRestore(effectivePanelId, restoreSnapshot);
					host.panelStore.setMessageDraft(effectivePanelId, restoreSnapshot.draft);
				}
				host.setLastDraftValue(restoreSnapshot.draft);
				if (props.onSendError) {
					props.onSendError(effectivePanelId ?? null);
				} else {
					applyComposerRestoreSnapshot(restoreSnapshot);
				}
				if (sessionIdForDispatch) {
					host.sessionStore.composerEndDispatch(sessionIdForDispatch);
				}
				return;
			}
			const hadExistingPrepared = preparedWorktreeLaunch !== null;
			const prep = await prepareWorktreePathForPendingSend({
				projectPath: props.projectPath,
				selectedAgentId,
				existingPrepared: preparedWorktreeLaunch,
				notifyCreating: () => {
					const projectPath = props.projectPath;
					if (effectivePanelId && projectPath) {
						host.panelStore.setPendingWorktreeSetup(effectivePanelId, {
							projectPath,
							worktreePath: null,
							phase: "creating-worktree",
						});
					}
					props.onWorktreeCreating?.();
					host.logger.info("[worktree-flow] handleSend: preparing worktree launch before send", {
						projectPath: props.projectPath,
						panelId: props.panelId ?? null,
						t_ms: Math.round(performance.now() - t0),
					});
				},
			});
			if (!prep.ok) {
				if (effectivePanelId) {
					host.panelStore.clearPendingWorktreeSetup(effectivePanelId);
					host.panelStore.clearPendingUserEntry(effectivePanelId);
				}
				const failure = prep.error;
				const failureMessage = formatPreSessionSendFailure(failure);
				host.logger.warn("Worktree launch preparation failed", {
					error: failure,
					failureMessage,
				});
				if (effectivePanelId && props.onSendError) {
					host.panelStore.setPendingComposerRestore(effectivePanelId, restoreSnapshot);
					host.panelStore.setMessageDraft(effectivePanelId, restoreSnapshot.draft);
				}
				host.setLastDraftValue(restoreSnapshot.draft);
				if (props.onSendError) {
					props.onSendError(effectivePanelId ?? null);
				} else {
					applyComposerRestoreSnapshot(restoreSnapshot);
				}
				props.onWorktreeCreateFailed?.(failureMessage);
				toast.error("Failed to create worktree. Session will run without branch isolation.");
				if (sessionIdForDispatch) {
					host.sessionStore.composerEndDispatch(sessionIdForDispatch);
				}
				return;
			}
			preparedWorktreeLaunch = prep.preparedLaunch;
			worktreePathForSend = prep.worktreePath;
			if (!hadExistingPrepared) {
				props.onPreparedWorktreeLaunch?.(preparedWorktreeLaunch);
				if (effectivePanelId) {
					host.panelStore.setPendingWorktreeSetup(effectivePanelId, {
						projectPath: props.projectPath,
						worktreePath: preparedWorktreeLaunch.worktree.directory,
						phase: "running",
					});
				}
				host.logger.info("[first-send-trace] worktree launch prepared", {
					panelId: props.panelId ?? null,
					projectPath: props.projectPath,
					worktreePathForSend,
					launchToken: preparedWorktreeLaunch.launchToken,
					sequenceId: preparedWorktreeLaunch.sequenceId,
					t_ms: Math.round(performance.now() - t0),
				});
				props.onWorktreeCreated?.(preparedWorktreeLaunch.worktree.directory);
			}
			if (!preparedWorktreeLaunch && !worktreePathForSend) {
				if (effectivePanelId) {
					host.panelStore.clearPendingUserEntry(effectivePanelId);
				}
				props.onWorktreeCreateFailed?.("Failed to create worktree. Session will run without branch isolation.");
				if (sessionIdForDispatch) {
					host.sessionStore.composerEndDispatch(sessionIdForDispatch);
				}
				return;
			}
		}

		host.logger.info("[worktree-flow] handleSend: dispatching send", {
			panelId: props.panelId ?? null,
			sessionId: props.sessionId ?? null,
			worktreePathForSend: worktreePathForSend ?? null,
			selectedAgentId: props.selectedAgentId ?? null,
			elapsed_ms: Math.round(performance.now() - t0),
		});
		const handleSessionCreated = (createdSessionId: string) => {
			if (isPreSessionSend && effectivePanelId) {
				host.connectionStore.send(effectivePanelId, {
					type: PanelConnectionEvent.CONNECTION_SUCCESS,
					sessionId: createdSessionId,
				});
			}
			props.onSessionCreated?.(createdSessionId, effectivePanelId ?? null);
		};
		host.inputState
			.sendPreparedMessage({
				content: prepared.content,
				panelId: effectivePanelId,
				sessionId: props.sessionId,
				initialAutonomousEnabled: host.getAutonomousToggleActive(),
				initialModeId: props.sessionId ? null : host.getProvisionalModeId(),
				initialModelId: props.sessionId ? null : host.getProvisionalModelId(),
				selectedAgentId: props.selectedAgentId,
				projectPath: props.projectPath,
				projectName: props.projectName,
				onSessionCreated: handleSessionCreated,
				worktreePath: worktreePathForSend,
				launchToken: preparedWorktreeLaunch?.launchToken ?? null,
				imageAttachments: prepared.imageAttachments,
			})
			.map(() => {
				host.logger.info("handleSend: sendMessage resolved", {
					elapsed_ms: Math.round(performance.now() - t0),
				});
				if (props.panelId) {
					clearDraft();
				}
			})
			.mapErr((error) => {
				if (effectivePanelId) {
					host.panelStore.clearPendingWorktreeSetup(effectivePanelId);
				}
				if (effectivePanelId && isPreSessionSend && error instanceof SessionCreationError) {
					host.panelStore.setPendingComposerRestore(effectivePanelId, restoreSnapshot);
					host.panelStore.setMessageDraft(effectivePanelId, restoreSnapshot.draft);
					host.setLastDraftValue(restoreSnapshot.draft);
					const failureMessage = formatPreSessionSendFailure(error);
					const errorReference = findErrorReference(error);
					host.connectionStore.send(effectivePanelId, {
						type: PanelConnectionEvent.CONNECTION_ERROR,
						error: {
							message: failureMessage,
							referenceId: errorReference?.referenceId,
							referenceSearchable: errorReference?.searchable,
						},
					});
					if (props.worktreePending && preparedWorktreeLaunch) {
						props.onWorktreeCreateFailed?.(failureMessage);
					}
					props.onSendError?.(effectivePanelId);
				} else if (shouldClearDraftEarly && props.panelId) {
					host.panelStore.setMessageDraft(props.panelId, prepared.content);
				}
				return error;
			})
			.match(
				() => undefined,
				() => undefined
			)
			.finally(() => {
				if (sessionIdForDispatch) {
					host.sessionStore.composerEndDispatch(sessionIdForDispatch);
				}
			});
	}

	function handleSteer() {
		const props = host.getProps();
		const sessionId = props.sessionId;
		if (!sessionId || (!host.inputState.message.trim() && host.inputState.attachments.length === 0))
			return;
		host.logger.info("handleSteer: preparing steer send", {
			panelId: props.panelId,
			sessionId,
		});
		props.onWillSend?.();

		const prepared = captureAndClearInput();
		if (!prepared) return;
		clearDraft();

		host.sessionStore.composerBeginDispatch(sessionId);
		host.sessionStore
			.cancelStreaming(sessionId)
			.andThen(() => host.sessionStore.sendMessage(sessionId, prepared.content, prepared.imageAttachments))
			.mapErr((error) => {
				console.error("Steer failed:", error);
				return error;
			})
			.match(
				() => undefined,
				() => undefined
			)
			.finally(() => {
				host.sessionStore.composerEndDispatch(sessionId);
			});
	}

	function handlePrimaryButtonClick(): void {
		const composerInteraction = host.getComposerInteraction();
		const primaryButtonIntent = composerInteraction.primaryButtonIntent;
		if (primaryButtonIntent === "steer") {
			handleSteer();
			return;
		}
		if (primaryButtonIntent === "cancel") {
			void host.handleCancel();
			return;
		}
		if (primaryButtonIntent === "send") {
			void handleSend();
			return;
		}
		if (host.getIsStreaming()) {
			void host.handleCancel();
		}
	}

	function retrySend(): void {
		void handleSend();
	}

	function restoreQueuedMessage(draft: string, attachments: readonly Attachment[]): void {
		const restoredAttachments = attachments.map((attachment) => cloneAttachmentForRestore(attachment));
		applyComposerRestoreSnapshot({
			draft,
			attachments: restoredAttachments,
			inlineTextEntries: [],
		});
	}

	return {
		notifyDraftChange,
		clearDraft,
		captureAndClearInput,
		createComposerRestoreSnapshot,
		applyComposerRestoreSnapshot,
		handleSend,
		handleSteer,
		handlePrimaryButtonClick,
		retrySend,
		restoreQueuedMessage,
	};
}
