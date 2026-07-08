<script lang="ts">
	import { RoundedIcon } from "../icons/index.js";

	interface Props {
		kind: string;
		color?: string;
		size?: number;
	}

	let { kind, color = "var(--primary)", size = 11 }: Props = $props();
	const moveArrowSize = $derived(Math.max(7, Math.round(size * 0.65)));
</script>

{#snippet moveIcon()}
	<span
		class="relative inline-flex shrink-0 items-center justify-center"
		style="width: {size}px; height: {size}px; color: {color};"
		data-testid="permission-bar-move-icon"
	>
		<RoundedIcon
			name="arrow-left"
			class="absolute -translate-x-0.5"
			style="width: {moveArrowSize}px; height: {moveArrowSize}px;"
		/>
		<RoundedIcon
			name="arrow-left"
			class="absolute translate-x-0.5 rotate-180"
			style="width: {moveArrowSize}px; height: {moveArrowSize}px;"
		/>
	</span>
{/snippet}

{#if kind === "edit"}
	<RoundedIcon
		name="edit"
		class="shrink-0"
		style="width: {size}px; height: {size}px; color: {color};"
		data-testid="permission-bar-edit-icon"
	/>
{:else if kind === "read" || kind === "read_lints"}
	<RoundedIcon
		name="file-text"
		class="shrink-0"
		style="width: {size}px; height: {size}px; color: {color};"
		data-testid="permission-bar-read-icon"
	/>
{:else if kind === "execute"}
	<RoundedIcon
		name="terminal"
		class="shrink-0"
		style="width: {size}px; height: {size}px; color: {color};"
		data-testid="permission-bar-execute-icon"
	/>
{:else if kind === "search"}
	<RoundedIcon
		name="search"
		class="shrink-0"
		style="width: {size}px; height: {size}px; color: {color};"
		data-testid="permission-bar-search-icon"
	/>
{:else if kind === "fetch" || kind === "web_search"}
	<RoundedIcon
		name="globe"
		class="shrink-0"
		style="width: {size}px; height: {size}px; color: {color};"
		data-testid="permission-bar-fetch-icon"
	/>
{:else if kind === "delete"}
	<RoundedIcon
		name="trash"
		class="shrink-0"
		style="width: {size}px; height: {size}px; color: {color};"
		data-testid="permission-bar-delete-icon"
	/>
{:else if kind === "move"}
	{@render moveIcon()}
{:else if kind === "browser"}
	<RoundedIcon
		name="app-window"
		class="shrink-0"
		style="width: {size}px; height: {size}px; color: {color};"
		data-testid="permission-bar-browser-icon"
	/>
{:else}
	<RoundedIcon
		name="shield-warning"
		class="shrink-0"
		style="width: {size - 1}px; height: {size - 1}px; color: {color};"
		data-testid="permission-bar-shield-warning-icon"
	/>
{/if}
