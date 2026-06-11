import type { AgentPanelActionDescriptor } from "@acepe/ui/agent-panel/types";

export interface DesktopAgentPanelHeaderInput {
	title: string;
	subtitle?: string | null;
	agentLabel?: string | null;
	projectLabel?: string | null;
	projectColor?: string | null;
	branchLabel?: string | null;
	badges?: readonly {
		id: string;
		label: string;
		tone?: "neutral" | "info" | "success" | "warning" | "danger";
	}[];
	actions?: readonly AgentPanelActionDescriptor[];
}

export interface DesktopComposerInput {
	draftText: string;
	placeholder: string;
	submitLabel: string;
	canSubmit: boolean;
	disabledReason?: string | null;
	isWaitingForSession?: boolean;
	isStreaming?: boolean;
	selectedModelId?: string | null;
	selectedModelLabel?: string | null;
	selectedModelSubtitle?: string | null;
	projectLabel?: string | null;
	attachments?: readonly {
		id: string;
		label: string;
		kind: "file" | "folder" | "image" | "other";
		detail?: string | null;
	}[];
	showStop?: boolean;
}

export interface DesktopPrCardInput {
	description: string;
	filesChanged?: number | null;
	checksLabel?: string | null;
	isBusy?: boolean;
}

export interface DesktopWorktreeCardInput {
	description: string;
	stageLabel?: string | null;
	progressLabel?: string | null;
}

export interface DesktopInstallCardInput {
	description: string;
	stageLabel?: string | null;
	progressLabel?: string | null;
}

export interface DesktopErrorCardInput {
	title: string;
	description: string;
	details?: string | null;
}
