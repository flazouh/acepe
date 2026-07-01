<script lang="ts">
	import {
		ArrowsLeftRight,
		File,
	} from "phosphor-svelte";
	import { RoundedIcon } from "../icons/index.js";

	interface Props {
		kind: string;
		color?: string;
		size?: number;
	}

	let { kind, color = "var(--primary)", size = 11 }: Props = $props();
</script>

{#if kind === "edit"}
	<RoundedIcon
		name="edit"
		class="shrink-0"
		style="width: {size}px; height: {size}px; color: {color};"
		data-testid="permission-bar-edit-icon"
	/>
{:else if kind === "read" || kind === "read_lints"}
	<File weight="fill" {size} class="shrink-0" style="color: {color}" />
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
	<ArrowsLeftRight weight="fill" {size} class="shrink-0" style="color: {color}" />
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
