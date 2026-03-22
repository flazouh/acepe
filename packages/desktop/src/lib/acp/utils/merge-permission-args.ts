import type { ToolArguments } from "../../services/converted-session-types.js";
import type { PermissionRequest } from "../types/permission.js";

/**
 * Merge a pending permission's parsed arguments into existing tool arguments.
 *
 * Uses Rust-parsed `parsedArguments` (agent-agnostic, typed via ToolArguments::from_raw).
 * parsedArguments is always present for ACP permissions.
 */
export function mergePermissionArgs(
	args: ToolArguments,
	permission: PermissionRequest | null | undefined
): ToolArguments {
	if (!permission?.metadata) return args;

	// Use Rust-parsed ToolArguments (agent-agnostic)
	const parsed = permission.metadata.parsedArguments as ToolArguments | undefined;
	if (parsed && parsed.kind === args.kind) {
		const merged = mergeTypedArgs(args, parsed);
		// Codex edit permissions can provide payload in rawInput.changes[path]
		// while parsedArguments only contains kind/file_path. Enrich missing fields.
		if (merged.kind === "edit") {
			return enrichEditArgsFromRawInput(merged, extractRawInput(permission));
		}
		return merged;
	}

	return args;
}

/**
 * Generic shallow merge of two ToolArguments of the same kind.
 *
 * Uses the parsed (Rust-side) arguments as base, then overlays any non-null
 * fields from the existing args (which may have streaming updates).
 *
 * Safety: the kind-guard ensures both objects are the same discriminated union
 * variant. ToolArguments is auto-generated from Rust via specta, so new fields
 * automatically flow through without TS-side changes.
 */
function mergeTypedArgs(base: ToolArguments, parsed: ToolArguments): ToolArguments {
	if (base.kind !== parsed.kind) return base;

	const result = { ...parsed };
	for (const [key, value] of Object.entries(base)) {
		if (value != null) {
			(result as Record<string, unknown>)[key] = value;
		}
	}
	return result as ToolArguments;
}

function extractRawInput(
	permission: PermissionRequest | null | undefined
): Record<string, unknown> | null {
	const raw = permission?.metadata?.rawInput;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	return raw as Record<string, unknown>;
}

type CodexEditChangeShape = {
	old_content?: unknown;
	new_content?: unknown;
};

function enrichEditArgsFromRawInput(
	args: Extract<ToolArguments, { kind: "edit" }>,
	rawInput: Record<string, unknown> | null
): Extract<ToolArguments, { kind: "edit" }> {
	if (!rawInput) return args;

	const changes = rawInput.changes;
	if (typeof changes !== "object" || changes === null || Array.isArray(changes)) {
		return args;
	}

	const entries = Object.entries(changes as Record<string, unknown>);
	if (entries.length === 0) {
		return args;
	}

	const [filePathFromChange, firstChange] = entries[0] ?? [];
	if (!firstChange || typeof firstChange !== "object" || Array.isArray(firstChange)) {
		return args;
	}

	const change = firstChange as CodexEditChangeShape;
	const oldFromChanges = str(change.old_content);
	const newFromChanges = str(change.new_content);

	return {
		...args,
		file_path: args.file_path ?? pathStr(filePathFromChange),
		old_string: args.old_string ?? oldFromChanges,
		new_string: args.new_string ?? newFromChanges,
		content: args.content ?? newFromChanges,
	};
}

function str(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function pathStr(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
