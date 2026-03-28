<script lang="ts">
import IconArrowUp from "@tabler/icons-svelte/icons/arrow-up";
import { Result } from "neverthrow";
import ImageSquare from "phosphor-svelte/lib/ImageSquare";
import Stop from "phosphor-svelte/lib/Stop";
import { onDestroy, onMount } from "svelte";
import { toast } from "svelte-sonner";
import { Button } from "$lib/components/ui/button/index.js";
import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import { getKeybindingsService } from "$lib/keybindings/index.js";
import * as m from "$lib/paraglide/messages.js";
import { getVoiceSettingsStore } from "$lib/stores/voice-settings-store.svelte.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import * as agentModelPrefs from "../../store/agent-model-preferences-store.svelte.js";
import { getMessageQueueStore, getPanelStore, getSessionStore } from "../../store/index.js";
import type { AvailableCommand } from "../../types/available-command.js";
import { CanonicalModeId } from "../../types/canonical-mode-id.js";
import { Colors } from "../../utils/colors.js";
import { createLogger } from "../../utils/logger.js";
import { filterVisibleModes } from "../../utils/mode-filter.js";
import { ArtefactBadge } from "../artefact/index.js";
import FilePickerDropdown from "../file-picker/file-picker-dropdown.svelte";
import { ModelSelector, ModeSelector } from "../index.js";
import { InputContainer } from "@acepe/ui/input-container";
import ModelSelectorMetricsChip from "../model-selector.metrics-chip.svelte";
import SlashCommandDropdown from "../slash-command-dropdown/slash-command-dropdown-ui.svelte";
import { runWorktreeSetup } from "../worktree-toggle/worktree-setup-orchestrator.js";
import MicButton from "./components/mic-button.svelte";
import VoiceModelMenu from "./components/voice-model-menu.svelte";
import PastedTextOverlay from "./components/pasted-text-overlay.svelte";
import VoiceRecordingOverlay from "./components/voice-recording-overlay.svelte";
import { VoiceInputState } from "./state/voice-input-state.svelte.js";
import { shouldShowVoiceOverlay } from "./logic/voice-ui-state.js";
import { createImageAttachment, isImageMimeType } from "./logic/image-attachment.js";
import { resolveSlashCommandSource } from "./logic/slash-command-source.js";
import {
	findInlineArtefactRangeAtPosition,
	INLINE_TOKEN_PREFIX,
} from "./logic/inline-artefact-segments.js";
import {
	getAdjacentInlineTokenElement,
	getInlineTokenType,
	getInlineTokenValue,
	getSerializedCursorOffset,
	getSerializedRangeForNode,
	getSerializedSelectionRange,
	getSerializedSelectionEnd,
	renderInlineComposerMessage,
	serializeInlineComposerMessage,
	setSerializedCursorOffset,
	toInlineTokenText,
} from "./logic/inline-composer-dom.js";
import {
	hasAutocompleteTrigger,
	parseFilePickerTrigger,
	parseSlashCommandTrigger,
} from "./logic/input-parser.js";
import { type PreparedMessage, prepareMessageForSend } from "./logic/message-preparation.js";
import {
	type SubmitIntent,
	resolveEnterKeyIntent,
	resolvePrimaryButtonIntent,
} from "./logic/submit-intent.js";
import {
	resolvePendingToolbarSelections,
	resolveToolbarModeId,
	resolveToolbarModelId,
} from "./logic/toolbar-state.js";
import { createPendingUserEntry } from "./logic/pending-user-entry.js";
import {
	shouldClearPersistedDraftBeforeAsyncSend,
	shouldRestoreInitialDraft,
} from "$lib/components/main-app-view/components/content/logic/empty-state-send-state.js";
import { normalizeVoiceInputText } from "./logic/voice-input-text.js";
import { shouldStartVoiceHold, shouldStopVoiceHold } from "./logic/voice-keyboard.js";
import { AgentInputState } from "./state/agent-input-state.svelte.js";
import type { AgentInputProps } from "./types/agent-input-props.js";
import { getPreconnectionAgentSkillsStore } from "$lib/skills/store/preconnection-agent-skills-store.svelte.js";

// Keep props as reactive object instead of destructuring
const props: AgentInputProps = $props();
const logger = createLogger({ id: "agent-input-send-trace", name: "AgentInputSendTrace" });
const kb = getKeybindingsService();

const sessionStore = getSessionStore();
const panelStore = getPanelStore();
const messageQueueStore = getMessageQueueStore();
const preconnectionAgentSkillsStore = getPreconnectionAgentSkillsStore();
const voiceSettingsStore = getVoiceSettingsStore();
const effectiveVoiceSessionId = $derived(props.voiceSessionId ?? props.sessionId ?? null);

// Create state instance with reactive project path getter
const inputState = new AgentInputState(sessionStore, panelStore, () => props.projectPath ?? null);

let voiceState: VoiceInputState | null = $state(null);
const voiceEnabled = $derived(voiceSettingsStore.enabled);
const voiceOverlayActive = $derived.by(() => {
	const currentVoiceState = voiceState;
	if (currentVoiceState === null) {
		return false;
	}

	return shouldShowVoiceOverlay(currentVoiceState.phase);
});

const panelHotState = $derived(props.panelId ? panelStore.getHotState(props.panelId) : null);

// Resolve capabilities agent from selected agent, then fall back to the session's agent.
const sessionIdentity = $derived(
	props.sessionId ? sessionStore.getSessionIdentity(props.sessionId) : null
);
const capabilitiesAgentId = $derived(props.selectedAgentId ?? sessionIdentity?.agentId ?? null);

