export type AgentInputSubmitIntent = "send" | "steer" | "stop";

export interface AgentInputSubmitTooltipRow {
	readonly label: string;
	readonly shortcut: readonly string[];
}

export interface AgentInputSubmitTooltipCopy {
	readonly stopLabel: string;
	readonly steerLabel: string;
	readonly steerShortcut: readonly string[];
	readonly queueLabel: string;
	readonly queueShortcut: readonly string[];
}

export function getSubmitButtonIconName(
	intent: AgentInputSubmitIntent
): "stop" | "arrow-up-02" {
	if (intent === "stop") {
		return "stop";
	}
	return "arrow-up-02";
}

export function getSubmitButtonTooltipRows(
	intent: AgentInputSubmitIntent,
	copy: AgentInputSubmitTooltipCopy
): readonly AgentInputSubmitTooltipRow[] {
	if (intent === "stop") {
		return [
			{
				label: copy.stopLabel,
				shortcut: [],
			},
		];
	}

	return [
		{
			label: copy.steerLabel,
			shortcut: copy.steerShortcut,
		},
		{
			label: copy.queueLabel,
			shortcut: copy.queueShortcut,
		},
	];
}

export function getSubmitButtonAccessibleDescription(
	rows: readonly AgentInputSubmitTooltipRow[]
): string {
	return rows
		.map((row) => {
			if (row.shortcut.length > 0) {
				return `${row.label} ${row.shortcut.join(" ")}`;
			}
			return row.label;
		})
		.join(" ");
}
