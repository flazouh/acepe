<script lang="ts">
	import AppTabBarTab from './app-tab-bar-tab.svelte';
	import type { AppTab } from './types.js';

	interface Props {
		tabs: AppTab[];
		onSelectTab?: (id: string) => void;
	}

	let { tabs, onSelectTab }: Props = $props();
</script>

<div class="flex items-center gap-1 overflow-x-auto px-1 py-0.5" role="tablist">
	{#each tabs as tab (tab.id)}
		<AppTabBarTab {tab} onclick={() => onSelectTab?.(tab.id)} />
	{/each}
</div>
