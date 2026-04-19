<script lang="ts">
import { Tree } from "phosphor-svelte";
import type { MergeStrategy } from "$lib/utils/tauri-client/git.js";
import type { PrDetails } from "$lib/utils/tauri-client/git.js";
import type { IssueReportDraft } from "$lib/errors/issue-report.js";
import { resolveIssueActionLabel } from "$lib/errors/issue-report.js";
import type { AgentInfo } from "../../../logic/agent-manager.js";
import type { SessionEntry } from "../../../application/dto/session";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type { TodoState } from "../../../types/todo.js";
import type { PrGenerationConfig } from "../../modified-files/types/pr-generation-config.js";
import PrStatusCard from "../../pr-status-card/pr-status-card.svelte";
import ModifiedFilesHeader from "../../modified-files/modified-files-header.svelte";
import { AgentPanelQueueCardStrip as SharedQueueCardStrip } from "@acepe/ui/agent-panel";
import { AgentPanelTodoHeader as SharedTodoHeader } from "@acepe/ui/agent-panel";
import CopyButton from "../../messages/copy-button.svelte";
import PermissionBar from "../../tool-calls/permission-bar.svelte";
import PreSessionWorktreeCard from "./pre-session-worktree-card.svelte";
import WorktreeSetupCard from "./worktree-setup-card.svelte";
import AgentInstallCard from "./agent-install-card.svelte";
import AgentErrorCard from "./agent-error-card.svelte";
import { getWorktreeDefaultStore } from "../../worktree/worktree-default-store.svelte.js";
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
	onDismissError,
	onCopyInlineErrorReference,
	inlineErrorIssueDraft,
	onIssueFromInlineError,
	showPreSessionWorktreeCard,
	worktreePending,
	worktreeToggleProjectPath,
	effectiveProjectName,
	preSessionWorktreeFailure,
	onPreSessionWorktreeYes,
	onPreSessionWorktreeNo,
	onPreSessionWorktreeAlways,
	onPreSessionWorktreeDismiss,
	onRetryWorktree,
	worktreeSetupState,
	agentInstallState,
	sessionId,
	effectiveProjectPath,
	sessionProjectPath,
	sessionEntries,
	sessionTurnState,
	effectivePathForGit,
	createdPr,
	createPrRunning,
	prCardRenderKey,
	prDetails,
	prFetchError,
	streamingShipData,
	modifiedFilesState,
	onEnterReviewMode,
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
}: {
	reviewMode: boolean;
	showConversationChrome: boolean;
	worktreeDeleted: boolean;
	centeredFullscreenContent: boolean;
	showInlineErrorCard: boolean;
	errorInfo: ErrorInfo;
	inlineErrorReferenceId: string | null;
	inlineErrorReferenceSearchable: string | null;
	onRetryConnection: () => void;
	onDismissError: () => void;
	onCopyInlineErrorReference: () => void;
	inlineErrorIssueDraft: IssueReportDraft | null;
	onIssueFromInlineError: () => void;
	showPreSessionWorktreeCard: boolean;
	worktreePending: boolean;
	worktreeToggleProjectPath: string | null;
	effectiveProjectName: string | null;
	preSessionWorktreeFailure: string | null;
	onPreSessionWorktreeYes: () => void;
	onPreSessionWorktreeNo: () => void;
	onPreSessionWorktreeAlways: () => void;
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
	sessionEntries: SessionEntry[];
	sessionTurnState: string;
	effectivePathForGit: string | null;
	createdPr: number | null;
	createPrRunning: boolean;
	prCardRenderKey: number;
	prDetails: PrDetails | null;
	prFetchError: string | null;
	streamingShipData: ShipCardData | null;
	modifiedFilesState: ModifiedFilesState | null;
	onEnterReviewMode: (s: ModifiedFilesState) => void;
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
} = $props();
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
						{#if showInlineErrorCard}
							<AgentErrorCard
								title={errorInfo.title}
								summary={errorInfo.summary ?? "Failed to connect to agent"}
								details={errorInfo.details ?? "Unknown error"}
								referenceId={inlineErrorReferenceId}
								referenceSearchable={inlineErrorReferenceSearchable}
								onRetry={onRetryConnection}
								onDismiss={onDismissError}
								onCopyReferenceId={onCopyInlineErrorReference}
								issueActionLabel={inlineErrorIssueDraft
									? resolveIssueActionLabel(inlineErrorIssueDraft)
									: "Create issue"}
								onIssueAction={inlineErrorIssueDraft ? onIssueFromInlineError : undefined}
							/>
						{/if}
						{#if showPreSessionWorktreeCard && worktreeToggleProjectPath}
							<PreSessionWorktreeCard
								pendingWorktreeEnabled={worktreePending}
								alwaysEnabled={getWorktreeDefaultStore().globalDefault}
								failureMessage={preSessionWorktreeFailure}
								projectPath={worktreeToggleProjectPath}
								projectName={effectiveProjectName ?? null}
								onYes={onPreSessionWorktreeYes}
								onNo={onPreSessionWorktreeNo}
								onAlways={onPreSessionWorktreeAlways}
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
								entries={sessionEntries}
								turnState={sessionTurnState}
							/>
						{/if}
						{#if effectivePathForGit && (createdPr || createPrRunning || streamingShipData)}
							{#key prCardRenderKey}
								<PrStatusCard
									projectPath={effectivePathForGit}
									prNumber={createdPr}
									isCreating={createPrRunning}
									{prDetails}
									fetchError={prFetchError}
									streamingData={streamingShipData}
								/>
							{/key}
						{/if}
						{#if modifiedFilesState}
							<ModifiedFilesHeader
								{modifiedFilesState}
								{sessionId}
								onEnterReviewMode={onEnterReviewMode}
								onCreatePr={onCreatePr}
								createPrLoading={createPrRunning}
								{createPrLabel}
								onMerge={createdPr && prDetails && prDetails.state !== "MERGED" ? onMergePr : undefined}
								merging={mergePrRunning}
								prState={prDetails ? prDetails.state : null}
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
