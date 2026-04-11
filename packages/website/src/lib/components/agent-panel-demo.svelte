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
};
</script>

<LandingDemoFrame>
	{#snippet children()}
		<AgentPanelScene {scene} iconBasePath="/svgs/icons" />
	{/snippet}
</LandingDemoFrame>
