export type {
	AgentPanelActionCallbacks,
	AgentPanelActionDescriptor,
	AgentPanelActionId,
	AgentPanelActionState,
	AgentAssistantEntry,
	AgentPanelAttachedFilePaneModel,
	AgentPanelAttachedFileTab,
	AgentPanelBadge,
	AgentPanelBrowserSidebarModel,
	AgentPanelCardModel,
	AgentPanelChromeModel,
	AgentPanelComposerAttachment,
	AgentPanelComposerModel,
	AgentPanelComposerSelectedModel,
	AgentPanelConversationModel,
	AgentPanelFileReviewStatus,
	AgentPanelHeaderModel,
	AgentPanelMetaItem,
	AgentPanelModifiedFileItem,
	AgentPanelModifiedFilesReviewOption,
	AgentPanelModifiedFilesTrailingModel,
	AgentPanelPlanSidebarItem,
	AgentPanelPlanSidebarModel,
	AgentPanelPrCardModel,
	AgentPanelPrCommitItem,
	AgentPanelQueuedMessage,
	AgentPanelSceneEntryModel,
	AgentPanelSceneModel,
	AgentPanelSceneStatus,
	AgentPanelSidebarModel,
	AgentPanelStripKind,
	AgentPanelStripModel,
	AgentQuestion,
	AgentQuestionOption,
	AgentSessionStatus,
	AgentThinkingEntry,
	AgentTodoItem,
	AgentTodoStatus,
	AgentToolEntry,
	AgentToolKind,
	AgentToolStatus,
	AgentUserEntry,
	AnyAgentEntry,
	LintDiagnostic,
} from "./components/agent-panel/index.js";
// Agent panel components
export {
	AgentInputArtefactBadge,
	AgentInputAutonomousToggle,
	AgentInputConfigOptionSelector,
	AgentInputDivider,
	AgentInputEditor,
	AgentInputFilePickerDropdown,
	AgentInputMetricsChip,
	AgentInputMicButton,
	AgentInputModeSelector,
	AgentInputModelFavoriteStar,
	AgentInputModelModeBar,
	AgentInputModelRow,
	AgentInputModelSelector,
	AgentInputModelTrigger,
	AgentInputSelectorCheck,
	AgentInputSlashCommandDropdown,
	AgentInputPastedTextOverlay,
	AgentInputToolbar,
	AgentInputVoiceModelMenu,
	AgentInputVoiceRecordingOverlay,
	AgentPanel,
	AgentAttachedFilePane,
	AgentPanelBrowserHeader,
	AgentAssistantMessage,
	AgentPanelBrowserPanel,
	AgentPanelDeck,
	AgentPanelComposerFrame,
	AgentPanelComposer,
	AgentPanelConversationEntry,
	AgentPanelErrorCard,
	AgentPanelFooter,
	AgentPanelFooterChrome,
	AgentPanelHeader,
	AgentPanelInstallCard,
	AgentPanelLayout,
	AgentPanelModifiedFileRow,
	AgentPanelModifiedFilesTrailingControls,
	AgentPanelPlanHeader,
	AgentPanelModifiedFilesHeader,
	AgentPanelCreatePrButton,
	AgentPanelMergeButton,
	AgentPanelPermissionBar,
	AgentPanelPermissionBarIcon,
	AgentPanelPermissionBarProgress,
	AgentPanelPermissionBarActions,
	AgentPanelPrCard,
	AgentPanelPrStatusCard,
	AgentPanelQueueCardStrip,
	AgentPanelReviewContent,
	AgentPanelReviewCard,
	AgentPanelReviewNavigation,
	AgentPanelReviewTabStrip,
	AgentPanelScrollToBottomButton,
	AgentPanelShell,
	AgentPanelStatusStrip,
	AgentPanelStatePanel,
	AgentPanelStatusIcon,
	AgentPanelTerminalDrawer,
	AgentPanelTodoHeader,
	AgentPanelWorktreeSetupCard,
	AgentToolEdit,
	AgentToolExecute,
	AgentToolQuestion,
	AgentToolRead,
	AgentToolReadLints,
	AgentToolRow,
	AgentToolSearch,
	AgentToolSkill,
	AgentToolTask,
	AgentToolTodo,
	AgentUserMessage,
	ToolTally,
	TodoNumberIcon,
} from "./components/agent-panel/index.js";
export {
	AgentPanelScene,
	AgentPanelSceneConversation,
	AgentPanelSceneEntry,
	AgentPanelSceneHeader,
	AgentPanelSceneReviewCard,
	AgentPanelSceneSidebar,
	AgentPanelSceneStatusStrip,
} from "./components/agent-panel-scene/index.js";
export { AgentPanelSceneHeader as AgentPanelSceneHeaderRenderer } from "./components/agent-panel-scene/index.js";
export type {
	ActivityEntryMode,
	ActivityEntryQuestion,
	ActivityEntryQuestionOption,
	ActivityEntryQuestionProgress,
	ActivityEntryTodoProgress,
	SectionedFeedGroup,
	SectionedFeedItemData,
	SectionedFeedSectionId,
} from "./components/attention-queue/index.js";
export {
	ActivityEntry,
	AttentionQueueQuestionCard,
	FeedItem,
	PermissionFeedItem,
	SectionedFeed,
} from "./components/attention-queue/index.js";
export {
	Button,
	type ButtonProps,
	type ButtonSize,
	type ButtonVariant,
	buttonVariants,
	type Props as ButtonPropsAlias,
	Root as ButtonRoot,
} from "./components/button/index.js";
export type {
	CheckpointData,
	CheckpointFile,
	CheckpointState,
	FileDiff,
	FileRowState,
} from "./components/checkpoint/index.js";
// Checkpoint components
export {
	CheckpointCard,
	CheckpointFileList,
	CheckpointFileRow,
	CheckpointTimeline,
} from "./components/checkpoint/index.js";
export {
	ChipShell,
	buildChipShellClassName,
	type ChipShellDensity,
	type ChipShellSize,
} from "./components/chip/index.js";
export {
	Close as DialogCloseRaw,
	Content as DialogContentRaw,
	Description as DialogDescriptionRaw,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
	Footer as DialogFooterRaw,
	Header as DialogHeaderRaw,
	Overlay as DialogOverlayRaw,
	Portal as DialogPortalRaw,
	Root as DialogRoot,
	Title as DialogTitleRaw,
	Trigger as DialogTriggerRaw,
} from "./components/dialog/index.js";
export { DiffPill } from "./components/diff-pill/index.js";
export {
	Close as DrawerCloseRaw,
	Content as DrawerContentRaw,
	Description as DrawerDescriptionRaw,
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerNestedRoot,
	DrawerOverlay,
	DrawerPortal,
	DrawerTitle,
	DrawerTrigger,
	Footer as DrawerFooterRaw,
	Header as DrawerHeaderRaw,
	NestedRoot as DrawerNestedRootRaw,
	Overlay as DrawerOverlayRaw,
	Portal as DrawerPortalRaw,
	Root as DrawerRoot,
	Title as DrawerTitleRaw,
	Trigger as DrawerTriggerRaw,
} from "./components/drawer/index.js";
export { FilePathBadge } from "./components/file-path-badge/index.js";
export type {
	GitIndexStatus,
	GitLogEntry,
	GitRemoteStatus,
	GitStashEntry,
	GitStatusFile,
	GitWorktreeStatus,
} from "./components/git-panel/index.js";
// Git panel components
export {
	GitBranchBadge,
	GitCommitBox,
	GitLogList,
	GitPanelLayout,
	GitRemoteStatusBadge,
	GitStashList,
	GitStatusFileRow,
	GitStatusList,
} from "./components/git-panel/index.js";
export type {
	FileTreeNode,
	GitCommitData,
	GitPrData,
	GitViewerFile,
} from "./components/git-viewer/index.js";
// Git viewer components
export {
	buildFileTree,
	compactSingleChildDirs,
	flattenFileTree,
	GitCommitHeader,
	GitDiffViewToggle,
	GitFileTree,
	GitPrHeader,
	GitViewer,
} from "./components/git-viewer/index.js";
export { GitHubBadge } from "./components/github-badge/index.js";
export {
	ArrowRightIcon,
	BuildIcon,
	LoadingIcon,
	PlanIcon,
	RevertIcon,
} from "./components/icons/index.js";
export { ProviderMark } from "./components/provider-mark/index.js";
export {
	VoiceDownloadProgress,
	buildVoiceDownloadSegments,
	clampVoiceDownloadPercent,
	countFilledVoiceDownloadSegments,
	formatVoiceDownloadPercent,
} from "./components/voice-download-progress/index.js";
export {
	InlineArtefactBadge,
	buildInlineArtefactIconClassName,
	buildInlineArtefactLabelClassName,
	INLINE_ARTEFACT_CLIPBOARD_PATH,
	INLINE_ARTEFACT_PACKAGE_PATH,
} from "./components/inline-artefact-badge/index.js";
export { Input, Root as InputRoot } from "./components/input/index.js";
export type {
	KanbanCardData,
	KanbanColumnGroup,
	KanbanPermissionData,
	KanbanQuestionData,
	KanbanQuestionOption,
	KanbanSceneCardData,
	KanbanSceneColumnGroup,
	KanbanSceneFooterData,
	KanbanSceneMenuAction,
	KanbanScenePermissionFooterData,
	KanbanScenePlanApprovalFooterData,
	KanbanSceneQuestionFooterData,
	KanbanTaskCardData,
	KanbanToolData,
} from "./components/kanban/index.js";
export {
	KanbanBoard,
	KanbanCard,
	KanbanColumn,
	KanbanCompactComposer,
	KanbanPermissionFooter,
	KanbanQuestionFooter,
	KanbanSceneBoard,
} from "./components/kanban/index.js";
export { MarkdownDisplay } from "./components/markdown/index.js";
export {
	Content as NavigationMenuContent,
	Content,
	Indicator as NavigationMenuIndicator,
	Indicator,
	Item as NavigationMenuItem,
	Item,
	Link as NavigationMenuLink,
	Link,
	List as NavigationMenuList,
	List,
	Root as NavigationMenuRoot,
	// Raw exports
	Root,
	Trigger as NavigationMenuTrigger,
	Trigger,
	Viewport as NavigationMenuViewport,
	Viewport,
} from "./components/navigation-menu/index.js";
export {
	BrowserNavActions,
	CloseAction,
	EmbeddedIconButton,
	EmbeddedPanelHeader,
	FullscreenAction,
	HeaderActionCell,
	HeaderCell,
	HeaderDivider,
	HeaderTitleCell,
	OverflowMenuTriggerAction,
	SegmentedToggleGroup,
} from "./components/panel-header/index.js";
export { PlanSidebarLayout } from "./components/plan-sidebar/index.js";
export { BrandLockup } from "./components/brand-lockup/index.js";
export { BrandShaderBackground } from "./components/brand-shader-background/index.js";
export { DismissableTooltip } from "./components/dismissable-tooltip/index.js";
export { PillButton } from "./components/pill-button/index.js";
export { ProjectCard } from "./components/project-card/index.js";
export { ProjectLetterBadge } from "./components/project-letter-badge/index.js";
export { RichTokenText } from "./components/rich-token-text/index.js";
export { SegmentedProgress } from "./components/segmented-progress/index.js";
// Selector
export { Selector } from "./components/selector/index.js";
export { TextShimmer } from "./components/text-shimmer/index.js";
export { UserMessageContainer } from "./components/user-message-container/index.js";
export {
	BRAND_SHADER_DARK_PALETTE,
	type BrandShaderColorTuple,
	type BrandShaderPalette,
} from "./lib/brand-shader-palette.js";
export {
	COLOR_NAMES,
	Colors,
	getProjectColor,
	isValidHexColor,
	normalizeColorName,
	resolveColorValue,
	resolveProjectColor,
	TAG_BORDER_COLORS,
	TAG_COLORS,
} from "./lib/colors.js";
export { getFallbackIconSrc, getFileIconName, getFileIconSrc } from "./lib/file-icon/index.js";
// Icon context
export { getIconBasePath, setIconConfig } from "./lib/icon-context.js";
export { getProviderDisplayName, resolveProviderBrand } from "./lib/provider-brand.js";
export type { ProviderBrand } from "./lib/provider-brand.js";
export type {
	InlineArtefactSegment,
	InlineArtefactTokenType,
} from "./lib/inline-artefact/index.js";
export { tokenizeInlineArtefacts } from "./lib/inline-artefact/index.js";
export type {
	WithElementRef,
	WithoutChild,
	WithoutChildren,
	WithoutChildrenOrChild,
} from "./lib/utils";
// Re-export utilities
export { capitalizeLeadingCharacter, cn } from "./lib/utils";
