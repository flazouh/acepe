<script lang="ts">
import { LoadingIcon, HugeiconsIcon } from "../icons/index.js";
import { toolKindIconNameByKind } from "./tool-kind-icon-model.js";
import type { AgentToolKind, AgentToolStatus } from "./types.js";

interface Props {
	kind: AgentToolKind;
	status?: AgentToolStatus;
	size?: number;
	class?: string;
}

let {
	kind,
	status = "done",
	size = 12,
	class: className = "shrink-0",
}: Props = $props();
const isPending = $derived(status === "pending" || status === "running");
const iconName = $derived(toolKindIconNameByKind[kind]);
</script>

{#if isPending}
	<LoadingIcon class={className} {size} aria-label="Loading" />
{:else if iconName}
	<HugeiconsIcon
		name={iconName}
		class="text-muted-foreground {className}"
		style="width: {size}px; height: {size}px"
		data-testid={`tool-kind-icon-${kind}`}
	/>
{/if}
