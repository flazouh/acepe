<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import IconDotsVertical from "@tabler/icons-svelte/icons/dots-vertical";
import IconEye from "@tabler/icons-svelte/icons/eye";
import IconFolder from "@tabler/icons-svelte/icons/folder";
import IconTrash from "@tabler/icons-svelte/icons/trash";
import { Button } from "$lib/components/ui/button/index.js";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	sessionId: string;
	projectPath: string;
	agentId: string;
	onView?: (id: string) => void;
	onDelete?: (id: string) => void;
	onOpenInFinder?: (id: string, projectPath: string) => void;
	onArchive?: (session: { id: string; projectPath: string; agentId: string }) => void;
	onUnarchive?: (session: { id: string; projectPath: string; agentId: string }) => void;
}

let {
	sessionId,
	projectPath,
	agentId,
	onView,
	onDelete,
	onOpenInFinder,
	onArchive,
	onUnarchive,
}: Props = $props();

const actionTarget = $derived({ id: sessionId, projectPath, agentId });
const hasActions = $derived(
	Boolean(onView || onOpenInFinder || onArchive || onUnarchive || onDelete)
);
</script>

{#if hasActions}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button variant="ghost" size="sm" class="h-8 w-8 p-0" {...props}>
					<IconDotsVertical class="h-4 w-4" />
					<span class="sr-only">Actions</span>
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end">
			{#if onView}
				<DropdownMenu.Item onclick={() => onView(sessionId)}>
					<IconEye class="h-4 w-4 mr-2" />
					{m.common_open()}
				</DropdownMenu.Item>
			{/if}
			{#if onOpenInFinder}
				<DropdownMenu.Item onclick={() => onOpenInFinder(sessionId, projectPath)}>
					<IconFolder class="h-4 w-4 mr-2" />
					{m.thread_open_in_finder()}
				</DropdownMenu.Item>
			{/if}
			{#if onArchive}
				<DropdownMenu.Item onclick={() => onArchive(actionTarget)}>Archive</DropdownMenu.Item>
			{/if}
			{#if onUnarchive}
				<DropdownMenu.Item onclick={() => onUnarchive(actionTarget)}>Unarchive</DropdownMenu.Item>
			{/if}
			{#if onDelete}
				<DropdownMenu.Separator />
				<DropdownMenu.Item
					onclick={() => onDelete(sessionId)}
					class="text-destructive focus:text-destructive"
				>
					<IconTrash class="h-4 w-4 mr-2" />
					{m.common_delete()}
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/if}
