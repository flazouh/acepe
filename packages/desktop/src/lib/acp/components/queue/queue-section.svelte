<script lang="ts">
import type { SectionedFeedGroup, SectionedFeedItemData } from "@acepe/ui";
import { SectionedFeed } from "@acepe/ui";
import type { QueueItem } from "$lib/acp/store/queue/types.js";
import type { QueueSectionGroup, QueueSectionId } from "$lib/acp/store/queue/utils.js";
import QueueItemComponent from "./queue-item.svelte";

const SECTION_LABELS: Record<QueueSectionId, () => string> = {
	answer_needed: () => "Input needed",
	planning: () => "Planning",
	working: () => "Working",
	needs_review: () => "Needs Review",
	error: () => "Error",
};

interface Props {
	sections: readonly QueueSectionGroup[];
	totalCount: number;
	selectedSessionId?: string | null;
	onSelectItem: (item: QueueItem) => void;
	expanded?: boolean;
	onExpandedChange?: (expanded: boolean) => void;
}

let {
	sections,
	totalCount,
	selectedSessionId = null,
	onSelectItem,
	expanded: expandedProp,
	onExpandedChange,
}: Props = $props();

const groups = $derived<readonly SectionedFeedGroup<SectionedFeedItemData>[]>(
	sections.map((section) => ({
		id: section.id,
		label: SECTION_LABELS[section.id](),
		items: section.items,
	}))
);
</script>

{#snippet itemRenderer(item: SectionedFeedItemData)}
	<QueueItemComponent
		item={item as QueueItem}
		isSelected={(item as QueueItem).sessionId === selectedSessionId}
		onSelect={onSelectItem}
	/>
{/snippet}

<SectionedFeed
	{groups}
	{totalCount}
	{itemRenderer}
	expanded={expandedProp}
	{onExpandedChange}
/>
