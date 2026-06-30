<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { toast } from "svelte-sonner";
import { getKeybindingsService, isMac } from "$lib/keybindings/index.js";
import { getPreconnectionAgentSkillsStore } from "$lib/skills/store/preconnection-agent-skills-store.svelte.js";
import { getVoiceSettingsStore } from "$lib/stores/voice-settings-store.svelte.js";
import type { AttachMenuCommandItem, SlashPaletteItem } from "@acepe/ui/agent-panel";
import {
	AgentInputActiveModeChip,
	AgentInputAttachMenu,
	AgentInputComposerTrailingControls,
	AgentInputNewThreadOptions,
	AgentPanelComposer as SharedAgentPanelComposer,
} from "@acepe/ui/agent-panel";
import { getConnectionStore } from "../../store/connection-store.svelte.js";
import {
	getAgentStore,
	getMessageQueueStore,
	getPanelStore,
	getPermissionStore,
	getSessionStore,
} from "../../store/index.js";
import type { AvailableCommand } from "../../types/available-command.js";
import { createLogger } from "../../utils/logger.js";
import { resolvePanelDraftOnMount } from "./services/index.js";
import AgentInputComposerBody from "./components/agent-input-composer-body.svelte";
import AgentInputDropZone from "./components/agent-input-drop-zone.svelte";
import {
	applyInlineTokenHoverTitles,
	canStartVoiceInteraction,
	ComposerViewController,
	createImageAttachment,
	findInlineArtefactRangeAtPosition,
	getAdjacentInlineTokenElement,
	getInlineTokenType,
	getInlineTokenValue,
	getSerializedCursorOffset,
	getSerializedRangeForNode,
	getSerializedSelectionEnd,
	getSerializedSelectionRange,
	handleVoiceMicKeyDown as handleVoiceMicKeyDownFromModule,
	hasAutocompleteTrigger,
	INLINE_TOKEN_PREFIX,
	isImageMimeType,
	loadSlashCommandWorkspaceMarkdown as loadSlashCommandWorkspaceMarkdownFromModule,
	normalizeVoiceInputText,
	parseFilePickerTrigger,
	parseSlashCommandTrigger,
	replaceActiveSlashTrigger,
	PreconnectionCapabilitiesState,
	PreconnectionRemoteCommandsState,
	renderInlineComposerMessage,
	resolveAttachMenuItemInsertText,
	resolveSlashPaletteItemInsertText,
	resolveComposerEnterKeyIntent,
	resolveDefaultModeId,
	resolveInitialModelIdForNewSession,
	resolveModeMenuAction,
	resolveVoiceMicTooltip,
	serializeInlineComposerMessage,
	setSerializedCursorOffset,
	shouldInterruptComposerStream,
	shouldRouteWindowVoiceHold,
	shouldShowVoiceOverlay,
	shouldStartVoiceHold,
	shouldStopVoiceHold,
	shouldSyncPanelFocusOnEditorFocus,
	toInlineTokenText,
	toVoiceToolbarBinding,
	type SubmitIntent,
} from "./composer-controller.js";
import { ModelSelector } from "../index.js";
import ModelSelectorMetricsChip from "../model-selector.metrics-chip.svelte";
import { VoiceInputState } from "./state/voice-input-state.svelte.js";
import { VoiceSessionController } from "./state/voice-session-controller.svelte.js";
import { createAgentInputController } from "./agent-input-controller.js";
import { AgentInputState } from "./state/agent-input-state.svelte.js";
import type { Attachment } from "./types/attachment.js";
import type { AgentInputProps } from "./types/agent-input-props.js";

// Keep props as reactive object instead of destructuring
const props: AgentInputProps = $props();
const logger = createLogger({ id: "agent-input-send-trace", name: "AgentInputSendTrace" });
const kb = getKeybindingsService();

const sessionStore = getSessionStore();
const panelStore = getPanelStore();
const connectionStore = getConnectionStore();
const messageQueueStore = getMessageQueueStore();
const permissionStore = getPermissionStore();
const agentStore = getAgentStore();
const preconnectionAgentSkillsStore = getPreconnectionAgentSkillsStore();
const voiceSettingsStore = getVoiceSettingsStore();
const preconnectionCapabilitiesState = new PreconnectionCapabilitiesState();
const preconnectionRemoteCommandsState = new PreconnectionRemoteCommandsState();
const effectiveVoiceSessionId = $derived(props.voiceSessionId ?? props.sessionId ?? null);

let isShiftPressed = $state(false);
let inputState!: AgentInputState;

const composerView = new ComposerViewController({
	getProps: () => props,
	getInputState: () => inputState,
	getIsShiftPressed: () => isShiftPressed,
	sessionStore,
	panelStore,
	agentStore,
	preconnectionCapabilitiesState,
	preconnectionRemoteCommandsState,
	preconnectionAgentSkillsStore,
	logger,
});

inputState = new AgentInputState(sessionStore, panelStore, () => composerView.filePickerProjectPath);

const voiceSessionController = new VoiceSessionController({
	getEffectiveVoiceSessionId: () => effectiveVoiceSessionId,
	getVoiceEnabled: () => voiceEnabled,
	createVoiceInputState: (targetSessionId) =>
		new VoiceInputState({
			sessionId: targetSessionId,
			getSelectedLanguage: () => voiceSettingsStore.language,
			getSelectedModelId: () => voiceSettingsStore.selectedModelId,
			onOverlayDeactivated: () => {
				queueMicrotask(() => editorRef?.focus());
			},
			onTranscriptionReady: (text) => {
				const normalizedText = normalizeVoiceInputText(text);
				if (!normalizedText) {
					return;
				}
				const cursorPos = voiceCursorSnapshot ?? inputState.message.length;
				voiceCursorSnapshot = null;
				const prevChar = inputState.message[cursorPos - 1];
				const sep = cursorPos > 0 && prevChar !== " " ? " " : "";
				inputState.insertPlainTextAtOffsets(sep + normalizedText, cursorPos, cursorPos);
				syncEditorFromMessage(cursorPos + sep.length + normalizedText.length);
			},
		}),
});

const voiceState = $derived(voiceSessionController.voiceState);
const voiceReady = $derived(voiceSessionController.ready);
/**
 * Floating setup chips render only before a session exists and only when the
 * host supplies the bindings. Model and reasoning stay in the composer trailing
 * toolbar in all states.
 */
let preSessionSendStarted = $state(false);
const showNewThreadOptions = $derived(
	!composerView.hasSession && !preSessionSendStarted && props.newThreadContext != null
);

