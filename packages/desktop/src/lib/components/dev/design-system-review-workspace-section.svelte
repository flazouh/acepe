<script lang="ts">
	import { ReviewWorkspace } from "@acepe/ui/agent-panel";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import SettingsSection from "$lib/components/settings-page/settings-section.svelte";

	import { reviewWorkspaceSpecimenFiles } from "./design-system-review-workspace-specimens.js";

	let selectedFileIndex = $state(1);
	const selectedFile = $derived(reviewWorkspaceSpecimenFiles[selectedFileIndex] ?? null);
</script>

<div class="w-full" data-testid="design-system-review-workspace-section">
	<SettingsSection
		title="In context"
		description="Live ReviewWorkspace render using nested files so the Pierre tree rail can be inspected."
	>
		{#snippet headerActions()}
			<Badge variant="secondary" class="font-mono text-[10px]">
				{reviewWorkspaceSpecimenFiles.length} files
			</Badge>
		{/snippet}

		<div
			class="h-[430px] overflow-hidden rounded-lg border border-border/40 bg-card p-3"
			data-testid="design-system-review-workspace-specimen"
		>
			<ReviewWorkspace
				files={reviewWorkspaceSpecimenFiles}
				selectedFileIndex={selectedFileIndex}
				headerLabel="Review changes"
				emptyStateLabel="Nothing to review"
				showCloseButton={false}
				compact={true}
				onFileSelect={(index) => {
					selectedFileIndex = index;
				}}
				onFileRevert={() => {}}
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
The left rail is the shared Pierre tree wrapper.
The selected file path is revealed, while unrelated folders stay collapsed.</code></pre>
					</div>
				{/snippet}
			</ReviewWorkspace>
		</div>
	</SettingsSection>
</div>
