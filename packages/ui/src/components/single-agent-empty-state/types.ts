import type { Snippet } from "svelte";

import type { AgentInputContextPillItem, AgentInputPillItem } from "../agent-input/types.js";
import type { AgentSelectorViewItem } from "../agent-selector/types.js";
import type { BranchPickerDiffStats, BranchPickerVariant } from "../branch-picker/types.js";
import type { ProjectSelectorViewItem } from "../project-selector/types.js";

// ---------------------------------------------------------------------------
// Sub-models — each maps 1:1 to the core props of the corresponding UI shell.
// ---------------------------------------------------------------------------

/** Error card model — maps to AgentPanelErrorCard props. */
export interface SingleAgentEmptyStateErrorCardModel {
	title: string;
	summary: string;
	details: string;
	referenceId?: string;
	referenceSearchable?: boolean;
	issueActionLabel?: string;
	onDismiss?: () => void;
	onCopyReferenceId?: () => void;
	onIssueAction?: () => void;
	onRetry?: () => void;
}

/** Worktree card model — maps to PreSessionWorktreeCard props. */
export interface SingleAgentEmptyStateWorktreeCardModel {
	label?: string;
	yesLabel?: string;
	noLabel?: string;
	alwaysLabel?: string;
	pendingWorktreeEnabled: boolean;
	alwaysEnabled?: boolean;
	failureMessage?: string | null;
	onYes: () => void;
	onNo: () => void;
	onAlways: () => void;
	onDismiss: () => void;
	onRetry?: () => void;
}

/** Agent selector model — maps to AgentSelectorView core props. */
export interface SingleAgentEmptyStateAgentSelectorModel {
	agents: readonly AgentSelectorViewItem[];
	selectedAgentId: string | null;
	onSelect?: (agentId: string) => void;
	onToggleFavorite?: (agentId: string, nextFavorite: boolean) => void;
}

/** Project selector model — maps to ProjectSelectorView core props. */
export interface SingleAgentEmptyStateProjectSelectorModel {
	selectedProject: ProjectSelectorViewItem | null;
	recentProjects: readonly ProjectSelectorViewItem[];
	onSelect?: (projectPath: string) => void;
	onBrowse?: () => void;
}

/** Branch picker model — maps to BranchPickerView core props. */
export interface SingleAgentEmptyStateBranchPickerModel {
	currentBranch: string | null;
	diffStats: BranchPickerDiffStats | null;
	branches: readonly string[];
	isNotGitRepo?: boolean;
	canInitGitRepo?: boolean;
	variant?: BranchPickerVariant;
	onSelectBranch?: (branch: string) => void;
	onInitGitRepo?: () => void;
}

/** Agent input model — maps to AgentInputView core props. */
export interface SingleAgentEmptyStateAgentInputModel {
	placeholder?: string;
	value?: string;
	agentPills?: readonly AgentInputPillItem[];
	contextPills?: readonly AgentInputContextPillItem[];
	showAttachButton?: boolean;
	showVoiceButton?: boolean;
	showExpandButton?: boolean;
	isSending?: boolean;
	disabled?: boolean;
	onSend?: () => void;
	onAttach?: () => void;
	onVoice?: () => void;
	onExpand?: () => void;
	onInput?: (value: string) => void;
	onRemoveAgentPill?: (id: string) => void;
	onRemoveContextPill?: (id: string) => void;
}
