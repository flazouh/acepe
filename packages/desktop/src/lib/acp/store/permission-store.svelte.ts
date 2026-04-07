/**
 * Permission Store - Manages permission requests from agents.
 *
 * This store handles pending permission requests from ACP and OpenCode agents,
 * allowing users to grant or deny permissions for file operations.
 *
 * For ACP mode (Claude Code), permissions can arrive either as session updates
 * carrying a JSON-RPC reply route or as legacy inbound JSON-RPC requests.
 * Replies are still sent back via JSON-RPC.
 *
 * For OpenCode HTTP mode, permissions come via session updates
 * and responses are sent via HTTP endpoints.
 */

import { errAsync, okAsync, ResultAsync, type ResultAsync as ResultAsyncType } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { AppError } from "../errors/app-error.js";
import { AgentError } from "../errors/app-error.js";

import { replyToPermissionRequest } from "../logic/interaction-reply.js";
import type { Operation } from "../types/operation.js";
import type { PermissionRequest } from "../types/permission.js";
import type { ToolCall } from "../types/tool-call.js";
import { isExitPlanPermission } from "../utils/exit-plan-permission.js";
import { createLogger } from "../utils/logger.js";
import { permissionMatchesToolCall } from "../utils/permission-tool-match.js";
import { findOperationForPermission, permissionMatchesOperation } from "./operation-association.js";
import { InteractionStore } from "./interaction-store.svelte.js";
import type { OperationStore } from "./operation-store.svelte.js";

const PERMISSION_STORE_KEY = Symbol("permission-store");
const logger = createLogger({ id: "permission-store", name: "PermissionStore" });

export class PermissionStore {
	private interactions = new InteractionStore();
	private sessionBatchTotals = new SvelteMap<string, number>();
	private sessionBatchCompleted = new SvelteMap<string, number>();

	constructor(interactions?: InteractionStore) {
		if (interactions !== undefined) {
			this.interactions = interactions;
		}
	}

	get pending(): SvelteMap<string, PermissionRequest> {
		return this.interactions.permissionsPending;
	}

	/** Callback to check if a permission should be auto-accepted (e.g. child sessions or Autonomous). */
	private shouldAutoAccept:
		| ((permission: PermissionRequest) => boolean | "child-session" | "autonomous-live")
		| null = null;

	private countPendingForSession(sessionId: string): number {
		let count = 0;
		for (const permission of this.pending.values()) {
			if (permission.sessionId === sessionId) {
				count += 1;
			}
		}
		return count;
	}

	private clearSessionProgress(sessionId: string): void {
		this.sessionBatchTotals.delete(sessionId);
		this.sessionBatchCompleted.delete(sessionId);
	}

	private notePermissionAdded(sessionId: string, hadPendingBeforeAdd: boolean): void {
		if (!hadPendingBeforeAdd) {
			this.sessionBatchTotals.set(sessionId, 1);
			this.sessionBatchCompleted.set(sessionId, 0);
			return;
		}

		const currentTotal = this.sessionBatchTotals.get(sessionId);
		if (currentTotal !== undefined && currentTotal > 0) {
			this.sessionBatchTotals.set(sessionId, currentTotal + 1);
		} else {
			this.sessionBatchTotals.set(sessionId, this.countPendingForSession(sessionId));
		}

		if (!this.sessionBatchCompleted.has(sessionId)) {
			this.sessionBatchCompleted.set(sessionId, 0);
		}
	}

	private notePermissionResolved(sessionId: string): void {
		const totalValue = this.sessionBatchTotals.get(sessionId);
		const total = totalValue !== undefined ? totalValue : 0;
		if (total > 0) {
			const completedValue = this.sessionBatchCompleted.get(sessionId);
			const completed = completedValue !== undefined ? completedValue : 0;
			this.sessionBatchCompleted.set(sessionId, Math.min(total, completed + 1));
		}

		if (this.countPendingForSession(sessionId) === 0) {
			this.clearSessionProgress(sessionId);
		}
	}

	/** Configure auto-accept predicate. Returns a dispose function. */
	setAutoAccept(
		fn: (permission: PermissionRequest) => boolean | "child-session" | "autonomous-live"
	): () => void {
		this.shouldAutoAccept = fn;
		return () => {
			this.shouldAutoAccept = null;
		};
	}

	private restorePermissionAfterFailedReply(
		permission: PermissionRequest,
		totalBeforeReply: number | undefined,
		completedBeforeReply: number | undefined
	): void {
		this.pending.set(permission.id, permission);

		if (totalBeforeReply !== undefined) {
			this.sessionBatchTotals.set(permission.sessionId, totalBeforeReply);
		} else {
			this.sessionBatchTotals.delete(permission.sessionId);
		}

		if (completedBeforeReply !== undefined) {
			this.sessionBatchCompleted.set(permission.sessionId, completedBeforeReply);
		} else {
			this.sessionBatchCompleted.delete(permission.sessionId);
		}
	}

