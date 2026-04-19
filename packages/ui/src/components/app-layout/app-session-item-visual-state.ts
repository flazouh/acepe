import type { AppSessionItem, AppSessionPrState } from "./types.js";

/**
 * Derived visual state for `AppSessionItem`.
 * Pure function — no DOM, no stores. The component renders each slot iff the
 * corresponding flag is true.
 */
export interface AppSessionItemVisualState {
	/** Active/selected row highlight. */
	readonly isActive: boolean;
	/** Streaming indicator (animated dot) takes precedence over status dots. */
	readonly showStreamingDot: boolean;
	/** When streaming is false, one of these status kinds may be shown. */
	readonly statusDotKind: "done" | "error" | "unseen" | null;
	/** Diff pill rendered only if insertions or deletions are non-zero. */
	readonly showDiffPill: boolean;
	/** Project letter badge requires all three of: sequenceId, projectName, projectColor. */
	readonly showProjectBadge: boolean;
	/** Worktree icon shown whenever worktreePath is present. */
	readonly showWorktreeIcon: boolean;
	/** Worktree icon uses destructive color when the worktree has been deleted. */
	readonly isWorktreeDeleted: boolean;
	/** Relative timestamp slot rendered iff timeAgo is non-empty. */
	readonly showTimeAgo: boolean;
	/** Secondary "last action" line rendered iff lastActionText is non-empty. */
	readonly showLastAction: boolean;
	/** PR badge rendered iff prNumber is set; defaults state to OPEN. */
	readonly showPrBadge: boolean;
	readonly prState: AppSessionPrState | null;
	/** Agent icon shown iff agentIconSrc is set. */
	readonly showAgentIcon: boolean;
}

export function resolveAppSessionItemVisualState(
	session: AppSessionItem
): AppSessionItemVisualState {
	const insertions = session.insertions ?? 0;
	const deletions = session.deletions ?? 0;
	const hasDiff = insertions > 0 || deletions > 0;

	const isStreaming = session.isStreaming === true || session.status === "running";

	let statusDotKind: AppSessionItemVisualState["statusDotKind"] = null;
	if (!isStreaming) {
		if (session.status === "done") statusDotKind = "done";
		else if (session.status === "error") statusDotKind = "error";
		else if (session.status === "unseen") statusDotKind = "unseen";
	}

	const showProjectBadge =
		session.sequenceId != null &&
		session.projectName != null &&
		session.projectColor != null;

	const showWorktreeIcon =
		session.worktreePath != null && session.worktreePath.length > 0;

	const showTimeAgo = session.timeAgo != null && session.timeAgo.length > 0;
	const showLastAction =
		session.lastActionText != null && session.lastActionText.length > 0;

	const showPrBadge = session.prNumber != null;
	const prState: AppSessionPrState | null = showPrBadge
		? (session.prState ?? "OPEN")
		: null;

	const showAgentIcon =
		session.agentIconSrc != null && session.agentIconSrc.length > 0;

	return {
		isActive: session.isActive === true,
		showStreamingDot: isStreaming,
		statusDotKind,
		showDiffPill: hasDiff,
		showProjectBadge,
		showWorktreeIcon,
		isWorktreeDeleted: session.worktreeDeleted === true,
		showTimeAgo,
		showLastAction,
		showPrBadge,
		prState,
		showAgentIcon,
	};
}
