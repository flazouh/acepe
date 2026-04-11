<script lang="ts">
import {
	AgentInputAutonomousToggle,
	AgentInputDivider,
	AgentInputEditor,
	AgentInputMetricsChip,
	AgentInputMicButton,
	AgentInputModeSelector,
	AgentInputModelTrigger,
	AgentInputToolbar,
	AgentPanelComposer,
	AgentPanelScene,
} from "@acepe/ui";
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

const availableModes = [
	{ id: "plan" },
	{ id: "build" },
] as const;
</script>

<LandingDemoFrame>
	{#snippet children()}
		<AgentPanelScene {scene} iconBasePath="/svgs/icons">
			{#snippet composerOverride()}
				<AgentPanelComposer
					class="border-t-0 p-0"
					inputClass="flex-shrink-0 border border-border bg-input/30"
					contentClass="p-2"
				>
					{#snippet content()}
						<AgentInputEditor
							placeholder="Plan, @ for context, / for commands"
							isEmpty={true}
							submitIntent="send"
							submitDisabled={true}
						/>
					{/snippet}
					{#snippet footer()}
						<AgentInputToolbar>
							{#snippet items()}
								<AgentInputModeSelector
									{availableModes}
									currentModeId="build"
									onModeChange={() => {}}
								/>
								<AgentInputDivider />
								<AgentInputAutonomousToggle
									active={false}
									title="Autonomous mode"
									onToggle={() => {}}
								/>
								<AgentInputDivider />
								<AgentInputModelTrigger label="Claude Sonnet 4" />
								<AgentInputDivider />
							{/snippet}
							{#snippet trailing()}
								<AgentInputMetricsChip label="0/200k" percent={0} />
								<AgentInputMicButton visualState="mic" title="Record" />
							{/snippet}
						</AgentInputToolbar>
					{/snippet}
				</AgentPanelComposer>
			{/snippet}
		</AgentPanelScene>
	{/snippet}
</LandingDemoFrame>