/** Hide floating setup chips immediately when a real pre-session send is dispatched. */
function markPreSessionSendStarted(): void {
	if (!composerView.hasSession && !composerView.isSubmitDisabled) {
		preSessionSendStarted = true;
	}
}
/** Cursor offset captured before voice overlay hides the editor. */
let voiceCursorSnapshot: number | null = null;
let autonomousStatusMessage = $state("");
const voiceEnabled = $derived(voiceSettingsStore.enabled);
const voiceToolbarBinding = $derived.by(() => {
	const base = toVoiceToolbarBinding(voiceState);
	if (!base) return null;
	return {
		phase: base.phase,
		recordingElapsedTenths: base.recordingElapsedTenths,
		downloadPercent: base.downloadPercent,
		meterLevels: base.meterLevels,
		barCount: base.barCount,
		onMicPointerDown: (e: PointerEvent) => {
			voiceCursorSnapshot = editorRef
				? getSerializedCursorOffset(editorRef)
				: inputState.message.length;
			base.onMicPointerDown(e);
		},
		onMicPointerUp: base.onMicPointerUp,
		onMicPointerCancel: base.onMicPointerCancel,
		dismissError: base.dismissError,
	};
});
const voiceMicTooltipLabels = $derived.by(() => ({
	downloadingModel: "Downloading speech model…",
	loadingModel: "Loading model...",
	checkingPermission: "Checking...",
	transcribing: "Transcribing…",
	stopRecording: "Stop recording",
	startRecording: "Start voice recording",
}));
const voiceRecordingOverlayPhase = $derived.by(
	(): "checking_permission" | "recording" | "error" => {
		const v = voiceState;
		if (!v) {
			return "error";
		}
		if (v.phase === "checking_permission") {
			return "checking_permission";
		}
		if (v.phase === "recording") {
			return "recording";
		}
		return "error";
	}
);
const voiceOverlayActive = $derived.by(() => {
	const currentVoiceState = voiceState;
	if (currentVoiceState === null) {
		return false;
	}

	return shouldShowVoiceOverlay(currentVoiceState.phase);
});

$effect(() => {
	composerView.syncComposerSessionBind();
});

$effect(() => {
	composerView.syncPreconnectionCapabilities();
});

$effect(() => {
	composerView.syncPendingToolbarSelections();
});

$effect(() => {
	const catalogInput = composerView.attachMenuMcpCatalogInput;
	if (!composerView.attachMenuShowMcpSection) {
		return;
	}
	composerView.refreshAttachMenuMcpCatalog();
	void catalogInput.agentId;
	void catalogInput.projectPath;
	void catalogInput.sessionId;
});

// Track previous message for draft change detection
let lastDraftValue = "";
let draftDebounceTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Set by handleEditorInput to skip the sync $effect's redundant DOM
 * re-serialization on the same microtask. Reset by the effect itself.
 * MUST remain a plain `let` — making it `$state` would cause an infinite
 * effect loop (effect writes flag → triggers itself → writes flag → …).
 */
let editorJustSynced = false;
let editorRef: HTMLDivElement | null = $state(null);
let imageAttachInputRef: HTMLInputElement | null = $state(null);
let overlayMode: "preview" | "edit" | null = $state(null);
let overlayRefId: string | null = $state(null);
let overlayAnchorRect: DOMRect | null = $state(null);

function syncEditorFromMessage(nextCursor: number | null = null): void {
	if (!editorRef) {
		return;
	}

	renderInlineComposerMessage(editorRef, inputState.message, (type, value) => {
		if (type === "text_ref") {
			const text = inputState.getInlineTextReferenceContent(value);
			if (!text) return undefined;
			const firstLine = text.split("\n")[0] ?? "";
			const preview = firstLine.length <= 24 ? firstLine : `${firstLine.slice(0, 24)}…`;
			return { textPreview: preview, charCount: text.length };
		}
		if (type === "image_ref") {
			const image = inputState.getInlineImageReference(value);
			if (!image) return undefined;
			return { textPreview: image.displayName, iconPath: image.displayName };
		}
		return undefined;
	});
	applyInlineTokenHoverTitles(editorRef);
	setSerializedCursorOffset(editorRef, nextCursor ?? inputState.message.length);
}

async function handleCancel() {
	if (props.sessionId) {
		const result = await sessionStore.connection.cancelStreaming(props.sessionId);
		if (result.isErr()) {
			console.error("Failed to cancel streaming:", result.error);
		}
	}
}

const agentInputController = createAgentInputController({
	getProps: () => props,
	inputState,
	getComposerInteraction: () => composerView.composerInteraction,
	getAutonomousToggleActive: () => composerView.autonomousToggleActive,
	getProvisionalModeId: () => composerView.provisionalModeId,
	getInitialModelIdForNewSession: () =>
		resolveInitialModelIdForNewSession({
			sessionId: props.sessionId ?? null,
			displayedModelId: composerView.effectiveCurrentModelId,
		}),
	getIsStreaming: () => composerView.isStreaming,
	sessionStore,
	panelStore,
	connectionStore,
	messageQueueStore,
	logger,
	syncEditorFromMessage,
	getEditorRef: () => editorRef,
	getLastDraftValue: () => lastDraftValue,
	setLastDraftValue: (v) => {
		lastDraftValue = v;
	},
	getDraftDebounceTimer: () => draftDebounceTimer,
	setDraftDebounceTimer: (t) => {
		draftDebounceTimer = t;
	},
	handleCancel,
});

const {
	notifyDraftChange,
	clearDraft,
	captureAndClearInput,
	createComposerRestoreSnapshot,
	applyComposerRestoreSnapshot,
	handleSend,
	handleSteer,
	handlePrimaryButtonClick,
} = agentInputController;

export function retrySend(): void {
	agentInputController.retrySend();
}

export function restoreQueuedMessage(draft: string, attachments: readonly Attachment[]): void {
	agentInputController.restoreQueuedMessage(draft, attachments);
}

function getCaretDropdownPosition(): { top: number; left: number } | null {
	if (!editorRef) {
		return null;
	}
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return null;
	}
	const range = selection.getRangeAt(0).cloneRange();
	range.collapse(true);
	const rect = range.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) {
		const editorRect = editorRef.getBoundingClientRect();
		return { top: editorRect.top + 20, left: editorRect.left + 12 };
	}
	return { top: rect.bottom, left: rect.left };
}

function handleInlineFileChipClick(filePath: string) {
	if (!composerView.filePickerProjectPath) {
		return;
	}
	panelStore.openFilePanel(filePath, composerView.filePickerProjectPath, {
		ownerPanelId: props.panelId ?? undefined,
	});
}

function dismissAllDropdowns(): void {
	inputState.showFileDropdown = false;
	inputState.fileQuery = "";
	inputState.showSlashDropdown = false;
	inputState.slashQuery = "";
}

