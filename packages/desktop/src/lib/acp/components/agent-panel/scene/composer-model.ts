import {
	AGENT_PANEL_ACTION_IDS,
	type AgentPanelActionDescriptor,
	type AgentPanelComposerModel,
} from "@acepe/ui/agent-panel/types";
import type { DesktopComposerInput } from "./scene-input-types.js";

export function buildDesktopComposerModel(input: DesktopComposerInput): AgentPanelComposerModel {
	const attachments = input.attachments
		? input.attachments.map((attachment) => {
				return {
					id: attachment.id,
					label: attachment.label,
					kind: attachment.kind,
					detail: attachment.detail ?? null,
				};
			})
		: [];

	const actions: AgentPanelActionDescriptor[] = [
		{
			id: AGENT_PANEL_ACTION_IDS.composer.attachFile,
			label: "Attach",
			state: "enabled",
		},
		{
			id: AGENT_PANEL_ACTION_IDS.composer.selectModel,
			label: "Model",
			state: "enabled",
		},
		{
			id: input.showStop
				? AGENT_PANEL_ACTION_IDS.composer.stop
				: AGENT_PANEL_ACTION_IDS.composer.submit,
			label: input.showStop ? "Stop" : input.submitLabel,
			state: input.canSubmit || input.showStop ? "enabled" : "disabled",
			disabledReason: input.disabledReason ?? null,
		},
	];

	return {
		draftText: input.draftText,
		placeholder: input.placeholder,
		submitLabel: input.submitLabel,
		canSubmit: input.canSubmit,
		disabledReason: input.disabledReason ?? null,
		isWaitingForSession: input.isWaitingForSession,
		isStreaming: input.isStreaming,
		selectedModel: input.selectedModelId
			? {
					id: input.selectedModelId,
					label: input.selectedModelLabel ?? input.selectedModelId,
					subtitle: input.selectedModelSubtitle ?? null,
					projectLabel: input.projectLabel ?? null,
				}
			: null,
		attachments,
		actions,
	};
}
