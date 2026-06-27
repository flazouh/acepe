export type MicButtonVisualState = "mic" | "spinner" | "stop" | "download_progress";

export interface MicButtonSpecimen {
	readonly id: string;
	readonly label: string;
	readonly caption: string;
	readonly visualState: MicButtonVisualState;
	readonly embeddedInGroup: boolean;
	readonly downloadPercent?: number;
	readonly disabled?: boolean;
}

export const micButtonSectionMeta = {
	title: "Composer mic button",
	description:
		"Voice dictation control in the composer trailing toolbar. Idle mic is muted; hover turns green (var(--success)); recording uses red stop affordance.",
};

export const micButtonSpecimens: readonly MicButtonSpecimen[] = [
	{
		id: "idle-standalone",
		label: "Idle",
		caption: "Standalone · hover fills icon green",
		visualState: "mic",
		embeddedInGroup: false,
	},
	{
		id: "idle-embedded",
		label: "Idle (fused)",
		caption: "Embedded in voice control group",
		visualState: "mic",
		embeddedInGroup: true,
	},
	{
		id: "recording-standalone",
		label: "Recording",
		caption: "Red stop circle with pulse glow",
		visualState: "stop",
		embeddedInGroup: false,
	},
	{
		id: "recording-embedded",
		label: "Recording (fused)",
		caption: "Compact stop control in fused shell",
		visualState: "stop",
		embeddedInGroup: true,
	},
	{
		id: "spinner",
		label: "Busy",
		caption: "Permission check or transcription in flight",
		visualState: "spinner",
		embeddedInGroup: true,
	},
	{
		id: "download-early",
		label: "Downloading model",
		caption: "18% · segmented progress bar",
		visualState: "download_progress",
		embeddedInGroup: true,
		downloadPercent: 18,
	},
	{
		id: "download-late",
		label: "Downloading model",
		caption: "72% · segmented progress bar",
		visualState: "download_progress",
		embeddedInGroup: true,
		downloadPercent: 72,
	},
	{
		id: "disabled",
		label: "Disabled",
		caption: "Composer dispatching or mic unavailable",
		visualState: "mic",
		embeddedInGroup: true,
		disabled: true,
	},
];

export const featuredMicButtonSpecimen: MicButtonSpecimen = micButtonSpecimens[1];