function handleEditorInput(options?: { suppressAutocomplete?: boolean }): void {
	if (!editorRef) {
		return;
	}

	const newMessage = serializeInlineComposerMessage(editorRef);
	// Only set the flag when the message actually changed — otherwise Svelte
	// won't schedule the $effect and the flag would get stuck as `true`.
	editorJustSynced = newMessage !== inputState.message;
	inputState.message = newMessage;

	const skipAutocomplete =
		(options?.suppressAutocomplete ?? false) || !hasAutocompleteTrigger(inputState.message);

	if (skipAutocomplete) {
		dismissAllDropdowns();
	} else {
		const cursorPos = getSerializedCursorOffset(editorRef);
		const fileTriggerResult = parseFilePickerTrigger(inputState.message, cursorPos);
		if (fileTriggerResult.isOk() && fileTriggerResult.value) {
			const dropdownPosition = getCaretDropdownPosition();
			if (!dropdownPosition) {
				dismissAllDropdowns();
			} else {
				const trigger = fileTriggerResult.value;
				if (composerView.filePickerProjectPath) {
					inputState
						.loadProjectFiles(composerView.filePickerProjectPath, {
							refresh: !inputState.showFileDropdown,
						})
						.mapErr(() => undefined);
				}

				inputState.showFileDropdown = true;
				inputState.fileStartIndex = trigger.startIndex;
				inputState.fileQuery = trigger.query;
				inputState.filePosition = dropdownPosition;
				inputState.showSlashDropdown = false;
				inputState.slashQuery = "";
			}
		} else {
			inputState.showFileDropdown = false;
			inputState.fileQuery = "";
			const hasConnectedSession = composerView.sessionLifecyclePresentation?.connectionPhase === "connected";

			if (
				composerView.capabilitiesAgentId &&
				!hasConnectedSession &&
				composerView.effectiveCapabilityProviderMetadata?.preconnectionSlashMode === "startupGlobal" &&
				!preconnectionAgentSkillsStore.loaded &&
				!preconnectionAgentSkillsStore.loading
			) {
				preconnectionAgentSkillsStore.ensureLoaded(agentStore.agents).mapErr((error) => {
					logger.error("Failed to warm preconnection skills", {
						agentId: composerView.capabilitiesAgentId,
						projectPath: composerView.filePickerProjectPath,
						error: error.message,
					});
					return undefined;
				});
			}

			preconnectionRemoteCommandsState
				.ensureLoaded({
					agentId: composerView.capabilitiesAgentId,
					hasConnectedSession,
					projectPath: composerView.filePickerProjectPath,
					preconnectionSlashMode:
						composerView.effectiveCapabilityProviderMetadata?.preconnectionSlashMode ?? "unsupported",
				})
				.mapErr((error) => {
					logger.error("Failed to warm remote preconnection commands", {
						agentId: composerView.capabilitiesAgentId,
						projectPath: composerView.filePickerProjectPath,
						error: error.message,
					});
					return undefined;
			});

			const slashTriggerResult = parseSlashCommandTrigger(inputState.message, cursorPos);
			if (slashTriggerResult.isOk() && slashTriggerResult.value) {
				const dropdownPosition = getCaretDropdownPosition();
				if (!dropdownPosition) {
					inputState.showSlashDropdown = false;
					inputState.slashQuery = "";
				} else {
					const trigger = slashTriggerResult.value;
					inputState.showSlashDropdown = true;
					inputState.slashStartIndex = trigger.startIndex;
					inputState.slashQuery = trigger.query;
					inputState.slashPosition = dropdownPosition;
					composerView.refreshAttachMenuMcpCatalog(true);
				}
			} else {
				inputState.showSlashDropdown = false;
				inputState.slashQuery = "";
			}
		}
	}

	if (inputState.message !== lastDraftValue) {
		lastDraftValue = inputState.message;
		notifyDraftChange(inputState.message);
	}
}

$effect(() => {
	effectiveVoiceSessionId;
	voiceEnabled;
	voiceSessionController.sync();
});

onMount(() => {
	const container = inputState.containerRef;
	let composerWidthObserver: ResizeObserver | null = null;
	if (container && props.onToolbarWidthChange) {
		composerWidthObserver = new ResizeObserver(() => {
			reportComposerRowWidth();
		});
		composerWidthObserver.observe(container);
		reportComposerRowWidth();
	}
	const handleWindowKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Shift") {
			isShiftPressed = true;
		}
		if (
			voiceReady &&
			voiceState &&
			shouldUseVoiceHoldKey(event) &&
			shouldRouteWindowVoiceHold({
				editorHasFocus: document.activeElement === editorRef,
				focusedPanelId: panelStore.focusedPanelId,
				panelId: props.panelId,
			})
		) {
			event.preventDefault();
			voiceCursorSnapshot = editorRef
				? getSerializedCursorOffset(editorRef)
				: inputState.message.length;
			voiceState.onKeyboardHoldStart();
		}
	};
	const handleWindowKeyUp = (event: KeyboardEvent) => {
		if (event.key === "Shift") {
			isShiftPressed = false;
		}

		if (voiceState && shouldStopVoiceHold(event, voiceState.isPressAndHold)) {
			event.preventDefault();
			voiceState.onKeyboardHoldEnd();
		}
	};
	window.addEventListener("keydown", handleWindowKeyDown);
	window.addEventListener("keyup", handleWindowKeyUp);
	container?.addEventListener("keydown", handleInputContainerKeyDown);

	inputState.initialize();
	// Restore initial draft from PanelStore if panelId is provided
	if (props.panelId) {
		const pendingComposerRestore = panelStore.consumePendingComposerRestore(props.panelId);
		const draft = panelStore.getMessageDraft(props.panelId);
		const hasPendingUserEntry = composerView.panelHotState?.pendingUserEntry !== null;
		logger.info("[first-send-trace] agent input mount", {
			panelId: props.panelId,
			sessionId: props.sessionId ?? null,
			draftLength: draft.length,
			hasPendingComposerRestore: pendingComposerRestore !== null,
			hasPendingUserEntry,
			hasPendingWorktreeSetup: composerView.panelHotState?.pendingWorktreeSetup !== null,
			messageLengthBeforeRestore: inputState.message.length,
		});
		const resolution = resolvePanelDraftOnMount({
			panelId: props.panelId,
			sessionId: props.sessionId,
			pendingComposerRestore,
			storedDraft: draft,
			hasPendingUserEntry,
		});
		if (resolution.kind === "pending_snapshot") {
			applyComposerRestoreSnapshot(resolution.snapshot);
			logger.info("[first-send-trace] restored pending composer snapshot on mount", {
				panelId: props.panelId,
				sessionId: props.sessionId ?? null,
				draftLength: resolution.snapshot.draft.length,
			});
		} else if (resolution.kind === "initial_draft") {
			inputState.message = resolution.draft;
			lastDraftValue = resolution.draft;
			logger.info("[first-send-trace] restored initial draft on mount", {
				panelId: props.panelId,
				sessionId: props.sessionId ?? null,
				draftLength: resolution.draft.length,
			});
		} else {
			logger.info("[first-send-trace] skipped draft restore on mount", {
				panelId: props.panelId,
				sessionId: props.sessionId ?? null,
				draftLength: draft.length,
				hasPendingUserEntry,
			});
		}
	}
	syncEditorFromMessage(inputState.message.length);
	reportComposerRowWidth();
	logger.info("[first-send-trace] synced editor after mount", {
		panelId: props.panelId ?? null,
		sessionId: props.sessionId ?? null,
		messageLength: inputState.message.length,
		domLength: editorRef ? serializeInlineComposerMessage(editorRef).length : null,
	});

	return () => {
		composerWidthObserver?.disconnect();
		window.removeEventListener("keydown", handleWindowKeyDown);
		window.removeEventListener("keyup", handleWindowKeyUp);
		container?.removeEventListener("keydown", handleInputContainerKeyDown);
	};
});

