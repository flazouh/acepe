/**
 * Git-overview orchestration for the session list (per-project branch / status /
 * remote-status loading + fetch/pull actions).
 *
 * Extracted verbatim from session-list-ui.svelte. The reactive collections stay
 * declared in the component and are passed in via `GitOverviewState`; these
 * functions mutate them by reference (SvelteMap/SvelteSet are reactive), so the
 * component's template bindings are unchanged. The `initializingGitProject`
 * scalar `$state` stays in the component (handleInitGitRepo).
 */

import type { SvelteMap, SvelteSet } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";
import type { GitRemoteStatus } from "$lib/utils/tauri-client/git.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

export type GitOverviewData = {
	branch: string | null;
	gitStatus: ReadonlyArray<FileGitStatus> | null;
	remoteStatus: GitRemoteStatus | null;
};

export interface GitOverviewState {
	gitDataByProject: SvelteMap<string, GitOverviewData>;
	gitLoadedProjects: SvelteSet<string>;
	nonGitProjects: SvelteSet<string>;
	fetchingProjects: SvelteSet<string>;
	pullingProjects: SvelteSet<string>;
	gitOverviewRequestVersionByProject: Map<string, number>;
}

export function loadGitOverview(state: GitOverviewState, projectPath: string): void {
	const {
		gitDataByProject,
		gitLoadedProjects,
		nonGitProjects,
		gitOverviewRequestVersionByProject,
	} = state;
	if (gitLoadedProjects.has(projectPath)) return;
	const requestVersion = (gitOverviewRequestVersionByProject.get(projectPath) ?? 0) + 1;
	gitOverviewRequestVersionByProject.set(projectPath, requestVersion);

	void tauriClient.git.isRepo(projectPath).match(
		(isRepo) => {
			if (gitOverviewRequestVersionByProject.get(projectPath) !== requestVersion) {
				return;
			}

			if (!isRepo) {
				gitLoadedProjects.delete(projectPath);
				gitDataByProject.delete(projectPath);
				nonGitProjects.add(projectPath);
				return;
			}

			gitLoadedProjects.add(projectPath);
			void tauriClient.fileIndex.getProjectGitOverviewSummary(projectPath).match(
				(overview) => {
					if (gitOverviewRequestVersionByProject.get(projectPath) !== requestVersion) {
						return;
					}

					nonGitProjects.delete(projectPath);
					gitDataByProject.set(projectPath, {
						branch: overview.branch,
						gitStatus: overview.gitStatus,
						remoteStatus: null,
					});
					// Also load remote status
					void tauriClient.git.remoteStatus(projectPath).match(
						(status) => {
							if (gitOverviewRequestVersionByProject.get(projectPath) !== requestVersion) {
								return;
							}

							const current = gitDataByProject.get(projectPath);
							if (current) {
								gitDataByProject.set(projectPath, {
									branch: current.branch,
									gitStatus: current.gitStatus,
									remoteStatus: status,
								});
							}
						},
						() => {}
					);
				},
				() => {
					if (gitOverviewRequestVersionByProject.get(projectPath) !== requestVersion) {
						return;
					}

					gitLoadedProjects.delete(projectPath);
					gitDataByProject.delete(projectPath);
					nonGitProjects.add(projectPath);
				}
			);
		},
		() => {
			if (gitOverviewRequestVersionByProject.get(projectPath) !== requestVersion) {
				return;
			}

			gitLoadedProjects.delete(projectPath);
			gitDataByProject.delete(projectPath);
			nonGitProjects.add(projectPath);
		}
	);
}

export function fetchRemote(state: GitOverviewState, projectPath: string): void {
	const { gitDataByProject, fetchingProjects } = state;
	if (fetchingProjects.has(projectPath)) return;
	fetchingProjects.add(projectPath);

	void tauriClient.git.fetch(projectPath).match(
		() => {
			void tauriClient.git.remoteStatus(projectPath).match(
				(status) => {
					const current = gitDataByProject.get(projectPath);
					if (current) {
						gitDataByProject.set(projectPath, { ...current, remoteStatus: status });
					}
					fetchingProjects.delete(projectPath);
				},
				() => {
					fetchingProjects.delete(projectPath);
				}
			);
		},
		() => {
			fetchingProjects.delete(projectPath);
		}
	);
}

export function pullRemote(state: GitOverviewState, projectPath: string): void {
	const { gitLoadedProjects, pullingProjects } = state;
	if (pullingProjects.has(projectPath)) return;
	pullingProjects.add(projectPath);

	void tauriClient.git.pull(projectPath).match(
		() => {
			gitLoadedProjects.delete(projectPath);
			loadGitOverview(state, projectPath);
			toast.success("Branch updated");
			pullingProjects.delete(projectPath);
		},
		(err) => {
			toast.error(err?.message ?? "Pull failed");
			pullingProjects.delete(projectPath);
		}
	);
}
