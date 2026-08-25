export type AgentInputSubmitIntent = "send" | "steer" | "stop";

export interface AgentInputSubmitTooltipRow {
	readonly label: string;
	readonly description: string;
	readonly shortcut: string;
}

export interface AgentInputSubmitTooltipCopy {
	readonly stopLabel: string;
	readonly steerLabel: string;
	readonly steerDescription: string;
	readonly steerShortcut: string;
	readonly queueLabel: string;
	readonly queueDescription: string;
	readonly queueShortcut: string;
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
				description: "",
				shortcut: "",
			},
		];
	}

	return [
		{
			label: copy.steerLabel,
			description: copy.steerDescription,
			shortcut: copy.steerShortcut,
		},
		{
			label: copy.queueLabel,
			description: copy.queueDescription,
			shortcut: copy.queueShortcut,
		},
	];
}

export function getSubmitButtonAccessibleDescription(
	rows: readonly AgentInputSubmitTooltipRow[]
): string {
	return rows
		.map((row) => {
			if (row.shortcut.length > 0 && row.description.length > 0) {
				return `${row.label}: ${row.description} ${row.shortcut}`;
			}
			if (row.shortcut.length > 0) {
				return `${row.label} ${row.shortcut}`;
			}
			return row.label;
		})
		.join(" ");
}