// Cleanup on destroy — flush any pending draft before teardown
onDestroy(() => {
	voiceSessionController.dispose();
	kb.setContext("inputFocused", false);
	logger.info("[first-send-trace] agent input destroy", {
		panelId: props.panelId ?? null,
		sessionId: props.sessionId ?? null,
		messageLength: inputState.message.length,
		hasPendingUserEntry: composerView.panelHotState?.pendingUserEntry !== null,
		draftDebouncePending: draftDebounceTimer !== null,
	});
	if (props.panelId && inputState.message) {
		if (draftDebounceTimer) {
			clearTimeout(draftDebounceTimer);
			draftDebounceTimer = null;
		}
		panelStore.setMessageDraft(props.panelId, inputState.message);
	} else if (draftDebounceTimer) {
		clearTimeout(draftDebounceTimer);
	}
	inputState.destroy();
});

// Handle mode change
async function handleModeChange(modeId: string) {
	const sessionId = props.sessionId;
	if (sessionId) {
		await sessionStore.composer.runConfigOperation(
			sessionId,
			{
				provisionalModeId: modeId,
				provisionalModelId: composerView.effectiveCurrentModelId,
				provisionalAutonomousEnabled: composerView.autonomousToggleActive,
			},
			async () => {
				const result = await sessionStore.connection.setMode(sessionId, modeId);
				if (result.isErr()) {
					toast.error("Failed to switch mode.");
					return false;
				}
				return true;
			}
		);
		return;
	}
	composerView.provisionalModeId = modeId;
}

async function applyAutonomousEnabledToSession(nextEnabled: boolean): Promise<boolean> {
	if (!props.sessionId) {
		return false;
	}

	const result = await sessionStore.connection.setAutonomousEnabled(props.sessionId, nextEnabled);
	if (result.isErr()) {
		toast.error(nextEnabled ? "Failed to enable Auto-approve." : "Failed to disable Auto-approve.");
		return false;
	}

	if (nextEnabled) {
		const drainResult = await permissionStore.drainPendingForSession(props.sessionId);
		if (drainResult.isErr()) {
			logger.error("Failed to drain Auto-approve permissions", { error: drainResult.error });
			toast.error("Auto-approve is on, but some pending permissions still need attention.");
		}
		return true;
	}

	autonomousStatusMessage = "Future actions now require approval again.";
	return true;
}

async function setAutonomousEnabled(nextEnabled: boolean): Promise<boolean> {
	if (!props.sessionId) {
		if (!props.panelId) {
			return false;
		}
		panelStore.setProvisionalAutonomousEnabled(props.panelId, nextEnabled);
		if (!nextEnabled) {
			autonomousStatusMessage = "Future actions now require approval again.";
		}
		return true;
	}

	return applyAutonomousEnabledToSession(nextEnabled);
}

async function handleAutonomousToggle(): Promise<void> {
	await setAutonomousEnabled(!composerView.autonomousToggleActive);
}

async function handleModeMenuChange(optionId: string): Promise<void> {
	const resolution = resolveModeMenuAction({
		selectedOptionId: optionId,
		currentModeId: composerView.effectiveCurrentModeId,
		autonomousEnabled: composerView.autonomousToggleActive,
	});

	if (!props.sessionId) {
		if (resolution.modeIdToApply) {
		composerView.provisionalModeId = resolution.modeIdToApply;
		}

		if (resolution.autonomousEnabledToApply !== null) {
			await setAutonomousEnabled(resolution.autonomousEnabledToApply);
		}

		return;
	}

	const sessionId = props.sessionId;
	await sessionStore.composer.runConfigOperation(
		sessionId,
		{
			provisionalModeId: resolution.modeIdToApply ?? composerView.effectiveCurrentModeId,
			provisionalModelId: composerView.effectiveCurrentModelId,
			provisionalAutonomousEnabled:
				resolution.autonomousEnabledToApply !== null
					? resolution.autonomousEnabledToApply
					: composerView.autonomousToggleActive,
		},
		async () => {
			if (resolution.modeIdToApply) {
				const modeResult = await sessionStore.connection.setMode(sessionId, resolution.modeIdToApply);
				if (modeResult.isErr()) {
					toast.error("Failed to switch mode.");
					return false;
				}
			}

			if (resolution.autonomousEnabledToApply !== null) {
				const autonomousResult = await applyAutonomousEnabledToSession(
					resolution.autonomousEnabledToApply
				);
				if (!autonomousResult) {
					return false;
				}
			}

			return true;
		}
	);
}

// Handle model change
async function handleModelChange(modelId: string) {
	const sessionId = props.sessionId;
	if (sessionId) {
		await sessionStore.composer.runConfigOperation(
			sessionId,
			{
				provisionalModeId: composerView.effectiveCurrentModeId,
				provisionalModelId: modelId,
				provisionalAutonomousEnabled: composerView.autonomousToggleActive,
			},
			async () => {
				const result = await sessionStore.connection.setModel(sessionId, modelId);
				if (result.isErr()) {
					toast.error("Failed to switch model.");
					return false;
				}
				return true;
			}
		);
		return;
	}
	composerView.provisionalModelId = modelId;
}

async function handleConfigOptionChange(configId: string, value: string) {
	if (!props.sessionId) {
		composerView.setProvisionalConfigOption(configId, value);
		return;
	}

	const sessionId = props.sessionId;
	await sessionStore.composer.runConfigOperation(
		sessionId,
		{
			provisionalModeId: composerView.effectiveCurrentModeId,
			provisionalModelId: composerView.effectiveCurrentModelId,
			provisionalAutonomousEnabled: composerView.autonomousToggleActive,
		},
		async () => {
			const result = await sessionStore.connection.setConfigOption(sessionId, configId, value);
			return result.isOk();
		}
	);
}

function cycleModeOnTab(event: KeyboardEvent): boolean {
	if (event.key !== "Tab" || event.shiftKey || composerView.visibleModes.length === 0) {
		return false;
	}

	event.preventDefault();
	const currentIndex = composerView.visibleModes.findIndex((m) => m.id === composerView.effectiveCurrentModeId);
	const nextIndex =
		currentIndex === -1 ? 1 % composerView.visibleModes.length : (currentIndex + 1) % composerView.visibleModes.length;
	const nextMode = composerView.visibleModes[nextIndex];
	if (nextMode && nextMode.id !== composerView.effectiveCurrentModeId) {
		handleModeChange(nextMode.id);
	}
	return true;
}

function cycleModeOnShortcut(event: KeyboardEvent): boolean {
	if (
		(event.code !== "Period" && event.key !== ".") ||
		!(event.metaKey || event.ctrlKey) ||
		(event.shiftKey && event.key !== ".") ||
		event.altKey ||
		composerView.visibleModes.length === 0
	) {
		return false;
	}

	event.preventDefault();
	event.stopPropagation();
	const currentIndex = composerView.visibleModes.findIndex((m) => m.id === composerView.effectiveCurrentModeId);
	const nextIndex =
		currentIndex === -1 ? 1 % composerView.visibleModes.length : (currentIndex + 1) % composerView.visibleModes.length;
	const nextMode = composerView.visibleModes[nextIndex];
	if (nextMode && nextMode.id !== composerView.effectiveCurrentModeId) {
		handleModeChange(nextMode.id);
	}
	return true;
}

