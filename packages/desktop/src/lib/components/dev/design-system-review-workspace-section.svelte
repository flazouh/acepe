<script lang="ts">
import {
	ReviewWorkspace,
	type ReviewWorkspaceFileItem,
	type ReviewWorkspaceFileResetStatus,
} from "@acepe/ui/agent-panel";
import { SvelteMap } from "svelte/reactivity";

import { Badge } from "$lib/components/ui/badge/index.js";
import SettingsSection from "$lib/components/settings-page/settings-section.svelte";

import { reviewWorkspaceSpecimenFiles } from "./design-system-review-workspace-specimens.js";

let selectedFileIndex = $state(1);
let resetStatusByFileId = new SvelteMap<string, ReviewWorkspaceFileResetStatus>();
const files = $derived(reviewWorkspaceSpecimenFiles.map(toSpecimenFile));
const selectedFile = $derived(files[selectedFileIndex] ?? null);

function resetStatusLabel(status: ReviewWorkspaceFileResetStatus | undefined): string | null {
	if (status === "confirming") {
		return "Reset this file?";
	}

	if (status === "reset") {
		return "Reset";
	}

	return null;
}

function toSpecimenFile(file: ReviewWorkspaceFileItem): ReviewWorkspaceFileItem {
	const resetStatus = resetStatusByFileId.get(file.id) ?? "idle";

	return {
		id: file.id,
		filePath: file.filePath,
		fileName: file.fileName,
		sourceIndex: file.sourceIndex,
		reviewStatus: file.reviewStatus,
		resetStatus,
		resetStatusLabel: resetStatusLabel(resetStatus),
		additions: file.additions,
		deletions: file.deletions,
		onSelect: file.onSelect,
		onRevert: file.onRevert,
	};
}

function handleFileRevert(index: number): void {
	const file = files[index];
	if (!file) {
		return;
	}

	if (file.resetStatus === "confirming") {
		resetStatusByFileId.set(file.id, "reset");
		return;
	}

	resetStatusByFileId.set(file.id, "confirming");
}

function handleFileRevertCancel(index: number): void {
	const file = files[index];
	if (!file) {
		return;
	}

	resetStatusByFileId.delete(file.id);
}
</script>

<div class="w-full" data-testid="design-system-review-workspace-section">
	<SettingsSection
		title="In context"
		description="Live ReviewWorkspace render using the flat file rail and inline reset state."
	>
		{#snippet headerActions()}
			<Badge variant="secondary" class="font-mono text-[10px]">
				{files.length} files
			</Badge>
		{/snippet}

		<div
			class="h-[430px] overflow-hidden rounded-lg border border-border/40 bg-card p-3"
			data-testid="design-system-review-workspace-specimen"
		>
			<ReviewWorkspace
				{files}
				selectedFileIndex={selectedFileIndex}
				headerLabel="Review changes"
				emptyStateLabel="Nothing to review"
				showCloseButton={false}
				compact={true}
				flat={true}
				fileListVariant="flat"
				onFileSelect={(index) => {
					selectedFileIndex = index;
				}}
				onFileRevert={handleFileRevert}
				onFileRevertCancel={handleFileRevertCancel}
			>
				{#snippet content()}
					<div class="flex h-full min-h-0 flex-col overflow-hidden">
						<div class="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2">
							<span class="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
								{selectedFile?.filePath ?? "No file selected"}
							</span>
							{#if selectedFile}
								<span class="shrink-0 font-mono text-[11px] text-muted-foreground">
									+{selectedFile.additions} -{selectedFile.deletions}
								</span>
							{/if}
						</div>
						<pre class="min-h-0 flex-1 overflow-auto p-4 text-xs leading-5 text-muted-foreground"><code>Review workspace specimen

Selected file index: {selectedFileIndex}
The left rail is the shared flat review file list.
Reset confirmation stays inside the selected file row.</code></pre>
					</div>
				{/snippet}
			</ReviewWorkspace>
		</div>
	</SettingsSection>
</div>
