<script lang="ts">
import { Button } from "../button/index.js";
import { HugeiconsIcon } from "../icons/index.js";
import type { AppTopBarAction } from "./types.js";

interface Props {
	actions: readonly AppTopBarAction[];
}

let { actions }: Props = $props();
</script>

{#each actions as action (action.id)}
	<Button
		variant="ghost"
		size="icon"
		title={action.label}
		aria-label={action.label}
		data-testid={`app-top-bar-action-${action.id}`}
		onclick={action.onSelect}
	>
		{#snippet children()}
			<HugeiconsIcon name={action.icon} />
		{/snippet}
	</Button>
{/each}
