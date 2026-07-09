import type { AgentSessionActivityEntry } from "@acepe/ui/agent-panel";

export interface CompactionActivitySpecimen {
	readonly id: string;
	readonly label: string;
	readonly caption: string;
	readonly entry: AgentSessionActivityEntry;
}

export const compactionActivitySectionMeta = {
	title: "Compaction activity",
	description:
		"Session activity shown when an agent compacts its context. Specimens cover preparation, completion, context reset, and failure states.",
};

export const compactionActivitySpecimens: readonly CompactionActivitySpecimen[] = [
	{
		id: "preparing",
		label: "Preparing",
		caption: "Compaction has started and token totals are not available yet.",
		entry: {
			id: "compaction-preparing",
			type: "session_activity",
			activityKind: "compaction",
			title: "Compacting conversation",
			status: "preparing",
			subtitle: "Preparing a compact context summary",
			metadata: [{ label: "Trigger", value: "Auto" }],
		},
	},
	{
		id: "completed",
		label: "Completed",
		caption: "Full provider metadata is available after compaction finishes.",
		entry: {
			id: "compaction-completed",
			type: "session_activity",
			activityKind: "compaction",
			title: "Compaction done",
			status: "completed",
			subtitle: "138,000 tokens freed",
			contextUsage: {
				preCompactionTokens: 182_000,
				postCompactionTokens: 44_000,
				contextWindowSize: 200_000,
			},
			metadata: [
				{ label: "Trigger", value: "Auto" },
				{ label: "Duration", value: "1.8s" },
				{ label: "Precomputed", value: "Yes" },
				{ label: "Preserved", value: "12 messages" },
				{ label: "Dropped total", value: "276,000" },
			],
		},
	},
	{
		id: "usage-reset",
		label: "Usage reset",
		caption: "Fallback event when the provider only reports that its context meter reset.",
		entry: {
			id: "compaction-usage-reset",
			type: "session_activity",
			activityKind: "compaction",
			title: "Context compacted",
			status: "usage_reset",
			subtitle: "Context meter reset",
			metadata: [{ label: "Trigger", value: "Unknown" }],
		},
	},
	{
		id: "failed",
		label: "Failed",
		caption: "The session remains usable, but compaction did not complete.",
		entry: {
			id: "compaction-failed",
			type: "session_activity",
			activityKind: "compaction",
			title: "Compaction failed",
			status: "failed",
			subtitle: "The provider could not compact this conversation",
			metadata: [{ label: "Trigger", value: "Manual" }],
		},
	},
];
