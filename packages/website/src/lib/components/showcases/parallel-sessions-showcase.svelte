<script lang="ts">
import { AppTabBar } from "@acepe/ui/app-layout";
import type { AppTab } from "@acepe/ui/app-layout";

interface ParallelSessionLine {
	readonly width: number;
	readonly tone: "muted" | "primary" | "success";
}

interface ParallelSessionPreview {
	readonly id: string;
	readonly label: string;
	readonly lines: readonly ParallelSessionLine[];
}

interface Props {
	readonly tabs: AppTab[];
	readonly sessions: readonly ParallelSessionPreview[];
}

	let { tabs, sessions }: Props = $props();

	function lineClass(tone: ParallelSessionLine["tone"]): string {
		if (tone === "primary") return "bg-primary/20";
		if (tone === "success") return "bg-success/20";
		return "bg-muted-foreground/10";
	}
</script>

<div class="space-y-2">
	<div class="overflow-hidden rounded-lg border border-border/50 bg-card/30">
		<AppTabBar tabs={tabs} />
	</div>
	<div class="grid grid-cols-2 gap-1 rounded-lg border border-border/50 bg-card/30 p-2">
		{#each sessions as session (session.id)}
			<div class="rounded-md border border-border/30 bg-background/50 p-2">
				<div class="mb-1.5 font-mono text-[9px] text-muted-foreground/60">{session.label}</div>
				<div class="space-y-1">
					{#each session.lines as line, lineIndex (`${session.id}-${line.width}-${lineIndex}`)}
						<div
							class={`h-1.5 rounded-full ${lineClass(line.tone)}`}
							style={`width: ${line.width}%;`}
						></div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>
