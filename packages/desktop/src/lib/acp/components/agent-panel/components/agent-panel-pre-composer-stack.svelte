<script lang="ts">
import { Tree } from "@acepe/ui/icons";
import type { MergeStrategy } from "$lib/utils/tauri-client/git.js";
import type { PrDetails } from "$lib/utils/tauri-client/git.js";
import type { IssueReportDraft } from "$lib/errors/issue-report.js";
import { resolveIssueActionLabel } from "$lib/errors/issue-report.js";
import type { AgentInfo } from "../../../logic/agent-manager.js";
import type { Project } from "../../../logic/project-manager.svelte.js";
import type {
	SessionLinkedPr,
	SessionPrLinkMode,
	SessionPrLinkReference,
} from "../../../application/dto/session-linked-pr";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type { TodoState } from "../../../types/todo.js";
import type { PrGenerationConfig } from "../../modified-files/types/pr-generation-config.js";
import PrStatusCard from "../../pr-status-card/pr-status-card.svelte";
import ModifiedFilesHeader from "../../modified-files/modified-files-header.svelte";
import {
	AgentPanelQueueCardStrip as SharedQueueCardStrip,
	AgentPanelTodoHeader as SharedTodoHeader,
	AgentPanelSignInCard as SharedSignInCard,
} from "@acepe/ui/agent-panel";
import CopyButton from "../../messages/copy-button.svelte";
import PermissionBar from "../../tool-calls/permission-bar.svelte";
import PreSessionWorktreeCard from "./pre-session-worktree-card.svelte";
import WorktreeSetupCard from "./worktree-setup-card.svelte";
import AgentInstallCard from "./agent-install-card.svelte";
import AgentErrorCard from "./agent-error-card.svelte";
import type { WorktreeSetupState } from "../logic/worktree-setup-events.js";
import type { ShipCardData } from "../../ship-card/ship-card-parser.js";

type QueueStripMessage = {
	id: string;
	content: string;
	attachmentCount: number;
	attachments: Array<{
		id: string;
		displayName: string;
		extension: string | null;
		kind: "image" | "other" | "file";
	}>;
};

type ErrorInfo = { title: string; summary?: string | null; details?: string | null };

