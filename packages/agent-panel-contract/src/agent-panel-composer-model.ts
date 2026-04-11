import type { AgentPanelActionDescriptor } from "./agent-panel-action-contract.js";

export interface AgentPanelComposerAttachment {
	id: string;
	label: string;
	kind: "file" | "folder" | "image" | "other";
	detail?: string | null;
}

export interface AgentPanelComposerSelectedModel {
	id: string;
	label: string;
	subtitle?: string | null;
	projectLabel?: string | null;
}

export interface AgentPanelComposerModel {
	draftText: string;
	placeholder: string;
	submitLabel: string;
	canSubmit: boolean;
	disabledReason?: string | null;
	isWaitingForSession?: boolean;
	isStreaming?: boolean;
	selectedModel?: AgentPanelComposerSelectedModel | null;
	attachments?: readonly AgentPanelComposerAttachment[];
	actions: readonly AgentPanelActionDescriptor[];
}
