<!--
  WorktreeToggle - Container component.

  Orchestrates the worktree toggle state and renders the worktree button
  and branch picker. Handles lifecycle (effect cleanup, state sync).

  When enabled on an empty session, creates a worktree and triggers
  session creation via callback.
-->
<script lang="ts">
import { listen } from "@tauri-apps/api/event";
import { toast } from "svelte-sonner";
import { cn } from "$lib/utils.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { AppError } from "../../errors/app-error.js";
import type { WorktreeInfo } from "../../types/worktree-info.js";
import BranchPicker from "./branch-picker.svelte";
import type { OnWorktreeCreatedCallback, OnWorktreeRenamedCallback } from "./types.js";
import WorktreeToggleButton from "./worktree-toggle-button.svelte";
import {
	computeIsDisabled,
	computeIsPending,
	computeTooltipText,
} from "./worktree-toggle-logic.js";
import { getWorktreeDefaultStore } from "./worktree-default-store.svelte.js";
import { WorktreeToggleState } from "./worktree-toggle-state.svelte.js";

interface Props {
	panelId: string;
	projectPath: string | null;
	activeWorktreePath?: string | null;
	hasEdits: boolean;
	hasMessages: boolean;
	globalWorktreeDefault?: boolean;
	worktreeDeleted?: boolean;
	onWorktreeCreated?: OnWorktreeCreatedCallback;
	onWorktreeRenamed?: OnWorktreeRenamedCallback;
	onOpenSettings?: () => void;
	onPendingChange?: (pending: boolean) => void;
	/** Visual variant: "minimal" = no dividers, pill triggers; "default" = standard footer look. */
	variant?: "default" | "minimal";
}

const props: Props = $props();

const worktreeDefaultStore = getWorktreeDefaultStore();

function handleAutoWorktreeChange(enabled: boolean): void {
	void worktreeDefaultStore.set(enabled);
}

// Create state instance - panelId is stable for the component lifetime
const toggleState = new WorktreeToggleState({
	panelId: props.panelId,
	projectPath: props.projectPath,
	globalDefault: props.globalWorktreeDefault ? props.globalWorktreeDefault : false,
});

let initializingGit = $state(false);
let previousProjectPath = $state<string | null>(props.projectPath ? props.projectPath : null);

// isPending, isDisabled, tooltipText derived after effectiveWorktreeName (below)

// Check git repo when projectPath changes, with proper cleanup
// Note: Only depends on projectPath, not hasEdits
$effect(() => {
	const currentPath = props.projectPath;
	if ((currentPath ? currentPath : null) !== previousProjectPath) {
		// Prevent stale worktree/branch context from leaking across project switches.
		toggleState.worktreeInfo = null;
		toggleState.detectedBranch = null;
		previousProjectPath = currentPath ? currentPath : null;
	}
	if (currentPath) {
		const controller = new AbortController();
		toggleState.checkGitRepo(currentPath, controller.signal);

		return () => {
			controller.abort();
		};
	} else {
		toggleState.clearGitRepoState();
	}
});

// Watch for external branch changes via .git/HEAD file watcher
$effect(() => {
	const targetPath = branchTargetPath;
	if (!targetPath) return;

	// Start backend file watcher (idempotent)
	void tauriClient.git.watchHead(targetPath);

	let disposed = false;
	const unlistenPromise = listen<{ projectPath: string; branch: string | null }>(
		"git:head-changed",
		(event) => {
			if (disposed || event.payload.projectPath !== targetPath) return;
			toggleState.setCurrentBranch(event.payload.branch ? event.payload.branch : "");
			// Re-fetch diff stats
			void tauriClient.git.diffStats(targetPath).match(
				(stats) => {
					if (disposed) return;
					toggleState.diffStats =
						stats.insertions > 0 || stats.deletions > 0
							? { insertions: stats.insertions, deletions: stats.deletions }
							: null;
				},
				() => {
					if (!disposed) toggleState.diffStats = null;
				}
			);
		}
	);

	return () => {
		disposed = true;
		unlistenPromise.then((fn) => fn()).catch(() => {});
	};
});

function handleCreate(): void {
	if (toggleState.loading) return;
	// Toggle pending state — actual worktree creation happens on message send
	toggleState.togglePending();
	props.onPendingChange?.(toggleState.enabled);
}

