/**
 * Tab Bar Utilities - Pure functions for tab bar computation.
 */

import type { SessionEntry } from "../application/dto/session-entry.js";
import type { PermissionRequest } from "../types/permission.js";
import type { QuestionRequest } from "../types/question.js";
import type { ToolKind } from "../types/tool-kind.js";
import type { SessionState } from "./session-state.js";
import { deriveSessionState, statusToConnectionState } from "./session-state.js";
import { stripArtifactsFromTitle } from "./session-title-policy.js";
import type { Panel, SessionHotState } from "./types.js";

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
	readonly hotState: SessionHotState | null;
	readonly entries: ReadonlyArray<SessionEntry>;
	readonly pendingQuestion: QuestionRequest | null;
	readonly pendingPermission: PermissionRequest | null;
	readonly isUnseen: boolean;
	/** Project name for badge (from session/panel) */
	readonly projectName: string | null;
	/** Project color for badge */
	readonly projectColor: string | null;
	/** Project path for grouping */
	readonly projectPath: string | null;
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
	/** Project name for badge (null when no project selected) */
	readonly projectName: string | null;
	/** Project color for badge */
	readonly projectColor: string | null;
	/** Project path for grouping tabs by project */
	readonly projectPath: string | null;
	/** User message previews with tool call counts for tooltip display. */
	readonly conversationPreview: readonly ConversationTurn[];
	/**
	 * Unified session state model.
	 * Use this for state-dependent UI instead of individual boolean flags.
	 */
	readonly state: SessionState;
}

/**
 * Get the ToolKind of the most recent streaming tool call.
 *
 * Iterates entries from the end since streaming tool calls are always near the tail.
 * Returns null when no tool call is actively streaming.
 * Falls back to "other" when the tool call has no kind set.
 */
export function getCurrentToolKind(entries: ReadonlyArray<SessionEntry>): ToolKind | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "tool_call" && entry.isStreaming) {
			return entry.message.kind ?? "other";
		}
	}
	return null;
}

/**
 * Extract conversation turns: each user message + count of tool calls until the next user message.
 */
function extractConversationPreview(
	entries: ReadonlyArray<SessionEntry>
): readonly ConversationTurn[] {
	const turns: ConversationTurn[] = [];
	let toolCallCount = 0;

	for (const entry of entries) {
		if (entry.type === "tool_call") {
			toolCallCount++;
			continue;
		}
		if (entry.type !== "user" || entry.message.content.type !== "text") continue;

		const cleaned = stripArtifactsFromTitle(entry.message.content.text).trim();
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
	/** Tabs in this group, sorted by createdAt DESC */
	readonly tabs: readonly TabBarTab[];
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
		hotState,
		entries,
		pendingQuestion,
		pendingPermission,
		isUnseen,
		projectName,
		projectColor,
		projectPath,
	} = input;
	const status = hotState?.status ?? "idle";
	const currentToolKind = getCurrentToolKind(entries);

	// Derive unified session state
	const state = deriveSessionState({
		connectionState: statusToConnectionState(status),
		modeId: hotState?.currentMode?.id ?? null,
		tool: null, // Tab bar doesn't need full tool call
		pendingQuestion,
		pendingPermission,
		hasUnseenCompletion: isUnseen,
	});

	return {
		panelId: panel.id,
		sessionId: panel.sessionId,
		agentId,
		title,
		isFocused: panel.id === focusedPanelId,
		currentModeId: hotState?.currentMode?.id ?? null,
		isUnseen,
		currentToolKind,
		projectName,
		projectColor,
		projectPath,
		conversationPreview: extractConversationPreview(entries),
		state,
	};
}
