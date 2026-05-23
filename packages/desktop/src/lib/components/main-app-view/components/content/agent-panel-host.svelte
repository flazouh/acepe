<script lang="ts">
import { toast } from "svelte-sonner";
import AgentErrorCard from "$lib/acp/components/agent-panel/components/agent-error-card.svelte";
import { copyTextToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
import { buildAgentErrorIssueDraft } from "$lib/acp/components/agent-panel/logic/issue-report-draft.js";
import { AgentPanel } from "$lib/acp/components/index.js";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import type { AgentPanelProps } from "$lib/acp/components/agent-panel/types/agent-panel-props.js";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { ensureErrorReference } from "$lib/errors/error-reference.js";
import { resolveIssueActionLabel } from "$lib/errors/issue-report.js";
import type { Panel } from "$lib/acp/store/types.js";
import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";
import {
	formatAgentPanelBoundaryError,
	normalizeAgentPanelBoundaryError,
} from "./logic/agent-panel-host-boundary-error.js";
import { buildAgentPanelHostModel } from "./logic/agent-panel-host-model.js";

interface Props {
	panelId: string;
	panelRef: { current: Panel | null };
	projectManager: ProjectManager;
	state: MainAppViewState;
	availableAgents: AgentPanelProps["availableAgents"];
	hideProjectBadge: boolean;
	isFullscreen: boolean;
	isFocused: boolean;
	onFocusPanel?: (panelId: string) => void;
	onToggleFullscreenPanel?: (panelId: string) => void;
}

let {
	panelId,
	panelRef,
	projectManager,
	state,
	availableAgents,
	hideProjectBadge,
	isFullscreen,
	isFocused,
	onFocusPanel,
	onToggleFullscreenPanel,
}: Props = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();
const themeState = useTheme();

function logAgentPanelBoundaryError(nextPanelId: string, error: unknown): void {
	const normalized = normalizeAgentPanelBoundaryError(error);
	const reference = ensureErrorReference(normalized);
	console.error("[boundary:agent-panel]", nextPanelId, {
		name: normalized.name,
		message: normalized.message,
		stack: normalized.stack ?? null,
		referenceId: reference.referenceId,
		referenceSearchable: reference.searchable,
	});
}

function handleCopyBoundaryReference(referenceId: string | null): void {
	if (referenceId === null) {
		return;
	}

	void copyTextToClipboard(referenceId).match(
		() => {
			toast.success("Reference ID copied");
		},
		(error) => {
			toast.error(error.message);
		}
	);
}

const panel = $derived(panelRef.current);
const sessionIdentity = $derived.by(() => {
	const sessionId = panel?.sessionId ?? null;
	return sessionId !== null ? sessionStore.getSessionIdentity(sessionId) : undefined;
});
const sessionMetadata = $derived.by(() => {
	const sessionId = panel?.sessionId ?? null;
	return sessionId !== null ? sessionStore.getSessionMetadata(sessionId) : undefined;
});
const panelHotState = $derived(panel ? panelStore.getHotState(panel.id) : null);
const hostModel = $derived.by(() =>
	panel === null
		? null
		: buildAgentPanelHostModel({
				panel,
				sessionIdentity,
				projects: projectManager.projects,
				availableAgents,
				hotState: panelHotState,
			})
);
const projectPath = $derived(hostModel?.projectPath ?? null);
const project = $derived(hostModel?.project ?? null);
const selectedAgentId = $derived(hostModel?.selectedAgentId ?? null);
const isWaitingForSession = $derived(hostModel?.isWaitingForSession ?? false);
const hasAttachedFilePane = $derived(panel ? panelStore.hasAttachedFilePanels(panel.id) : false);
const reviewMode = $derived(hostModel?.reviewMode ?? false);
const reviewFilesState = $derived(hostModel?.reviewFilesState ?? null);
const reviewFileIndex = $derived(hostModel?.reviewFileIndex ?? 0);

function handleAgentChange(agentId: string): void {
	state.handlePanelAgentChange(panelId, agentId);
}

function handleClose(): void {
	state.handleClosePanel(panelId);
}

function handleCreateSessionForProject(project: Pick<Project, "path" | "name">) {
	return state.handleCreateSessionForProject(panelId, project).mapErr(() => {
		// Error handling is done in the handler.
	});
}

function handleSessionCreated(sessionId: string): void {
	panelStore.updatePanelSession(panelId, sessionId);
}

function handleResizePanel(targetPanelId: string, delta: number): void {
	state.handleResizePanel(targetPanelId, delta);
}

function handleToggleFullscreen(): void {
	if (onToggleFullscreenPanel) {
		onToggleFullscreenPanel(panelId);
		return;
	}
	state.handleToggleFullscreen(panelId);
}

function handleFocus(): void {
	if (onFocusPanel) {
		onFocusPanel(panelId);
		return;
	}
	state.handleFocusPanel(panelId);
}

function handleEnterReviewMode(
	modifiedFilesState: import("$lib/acp/types/modified-files-state.js").ModifiedFilesState,
	initialFileIndex: number
): void {
	panelStore.enterReviewMode(panelId, modifiedFilesState, initialFileIndex);
}

function handleExitReviewMode(): void {
	panelStore.exitReviewMode(panelId);
}

function handleReviewFileIndexChange(index: number): void {
	panelStore.setReviewFileIndex(panelId, index);
}

function handleCreateIssueReport(
	draft: Parameters<MainAppViewState["openUserReportsWithDraft"]>[0]
): void {
	state.openUserReportsWithDraft(draft);
}

</script>

{#if panel}
	<svelte:boundary onerror={(error) => logAgentPanelBoundaryError(panelId, error)}>
		<AgentPanel
			{panelId}
			sessionId={panel.sessionId}
			width={panel.width > 0 ? panel.width : 100}
			pendingProjectSelection={panel.pendingProjectSelection}
			{isWaitingForSession}
			projectCount={projectManager.projectCount}
			allProjects={projectManager.projects}
			{project}
			{selectedAgentId}
			{availableAgents}
			onAgentChange={handleAgentChange}
			effectiveTheme={themeState.effectiveTheme}
			{isFullscreen}
			{isFocused}
			onClose={handleClose}
			onCreateSessionForProject={handleCreateSessionForProject}
			onSessionCreated={handleSessionCreated}
			onResizePanel={handleResizePanel}
			onToggleFullscreen={handleToggleFullscreen}
			onFocus={handleFocus}
			{hideProjectBadge}
			{reviewMode}
			{reviewFilesState}
			{reviewFileIndex}
			onEnterReviewMode={handleEnterReviewMode}
			onExitReviewMode={handleExitReviewMode}
			onReviewFileIndexChange={handleReviewFileIndexChange}
			onCreateIssueReport={handleCreateIssueReport}
			{hasAttachedFilePane}
		/>
		{#snippet failed(error, reset)}
			{@const boundaryError = normalizeAgentPanelBoundaryError(error)}
			{@const boundaryReference = ensureErrorReference(boundaryError)}
			{@const boundaryIssueDraft = buildAgentErrorIssueDraft({
				agentId: selectedAgentId ?? "unknown",
				sessionId: panel?.sessionId ?? null,
				projectPath,
				worktreePath: null,
				errorSummary:
					boundaryError.message.length > 0
						? boundaryError.message
						: "Agent panel crashed while rendering.",
				errorDetails: formatAgentPanelBoundaryError(boundaryError),
				referenceId: boundaryReference.referenceId,
				referenceSearchable: boundaryReference.searchable,
				diagnosticsSummary: boundaryError.message,
				sessionTitle:
					panel?.sessionId !== null && panel?.sessionId !== undefined
						? (sessionMetadata?.title ?? null)
						: (panel?.sessionTitle ?? null),
				panelConnectionState: null,
			})}
			<div class="flex h-full flex-1 items-center justify-center p-4">
				<div class="w-full max-w-3xl">
					<AgentErrorCard
						title="Agent panel crashed"
						summary={boundaryError.message || "Unexpected render error"}
						details={formatAgentPanelBoundaryError(boundaryError)}
						referenceId={boundaryReference.referenceId}
						referenceSearchable={boundaryReference.searchable}
						onRetry={reset}
						onCopyReferenceId={() => handleCopyBoundaryReference(boundaryReference.referenceId)}
						issueActionLabel={resolveIssueActionLabel(boundaryIssueDraft)}
						onIssueAction={() => state.openUserReportsWithDraft(boundaryIssueDraft)}
					/>
				</div>
			</div>
		{/snippet}
	</svelte:boundary>
{/if}