function handleInitGitRepo(): void {
	const currentPath = props.projectPath;
	if (!currentPath || initializingGit) return;
	initializingGit = true;
	void tauriClient.git.init(currentPath).match(
		() => {
			initializingGit = false;
			// Set isGitRepo directly — the existing $effect on projectPath will handle full re-check
			toggleState.isGitRepo = true;
			toast.success("Git repository initialized");
		},
		(error) => {
			initializingGit = false;
			const message = error.cause?.message
				? error.cause.message
				: error.message
					? error.message
					: "Failed to initialize git repository";
			toast.error(message);
		}
	);
}

function handleRename(nextName: string): void {
	const currentPath = effectiveWorktreePath;
	if (!currentPath) return;

	void tauriClient.git.worktreeRename(currentPath, nextName).match(
		(info) => {
			toggleState.worktreeInfo = info;
			toggleState.setCurrentBranch(info.branch);
			props.onWorktreeRenamed?.(info);
			toast.success(`Renamed worktree to ${info.name}`);
		},
		(error) => {
			const message = error.cause?.message ? error.cause.message : error.message;
			toast.error(message);
		}
	);
}

const effectiveWorktreePath = $derived(
	toggleState.worktreeDirectory
		? toggleState.worktreeDirectory
		: props.activeWorktreePath
			? props.activeWorktreePath
			: null
);
const effectiveWorktreeName = $derived.by(() => {
	if (toggleState.worktreeName) return toggleState.worktreeName;
	const activePath = props.activeWorktreePath ? props.activeWorktreePath : null;
	if (!activePath) return null;
	const parts = activePath.split("/").filter((segment) => segment.length > 0);
	return parts.length > 0 ? (parts[parts.length - 1] ? parts[parts.length - 1] : null) : null;
});
const branchTargetPath = $derived(effectiveWorktreePath ? effectiveWorktreePath : props.projectPath);

// Pending/disabled/tooltip derivations (depend on effectiveWorktreeName)
const isPending = $derived(
	// Pending when toggle is enabled but no worktree exists yet (manual toggle or global default)
	(toggleState.enabled || (props.globalWorktreeDefault ? props.globalWorktreeDefault : false)) &&
		effectiveWorktreeName === null &&
		!props.hasMessages &&
		toggleState.isGitRepo === true
);
const isDisabled = $derived(
	// Never disable when pending (user needs to be able to untoggle)
	props.hasMessages ||
		props.hasEdits ||
		toggleState.loading ||
		toggleState.isCreatingWorktree ||
		toggleState.isGitRepo === false
);
const tooltipText = $derived(
	computeTooltipText(
		toggleState.loading,
		toggleState.isGitRepo,
		props.hasEdits,
		toggleState.enabled,
		toggleState.isCreatingWorktree,
		props.hasMessages,
		isPending
	)
);

const showDividers = $derived(props.variant !== "minimal");
</script>

<div class="flex items-center justify-between w-full h-full">
	<!-- Left: Worktree picker -->
	<div class={cn("flex items-center h-full", showDividers && "border-r border-border/50")}>
		<WorktreeToggleButton
			disabled={isDisabled}
			loading={toggleState.loading || toggleState.isCreatingWorktree}
			{tooltipText}
			worktreeName={effectiveWorktreeName}
			pending={isPending}
			deleted={props.worktreeDeleted ? props.worktreeDeleted : false}
			autoWorktree={props.globalWorktreeDefault ? props.globalWorktreeDefault : false}
			onCreate={handleCreate}
			onAutoWorktreeChange={handleAutoWorktreeChange}
			onRename={handleRename}
			onOpenSettings={props.onOpenSettings}
			variant={props.variant}
		/>
	</div>
	<!-- Right: Branch picker -->
	<div class={cn("ml-auto flex items-center h-full", showDividers && "border-l border-border/50")}>
		<BranchPicker
			projectPath={branchTargetPath}
			currentBranch={toggleState.currentBranch}
			diffStats={toggleState.diffStats}
			isGitRepo={toggleState.isGitRepo}
			isWorktree={effectiveWorktreePath !== null}
			onBranchSelected={(branch) => toggleState.setCurrentBranch(branch)}
			onInitGitRepo={handleInitGitRepo}
			variant={props.variant}
		/>
	</div>
</div>
