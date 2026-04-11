<script lang="ts">
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { Button } from "../button/index.js";
	import { ArrowsOut, CaretDown, Check, CheckCircle, FileCode, SidebarSimple } from "phosphor-svelte";

	import type { AgentPanelModifiedFilesTrailingModel } from "./types.js";

	interface Props {
		model: AgentPanelModifiedFilesTrailingModel;
		isExpanded: boolean;
	}

let { model, isExpanded }: Props = $props();

const showReviewAction = $derived((model.reviewOptions?.length ?? 0) > 0 || Boolean(model.onReview));
</script>

{#if showReviewAction}
	<DropdownMenu.Root>
		<div
			class="flex items-center overflow-hidden rounded border border-border/50 bg-muted text-[0.6875rem] shrink-0"
			onclick={(event: MouseEvent) => event.stopPropagation()}
			role="none"
		>
			<Button
				variant="headerAction"
				size="headerAction"
				class="rounded-none border-0 bg-transparent shadow-none"
				onclick={() => model.onReview?.()}
			>
				<FileCode size={11} weight="fill" class="shrink-0" />
				{model.reviewLabel}
			</Button>
			{#if model.reviewOptions.length > 0}
				<DropdownMenu.Trigger
					class="self-stretch flex items-center px-1 border-l border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors outline-none"
					onclick={(event: MouseEvent) => event.stopPropagation()}
				>
					<svg class="size-2.5" viewBox="0 0 10 10" fill="none">
						<path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</DropdownMenu.Trigger>
			{/if}
		</div>
		{#if model.reviewOptions.length > 0}
			<DropdownMenu.Content align="end" class="min-w-[140px]">
				{#each model.reviewOptions as option (option.id)}
					<DropdownMenu.Item onSelect={() => option.onSelect?.()} class="cursor-pointer text-[0.6875rem]">
						{#if option.kind === "panel"}
							<SidebarSimple size={12} weight="fill" class="shrink-0" />
						{:else if option.kind === "fullscreen"}
							<ArrowsOut size={12} weight="bold" class="shrink-0" />
						{/if}
						{option.label}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		{/if}
	</DropdownMenu.Root>
{/if}

<div role="none" onclick={(event: MouseEvent) => event.stopPropagation()}>
	{#if model.keepState === "applied"}
		<Button variant="headerAction" size="headerAction" disabled class="disabled:opacity-100">
			<CheckCircle size={11} weight="fill" class="shrink-0 text-success" />
			{model.appliedLabel ?? "Applied"}
		</Button>
	{:else}
		<Button
			variant="invert"
			size="headerAction"
			disabled={model.keepState === "disabled"}
			onclick={() => model.onKeep?.()}
		>
			<Check size={11} weight="bold" class="shrink-0" />
			{model.keepLabel}
		</Button>
	{/if}
</div>

<span class="text-muted-foreground tabular-nums text-[0.6875rem]">
	{model.reviewedCount}/{model.totalCount}
</span>

<CaretDown
	size={14}
	weight="bold"
	class="size-3.5 text-muted-foreground transition-transform {isExpanded ? 'rotate-180' : ''}"
/>
