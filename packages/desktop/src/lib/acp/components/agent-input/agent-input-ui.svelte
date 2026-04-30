<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { toast } from "svelte-sonner";
import { getKeybindingsService, isMac } from "$lib/keybindings/index.js";
import { getPreconnectionAgentSkillsStore } from "$lib/skills/store/preconnection-agent-skills-store.svelte.js";
import { getVoiceSettingsStore } from "$lib/stores/voice-settings-store.svelte.js";
import {
	AgentInputComposerToolbar,
	AgentPanelComposer as SharedAgentPanelComposer,
	type AgentInputConfigOption,
} from "@acepe/ui/agent-panel";
import * as agentModelPrefs from "../../store/agent-model-preferences-store.svelte.js";
import { getConnectionStore } from "../../store/connection-store.svelte.js";
import {
	getAgentStore,
	getMessageQueueStore,
	getPanelStore,
	getPermissionStore,
	getSessionStore,
} from "../../store/index.js";
import type { AvailableCommand } from "../../types/available-command.js";
import { CanonicalModeId } from "../../types/canonical-mode-id.js";
import { createLogger } from "../../utils/logger.js";
import { filterVisibleModes } from "../../utils/mode-filter.js";
import { resolvePanelDraftOnMount } from "./services/index.js";
import AgentInputComposerBody from "./components/agent-input-composer-body.svelte";
import AgentInputDropZone from "./components/agent-input-drop-zone.svelte";
import { decodeInlineTextTokenValue, truncateHoverPreview } from "./logic/inline-token-preview.js";
import { handleVoiceMicKeyDown as handleVoiceMicKeyDownFromModule } from "./logic/voice-mic-keyboard.js";
import { resolveVoiceMicTooltip } from "./logic/voice-mic-labels.js";
import { toVoiceToolbarBinding } from "./logic/voice-toolbar-binding.js";
import { ModelSelector } from "../index.js";
import ModelSelectorMetricsChip from "../model-selector.metrics-chip.svelte";
import { getEffectiveFilePickerProjectPath } from "./logic/file-picker-context.js";
import { VoiceInputState } from "./state/voice-input-state.svelte.js";
import { canStartVoiceInteraction, shouldShowVoiceOverlay } from "./logic/voice-ui-state.js";
import { createImageAttachment, isImageMimeType } from "./logic/image-attachment.js";
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
import {
	resolveSlashCommandSource,
	shouldShowSlashCommandDropdown,
} from "./logic/slash-command-source.js";
import { resolveCapabilitySource } from "./logic/capability-source.js";
import { PreconnectionCapabilitiesState } from "./logic/preconnection-capabilities-state.svelte.js";
import { PreconnectionRemoteCommandsState } from "./logic/preconnection-remote-commands-state.svelte.js";
import { type SubmitIntent } from "../../logic/submit-intent.js";
import {
	deriveComposerInteractionState,
	resolveComposerEnterKeyIntent,
} from "../../logic/composer-ui-state.js";
import {
	resolvePendingToolbarSelections,
	resolveToolbarModeId,
	resolveToolbarModelId,
} from "./logic/toolbar-state.js";
import { resolveModeMenuAction, resolveSelectedModeMenuOptionId } from "./logic/mode-menu-state.js";
import { resolveAutonomousSupport } from "./logic/autonomous-support.js";
import { getToolbarConfigOptions } from "./logic/toolbar-config-options.js";
import { normalizeVoiceInputText } from "./logic/voice-input-text.js";
import {
	shouldRouteWindowVoiceHold,
	shouldStartVoiceHold,
	shouldStopVoiceHold,
	shouldSyncPanelFocusOnEditorFocus,
} from "./logic/voice-keyboard.js";
import { shouldInterruptComposerStream } from "./logic/interrupt-shortcut.js";
import { resolveVoiceStateLifecycle } from "./logic/voice-state-lifecycle.js";
import { createAgentInputController } from "./agent-input-controller.js";
import { AgentInputState } from "./state/agent-input-state.svelte.js";
import type { Attachment } from "./types/attachment.js";
import type { AgentInputProps } from "./types/agent-input-props.js";
import { hasToolbarCapabilityData, resolveSelectorsLoading } from "./logic/toolbar-loading.js";

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
const filePickerProjectPath = $derived(
	getEffectiveFilePickerProjectPath(props.projectPath, props.worktreePath)
);

