<script lang="ts">
import { Button, PillButton } from "@acepe/ui";
import { DownloadSimple } from "phosphor-svelte";
import { Folder } from "phosphor-svelte";
import { FolderOpen } from "phosphor-svelte";
import { GitBranch } from "phosphor-svelte";
import { Link } from "phosphor-svelte";
import { MagnifyingGlass } from "phosphor-svelte";
import { toast } from "svelte-sonner";
import { ProjectClient } from "$lib/acp/logic/project-client.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import { tauriClient } from "$lib/utils/tauri-client.js";

import type {
	AddProjectView,
	OpenProjectDialogProps,
	ProjectWithSessions,
} from "./open-project-dialog-props.js";

import { shouldShowDiscoveredProject, sortProjectsBySessionCount } from "./project-discovery.js";
import ProjectTable from "./project-table.svelte";
import {
	extractProjectDisplayNameFromPath,
	filterProjectsBySearchQuery,
	getImportFooterProjectLabel,
	isCloneFormValid,
} from "./open-project-dialog-state.js";

let {
	open,
	onOpenChange,
	onProjectImported,
	onCloneComplete,
	onBrowseFolder,
}: OpenProjectDialogProps = $props();

// ─── Import view state ─────────────────────────────────────────────
let projects = $state<ProjectWithSessions[]>([]);
let loading = $state(false);
let addedPaths = $state<Set<string>>(new Set());
let searchQuery = $state("");
// Guard: Track whether projects were already loaded this dialog session
let projectsLoadedThisSession = false;

// ─── Clone view state ──────────────────────────────────────────────
let cloneUrl = $state("");
let cloneDestination = $state("");
let cloneBranch = $state("main");
let cloning = $state(false);

// ─── View state ────────────────────────────────────────────────────
let activeView = $state<AddProjectView>("import");

const projectClient = new ProjectClient();

const filteredProjects = $derived.by(() => {
	return filterProjectsBySearchQuery(projects, searchQuery);
});

const cloneIsValid = $derived(isCloneFormValid(cloneUrl, cloneDestination));
const importFooterProjectLabel = $derived.by(() =>
	getImportFooterProjectLabel({
		searchQuery,
		filteredProjectCount: filteredProjects.length,
		projectCount: projects.length,
	})
);

// Scan for projects when dialog opens
$effect(() => {
	if (open && !projectsLoadedThisSession) {
		projectsLoadedThisSession = true;
		loadExistingProjects();
		loadProjects();
	}
});

async function loadExistingProjects() {
	const result = await projectClient.getProjects();
	result.match(
		(existingProjects) => {
			addedPaths = new Set(existingProjects.map((p) => p.path));
		},
		(error) => {
			console.warn("Failed to load existing projects:", error);
		}
	);
}

async function loadProjects() {
	loading = true;
	projects = [];

	// Phase 1: Fast project path discovery (~20ms)
	const pathsResult = await tauriClient.history.listAllProjectPaths();

	pathsResult.match(
		(projectInfos) => {
			// Create projects with loading placeholders, filter out root directory and "global"
			projects = projectInfos.filter(shouldShowDiscoveredProject).map((info) => ({
				path: info.path,
				name: extractProjectDisplayNameFromPath(info.path),
				agentCounts: new Map(),
				totalSessions: "loading" as const,
			}));

			loading = false;

			// Phase 2: Progressive count loading
			loadSessionCountsProgressively();
		},
		(error) => {
			console.error("Failed to list project paths:", error);
			toast.error("Failed to scan projects");
			loading = false;
		}
	);
}

