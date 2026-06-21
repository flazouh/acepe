/**
 * Composer controller — single seam for agent-input logic modules.
 *
 * View (`agent-input-ui.svelte`) and state (`agent-input-state.svelte.ts`) import
 * composer behaviour through this module only. Pure logic units stay in `logic/`
 * and are composed here, mirroring `VoiceSessionController` for voice lifecycle
 * and `agent-input-controller.ts` for send actions.
 */
export {
	buildAttachMenuCommandSections,
	buildAttachMenuMcpServerGroups,
	buildAttachMenuModes,
	resolveAttachMenuItemInsertText,
	resolveDefaultModeId,
	shouldShowActiveModeChip,
} from "./logic/attach-menu-items.js";
export { ComposerMcpCatalogState } from "./logic/composer-mcp-catalog-state.svelte.js";
export {
	resolveCapabilityContextProviderMetadata,
	resolveCapabilitySource,
	sessionCapabilitySourceFromCapabilities,
} from "./logic/capability-source.js";
export { resolveComposerPlaceholder } from "./logic/composer-placeholder.js";
export { calculateDropdownPosition } from "./logic/dropdown-trigger.js";
export { getEffectiveFilePickerProjectPath } from "./logic/file-picker-context.js";
export { createImageAttachment, isImageMimeType } from "./logic/image-attachment.js";
export {
	findInlineArtefactRangeAtPosition,
	INLINE_TOKEN_PREFIX,
} from "./logic/inline-artefact-segments.js";
export {
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
export { applyInlineTokenHoverTitles } from "./logic/inline-token-hover-titles.js";
export { shouldInterruptComposerStream } from "./logic/interrupt-shortcut.js";
export {
	hasAutocompleteTrigger,
	parseFilePickerTrigger,
	parseSlashCommandTrigger,
} from "./logic/input-parser.js";
export { resolveModeMenuAction, resolveSelectedModeMenuOptionId } from "./logic/mode-menu-state.js";
export { createPendingUserEntry } from "./logic/pending-user-entry.js";
export { PreconnectionCapabilitiesState } from "./logic/preconnection-capabilities-state.svelte.js";
export { PreconnectionRemoteCommandsState } from "./logic/preconnection-remote-commands-state.svelte.js";
export { createSession, sendMessage } from "./logic/session-manager.js";
export { loadSlashCommandWorkspaceMarkdown } from "./logic/slash-command-markdown-loader.js";
export {
	isSlashSkillCommand,
	resolveSlashCommandSource,
	shouldShowSlashCommandDropdown,
} from "./logic/slash-command-source.js";
export { getToolbarConfigOptions } from "./logic/toolbar-config-options.js";
export { hasToolbarCapabilityData, resolveSelectorsLoading } from "./logic/toolbar-loading.js";
export {
	resolveInitialModelIdForNewSession,
	resolvePendingToolbarSelections,
	resolveToolbarModeId,
	resolveToolbarModelId,
} from "./logic/toolbar-state.js";
export { handleVoiceMicKeyDown } from "./logic/voice-mic-keyboard.js";
export { resolveVoiceMicTooltip } from "./logic/voice-mic-labels.js";
export { normalizeVoiceInputText } from "./logic/voice-input-text.js";
export {
	shouldRouteWindowVoiceHold,
	shouldStartVoiceHold,
	shouldStopVoiceHold,
	shouldSyncPanelFocusOnEditorFocus,
} from "./logic/voice-keyboard.js";
export { canStartVoiceInteraction, shouldShowVoiceOverlay } from "./logic/voice-ui-state.js";
export { toVoiceToolbarBinding } from "./logic/voice-toolbar-binding.js";
export {
	deriveComposerInteractionState,
	resolveComposerEnterKeyIntent,
} from "../../logic/composer-ui-state.js";
export { type SubmitIntent } from "../../logic/submit-intent.js";

export type { ComposerRestoreSnapshot } from "./logic/first-send-recovery.js";
export {
	findAuthenticationRequirement,
	findCreationFailureReason,
	formatPreSessionSendFailure,
	restoreComposerStateAfterFailedSend,
} from "./logic/first-send-recovery.js";
export { type PreparedMessage, prepareMessageForSend } from "./logic/message-preparation.js";
export {
	ComposerViewController,
	type ComposerViewControllerDeps,
} from "./state/composer-view-controller.svelte.js";
