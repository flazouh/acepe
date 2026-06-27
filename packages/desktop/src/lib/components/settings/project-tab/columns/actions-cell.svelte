<script lang="ts">
import { Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { IconDotsVertical } from "@acepe/ui/icons";
import { IconEye } from "@acepe/ui/icons";
import { IconFolder } from "@acepe/ui/icons";
interface Props {
	sessionId: string;
	projectPath: string;
	agentId: string;
	onView?: (id: string) => void;
	onOpenInFinder?: (id: string, projectPath: string) => void;
	onArchive?: (session: { id: string; projectPath: string; agentId: string }) => void;
	onUnarchive?: (session: { id: string; projectPath: string; agentId: string }) => void;
}

let { sessionId, projectPath, agentId, onView, onOpenInFinder, onArchive, onUnarchive }: Props =
	$props();

const actionTarget = $derived({ id: sessionId, projectPath, agentId });
const hasActions = $derived(Boolean(onView || onOpenInFinder || onArchive || onUnarchive));
</script>

{#if hasActions}
	<Selector align="end" triggerSize="square" showChevron={false} variant="ghost" triggerAriaLabel="Actions">
		{#snippet renderButton()}
			<IconDotsVertical class="h-4 w-4" />
			<span class="sr-only">Actions</span>
		{/snippet}

		{#if onView}
			<DropdownMenu.Item onclick={() => onView(sessionId)}>
				<IconEye class="h-4 w-4 mr-2" />
				{"Open"}
			</DropdownMenu.Item>
		{/if}
		{#if onOpenInFinder}
			<DropdownMenu.Item onclick={() => onOpenInFinder(sessionId, projectPath)}>
				<IconFolder class="h-4 w-4 mr-2" />
				{"Open Thread in Finder"}
			</DropdownMenu.Item>
		{/if}
		{#if onArchive}
			<DropdownMenu.Item onclick={() => onArchive(actionTarget)}>Archive</DropdownMenu.Item>
		{/if}
		{#if onUnarchive}
			<DropdownMenu.Item onclick={() => onUnarchive(actionTarget)}>Unarchive</DropdownMenu.Item>
		{/if}
	</Selector>
{/if}
