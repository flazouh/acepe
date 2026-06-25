/**
 * Tab Bar Utilities - Pure functions for tab bar computation.
 */

import type { TranscriptEntry } from "../../services/acp-types.js";
import { segmentText } from "../session-state/transcript-text.js";
import type {
	ComputerPermissionInteraction,
	PlanApprovalInteraction,
} from "../types/interaction.js";
import type { PermissionRequest } from "../types/permission.js";
import type { QuestionRequest } from "../types/question.js";
import type { ToolKind } from "../types/tool-kind.js";
import {
	deriveLiveSessionState,
	deriveLiveSessionWorkProjection,
	type LiveSessionWorkInput,
	type LiveSessionWorkSource,
} from "./live-session-work.js";
import type { SessionState } from "./session-state.js";
import { deriveSessionState } from "./session-state.js";
import { stripArtifactsFromTitle } from "./session-title-policy.js";
import { type SessionWorkBucket, selectSessionWorkBucket } from "./session-work-projection.js";
import type {
	BrowserWorkspacePanel,
	FileWorkspacePanel,
	GitWorkspacePanel,
	Panel,
	ReviewWorkspacePanel,
	TerminalWorkspacePanel,
} from "./types.js";

const MAX_PREVIEW_CHARS = 120;

/** A user message and the agent work that followed it. */
export interface ConversationTurn {
	readonly text: string;
	readonly toolCallCount: number;
}

/**
 * Inputs for deriving a single tab's state.
 */
export interface PanelToTabInput {
	readonly panel: Panel;
	readonly focusedPanelId: string | null;
	readonly agentId: string | null;
	readonly title: string | null;
	readonly liveSessionSource: LiveSessionWorkSource;
	readonly transcriptEntries: ReadonlyArray<TranscriptEntry> | null;
	readonly currentModeId: string | null;
	readonly currentToolKind: ToolKind | null;
	readonly pendingQuestion: QuestionRequest | null;
	readonly pendingPlanApproval: PlanApprovalInteraction | null;
	readonly pendingPermission: PermissionRequest | null;
	readonly pendingComputerPermission?: ComputerPermissionInteraction | null;
	readonly isUnseen: boolean;
	/** Project name for badge (from session/panel) */
	readonly projectName: string | null;
	/** Project color for badge */
	readonly projectColor: string | null;
	/** Project icon source for badge */
	readonly projectIconSrc: string | null;
	/** Project path for grouping */
	readonly projectPath: string | null;
	/** Per-project session sequence number for badge */
	readonly sequenceId: number | null;
}

export type NonAgentWorkspacePanel =
	| FileWorkspacePanel
	| TerminalWorkspacePanel
	| BrowserWorkspacePanel
	| ReviewWorkspacePanel
	| GitWorkspacePanel;

export interface NonAgentPanelToTabInput {
	readonly panel: NonAgentWorkspacePanel;
	readonly focusedPanelId: string | null;
	readonly projectName: string | null;
	readonly projectColor: string | null;
	readonly projectIconSrc: string | null;
}

/**
 * Tab data for rendering in the tab bar.
 */
export interface TabBarTab {
	readonly panelId: string;
	readonly sessionId: string | null;
	readonly agentId: string | null;
	readonly title: string | null;
	readonly isFocused: boolean;
	readonly currentModeId: string | null;
	readonly isUnseen: boolean;
	readonly currentToolKind: ToolKind | null;
	readonly workBucket: SessionWorkBucket;
	/** Project name for badge (null when no project selected) */
	readonly projectName: string | null;
	/** Project color for badge */
	readonly projectColor: string | null;
	/** Project icon source for badge */
	readonly projectIconSrc: string | null;
	/** Project path for grouping tabs by project */
	readonly projectPath: string | null;
	/** Per-project session sequence number, rendered inside the project badge. */
	readonly sequenceId: number | null;
	/** User message previews with tool call counts for tooltip display. */
	readonly conversationPreview: readonly ConversationTurn[] | null;
	/**
	 * Unified session state model.
	 * Use this for state-dependent UI instead of individual boolean flags.
	 */
	readonly state: SessionState;
}

