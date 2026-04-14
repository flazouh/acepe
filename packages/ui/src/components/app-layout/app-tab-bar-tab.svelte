<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import { IconAlertTriangle, IconX } from '@tabler/icons-svelte';
	import { HandPalm } from 'phosphor-svelte';

	import { ProjectLetterBadge } from '../project-letter-badge/index.js';
	import { BuildIcon, LoadingIcon, PlanIcon } from '../icons/index.js';
	import { Colors } from '../../lib/colors.js';
	import type { AppTab } from './types.js';

	interface Props {
		tab: AppTab;
		onclick?: () => void;
		onclose?: () => void;
		hideProjectBadge?: boolean;
	}

	let { tab, onclick, onclose, hideProjectBadge = false }: Props = $props();

	let isHovered = $state(false);
	let isTruncated = $state(false);
	let containerEl: HTMLSpanElement | undefined = $state();
	let textEl: HTMLSpanElement | undefined = $state();

	function handleMouseEnter() {
		isHovered = true;
		if (textEl && containerEl) {
			isTruncated = textEl.scrollWidth > containerEl.clientWidth;
		}
	}

	function handleMouseLeave() {
		isHovered = false;
	}

	function handleClose(e: MouseEvent) {
		e.stopPropagation();
		onclose?.();
	}
</script>

<Tooltip.Provider delayDuration={0}>
	<Tooltip.Root delayDuration={0}>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<div
					{...props}
					class="relative group"
					role="tab"
					tabindex={0}
					aria-selected={tab.isFocused}
					onmouseenter={handleMouseEnter}
					onmouseleave={handleMouseLeave}
				>
					<div
						class="flex items-center gap-1 px-2 py-1 h-auto min-w-0 text-xs cursor-pointer border-r border-border/30 transition-transform duration-200 {tab.isFocused
							? 'bg-accent'
							: 'hover:bg-accent/50'}"
						onclick={() => onclick?.()}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								onclick?.();
							}
						}}
						role="none"
					>
						<!-- 1. Project letter badge -->
						{#if !hideProjectBadge && tab.projectName && tab.projectColor}
							<ProjectLetterBadge
								name={tab.projectName}
								color={tab.projectColor}
								iconSrc={tab.projectIconSrc}
								size={14}
								class="shrink-0"
							/>
						{/if}

						<!-- 2. Agent icon / spinner -->
						{#if tab.status === 'running'}
							<LoadingIcon class="size-3.5" />
						{:else if tab.agentIconSrc}
							<img
								src={tab.agentIconSrc}
								alt=""
								class="w-3.5 h-3.5 shrink-0"
								role="presentation"
							/>
						{/if}

						<!-- 3. Mode icon -->
						{#if tab.mode === 'plan'}
							<span
								class="shrink-0 flex items-center justify-center"
								style="color: {Colors.orange}"
							>
								<PlanIcon size="sm" />
							</span>
						{:else if tab.mode === 'build'}
							<span class="shrink-0 flex items-center justify-center text-success">
								<BuildIcon size="sm" />
							</span>
						{/if}

						<!-- 4. Status indicator -->
						{#if tab.status === 'error'}
							<span class="shrink-0 w-4 h-4 flex items-center justify-center">
								<IconAlertTriangle class="size-3 text-destructive" />
							</span>
						{:else if tab.status === 'question'}
							<span class="shrink-0 w-4 h-4 flex items-center justify-center">
								<HandPalm class="size-3 text-primary" weight="fill" />
							</span>
						{:else if tab.status === 'done'}
							<span class="h-2 w-2 rounded-full shrink-0 bg-success"></span>
						{:else if tab.status === 'unseen'}
							<span class="h-2 w-2 rounded-full shrink-0 bg-yellow-500"></span>
						{/if}

						<!-- 5. Title - scrolls on hover if truncated -->
						<span bind:this={containerEl} class="max-w-[80px] overflow-hidden">
							<span
								bind:this={textEl}
								class="text-xs leading-tight text-left whitespace-nowrap inline-block"
								class:scroll-text={isHovered && isTruncated}
							>
								{tab.title}
							</span>
						</span>

						<!-- 6. Close button -->
						{#if onclose}
							<button
								type="button"
								class="shrink-0 h-5 w-5 p-0 rounded-sm hover:bg-muted flex items-center justify-center"
								onclick={handleClose}
							>
								<IconX class="h-3 w-3" />
								<span class="sr-only">Close tab</span>
							</button>
						{/if}
					</div>
				</div>
			{/snippet}
		</Tooltip.Trigger>
		{#if tab.tooltipText}
			<Tooltip.Portal>
				<Tooltip.Content
					side="bottom"
					sideOffset={4}
					class="z-[var(--overlay-z)] max-w-[320px] bg-popover text-popover-foreground border border-border rounded-md px-3 py-1.5 shadow-md transition-none duration-0"
				>
					<p class="text-xs leading-snug text-foreground">{tab.tooltipText}</p>
				</Tooltip.Content>
			</Tooltip.Portal>
		{/if}
	</Tooltip.Root>
</Tooltip.Provider>

<style>
	@keyframes scroll-text {
		0%,
		20% {
			transform: translateX(0);
		}
		80%,
		100% {
			transform: translateX(calc(-100% + 80px));
		}
	}

	.scroll-text {
		animation: scroll-text 15s ease-in-out infinite alternate;
	}
</style>
