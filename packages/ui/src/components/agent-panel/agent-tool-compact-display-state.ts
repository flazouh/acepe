import {
	createEditToolPresentation,
	createReadLintsPresentation,
	resolveConversationRenderKind,
	type AgentToolEntry,
} from "./agent-panel-conversation-entry-model.js";
import type { AgentToolKind, AgentToolStatus } from "./types.js";
import { getEditHeaderLabel, getEditFileName, resolveEditHeaderState } from "./agent-tool-edit-state.js";
import { getExecuteHeaderText, extractExecuteCommandFilePath } from "./agent-tool-execute-state.js";
import { getFetchTargetText, getFetchTitle } from "./agent-tool-fetch-state.js";
import { getReadHeaderLabel } from "./agent-tool-read-state.js";
import { getSearchToolHeaderLabel } from "./agent-tool-search-state.js";
import {
	getSkillDisplayArgs,
	getSkillDisplayName,
	getSkillViewState,
} from "./agent-tool-skill-state.js";
import { getWebSearchHeaderLabel } from "./agent-tool-web-search-state.js";

export interface AgentToolCompactDisplay {
	readonly id: string;
	readonly kind?: AgentToolKind;
	readonly title: string;
	readonly subtitle?: string;
	readonly filePath?: string;
	readonly status: AgentToolStatus;
}

const COMPACT_SUBTITLE_LIMIT = 80;

function isToolPending(status: AgentToolStatus): boolean {
	return status === "pending" || status === "running";
}

function pendingDoneLabel(
	status: AgentToolStatus,
	pendingLabel: string,
	doneLabel: string
): string {
	return isToolPending(status) ? pendingLabel : doneLabel;
}

function truncateCompactSubtitle(value: string): string {
	if (value.length <= COMPACT_SUBTITLE_LIMIT) {
		return value;
	}
	return `${value.slice(0, COMPACT_SUBTITLE_LIMIT)}...`;
}

function getSearchVariant(entry: AgentToolEntry): "grep" | "glob" {
	if (entry.searchMode === "files") {
		return "glob";
	}
	return "grep";
}

function resolveCompactToolFilePath(entry: AgentToolEntry): string | undefined {
	if (entry.filePath) {
		return entry.filePath;
	}

	if (entry.kind === "edit") {
		const presentation = createEditToolPresentation(entry);
		if (presentation.filePath) {
			return presentation.filePath;
		}
		const primaryDiffPath = entry.editDiffs?.[0]?.filePath;
		if (primaryDiffPath) {
			return primaryDiffPath;
		}
	}

	if (entry.kind === "search" && entry.searchPath) {
		return entry.searchPath;
	}

	if (entry.kind === "execute" && entry.command) {
		const commandFilePath = extractExecuteCommandFilePath(entry.command);
		if (commandFilePath) {
			return commandFilePath;
		}
	}

	if (resolveConversationRenderKind(entry) === "tool-read-lints") {
		const lintFilePath = entry.lintDiagnostics?.[0]?.filePath;
		if (lintFilePath) {
			return lintFilePath;
		}
	}

	return undefined;
}

