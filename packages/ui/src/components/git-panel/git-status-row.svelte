<!--
	git-status-row.svelte — presentational file row for the Source Control "Changes" surface.

	One changed file: status glyph (tone-coded), path (basename emphasized, dir muted +
	truncated), inline +adds −dels, and hover-revealed primary/discard actions.

	Purely presentational: props + callbacks only. No stores, Tauri, or app policy.
-->
<script lang="ts">
	import PlusIcon from "../icons/plus-icon.svelte";
	import { RoundedIcon } from "../icons/index.js";

	import { Button } from "../button/index.js";
	import { cn } from "../../lib/utils.js";
	import type { GitStatusFile } from "./types.js";

	type StagedKind = "staged" | "unstaged";

	interface Props {
		file: GitStatusFile;
		/** Which list this row belongs to — drives the primary (stage vs unstage) action. */
		kind: StagedKind;
		selected: boolean;
		onSelect: (path: string) => void;
		/** Stage (kind="unstaged") or unstage (kind="staged") this file. */
		onPrimary: (path: string) => void;
		onDiscard: (path: string) => void;
	}

	let { file, kind, selected, onSelect, onPrimary, onDiscard }: Props = $props();

	// A file row reflects the status relevant to its list: index status when staged,
	// worktree status when unstaged. The host decides which list a file appears in.
	const statusCode = $derived(kind === "staged" ? file.indexStatus : file.worktreeStatus);

	const glyph = $derived.by(() => {
		switch (statusCode) {
			case "added":
				return "A";
			case "modified":
				return "M";
			case "deleted":
				return "D";
			case "renamed":
				return "R";
			case "untracked":
				return "U";
			default:
				return "•";
		}
	});

	const glyphTone = $derived.by(() => {
		switch (statusCode) {
			case "added":
			case "untracked":
				return "text-success";
			case "deleted":
				return "text-destructive";
			case "renamed":
				return "text-muted-foreground";
			default:
				return "text-foreground/70";
		}
	});

	const segments = $derived.by(() => {
		const lastSlash = file.path.lastIndexOf("/");
		if (lastSlash === -1) return { dir: "", base: file.path };
		return { dir: file.path.slice(0, lastSlash + 1), base: file.path.slice(lastSlash + 1) };
	});

	const primaryLabel = $derived(kind === "staged" ? "Unstage" : "Stage");
</script>

<div
	class={cn(
		"group/row flex h-7 items-center gap-2 rounded-md px-2 text-sm transition-colors",
		selected ? "bg-accent/60 text-foreground" : "text-foreground/90 hover:bg-accent/30"
	)}
>
	<button
		type="button"
		class="flex min-w-0 flex-1 items-center gap-2 text-left"
		onclick={() => onSelect(file.path)}
		title={file.path}
	>
		<span class={cn("w-3 shrink-0 text-center font-mono text-xs font-semibold", glyphTone)}>
			{glyph}
		</span>
		<span class="min-w-0 flex-1 truncate">
			{#if segments.dir}<span class="text-muted-foreground/70">{segments.dir}</span>{/if}<span
				>{segments.base}</span
			>
		</span>
	</button>

	<span class="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
		{#if file.additions > 0}
			<span class="text-success">+{file.additions}</span>
		{/if}
		{#if file.deletions > 0}
			<span class="text-destructive">−{file.deletions}</span>
		{/if}
	</span>

	<span class="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100">
		<Button
			variant="ghost"
			size="icon-2xs"
			title="Discard changes"
			aria-label="Discard {file.path}"
			onclick={() => onDiscard(file.path)}
		>
			{#snippet children()}<RoundedIcon name="undo" />{/snippet}
		</Button>
		<Button
			variant="ghost"
			size="icon-2xs"
			title={primaryLabel}
			aria-label="{primaryLabel} {file.path}"
			onclick={() => onPrimary(file.path)}
		>
			{#snippet children()}
				{#if kind === "staged"}<RoundedIcon name="minus" />{:else}<PlusIcon />{/if}
			{/snippet}
		</Button>
	</span>
</div>