async function loadSessionCountsProgressively() {
	// Group projects by path to deduplicate (plain Map is fine here, not reactive)
	const projectsByPath = new Map<string, ProjectWithSessions>();
	for (const project of projects) {
		projectsByPath.set(project.path, project);
	}

	// Load counts for each project progressively
	const countPromises = Array.from(projectsByPath.keys()).map(async (projectPath) => {
		const result = await tauriClient.history.countSessionsForProject(projectPath);

		result.match(
			(counts) => {
				const project = projectsByPath.get(counts.path);
				if (project) {
					// Update the project's counts
					project.agentCounts = new Map(
						Object.entries(counts.counts).map(([agentId, count]) => [agentId, count])
					);
					project.totalSessions = Object.values(counts.counts).reduce(
						(sum, count) => sum + count,
						0
					);

					// Re-sort projects by total sessions (most sessions first)
					// Projects still loading go to the end
					projects = sortProjectsBySessionCount(projects);
				}
			},
			(error) => {
				console.warn(`Failed to count sessions for ${projectPath}:`, error);
				// Set to error state instead of leaving as loading
				const project = projectsByPath.get(projectPath);
				if (project) {
					project.totalSessions = "error";
				}
			}
		);
	});

	// Wait for all counts to load (but UI updates progressively)
	await Promise.allSettled(countPromises);
}

async function handleImport(path: string, name: string) {
	// Prevent duplicate imports
	if (addedPaths.has(path)) {
		return;
	}

	// Import the project to database directly
	const result = await tauriClient.projects
		.importProject(path, name)
		.mapErr((error) => new Error(`Failed to import project: ${error}`))
		.map(() => {
			// Mark as added
			addedPaths = new Set([...addedPaths, path]);

			// Show toast
			toast.success(`${name} added to repositories`);
		})
		.mapErr((error) => {
			// Show error toast
			toast.error(error.message);
		});

	// Only notify parent after import completes successfully
	if (result.isOk()) {
		onProjectImported(path, name);
	}
}

async function handleUndoImport(path: string, name: string) {
	if (!addedPaths.has(path)) {
		return;
	}

	const result = await tauriClient.projects.removeProject(path);
	result.match(
		() => {
			const nextAddedPaths = new Set(addedPaths);
			nextAddedPaths.delete(path);
			addedPaths = nextAddedPaths;
			toast.success(`${name} removed from repositories`);
		},
		(error) => {
			toast.error(error.message);
		}
	);
}

// ─── Clone logic ───────────────────────────────────────────────────

async function handleCloneBrowse() {
	const result = await tauriClient.git.browseDestination();
	result.match(
		(selectedPath) => {
			if (selectedPath) {
				cloneDestination = selectedPath;
			}
		},
		(_error) => {
			toast.error("Failed to browse for folder");
		}
	);
}

async function handleClone() {
	if (!cloneIsValid) return;

	cloning = true;

	const url = cloneUrl.trim();
	const destination = cloneDestination.trim();
	const branch = cloneBranch.trim() || undefined;

	const result = await tauriClient.git.clone(url, destination, branch);

	result.match(
		(cloneResult) => {
			toast.success("Repository cloned successfully");
			onCloneComplete(cloneResult.path, cloneResult.name);
			handleOpenChange(false);
		},
		(error) => {
			toast.error(`Clone failed: ${error.message}`);
			cloning = false;
		}
	);
}

function resetCloneForm() {
	cloneUrl = "";
	cloneDestination = "";
	cloneBranch = "main";
	cloning = false;
}

// ─── Dialog lifecycle ──────────────────────────────────────────────

function handleOpenChange(newOpen: boolean) {
	// Prevent closing while clone is in progress
	if (!newOpen && cloning) return;

	onOpenChange(newOpen);
	if (!newOpen) {
		projects = [];
		addedPaths = new Set();
		searchQuery = "";
		projectsLoadedThisSession = false;
		activeView = "import";
		resetCloneForm();
	}
}
</script>

<DialogFrame
	{open}
	title="Add Project"
	closeLabel="Close add project"
	contentOverflow="hidden"
	contentClass="!rounded-lg"
	onOpenChange={handleOpenChange}
