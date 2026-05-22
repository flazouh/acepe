export type ModeIconKind =
	| "agent"
	| "plan"
	| "autonomous"
	| "bypass"
	| "ask"
	| "edit"
	| "review"
	| "unknown";

export interface AgentInputMode {
	id: string;
	name?: string;
	label?: string;
	description?: string | null;
	iconKind?: ModeIconKind;
}

export interface ModeDropdownOption {
	id: string;
	label: string;
	description?: string | null;
	iconKind: ModeIconKind;
	disabled?: boolean;
}

export const FALLBACK_MODE_OPTION: ModeDropdownOption = {
	id: "mode",
	label: "Mode",
	iconKind: "unknown",
};

export function getModeDropdownOptions(
	availableModes: readonly AgentInputMode[]
): readonly ModeDropdownOption[] {
	return availableModes.map((mode) => ({
		id: mode.id,
		label: mode.label ?? mode.name ?? mode.id,
		description: mode.description,
		iconKind: mode.iconKind ?? "unknown",
	}));
}

export function getSelectedModeOption(input: {
	modeOptions: readonly ModeDropdownOption[];
	currentModeId: string | null;
}): ModeDropdownOption {
	return (
		input.modeOptions.find((option) => option.id === input.currentModeId) ??
		input.modeOptions[0] ??
		FALLBACK_MODE_OPTION
	);
}

export function getModeIconColor(iconKind: ModeIconKind): string {
	switch (iconKind) {
		case "agent":
			return "var(--build-icon)";
		case "plan":
			return "var(--plan-icon)";
		case "autonomous":
			return "var(--chart-5)";
		case "bypass":
			return "#9858FF";
		case "ask":
			return "var(--chart-1)";
		case "edit":
			return "var(--chart-2)";
		case "review":
			return "var(--chart-3)";
		case "unknown":
			return "var(--muted-foreground)";
	}
}

export function shouldEmitModeChange(input: {
	nextModeId: string;
	currentModeId: string | null;
}): boolean {
	return input.nextModeId !== input.currentModeId;
}