// Get capabilities from session store when we have a session
const sessionCapabilities = $derived(
	props.sessionId ? sessionStore.getCapabilities(props.sessionId) : null
);

// Get hot state for current mode/model
const sessionHotState = $derived(
	props.sessionId ? sessionStore.getHotState(props.sessionId) : null
);
const sessionRuntimeState = $derived(
	props.sessionId ? sessionStore.getSessionRuntimeState(props.sessionId) : null
);

// Persisted caches (loaded from SQLite on startup, survives restarts)
const cachedModes = $derived(
	capabilitiesAgentId ? agentModelPrefs.getCachedModes(capabilitiesAgentId) : []
);
const cachedModels = $derived(
	capabilitiesAgentId ? agentModelPrefs.getCachedModels(capabilitiesAgentId) : []
);
const cachedModelsDisplay = $derived(
	capabilitiesAgentId ? agentModelPrefs.getCachedModelsDisplay(capabilitiesAgentId) : null
);

// Fallback: session capabilities → persisted cache
const effectiveAvailableModes = $derived(
	sessionCapabilities?.availableModes?.length ? sessionCapabilities.availableModes : cachedModes
);

// Filter to only show Build and Plan modes in the UI
const visibleModes = $derived(filterVisibleModes(effectiveAvailableModes));

const effectiveCurrentModeId = $derived.by(() =>
	resolveToolbarModeId({
		liveCurrentModeId: sessionHotState?.currentMode?.id ?? null,
		provisionalModeId,
		visibleModes,
	})
);

// Derive button color based on current mode
const buttonColor = $derived.by(() => {
	switch (effectiveCurrentModeId) {
		case CanonicalModeId.PLAN:
			return Colors.orange;
		case CanonicalModeId.BUILD:
			return "var(--success)";
		default:
			return "var(--success)";
	}
});

// Fallback: session capabilities → persisted cache
const effectiveAvailableModels = $derived.by(() => {
	const sessionModels = sessionCapabilities?.availableModels ?? [];
	return sessionModels.length > 0 ? sessionModels : cachedModels;
});

const preferredDefaultModelId = $derived.by(() => {
	if (!capabilitiesAgentId || !effectiveCurrentModeId) {
		return null;
	}
	const modeType =
		effectiveCurrentModeId === CanonicalModeId.PLAN ? CanonicalModeId.PLAN : CanonicalModeId.BUILD;
	return agentModelPrefs.getDefaultModel(capabilitiesAgentId, modeType) ?? null;
});

const effectiveCurrentModelId = $derived.by(() =>
	resolveToolbarModelId({
		liveCurrentModelId: sessionHotState?.currentModel?.id ?? null,
		provisionalModelId,
		availableModels: effectiveAvailableModels,
		preferredDefaultModelId,
	})
);

const liveAvailableCommands = $derived.by(() => {
	if (sessionHotState && sessionHotState.availableCommands) {
		return sessionHotState.availableCommands;
	}

	return [];
});
const preconnectionAvailableCommands = $derived.by(() => {
	if (!capabilitiesAgentId) {
		return [];
	}

	return preconnectionAgentSkillsStore.getCommandsForAgent(capabilitiesAgentId);
});
const slashCommandSource = $derived.by(() => {
	return resolveSlashCommandSource({
		liveCommands: liveAvailableCommands,
		hasConnectedSession: sessionRuntimeState?.connectionPhase === "connected",
		selectedAgentId: capabilitiesAgentId,
		preconnectionCommands: preconnectionAvailableCommands,
	});
});
const effectiveAvailableCommands = $derived(slashCommandSource.commands);
const isSlashDropdownVisible = $derived(
	inputState.showSlashDropdown && slashCommandSource.source !== "none"
);

// Input is ready when we have a session or project path (loading state no longer blocks input)
const inputReady = $derived(!!props.sessionId || !!props.projectPath);

// Submit is controlled by canonical runtime state when a session exists.
const isSubmitDisabled = $derived(
	props.disableSend
		? true
		: props.sessionId
			? !(props.sessionCanSubmit ?? sessionRuntimeState?.canSubmit ?? false)
			: false
);

const isSessionConnecting = $derived(sessionRuntimeState?.connectionPhase === "connecting");

// Loading state only follows explicit connecting/loading signals.
// Empty capabilities should show selector empty-state, not a perpetual loading shimmer.
const hasSession = $derived(props.sessionId !== null && props.sessionId !== undefined);
const hasCachedToolbarData = $derived(
	visibleModes.length > 0 || effectiveAvailableModels.length > 0
);
const selectorsLoading = $derived.by(() => {
	// Case 1: Session is connecting and no cached data yet
	if (hasSession && isSessionConnecting && !hasCachedToolbarData) return true;
	// Case 2: No session, agent selected, caches still loading from SQLite
	if (
		!hasSession &&
		capabilitiesAgentId &&
		!hasCachedToolbarData &&
		!agentModelPrefs.isCacheLoaded()
	)
		return true;
	return false;
});

