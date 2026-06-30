<script lang="ts">
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { RoundedIcon } from "../icons/index.js";
	import { Selector } from "../selector/index.js";

	import type { KanbanSceneMenuAction } from "./kanban-scene-types.js";

	interface Props {
		menuActions: readonly KanbanSceneMenuAction[];
		onMenuAction: (actionId: string) => void;
	}

	let { menuActions, onMenuAction }: Props = $props();
</script>

<Selector
	showChevron={false}
	align="end"
	variant="ghost"
	triggerSize="icon"
	triggerAriaLabel="More actions"
	tooltipLabel="More actions"
	class="shrink-0"
>
	{#snippet renderButton()}
		<RoundedIcon name="more" class="h-2.5 w-2.5" />
	{/snippet}

	{#each menuActions as action (action.id)}
		<DropdownMenu.Item
			class={`cursor-pointer ${action.destructive ? "text-red-500 focus:text-red-500" : ""}`}
			disabled={action.disabled}
			onSelect={() => {
				onMenuAction(action.id);
			}}
		>
			{action.label}
		</DropdownMenu.Item>
	{/each}
</Selector>
