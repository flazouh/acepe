<script lang="ts">
import { Gift } from "@lucide/svelte/icons";
import type { ChangelogEntry } from "$lib/changelog/index.js";
import { CHANGELOG } from "$lib/changelog/index.js";
import ChangelogModal from "$lib/components/changelog-modal/changelog-modal.svelte";
import { Button } from "$lib/components/ui/button/index.js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@acepe/ui/dialog";

interface Props {
	open?: boolean;
}

let { open = $bindable(false) }: Props = $props();

let changelogEntries: ChangelogEntry[] = $state([]);

function openChangelogModal() {
	if (CHANGELOG.length > 0) {
		changelogEntries = CHANGELOG.slice(0, 3);
		open = false;
	}
}

function closeChangelogModal() {
	changelogEntries = [];
}
</script>

<Dialog bind:open>
	<DialogContent class="max-w-sm">
		<DialogHeader>
			<DialogTitle>Debug Panel</DialogTitle>
		</DialogHeader>

		<div class="space-y-3">
			<Button variant="outline" class="w-full justify-start gap-3" onclick={openChangelogModal}>
				<Gift class="size-4" />
				Test Changelog Modal
			</Button>
		</div>
	</DialogContent>
</Dialog>

{#if changelogEntries.length > 0}
	<ChangelogModal entries={changelogEntries} onDismiss={closeChangelogModal} />
{/if}