$effect(() => {
	const sessionId = props.sessionId;
	if (!sessionId || isApplyingProvisionalToolbarSelections) {
		return;
	}
	if (sessionRuntimeState?.connectionPhase !== "connected") {
		return;
	}

	const resolution = resolvePendingToolbarSelections({
		provisionalModeId,
		provisionalModelId,
		liveCurrentModeId: sessionHotState?.currentMode?.id ?? null,
		liveCurrentModelId: sessionHotState?.currentModel?.id ?? null,
		availableModes: visibleModes,
		availableModels: effectiveAvailableModels,
	});

	const liveModeId = sessionHotState?.currentMode?.id ?? null;
	const liveModelId = sessionHotState?.currentModel?.id ?? null;
	const nextProvisionalModeId =
		resolution.nextProvisionalModeId && resolution.nextProvisionalModeId === liveModeId
			? null
			: resolution.nextProvisionalModeId;
	const nextProvisionalModelId =
		resolution.nextProvisionalModelId && resolution.nextProvisionalModelId === liveModelId
			? null
			: resolution.nextProvisionalModelId;

	if (
		nextProvisionalModeId !== provisionalModeId ||
		nextProvisionalModelId !== provisionalModelId
	) {
		provisionalModeId = nextProvisionalModeId;
		provisionalModelId = nextProvisionalModelId;
	}

	if (!resolution.modeIdToApply && !resolution.modelIdToApply) {
		return;
	}

	isApplyingProvisionalToolbarSelections = true;

	const run = async () => {
		if (resolution.modeIdToApply) {
			const modeResult = await sessionStore.setMode(sessionId, resolution.modeIdToApply);
			if (modeResult.isErr()) {
				provisionalModeId = null;
			}
		}

		if (resolution.modelIdToApply) {
			const modelResult = await sessionStore.setModel(sessionId, resolution.modelIdToApply);
			if (modelResult.isErr()) {
				provisionalModelId = null;
			}
		}
	};

	void run().finally(() => {
		isApplyingProvisionalToolbarSelections = false;
	});
});

// Stop/cancel state from canonical runtime contract.
const isStreaming = $derived(
	props.sessionShowStop ?? sessionRuntimeState?.showStop ?? props.sessionIsStreaming ?? false
);

// Agent is busy when actively streaming/thinking — queue messages instead of sending
const isAgentBusy = $derived(sessionRuntimeState?.activityPhase === "running");
const hasDraftInput = $derived(inputState.message.trim().length > 0 || inputState.attachments.length > 0);

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
let isSending = $state(false);
let isShiftPressed = $state(false);
let isApplyingProvisionalToolbarSelections = $state(false);
let provisionalModeId = $state<string | null>(null);
let provisionalModelId = $state<string | null>(null);
let editorRef: HTMLDivElement | null = $state(null);
let overlayMode: "preview" | "edit" | null = $state(null);
let overlayRefId: string | null = $state(null);
let overlayAnchorRect: DOMRect | null = $state(null);
const primaryButtonIntent = $derived.by(() =>
	resolvePrimaryButtonIntent({
		hasDraftInput,
		isAgentBusy,
		isStreaming,
		isShiftPressed,
	})
);
const HOVER_PREVIEW_MAX_CHARS = 500;

function truncateHoverContent(value: string): string {
	if (value.length <= HOVER_PREVIEW_MAX_CHARS) {
		return value;
	}
	return `${value.slice(0, HOVER_PREVIEW_MAX_CHARS)}…`;
}

function decodeInlineTextTokenValue(value: string): string | null {
	const result = Result.fromThrowable(
		(v: string) => decodeURIComponent(escape(atob(v))),
		() => new Error("Invalid base64 or URI")
	)(value);
	return result.isOk() ? result.value : null;
}