/**
 * Extract conversation turns: each user message + count of tool calls until the next user message.
 */
function transcriptEntryText(entry: TranscriptEntry): string {
	return segmentText(entry);
}

function extractConversationPreview(
	entries: ReadonlyArray<TranscriptEntry>
): readonly ConversationTurn[] {
	const turns: ConversationTurn[] = [];
	let toolCallCount = 0;

	for (const entry of entries) {
		if (entry.role === "tool") {
			toolCallCount++;
			continue;
		}
		if (entry.role !== "user") continue;

		const cleaned = stripArtifactsFromTitle(transcriptEntryText(entry)).trim();
		if (cleaned.length === 0) continue;
		const firstLine = cleaned.split(/\r?\n/u)[0]?.trim() ?? "";
		if (firstLine.length === 0) continue;

		// Attach the tool call count from the *previous* turn to that turn
		if (turns.length > 0) {
			const prev = turns[turns.length - 1];
			turns[turns.length - 1] = { text: prev.text, toolCallCount };
		}
		toolCallCount = 0;

		const chars = Array.from(firstLine);
		const text =
			chars.length <= MAX_PREVIEW_CHARS
				? firstLine
				: `${chars.slice(0, MAX_PREVIEW_CHARS).join("")}...`;
		turns.push({ text, toolCallCount: 0 });
	}

	// Attach trailing tool calls to the last turn
	if (turns.length > 0 && toolCallCount > 0) {
		const last = turns[turns.length - 1];
		turns[turns.length - 1] = { text: last.text, toolCallCount };
	}

	return turns;
}

/**
 * Convert a panel and its associated state into a TabBarTab.
 *
 * Pure function — all state is passed in, no store dependencies.
 */
/**
 * Tabs grouped by project for rendering in the tab bar.
 */
export interface TabBarTabGroup {
	/** Project path (grouping key) */
	readonly projectPath: string;
	/** Project display name */
	readonly projectName: string;
	/** Resolved project hex color */
	readonly projectColor: string;
	/** Optional project icon source */
	readonly projectIconSrc: string | null;
	/** Tabs in this group, sorted by createdAt DESC */
	readonly tabs: readonly TabBarTab[];
}

/**
 * Sort flat tabs by their per-project session sequence number ascending
 * (smallest to biggest). Tabs without a sequence are pushed to the end.
 * Tabs with the same sequence are tie-broken by project sortOrder ascending,
 * then by projectPath for stability.
 */
export function sortTabsByProjectSortOrder(
	tabs: readonly TabBarTab[],
	getProjectSortOrder?: ((projectPath: string) => number | null) | null
): TabBarTab[] {
	return tabs.toSorted((a, b) => {
		const aSeq = a.sequenceId ?? Number.POSITIVE_INFINITY;
		const bSeq = b.sequenceId ?? Number.POSITIVE_INFINITY;
		if (aSeq !== bSeq) return aSeq - bSeq;

		const aOrder = a.projectPath
			? (getProjectSortOrder?.(a.projectPath) ?? Number.POSITIVE_INFINITY)
			: Number.POSITIVE_INFINITY;
		const bOrder = b.projectPath
			? (getProjectSortOrder?.(b.projectPath) ?? Number.POSITIVE_INFINITY)
			: Number.POSITIVE_INFINITY;
		if (aOrder !== bOrder) return aOrder - bOrder;

		return (a.projectPath ?? "").localeCompare(b.projectPath ?? "");
	});
}

/**
 * Group flat tabs by project path.
 * Groups are ordered by project creation date DESC (most recently added first).
 */
