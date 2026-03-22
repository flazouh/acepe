// Re-export all components
export {
  Button,
  Root as ButtonRoot,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
  buttonVariants,
  type Props as ButtonPropsAlias,
} from "./components/button/index.js";

export { Input, Root as InputRoot } from "./components/input/index.js";

export {
  Dialog,
  DialogDescription,
  DialogTrigger,
  DialogOverlay,
  DialogContent,
  DialogPortal,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
  Root as DialogRoot,
  Description as DialogDescriptionRaw,
  Trigger as DialogTriggerRaw,
  Overlay as DialogOverlayRaw,
  Content as DialogContentRaw,
  Portal as DialogPortalRaw,
  Footer as DialogFooterRaw,
  Header as DialogHeaderRaw,
  Title as DialogTitleRaw,
  Close as DialogCloseRaw,
} from "./components/dialog/index.js";

export {
  Drawer,
  DrawerDescription,
  DrawerNestedRoot,
  DrawerContent,
  DrawerOverlay,
  DrawerTrigger,
  DrawerFooter,
  DrawerHeader,
  DrawerPortal,
  DrawerTitle,
  DrawerClose,
  Root as DrawerRoot,
  Description as DrawerDescriptionRaw,
  NestedRoot as DrawerNestedRootRaw,
  Content as DrawerContentRaw,
  Overlay as DrawerOverlayRaw,
  Trigger as DrawerTriggerRaw,
  Footer as DrawerFooterRaw,
  Header as DrawerHeaderRaw,
  Portal as DrawerPortalRaw,
  Title as DrawerTitleRaw,
  Close as DrawerCloseRaw,
} from "./components/drawer/index.js";

export {
  Root as NavigationMenuRoot,
  Content as NavigationMenuContent,
  Indicator as NavigationMenuIndicator,
  Item as NavigationMenuItem,
  Link as NavigationMenuLink,
  List as NavigationMenuList,
  Trigger as NavigationMenuTrigger,
  Viewport as NavigationMenuViewport,
  // Raw exports
  Root,
  Content,
  Indicator,
  Item,
  Link,
  List,
  Trigger,
  Viewport,
} from "./components/navigation-menu/index.js";

export { PillButton } from "./components/pill-button/index.js";
export {
  SectionedFeed,
  FeedItem,
  ActivityEntry,
  PermissionFeedItem,
} from "./components/attention-queue/index.js";

export { MarkdownDisplay } from "./components/markdown/index.js";
export { TextShimmer } from "./components/text-shimmer/index.js";
export { DiffPill } from "./components/diff-pill/index.js";
export { FilePathBadge } from "./components/file-path-badge/index.js";
export { GitHubBadge } from "./components/github-badge/index.js";
export { InlineArtefactBadge } from "./components/inline-artefact-badge/index.js";
export { RichTokenText } from "./components/rich-token-text/index.js";
export { tokenizeInlineArtefacts } from "./lib/inline-artefact/index.js";
export type { InlineArtefactSegment, InlineArtefactTokenType } from "./lib/inline-artefact/index.js";
export { getFileIconSrc, getFallbackIconSrc, getFileIconName } from "./lib/file-icon/index.js";

// Checkpoint components
export {
  CheckpointTimeline,
  CheckpointCard,
  CheckpointFileList,
  CheckpointFileRow,
} from "./components/checkpoint/index.js";
export type {
  CheckpointData,
  CheckpointFile,
  CheckpointState,
  FileDiff,
  FileRowState,
} from "./components/checkpoint/index.js";
export { ProjectLetterBadge } from "./components/project-letter-badge/index.js";
export { ProjectCard } from "./components/project-card/index.js";
export {
	COLOR_NAMES,
	Colors,
	TAG_COLORS,
	TAG_BORDER_COLORS,
	isValidHexColor,
	normalizeColorName,
	resolveColorValue,
	getProjectColor,
	resolveProjectColor,
} from "./lib/colors.js";
export type {
  SectionedFeedSectionId,
  SectionedFeedGroup,
  SectionedFeedItemData,
  ActivityEntryMode,
  ActivityEntryTodoProgress,
  ActivityEntryQuestion,
  ActivityEntryQuestionOption,
  ActivityEntryQuestionProgress,
} from "./components/attention-queue/index.js";

export {
  ArrowRightIcon,
  BuildIcon,
  LoadingIcon,
  PlanIcon,
  RevertIcon,
} from "./components/icons/index.js";

// Git viewer components
export {
  GitViewer,
  GitCommitHeader,
  GitPrHeader,
  GitFileTree,
  GitDiffViewToggle,
  buildFileTree,
  flattenFileTree,
  compactSingleChildDirs,
} from "./components/git-viewer/index.js";
export type {
  GitViewerFile,
  GitCommitData,
  GitPrData,
  FileTreeNode,
} from "./components/git-viewer/index.js";

// Git panel components
export {
  GitPanelLayout,
  GitStatusList,
  GitStatusFileRow,
  GitCommitBox,
  GitBranchBadge,
  GitRemoteStatusBadge,
  GitStashList,
  GitLogList,
} from "./components/git-panel/index.js";
export type {
  GitIndexStatus,
  GitWorktreeStatus,
  GitStatusFile,
  GitStashEntry,
  GitLogEntry,
  GitRemoteStatus,
} from "./components/git-panel/index.js";

// Agent panel components
export {
  AgentPanelLayout,
  AgentPanelHeader,
  AgentPanelStatusIcon,
  AgentUserMessage,
  AgentAssistantMessage,
  AgentToolRow,
  AgentToolExecute,
  AgentToolSearch,
  AgentToolTask,
  AgentToolRead,
  AgentToolReadLints,
  AgentToolEdit,
  AgentToolTodo,
  TodoNumberIcon,
  AgentToolSkill,
  AgentToolQuestion,
  AgentInputStub,
} from "./components/agent-panel/index.js";
export type {
  AgentSessionStatus,
  AgentToolStatus,
  AgentToolKind,
  LintDiagnostic,
  AgentUserEntry,
  AgentAssistantEntry,
  AgentToolEntry,
  AgentThinkingEntry,
  AnyAgentEntry,
  AgentTodoStatus,
  AgentTodoItem,
  AgentQuestionOption,
  AgentQuestion,
} from "./components/agent-panel/index.js";

// Selector
export { Selector } from "./components/selector/index.js";
export {
  EmbeddedPanelHeader,
  HeaderCell,
  HeaderTitleCell,
  HeaderActionCell,
  HeaderDivider,
  EmbeddedIconButton,
  CloseAction,
  FullscreenAction,
  OverflowMenuTriggerAction,
  BrowserNavActions,
  SegmentedToggleGroup,
} from "./components/panel-header/index.js";

// User Reports
export { UserReportsModal } from "./components/user-reports/index.js";

// Icon context
export { setIconConfig, getIconBasePath } from "./lib/icon-context.js";

// Re-export utilities
export { cn } from "./lib/utils";
export type {
  WithElementRef,
  WithoutChild,
  WithoutChildren,
  WithoutChildrenOrChild,
} from "./lib/utils";
