import type { SessionEntry } from "../../application/dto/session-entry.js";
import type { OperationStore } from "../../store/operation-store.svelte.js";
import type { PermissionRequest } from "../../types/permission.js";
import { findOperationForPermission } from "../../store/operation-association.js";

import { shouldHidePermissionBarForExitPlan } from "./exit-plan-helpers.js";

export function isPermissionRepresentedByToolCall(
	permission: PermissionRequest,
	sessionId: string,
	operationStore: OperationStore,
	entries: ReadonlyArray<SessionEntry>
): boolean {
	if (shouldHidePermissionBarForExitPlan(permission, entries)) {
		return true;
	}

	return findOperationForPermission(operationStore, permission) !== null && permission.sessionId === sessionId;
}

export function visiblePermissionsForSessionBar(
	permissions: ReadonlyArray<PermissionRequest>,
	entries: ReadonlyArray<SessionEntry>
): PermissionRequest[] {
	return permissions.filter((permission) => !shouldHidePermissionBarForExitPlan(permission, entries));
}