// Create state instance with reactive project path getter
const inputState = new AgentInputState(sessionStore, panelStore, () => filePickerProjectPath);

let voiceState: VoiceInputState | null = $state(null);
let voiceStateSessionId: string | null = $state(null);
let voiceStatePendingSessionId: string | null = $state(null);
let voiceStateInitGeneration = 0;
/** Cursor offset captured before voice overlay hides the editor. */
let voiceCursorSnapshot: number | null = null;
let autonomousStatusMessage = $state("");
const voiceEnabled = $derived(voiceSettingsStore.enabled);
const voiceToolbarBinding = $derived.by(() => {
	const base = toVoiceToolbarBinding(voiceState);
	if (!base) return null;
	return {
		phase: base.phase,
		recordingElapsedLabel: base.recordingElapsedLabel,
		downloadPercent: base.downloadPercent,
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

const panelHotState = $derived(props.panelId ? panelStore.getHotState(props.panelId) : null);

// Resolve capabilities agent from selected agent, then fall back to the session's agent.
const sessionIdentity = $derived(
	props.sessionId ? sessionStore.getSessionIdentity(props.sessionId) : null
);
const capabilitiesAgentId = $derived.by(() => {
	if (props.sessionId) {
		if (sessionIdentity) {
			return sessionIdentity.agentId;
		}

		return props.selectedAgentId ? props.selectedAgentId : null;
	}

	if (props.selectedAgentId) {
		return props.selectedAgentId;
	}

	return sessionIdentity ? sessionIdentity.agentId : null;
});

// Get capabilities from session store when we have a session
const sessionCapabilities = $derived(
	props.sessionId ? sessionStore.getSessionCapabilities(props.sessionId) : null
);
const capabilitiesAgent = $derived.by(() => {
	if (!capabilitiesAgentId) {
		return null;
	}

	for (const agent of agentStore.agents) {
		if (agent.id === capabilitiesAgentId) {
			return agent;
		}
	}

	return null;
});
const capabilitiesProviderMetadata = $derived.by(() => {
	if (sessionCapabilities?.providerMetadata) {
		return sessionCapabilities.providerMetadata;
	}

	if (capabilitiesAgent) {
		return capabilitiesAgent.providerMetadata;
	}

	return null;
});
const preconnectionCapabilities = $derived.by(() =>
	preconnectionCapabilitiesState.getCapabilities({
		agentId: capabilitiesAgentId,
		projectPath: filePickerProjectPath,
		preconnectionCapabilityMode:
			capabilitiesProviderMetadata?.preconnectionCapabilityMode ?? "unsupported",
	})
);

// Local transient affordances only; capability truth comes from canonical accessors below.
const sessionHotState = $derived(
	props.sessionId ? sessionStore.getHotState(props.sessionId) : null
);
const sessionRuntimeState = $derived(
	props.sessionId ? sessionStore.getSessionRuntimeState(props.sessionId) : null
);
const storeComposerState = $derived(
	props.sessionId ? sessionStore.getStoreComposerState(props.sessionId) : null
);
const sessionCurrentModeId = $derived(
	props.sessionId ? sessionStore.getSessionCurrentModeId(props.sessionId) : null
);
const sessionCurrentModelId = $derived(
	props.sessionId ? sessionStore.getSessionCurrentModelId(props.sessionId) : null
);
const sessionAutonomousEnabled = $derived(
	props.sessionId ? sessionStore.getSessionAutonomousEnabled(props.sessionId) : false
);
const sessionConfigOptions = $derived(
	props.sessionId ? sessionStore.getSessionConfigOptions(props.sessionId) : []
);
const sessionAvailableCommands = $derived(
	props.sessionId ? sessionStore.getSessionAvailableCommands(props.sessionId) : []
);

let previousComposerBindSessionId: string | null = null;
$effect(() => {
	const sessionId = props.sessionId;
	if (!sessionId) {
		previousComposerBindSessionId = null;
		return;
	}
	if (sessionId === previousComposerBindSessionId) {
		return;
	}
	previousComposerBindSessionId = sessionId;
	sessionStore.bindComposerSession(sessionId);
});

let provisionalModeId = $state<string | null>(props.initialModeId ?? null);
let provisionalModelId = $state<string | null>(null);

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

const capabilitySource = $derived.by(() =>
	resolveCapabilitySource({
		sessionCapabilities,
		preconnectionCapabilities,
		cachedModes,
		cachedModels,
		cachedModelsDisplay,
		providerMetadata: capabilitiesProviderMetadata ?? null,
	})
);
const effectiveCapabilityProviderMetadata = $derived(
	capabilitySource.providerMetadata ?? capabilitiesProviderMetadata
);
const effectiveAvailableModes = $derived(capabilitySource.availableModes);

// Filter to only show Build and Plan modes in the UI
const visibleModes = $derived(filterVisibleModes(effectiveAvailableModes));

const effectiveComposerProvisionalModeId = $derived(
	props.sessionId ? (storeComposerState?.provisionalModeId ?? null) : provisionalModeId
);
const effectiveComposerProvisionalModelId = $derived(
	props.sessionId ? (storeComposerState?.provisionalModelId ?? null) : provisionalModelId
);

const effectiveCurrentModeId = $derived.by(() =>
	resolveToolbarModeId({
		liveCurrentModeId: sessionCurrentModeId,
		provisionalModeId: effectiveComposerProvisionalModeId,
		visibleModes,
	})
);

const autoModeSupportState = $derived.by(() =>
	resolveAutonomousSupport({
		agentId: capabilitiesAgentId,
		connectionPhase: sessionRuntimeState ? sessionRuntimeState.connectionPhase : null,
		currentUiModeId: CanonicalModeId.BUILD,
		agents: agentStore.agents,
	})
);

const panelProvisionalAutonomousEnabled = $derived.by(() => {
	if (props.panelId) {
		return panelStore.getHotState(props.panelId).provisionalAutonomousEnabled;
	}

	return false;
});

const autonomousToggleActive = $derived.by(() => {
	if (props.sessionId) {
		const cs = storeComposerState;
		if (cs && cs.provisionalAutonomousEnabled !== null) {
			return cs.provisionalAutonomousEnabled;
		}
		return sessionAutonomousEnabled;
	}
	return panelProvisionalAutonomousEnabled;
});

const autonomousToggleBusy = $derived(
	sessionHotState ? sessionHotState.autonomousTransition !== "idle" : false
);

const autoModeDisabled = $derived(autonomousToggleBusy || !autoModeSupportState.supported);
const autoModeDisabledReason = $derived.by(() => {
	if (autoModeSupportState.disabledReason === "unsupported-agent") {
		return "This agent does not support Auto.";
	}

	if (autoModeSupportState.disabledReason === "unsupported-mode") {
		return "Auto is unavailable for this agent.";
	}

	if (autonomousToggleBusy) {
		return "Updating Auto…";
	}

	return null;
});
const selectedModeMenuOptionId = $derived(
	resolveSelectedModeMenuOptionId({
		currentModeId: effectiveCurrentModeId,
		autonomousEnabled: autonomousToggleActive,
	})
);

const effectiveAvailableModels = $derived(capabilitySource.availableModels);
const effectiveModelsDisplay = $derived(capabilitySource.modelsDisplay);

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
		liveCurrentModelId: sessionCurrentModelId,
		provisionalModelId: effectiveComposerProvisionalModelId,
		availableModels: effectiveAvailableModels,
		preferredDefaultModelId,
	})
);

