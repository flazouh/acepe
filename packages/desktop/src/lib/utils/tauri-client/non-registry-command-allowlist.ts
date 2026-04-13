/**
 * Commands intentionally outside the Rust Tauri registry.
 *
 * These are either plugin commands or other runtime-only surfaces the app still
 * needs to call explicitly.
 */
export const NON_REGISTRY_COMMANDS = {
	notifications: {
		send: "plugin:notification|show_notification",
		get_permission: "plugin:notification|is_permission_granted",
		request_permission: "plugin:notification|request_permission",
	},
} as const;

/**
 * File-scoped exceptions for static literal Tauri command usage.
 *
 * Keep this empty unless there is a compelling reason a callsite cannot use the
 * generated command client or a typed wrapper.
 */
export const ALLOWED_STATIC_TAURI_INVOKES: ReadonlyArray<{
	filePath: string;
	command: string;
}> = [];