	private getToolCallId(permission: PermissionRequest): string {
		return permission.tool?.callID ? permission.tool.callID : permission.id;
	}

	private shouldPreferPermission(
		candidate: PermissionRequest,
		current: PermissionRequest | undefined
	): boolean {
		if (!current) {
			return true;
		}

		const candidateRequestId = candidate.jsonRpcRequestId;
		const currentRequestId = current.jsonRpcRequestId;
		if (candidateRequestId !== undefined && currentRequestId !== undefined) {
			return candidateRequestId > currentRequestId;
		}

		return true;
	}

	/**
	 * Add a pending permission request.
	 *
	 * Permissions from child sessions (subtasks) are auto-accepted silently
	 * when an `isChildSession` check is configured via `setChildSessionCheck()`.
	 */
	add(permission: PermissionRequest): void {
		const hadPendingBeforeAdd = this.countPendingForSession(permission.sessionId) > 0;
		this.pending.set(permission.id, permission);
		this.notePermissionAdded(permission.sessionId, hadPendingBeforeAdd);

		const autoAcceptDecision =
			this.shouldAutoAccept !== null && !isExitPlanPermission(permission)
				? this.shouldAutoAccept(permission)
				: false;
		const autoAcceptSource =
			autoAcceptDecision === true
				? "auto"
				: autoAcceptDecision === false
					? null
					: autoAcceptDecision;

		if (autoAcceptSource) {
			logger.info("Auto-accepting permission", {
				permissionId: permission.id,
				sessionId: permission.sessionId,
				tool: permission.permission,
				source: autoAcceptSource,
			});
			void this.reply(permission.id, "once").match(
				() => {},
				(err) => logger.error("Failed to auto-accept permission", { error: err })
			);
			return;
		}

		logger.debug("Permission request added", {
			permissionId: permission.id,
			toolCallId: permission.tool?.callID,
			jsonRpcRequestId: permission.jsonRpcRequestId,
		});
	}

	/**
	 * Get the most recent pending permission for a given session-scoped tool call.
	 */
	getForToolCall(
		sessionId: string | undefined,
		toolCallOrId: string | ToolCall
	): PermissionRequest | undefined {
		if (!sessionId) {
			return undefined;
		}

		const toolCallId = typeof toolCallOrId === "string" ? toolCallOrId : toolCallOrId.id;
		let latest: PermissionRequest | undefined;
		for (const permission of this.pending.values()) {
			const permissionToolCallId = this.getToolCallId(permission);
			if (permission.sessionId !== sessionId) {
				continue;
			}
			const isDirectMatch = permissionToolCallId === toolCallId;
			const isSemanticMatch =
				!isDirectMatch &&
				typeof toolCallOrId !== "string" &&
				permissionMatchesToolCall(permission, toolCallOrId);
			if (!isDirectMatch && !isSemanticMatch) {
				continue;
			}
			if (this.shouldPreferPermission(permission, latest)) {
				latest = permission;
			}
		}
		return latest;
	}

	getForSession(sessionId: string): PermissionRequest[] {
		const permissions: PermissionRequest[] = [];
		for (const permission of this.pending.values()) {
			if (permission.sessionId === sessionId) {
				permissions.push(permission);
			}
		}
		return permissions;
	}

	getForOperation(operation: Operation, operationStore: OperationStore): PermissionRequest | undefined {
		let latest: PermissionRequest | undefined;
		for (const permission of this.pending.values()) {
			if (permission.sessionId !== operation.sessionId) {
				continue;
			}

			if (!permissionMatchesOperation(permission, operation)) {
				continue;
			}

			const permissionToolCallId = this.getToolCallId(permission);
			const isDirectMatch = permissionToolCallId === operation.toolCallId;
			if (!isDirectMatch) {
				const matchedOperation = findOperationForPermission(operationStore, permission);
				if (matchedOperation?.id !== operation.id) {
					continue;
				}
			}

			if (this.shouldPreferPermission(permission, latest)) {
				latest = permission;
			}
		}

		return latest;
	}

	getSessionProgress(sessionId: string): { total: number; completed: number } | null {
		const totalValue = this.sessionBatchTotals.get(sessionId);
		const total = totalValue !== undefined ? totalValue : this.countPendingForSession(sessionId);
		if (total <= 0) {
			return null;
		}

		const completedValue = this.sessionBatchCompleted.get(sessionId);
		const completed = completedValue !== undefined ? completedValue : 0;
		return {
			total,
			completed: Math.min(completed, total),
		};
	}

