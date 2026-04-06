<script lang="ts">
	import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";

	import { Input } from "../input/index.js";
	import AppSidebarProjectGroup from "./app-sidebar-project-group.svelte";
	import type { AppProjectGroup } from "./types.js";

	interface Props {
		groups: readonly AppProjectGroup[];
		query: string;
		onQueryChange?: (query: string) => void;
		searchPlaceholder?: string;
		emptyMessage?: string;
	}

	let {
		groups,
		query,
		onQueryChange,
		searchPlaceholder = "Search sessions...",
		emptyMessage = "No sessions found.",
	}: Props = $props();

	const totalSessions = $derived.by(() =>
		groups.reduce((total, group) => total + group.sessions.length, 0)
	);

	function handleQueryInput(event: Event & { currentTarget: HTMLInputElement }) {
		onQueryChange?.(event.currentTarget.value);
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/50 bg-card/30">
	<div class="border-b border-border/50 p-2">
		<div class="relative">
			<MagnifyingGlass
				size={12}
				class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50"
			/>
			<Input
				value={query}
				oninput={handleQueryInput}
				placeholder={searchPlaceholder}
				class="h-7 border-border/50 bg-muted/30 pl-8 pr-2 font-mono text-[11px]"
			/>
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-auto p-1">
		{#if totalSessions === 0}
			<div class="px-2 py-3 text-xs text-muted-foreground">{emptyMessage}</div>
		{:else}
			<div class="flex flex-col gap-1.5">
				{#each groups as group (group.name)}
					<AppSidebarProjectGroup {group} />
				{/each}
			</div>
		{/if}
	</div>
</div>