export function groupTabsByProject(
	tabs: readonly TabBarTab[],
	getProjectCreatedAt?: ((projectPath: string) => Date | null) | null
): TabBarTabGroup[] {
	const groupMap = new Map<string, TabBarTab[]>();

	for (const tab of tabs) {
		const key = tab.projectPath ?? "";
		const existing = groupMap.get(key);
		if (existing) {
			existing.push(tab);
		} else {
			groupMap.set(key, [tab]);
		}
	}

	const groups = Array.from(groupMap.entries()).map(([key, groupTabs]) => {
		const first = groupTabs[0];
		return {
			projectPath: key,
			projectName: first.projectName ?? "Unknown",
			projectColor: first.projectColor ?? "#4AD0FF",
			projectIconSrc: first.projectIconSrc ?? null,
			tabs: groupTabs,
		};
	});

	// Sort by project creation date DESC
	return groups.sort((a, b) => {
		const aTime = getProjectCreatedAt?.(a.projectPath)?.getTime() ?? 0;
		const bTime = getProjectCreatedAt?.(b.projectPath)?.getTime() ?? 0;
		return bTime - aTime;
	});
}

export function panelToTab(input: PanelToTabInput): TabBarTab {
	const {
		panel,
		focusedPanelId,
		agentId,
		title,
		liveSessionSource,
		transcriptEntries,
		currentModeId,
		currentToolKind: providedCurrentToolKind,
		pendingQuestion,
		pendingPlanApproval,
		pendingPermission,
		pendingComputerPermission = null,
		isUnseen,
		projectName,
		projectColor,
		projectIconSrc,
		projectPath,
		sequenceId,
	} = input;
	const currentToolKind = providedCurrentToolKind;
	const liveSessionInput: LiveSessionWorkInput = {
		source: liveSessionSource,
		currentModeId,
		interactionSnapshot: {
			pendingQuestion,
			pendingPlanApproval,
			pendingComputerPermission,
			pendingPermission,
		},
		hasUnseenCompletion: isUnseen,
	};
	const state = deriveLiveSessionState(liveSessionInput);
	const workProjection = deriveLiveSessionWorkProjection(liveSessionInput);

	return {
		panelId: panel.id,
		sessionId: panel.sessionId,
		agentId,
		title,
		isFocused: panel.id === focusedPanelId,
		currentModeId,
		isUnseen,
		currentToolKind,
		workBucket: selectSessionWorkBucket(workProjection),
		projectName,
		projectColor,
		projectIconSrc,
		projectPath,
		sequenceId,
		conversationPreview:
			panel.sessionId !== null && liveSessionSource.kind === "missing_canonical"
				? null
				: extractConversationPreview(transcriptEntries ?? []),
		state,
	};
}

function filePathToTitle(filePath: string): string {
	const segments = filePath.split("/");
	const lastSegment = segments[segments.length - 1];
	return lastSegment ? lastSegment : filePath;
}

function getNonAgentPanelTitle(panel: NonAgentWorkspacePanel): string {
	if (panel.kind === "file") {
		return filePathToTitle(panel.filePath);
	}
	if (panel.kind === "terminal") {
		return "Terminal";
	}
	if (panel.kind === "review") {
		return "Review";
	}
	if (panel.kind === "git") {
		return "Source Control";
	}
	return panel.title;
}

export function nonAgentPanelToTab(input: NonAgentPanelToTabInput): TabBarTab {
	const { panel, focusedPanelId, projectName, projectColor, projectIconSrc } = input;

	return {
		panelId: panel.id,
		sessionId: null,
		agentId: null,
		title: getNonAgentPanelTitle(panel),
		isFocused: panel.id === focusedPanelId,
		currentModeId: null,
		isUnseen: false,
		currentToolKind: null,
		workBucket: "idle",
		projectName,
		projectColor,
		projectIconSrc,
		projectPath: panel.projectPath,
		sequenceId: null,
		conversationPreview: [],
		state: deriveSessionState({
			connectionState: "disconnected",
			modeId: null,
			tool: null,
			pendingQuestion: null,
			pendingPlanApproval: null,
			pendingComputerPermission: null,
			pendingPermission: null,
			hasUnseenCompletion: false,
		}),
	};
}