function handleInputContainerKeyDown(event: KeyboardEvent): void {
	if (event.defaultPrevented) {
		return;
	}
	if (event.target === editorRef) {
		return;
	}
	if (cycleModeOnShortcut(event)) {
		return;
	}
}

function shouldUseVoiceHoldKey(event: KeyboardEvent): boolean {
	const currentVoiceState = voiceState;
	if (!shouldStartVoiceHold(event)) {
		return false;
	}
	if (!voiceEnabled || !voiceReady || currentVoiceState === null) {
		return false;
	}
	return canStartVoiceInteraction(
		currentVoiceState.phase,
		composerView.storeComposerState?.isDispatching ?? false
	);
}

function handleEditorKeyDown(event: KeyboardEvent): void {
	if (inputState.showFileDropdown && inputState.fileDropdownRef?.handleKeyDown(event)) {
		return;
	}
	if (inputState.showSlashDropdown && inputState.slashDropdownRef?.handleKeyDown(event)) {
		return;
	}

	const currentVoiceState = voiceState;
	if (currentVoiceState !== null && shouldUseVoiceHoldKey(event)) {
		event.preventDefault();
		voiceCursorSnapshot = editorRef
			? getSerializedCursorOffset(editorRef)
			: inputState.message.length;
		currentVoiceState.onKeyboardHoldStart();
		return;
	}

	if (
		shouldInterruptComposerStream({
			isMac: isMac(),
			isStreaming: composerView.isStreaming,
			event,
		})
	) {
		event.preventDefault();
		void handleCancel();
		return;
	}

	if (cycleModeOnShortcut(event)) {
		return;
	}

	const submitIntent: SubmitIntent = resolveComposerEnterKeyIntent(
		{
			hasDraftInput: composerView.hasDraftInput,
			isAgentBusy: composerView.isAgentBusy,
			hasBlockingComposerConfig: composerView.storeComposerState?.isBlocked ?? false,
			isComposerDispatching: composerView.storeComposerState?.isDispatching ?? false,
			isSubmitDisabled: composerView.isSubmitDisabled,
		},
		event
	);

	if (event.key === "Enter" && submitIntent === "steer") {
		event.preventDefault();
		handleSteer();
		return;
	}

	if (event.key === "Enter" && submitIntent === "send") {
		event.preventDefault();
		markPreSessionSendStarted();
		void handleSend();
		return;
	}

	if (cycleModeOnTab(event)) {
		return;
	}

	if (event.key !== "Backspace" && event.key !== "Delete") {
		return;
	}
	// Close the overlay — the chip being deleted may be the one it's showing
	if (overlayMode) {
		closeOverlay();
	}
	if (!editorRef) {
		return;
	}

	// Fast path: skip all inline-token detection when message has no tokens.
	// The entire Backspace/Delete interception exists for artefact tokens only.
	if (!inputState.message.includes(INLINE_TOKEN_PREFIX)) {
		return;
	}

	const selection = window.getSelection();
	if (!selection || !selection.isCollapsed) {
		return;
	}
	const currentRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
	if (!currentRange) {
		return;
	}

	const adjacentToken = getAdjacentInlineTokenElement(
		editorRef,
		currentRange,
		event.key === "Backspace" ? "backward" : "forward"
	);
	if (adjacentToken) {
		const adjacentRange = getSerializedRangeForNode(editorRef, adjacentToken);
		if (adjacentRange) {
			event.preventDefault();
			inputState.removeInlineTokenRange(adjacentRange.start, adjacentRange.end);
			syncEditorFromMessage(adjacentRange.start);
			handleEditorInput();
			return;
		}
	}

	const cursorPos = getSerializedCursorOffset(editorRef);
	const probePositions: number[] = [];
	if (event.key === "Backspace") {
		probePositions.push(cursorPos - 1);
		const charBeforeCursor = inputState.message[cursorPos - 1];
		if (charBeforeCursor === " ") {
			probePositions.push(cursorPos - 2);
		}
	} else {
		probePositions.push(cursorPos);
		const charAtCursor = inputState.message[cursorPos];
		if (charAtCursor === " ") {
			probePositions.push(cursorPos + 1);
		}
	}

	let range: { start: number; end: number } | null = null;
	for (const probePosition of probePositions) {
		range = findInlineArtefactRangeAtPosition(inputState.message, probePosition);
		if (range) {
			break;
		}
	}
	if (!range) {
		return;
	}

	event.preventDefault();
	inputState.removeInlineTokenRange(range.start, range.end);
	syncEditorFromMessage(range.start);
	handleEditorInput();
}

function handleEditorKeyUp(event: KeyboardEvent): void {
	if (voiceState && shouldStopVoiceHold(event, voiceState.isPressAndHold)) {
		event.preventDefault();
		voiceState.onKeyboardHoldEnd();
	}
}

function handleEditorBeforeInput(_event: InputEvent): void {
	// No-op: voice hold key (Right Option) does not produce text input.
}

function loadSlashCommandWorkspaceMarkdown(input: {
	readonly command: AvailableCommand;
	readonly tokenType: "command" | "skill";
}) {
	return loadSlashCommandWorkspaceMarkdownFromModule({
		command: input.command,
		tokenType: input.tokenType,
		agentId: composerView.capabilitiesAgentId,
	});
}

function handleEditorCut(event: ClipboardEvent): void {
	if (!editorRef) {
		return;
	}

	const serializedRange = getSerializedSelectionRange(editorRef);
	if (!serializedRange || serializedRange.start === serializedRange.end) {
		return;
	}

	const selection = window.getSelection();
	const selectedDomText = selection ? selection.toString() : "";
	const fallbackText = inputState.message.slice(serializedRange.start, serializedRange.end);
	const clipboardText = selectedDomText.length > 0 ? selectedDomText : fallbackText;
	if (event.clipboardData) {
		event.clipboardData.setData("text/plain", clipboardText);
	}

	event.preventDefault();
	inputState.removeInlineTokenRange(serializedRange.start, serializedRange.end);
	syncEditorFromMessage(serializedRange.start);
	handleEditorInput({ suppressAutocomplete: true });
}

function handleEditorFocus(): void {
	const panelId = props.panelId;
	if (
		shouldSyncPanelFocusOnEditorFocus({
			focusedPanelId: panelStore.focusedPanelId,
			panelId,
		}) &&
		panelId
	) {
		panelStore.focusPanel(panelId);
	}
	kb.setContext("inputFocused", true);
}

function handleEditorBlur(): void {
	kb.setContext("inputFocused", false);
}

