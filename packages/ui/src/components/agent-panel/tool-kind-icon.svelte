<script lang="ts">
	import type { Component } from "svelte";
	import {
		AppWindow,
		File,
		GlobeHemisphereWest,
		MagnifyingGlass,
		Package,
		PencilSimple,
		Terminal,
		ListChecks,
	} from "phosphor-svelte";
	import { LoadingIcon } from "../icons/index.js";
	import { Colors } from "../../lib/colors.js";
	import type { AgentToolKind, AgentToolStatus } from "./types.js";

	interface Props {
		kind: AgentToolKind;
		status?: AgentToolStatus;
		size?: number;
		class?: string;
	}

	let { kind, status = "done", size = 12, class: className = "shrink-0" }: Props = $props();
	const isPending = $derived(status === "pending" || status === "running");

	const iconByKind: Record<AgentToolKind, Component> = {
		read: File,
		read_lints: ListChecks,
		edit: PencilSimple,
		delete: PencilSimple,
		write: PencilSimple,
		execute: Terminal,
		search: MagnifyingGlass,
		fetch: GlobeHemisphereWest,
		web_search: GlobeHemisphereWest,
		think: Package,
		skill: Package,
		task: Package,
		task_output: Package,
		browser: AppWindow,
		sql: AppWindow,
		unclassified: Package,
		other: Package,
	};

	const Icon = $derived(iconByKind[kind] ?? Package);
</script>

{#if isPending}
	<LoadingIcon class={className} style={`width: ${size}px; height: ${size}px;`} aria-label="Loading" />
{:else}
	<Icon weight="fill" {size} class={className} style="color: {Colors.purple}" />
{/if}
