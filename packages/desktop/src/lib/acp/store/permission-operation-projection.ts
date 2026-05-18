import { isExitPlanPermission } from "../utils/exit-plan-permission.js";
import type { PermissionRequest } from "../types/permission.js";
import { findOperationForPermission } from "./operation-association.js";
import type { OperationStore } from "./operation-store.svelte.js";

export function shouldHidePermissionBarForExitPlanFromOperations(
	permission: PermissionRequest,
	operationStore: OperationStore
): boolean {
	if (!isExitPlanPermission(permission)) {
		return false;
	}

	const toolReference = permission.tool;
	if (toolReference !== undefined) {
		const operation = operationStore.getByToolCallId(permission.sessionId, toolReference.callID);
		if (operation?.kind === "exit_plan_mode") {
			return true;
		}
	}

	for (const operation of operationStore.getSessionOperations(permission.sessionId)) {
		if (operation.kind === "exit_plan_mode") {
			return true;
		}
	}

	return false;
}

export function isPermissionRepresentedByOperation(
	permission: PermissionRequest,
	sessionId: string,
	operationStore: OperationStore
): boolean {
	if (shouldHidePermissionBarForExitPlanFromOperations(permission, operationStore)) {
		return true;
	}

	return (
		findOperationForPermission(operationStore, permission) !== null &&
		permission.sessionId === sessionId
	);
}

export function visiblePermissionsForOperations(
	permissions: ReadonlyArray<PermissionRequest>,
	operationStore: OperationStore
): PermissionRequest[] {
	return permissions.filter(
		(permission) => !shouldHidePermissionBarForExitPlanFromOperations(permission, operationStore)
	);
}
