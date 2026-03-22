<script lang="ts">
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import { computeDailyCounts, getMaxCount } from "./activity-chart-logic.js";
import type { ActivityChartProps } from "./activity-chart-props.js";

type Props = ActivityChartProps;

let { sessions }: Props = $props();

// Compute daily activity data
const dailyCounts = $derived(computeDailyCounts(sessions, 30));
const maxCount = $derived(getMaxCount(dailyCounts));
</script>

<div class="w-full flex justify-center">
	<!-- Bars only -->
	<div class="flex items-end gap-px h-10">
		{#each dailyCounts as dailyCount, index (dailyCount.date.toISOString())}
			{@const heightPx =
				maxCount > 0
					? Math.max((dailyCount.count / maxCount) * 40, dailyCount.count > 0 ? 2 : 0)
					: 0}
			{@const formattedDate = dailyCount.date.toLocaleDateString(undefined, {
				month: "short",
				day: "numeric",
			})}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						class="bar w-1 bg-[#F1B467] rounded-t-sm origin-bottom transition-colors duration-150 hover:bg-[#E6B85A] border-none p-0 cursor-default"
						style="height: {heightPx}px; --animation-delay: {index * 15}ms;"
						type="button"
						aria-label="{dailyCount.count} thread{dailyCount.count !== 1
							? 's'
							: ''} on {dailyCount.date.toLocaleDateString()}"
					></button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<div class="text-center">
						<div class="font-medium text-sm">{formattedDate}</div>
						<div class="text-xs text-muted-foreground">
							{dailyCount.count} thread{dailyCount.count !== 1 ? "s" : ""}
						</div>
					</div>
				</Tooltip.Content>
			</Tooltip.Root>
		{/each}
	</div>
</div>

<style>
	.bar {
		transform: scaleY(0);
		animation: grow-bar 300ms ease-out var(--animation-delay, 0ms) forwards;
	}

	@keyframes grow-bar {
		to {
			transform: scaleY(1);
		}
	}
</style>
