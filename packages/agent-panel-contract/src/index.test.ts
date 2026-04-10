import { expect, test } from "bun:test";

import {
	AGENT_PANEL_ACTION_IDS,
	type AgentPanelActionDescriptor,
	type AgentPanelSceneModel,
} from "./index";

test("package entrypoint exposes scene-contract primitives", () => {
	const headerActions: AgentPanelActionDescriptor[] = [
		{
			id: AGENT_PANEL_ACTION_IDS.header.copySessionMarkdown,
			label: "Copy",
			state: "enabled",
		},
	];

	const scene: AgentPanelSceneModel = {
		panelId: "panel-1",
		status: "running",
		header: {
			title: "JWT migration",
			status: "running",
			actions: headerActions,
		},
		conversation: {
			entries: [
				{
					id: "entry-1",
					type: "user",
					text: "Migrate our auth system to JWT tokens",
				},
			],
			isStreaming: true,
		},
		composer: {
			draftText: "",
			placeholder: "Ask your agent",
			submitLabel: "Send",
			canSubmit: true,
			actions: [
				{
					id: AGENT_PANEL_ACTION_IDS.composer.submit,
					label: "Send",
					state: "enabled",
				},
			],
		},
	};

	expect(scene.header.title).toBe("JWT migration");
	expect(scene.composer?.actions[0]?.id).toBe(AGENT_PANEL_ACTION_IDS.composer.submit);
});
