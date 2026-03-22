<script lang="ts">
	import { Tooltip } from "bits-ui";
	import { Colors } from "../../lib/colors.js";

	interface Props {
		count: number;
	}

	let { count }: Props = $props();

	/**
	 * Tally system (like Roman numerals):
	 * - 1 green bar  = 1 tool call
	 * - 1 purple bar = 5 tool calls
	 * - 1 orange bar = 25 tool calls
	 */
	const bars = $derived.by(() => {
		const result: Array<{ color: string; title: string }> = [];
		let remaining = count;

		const orangeCount = Math.floor(remaining / 25);
		remaining %= 25;
		const purpleCount = Math.floor(remaining / 5);
		remaining %= 5;
		const greenCount = remaining;

		for (let i = 0; i < orangeCount; i++) {
			result.push({ color: Colors.orange, title: "25 tools" });
		}
		for (let i = 0; i < purpleCount; i++) {
			result.push({ color: Colors.purple, title: "5 tools" });
		}
		for (let i = 0; i < greenCount; i++) {
			result.push({ color: Colors.green, title: "1 tool" });
		}

		return result;
	});
</script>

{#if count > 0}
	<Tooltip.Provider delayDuration={300}>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<div class="flex items-center gap-1" {...props}>
						<span class="font-mono text-[10px] text-muted-foreground/70">{count}</span>
						<div class="flex items-center gap-[2px]">
							{#each bars as bar}
								<span
									class="inline-block h-2.5 w-[3px] rounded-[1px]"
									style="background-color: {bar.color}"
								></span>
							{/each}
						</div>
					</div>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					side="top"
					sideOffset={6}
					class="z-[9999] rounded-md border border-border bg-popover px-3 py-2 shadow-md"
				>
					<p class="text-xs font-medium text-foreground">{count} tool {count === 1 ? "call" : "calls"}</p>
					<div class="mt-1.5 flex flex-col gap-1">
						<div class="flex items-center gap-2">
							<span class="inline-block h-2.5 w-[3px] rounded-[1px]" style="background-color: {Colors.green}"></span>
							<span class="text-[11px] text-muted-foreground">= 1 tool call</span>
						</div>
						<div class="flex items-center gap-2">
							<span class="inline-block h-2.5 w-[3px] rounded-[1px]" style="background-color: {Colors.purple}"></span>
							<span class="text-[11px] text-muted-foreground">= 5 tool calls</span>
						</div>
						<div class="flex items-center gap-2">
							<span class="inline-block h-2.5 w-[3px] rounded-[1px]" style="background-color: {Colors.orange}"></span>
							<span class="text-[11px] text-muted-foreground">= 25 tool calls</span>
						</div>
					</div>
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	</Tooltip.Provider>
{/if}