function getCompactToolTitle(entry: AgentToolEntry): string {
	const renderKind = resolveConversationRenderKind(entry);
	const status = entry.status;

	if (renderKind === "tool-read") {
		return getReadHeaderLabel(status, { runningLabel: "Reading", doneLabel: "Read" });
	}

	if (renderKind === "tool-read-lints") {
		return pendingDoneLabel(status, "Checking lints", "Read lints");
	}

	if (renderKind === "tool-edit") {
		const presentation = createEditToolPresentation(entry);
		const headerState = resolveEditHeaderState(
			status,
			presentation.applied,
			presentation.awaitingApproval
		);
		return getEditHeaderLabel(headerState, {
			editingLabel: "Editing",
			editedLabel: "Edited",
			awaitingApprovalLabel: "Awaiting",
			interruptedLabel: "Interrupted",
			failedLabel: "Failed",
			blockedLabel: "Blocked",
			cancelledLabel: "Cancelled",
			degradedLabel: "Degraded",
			pendingLabel: "Editing",
		});
	}

	if (renderKind === "tool-search") {
		return getSearchToolHeaderLabel({
			variant: getSearchVariant(entry),
			status,
			findingLabel: "Finding",
			foundLabel: "Found",
			greppingLabel: "Grepping",
			greppedLabel: "Grepped",
		});
	}

	if (renderKind === "tool-execute") {
		return getExecuteHeaderText({
			status,
			runningLabel: "Executing…",
			finishedLabel: "Executed",
		});
	}

	if (renderKind === "tool-web-search") {
		return getWebSearchHeaderLabel(status, {
			searchingLabel: "Searching",
			searchFailedLabel: "Search failed",
			searchedLabel: "Searched",
		});
	}

	if (renderKind === "tool-fetch") {
		return getFetchTitle(status, {
			fetchingLabel: "Fetching",
			fetchFailedLabel: "Fetch failed",
			fetchedLabel: "Fetched",
		});
	}

	if (renderKind === "tool-browser") {
		return pendingDoneLabel(status, "Browsing", "Browsed");
	}

	if (renderKind === "tool-skill") {
		const viewState = getSkillViewState({
			status,
			skillName: entry.skillName,
			description: entry.skillDescription,
		});
		if (viewState.showLoadingFallback) {
			return "Loading skill";
		}
		if (viewState.showMissingNameFallback) {
			return "Skill";
		}
		return pendingDoneLabel(status, "Running skill", "Ran skill");
	}

	if (renderKind === "tool-task") {
		return pendingDoneLabel(status, "Running task", "Task completed");
	}

	if (renderKind === "tool-todo") {
		return pendingDoneLabel(status, "Updating todos", "Updated todos");
	}

	if (renderKind === "tool-question") {
		return pendingDoneLabel(status, "Asking", "Asked");
	}

	if (renderKind === "tool-plan") {
		if (entry.kind === "exit_plan_mode") {
			return pendingDoneLabel(status, "Planning", "Plan ready");
		}
		return pendingDoneLabel(status, "Creating plan", "Plan created");
	}

	if (entry.kind === "delete") {
		return pendingDoneLabel(status, "Deleting", "Deleted");
	}

	if (entry.kind === "write") {
		return pendingDoneLabel(status, "Writing", "Written");
	}

	if (entry.kind === "think") {
		return pendingDoneLabel(status, "Thinking", "Thought");
	}

	if (entry.kind === "sql") {
		return pendingDoneLabel(status, "Running SQL", "Ran SQL");
	}

	if (isToolPending(status)) {
		return entry.title;
	}

	return entry.title;
}

function getCompactToolSubtitle(entry: AgentToolEntry, filePath?: string): string | undefined {
	if (entry.command) {
		const commandFilePath = extractExecuteCommandFilePath(entry.command);
		if (commandFilePath) {
			return undefined;
		}
		return truncateCompactSubtitle(entry.command);
	}

	if (entry.query) {
		return truncateCompactSubtitle(entry.query);
	}

	if (entry.url) {
		const targetText = getFetchTargetText({ domain: entry.subtitle, url: entry.url });
		if (targetText) {
			return truncateCompactSubtitle(targetText);
		}
	}

	if (entry.skillName) {
		const skillName = getSkillDisplayName(entry.skillName);
		const skillArgs = getSkillDisplayArgs(entry.skillArgs);
		if (skillName && skillArgs) {
			return truncateCompactSubtitle(`${skillName} ${skillArgs}`);
		}
		if (skillName) {
			return skillName;
		}
	}

	if (entry.taskDescription) {
		return truncateCompactSubtitle(entry.taskDescription);
	}

	if (entry.question?.question) {
		return truncateCompactSubtitle(entry.question.question);
	}

	if (renderKindHasLintSummary(entry)) {
		const presentation = createReadLintsPresentation(entry);
		if (presentation.totalDiagnostics > 0) {
			return truncateCompactSubtitle(presentation.summaryLabel);
		}
	}

	if (entry.subtitle && entry.subtitle !== filePath) {
		return truncateCompactSubtitle(entry.subtitle);
	}

	if (entry.detailsText) {
		return truncateCompactSubtitle(entry.detailsText);
	}

	if (filePath) {
		const fileName = getEditFileName(filePath);
		if (fileName && fileName !== filePath) {
			return undefined;
		}
	}

	return undefined;
}

function renderKindHasLintSummary(entry: AgentToolEntry): boolean {
	return resolveConversationRenderKind(entry) === "tool-read-lints";
}

export function mapAgentToolEntryToCompactDisplay(
	entry: AgentToolEntry
): AgentToolCompactDisplay {
	const filePath = resolveCompactToolFilePath(entry);

	return {
		id: entry.id,
		kind: entry.kind,
		title: getCompactToolTitle(entry),
		subtitle: getCompactToolSubtitle(entry, filePath),
		filePath,
		status: entry.status,
	};
}

export function getTaskCurrentToolDisplay(
	entry: AgentToolEntry | null
): AgentToolCompactDisplay | null {
	if (!entry) {
		return null;
	}

	return mapAgentToolEntryToCompactDisplay(entry);
}
