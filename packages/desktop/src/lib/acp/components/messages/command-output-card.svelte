<script lang="ts">
import { AgentToolCard } from "@acepe/ui/agent-panel";
import { IconAdjustments } from "@acepe/ui/icons";
import { IconArrowRight } from "@acepe/ui/icons";
import { IconTerminal } from "@acepe/ui/icons";

import type { CommandOutput } from "../../utils/command-output-parser.js";
import { buildCommandOutputCardState } from "./command-output-card-state.js";

let { output }: { output: CommandOutput } = $props();

const cardState = $derived(buildCommandOutputCardState(output));
</script>

<AgentToolCard>
	{#if cardState.isModelCommand && cardState.modelInfo}
		<!-- Model switch display -->
		<div class="flex items-center gap-2 px-2 py-2 text-xs">
			<IconAdjustments class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
			<span class="text-muted-foreground">Model</span>
			<IconArrowRight class="h-3 w-3 text-muted-foreground/50 shrink-0" />
			<span class="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
				{cardState.displayModel.name}
			</span>
			{#if cardState.displayModel.description}
				<span class="text-muted-foreground/60 text-[10px] truncate">
					{cardState.displayModel.description}
				</span>
			{/if}
		</div>
	{:else if output.command}
		<!-- Header only - command without stdout yet -->
		<div class="flex items-center gap-2 px-2 py-2 text-xs">
			<IconTerminal class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
			<span class="font-mono text-muted-foreground">{output.command}</span>
			{#if output.stdout}
				<span class="text-muted-foreground/70 truncate">
					{output.stdout}
				</span>
			{/if}
		</div>
	{:else if output.stdout}
		<!-- Stdout only - generic output display -->
		<div class="flex items-center gap-2 px-2 py-2 text-xs">
			<IconTerminal class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
			<span class="text-muted-foreground/70 truncate">
				{cardState.cleanStdout}
			</span>
		</div>
	{:else}
		<!-- Fallback - shouldn't happen but handle gracefully -->
		<div class="flex items-center gap-2 px-2 py-2 text-xs">
			<IconTerminal class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
			<span class="text-muted-foreground/50 italic">Command output</span>
		</div>
	{/if}
</AgentToolCard>
