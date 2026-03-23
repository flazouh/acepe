<script lang="ts">
import { FilePathBadge } from "@acepe/ui";
import FileView from "$lib/components/ui/code-block/file-view.svelte";

import type { ContentBlock } from "./logic/parse-content-blocks.js";

import MermaidDiagram from "./mermaid-diagram.svelte";

interface Props {
	blocks: ContentBlock[];
	repoContext?: { owner: string; repo: string };
}

let { blocks }: Props = $props();
</script>

{#each blocks as block, i (i)}
	{#if block.type === "html"}
		{@html block.content}
	{:else if block.type === "mermaid"}
		<MermaidDiagram code={block.code} />
	{:else if block.type === "file_path_badge"}
		{@const displayName = block.filePath.split("/").pop() ?? block.filePath}
		<FilePathBadge
			filePath={block.filePath}
			fileName={block.locationSuffix ? `${displayName}${block.locationSuffix}` : undefined}
			iconBasePath="/svgs/icons"
			linesAdded={block.linesAdded}
			linesRemoved={block.linesRemoved}
			interactive={false}
		/>
	{:else if block.type === "pierre_file"}
		<FileView file={block.code} lang={block.lang ?? undefined} maxHeight={520} disableLineNumbers />
	{:else if block.type === "github_badge"}
		<!-- GitHub badges are mounted inline via mountGitHubBadges; this branch is unreachable -->
	{/if}
{/each}