const toolbarConfigOptions = $derived.by((): AgentInputConfigOption[] => {
	if (sessionConfigOptions.length === 0) {
		return [];
	}

	return getToolbarConfigOptions(sessionConfigOptions, effectiveAvailableModels).map(
		(option): AgentInputConfigOption => {
			const raw = option.currentValue;
			const currentValue: string | number | boolean | null =
				raw === null || raw === undefined
					? null
					: typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
						? raw
						: null;
			const options = option.options?.flatMap(
				(opt): { value: string | number | boolean; name: string }[] => {
					const v = opt.value;
					if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
						return [{ value: v, name: opt.name }];
					}
					return [];
				}
			);
			return {
				id: option.id,
				name: option.name,
				category: option.category,
				type: option.type,
				currentValue,
				options,
			};
		}
	);
});

const liveAvailableCommands = $derived.by(() => {
	if (sessionAvailableCommands.length > 0) {
		return sessionAvailableCommands;
	}

	return [];
});
const preconnectionAvailableCommands = $derived.by(() => {
	if (!capabilitiesAgentId) {
		return [];
	}

	return preconnectionRemoteCommandsState.getCommands({
		agentId: capabilitiesAgentId,
		projectPath: filePickerProjectPath,
		preconnectionSlashMode:
			effectiveCapabilityProviderMetadata?.preconnectionSlashMode ?? "unsupported",
		skillCommands: preconnectionAgentSkillsStore.getCommandsForAgent(capabilitiesAgentId),
	});
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
const isSlashDropdownVisible = $derived.by(() =>
	shouldShowSlashCommandDropdown({
		isTriggerActive: inputState.showSlashDropdown,
		source: slashCommandSource,
		capabilitiesAgentId,
	})
);

// Input is ready when we have a session or project path (loading state no longer blocks input)
const inputReady = $derived(Boolean(props.sessionId) || Boolean(filePickerProjectPath));

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
	hasToolbarCapabilityData({
		visibleModesCount: visibleModes.length,
		availableModelsCount: effectiveAvailableModels.length,
		modelsDisplay: effectiveModelsDisplay,
	})
);
const selectorsLoading = $derived.by(() =>
	resolveSelectorsLoading({
		hasSession,
		isSessionConnecting,
		hasSelectedAgent: Boolean(capabilitiesAgentId),
		visibleModesCount: visibleModes.length,
		availableModelsCount: effectiveAvailableModels.length,
		modelsDisplay: effectiveModelsDisplay,
		isCacheLoaded: agentModelPrefs.isCacheLoaded(),
		isPreconnectionLoading: preconnectionCapabilitiesState.isLoading({
			agentId: capabilitiesAgentId,
			projectPath: filePickerProjectPath,
			preconnectionCapabilityMode:
				effectiveCapabilityProviderMetadata?.preconnectionCapabilityMode ?? "unsupported",
		}),
	})
);

$effect(() => {
	const hasConnectedSession = sessionRuntimeState?.connectionPhase === "connected";
	preconnectionCapabilitiesState
		.ensureLoaded({
			agentId: capabilitiesAgentId,
			hasConnectedSession,
			projectPath: filePickerProjectPath,
			preconnectionCapabilityMode:
				effectiveCapabilityProviderMetadata?.preconnectionCapabilityMode ?? "unsupported",
		})
		.mapErr((error) => {
			logger.error("Failed to warm preconnection capabilities", {
				agentId: capabilitiesAgentId,
				projectPath: filePickerProjectPath,
				error: error.message,
			});
			return undefined;
		});
});

$effect(() => {
	const sessionId = props.sessionId;
	if (!sessionId || isApplyingProvisionalToolbarSelections) {
		return;
	}
	if (sessionRuntimeState?.connectionPhase !== "connected") {
		return;
	}

	const cs = sessionStore.getStoreComposerState(sessionId);
	const provMode = cs?.provisionalModeId ?? null;
	const provModel = cs?.provisionalModelId ?? null;

	const resolution = resolvePendingToolbarSelections({
		provisionalModeId: provMode,
		provisionalModelId: provModel,
		liveCurrentModeId: sessionCurrentModeId,
		liveCurrentModelId: sessionCurrentModelId,
		availableModes: visibleModes,
		availableModels: effectiveAvailableModels,
	});

	const liveModeId = sessionCurrentModeId;
	const liveModelId = sessionCurrentModelId;

	if (!resolution.modeIdToApply && !resolution.modelIdToApply) {
		return;
	}

	isApplyingProvisionalToolbarSelections = true;

	const run = async () => {
		const autonomousForBegin =
			cs?.provisionalAutonomousEnabled ?? sessionAutonomousEnabled;
		await sessionStore.runComposerConfigOperation(
			sessionId,
			{
				provisionalModeId: resolution.modeIdToApply ?? provMode ?? liveModeId,
				provisionalModelId: resolution.modelIdToApply ?? provModel ?? liveModelId,
				provisionalAutonomousEnabled: autonomousForBegin,
			},
			async () => {
				if (resolution.modeIdToApply) {
					const modeResult = await sessionStore.setMode(sessionId, resolution.modeIdToApply);
					if (modeResult.isErr()) {
						return false;
					}
				}

				if (resolution.modelIdToApply) {
					const modelResult = await sessionStore.setModel(sessionId, resolution.modelIdToApply);
					if (modelResult.isErr()) {
						return false;
					}
				}
				return true;
			}
		);
	};

	void run().finally(() => {
		isApplyingProvisionalToolbarSelections = false;
	});
});

// Stop/cancel state from canonical runtime contract.
const isStreaming = $derived(
	props.sessionShowStop ?? sessionRuntimeState?.showStop ?? props.sessionIsStreaming ?? false
);

// Queue while the runtime contract still allows cancellation.
// That covers both streaming and the awaiting-response gap used by OpenCode.
const isAgentBusy = $derived(
	props.sessionShowStop ?? sessionRuntimeState?.canCancel ?? false
);
const hasDraftInput = $derived(
	inputState.message.trim().length > 0 || inputState.attachments.length > 0
);

const selectorsDisabledByComposer = $derived(storeComposerState?.selectorsDisabled ?? false);

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
let isShiftPressed = $state(false);
let isApplyingProvisionalToolbarSelections = $state(false);
let editorRef: HTMLDivElement | null = $state(null);
let overlayMode: "preview" | "edit" | null = $state(null);
let overlayRefId: string | null = $state(null);
let overlayAnchorRect: DOMRect | null = $state(null);

const composerInteraction = $derived.by(() => {
	const hasBlocking = storeComposerState?.isBlocked ?? false;
	const isDispatching = storeComposerState?.isDispatching ?? false;
	return deriveComposerInteractionState({
		hasDraftInput,
		hasSessionId: !!props.sessionId,
		isAgentBusy,
		isStreaming,
		isShiftPressed,
		isSubmitDisabled,
		hasBlockingComposerConfig: hasBlocking,
		isComposerDispatching: isDispatching,
	});
});
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
			node.setAttribute("title", truncateHoverPreview(decoded ?? "Pasted text"));
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

async function handleCancel() {
	if (props.sessionId) {
		const result = await sessionStore.cancelStreaming(props.sessionId);
		if (result.isErr()) {
			console.error("Failed to cancel streaming:", result.error);
		}
	}
}

const agentInputController = createAgentInputController({
	getProps: () => props,
	inputState,
	getComposerInteraction: () => composerInteraction,
	getAutonomousToggleActive: () => autonomousToggleActive,
	getProvisionalModeId: () => provisionalModeId,
	getProvisionalModelId: () => provisionalModelId,
	getIsStreaming: () => isStreaming,
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
	if (!filePickerProjectPath) {
		return;
	}
	panelStore.openFilePanel(filePath, filePickerProjectPath, {
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
				if (filePickerProjectPath) {
					inputState
						.loadProjectFiles(filePickerProjectPath, {
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
			const hasConnectedSession = sessionRuntimeState?.connectionPhase === "connected";

			if (
				capabilitiesAgentId &&
				!hasConnectedSession &&
				effectiveCapabilityProviderMetadata?.preconnectionSlashMode === "startupGlobal" &&
				!preconnectionAgentSkillsStore.loaded &&
				!preconnectionAgentSkillsStore.loading
			) {
				preconnectionAgentSkillsStore.ensureLoaded(agentStore.agents).mapErr((error) => {
					logger.error("Failed to warm preconnection skills", {
						agentId: capabilitiesAgentId,
						projectPath: filePickerProjectPath,
						error: error.message,
					});
					return undefined;
				});
			}

			preconnectionRemoteCommandsState
				.ensureLoaded({
					agentId: capabilitiesAgentId,
					hasConnectedSession,
					projectPath: filePickerProjectPath,
					preconnectionSlashMode:
						effectiveCapabilityProviderMetadata?.preconnectionSlashMode ?? "unsupported",
				})
				.mapErr((error) => {
					logger.error("Failed to warm remote preconnection commands", {
						agentId: capabilitiesAgentId,
						projectPath: filePickerProjectPath,
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

	const targetSessionId = effectiveVoiceSessionId;
	const generation = ++voiceStateInitGeneration;
	voiceStatePendingSessionId = targetSessionId;

	const nextVoiceState = new VoiceInputState({
		sessionId: targetSessionId,
		getSelectedLanguage: () => voiceSettingsStore.language,
		getSelectedModelId: () => voiceSettingsStore.selectedModelId,
		onOverlayDeactivated: () => {
			// Editor is re-mounted after overlay hides; focus it on next microtask
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
	});

	await nextVoiceState.registerListeners();
	if (
		generation !== voiceStateInitGeneration ||
		!voiceEnabled ||
		effectiveVoiceSessionId !== targetSessionId
	) {
		nextVoiceState.dispose();
		if (generation === voiceStateInitGeneration) {
			voiceStatePendingSessionId = null;
		}
		return;
	}

	voiceState = nextVoiceState;
	voiceStateSessionId = targetSessionId;
	voiceStatePendingSessionId = null;
}

function disposeVoiceState(): void {
	voiceStateInitGeneration += 1;
	voiceStatePendingSessionId = null;
	voiceStateSessionId = null;
	voiceState?.dispose();
	voiceState = null;
}

$effect(() => {
	const currentManagedSessionId =
		voiceStatePendingSessionId !== null ? voiceStatePendingSessionId : voiceStateSessionId;
	const lifecycle = resolveVoiceStateLifecycle(
		currentManagedSessionId,
		effectiveVoiceSessionId,
		voiceEnabled
	);

	if (lifecycle === "noop") {
		return;
	}

	if (lifecycle === "dispose" || lifecycle === "replace") {
		disposeVoiceState();
	}

	if ((lifecycle === "init" || lifecycle === "replace") && effectiveVoiceSessionId) {
		void initializeVoiceState();
	}
});

onMount(() => {
	const container = inputState.containerRef;
	const handleWindowKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Shift") {
			isShiftPressed = true;
		}
		if (
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
		const hasPendingUserEntry = panelHotState?.pendingUserEntry !== null;
		logger.info("[first-send-trace] agent input mount", {
			panelId: props.panelId,
			sessionId: props.sessionId ?? null,
			draftLength: draft.length,
			hasPendingComposerRestore: pendingComposerRestore !== null,
			hasPendingUserEntry,
			hasPendingWorktreeSetup: panelHotState?.pendingWorktreeSetup !== null,
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
	logger.info("[first-send-trace] synced editor after mount", {
		panelId: props.panelId ?? null,
		sessionId: props.sessionId ?? null,
		messageLength: inputState.message.length,
		domLength: editorRef ? serializeInlineComposerMessage(editorRef).length : null,
	});

	return () => {
		window.removeEventListener("keydown", handleWindowKeyDown);
		window.removeEventListener("keyup", handleWindowKeyUp);
		container?.removeEventListener("keydown", handleInputContainerKeyDown);
	};
});

// Cleanup on destroy — flush any pending draft before teardown
onDestroy(() => {
	disposeVoiceState();
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

// Handle mode change
async function handleModeChange(modeId: string) {
	const sessionId = props.sessionId;
	if (sessionId) {
		await sessionStore.runComposerConfigOperation(
			sessionId,
			{
				provisionalModeId: modeId,
				provisionalModelId: effectiveCurrentModelId,
				provisionalAutonomousEnabled: autonomousToggleActive,
			},
			async () => {
				const shouldAnnounceForcedOff =
					autonomousToggleActive &&
					!resolveAutonomousSupport({
						agentId: capabilitiesAgentId,
						connectionPhase: sessionRuntimeState ? sessionRuntimeState.connectionPhase : null,
						currentUiModeId: modeId,
						agents: agentStore.agents,
					}).supported;
				const result = await sessionStore.setMode(sessionId, modeId);
				if (result.isErr()) {
					toast.error("Failed to switch mode.");
					return false;
				}

				if (shouldAnnounceForcedOff) {
					autonomousStatusMessage =
						"Autonomous turned off because this mode is unsupported for the current agent.";
				}
				return true;
			}
		);
		return;
	}
	provisionalModeId = modeId;
	if (
		panelProvisionalAutonomousEnabled &&
		!resolveAutonomousSupport({
			agentId: capabilitiesAgentId,
			connectionPhase: null,
			currentUiModeId: modeId,
			agents: agentStore.agents,
		}).supported
	) {
		if (props.panelId) {
			panelStore.setProvisionalAutonomousEnabled(props.panelId, false);
		}
		autonomousStatusMessage =
			"Autonomous turned off because this mode is unsupported for the current agent.";
	}
}

async function applyAutonomousEnabledToSession(nextEnabled: boolean): Promise<boolean> {
	if (!props.sessionId || !sessionHotState) {
		return false;
	}

	const result = await sessionStore.setAutonomousEnabled(props.sessionId, nextEnabled);
	if (result.isErr()) {
		toast.error(nextEnabled ? "Failed to enable Autonomous." : "Failed to disable Autonomous.");
		return false;
	}

	if (nextEnabled) {
		const drainResult = await permissionStore.drainPendingForSession(props.sessionId);
		if (drainResult.isErr()) {
			logger.error("Failed to drain Autonomous permissions", { error: drainResult.error });
			toast.error("Autonomous is on, but some pending permissions still need attention.");
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

async function handleModeMenuChange(optionId: string): Promise<void> {
	const resolution = resolveModeMenuAction({
		selectedOptionId: optionId,
		currentModeId: effectiveCurrentModeId,
		autonomousEnabled: autonomousToggleActive,
		buildModeId: CanonicalModeId.BUILD,
	});

	if (!props.sessionId) {
		if (resolution.modeIdToApply) {
			provisionalModeId = resolution.modeIdToApply;
		}

		if (resolution.autonomousEnabledToApply !== null) {
			await setAutonomousEnabled(resolution.autonomousEnabledToApply);
		}

		return;
	}

	const sessionId = props.sessionId;
	await sessionStore.runComposerConfigOperation(
		sessionId,
		{
			provisionalModeId: resolution.modeIdToApply ?? effectiveCurrentModeId,
			provisionalModelId: effectiveCurrentModelId,
			provisionalAutonomousEnabled:
				resolution.autonomousEnabledToApply !== null
					? resolution.autonomousEnabledToApply
					: autonomousToggleActive,
		},
		async () => {
			if (resolution.modeIdToApply) {
				const shouldAnnounceForcedOff =
					autonomousToggleActive &&
					!resolveAutonomousSupport({
						agentId: capabilitiesAgentId,
						connectionPhase: sessionRuntimeState ? sessionRuntimeState.connectionPhase : null,
						currentUiModeId: resolution.modeIdToApply,
						agents: agentStore.agents,
					}).supported;
				const modeResult = await sessionStore.setMode(sessionId, resolution.modeIdToApply);
				if (modeResult.isErr()) {
					toast.error("Failed to switch mode.");
					return false;
				}

				if (shouldAnnounceForcedOff) {
					autonomousStatusMessage =
						"Autonomous turned off because this mode is unsupported for the current agent.";
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
		await sessionStore.runComposerConfigOperation(
			sessionId,
			{
				provisionalModeId: effectiveCurrentModeId,
				provisionalModelId: modelId,
				provisionalAutonomousEnabled: autonomousToggleActive,
			},
			async () => {
				const result = await sessionStore.setModel(sessionId, modelId);
				if (result.isErr()) {
					toast.error("Failed to switch model.");
					return false;
				}
				return true;
			}
		);
		return;
	}
	provisionalModelId = modelId;
}

async function handleConfigOptionChange(configId: string, value: string) {
	if (!props.sessionId) {
		return;
	}

	const sessionId = props.sessionId;
	await sessionStore.runComposerConfigOperation(
		sessionId,
		{
			provisionalModeId: effectiveCurrentModeId,
			provisionalModelId: effectiveCurrentModelId,
			provisionalAutonomousEnabled: autonomousToggleActive,
		},
		async () => {
			const result = await sessionStore.setConfigOption(sessionId, configId, value);
			return result.isOk();
		}
	);
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

function cycleModeOnShortcut(event: KeyboardEvent): boolean {
	if (
		(event.code !== "Period" && event.key !== ".") ||
		!(event.metaKey || event.ctrlKey) ||
		(event.shiftKey && event.key !== ".") ||
		event.altKey ||
		visibleModes.length === 0
	) {
		return false;
	}

	event.preventDefault();
	event.stopPropagation();
	const currentIndex = visibleModes.findIndex((m) => m.id === effectiveCurrentModeId);
	const nextIndex =
		currentIndex === -1 ? 1 % visibleModes.length : (currentIndex + 1) % visibleModes.length;
	const nextMode = visibleModes[nextIndex];
	if (nextMode && nextMode.id !== effectiveCurrentModeId) {
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
	if (!voiceEnabled || currentVoiceState === null) {
		return false;
	}
	return canStartVoiceInteraction(
		currentVoiceState.phase,
		storeComposerState?.isDispatching ?? false
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
			isStreaming,
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
			hasDraftInput,
			isAgentBusy,
			hasBlockingComposerConfig: storeComposerState?.isBlocked ?? false,
			isComposerDispatching: storeComposerState?.isDispatching ?? false,
			isSubmitDisabled,
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
				toast.error("Image exceeds 10 MB limit");
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
</script>

<div
	bind:this={inputState.containerRef}
	role="region"
	aria-label="Message input with file drop zone"
	ondrop={(e) => inputState.handleDrop(e)}
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
		<SharedAgentPanelComposer
			class="border-t-0 p-0"
			inputClass="flex-shrink-0 border border-border bg-input/30"
			contentClass={voiceOverlayActive ? "relative p-1.5" : "p-1.5"}
		>
			{#snippet content()}
				<AgentInputComposerBody
					bind:editorRef
					{voiceState}
					{voiceOverlayActive}
					{inputReady}
					{inputState}
					overlayMode={overlayMode}
					overlayRefId={overlayRefId}
					overlayAnchorRect={overlayAnchorRect}
					{composerInteraction}
					{isStreaming}
					{hasDraftInput}
					{isAgentBusy}
					effectiveAvailableCommands={effectiveAvailableCommands}
					isSlashDropdownVisible={isSlashDropdownVisible}
					filePickerProjectPath={filePickerProjectPath}
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
					onPrimaryButtonClick={handlePrimaryButtonClick}
					onCommandSelect={handleCommandSelect}
					onFileSelect={handleFileSelect}
					onSlashDropdownClose={() => inputState.handleDropdownClose()}
					onFileDropdownClose={() => inputState.handleFileDropdownClose()}
					placeholderLabel={"Plan, @ for context, / for commands"}
					voiceOverlayPhase={voiceRecordingOverlayPhase}
					voiceDefaultErrorMessage={"Microphone permission denied"}
					primarySrQueue={"Queue"}
					primarySrSend={"Send message"}
					primarySrInterrupt={"Interrupt"}
					tooltipQueueRowLabel={"Queue"}
					tooltipInterruptShiftRowLabel={"Interrupt"}
					tooltipStopStreaming={"Stop"}
					tooltipSend={"Send message"}
					slashLabels={{
						header: "Commands",
						noCommands: "No commands available",
						noResults: "No commands found",
						startTyping: "Start typing to search commands...",
						selectHint: "to select",
						closeHint: "to close",
					}}
					filePickerLabels={{
						header: "Add file context",
						noResults: "No matching files",
						selectHint: "to select",
						closeHint: "to close",
					}}
				/>
			{/snippet}
			{#snippet footer()}
				<AgentInputComposerToolbar
					{inputReady}
					{autonomousStatusMessage}
					{visibleModes}
					{selectedModeMenuOptionId}
					{autonomousToggleActive}
					autoModeDisabled={autoModeDisabled}
					autoModeDisabledReason={autoModeDisabledReason}
					planModeLabel={"Plan"}
					buildModeLabel={"Build"}
					autoModeLabel="Auto"
					onModeMenuChange={handleModeMenuChange}
					{selectorsLoading}
					{selectorsDisabledByComposer}
					toolbarConfigOptions={toolbarConfigOptions}
					onConfigOptionChange={handleConfigOptionChange}
					agentProjectPicker={props.agentProjectPicker}
					checkpointButton={props.checkpointButton}
					voiceState={voiceToolbarBinding}
					{voiceEnabled}
					composerIsDispatching={storeComposerState?.isDispatching ?? false}
					getMicButtonTitle={(_voice) =>
						voiceState ? resolveVoiceMicTooltip(voiceState.phase, voiceMicTooltipLabels) : ""}
					onVoiceMicKeyDown={(event, _binding) => {
						if (voiceState) {
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
					voiceCloseLabel={"Close"}
				>
					{#snippet modelSelector()}
						<ModelSelector
							availableModels={effectiveAvailableModels}
							currentModelId={effectiveCurrentModelId}
							modelsDisplay={effectiveModelsDisplay}
							onModelChange={handleModelChange}
							isLoading={selectorsLoading}
							panelId={props.panelId}
						/>
					{/snippet}
					{#snippet metricsChip()}
						{#if props.sessionId}
							<ModelSelectorMetricsChip sessionId={props.sessionId} agentId={capabilitiesAgentId} />
						{/if}
					{/snippet}
				</AgentInputComposerToolbar>
			{/snippet}
		</SharedAgentPanelComposer>
	{/if}
</div>
