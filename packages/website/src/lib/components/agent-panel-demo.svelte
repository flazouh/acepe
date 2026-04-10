<script lang="ts">
	import { onMount } from "svelte";

	import { AgentPanelScene } from "@acepe/ui/agent-panel";

	import {
		AGENT_PANEL_DEMO_DELAYS,
		AGENT_PANEL_DEMO_SCRIPT,
		buildWebsiteAgentPanelScene,
		websiteAgentPanelDemoCallbacks,
	} from "./agent-panel-demo-scene.js";

	let visibleCount = $state(0);
	let animating = $state(false);

	const entries = $derived(AGENT_PANEL_DEMO_SCRIPT.slice(0, visibleCount));
	const sessionStatus = $derived.by(() => {
		if (visibleCount === 0) {
			return "idle";
		}

		if (visibleCount >= AGENT_PANEL_DEMO_SCRIPT.length) {
			return "done";
		}

		return "running";
	});

	const scene = $derived(
		buildWebsiteAgentPanelScene({
			panelId: "website-agent-panel-demo",
			title: "Migrate auth to JWT",
			projectName: "acepe",
			projectColor: "#7C3AED",
			status: sessionStatus,
			entries,
		})
	);

	async function play(): Promise<void> {
		if (animating) {
			return;
		}

		animating = true;
		visibleCount = 0;

		for (let i = 0; i < AGENT_PANEL_DEMO_SCRIPT.length; i += 1) {
			const delay = AGENT_PANEL_DEMO_DELAYS[i] ?? 400;
			await new Promise<void>((resolve) => {
				setTimeout(resolve, delay);
			});
			visibleCount = i + 1;
		}

		animating = false;
	}

	onMount(() => {
		const timer = setTimeout(() => {
			void play();
		}, 300);

		return () => {
			clearTimeout(timer);
		};
	});
</script>

<div class="relative h-full">
	<AgentPanelScene
		{scene}
		actionCallbacks={websiteAgentPanelDemoCallbacks}
		iconBasePath="/svgs/icons"
	/>

	{#if !animating && visibleCount >= AGENT_PANEL_DEMO_SCRIPT.length}
		<button
			type="button"
			onclick={() => void play()}
			class="absolute bottom-20 right-4 rounded-full border border-border bg-muted/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
		>
			↺ Replay
		</button>
	{/if}
</div>
