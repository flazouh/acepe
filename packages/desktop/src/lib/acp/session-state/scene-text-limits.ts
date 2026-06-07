/**
 * Display-text truncation for canonical scene entries, extracted from the
 * agent-panel graph materializer. Pure functions over text + tool entries; no
 * canonical state. `applySceneTextLimits` is a shape-preserving
 * (AgentToolEntry): AgentToolEntry transformer — the spread carve-out permitted
 * by the TypeScript conventions for cloning before per-field overrides.
 */
import type { AgentToolEntry, AnyAgentEntry } from "@acepe/ui/agent-panel/types";
import { AGENT_PANEL_SCENE_TEXT_LIMITS } from "./agent-panel-graph-materializer-types.js";

const TRUNCATION_SUFFIX = "\n[truncated]";

export function truncateDisplayText(
	value: string | null | undefined,
	limit: number
): string | null | undefined {
	if (value === null || value === undefined || value.length <= limit) {
		return value;
	}

	const available = Math.max(0, limit - TRUNCATION_SUFFIX.length);
	return `${value.slice(0, available)}${TRUNCATION_SUFFIX}`;
}

export function applySceneTextLimits(entry: AgentToolEntry): AgentToolEntry {
	const taskChildren: AnyAgentEntry[] | undefined =
		entry.taskChildren === undefined
			? undefined
			: entry.taskChildren.map((child) =>
					child.type === "tool_call" ? applySceneTextLimits(child) : child
				);

	return {
		...entry,
		detailsText:
			entry.detailsText === undefined
				? entry.detailsText
				: truncateDisplayText(entry.detailsText, AGENT_PANEL_SCENE_TEXT_LIMITS.details),
		stdout:
			entry.stdout === undefined
				? entry.stdout
				: truncateDisplayText(entry.stdout, AGENT_PANEL_SCENE_TEXT_LIMITS.output),
		stderr:
			entry.stderr === undefined
				? entry.stderr
				: truncateDisplayText(entry.stderr, AGENT_PANEL_SCENE_TEXT_LIMITS.output),
		resultText:
			entry.resultText === undefined
				? entry.resultText
				: truncateDisplayText(entry.resultText, AGENT_PANEL_SCENE_TEXT_LIMITS.result),
		taskResultText:
			entry.taskResultText === undefined
				? entry.taskResultText
				: truncateDisplayText(entry.taskResultText, AGENT_PANEL_SCENE_TEXT_LIMITS.result),
		taskChildren,
	};
}