let {
	reviewMode,
	showConversationChrome,
	worktreeDeleted,
	centeredFullscreenContent,
	showInlineErrorCard,
	errorInfo,
	inlineErrorReferenceId,
	inlineErrorReferenceSearchable,
	onRetryConnection,
	isRetryingConnection = false,
	onDismissError,
	onCopyInlineErrorReference,
	inlineErrorIssueDraft,
	onIssueFromInlineError,
	preSessionWorktreeFailure,
	worktreeToggleProjectPath,
	worktreePending,
	onPreSessionWorktreeYes,
	onPreSessionWorktreeNo,
	onPreSessionWorktreeDismiss,
	onRetryWorktree,
	worktreeSetupState,
	agentInstallState,
	sessionId,
	effectiveProjectPath,
	sessionProjectPath,
	effectivePathForGit,
	createdPr,
	createPrRunning,
	prCardRenderKey,
	prDetails,
	prFetchError,
	linkedPr,
	prLinkMode,
	projectPrLinkReferences,
	projectForPr,
	streamingShipData,
	modifiedFilesState,
	onEnterReviewMode,
	onOpenReviewDialog,
	onCreatePr,
	createPrLabel,
	onMergePr,
	mergePrRunning,
	availableAgents,
	effectivePanelAgentId,
	sessionCurrentModelId,
	effectiveTheme,
	showTodoHeader,
	todoState,
	getTodoMarkdown,
	queueStripMessages,
	queueIsPaused,
	onQueueCancel,
	onQueueRemoveAttachment,
	onQueueClear,
	onQueueResume,
	onQueueSendNow,
	signInRequirement,
	onDismissSignIn,
}: {
	reviewMode: boolean;
	showConversationChrome: boolean;
	worktreeDeleted: boolean;
	centeredFullscreenContent: boolean;
	showInlineErrorCard: boolean;
	errorInfo: ErrorInfo;
	inlineErrorReferenceId: string | null;
	inlineErrorReferenceSearchable: boolean;
	onRetryConnection: () => void;
	isRetryingConnection?: boolean;
	onDismissError: () => void;
	onCopyInlineErrorReference: () => void;
	inlineErrorIssueDraft: IssueReportDraft | null;
	onIssueFromInlineError: () => void;
	preSessionWorktreeFailure: string | null;
	worktreeToggleProjectPath: string | null;
	worktreePending: boolean;
	onPreSessionWorktreeYes: () => void;
	onPreSessionWorktreeNo: () => void;
	onPreSessionWorktreeDismiss: () => void;
	onRetryWorktree: () => void;
	worktreeSetupState: WorktreeSetupState | null;
	agentInstallState: {
		agentId: string;
		agentName: string;
		stage: string;
		progress: number;
	} | null;
	sessionId: string | null;
	effectiveProjectPath: string | null;
	sessionProjectPath: string | null;
	effectivePathForGit: string | null;
	createdPr: number | null;
	createPrRunning: boolean;
	prCardRenderKey: number;
	prDetails: PrDetails | null;
	prFetchError: string | null;
	linkedPr: SessionLinkedPr | null;
	prLinkMode: SessionPrLinkMode | null;
	projectPrLinkReferences: readonly SessionPrLinkReference[];
	projectForPr: Project | null;
	streamingShipData: ShipCardData | null;
	modifiedFilesState: ModifiedFilesState | null;
	onEnterReviewMode: (s: ModifiedFilesState) => void;
	onOpenReviewDialog?: (s: ModifiedFilesState, fileIndex: number) => void;
	onCreatePr: ((config?: PrGenerationConfig) => void) | undefined;
	createPrLabel: string | null;
	onMergePr: (strategy: MergeStrategy) => void;
	mergePrRunning: boolean;
	availableAgents: AgentInfo[];
	effectivePanelAgentId: string | null;
	sessionCurrentModelId: string | null;
	effectiveTheme: "light" | "dark";
	showTodoHeader: boolean;
	todoState: TodoState | null;
	getTodoMarkdown: () => string;
	queueStripMessages: QueueStripMessage[];
	queueIsPaused: boolean;
	onQueueCancel: (messageId: string) => void;
	onQueueRemoveAttachment: (messageId: string, attachmentId: string) => void;
	onQueueClear: () => void;
	onQueueResume: (() => void) | undefined;
	onQueueSendNow: (messageId: string) => void;
	signInRequirement: { agent: string; instructions: string } | null;
	onDismissSignIn: () => void;
} = $props();

function resolveSignInCommand(agentDisplayName: string): string | null {
	switch (agentDisplayName.toLowerCase()) {
		case "cursor":
			return "agent login";
		default:
			return null;
	}
}
</script>

