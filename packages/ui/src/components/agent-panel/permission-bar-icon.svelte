<script lang="ts">
	import {
		AppWindow,
		ArrowsLeftRight,
		File,
		GlobeHemisphereWest,
		MagnifyingGlass,
		PencilSimple,
		ShieldWarning,
		Terminal,
		Trash,
	} from "phosphor-svelte";

	interface Props {
		kind: string;
		color?: string;
		size?: number;
	}

	let { kind, color = "var(--primary)", size = 11 }: Props = $props();
</script>

{#if kind === "edit"}
	<PencilSimple weight="fill" {size} class="shrink-0" style="color: {color}" />
{:else if kind === "read"}
	<File weight="fill" {size} class="shrink-0" style="color: {color}" />
{:else if kind === "execute"}
	<Terminal weight="fill" {size} class="shrink-0" style="color: {color}" />
{:else if kind === "search"}
	<MagnifyingGlass weight="fill" {size} class="shrink-0" style="color: {color}" />
{:else if kind === "fetch" || kind === "web_search"}
	<GlobeHemisphereWest weight="fill" {size} class="shrink-0" style="color: {color}" />
{:else if kind === "delete"}
	<Trash weight="fill" {size} class="shrink-0" style="color: {color}" />
{:else if kind === "move"}
	<ArrowsLeftRight weight="fill" {size} class="shrink-0" style="color: {color}" />
{:else if kind === "browser"}
	<AppWindow weight="fill" {size} class="shrink-0" style="color: {color}" />
{:else}
	<ShieldWarning weight="fill" size={size - 1} class="shrink-0" style="color: {color}" />
{/if}
