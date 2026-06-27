export interface ClaudeSparkSpecimen {
	readonly id: string;
	readonly label: string;
	readonly caption: string;
	readonly size: number;
}

export const claudeSparkSectionMeta = {
	title: "Claude working spark",
	description:
		"Claude's real \"working\" animation, reproduced 1:1 from the desktop app — an 84-frame alpha-mask sprite (48×48/frame) scrolled with steps() and tinted via currentColor. Replaces the agent icon while Claude is streaming (\"Planning next moves\").",
};

export const claudeSparkSpecimens: readonly ClaudeSparkSpecimen[] = [
	{
		id: "row",
		label: "In-row · 12px",
		caption: "As rendered left of \"Planning next moves\"",
		size: 12,
	},
	{
		id: "sm",
		label: "16px",
		caption: "Compact UI",
		size: 16,
	},
	{
		id: "md",
		label: "24px",
		caption: "Medium",
		size: 24,
	},
	{
		id: "lg",
		label: "48px",
		caption: "Native sprite frame size (48×48)",
		size: 48,
	},
	{
		id: "xl",
		label: "96px",
		caption: "Enlarged to inspect the morph",
		size: 96,
	},
];