function applyInlineTokenHoverTitles(): void {
	if (!editorRef) {
		return;
	}
	const tokenNodes = editorRef.querySelectorAll(
		"[data-inline-token-type][data-inline-token-value]"
	);
	for (const node of tokenNodes) {
		const tokenType = getInlineTokenType(node);
		const tokenValue = getInlineTokenValue(node);
		if (!tokenType || !tokenValue) {
			node.removeAttribute("title");
			continue;
		}

		if (tokenType === "skill") {
			node.setAttribute("title", tokenValue.startsWith("/") ? tokenValue : `/${tokenValue}`);
			continue;
		}

		if (tokenType === "text_ref") {
			// No native title — we use a custom preview overlay on hover
			node.removeAttribute("title");
			continue;
		}

		if (tokenType === "text") {
			const decoded = decodeInlineTextTokenValue(tokenValue);
			node.setAttribute("title", truncateHoverContent(decoded ?? "Pasted text"));
			continue;
		}

		node.removeAttribute("title");
	}
}

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
		return undefined;
	});
	applyInlineTokenHoverTitles();
	setSerializedCursorOffset(editorRef, nextCursor ?? inputState.message.length);
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
	if (!props.projectPath) {
		return;
	}
	panelStore.openFilePanel(filePath, props.projectPath, {
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
				if (!inputState.filesLoaded && !inputState.filesLoading && props.projectPath) {
					inputState.loadProjectFiles(props.projectPath).mapErr(() => undefined);
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

			const slashTriggerResult = parseSlashCommandTrigger(inputState.message, cursorPos);
			if (slashTriggerResult.isOk() && slashTriggerResult.value) {
				const currentSlashCommandSource = slashCommandSource;
				const dropdownPosition = getCaretDropdownPosition();
				if (!dropdownPosition || currentSlashCommandSource.source === "none") {
					inputState.showSlashDropdown = false;
					inputState.slashQuery = "";
				} else {
					const trigger = slashTriggerResult.value;
					inputState.showSlashDropdown = true;
					inputState.slashStartIndex = trigger.startIndex;
					inputState.slashQuery = trigger.query;
					inputState.slashPosition = dropdownPosition;
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

async function initializeVoiceState(): Promise<void> {
	if (!effectiveVoiceSessionId || !voiceEnabled) {
		return;
	}

	const nextVoiceState = new VoiceInputState({
		sessionId: effectiveVoiceSessionId,
		getSelectedLanguage: () => voiceSettingsStore.language,
		getSelectedModelId: () => voiceSettingsStore.selectedModelId,
		onTranscriptionReady: (text) => {
			const normalizedText = normalizeVoiceInputText(text);
			if (!normalizedText) {
				return;
			}
			const sep = inputState.message.length > 0 ? " " : "";
			inputState.insertPlainTextAtOffsets(
				sep + normalizedText,
				inputState.message.length,
				inputState.message.length,
			);
			syncEditorFromMessage(inputState.message.length);
		},
	});

	await nextVoiceState.registerListeners();
	voiceState = nextVoiceState;
}

// Initialize on mount (file preloading is now handled reactively by state class)
onMount(() => {
	const handleWindowKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Shift") {
			isShiftPressed = true;
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

	inputState.initialize();
	void initializeVoiceState();
	// Restore initial draft from PanelStore if panelId is provided
	if (props.panelId) {
		const draft = panelStore.getMessageDraft(props.panelId);
		const hasPendingUserEntry = panelHotState?.pendingUserEntry !== null;
		logger.info("[first-send-trace] agent input mount", {
			panelId: props.panelId,
			sessionId: props.sessionId ?? null,
			draftLength: draft.length,
			hasPendingUserEntry,
			hasPendingWorktreeSetup: panelHotState?.pendingWorktreeSetup !== null,
			messageLengthBeforeRestore: inputState.message.length,
		});
		if (
			shouldRestoreInitialDraft({
				panelId: props.panelId,
				sessionId: props.sessionId,
				draft,
				hasPendingUserEntry,
			})
		) {
			inputState.message = draft;
			lastDraftValue = draft;
			logger.info("[first-send-trace] restored initial draft on mount", {
				panelId: props.panelId,
				sessionId: props.sessionId ?? null,
				draftLength: draft.length,
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
	logger.info("[first-send-trace] synced editor after mount", {
		panelId: props.panelId ?? null,
		sessionId: props.sessionId ?? null,
		messageLength: inputState.message.length,
		domLength: editorRef ? serializeInlineComposerMessage(editorRef).length : null,
	});

	return () => {
		window.removeEventListener("keydown", handleWindowKeyDown);
		window.removeEventListener("keyup", handleWindowKeyUp);
	};
});

// Cleanup on destroy — flush any pending draft before teardown
onDestroy(() => {
	voiceState?.dispose();
	kb.setContext("inputFocused", false);
	logger.info("[first-send-trace] agent input destroy", {
		panelId: props.panelId ?? null,
		sessionId: props.sessionId ?? null,
		messageLength: inputState.message.length,
		hasPendingUserEntry: panelHotState?.pendingUserEntry !== null,
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

// Debounced draft change notification - saves to PanelStore
function notifyDraftChange(draft: string) {
	if (!props.panelId) return;
	if (draftDebounceTimer) {
		clearTimeout(draftDebounceTimer);
	}
	draftDebounceTimer = setTimeout(() => {
		if (props.panelId) {
			panelStore.setMessageDraft(props.panelId, draft);
		}
	}, 500); // 500ms debounce for draft persistence
}

// Clear draft from panel store (called after message is sent)
function clearDraft() {
	if (props.panelId) {
		// Cancel any pending debounced draft save
		if (draftDebounceTimer) {
			clearTimeout(draftDebounceTimer);
			draftDebounceTimer = null;
		}
		lastDraftValue = "";
		panelStore.setMessageDraft(props.panelId, "");
		logger.info("[first-send-trace] cleared persisted draft", {
			panelId: props.panelId,
			sessionId: props.sessionId ?? null,
		});
	}
}

/**
 * Capture the current input, expand inline refs, serialize attachments,
 * validate, and clear the input state. All send paths call this first.
 */
function captureAndClearInput(): PreparedMessage | null {
	const result = prepareMessageForSend(
		inputState.message,
		inputState.inlineTextMap,
		inputState.attachments
	);
	if (result.isErr()) return null;
	logger.info("[first-send-trace] captureAndClearInput before clear", {
		panelId: props.panelId ?? null,
		sessionId: props.sessionId ?? null,
		messageLength: inputState.message.length,
		attachmentCount: inputState.attachments.length,
		domLengthBeforeClear: editorRef ? serializeInlineComposerMessage(editorRef).length : null,
	});

	inputState.message = "";
	inputState.clearAttachments();
	inputState.clearInlineTextMap();
	syncEditorFromMessage(0);
	logger.info("[first-send-trace] captureAndClearInput after clear", {
		panelId: props.panelId ?? null,
		sessionId: props.sessionId ?? null,
		messageLength: inputState.message.length,
		domLengthAfterClear: editorRef ? serializeInlineComposerMessage(editorRef).length : null,
	});

	if (inputState.textareaRef) {
		inputState.textareaRef.style.height = "auto";
		inputState.textareaRef.style.overflowY = "hidden";
	}

	return result.value;
}

// Handle send message (or queue when agent is busy)
async function handleSend() {
	const t0 = performance.now();
	if (isSending) return;

	if (
		!isStreaming &&
		!isAgentBusy &&
		(isSubmitDisabled || (!inputState.message.trim() && inputState.attachments.length === 0))
	) {
		return;
	}

	// If streaming, cancel first then send (same as steer)
	if (
		isStreaming &&
		props.sessionId &&
		(inputState.message.trim() || inputState.attachments.length > 0)
	) {
		handleSteer();
		return;
	}

	// Agent is busy — queue instead of sending
	if (
		isAgentBusy &&
		props.sessionId &&
		(inputState.message.trim() || inputState.attachments.length > 0)
	) {
		const result = prepareMessageForSend(
			inputState.message,
			inputState.inlineTextMap,
			inputState.attachments
		);
		if (result.isErr()) return;
		const accepted = messageQueueStore.enqueue(
			props.sessionId,
			result.value.content,
			result.value.imageAttachments
		);
		if (!accepted) return;
		// Only clear input after successful enqueue
		inputState.message = "";
		inputState.clearAttachments();
		inputState.clearInlineTextMap();
		clearDraft();
		return;
	}

	logger.info("handleSend: preparing send", {
		panelId: props.panelId,
		sessionId: props.sessionId ?? null,
		hasMessage: inputState.message.trim().length > 0,
		attachmentCount: inputState.attachments.length,
		isStreaming,
		isAgentBusy,
		t0_ms: Math.round(t0),
	});
	isSending = true;

	// Capture and clear input before async work
	const prepared = captureAndClearInput();
	if (!prepared) {
		isSending = false;
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
		inputState.message = "";
	}
	props.onWillSend?.();
	logger.info("[first-send-trace] prepared input", {
		panelId: props.panelId ?? null,
		sessionId: props.sessionId ?? null,
		projectPath: props.projectPath ?? null,
		worktreePath: props.worktreePath ?? null,
		worktreePending: props.worktreePending ?? false,
		selectedAgentId: props.selectedAgentId ?? null,
		contentLength: prepared.content.length,
		t_ms: Math.round(performance.now() - t0),
	});

	if (props.panelId && !props.sessionId) {
		logger.info("[first-send-trace] setting optimistic pending entry", {
			panelId: props.panelId,
			preview: prepared.content.slice(0, 120),
			t_ms: Math.round(performance.now() - t0),
		});
		panelStore.setPendingUserEntry(props.panelId, createPendingUserEntry(prepared.content));
	}

	// When worktree toggle is pending, create worktree first (need the path), then run setup in background
	let worktreePathForSend: string | undefined = props.worktreePath ?? undefined;
	if (!worktreePathForSend && props.worktreePending && props.projectPath) {
		if (props.panelId) {
			panelStore.setPendingWorktreeSetup(props.panelId, {
				projectPath: props.projectPath,
				worktreePath: null,
				phase: "creating-worktree",
			});
		}
		props.onWorktreeCreating?.();
		logger.info("[worktree-flow] handleSend: creating worktree before send", {
			projectPath: props.projectPath,
			panelId: props.panelId ?? null,
			t_ms: Math.round(performance.now() - t0),
		});
		const createResult = await tauriClient.git.worktreeCreate(props.projectPath);
		if (createResult.isOk()) {
			const info = createResult.value;
			worktreePathForSend = info.directory;
			if (props.panelId) {
				panelStore.setPendingWorktreeSetup(props.panelId, {
					projectPath: props.projectPath,
					worktreePath: info.directory,
					phase: "running",
				});
			}
			logger.info("[first-send-trace] worktree created", {
				panelId: props.panelId ?? null,
				projectPath: props.projectPath,
				worktreePathForSend,
				t_ms: Math.round(performance.now() - t0),
			});
			props.onWorktreeCreated?.(info.directory);
			// Run setup in background — don't block the message send
			void runWorktreeSetup({
				projectPath: props.projectPath!,
				worktreeCwd: info.directory,
			}).match(
				(result) => {
					if (!result.setupSuccess) toast.warning(m.settings_worktree_setup_failed());
				},
				(error) => {
					logger.warn("Worktree setup failed", { error });
					toast.warning(m.settings_worktree_setup_failed());
				}
			);
		} else {
			if (props.panelId) {
				panelStore.clearPendingWorktreeSetup(props.panelId);
			}
			logger.warn("Worktree creation failed", { error: createResult.error });
			toast.error(m.worktree_create_failed());
		}
	}

	logger.info("[worktree-flow] handleSend: dispatching normal send", {
		panelId: props.panelId,
		sessionId: props.sessionId ?? null,
		worktreePathForSend: worktreePathForSend ?? null,
		propsWorktreePath: props.worktreePath ?? null,
		propsProjectPath: props.projectPath ?? null,
		pendingEntryPresent: props.panelId
			? panelStore.getHotState(props.panelId).pendingUserEntry !== null
			: false,
		elapsed_ms: Math.round(performance.now() - t0),
	});
	logger.info("[worktree-debug] handleSend payload", {
		panelId: props.panelId ?? null,
		sessionId: props.sessionId ?? null,
		projectPath: props.projectPath ?? null,
		projectName: props.projectName ?? null,
		selectedAgentId: props.selectedAgentId ?? null,
		propsWorktreePath: props.worktreePath ?? null,
		worktreePending: props.worktreePending ?? false,
		worktreePathForSend: worktreePathForSend ?? null,
	});
	inputState
		.sendPreparedMessage({
			content: prepared.content,
			panelId: props.panelId,
			sessionId: props.sessionId,
			selectedAgentId: props.selectedAgentId,
			projectPath: props.projectPath,
			projectName: props.projectName,
			onSessionCreated: props.onSessionCreated,
			worktreePath: worktreePathForSend,
			imageAttachments: prepared.imageAttachments,
		})
		.map(() => {
			logger.info("handleSend: sendMessage resolved", {
				elapsed_ms: Math.round(performance.now() - t0),
			});
			// Existing panels persist drafts in PanelStore and need explicit clearing.
			// Empty-state send has no draft persistence and clearing here reintroduces
			// the just-sent message into the newly mounted panel input.
			if (props.panelId) {
				clearDraft();
			}
		})
		.mapErr(() => {
			if (props.panelId) {
				panelStore.clearPendingWorktreeSetup(props.panelId);
			}
			if (shouldClearDraftEarly && props.panelId) {
				panelStore.setMessageDraft(props.panelId, prepared.content);
			}
			// Error is logged in the state class
		})
		.match(
			() => undefined,
			() => undefined
		)
		.finally(() => {
			isSending = false;
		});
}

// Handle steer: cancel current streaming + send immediately
function handleSteer() {
	const sessionId = props.sessionId;
	if (!sessionId || (!inputState.message.trim() && inputState.attachments.length === 0)) return;
	logger.info("handleSteer: preparing steer send", {
		panelId: props.panelId,
		sessionId,
	});
	props.onWillSend?.();

	const prepared = captureAndClearInput();
	if (!prepared) return;
	clearDraft();

	sessionStore
		.cancelStreaming(sessionId)
		.andThen(() => sessionStore.sendMessage(sessionId, prepared.content, prepared.imageAttachments))
		.mapErr((error) => {
			console.error("Steer failed:", error);
			return error;
		});
}

function handlePrimaryButtonClick(): void {
	if (primaryButtonIntent === "steer") {
		handleSteer();
		return;
	}
	if (primaryButtonIntent === "send") {
		void handleSend();
		return;
	}
	if (isStreaming) {
		void handleCancel();
	}
}

// Handle mode change
async function handleModeChange(modeId: string) {
	if (props.sessionId) {
		await sessionStore.setMode(props.sessionId, modeId);
		return;
	}
	provisionalModeId = modeId;
}

// Handle model change
async function handleModelChange(modelId: string) {
	if (props.sessionId) {
		await sessionStore.setModel(props.sessionId, modelId);
		return;
	}
	provisionalModelId = modelId;
}

function cycleModeOnTab(event: KeyboardEvent): boolean {
	if (event.key !== "Tab" || event.shiftKey || visibleModes.length === 0) {
		return false;
	}

	event.preventDefault();
	const currentIndex = visibleModes.findIndex((m) => m.id === effectiveCurrentModeId);
	const nextIndex =
		currentIndex === -1 ? 1 % visibleModes.length : (currentIndex + 1) % visibleModes.length;
	const nextMode = visibleModes[nextIndex];
	if (nextMode && nextMode.id !== effectiveCurrentModeId) {
		handleModeChange(nextMode.id);
	}
	return true;
}

function shouldUseVoiceHoldKey(event: KeyboardEvent): boolean {
	const currentVoiceState = voiceState;
	if (!shouldStartVoiceHold(event)) {
		return false;
	}
	if (!voiceEnabled || currentVoiceState === null || isSending || isStreaming) {
		return false;
	}
	return currentVoiceState.phase === "idle";
}

function handleEditorKeyDown(event: KeyboardEvent): void {
	if (inputState.showFileDropdown && inputState.fileDropdownRef?.handleKeyDown(event)) {
		return;
	}
	if (isSlashDropdownVisible && inputState.slashDropdownRef?.handleKeyDown(event)) {
		return;
	}

	const currentVoiceState = voiceState;
	if (currentVoiceState !== null && shouldUseVoiceHoldKey(event)) {
		event.preventDefault();
		currentVoiceState.onKeyboardHoldStart();
		return;
	}

	const submitIntent: SubmitIntent = resolveEnterKeyIntent({
		hasDraftInput,
		isAgentBusy,
		shiftKey: event.shiftKey,
		metaKey: event.metaKey,
		ctrlKey: event.ctrlKey,
	});

	if (event.key === "Enter" && submitIntent === "steer") {
		event.preventDefault();
		handleSteer();
		return;
	}

	if (event.key === "Enter" && submitIntent === "send") {
		event.preventDefault();
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
	kb.setContext("inputFocused", true);
}

function handleEditorBlur(): void {
	kb.setContext("inputFocused", false);
}

function handleCommandSelect(command: AvailableCommand): void {
	if (!editorRef) {
		return;
	}
	const cursorPos = getSerializedCursorOffset(editorRef);
	const before = inputState.message.substring(0, inputState.slashStartIndex);
	const after = inputState.message.substring(cursorPos);
	const tokenText = toInlineTokenText(slashCommandSource.tokenType, `/${command.name}`);
	inputState.message = `${before}${tokenText} ${after}`;
	inputState.showSlashDropdown = false;
	inputState.slashQuery = "";
	syncEditorFromMessage(before.length + tokenText.length + 1);
	handleEditorInput();
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
		const result = await createImageAttachment(file, item.type);
		if (result.isErr()) {
			if (result.error.kind === "too_large") {
				toast.error(m.image_too_large());
			}
			continue;
		}
		inputState.addAttachment(result.value);
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

// Handle cancel streaming
async function handleCancel() {
	if (props.sessionId) {
		const result = await sessionStore.cancelStreaming(props.sessionId);
		if (result.isErr()) {
			console.error("Failed to cancel streaming:", result.error);
		}
	}
}
</script>

<div
	bind:this={inputState.containerRef}
	role="region"
	aria-label="Message input with file drop zone"
	ondrop={(e) => inputState.handleDrop(e)}
	ondragover={(e) => inputState.handleDragOver(e)}
	ondragleave={(e) => {
		// Only trigger leave if we're leaving the container entirely
		const relatedTarget = e.relatedTarget as Node | null;
		if (!e.currentTarget.contains(relatedTarget)) {
			inputState.handleDragLeave();
		}
	}}
>
	{#if inputState.isDragOver}
		<div
			class="flex-shrink-0 p-3 rounded-xl border border-dashed transition-all duration-150 {inputState.isDragHovering
				? 'border-foreground/40 bg-input/50'
				: 'border-border bg-input/30'}"
		>
			<div class="flex flex-col items-center justify-center gap-2 min-h-[80px]">
				<div
					class="p-2.5 rounded-lg transition-colors duration-150 {inputState.isDragHovering
						? 'bg-foreground/10'
						: 'bg-muted'}"
				>
					<ImageSquare
						class="h-5 w-5 transition-colors duration-150 {inputState.isDragHovering
							? 'text-foreground'
							: 'text-muted-foreground'}"
						weight="duotone"
					/>
				</div>
				<span
					class="text-sm transition-colors duration-150 {inputState.isDragHovering
						? 'text-foreground'
						: 'text-muted-foreground'}">Drop image to attach</span
				>
			</div>
		</div>
	{:else}
		<InputContainer class="flex-shrink-0 border border-border" contentClass={voiceOverlayActive ? "relative" : "p-2"}>
			{#snippet content()}
				{#if voiceState !== null && voiceOverlayActive}
					<VoiceRecordingOverlay voiceState={voiceState} />
				{:else if inputReady}
					{#if inputState.attachments.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each inputState.attachments as attachment (attachment.id)}
								<ArtefactBadge
									{attachment}
									onRemove={() => inputState.removeAttachment(attachment.id)}
								/>
							{/each}
						</div>
					{/if}
					<div class="relative min-w-0">
						<!-- Embedded submit button: top-right -->
						<div class="absolute top-0 right-0 flex items-center gap-2 z-10">
							<Tooltip.Root>
								<Tooltip.Trigger>
									{#snippet child({ props: triggerProps })}
									<Button
										{...triggerProps}
										type="button"
										size="icon"
										onclick={handlePrimaryButtonClick}
										disabled={isSending ||
											(primaryButtonIntent !== "steer" &&
												(isSubmitDisabled ||
													(!inputState.message.trim() && inputState.attachments.length === 0)))}
										class="h-7 w-7 cursor-pointer shrink-0 rounded-md"
										style="background-color: {buttonColor};"
									>
										{#if primaryButtonIntent === "steer" || (isStreaming && !hasDraftInput)}
											<Stop weight="fill" class="h-3.5 w-3.5" />
											<span class="sr-only">{m.agent_input_interrupt()}</span>
										{:else}
											<IconArrowUp class="h-3.5 w-3.5" />
											<span class="sr-only">{isAgentBusy ? m.agent_input_queue_message() : m.agent_input_send_message()}</span>
										{/if}
									</Button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content>
									{#if isAgentBusy && inputState.message.trim()}
										<div class="flex items-center gap-3">
											<div class="flex items-center gap-1.5">
												<span>{m.agent_input_queue_message()}</span>
												<KbdGroup><Kbd>Enter</Kbd></KbdGroup>
											</div>
										<div class="flex items-center gap-1.5">
											<span>{m.agent_input_interrupt()}</span>
											<KbdGroup><Kbd>Shift</Kbd><Kbd>Enter</Kbd></KbdGroup>
										</div>
										</div>
									{:else}
										<div class="flex items-center gap-2">
											<span
												>{isStreaming
													? m.agent_input_stop_streaming()
													: m.agent_input_send_message()}</span
											>
											{#if !isStreaming}
												<KbdGroup><Kbd>Enter</Kbd></KbdGroup>
											{/if}
										</div>
									{/if}
								</Tooltip.Content>
							</Tooltip.Root>
						</div>
						<div class="relative flex-1 min-w-0 pr-12">
							<!-- svelte-ignore a11y_mouse_events_have_key_events -->
							<div
								bind:this={editorRef}
								role="textbox"
								aria-multiline="true"
								aria-label={m.agent_input_placeholder()}
								tabindex="0"
								contenteditable="true"
								autocapitalize="off"
								spellcheck={false}
							class="min-h-[72px] max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground outline-none"
							onbeforeinput={handleEditorBeforeInput}
							oninput={() => handleEditorInput()}
								onkeydown={handleEditorKeyDown}
								onkeyup={handleEditorKeyUp}
								onfocus={handleEditorFocus}
								onblur={handleEditorBlur}
								onclick={handleEditorClick}
							onmouseover={handleEditorMouseOver}
								onmouseout={handleEditorMouseOut}
								onpaste={(event) => handleEditorPaste(event)}
								oncut={handleEditorCut}
							></div>
							{#if overlayMode && overlayRefId && overlayAnchorRect}
								{@const overlayText = inputState.getInlineTextReferenceContent(overlayRefId) ?? ""}
								<PastedTextOverlay
									mode={overlayMode}
									refId={overlayRefId}
									anchorRect={overlayAnchorRect}
									textContent={overlayText}
									onSave={handleOverlaySave}
									onClose={closeOverlay}
									onMouseEnter={cancelOverlayClose}
								/>
							{/if}
							{#if inputState.message.length === 0}
								<div
									class="pointer-events-none absolute left-0 top-0 text-sm leading-relaxed text-muted-foreground select-none"
								>
									{m.agent_input_placeholder()}
								</div>
							{/if}
						</div>
					</div>
				{:else}
					<div class="flex items-center gap-2">
						<div class="flex-1 flex flex-col gap-2">
							<Skeleton class="h-4 w-3/4" />
							<Skeleton class="h-4 w-1/2" />
						</div>
						<Skeleton class="h-8 w-8 rounded-full shrink-0" />
					</div>
				{/if}
				<SlashCommandDropdown
					bind:this={inputState.slashDropdownRef}
					commands={effectiveAvailableCommands}
					isOpen={isSlashDropdownVisible}
					query={inputState.slashQuery}
					position={inputState.slashPosition}
					onSelect={(cmd: AvailableCommand) => handleCommandSelect(cmd)}
					onClose={() => inputState.handleDropdownClose()}
				/>
				<FilePickerDropdown
					bind:this={inputState.fileDropdownRef}
					files={inputState.availableFiles}
					isOpen={inputState.showFileDropdown}
					isLoading={inputState.filesLoading}
					query={inputState.fileQuery}
					position={inputState.filePosition}
					projectPath={props.projectPath ?? ""}
					onSelect={(file) => handleFileSelect(file)}
					onClose={() => inputState.handleFileDropdownClose()}
				/>
			{/snippet}
		{#snippet footer()}
			{#if inputReady}
				{@const currentVoiceState = voiceState}
				{@const isVoiceRecordingUi = currentVoiceState !== null && (currentVoiceState.phase === "checking_permission" || currentVoiceState.phase === "recording")}
				{@const isVoiceActive = currentVoiceState !== null && currentVoiceState.phase !== "idle" && currentVoiceState.phase !== "error"}
				<!-- Normal toolbar: fades out during recording -->
				<div
					class="flex items-center h-7 transition-opacity duration-200 ease-out"
					class:opacity-0={isVoiceRecordingUi}
					class:pointer-events-none={isVoiceRecordingUi}
				>
					{#if visibleModes.length > 0}
						<ModeSelector
							availableModes={visibleModes}
							currentModeId={effectiveCurrentModeId}
							onModeChange={handleModeChange}
							panelId={props.panelId}
						/>
						<div class="h-full w-px bg-border/50"></div>
					{:else if selectorsLoading}
						<Skeleton class="h-7 w-7" />
						<div class="h-full w-px bg-border/50"></div>
					{/if}
					<ModelSelector
						availableModels={effectiveAvailableModels}
						currentModelId={effectiveCurrentModelId}
						modelsDisplay={sessionCapabilities?.modelsDisplay ?? cachedModelsDisplay}
						onModelChange={handleModelChange}
						isLoading={selectorsLoading}
						panelId={props.panelId}
					/>
					{#if props.agentProjectPicker}
						<div class="h-full w-px bg-border/50"></div>
						{@render props.agentProjectPicker()}
					{/if}
					<div class="h-full w-px bg-border/50"></div>
				</div>

				<!-- Right side: recording visualization OR normal controls -->
				<div class="flex items-center h-7 ml-auto">
					{#if currentVoiceState !== null && isVoiceRecordingUi}
						<div class="voice-recording-bar flex items-center pr-0.5">
							{#if currentVoiceState.recordingElapsedLabel}
								<span class="mr-2 font-mono text-[10px] text-muted-foreground tabular-nums">
									{currentVoiceState.recordingElapsedLabel}
								</span>
							{/if}
							<MicButton
								voiceState={currentVoiceState}
								disabled={isStreaming || isSending}
							/>
						</div>
					{:else}
						<!-- Normal right-side controls -->
						<div
							class="flex items-center gap-1.5 transition-opacity duration-200 ease-out"
							class:opacity-0={isVoiceActive}
							class:pointer-events-none={isVoiceActive}
						>
							{#if props.sessionId}
								<ModelSelectorMetricsChip
									sessionId={props.sessionId}
									agentId={capabilitiesAgentId}
								/>
							{/if}
							{#if props.checkpointButton}
								{@render props.checkpointButton()}
							{/if}
						</div>
						{#if currentVoiceState !== null && voiceEnabled}
							{#if currentVoiceState.phase === "error"}
								<button
									type="button"
									class="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline mr-1"
									onclick={() => currentVoiceState.dismissError()}
								>
									{m.common_close()}
								</button>
							{/if}
							<div class="voice-controls flex items-center">
								<VoiceModelMenu {voiceSettingsStore} />
								<MicButton
									voiceState={currentVoiceState}
									disabled={isStreaming || isSending}
								/>
							</div>
						{/if}
					{/if}
				</div>
			{/if}
		{/snippet}
		</InputContainer>
	{/if}
</div>

<style>
	/* Voice recording bar: fade-in when entering recording state */
	.voice-recording-bar {
		animation: voice-bar-enter 180ms ease-out;
	}

	@keyframes voice-bar-enter {
		from {
			opacity: 0;
			transform: translateX(8px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	/* Individual meter bars: GPU-accelerated smooth height transition */
	.voice-bar {
		transition: height 130ms cubic-bezier(0.2, 0.9, 0.2, 1), opacity 130ms ease-out;
		will-change: height;
	}

	/* Meter container */
	.voice-meter {
		min-width: 16px;
	}
</style>
