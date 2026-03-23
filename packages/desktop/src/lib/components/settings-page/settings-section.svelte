<script lang="ts">
import type { Snippet } from "svelte";
import SettingsSectionHeader from "./settings-section-header.svelte";

interface Props {
	title?: string;
	description?: string;
	children: Snippet;
}

let { title, description, children }: Props = $props();
</script>

<div class="mb-10">
	{#if title}
		<SettingsSectionHeader {title} {description} />
	{/if}
	<div class="space-y-3">
		{@render children()}
	</div>
</div>
