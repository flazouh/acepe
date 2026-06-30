<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import { HandPalm } from 'phosphor-svelte';

	import { RoundedIcon, LoadingIcon } from '../icons/index.js';
	import { ProjectLetterBadge } from '../project-letter-badge/index.js';
	import type { AppTab } from './types.js';

	interface Props {
		tab: AppTab;
		onclick?: () => void;
		onclose?: () => void;
		hideProjectBadge?: boolean;
		activeContrast?: 'normal' | 'strong';
	}

	let {
		tab,
		onclick,
		onclose,
		hideProjectBadge = false,
		activeContrast = 'normal',
	}: Props = $props();

	let isHovered = $state(false);
	let isTruncated = $state(false);
	let containerEl: HTMLSpanElement | undefined = $state();
	let textEl: HTMLSpanElement | undefined = $state();
	const activeTabClass = $derived(
		activeContrast === 'strong' ? 'border-border/50 bg-accent' : 'border-border bg-card'
	);

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
						class="flex items-center gap-1 px-2 py-1 h-auto min-w-0 text-xs cursor-pointer rounded-lg border transition-colors duration-150 {tab.isFocused
							? activeTabClass
							: 'border-border/50 bg-card hover:bg-accent'}"
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
								sequenceId={tab.sequenceId}
								size={14}
								class="shrink-0"
							/>
						{/if}

						<!-- 2. Agent icon / spinner -->
						{#if tab.status === 'running'}
							<span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden">
								<LoadingIcon size={12} aria-label="Running" />
							</span>
						{:else if tab.agentIconSrc}
							<img
								src={tab.agentIconSrc}
								alt=""
								class="w-3.5 h-3.5 shrink-0"
								role="presentation"
							/>
						{/if}

						<!-- 3. Status indicator -->
						{#if tab.status === 'error'}
							<span class="shrink-0 w-4 h-4 flex items-center justify-center">
								<RoundedIcon name="warning" class="size-3 text-destructive" />
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
								<RoundedIcon name="close" class="size-3" />
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
