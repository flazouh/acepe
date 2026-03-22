import type {
	PermissionMode,
	PermissionResult,
	PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";

function createAllowPermissionResult(
	updatedInput: Record<string, unknown> | undefined,
	updatedPermissions: PermissionUpdate[],
	toolUseID: string | undefined
): PermissionResult {
	const result: PermissionResult = {
		behavior: "allow",
		updatedInput,
		updatedPermissions,
	};

	if (toolUseID !== undefined) {
		result.toolUseID = toolUseID;
	}

	return result;
}

/**
 * Claude Code can hand us an empty `updatedPermissions` array when the user picked
 * an "always" style approval. In that case we still need to add the session rule
 * ourselves so the next tool call does not prompt again.
 */
export function finalizePermissionResult(
	result: PermissionResult,
	toolName: string,
	sessionPermissionMode: PermissionMode | undefined
): PermissionResult {
	if (result.behavior !== "allow") {
		return result;
	}

	if (result.updatedPermissions === undefined) {
		return result;
	}

	if (result.updatedPermissions.length > 0) {
		return result;
	}

	if (toolName === "ExitPlanMode" && sessionPermissionMode !== undefined) {
		return createAllowPermissionResult(
			result.updatedInput,
			[{ type: "setMode", mode: sessionPermissionMode, destination: "session" }],
			result.toolUseID
		);
	}

	return createAllowPermissionResult(
		result.updatedInput,
		[
			{
				type: "addRules",
				rules: [{ toolName }],
				behavior: "allow",
				destination: "session",
			},
		],
		result.toolUseID
	);
}
