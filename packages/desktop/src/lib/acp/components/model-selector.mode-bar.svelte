<script lang="ts">
import { BuildIcon, PlanIcon } from "@acepe/ui";
import { cn } from "$lib/utils.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	showModeBar: boolean;
	isPlanDefault: boolean;
	isBuildDefault: boolean;
	onSetPlan: () => void;
	onSetBuild: () => void;
}

let { showModeBar, isPlanDefault, isBuildDefault, onSetPlan, onSetBuild }: Props = $props();
</script>

<div
	class={cn(
		"flex items-center gap-1",
		showModeBar ? "opacity-100" : "opacity-0 group-hover/item:opacity-100"
	)}
>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					class={cn(
						"grid h-4 w-4 place-items-center transition-colors",
						isPlanDefault
							? "text-[color:var(--mode-color)]"
							: "text-muted-foreground hover:text-[color:var(--mode-color)]",
						isPlanDefault
							? "opacity-100"
							: "opacity-0 pointer-events-none group-hover/item:opacity-100 group-hover/item:pointer-events-auto"
					)}
					style="--mode-color: var(--plan-icon)"
					title={m.plan_heading()}
					aria-label={m.plan_heading()}
					onclick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onSetPlan();
					}}
				>
					<PlanIcon size="md" class="text-current" />
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{m.plan_heading()}</Tooltip.Content>
	</Tooltip.Root>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					class={cn(
						"grid h-4 w-4 place-items-center transition-colors",
						isBuildDefault
							? "text-[color:var(--mode-color)]"
							: "text-muted-foreground hover:text-[color:var(--mode-color)]",
						isBuildDefault
							? "opacity-100"
							: "opacity-0 pointer-events-none group-hover/item:opacity-100 group-hover/item:pointer-events-auto"
					)}
					style="--mode-color: var(--build-icon)"
					title={m.plan_sidebar_build()}
					aria-label={m.plan_sidebar_build()}
					onclick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onSetBuild();
					}}
				>
					<BuildIcon size="md" class="text-current" />
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{m.plan_sidebar_build()}</Tooltip.Content>
	</Tooltip.Root>
</div>
