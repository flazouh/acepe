<script lang="ts">
import { DiffPill } from "@acepe/ui";
import IconFile from "@tabler/icons-svelte/icons/file";
import * as Diff from "diff";

import type { DiffContent } from "../../../schemas/tool-call-content.schema.js";

interface Props {
	content: DiffContent;
}

let { content }: Props = $props();

// Parse the diff into lines
interface DiffLine {
	type: "added" | "removed" | "unchanged" | "header";
	content: string;
	oldLineNumber?: number;
	newLineNumber?: number;
}

const diffLines = $derived.by((): DiffLine[] => {
	if (!content.oldText && !content.newText) {
		return [];
	}

	// If no old text, this is a new file
	if (!content.oldText) {
		return content.newText.split("\n").map((line, i) => ({
			type: "added" as const,
			content: line,
			newLineNumber: i + 1,
		}));
	}

	// Compute unified diff
	const changes = Diff.diffLines(content.oldText, content.newText);
	const lines: DiffLine[] = [];
	let oldLine = 1;
	let newLine = 1;

	for (const change of changes) {
		const changeLines = change.value.split("\n");
		// Remove trailing empty string from split
		if (changeLines[changeLines.length - 1] === "") {
			changeLines.pop();
		}

		for (const line of changeLines) {
			if (change.added) {
				lines.push({ type: "added", content: line, newLineNumber: newLine++ });
			} else if (change.removed) {
				lines.push({ type: "removed", content: line, oldLineNumber: oldLine++ });
			} else {
				lines.push({
					type: "unchanged",
					content: line,
					oldLineNumber: oldLine++,
					newLineNumber: newLine++,
				});
			}
		}
	}

	return lines;
});

// Calculate diff stats
const stats = $derived.by(() => {
	let added = 0;
	let removed = 0;
	for (const line of diffLines) {
		if (line.type === "added") added++;
		if (line.type === "removed") removed++;
	}
	return { added, removed };
});

// Get file name from path
const fileName = $derived(content.path.split("/").pop() ?? content.path);

// Show limited lines in collapsed view
const MAX_COLLAPSED_LINES = 8;
const visibleLines = $derived(diffLines.slice(0, MAX_COLLAPSED_LINES));
const hasMoreLines = $derived(diffLines.length > MAX_COLLAPSED_LINES);
</script>

<div class="rounded-md border bg-card overflow-hidden">
	<!-- Header -->
	<div class="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
		<IconFile class="size-4 text-muted-foreground" />
		<span class="text-xs font-medium text-foreground truncate" title={content.path}>
			{fileName}
		</span>
		<DiffPill insertions={stats.added} deletions={stats.removed} class="ml-auto" />
	</div>

	<!-- Diff content -->
	<div class="text-xs font-mono overflow-x-auto">
		{#each visibleLines as line (line.oldLineNumber ?? line.newLineNumber ?? line.content)}
			{@const lineClass = [
				"flex px-2 py-0.5 border-l-2",
				line.type === "added" ? "bg-green-500/10 border-l-green-500" : "",
				line.type === "removed" ? "bg-red-500/10 border-l-red-500" : "",
				line.type === "unchanged" ? "border-l-transparent" : "",
			]
				.filter(Boolean)
				.join(" ")}
			<div class={lineClass}>
				<!-- Line numbers -->
				<span class="w-8 shrink-0 text-muted-foreground/50 select-none text-right pr-2">
					{line.oldLineNumber ?? ""}
				</span>
				<span class="w-8 shrink-0 text-muted-foreground/50 select-none text-right pr-2">
					{line.newLineNumber ?? ""}
				</span>
				<!-- Sign -->
				<span class="w-4 shrink-0 select-none">
					{#if line.type === "added"}
						<span class="text-green-600 dark:text-green-400">+</span>
					{:else if line.type === "removed"}
						<span class="text-red-600 dark:text-red-400">-</span>
					{:else}
						<span class="text-muted-foreground/30">&nbsp;</span>
					{/if}
				</span>
				<!-- Content -->
				<span class="flex-1 whitespace-pre">{line.content || " "}</span>
			</div>
		{/each}

		{#if hasMoreLines}
			<div class="px-3 py-2 text-xs text-muted-foreground bg-muted/20 border-t">
				... {diffLines.length - MAX_COLLAPSED_LINES} more lines
			</div>
		{/if}
	</div>
</div>
