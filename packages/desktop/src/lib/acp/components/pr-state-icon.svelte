<script lang="ts">
import { Colors } from "@acepe/ui/colors";
import { GitMerge } from "phosphor-svelte";
import { GitPullRequest } from "phosphor-svelte";
import type { PrState } from "$lib/utils/tauri-client/git.js";

interface Props {
	state: "OPEN" | "CLOSED" | "MERGED";
	size?: number;
}

let { state, size = 13 }: Props = $props();

const iconColor = $derived.by(() => {
	switch (state) {
		case "OPEN":
			return "var(--success)";
		case "MERGED":
			return Colors.purple;
		case "CLOSED":
			return "var(--destructive)";
	}
});
</script>

{#if state === "MERGED"}
	<GitMerge {size} weight="fill" style="color: {iconColor}" />
{:else}
	<GitPullRequest {size} weight="fill" style="color: {iconColor}" />
{/if}
