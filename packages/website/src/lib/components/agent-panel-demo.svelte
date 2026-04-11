<script lang="ts">
import { AgentPanelScene } from "@acepe/ui";
import type { AgentPanelSceneModel } from "@acepe/ui/agent-panel";

import LandingDemoFrame from "./landing-demo-frame.svelte";

const scene: AgentPanelSceneModel = {
	panelId: "demo",
	status: "idle",
	header: {
		title: "New thread",
		status: "idle",
		actions: [],
	},
	conversation: {
		entries: [],
		isStreaming: false,
	},
	composer: {
		draftText: "",
		placeholder: "Ask a question or describe a task...",
		submitLabel: "Send",
		canSubmit: true,
		selectedModel: {
			id: "claude-sonnet-4",
			label: "Claude Sonnet 4",
		},
		actions: [
			{
				id: "composer.submit",
				label: "Send",
				state: "enabled",
			},
		],
	},
};
</script>

<LandingDemoFrame>
	{#snippet children()}
		<AgentPanelScene {scene} iconBasePath="/svgs/icons" />
	{/snippet}
</LandingDemoFrame>