function handleSlashPaletteItemSelect(item: SlashPaletteItem): void {
	if (!editorRef) {
		inputState.showSlashDropdown = false;
		inputState.slashQuery = "";
		return;
	}

	const cursorPos = getSerializedCursorOffset(editorRef);

	if (item.kind === "mode" && item.modeId) {
		const replaced = replaceActiveSlashTrigger({
			message: inputState.message,
			cursorPos,
			replacement: "",
		});
		if (replaced) {
			inputState.message = replaced.message;
			syncEditorFromMessage(replaced.cursor);
		}
		inputState.showSlashDropdown = false;
		inputState.slashQuery = "";
		handleEditorInput({ suppressAutocomplete: true });
		void handleModeMenuChange(item.modeId);
		return;
	}

	if (item.kind === "model" && item.modelId) {
		const replaced = replaceActiveSlashTrigger({
			message: inputState.message,
			cursorPos,
			replacement: "",
		});
		if (replaced) {
			inputState.message = replaced.message;
			syncEditorFromMessage(replaced.cursor);
		}
		inputState.showSlashDropdown = false;
		inputState.slashQuery = "";
		handleEditorInput({ suppressAutocomplete: true });
		void handleModelChange(item.modelId);
		return;
	}

	const insertText = resolveSlashPaletteItemInsertText(item);
	if (!insertText) {
		inputState.showSlashDropdown = false;
		inputState.slashQuery = "";
		return;
	}

	const replaced = replaceActiveSlashTrigger({
		message: inputState.message,
		cursorPos,
		replacement: `${insertText} `,
	});
	if (!replaced) {
		inputState.showSlashDropdown = false;
		inputState.slashQuery = "";
		return;
	}

	inputState.message = replaced.message;
	inputState.showSlashDropdown = false;
	inputState.slashQuery = "";
	syncEditorFromMessage(replaced.cursor);
	handleEditorInput({ suppressAutocomplete: true });
}

function handleFileSelect(file: { path: string }): void {
	if (!editorRef) {
		return;
	}
	const cursorPos = getSerializedCursorOffset(editorRef);
	const before = inputState.message.substring(0, inputState.fileStartIndex);
	const after = inputState.message.substring(cursorPos);
	const tokenText = toInlineTokenText("file", file.path);
	inputState.message = `${before}${tokenText} ${after}`;
	inputState.showFileDropdown = false;
	inputState.fileQuery = "";
	syncEditorFromMessage(before.length + tokenText.length + 1);
	handleEditorInput();
}

function handleAddFileContextFromAttachMenu(): void {
	if (!editorRef) {
		return;
	}
	editorRef.focus();
	const cursorPos = getSerializedCursorOffset(editorRef);
	const before = inputState.message.substring(0, cursorPos);
	const after = inputState.message.substring(cursorPos);
	inputState.message = `${before}@${after}`;
	syncEditorFromMessage(cursorPos + 1);
	handleEditorInput();
}

function handleAttachImageFromMenu(): void {
	imageAttachInputRef?.click();
}

async function insertInlineImageFromFile(file: File, mimeType: string): Promise<boolean> {
	const result = await createImageAttachment(file, mimeType);
	if (result.isErr()) {
		if (result.error.kind === "too_large") {
			toast.error("Image exceeds 10 MB limit");
		}
		return false;
	}
	const attachment = result.value;
	const token = inputState.createInlineImageReferenceToken({
		displayName: attachment.displayName,
		extension: attachment.extension,
		content: attachment.content,
		path: attachment.path,
	});
	const cursorPos = editorRef ? getSerializedCursorOffset(editorRef) : inputState.message.length;
	const nextCursor = inputState.insertInlineTokenAtOffsets(token, cursorPos, cursorPos);
	syncEditorFromMessage(nextCursor);
	return true;
}

async function handleImageAttachInputChange(event: Event): Promise<void> {
	const target = event.currentTarget;
	if (!(target instanceof HTMLInputElement) || !target.files) {
		return;
	}
	const files = Array.from(target.files);
	for (const file of files) {
		if (!isImageMimeType(file.type)) {
			continue;
		}
		await insertInlineImageFromFile(file, file.type);
	}
	target.value = "";
	handleEditorInput({ suppressAutocomplete: true });
}

function insertAttachMenuTokenAtCursor(insertText: string): void {
	if (!editorRef) {
		return;
	}
	const cursorPos = getSerializedCursorOffset(editorRef);
	const before = inputState.message.substring(0, cursorPos);
	const after = inputState.message.substring(cursorPos);
	inputState.message = `${before}${insertText} ${after}`;
	inputState.showSlashDropdown = false;
	inputState.slashQuery = "";
	syncEditorFromMessage(before.length + insertText.length + 1);
	handleEditorInput({ suppressAutocomplete: true });
}

function handleAttachMenuOpenChange(open: boolean): void {
	if (!open) {
		return;
	}
	composerView.refreshAttachMenuMcpCatalog(true);
}

function handleAttachMenuItemSelect(item: AttachMenuCommandItem): void {
	insertAttachMenuTokenAtCursor(resolveAttachMenuItemInsertText(item));
}

function handleActiveModeDismiss(): void {
	const defaultModeId = resolveDefaultModeId(composerView.visibleModes);
	if (defaultModeId && defaultModeId !== composerView.effectiveCurrentModeId) {
		void handleModeMenuChange(defaultModeId);
	}
}

function reportComposerRowWidth(): void {
	if (!inputState.containerRef) {
		return;
	}
	props.onToolbarWidthChange?.(inputState.containerRef.getBoundingClientRect().width);
}

let overlayCloseTimer: ReturnType<typeof setTimeout> | null = null;

function closeOverlay(): void {
	if (overlayCloseTimer) {
		clearTimeout(overlayCloseTimer);
		overlayCloseTimer = null;
	}
	overlayMode = null;
	overlayRefId = null;
	overlayAnchorRect = null;
}

function scheduleOverlayClose(): void {
	if (overlayCloseTimer) clearTimeout(overlayCloseTimer);
	overlayCloseTimer = setTimeout(closeOverlay, 80);
}

function cancelOverlayClose(): void {
	if (overlayCloseTimer) {
		clearTimeout(overlayCloseTimer);
		overlayCloseTimer = null;
	}
}

function handleOverlaySave(refId: string, newText: string): void {
	if (newText.trim().length === 0) {
		// Empty content — remove the chip entirely
		const tokenText = toInlineTokenText("text_ref", refId);
		const tokenIndex = inputState.message.indexOf(tokenText);
		if (tokenIndex !== -1) {
			inputState.removeInlineTokenRange(tokenIndex, tokenIndex + tokenText.length);
		}
		syncEditorFromMessage(tokenIndex !== -1 ? tokenIndex : null);
		closeOverlay();
		handleEditorInput();
		return;
	}
	inputState.updateInlineText(refId, newText);
	const cursor = editorRef ? getSerializedCursorOffset(editorRef) : null;
	syncEditorFromMessage(cursor);
	closeOverlay();
}

function handleEditorMouseOver(event: MouseEvent): void {
	if (overlayMode === "edit") {
		return;
	}
	const target = event.target as Element | null;
	const pill = target?.closest('[data-inline-token-type="text_ref"]');
	if (!pill) {
		if (overlayMode === "preview") {
			scheduleOverlayClose();
		}
		return;
	}
	cancelOverlayClose();
	const refId = pill.getAttribute("data-inline-token-value");
	if (!refId) {
		return;
	}
	overlayMode = "preview";
	overlayRefId = refId;
	overlayAnchorRect = pill.getBoundingClientRect();
}

