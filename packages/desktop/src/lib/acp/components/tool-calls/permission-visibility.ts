import { findOperationForPermission } from "../../store/operation-association.js";
import type { OperationStore } from "../../store/operation-store.svelte.js";
import type { PermissionRequest } from "../../types/permission.js";

import { shouldHidePermissionBarForExitPlan } from "./exit-plan-helpers.js";

export function isPermissionRepresentedByToolCall(
	permission: PermissionRequest,
	sessionId: string,
	operationStore: OperationStore
): boolean {
	if (permission.sessionId !== sessionId) {
		return false;
	}

	if (shouldHidePermissionBarForExitPlan(permission, operationStore)) {
		return true;
	}

	const operation = findOperationForPermission(operationStore, permission);
	return operation !== null;
}

export function visiblePermissionsForSessionBar(
	permissions: ReadonlyArray<PermissionRequest>,
	operationStore: OperationStore
): PermissionRequest[] {
	return permissions.filter(
		(permission) => !shouldHidePermissionBarForExitPlan(permission, operationStore)
	);
}
