<script lang="ts">
import FileIcon from "@lucide/svelte/icons/file";
import { useSessionContext } from "$lib/acp/hooks/use-session-context.js";
import { Button } from "$lib/components/ui/button/index.js";
import { openFileInEditor } from "$lib/utils/tauri-client.js";

import MarkdownText from "../../messages/markdown-text.svelte";

interface Props {
	/** Skill description (can be markdown) */
	description?: string | null;
	/** Path to the skill file */
	filePath?: string | null;
	/** Whether the content is expanded */
	isExpanded?: boolean;
	/** Callback when clicking the collapsed area */
	onClickExpand?: () => void;
	/** Project path for file operations */
	projectPath?: string;
}

let {
	description,
	filePath,
	isExpanded = false,
	onClickExpand,
	projectPath: propProjectPath,
}: Props = $props();

// Get projectPath from session context, with prop fallback
const sessionContext = useSessionContext();
const projectPath = $derived(propProjectPath ?? sessionContext?.projectPath);

function handleOpenFile() {
	if (filePath) {
		openFileInEditor(filePath);
	}
}

// Check if we have any meaningful content
const hasDescription = $derived(description && description.trim().length > 0);
const hasFilePath = $derived(filePath && filePath.trim().length > 0);
const hasAnyContent = $derived(hasDescription || hasFilePath);
</script>

{#if hasAnyContent}
	<div class="skill-content">
		{#if isExpanded}
			<!-- Expanded view: full description + file action -->
			<div class="flex flex-col gap-2 px-3 py-2">
				{#if hasDescription}
					<div class="skill-description">
						<MarkdownText text={description ?? ""} {projectPath} />
					</div>
				{/if}

				{#if hasFilePath}
					<div class="flex items-center justify-end">
						<Button
							variant="ghost"
							size="sm"
							class="h-6 gap-1.5 px-2 text-[10px] text-muted-foreground hover:text-foreground"
							onclick={handleOpenFile}
						>
							<FileIcon class="size-3" />
							<span>Open skill file</span>
						</Button>
					</div>
				{/if}
			</div>
		{:else}
			<!-- Collapsed view: truncated preview -->
			<button
				type="button"
				class="collapsed-preview"
				onclick={onClickExpand}
				aria-label="Expand to see full description"
			>
				{#if hasDescription}
					<p class="line-clamp-2 text-left text-xs text-muted-foreground">
						{description}
					</p>
				{:else if hasFilePath}
					<p class="text-left text-xs text-muted-foreground/70">Click to see skill details</p>
				{/if}
			</button>
		{/if}
	</div>
{/if}

<style>
	.skill-content {
		border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
	}

	.collapsed-preview {
		display: block;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		transition: background-color 0.15s ease-out;
	}

	.collapsed-preview:hover {
		background-color: color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.skill-description {
		/* Limit the description height and make scrollable if too long */
		max-height: 200px;
		overflow-y: auto;
	}

	.skill-description :global(p) {
		margin: 0;
	}

	.skill-description :global(p + p) {
		margin-top: 0.5rem;
	}
</style>
