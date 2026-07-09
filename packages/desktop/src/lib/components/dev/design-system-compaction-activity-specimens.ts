import type { AgentSessionActivityEntry } from "@acepe/ui/agent-panel/types";

export interface CompactionActivitySpecimen {
	readonly id: string;
	readonly label: string;
	readonly caption: string;
	readonly entry: AgentSessionActivityEntry;
}

export const compactionActivitySectionMeta = {
	title: "Compaction activity",
	description:
		"Session-level compaction rendered as a seam in the transcript: a hairline rule with a centered cluster. Completed shows before/after context pressure with miniature fuel gauges; preparing shimmers without fake progress.",
};

export const compactionActivitySpecimens: readonly CompactionActivitySpecimen[] = [
	{
		id: "preparing",
		label: "Preparing",
		caption: "Indeterminate shimmer, aria-busy, no numbers",
		entry: {
			id: "specimen-compaction-preparing",
			type: "session_activity",
			activityKind: "compaction",
			title: "Compacting context",
			status: "preparing",
		},
	},
	{
		id: "completed",
		label: "Completed",
		caption: "Before/after gauges, compact counts, quiet detail line",
		entry: {
			id: "specimen-compaction-completed",
			type: "session_activity",
			activityKind: "compaction",
			title: "Context compacted",
			status: "completed",
			subtitle: "123,610 tokens freed",
			contextUsage: {
				preCompactionTokens: 142_010,
				postCompactionTokens: 18_400,
				contextWindowSize: 200_000,
			},
			metadata: [
				{ label: "Trigger", value: "Auto" },
				{ label: "Duration", value: "1.2 s" },
				{ label: "Preserved", value: "12" },
			],
		},
	},
	{
		id: "completed-minimal",
		label: "Completed · no usage",
		caption: "Falls back to title + metadata when counts are not comparable",
		entry: {
			id: "specimen-compaction-completed-minimal",
			type: "session_activity",
			activityKind: "compaction",
			title: "Context compacted",
			status: "completed",
			metadata: [
				{ label: "Trigger", value: "Manual" },
				{ label: "Precomputed", value: "Yes" },
			],
		},
	},
	{
		id: "usage-reset",
		label: "Usage reset",
		caption: "Meter reset without a summarization pass",
		entry: {
			id: "specimen-compaction-usage-reset",
			type: "session_activity",
			activityKind: "compaction",
			title: "Context usage reset",
			status: "usage_reset",
			subtitle: "Context meter reset",
			metadata: [{ label: "Trigger", value: "Auto" }],
		},
	},
	{
		id: "failed",
		label: "Failed",
		caption: "Destructive icon, transcript stays quiet",
		entry: {
			id: "specimen-compaction-failed",
			type: "session_activity",
			activityKind: "compaction",
			title: "Compaction failed",
			status: "failed",
			subtitle: "Provider rejected the summarization request",
			metadata: [{ label: "Trigger", value: "Auto" }],
		},
	},
];
