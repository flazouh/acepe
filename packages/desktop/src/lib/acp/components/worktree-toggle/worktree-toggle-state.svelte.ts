/**
 * WorktreeToggleState - Manages worktree toggle reactive state.
 *
 * Uses Svelte 5 runes for reactivity. Pure logic is in worktree-toggle-logic.ts.
 */

import { tauriClient } from "$lib/utils/tauri-client.js";
import type { WorktreeInfo } from "../../types/worktree-info.js";
import type { WorktreeToggleConfig } from "./types.js";

import { loadWorktreeEnabled, saveWorktreeEnabled } from "./worktree-storage.js";

export class WorktreeToggleState {
	readonly #panelId: string;

	// Reactive state
	enabled = $state(false);
	isGitRepo = $state<boolean | null>(null);
	loading = $state(false);
	isCreatingWorktree = $state(false);
	worktreeInfo = $state<WorktreeInfo | null>(null);
	detectedBranch = $state<string | null>(null);
	diffStats = $state<{ insertions: number; deletions: number } | null>(null);

	constructor(config: WorktreeToggleConfig) {
		this.#panelId = config.panelId;
		this.enabled = loadWorktreeEnabled(config.panelId, config.globalDefault);
	}

	/**
	 * Check if the project path is a git repository.
	 * Supports cancellation via AbortSignal.
	 */
	async checkGitRepo(projectPath: string, signal: AbortSignal): Promise<void> {
		this.loading = true;
		this.isGitRepo = null;
		this.detectedBranch = null;

		const result = await tauriClient.git.isRepo(projectPath);

		if (signal.aborted) {
			return;
		}

		result
			.map((isRepo) => {
				this.isGitRepo = isRepo;
				this.loading = false;

				if (isRepo) {
					void tauriClient.git.currentBranch(projectPath).match(
						(branch) => {
							if (!signal.aborted) {
								this.detectedBranch = branch;
							}
						},
						() => {
							if (!signal.aborted) {
								this.detectedBranch = null;
							}
						}
					);
					void tauriClient.git.diffStats(projectPath).match(
						(stats) => {
							if (!signal.aborted) {
								this.diffStats =
									stats.insertions > 0 || stats.deletions > 0
										? { insertions: stats.insertions, deletions: stats.deletions }
										: null;
							}
						},
						() => {
							if (!signal.aborted) {
								this.diffStats = null;
							}
						}
					);
				}
			})
			.mapErr(() => {
				this.isGitRepo = false;
				this.loading = false;
				this.detectedBranch = null;
				this.diffStats = null;
			});
	}

	/**
	 * Clear git repo state (when project path is null).
	 */
	clearGitRepoState(): void {
		this.isGitRepo = null;
		this.loading = false;
		this.detectedBranch = null;
		this.diffStats = null;
	}

	/**
	 * Toggle pending state — the actual worktree creation happens on message send.
	 */
	togglePending(): void {
		this.enabled = !this.enabled;
		saveWorktreeEnabled(this.#panelId, this.enabled);
	}

	/**
	 * Get the worktree name if available.
	 */
	get worktreeName(): string | null {
		return this.worktreeInfo?.name ?? null;
	}

	/**
	 * Get the worktree directory path if available.
	 */
	get worktreeDirectory(): string | null {
		return this.worktreeInfo?.directory ?? null;
	}

	setCurrentBranch(branch: string): void {
		this.detectedBranch = branch;
	}

	/**
	 * Get the active branch, preferring created worktree branch when available.
	 */
	get currentBranch(): string | null {
		return this.detectedBranch ?? this.worktreeInfo?.branch ?? null;
	}
}