>
	{#snippet topLeft()}
		{#if activeView === "import"}
			<label
				class="flex h-5 w-52 shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted px-2"
			>
				<MagnifyingGlass size={11} class="shrink-0 text-muted-foreground/60" />
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="search"
					placeholder="Filter projects..."
					bind:value={searchQuery}
					class="min-w-0 flex-1 bg-transparent border-none outline-none text-[11px] text-foreground placeholder:text-muted-foreground/50"
					aria-label="Filter projects"
					autofocus
				/>
			</label>
		{/if}
	{/snippet}

	{#snippet topRight()}
		<Button
			variant="chromeIcon"
			size="chromeIcon"
			data-header-control
			class="rounded-sm"
			active={activeView === "import"}
			title="Import from history"
			aria-label="Import from history"
			onclick={() => {
				activeView = "import";
			}}
		>
			{#snippet children()}
				<DownloadSimple size={14} />
			{/snippet}
		</Button>
		<Button
			variant="chromeIcon"
			size="chromeIcon"
			data-header-control
			class="rounded-sm"
			active={activeView === "clone"}
			title="Clone repository"
			aria-label="Clone repository"
			onclick={() => {
				activeView = "clone";
			}}
		>
			{#snippet children()}
				<GitBranch size={14} />
			{/snippet}
		</Button>
		<Button
			variant="chromeIcon"
			size="chromeIcon"
			data-header-control
			class="rounded-sm"
			title="Browse folder"
			aria-label="Browse folder"
			onclick={() => onBrowseFolder()}
		>
			{#snippet children()}
				<Folder size={14} />
			{/snippet}
		</Button>
	{/snippet}

	<div class="flex h-full min-h-0 flex-col overflow-hidden">
		{#if activeView === "import"}
			<!-- Project list (scrollable body) -->
			<div class="flex flex-1 min-h-0 flex-col overflow-hidden">
				<ProjectTable
					projects={filteredProjects}
					{loading}
					{addedPaths}
					onImport={handleImport}
					onUndo={handleUndoImport}
				/>
			</div>

			<!-- Footer -->
			{#if !loading && projects.length > 0}
				<div
					class="flex items-center px-3 h-7 border-t border-border/30 text-[10px] font-mono text-muted-foreground bg-accent/5 shrink-0"
				>
					<span>
						{importFooterProjectLabel}
					</span>
					{#if addedPaths.size > 0}
						<span class="mx-1.5 text-border">·</span>
						<span>{`${addedPaths.size} imported`}</span>
					{/if}
				</div>
			{/if}
		{:else}
			<!-- Clone form (scrollable body) -->
			<div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
				<!-- URL field -->
				<div class="space-y-1.5">
					<label class="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
						<Link size={12} />
						{"Repository URL"}
					</label>
					<input
						type="text"
						bind:value={cloneUrl}
						placeholder={"https://github.com/user/repo.git"}
						disabled={cloning}
						class="w-full h-8 px-2.5 text-[12px] font-mono bg-accent/10 border border-border/30 rounded-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:ring-1 focus:ring-ring/50 disabled:opacity-50"
					/>
				</div>

				<!-- Destination field -->
				<div class="space-y-1.5">
					<label class="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
						<FolderOpen size={12} />
						{"Destination"}
					</label>
					<div class="flex items-center gap-2">
						<input
							type="text"
							value={cloneDestination}
							placeholder={"Select a folder..."}
							readonly
							disabled={cloning}
							class="w-full h-8 px-2.5 text-[12px] font-mono bg-accent/10 border border-border/30 rounded-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:ring-1 focus:ring-ring/50 disabled:opacity-50"
						/>
						<PillButton
							variant="outline"
							size="sm"
							disabled={cloning}
							onclick={handleCloneBrowse}
						>
							{"Browse"}
						</PillButton>
					</div>
				</div>

				<!-- Branch field -->
				<div class="space-y-1.5">
					<label class="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
						<GitBranch size={12} />
						{"Branch"}
					</label>
					<input
						type="text"
						bind:value={cloneBranch}
						placeholder={"main"}
						disabled={cloning}
						class="w-full h-8 px-2.5 text-[12px] font-mono bg-accent/10 border border-border/30 rounded-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:ring-1 focus:ring-ring/50 disabled:opacity-50"
					/>
				</div>

				<!-- Clone action -->
				<div class="flex justify-end pt-2">
					<PillButton
						variant="outline"
						size="sm"
						disabled={!cloneIsValid || cloning}
						onclick={handleClone}
					>
						{#if cloning}
							<Spinner size={12} />
							{"Cloning..."}
						{:else}
							<DownloadSimple size={14} />
							{"Clone"}
						{/if}
					</PillButton>
				</div>
			</div>
		{/if}
	</div>
</DialogFrame>
