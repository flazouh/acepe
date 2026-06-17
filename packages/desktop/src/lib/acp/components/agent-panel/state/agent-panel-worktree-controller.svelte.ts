/**
 * AgentPanelWorktreeController — owns worktree/pre-session local state,
 * derived path chain, and event handlers hoisted from agent-panel.svelte.
 * Composes with WorktreeSetupController and WorktreeCloseConfirmationController.
 */

import { toast } from "svelte-sonner";
import type { Project } from "../../../logic/project-manager.svelte.js";
import type { PanelStore } from "../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../store/session-store.svelte.js";
import type { PreparedWorktreeLaunch, WorktreeInfo } from "../../../types/worktree-info.js";
import { removeWorktreeAndMarkSessionWorktreeDeleted } from "../logic/index.js";
import { shouldShowPreSessionWorktreeCard } from "../logic/pre-session-worktree-card-visibility.js";
import { resolveAgentPanelWorktreePending } from "../logic/worktree-pending.js";
import {
	discardPreparedWorktreeSessionLaunch,
	persistSessionWorktreePathAfterRename,
	removeWorktreeFromDisk,
} from "../services/index.js";
import type { WorktreeCloseConfirmationController } from "./worktree-close-confirmation-controller.svelte.js";
import type { WorktreeSetupController } from "./worktree-setup-controller.svelte.js";

export interface AgentPanelWorktreeControllerDeps {
	getSessionId: () => string | null;
	getPanelId: () => string | undefined;
	getSessionWorktreePath: () => string | null;
	getSessionProjectPath: () => string | null;
	getSessionAgentId: () => string | null;
	getWorktreeToggleProjectPath: () => string | null;
	getHasMessages: () => boolean;
	getPendingProjectSelection: () => boolean;
	getPanelPendingWorktreeEnabled: () => boolean | null;
	getPanelPreparedWorktreeLaunch: () => PreparedWorktreeLaunch | null;
	getPendingWorktreeSetup: () => { projectPath: string; worktreePath: string | null } | null;
	getAllProjects: () => readonly Project[];
	panelStore: PanelStore;
	sessionStore: SessionStore;
	worktreeSetup: WorktreeSetupController;
	worktreeCloseConfirm: WorktreeCloseConfirmationController;
	onClose?: () => void;
	logWorktreeCreated?: (details: Record<string, string | null>) => void;
	logWorktreeCreatedEarlyReturn?: () => void;
}

export class AgentPanelWorktreeController {
	readonly #deps: AgentPanelWorktreeControllerDeps;
	#activeWorktreePath = $state<string | null>(null);
	#activeWorktreeOwnerProjectPath = $state<string | null>(null);
	#worktreeDeleted = $state(false);
	#preSessionWorktreeFailure = $state<string | null>(null);

	constructor(deps: AgentPanelWorktreeControllerDeps) {
		this.#deps = deps;
	}

	get activeWorktreePath(): string | null {
		return this.#activeWorktreePath;
	}

	get activeWorktreeOwnerProjectPath(): string | null {
		return this.#activeWorktreeOwnerProjectPath;
	}

	get worktreeDeleted(): boolean {
		return this.#worktreeDeleted;
	}

	setWorktreeDeleted(value: boolean): void {
		this.#worktreeDeleted = value;
	}

	get preSessionWorktreeFailure(): string | null {
		return this.#preSessionWorktreeFailure;
	}

	clearPreSessionWorktreeFailure(): void {
		this.#preSessionWorktreeFailure = null;
	}

	readonly scopedActiveWorktreePath = $derived.by(() => {
		const activeWorktreePath = this.#activeWorktreePath;
		if (!activeWorktreePath) {
			return null;
		}
		const worktreeToggleProjectPath = this.#deps.getWorktreeToggleProjectPath();
		if (!worktreeToggleProjectPath) {
			return null;
		}
		return this.#activeWorktreeOwnerProjectPath === worktreeToggleProjectPath
			? activeWorktreePath
			: null;
	});

	readonly effectiveActiveWorktreePath = $derived.by(
		() => this.#deps.getSessionWorktreePath() ?? this.scopedActiveWorktreePath
	);

	readonly effectivePathForGit = $derived.by(() => {
		const worktreeToggleProjectPath = this.#deps.getWorktreeToggleProjectPath();
		const wt = this.#worktreeDeleted ? null : this.effectiveActiveWorktreePath;
		return wt ?? worktreeToggleProjectPath ?? null;
	});

	readonly activeWorktreeName = $derived.by(() => {
		const worktreePath = this.effectiveActiveWorktreePath;
		if (!worktreePath) {
			return null;
		}
		const segments = worktreePath.split("/").filter((segment) => segment.length > 0);
		return segments.length > 0 ? (segments[segments.length - 1] ?? null) : null;
	});

