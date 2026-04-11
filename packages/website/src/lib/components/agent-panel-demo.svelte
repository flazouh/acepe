<script lang="ts">
import { CaretDown, Wrench } from "phosphor-svelte";

import {
	AgentInputAutonomousToggle,
	AgentInputDivider,
	AgentInputEditor,
	AgentInputMicButton,
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
								<button type="button" class="inline-flex items-center justify-center h-7 w-7 text-muted-foreground hover:text-foreground" title="Plan mode">
									<Wrench class="h-3.5 w-3.5" weight="regular" />
								</button>
								<AgentInputDivider />
								<AgentInputAutonomousToggle
									active={false}
									title="Autonomous mode"
									onToggle={() => {}}
								/>
								<AgentInputDivider />
								<button type="button" class="inline-flex items-center gap-1 h-7 px-2 text-[11px] text-foreground hover:text-foreground">
									<span>Claude Sonnet 4</span>
									<CaretDown class="h-2.5 w-2.5" weight="bold" />
								</button>
								<AgentInputDivider />
							{/snippet}
							{#snippet trailing()}
								<span class="px-2 font-mono text-[10px] text-muted-foreground tabular-nums">0/200k</span>
								<AgentInputMicButton visualState="mic" title="Record" />
							{/snippet}
						</AgentInputToolbar>
					{/snippet}
				</AgentPanelComposer>
			{/snippet}
		</AgentPanelScene>
	{/snippet}
</LandingDemoFrame>