function handleEditorMouseOut(event: MouseEvent): void {
	if (overlayMode !== "preview") {
		return;
	}
	const relatedTarget = event.relatedTarget as Element | null;
	const stillOnPill = relatedTarget?.closest('[data-inline-token-type="text_ref"]');
	if (!stillOnPill) {
		scheduleOverlayClose();
	}
}

function handleEditorClick(event: MouseEvent): void {
	if (!editorRef) {
		return;
	}
	const target = event.target as HTMLElement | null;
	if (!target) {
		return;
	}

	const editButton = target.closest("[data-inline-edit]") as HTMLElement | null;
	if (editButton) {
		event.preventDefault();
		event.stopPropagation();
		const tokenNode = editButton.closest('[data-inline-token-type="text_ref"]');
		if (!tokenNode) {
			return;
		}
		const refId = tokenNode.getAttribute("data-inline-token-value");
		if (!refId) {
			return;
		}
		overlayMode = "edit";
		overlayRefId = refId;
		overlayAnchorRect = tokenNode.getBoundingClientRect();
		return;
	}

	const removeButton = target.closest("[data-inline-remove]") as HTMLElement | null;
	if (removeButton) {
		event.preventDefault();
		event.stopPropagation();
		const tokenNode = removeButton.closest("[data-inline-token-type]");
		if (!tokenNode) {
			return;
		}
		// Close overlay if it's showing this token's content
		const removedRefId = tokenNode.getAttribute("data-inline-token-value");
		if (overlayRefId && removedRefId === overlayRefId) {
			closeOverlay();
		}
		const range = getSerializedRangeForNode(editorRef, tokenNode);
		if (!range) {
			return;
		}
		inputState.removeInlineTokenRange(range.start, range.end);
		syncEditorFromMessage(range.start);
		handleEditorInput();
		return;
	}

	const tokenNode = target.closest("[data-inline-token-type]");
	if (!tokenNode) {
		return;
	}
	const tokenType = getInlineTokenType(tokenNode);
	const tokenValue = getInlineTokenValue(tokenNode);
	if (tokenType === "file" && tokenValue) {
		handleInlineFileChipClick(tokenValue);
	}
}

const PASTE_PILL_LINE_THRESHOLD = 5;

async function handleEditorPaste(event: ClipboardEvent): Promise<void> {
	event.preventDefault();
	event.stopPropagation();

	const clipboardData = event.clipboardData;
	if (!clipboardData || !editorRef) {
		return;
	}

	const items = Array.from(clipboardData.items);
	for (const item of items) {
		if (!isImageMimeType(item.type)) {
			continue;
		}
		const file = item.getAsFile();
		if (!file) {
			continue;
		}
		if (await insertInlineImageFromFile(file, item.type)) {
			handleEditorInput({ suppressAutocomplete: true });
		}
		return;
	}

	const text = clipboardData.getData("text/plain");
	if (!text || !text.trim()) {
		return;
	}

	const cursorPos = getSerializedCursorOffset(editorRef);
	const selectionEnd = getSerializedSelectionEnd(editorRef, cursorPos);

	if (text.split("\n").length >= PASTE_PILL_LINE_THRESHOLD) {
		const token = inputState.createInlineTextReferenceToken(text);
		const nextCursor = inputState.insertInlineTokenAtOffsets(token, cursorPos, selectionEnd);
		syncEditorFromMessage(nextCursor);
	} else {
		inputState.insertPlainTextAtOffsets(text, cursorPos, selectionEnd);
		syncEditorFromMessage(cursorPos + text.length);
	}

	handleEditorInput({ suppressAutocomplete: true });
}

$effect(() => {
	inputState.editorRef = editorRef;
	if (!editorRef) {
		return;
	}

	// Track the reactive dependency on inputState.message so this effect
	// re-runs when it changes, but skip the expensive DOM re-serialization
	// when handleEditorInput already synced the DOM on this microtask.
	const _message = inputState.message;
	if (editorJustSynced) {
		editorJustSynced = false;
		return;
	}

	const domMessage = serializeInlineComposerMessage(editorRef);
	if (domMessage === _message) {
		return;
	}
	const cursorPos = Math.min(getSerializedCursorOffset(editorRef), _message.length);
	syncEditorFromMessage(cursorPos);
});
</script>

