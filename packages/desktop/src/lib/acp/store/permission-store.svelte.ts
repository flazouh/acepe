/**
 * Permission Store - Manages permission requests from agents.
 *
 * This store handles pending permission requests from ACP and OpenCode agents,
 * allowing users to grant or deny permissions for file operations.
 *
 * For ACP mode (Claude Code), permissions come via JSON-RPC inbound requests
 * and responses are sent back via JSON-RPC.
 *
 * For OpenCode HTTP mode, permissions come via session updates
 * and responses are sent via HTTP endpoints.
 */

import { errAsync, type ResultAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { AppError } from "../errors/app-error.js";
import { AgentError } from "../errors/app-error.js";

import { respondToPermission } from "../logic/inbound-request-handler.js";
import type { PermissionRequest } from "../types/permission.js";
import { createLogger } from "../utils/logger.js";
import { api } from "./api.js";

const PERMISSION_STORE_KEY = Symbol("permission-store");
const logger = createLogger({ id: "permission-store", name: "PermissionStore" });

export class PermissionStore {
	pending = new SvelteMap<string, PermissionRequest>();

	/** Callback to check if a permission should be auto-accepted (e.g. child sessions). */
	private shouldAutoAccept: ((permission: PermissionRequest) => boolean) | null = null;

	/** Configure auto-accept predicate. Returns a dispose function. */
	setAutoAccept(fn: (permission: PermissionRequest) => boolean): () => void {
		this.shouldAutoAccept = fn;
		return () => {
			this.shouldAutoAccept = null;
		};
	}

	/**
	 * Add a pending permission request.
	 *
	 * Permissions from child sessions (subtasks) are auto-accepted silently
	 * when an `isChildSession` check is configured via `setChildSessionCheck()`.
	 */
	add(permission: PermissionRequest): void {
		this.pending.set(permission.id, permission);

		if (this.shouldAutoAccept?.(permission)) {
			logger.info("Auto-accepting permission", {
				permissionId: permission.id,
				sessionId: permission.sessionId,
				tool: permission.permission,
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
	 * Get the most recent pending permission for a given tool call.
	 */
	getForToolCall(toolCallId: string): PermissionRequest | undefined {
		let latest: PermissionRequest | undefined;
		for (const permission of this.pending.values()) {
			const permissionToolCallId = permission.tool ? permission.tool.callID : permission.id;
			if (permissionToolCallId === toolCallId) {
				latest = permission;
			}
		}
		return latest;
	}

	/**
	 * Remove a pending permission request.
	 */
	remove(permissionId: string): void {
		this.pending.delete(permissionId);
		logger.debug("Permission request removed", { permissionId });
	}

	/**
	 * Remove all permissions for a session.
	 */
	removeForSession(sessionId: string): void {
		for (const [id, p] of this.pending) {
			if (p.sessionId === sessionId) this.pending.delete(id);
		}
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
		const options = permission.metadata?.options as
			| Array<{ kind: string; optionId: string }>
			| undefined;

		if (options?.length) {
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
	 * For ACP mode (Claude Code), uses JSON-RPC response via respondToPermission.
	 * For OpenCode HTTP mode, uses the HTTP endpoint via api.replyPermission.
	 */
	reply(permissionId: string, reply: "once" | "always" | "reject"): ResultAsync<void, AppError> {
		const permission = this.pending.get(permissionId);
		if (!permission) {
			return errAsync(
				new AgentError("replyPermission", new Error(`Permission not found: ${permissionId}`))
			);
		}

		// Eagerly remove from pending map so the UI updates immediately.
		// The user's intent is clear — don't wait for the async IPC response.
		this.remove(permissionId);

		// If this permission has a JSON-RPC request ID, use the JSON-RPC response mechanism (ACP mode)
		if (permission.jsonRpcRequestId !== undefined) {
			const allowed = reply !== "reject";
			const optionId = this.resolveOptionId(permission, reply);

			return respondToPermission(
				permission.sessionId,
				permission.jsonRpcRequestId,
				allowed,
				optionId
			)
				.map(() => {
					logger.debug("Permission replied via JSON-RPC", { permissionId, reply, optionId });
				})
				.mapErr((err) => new AgentError("replyPermission", new Error(err.message)) as AppError);
		}

		// Otherwise, use the HTTP endpoint (OpenCode mode)
		return api.replyPermission(permission.sessionId, permissionId, reply).map(() => {
			logger.debug("Permission replied via HTTP", { permissionId, reply });
		});
	}
}

/**
 * Create and set the permission store in Svelte context.
 */
export function createPermissionStore(): PermissionStore {
	const store = new PermissionStore();
	setContext(PERMISSION_STORE_KEY, store);
	return store;
}

/**
 * Get the permission store from Svelte context.
 */
export function getPermissionStore(): PermissionStore {
	return getContext<PermissionStore>(PERMISSION_STORE_KEY);
}
