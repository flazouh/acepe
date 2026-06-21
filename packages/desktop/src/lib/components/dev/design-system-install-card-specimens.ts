export interface InstallCardSpecimen {
	readonly id: string;
	readonly label: string;
	readonly caption: string;
	readonly agentId: string;
	readonly agentName: string;
	readonly stage: string;
	readonly progress: number;
}

export const installCardSectionMeta = {
	title: "Agent install card",
	description:
		"Shown above the composer while Acepe downloads and prepares a managed agent runtime. Expand the row to inspect stage logs; progress uses the same segmented indicator as voice model downloads.",
};

export const installCardSpecimens: readonly InstallCardSpecimen[] = [
	{
		id: "starting",
		label: "Starting",
		caption: "0% · Resolving download source",
		agentId: "claude-code",
		agentName: "Claude Code",
		stage: "Connecting to registry…",
		progress: 0,
	},
	{
		id: "early",
		label: "Early download",
		caption: "12% · First bytes on the wire",
		agentId: "copilot",
		agentName: "GitHub Copilot",
		stage: "Downloading runtime",
		progress: 0.12,
	},
	{
		id: "mid",
		label: "Mid download",
		caption: "50% · Steady throughput",
		agentId: "codex",
		agentName: "Codex",
		stage: "Downloading runtime",
		progress: 0.5,
	},
	{
		id: "late",
		label: "Late download",
		caption: "86% · Extracting archive",
		agentId: "cursor",
		agentName: "Cursor",
		stage: "Extracting archive",
		progress: 0.86,
	},
	{
		id: "verify",
		label: "Verifying",
		caption: "96% · Checksum pass pending",
		agentId: "opencode",
		agentName: "OpenCode",
		stage: "Verifying checksum",
		progress: 0.96,
	},
	{
		id: "complete",
		label: "Finishing",
		caption: "100% · Handoff to launcher",
		agentId: "claude-code",
		agentName: "Claude Code",
		stage: "Finishing setup",
		progress: 1,
	},
];

export const featuredInstallCardSpecimen: InstallCardSpecimen = installCardSpecimens[2];
