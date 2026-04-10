<script lang="ts">
	import { IconDotsVertical } from "@tabler/icons-svelte";

	import * as DropdownMenu from "../dropdown-menu/index.js";

	import type { KanbanSceneMenuAction } from "./kanban-scene-types.js";

	interface Props {
		menuActions: readonly KanbanSceneMenuAction[];
		onMenuAction: (actionId: string) => void;
	}

	let { menuActions, onMenuAction }: Props = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="shrink-0 inline-flex h-5 w-5 items-center justify-center p-1 text-muted-foreground/55 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
		aria-label="More actions"
		title="More actions"
		onclick={(event: MouseEvent) => event.stopPropagation()}
	>
		<IconDotsVertical class="h-2.5 w-2.5" aria-hidden="true" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="min-w-[180px]">
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
	</DropdownMenu.Content>
</DropdownMenu.Root>