	readonly footerWorktreeStatus = $derived.by(() => {
		const sessionId = this.#deps.getSessionId();
		const worktreeToggleProjectPath = this.#deps.getWorktreeToggleProjectPath();
		if (!sessionId || !worktreeToggleProjectPath) {
			return null;
		}
		if (this.effectiveActiveWorktreePath && this.activeWorktreeName) {
			return {
				mode: "worktree" as const,
				primaryLabel: this.activeWorktreeName,
				secondaryLabel: null,
			};
		}
		return null;
	});

	readonly worktreePending = $derived.by(() =>
		resolveAgentPanelWorktreePending({
			activeWorktreePath: this.effectiveActiveWorktreePath,
			hasMessages: this.#deps.getHasMessages(),
			pendingWorktreeEnabled: this.#deps.getPanelPendingWorktreeEnabled(),
			hasPreparedWorktreeLaunch: this.#deps.getPanelPreparedWorktreeLaunch() !== null,
		})
	);

	readonly showPreSessionWorktreeCard = $derived.by(() =>
		shouldShowPreSessionWorktreeCard({
			sessionId: this.#deps.getSessionId(),
			pendingProjectSelection: this.#deps.getPendingProjectSelection(),
			worktreeToggleProjectPath: this.#deps.getWorktreeToggleProjectPath(),
			hasPendingWorktreeSetup: this.#deps.getPendingWorktreeSetup() !== null,
			worktreeSetupVisible: this.#deps.worktreeSetup.state?.isVisible === true,
			hasMessages: this.#deps.getHasMessages(),
		})
	);

	readonly preSessionSelectedProject = $derived.by(() => {
		const worktreeToggleProjectPath = this.#deps.getWorktreeToggleProjectPath();
		if (!worktreeToggleProjectPath) {
			return null;
		}
		return (
			this.#deps.getAllProjects().find((candidate) => candidate.path === worktreeToggleProjectPath) ??
			null
		);
	});

	handleWorktreeCloseOnly(): void {
		this.#deps.worktreeCloseConfirm.dismiss();
		this.#deps.onClose?.();
	}

	handleWorktreeRemoveAndClose(): void {
		const worktreePath = this.effectiveActiveWorktreePath;
		const currentSessionId = this.#deps.getSessionId();
		const force = this.#deps.worktreeCloseConfirm.hasDirtyChanges;
		this.#deps.worktreeCloseConfirm.dismiss();
		this.#deps.onClose?.();
		void removeWorktreeAndMarkSessionWorktreeDeleted(
			{
				force,
				sessionId: currentSessionId,
				worktreePath,
			},
			{
				removeWorktree: (path, shouldForce) => removeWorktreeFromDisk(path, shouldForce),
				markSessionWorktreeDeleted: (id) => {
					this.#deps.sessionStore.write.updateSession(id, { worktreeDeleted: true });
				},
				clearSessionWorktreeDeleted: (id) => {
					this.#deps.sessionStore.write.updateSession(id, { worktreeDeleted: false });
				},
				disconnectSession: (id) => {
					this.#deps.sessionStore.connection.disconnectSession(id);
				},
			}
		).mapErr((error) => {
			console.error("[AgentPanel] Failed to remove worktree", { error });
			toast.error(`Failed to remove worktree: ${error.message}`);
		});
	}

	handleWorktreeCloseCancel(): void {
		this.#deps.worktreeCloseConfirm.cancel();
	}