	/**
	 * Remove a pending permission request.
	 */
	remove(permissionId: string): void {
		const permission = this.pending.get(permissionId);
		this.pending.delete(permissionId);
		if (permission && this.countPendingForSession(permission.sessionId) === 0) {
			this.clearSessionProgress(permission.sessionId);
		}
		logger.debug("Permission request removed", { permissionId });
	}

	/**
	 * Remove all permissions for a session.
	 */
	removeForSession(sessionId: string): void {
		for (const [id, p] of this.pending) {
			if (p.sessionId === sessionId) this.pending.delete(id);
		}
		this.clearSessionProgress(sessionId);
		logger.debug("Permissions removed for session", { sessionId });
	}

	/**
	 * Resolve the optionId to send back to the ACP subprocess.
	 *
	 * The ACP subprocess sends options with specific optionIds (e.g., "default", "acceptEdits", "plan").
	 * We need to map our generic reply types to the correct optionId from the original request.
	 */
	private resolveOptionId(
		permission: PermissionRequest,
		reply: "once" | "always" | "reject"
	): string {
		// Try to find matching option from the stored options
		const options = permission.metadata.options;

		if (options && options.length > 0) {
			const kindToMatch =
				reply === "always" ? "allow_always" : reply === "once" ? "allow_once" : "reject_once";
			const matchingOption = options.find((o) => o.kind === kindToMatch);
			if (matchingOption) {
				return matchingOption.optionId;
			}
		}

		// Fallback to generic optionIds if no matching option found
		return reply === "always" ? "allow_always" : reply === "once" ? "allow" : "reject";
	}

	/**
	 * Reply to a permission request.
	 *
	 * The shared interaction reply layer resolves the correct transport.
	 */
	reply(permissionId: string, reply: "once" | "always" | "reject"): ResultAsync<void, AppError> {
		const permission = this.pending.get(permissionId);
		if (!permission) {
			return errAsync(
				new AgentError("replyPermission", new Error(`Permission not found: ${permissionId}`))
			);
		}

		const totalBeforeReply = this.sessionBatchTotals.get(permission.sessionId);
		const completedBeforeReply = this.sessionBatchCompleted.get(permission.sessionId);

		// Eagerly remove from pending map so the UI updates immediately.
		// The user's intent is clear — don't wait for the async IPC response.
		this.pending.delete(permissionId);
		this.notePermissionResolved(permission.sessionId);
		logger.debug("Permission request removed", { permissionId });

		const optionId = this.resolveOptionId(permission, reply);

		return replyToPermissionRequest(permission, reply, optionId)
			.map(() => {
				logger.debug("Permission reply sent", { permissionId, reply, optionId });
			})
			.mapErr((error) => {
				this.restorePermissionAfterFailedReply(
					permission,
					totalBeforeReply,
					completedBeforeReply
				);
				return error;
			});
	}

	drainPendingForSession(sessionId: string): ResultAsyncType<void, AppError> {
		const pendingPermissions = this.getForSession(sessionId);
		if (pendingPermissions.length === 0) {
			return okAsync(undefined);
		}

		return ResultAsync.combine(
			pendingPermissions.map((permission) => {
				if (!this.pending.has(permission.id)) {
					return okAsync(undefined);
				}
				if (isExitPlanPermission(permission)) {
					return okAsync(undefined);
				}

				logger.info("Draining autonomous permission", {
					permissionId: permission.id,
					sessionId: permission.sessionId,
					tool: permission.permission,
					source: "drain-on-enable",
				});
				return this.reply(permission.id, "once");
			})
		).map(() => undefined);
	}

	cancelForSession(sessionId: string): ResultAsyncType<void, AppError> {
		const pendingPermissions = this.getForSession(sessionId);
		if (pendingPermissions.length === 0) {
			return okAsync(undefined);
		}

		return ResultAsync.combine(
			pendingPermissions.map((permission) => {
				if (!this.pending.has(permission.id)) {
					return okAsync(undefined);
				}

				logger.info("Cancelling pending permission for interrupted turn", {
					permissionId: permission.id,
					sessionId: permission.sessionId,
					tool: permission.permission,
				});
				return this.reply(permission.id, "reject");
			})
		).map(() => undefined);
	}
}

/**
 * Create and set the permission store in Svelte context.
 */
export function createPermissionStore(interactions?: InteractionStore): PermissionStore {
	const store = new PermissionStore(interactions);
	setContext(PERMISSION_STORE_KEY, store);
	return store;
}

/**
 * Get the permission store from Svelte context.
 */
export function getPermissionStore(): PermissionStore {
	return getContext<PermissionStore>(PERMISSION_STORE_KEY);
}
