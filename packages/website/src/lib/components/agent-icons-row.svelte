<script lang="ts">
	import { AgentIconsRow as SharedAgentIconsRow, type AgentIconsRowTheme } from '@acepe/ui';
	import { websiteThemeStore } from '$lib/theme/theme.js';

	interface Props {
		size?: number;
		class?: string;
	}

	let { size = 20, class: className = '' }: Props = $props();

	const theme = $derived($websiteThemeStore as AgentIconsRowTheme);
</script>

<SharedAgentIconsRow {theme} {size} class={className} />