{#snippet newThreadModelControl()}
	<ModelSelector
		availableModels={composerView.effectiveAvailableModels}
		currentModelId={composerView.effectiveCurrentModelId}
		modelsDisplay={composerView.effectiveModelsDisplay}
		providerMetadata={composerView.effectiveCapabilityProviderMetadata}
		onModelChange={handleModelChange}
		isLoading={composerView.selectorsLoading}
		panelId={props.panelId}
		compactSetup
		embeddedInGroup={composerView.toolbarConfigOptions.some(
			(option) => option.presentation === "compactReasoning"
		)}
	/>
{/snippet}

<div
	bind:this={inputState.containerRef}
	role="region"
	aria-label="Message input with file drop zone"
	ondrop={async (e) => {
		await inputState.handleDrop(e);
		syncEditorFromMessage(inputState.message.length);
		handleEditorInput({ suppressAutocomplete: true });
	}}
	ondragover={(e) => inputState.handleDragOver(e)}
	ondragleave={(e) => {
		// Only trigger leave if we're leaving the container entirely
		const relatedTarget = e.relatedTarget instanceof Node ? e.relatedTarget : null;
		if (!e.currentTarget.contains(relatedTarget)) {
			inputState.handleDragLeave();
		}
	}}
>
	{#if inputState.isDragOver}
		<AgentInputDropZone isDragHovering={inputState.isDragHovering} label="Drop image to attach" />
	{:else}
		<span class="sr-only" role="status" aria-live="polite">{autonomousStatusMessage}</span>
		<div class="flex min-w-0 flex-col gap-0.5">
		{#if showNewThreadOptions && props.newThreadContext}
			{@const newThread = props.newThreadContext}
			<div
				class="flex w-full {newThread.setupBarAlign === 'start'
					? 'justify-start'
					: 'justify-center'}"
			>
				<AgentInputNewThreadOptions
					project={newThread.project}
					agent={newThread.agent}
					branch={newThread.branch}
					settingsMenu={newThread.settingsMenu}
					showWorktree={newThread.showWorktree}
					worktreeOn={newThread.worktreeOn}
					worktreeDisabled={newThread.worktreeDisabled}
					onWorktreeToggle={newThread.onWorktreeToggle}
					worktreeDefaultOn={newThread.worktreeDefaultOn}
					onWorktreeDefaultToggle={newThread.onWorktreeDefaultToggle}
					align={newThread.setupBarAlign ?? "center"}
				/>
			</div>
		{/if}
		<SharedAgentPanelComposer
			class="border-t-0 p-0"
			inputClass={props.composerInputClass ?? "flex-shrink-0 rounded-lg border border-border bg-input/30"}
			contentClass={voiceOverlayActive ? "relative p-1" : "p-1"}
		>
			{#snippet content()}
				<input
					bind:this={imageAttachInputRef}
					type="file"
					accept="image/*"
					class="hidden"
					aria-hidden="true"
					tabindex={-1}
					onchange={(event) => { void handleImageAttachInputChange(event); }}
				/>
				<AgentInputComposerBody
					bind:editorRef
					{voiceState}
					{voiceOverlayActive}
					inputReady={composerView.inputReady}
					{inputState}
					overlayMode={overlayMode}
					overlayRefId={overlayRefId}
					overlayAnchorRect={overlayAnchorRect}
					composerInteraction={composerView.composerInteraction}
					isStreaming={composerView.isStreaming}
					hasDraftInput={composerView.hasDraftInput}
					isAgentBusy={composerView.isAgentBusy}
					slashPaletteSections={composerView.slashPaletteSections}
					isSlashDropdownVisible={composerView.isSlashDropdownVisible}
					filePickerProjectPath={composerView.filePickerProjectPath}
					onEditorBeforeInput={handleEditorBeforeInput}
					onEditorInput={() => handleEditorInput()}
					onEditorKeyDown={handleEditorKeyDown}
					onEditorKeyUp={handleEditorKeyUp}
					onEditorFocus={handleEditorFocus}
					onEditorBlur={handleEditorBlur}
					onEditorClick={handleEditorClick}
					onEditorMouseOver={handleEditorMouseOver}
					onEditorMouseOut={handleEditorMouseOut}
					onEditorPaste={(e) => handleEditorPaste(e)}
					onEditorCut={handleEditorCut}
					onOverlaySave={handleOverlaySave}
					onOverlayClose={closeOverlay}
					onOverlayMouseEnterCancel={cancelOverlayClose}
					onPrimaryButtonClick={() => {
						markPreSessionSendStarted();
						void handlePrimaryButtonClick();
					}}
					onSlashPaletteItemSelect={handleSlashPaletteItemSelect}
					loadSlashCommandWorkspaceMarkdown={loadSlashCommandWorkspaceMarkdown}
					onFileSelect={handleFileSelect}
					onSlashDropdownClose={() => inputState.handleDropdownClose()}
					onFileDropdownClose={() => inputState.handleFileDropdownClose()}
					placeholderLabel={composerView.composerPlaceholderLabel}
					voiceOverlayPhase={voiceRecordingOverlayPhase}
					voiceDefaultErrorMessage={"Microphone permission denied"}
					primarySrQueue={"Queue"}
					primarySrSend={"Send message"}
					primarySrInterrupt={"Interrupt"}
				>
					{#snippet leadingControls()}
						<AgentInputAttachMenu
							disabled={composerView.selectorsDisabledByComposer}
							modes={composerView.attachMenuModes}
							commandSections={composerView.attachMenuCommandSections}
							mcpServerGroups={composerView.attachMenuMcpServerGroups}
							mcpLoading={composerView.attachMenuMcpCatalogLoading}
							showMcpSection={composerView.attachMenuShowMcpSection}
							mcpCatalogLoaded={composerView.attachMenuMcpCatalogLoaded}
							showModes={composerView.visibleModes.length > 0}
							autonomousToggleActive={composerView.autonomousToggleActive}
							autonomousDisabled={composerView.autonomousDisabled}
							autonomousBusy={composerView.autonomousToggleBusy}
							onAutonomousToggle={() => { void handleAutonomousToggle(); }}
							onModeChange={(modeId) => { void handleModeMenuChange(modeId); }}
							onAddFileContext={handleAddFileContextFromAttachMenu}
							onAttachImage={handleAttachImageFromMenu}
							onCommandItemSelect={handleAttachMenuItemSelect}
							onOpenChange={handleAttachMenuOpenChange}
							checkpointOverflow={
								props.showCheckpointInAttachMenu ? props.checkpointButton : undefined
							}
						/>
						{#if composerView.showActiveModeChip}
							<AgentInputActiveModeChip
								label={composerView.selectedModeOption.label}
								iconKind={composerView.selectedModeOption.iconKind}
								disabled={composerView.selectorsDisabledByComposer}
								onDismiss={handleActiveModeDismiss}
							/>
						{/if}
					{/snippet}
					{#snippet trailingControls()}
						<AgentInputComposerTrailingControls
							inputReady={composerView.inputReady}
							agentProjectPicker={showNewThreadOptions ? undefined : props.agentProjectPicker}
							toolbarConfigOptions={composerView.toolbarConfigOptions}
							onConfigOptionChange={(configId, value) => {
								void handleConfigOptionChange(configId, value);
							}}
							selectorsLoading={composerView.selectorsLoading}
							selectorsDisabledByComposer={composerView.selectorsDisabledByComposer}
							voiceState={voiceToolbarBinding}
							{voiceEnabled}
							composerIsDispatching={composerView.storeComposerState?.isDispatching ?? false}
							getMicButtonTitle={(_voice) =>
								voiceState ? resolveVoiceMicTooltip(voiceState.phase, voiceMicTooltipLabels) : ""}
							onVoiceMicKeyDown={(event, _binding) => {
								if (voiceReady && voiceState) {
									if (voiceState.phase === "idle") {
										voiceCursorSnapshot = editorRef
											? getSerializedCursorOffset(editorRef)
											: inputState.message.length;
									}
									handleVoiceMicKeyDownFromModule(event, voiceState);
								}
							}}
							voiceModels={voiceSettingsStore.models.map((model) => ({
								id: model.id,
								name: model.name,
								sizeBytes: model.size_bytes,
								isDownloaded: model.is_downloaded,
							}))}
							voiceSelectedModelId={voiceSettingsStore.selectedModelId}
							voiceModelsLoading={voiceSettingsStore.modelsLoading}
							voiceDownloadingModelId={voiceSettingsStore.downloadProgressModelId}
							voiceDownloadPercent={voiceSettingsStore.downloadPercent}
							voiceMenuLabel={"Voice model"}
							voiceModelsLoadingLabel={"Loading voice models…"}
							onVoiceSelectModel={(modelId) => {
								void voiceSettingsStore.setSelectedModelId(modelId);
							}}
							onVoiceDownloadModel={(modelId) => {
								void voiceSettingsStore.downloadModel(modelId);
							}}
							onVoiceUninstallModel={(modelId) => {
								void voiceSettingsStore.deleteModel(modelId);
							}}
							voiceCloseLabel={"Close"}
						>
							{#snippet modelSelector()}
								{@render newThreadModelControl()}
							{/snippet}
							{#snippet metricsChip()}
								{#if props.sessionId}
									<ModelSelectorMetricsChip
										sessionId={props.sessionId}
										agentId={composerView.capabilitiesAgentId}
									/>
								{/if}
							{/snippet}
						</AgentInputComposerTrailingControls>
					{/snippet}
				</AgentInputComposerBody>
			{/snippet}
		</SharedAgentPanelComposer>
		</div>
	{/if}
</div>
