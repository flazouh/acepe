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

type ErrorLike = {
	message?: unknown;
	stack?: unknown;
	name?: unknown;
	backendCorrelationId?: unknown;
	backendEventId?: unknown;
};

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

function normalizeBoundaryError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}

	if (typeof error === "string" && error.length > 0) {
		return new Error(error);
	}

	if (error !== null && typeof error === "object") {
		const errorLike = error as ErrorLike;
		const message =
			typeof errorLike.message === "string" && errorLike.message.length > 0
				? errorLike.message
				: "Unknown agent panel error";
		const nextError = new Error(message);
		if (typeof errorLike.name === "string" && errorLike.name.length > 0) {
			nextError.name = errorLike.name;
		}
		if (typeof errorLike.stack === "string" && errorLike.stack.length > 0) {
			nextError.stack = errorLike.stack;
		}
		if (typeof errorLike.backendCorrelationId === "string") {
			(nextError as Error & { backendCorrelationId?: string }).backendCorrelationId =
				errorLike.backendCorrelationId;
		}
		if (typeof errorLike.backendEventId === "string") {
			(nextError as Error & { backendEventId?: string }).backendEventId = errorLike.backendEventId;
		}
		return nextError;
	}

	return new Error("Unknown agent panel error");
}

function formatBoundaryError(error: Error): string {
	const lines: string[] = [];
	if (error.name && error.name !== "Error") {
		lines.push(`${error.name}: ${error.message}`);
	} else {
		lines.push(error.message);
	}

	if (error.stack) {
		const stackLines = error.stack.split("\n");
		const firstLine = stackLines[0]?.trim() ?? "";
		const isMessageLine =
			firstLine === `${error.name}: ${error.message}` || firstLine === error.message;
		const relevantLines = isMessageLine ? stackLines.slice(1) : stackLines;

		if (relevantLines.length > 0) {
			lines.push("");
			lines.push("Stack trace:");
			lines.push(...relevantLines.slice(0, 30));
		}
	}

	return lines.join("\n");
}

function logAgentPanelBoundaryError(nextPanelId: string, error: unknown): void {
	const normalized = normalizeBoundaryError(error);
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
const session = $derived.by(() => {
	const sessionId = panel?.sessionId ?? null;
	return sessionId !== null ? sessionStore.getSessionCold(sessionId) : undefined;
});
const panelHotState = $derived(panel ? panelStore.getHotState(panel.id) : null);
const projectPath = $derived(session?.projectPath ?? panel?.projectPath ?? null);
const project = $derived.by(() => {
	if (!projectPath) {
		return null;
	}
	return projectManager.projects.find((candidate) => candidate.path === projectPath) ?? null;
});
const selectedAgentId = $derived.by(() => {
	const configuredAgentId = panel?.selectedAgentId ?? null;
	if (configuredAgentId === null) {
		return null;
	}
	return availableAgents.some((agent) => agent.id === configuredAgentId) ? configuredAgentId : null;
});
const isWaitingForSession = $derived.by(() => {
	const sessionId = panel?.sessionId ?? null;
	return sessionId !== null && session === undefined;
});
const attachedFilePanels = $derived(panel ? panelStore.getAttachedFilePanels(panel.id) : []);
const activeAttachedFilePanelId = $derived(
	panel ? panelStore.getActiveFilePanelId(panel.id) : null
);
const reviewMode = $derived(panelHotState?.reviewMode ?? false);
const reviewFilesState = $derived(panelHotState?.reviewFilesState ?? null);
const reviewFileIndex = $derived(panelHotState?.reviewFileIndex ?? 0);

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

function handleSelectAttachedFilePanel(ownerPanelId: string, filePanelId: string): void {
	panelStore.setActiveAttachedFilePanel(ownerPanelId, filePanelId);
}

function handleCloseAttachedFilePanel(filePanelId: string): void {
	panelStore.closeFilePanel(filePanelId);
}

function handleResizeAttachedFilePanel(filePanelId: string, delta: number): void {
	panelStore.resizeFilePanel(filePanelId, delta);
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
			{attachedFilePanels}
			{activeAttachedFilePanelId}
			onSelectAttachedFilePanel={handleSelectAttachedFilePanel}
			onCloseAttachedFilePanel={handleCloseAttachedFilePanel}
			onResizeAttachedFilePanel={handleResizeAttachedFilePanel}
		/>
		{#snippet failed(error, reset)}
			{@const boundaryError = normalizeBoundaryError(error)}
			{@const boundaryReference = ensureErrorReference(boundaryError)}
			{@const boundaryIssueDraft = buildAgentErrorIssueDraft({
				agentId: selectedAgentId ?? session?.agentId ?? panel?.agentId ?? "unknown",
				sessionId: panel?.sessionId ?? null,
				projectPath,
				worktreePath: null,
				errorSummary:
					boundaryError.message.length > 0
						? boundaryError.message
						: "Agent panel crashed while rendering.",
				errorDetails: formatBoundaryError(boundaryError),
				referenceId: boundaryReference.referenceId,
				referenceSearchable: boundaryReference.searchable,
				diagnosticsSummary: boundaryError.message,
				sessionTitle: session?.title ?? panel?.sessionTitle ?? null,
				panelConnectionState: null,
			})}
			<div class="flex h-full flex-1 items-center justify-center p-4">
				<div class="w-full max-w-3xl">
					<AgentErrorCard
						title="Agent panel crashed"
						summary={boundaryError.message || "Unexpected render error"}
						details={formatBoundaryError(boundaryError)}
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
