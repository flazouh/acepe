<script lang="ts">
	import type { Snippet } from "svelte";

	import { cn } from "../../lib/utils.js";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import AppSessionItem from "./app-session-item.svelte";
	import type { AppProjectGroup } from "./types.js";

	interface Props {
		group?: AppProjectGroup;
		header?: Snippet;
		children?: Snippet;
		footer?: Snippet;
		style?: string;
		class?: string;
	}

	let { group, header, children, footer, style, class: className = "" }: Props = $props();
</script>

<div
	class={cn(
		"flex flex-col overflow-hidden",
		className
	)}
	{style}
>
	{#if header}
		{@render header()}
	{:else if group}
		<div class="shrink-0 flex items-center border-b border-border/50">
			<div class="inline-flex items-center justify-center h-7 w-7 shrink-0">
				<ProjectLetterBadge
					name={group.name}
					color={group.color ?? "#6B7280"}
					iconSrc={group.iconSrc ?? null}
					size={16}
				/>
			</div>
			<div class="flex items-center flex-1 min-w-0 h-7 pl-1.5 pr-2">
				<span class="text-[11px] font-medium text-foreground truncate">{group.name}</span>
			</div>
		</div>
	{/if}

	{#if children}
		{@render children()}
	{:else if group}
		<div class="flex-1 min-h-0 overflow-auto">
			<div class="flex flex-col gap-0.5 p-1">
				{#each group.sessions as session (session.id)}
					<AppSessionItem {session} />
				{/each}
			</div>
		</div>
	{/if}

	{#if footer}
		{@render footer()}
	{/if}
</div>
