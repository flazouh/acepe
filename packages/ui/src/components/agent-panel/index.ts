export type {
	ChunkGroup,
	GroupedAssistantChunks,
} from "../../lib/assistant-message/assistant-chunk-grouper.js";
export { groupAssistantChunks } from "../../lib/assistant-message/assistant-chunk-grouper.js";
export type {
	AssistantMessage,
	AssistantMessageChunk,
	ContentBlock,
	StreamingAnimationMode,
} from "../../lib/assistant-message/types.js";
export { default as AgentAssistantMessage } from "./agent-assistant-message.svelte";
export { default as ClaudeWorkingSpark } from "./claude-working-spark.svelte";
export {
	CLAUDE_WORKING_SPARK_DURATION_MS,
	CLAUDE_WORKING_SPARK_FRAME_COUNT,
	CLAUDE_WORKING_SPARK_SPRITE_SRC,
} from "./claude-working-spark-frames.js";
export { default as AgentAttachedFilePane } from "./agent-attached-file-pane.svelte";
export { default as AgentPanelErrorCard } from "./agent-error-card.svelte";
export { default as AgentPanelRecoveryCard } from "./agent-panel-recovery-card.svelte";
export { default as AgentPanelSignInCard } from "./agent-sign-in-card.svelte";
export { default as AgentSessionActivityEntryView } from "./agent-session-activity-entry.svelte";
export { default as AgentInputActiveModeChip } from "./agent-input-active-mode-chip.svelte";
export { default as AgentInputAgentSelector } from "./agent-input-agent-selector.svelte";
export type { AgentInputAgentSelectorItem } from "./agent-input-agent-selector-types.js";
export { default as DefaultAgentPinIcon } from "./default-agent-pin-icon.svelte";
export { default as AgentInputArtefactBadge } from "./agent-input-artefact-badge.svelte";
export { default as AgentInputAttachMenu } from "./agent-input-attach-menu.svelte";
export type {
	AttachMenuCommandItem,
	AttachMenuCommandSection,
	AttachMenuMcpServerGroup,
	AttachMenuModeItem,
} from "./agent-input-attach-menu-state.js";
export { filterAttachMenuItems } from "./agent-input-attach-menu-state.js";
export {
	selectorPanelBodyClass,
	selectorPanelContentClass,
	selectorPanelEmptyStateClass,
	selectorPanelFilterRowClass,
	selectorPanelItemClass,
	selectorPanelListClass,
	selectorPanelSubmenuContentClass,
} from "../selector/selector-panel.classes.js";
export { default as AgentInputAutonomousToggle } from "./agent-input-autonomous-toggle.svelte";
export { default as AgentInputBranchSelector } from "./agent-input-branch-selector.svelte";
export type {
	AgentInputBranchListDisplay,
	AgentInputBranchSelectorVariant,
} from "./agent-input-branch-selector-types.js";
export { default as AgentInputComposerRow } from "./agent-input-composer-row.svelte";
export type { AgentInputEnterBehavior } from "./agent-input-enter-behavior.js";
export { default as AgentInputComposerToolbar } from "./agent-input-composer-toolbar.svelte";
export { default as AgentInputModelReasoningFusedControls } from "./agent-input-model-reasoning-fused-controls.svelte";
export { default as AgentInputComposerTrailingControls } from "./agent-input-composer-trailing-controls.svelte";
export { default as AgentInputConfigOptionSelector } from "./agent-input-config-option-selector.svelte";
export type { AgentInputConfigOption } from "./agent-input-config-option-types.js";
export { default as AgentInputDivider } from "./agent-input-divider.svelte";
export { default as AgentInputEditor } from "./agent-input-editor.svelte";
export { default as AgentInputFilePickerDropdown } from "./agent-input-file-picker-dropdown.svelte";
export { default as AgentInputMetricsChip } from "./agent-input-metrics-chip.svelte";
export { default as AgentInputMicButton } from "./agent-input-mic-button.svelte";
export { default as AgentInputModeIcon } from "./agent-input-mode-icon.svelte";
export { default as AgentInputModePill } from "./agent-input-mode-pill.svelte";
export { default as AgentInputModeSelector } from "./agent-input-mode-selector.svelte";
export { default as AgentInputNewThreadOptions } from "./agent-input-new-thread-options.svelte";
export {
	getModeDropdownOptions,
	getSelectedModeOption,
	shouldEmitModeChange,
	type AgentInputMode,
	type ModeIconKind,
} from "./agent-input-mode-selector-state.js";
export { default as AgentInputModelFavoriteStar } from "./agent-input-model-favorite-star.svelte";
export { default as AgentInputModelSelector } from "./agent-input-model-selector.svelte";
export type {
	AgentInputModelSelectorGroup,
	AgentInputModelSelectorItem,
	AgentInputModelSelectorReasoningGroup,
	AgentInputModelSelectorVariant,
} from "./agent-input-model-selector-types.js";
export { default as AgentInputModelTrigger } from "./agent-input-model-trigger.svelte";
export { default as AgentInputPastedTextOverlay } from "./agent-input-pasted-text-overlay.svelte";
export { default as AgentInputSlashCommandDropdown } from "./agent-input-slash-command-dropdown.svelte";
export type {
	AgentInputSlashCommand,
	AgentInputSlashCommandWorkspaceMarkdownResult,
} from "./agent-input-slash-command-dropdown-state.js";
export {
	flattenSlashPaletteItems,
	getSlashPaletteVisibleSections,
	slashPaletteHasContent,
	SLASH_PALETTE_SECTION_PREVIEW_COUNT,
} from "./agent-input-slash-palette-state.js";
export type {
	SlashPaletteFlatEntry,
	SlashPaletteItem,
	SlashPaletteItemKind,
	SlashPaletteSection,
	SlashPaletteSectionId,
	SlashPaletteVisibleSection,
} from "./agent-input-slash-palette-state.js";
export { default as AgentInputToolbar } from "./agent-input-toolbar.svelte";
export type {
	AgentComposerToolbarVoiceBinding,
	AgentInputToolbarVoicePhase,
	MicButtonVisualState,
} from "./agent-input-toolbar-voice.js";
export {
	canCancelVoiceInteraction,
	canStartVoiceInteraction,
	getMicButtonVisualState,
} from "./agent-input-toolbar-voice.js";
export { default as AgentInputVoiceModelMenu } from "./agent-input-voice-model-menu.svelte";
export { default as AgentInputVoiceRecordingOverlay } from "./agent-input-voice-recording-overlay.svelte";
export { default as AgentPanelInstallCard } from "./agent-install-card.svelte";
export { default as AgentPanel } from "./agent-panel.svelte";
export { default as AgentPanelBrowserHeader } from "./agent-panel-browser-header.svelte";
export { default as AgentPanelComposer } from "./agent-panel-composer.svelte";
export { default as AgentPanelComposerFrame } from "./agent-panel-composer-frame.svelte";
export { default as AgentPanelConversationEntry } from "./agent-panel-conversation-entry.svelte";
export { default as AgentPanelDeck } from "./agent-panel-deck.svelte";
export { default as AgentPanelFooter } from "./agent-panel-footer.svelte";
export { default as AgentPanelFooterChrome } from "./agent-panel-footer-chrome.svelte";
export { default as AgentPanelHeader } from "./agent-panel-header.svelte";
export { default as AgentPanelLayout } from "./agent-panel-layout.svelte";
export { default as AgentMissingSceneEntry } from "./agent-missing-scene-entry.svelte";
export { default as AgentThinkingSceneEntry } from "./agent-thinking-scene-entry.svelte";
export { default as AgentPanelModifiedFileRow } from "./agent-panel-modified-file-row.svelte";
export { default as AgentPanelModifiedFilesTrailingControls } from "./agent-panel-modified-files-trailing-controls.svelte";
export { default as AgentPanelPrCard } from "./agent-panel-pr-card.svelte";
export { default as AgentPanelReviewCard } from "./agent-panel-review-card.svelte";
export { default as AgentPanelReviewContent } from "./agent-panel-review-content.svelte";
export { default as AgentPanelShell } from "./agent-panel-shell.svelte";
export { default as AgentPanelStatePanel } from "./agent-panel-state-panel.svelte";
export { default as AgentPanelStatusIcon } from "./agent-panel-status-icon.svelte";
export { default as AgentPanelStatusStrip } from "./agent-panel-status-strip.svelte";
export { default as AgentPanelTerminalDrawer } from "./agent-panel-terminal-drawer.svelte";
export { default as AgentPanelTrailingPaneLayout } from "./agent-panel-trailing-pane-layout.svelte";
export { default as AgentPanelWorktreeCloseConfirmPopover } from "./agent-panel-worktree-close-confirm-popover.svelte";
export { default as AgentSelectionGrid } from "./agent-selection-grid.svelte";
export type { AgentGridItem } from "./agent-selection-grid-types.js";
export { default as AgentToolBrowser } from "./agent-tool-browser.svelte";
export { default as AgentToolCard } from "./agent-tool-card.svelte";
export { default as AgentToolEdit } from "./agent-tool-edit.svelte";
export { default as AgentToolExecute } from "./agent-tool-execute.svelte";
export { default as AgentToolFetch } from "./agent-tool-fetch.svelte";
export { default as AgentToolOther } from "./agent-tool-other.svelte";
export { default as AgentToolQuestion } from "./agent-tool-question.svelte";
export { default as AgentToolRead } from "./agent-tool-read.svelte";
export { default as AgentToolReadLints } from "./agent-tool-read-lints.svelte";
export { default as AgentPanelToolReview } from "./agent-panel-tool-review.svelte";
export { default as AgentToolRow } from "./agent-tool-row.svelte";
export { default as AgentToolSearch } from "./agent-tool-search.svelte";
export { default as AgentToolSkill } from "./agent-tool-skill.svelte";
export { default as AgentToolTask } from "./agent-tool-task.svelte";
export { default as AgentToolThinking } from "./agent-tool-thinking.svelte";
export { default as AgentThinkingDurationHeader } from "./agent-thinking-duration-header.svelte";
export { default as AgentToolDurationLabel } from "./agent-tool-duration-label.svelte";
export { isRawExecuteToolName, normalizedRawToolName } from "./agent-tool-raw-name-state.js";
export { default as PlanningPlaceholderRow } from "./planning-placeholder-row.svelte";
export type { ToolDurationTiming } from "./tool-duration.js";
export { default as AgentToolTodo } from "./agent-tool-todo.svelte";
export { default as AgentToolWebSearch } from "./agent-tool-web-search.svelte";
export { default as ToolKindIcon } from "./tool-kind-icon.svelte";
export { default as ToolHeaderLeading } from "./tool-header-leading.svelte";
export { resolveThinkingDurationMs, shouldRunThinkingTimer } from "./thinking-duration.js";
export { default as AgentUserMessage } from "./agent-user-message.svelte";
export { CommandChip } from "../command-chip/index.js";
export type { CommandChipModel } from "../command-chip/index.js";
export { default as AgentPanelBrowserPanel } from "./browser-panel.svelte";
export { default as AgentCompactToolDisplay } from "./compact-tool-display.svelte";
export { default as AgentCopyButton } from "./agent-copy-button.svelte";
export { default as AgentPanelCreatePrButton } from "./create-pr-button.svelte";
export { default as AgentPanelMergeButton } from "./merge-button.svelte";
export { default as AgentPanelModifiedFilesHeader } from "./modified-files-header.svelte";
export type {
	AgentPanelDeferredPaneDefinition,
	AgentPanelDeferredPaneFamily,
	AgentPanelParityStateDefinition,
	AgentPanelPhase1ParityStateId,
} from "./parity-fixtures.js";
export {
	AGENT_PANEL_DEFERRED_PANE_DEFAULTS,
	AGENT_PANEL_PHASE1_PARITY_STATES,
} from "./parity-fixtures.js";
export { default as AgentPanelPermissionBar } from "./permission-bar.svelte";
export { default as AgentPanelPermissionBarActions } from "./permission-bar-actions.svelte";
export { default as AgentPanelPermissionBarIcon } from "./permission-bar-icon.svelte";
export { default as AgentPanelPermissionBarProgress } from "./permission-bar-progress.svelte";
export { default as AgentPanelPlanHeader } from "./plan-header.svelte";
export { default as AgentPanelPrStatusCard } from "./pr-status-card.svelte";
export { default as AgentPanelPreSessionWorktreeCard } from "./pre-session-worktree-card.svelte";
export { default as AgentPanelQueueCardStrip } from "./queue-card-strip.svelte";
export { default as AgentPanelReviewNavigation } from "./review-navigation.svelte";
export { default as AgentPanelReviewTabStrip } from "./review-tab-strip.svelte";
export { default as ReviewWorkspace } from "./review-workspace.svelte";
export { default as ReviewWorkspaceFileList } from "./review-workspace-file-list.svelte";
export { default as ReviewWorkspaceHeader } from "./review-workspace-header.svelte";
export { default as MessageScroller } from "./message-scroller.svelte";
export {
	DEFAULT_ROW_ESTIMATE_PX,
	createArrayMessageScrollerItemSource,
	rowEstimatePx,
	type MessageScrollerItem,
	type MessageScrollerItemSource,
	type MessageScrollerRangeState,
	type MessageScrollerRowKind,
} from "./message-scroller-types.js";
export type {
	AgentPanelPerformanceRecorder,
	AgentPanelPerformanceSample,
} from "./agent-panel-performance-profile.js";
export {
	measureAgentPanelPerformance,
	recordAgentPanelPerformanceSample,
} from "./agent-panel-performance-profile.js";
export {
	createStickToBottomController,
	stickToBottom,
	type StickToBottomController,
	type StickToBottomParams,
} from "./stick-to-bottom-effects.js";
export { default as AgentPanelTranscriptScrollControls } from "./agent-panel-transcript-scroll-controls.svelte";
export { default as AgentPanelTodoHeader } from "./todo-header.svelte";
export { default as TodoNumberIcon } from "./todo-number-icon.svelte";
export { default as ToolTally } from "./tool-tally.svelte";
export { resolveVisibleAssistantMessageGroups } from "./agent-assistant-message-visible-groups.js";
export type {
	AgentAssistantEntry,
	AssistantRenderBlockContext,
	TokenRevealCss,
	AgentPanelActionabilityModel,
	AgentPanelActionCallbacks,
	AgentPanelActionDescriptor,
	AgentPanelActionDescriptor as AgentPanelSharedActionDescriptor,
	AgentPanelActionId,
	AgentPanelActionState,
	AgentPanelAttachedFilePaneModel,
	AgentPanelAttachedFileTab,
	AgentPanelBadge,
	AgentPanelBrowserSidebarModel,
	AgentPanelCardModel,
	AgentPanelChromeModel,
	AgentPanelComposerAttachment,
	AgentPanelComposerCopy,
	AgentPanelComposerModel,
	AgentPanelComposerSelectedModel,
	AgentPanelConversationEntry as AgentPanelSceneEntryModel,
	AgentPanelConversationModel,
	AgentPanelFileReviewStatus,
	AgentPanelFooterModel,
	AgentPanelHeaderModel,
	AgentPanelLifecycleModel,
	AgentPanelLifecycleStatus,
	AgentPanelMetaItem,
	AgentPanelModifiedFileItem,
	AgentPanelModifiedFilesTrailingModel,
	AgentPanelPlanSidebarItem,
	AgentPanelPlanSidebarModel,
	AgentPanelPrCardModel,
	AgentPanelPrCommitItem,
	AgentPanelPlanActionEvent,
	AgentPanelPlanViewEvent,
	AgentPanelQueuedMessage,
	AgentPanelQuestionSelectEvent,
	AgentPanelReviewActionEvent,
	AgentPanelRecommendedAction,
	AgentPanelRecoveryPhase,
	AgentPanelReviewFileTab,
	AgentPanelReviewModel,
	AgentPanelSceneModel,
	AgentPanelSessionStatus,
	AgentPanelSessionStatus as AgentPanelSceneStatus,
	AgentPanelSidebarModel,
	AgentPanelStripKind,
	AgentPanelStripModel,
	AgentPanelTerminalModel,
	AgentPanelTerminalTab,
	AgentQuestion,
	AgentQuestionOption,
	AgentSessionActivityContextUsage,
	AgentSessionActivityEntry,
	AgentSessionActivityMetadataItem,
	AgentSessionStatus,
	AgentMissingEntry,
	AgentThinkingEntry,
	AgentTodoItem,
	AgentTodoStatus,
	AgentToolEditDiffEntry,
	AgentToolEntry,
	AgentToolFileSelectEvent,
	AgentToolKind,
	AgentToolPresentationState,
	AgentToolReviewFileEntry,
	AgentToolStatus,
	AgentUserContentChunk,
	AgentUserEntry,
	AgentUserFileSelectEvent,
	AgentWebSearchLink,
	AnyAgentEntry,
	LintDiagnostic,
	ReviewWorkspaceFileItem,
} from "./types.js";
export {
	AGENT_PANEL_ACTION_IDS,
	getReviewWorkspaceDefaultIndex,
	resolveReviewWorkspaceSelectedIndex,
} from "./types.js";
export { default as AgentPanelWorktreeSetupCard } from "./worktree-setup-card.svelte";
export { default as AgentPanelWorktreeStatusDisplay } from "./worktree-status-display.svelte";