<div style:display={reviewMode ? "none" : undefined}>
	{#if showConversationChrome}
		{#if worktreeDeleted}
			<div class="{centeredFullscreenContent ? 'flex justify-center' : ''} px-5 mb-2">
				<div class="flex justify-center {centeredFullscreenContent ? 'w-full max-w-4xl' : ''}">
					<div class="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-accent">
						<Tree class="size-3 shrink-0 text-destructive" weight="fill" />
						<span class="text-[0.6875rem] text-muted-foreground">
							{"The worktree associated with this session has been deleted."}
						</span>
					</div>
				</div>
			</div>
		{/if}
		<div class="flex shrink-0 flex-col gap-0.5 pb-1">
			<div class={centeredFullscreenContent ? "flex justify-center" : ""}>
				<div class={centeredFullscreenContent ? "w-full max-w-[60%]" : ""}>
					<div class="flex flex-col gap-0.5 px-5">
						{#if signInRequirement}
							<SharedSignInCard
								title="Sign in to continue"
								message={signInRequirement.instructions}
								command={resolveSignInCommand(signInRequirement.agent)}
								onDismiss={onDismissSignIn}
							/>
						{/if}
						{#if showInlineErrorCard}
							<AgentErrorCard
								title={errorInfo.title}
								summary={errorInfo.summary ?? "Failed to connect to agent"}
								details={errorInfo.details ?? "Unknown error"}
								isRetrying={isRetryingConnection}
								onRetry={onRetryConnection}
								onDismiss={onDismissError}
								issueActionLabel={inlineErrorIssueDraft
									? resolveIssueActionLabel(inlineErrorIssueDraft)
									: "Create issue"}
								onIssueAction={inlineErrorIssueDraft ? onIssueFromInlineError : undefined}
							/>
						{/if}
						{#if preSessionWorktreeFailure && worktreeToggleProjectPath}
							<PreSessionWorktreeCard
								variant="card"
								pendingWorktreeEnabled={worktreePending}
								failureMessage={preSessionWorktreeFailure}
								projectPath={worktreeToggleProjectPath}
								onYes={onPreSessionWorktreeYes}
								onNo={onPreSessionWorktreeNo}
								onDismiss={onPreSessionWorktreeDismiss}
								onRetry={worktreePending ? onRetryWorktree : undefined}
							/>
						{/if}
						{#if worktreeSetupState?.isVisible}
							<WorktreeSetupCard state={worktreeSetupState} />
						{/if}
						{#if agentInstallState}
							<AgentInstallCard
								agentId={agentInstallState.agentId}
								agentName={agentInstallState.agentName}
								stage={agentInstallState.stage}
								progress={agentInstallState.progress}
							/>
						{/if}
						{#if sessionId}
							<PermissionBar
								sessionId={sessionId}
								projectPath={effectiveProjectPath ?? sessionProjectPath}
								hideRepresentedPermissions={true}
							/>
						{/if}
						{#if effectivePathForGit && (createdPr || createPrRunning || streamingShipData)}
							{#key prCardRenderKey}
								<PrStatusCard
									{sessionId}
									projectPath={effectivePathForGit}
									prNumber={createdPr}
									isCreating={createPrRunning}
									{prDetails}
									fetchError={prFetchError}
									{linkedPr}
									streamingData={streamingShipData}
								/>
							{/key}
						{/if}
						{#if modifiedFilesState}
							<ModifiedFilesHeader
								{modifiedFilesState}
								{sessionId}
								onEnterReviewMode={onEnterReviewMode}
								onOpenReviewDialog={onOpenReviewDialog}
								onCreatePr={onCreatePr}
								createPrLoading={createPrRunning}
								{createPrLabel}
								onMerge={createdPr && prDetails && prDetails.state !== "MERGED" ? onMergePr : undefined}
								merging={mergePrRunning}
								prState={prDetails ? prDetails.state : null}
								projectPath={sessionProjectPath}
								{linkedPr}
								{prLinkMode}
								{projectPrLinkReferences}
								project={projectForPr}
								{availableAgents}
								currentAgentId={effectivePanelAgentId}
								currentModelId={sessionCurrentModelId}
								{effectiveTheme}
							/>
						{/if}
						{#if showTodoHeader && todoState}
							<SharedTodoHeader
								items={todoState.items}
								currentTask={todoState.currentTask}
								completedCount={todoState.completedCount}
								totalCount={todoState.totalCount}
								isLive={todoState.isLive}
								allCompletedLabel={"All tasks completed"}
								pausedLabel={"Tasks paused"}
							>
								{#snippet copyButton()}
									<CopyButton getText={getTodoMarkdown} size={12} variant="icon" class="p-0.5" stopPropagation />
								{/snippet}
							</SharedTodoHeader>
						{/if}
						{#if sessionId && queueStripMessages.length > 0}
							<SharedQueueCardStrip
								messages={queueStripMessages}
								isPaused={queueIsPaused}
								queueLabel={"Queued"}
								pausedLabel={"Paused"}
								resumeLabel={"Resume"}
								clearLabel={"Clear queue"}
								sendLabel={"Send"}
								cancelLabel={"Cancel"}
								onCancel={onQueueCancel}
								onRemoveAttachment={onQueueRemoveAttachment}
								onClear={onQueueClear}
								onResume={onQueueResume}
								onSendNow={onQueueSendNow}
							/>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