	handleWorktreeCreated(info: WorktreeInfo | string): void {
		const nextDirectory = typeof info === "string" ? info : info.directory;
		this.#preSessionWorktreeFailure = null;
		this.#activeWorktreePath = nextDirectory;
		this.#activeWorktreeOwnerProjectPath = this.#deps.getWorktreeToggleProjectPath();

		const projectPath =
			this.#deps.getSessionProjectPath() ?? this.#deps.getWorktreeToggleProjectPath() ?? "";
		this.#deps.logWorktreeCreated?.({
			sessionId: this.#deps.getSessionId() ?? null,
			sessionProjectPath: this.#deps.getSessionProjectPath(),
			worktreeToggleProjectPath: this.#deps.getWorktreeToggleProjectPath(),
			projectPath: projectPath || null,
			infoDirectory: nextDirectory,
		});
		if (!projectPath) {
			this.#deps.logWorktreeCreatedEarlyReturn?.();
			return;
		}
		this.#deps.logWorktreeCreated?.({
			activeWorktreePath: nextDirectory,
			projectPath,
		});

		const sessionId = this.#deps.getSessionId();
		if (sessionId) {
			this.#deps.sessionStore.write.updateSession(sessionId, {
				worktreeDeleted: false,
				worktreePath: nextDirectory,
			});
		}
	}

	handlePreparedWorktreeLaunch(launch: PreparedWorktreeLaunch): void {
		this.#preSessionWorktreeFailure = null;
		const panelId = this.#deps.getPanelId();
		if (panelId) {
			this.#deps.panelStore.setPreparedWorktreeLaunch(panelId, launch);
		}
		this.#activeWorktreePath = launch.worktree.directory;
		this.#activeWorktreeOwnerProjectPath = this.#deps.getWorktreeToggleProjectPath();
	}

	handlePreSessionWorktreeFailure(message: string): void {
		this.#preSessionWorktreeFailure = message;
	}

	handleWorktreeRenamed(info: WorktreeInfo): void {
		this.#activeWorktreePath = info.directory;
		this.#activeWorktreeOwnerProjectPath =
			this.#deps.getWorktreeToggleProjectPath() ?? this.#deps.getSessionProjectPath() ?? null;

		const sessionId = this.#deps.getSessionId();
		if (!sessionId) {
			return;
		}

		this.#deps.sessionStore.write.updateSession(sessionId, {
			worktreeDeleted: false,
			worktreePath: info.directory,
		});

		const sessionProjectPath = this.#deps.getSessionProjectPath();
		const sessionAgentId = this.#deps.getSessionAgentId();
		void persistSessionWorktreePathAfterRename(
			sessionId,
			info.directory,
			sessionProjectPath ? sessionProjectPath : undefined,
			sessionAgentId ? sessionAgentId : undefined
		).mapErr((error) => {
			console.error("Failed to persist renamed worktree path to DB", {
				sessionId,
				worktreePath: info.directory,
				error,
			});
		});
	}

	handlePreSessionWorktreeYes(): void {
		this.#preSessionWorktreeFailure = null;
		const panelId = this.#deps.getPanelId();
		if (panelId) {
			this.#deps.panelStore.setPendingWorktreeEnabled(panelId, true);
		}
	}

	handlePreSessionWorktreeNo(): void {
		this.#preSessionWorktreeFailure = null;
		const panelId = this.#deps.getPanelId();
		if (!panelId) {
			return;
		}
		const preparedLaunch = this.#deps.getPanelPreparedWorktreeLaunch();
		if (preparedLaunch) {
			void discardPreparedWorktreeSessionLaunch(preparedLaunch.launchToken, true).match(
				() => {
					this.#deps.panelStore.clearPreparedWorktreeLaunch(panelId);
				},
				(error) => {
					toast.error(`Failed to discard prepared worktree: ${error.message}`);
				}
			);
		}
		this.#deps.panelStore.setPendingWorktreeEnabled(panelId, false);
	}

	handlePreSessionWorktreeDismiss(): void {
		this.#preSessionWorktreeFailure = null;
		const panelId = this.#deps.getPanelId();
		if (!panelId) {
			return;
		}
		const preparedLaunch = this.#deps.getPanelPreparedWorktreeLaunch();
		if (preparedLaunch) {
			void discardPreparedWorktreeSessionLaunch(preparedLaunch.launchToken, true).match(
				() => {
					this.#deps.panelStore.clearPreparedWorktreeLaunch(panelId);
				},
				(error) => {
					toast.error(`Failed to discard prepared worktree: ${error.message}`);
				}
			);
		}
		this.#deps.panelStore.setPendingWorktreeEnabled(panelId, false);
	}

	handleRetryWorktree(retrySend: (() => void) | undefined): void {
		this.#preSessionWorktreeFailure = null;
		retrySend?.();
	}

	handleStartInProjectRoot(): void {
		this.#preSessionWorktreeFailure = null;
		const panelId = this.#deps.getPanelId();
		const preparedLaunch = this.#deps.getPanelPreparedWorktreeLaunch();
		if (panelId && preparedLaunch) {
			void discardPreparedWorktreeSessionLaunch(preparedLaunch.launchToken, true).match(
				() => {
					this.#activeWorktreePath = null;
					this.#activeWorktreeOwnerProjectPath = null;
					this.#deps.panelStore.clearPreparedWorktreeLaunch(panelId);
					this.#deps.panelStore.setPendingWorktreeEnabled(panelId, false);
				},
				(error) => {
					toast.error(`Failed to discard prepared worktree: ${error.message}`);
				}
			);
			return;
		}
		this.#activeWorktreePath = null;
		this.#activeWorktreeOwnerProjectPath = null;
		if (panelId) {
			this.#deps.panelStore.setPendingWorktreeEnabled(panelId, false);
		}
	}

	onSessionCreated(): void {
		this.#preSessionWorktreeFailure = null;
	}
}
