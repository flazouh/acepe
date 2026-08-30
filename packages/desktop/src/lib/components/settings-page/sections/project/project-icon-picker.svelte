<script lang="ts">
import type { ProjectIcon } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { onMount } from "svelte";
import { toast } from "svelte-sonner";
import { ProjectLetterBadge } from "@acepe/ui";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { backendClient } from "$lib/utils/backend-client.js";
import { convertFileSrc } from "$lib/utils/file-src.js";
import { cn } from "$lib/utils.js";
import {
	filterProjectIconCandidates,
	rankProjectIconCandidates,
} from "./project-icon-candidates.js";

interface Props {
	projectManager: ProjectManager;
	projectPath: string;
	projectName: string;
	projectColor: string;
	/** Absolute path of the picture the project shows now, resolved by the server. */
	iconPath: string | null;
	/** The stored choice, so the selected option can be marked. */
	icon: ProjectIcon;
}

let { projectManager, projectPath, projectName, projectColor, iconPath, icon }: Props = $props();

type Status = "loading" | "ready" | "error";

let status = $state<Status>("loading");
let candidates = $state<readonly string[]>([]);
let isSaving = $state(false);
let query = $state("");

/** A monorepo can offer thousands of images, so the grid is capped and filtered. */
const MAX_SHOWN = 60;

/**
 * The images this project holds, from the file index.
 *
 * The index is the right source rather than a fresh directory walk: it already
 * respects .gitignore, so a logo inside dist/ is never offered, and it is
 * already warmed for the open project.
 */
async function loadCandidates() {
	status = "loading";
	const result = await Effect.runPromise(
		Effect.result(backendClient.fileIndex.getProjectFiles(projectPath))
	);
	if (Result.isFailure(result)) {
		status = "error";
		return;
	}
	candidates = rankProjectIconCandidates(result.success.files.map((file) => file.path));
	status = "ready";
}

onMount(() => {
	void loadCandidates();
});

async function choose(next: ProjectIcon) {
	isSaving = true;
	const result = await Effect.runPromise(
		Effect.result(projectManager.updateProjectIcon(projectPath, next))
	);
	if (Result.isFailure(result)) {
		toast.error(`Failed to set project icon: ${result.failure.message}`);
	}
	isSaving = false;
}

const selectedPath = $derived(icon.kind === "custom" ? icon.path : null);
const matching = $derived(filterProjectIconCandidates(candidates, query));
const shown = $derived(matching.slice(0, MAX_SHOWN));

/**
 * Where a candidate lives on disk.
 *
 * Built here only to draw the thumbnail. The icon the project actually shows
 * still comes from the server's own resolution, never from this join.
 */
function previewSrc(relativePath: string): string {
	const separator = projectPath.endsWith("/") ? "" : "/";
	return convertFileSrc(`${projectPath}${separator}${relativePath}`);
}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center gap-3">
		<ProjectLetterBadge
			name={projectName}
			color={projectColor}
			iconSrc={iconPath ? convertFileSrc(iconPath) : null}
			size={32}
			fontSize={16}
			class="shrink-0"
		/>
		<div class="text-[11px] text-muted-foreground/70">
			{#if icon.kind === "custom"}
				Using {icon.path}
			{:else if icon.kind === "none"}
				Showing the letter badge.
			{:else if iconPath}
				Detected from this project's files.
			{:else}
				No image found, so the letter badge shows.
			{/if}
		</div>
	</div>

	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			disabled={isSaving}
			onclick={() => void choose({ kind: "auto" })}
			class={cn(
				"rounded-md border px-2 py-1 text-[11px] transition-colors",
				icon.kind === "auto"
					? "border-primary/60 bg-accent text-foreground"
					: "border-border/60 text-muted-foreground hover:bg-accent"
			)}
		>
			Detect automatically
		</button>
		<button
			type="button"
			disabled={isSaving}
			onclick={() => void choose({ kind: "none" })}
			class={cn(
				"rounded-md border px-2 py-1 text-[11px] transition-colors",
				icon.kind === "none"
					? "border-primary/60 bg-accent text-foreground"
					: "border-border/60 text-muted-foreground hover:bg-accent"
			)}
		>
			No icon
		</button>
	</div>

	{#if status === "loading"}
		<div class="flex items-center gap-2 py-2 text-[11px] text-muted-foreground/60">
			<Spinner class="text-muted-foreground/60" size={12} />
			Looking for images in this project
		</div>
	{:else if status === "error"}
		<div class="py-2 text-[11px] text-muted-foreground/70">
			Could not read this project's files.
		</div>
	{:else if candidates.length === 0}
		<div class="py-2 text-[11px] text-muted-foreground/70">
			This project has no images to choose from.
		</div>
	{:else}
		<input
			type="search"
			bind:value={query}
			placeholder="Filter images"
			aria-label="Filter project images"
			data-testid="project-icon-filter"
			class="w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-[11px] outline-none focus:border-primary/60"
		/>
		<div class="text-[10px] text-muted-foreground/60" data-testid="project-icon-count">
			{#if matching.length > shown.length}
				Showing {shown.length} of {matching.length} images. Filter to narrow.
			{:else}
				{matching.length}
				{matching.length === 1 ? "image" : "images"}
			{/if}
		</div>
		<div class="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2 overflow-auto">
			{#each shown as candidate (candidate)}
				<button
					type="button"
					disabled={isSaving}
					title={candidate}
					onclick={() => void choose({ kind: "custom", path: candidate })}
					class={cn(
						"flex flex-col items-center gap-1 rounded-md border p-2 transition-colors",
						selectedPath === candidate
							? "border-primary/60 bg-accent"
							: "border-border/60 hover:bg-accent"
					)}
				>
					<img
						src={previewSrc(candidate)}
						alt=""
						aria-hidden="true"
						class="size-8 object-contain"
					/>
					<span class="w-full truncate text-center text-[10px] text-muted-foreground/70">
						{candidate.split("/").pop()}
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
