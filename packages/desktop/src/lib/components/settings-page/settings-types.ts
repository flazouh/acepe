export type SettingsSectionId =
	| "general"
	| "appearance"
	| "chat"
	| "agents"
	| "voice"
	| "skills"
	| "keybindings"
	| "mcp"
	| "git"
	| "environments"
	| "worktrees"
	| "archived"
	| "usage";

/**
 * Maps legacy section ids (used in persisted state or deep links) to their new home.
 * Returns the input unchanged when it is still a valid id.
 */
export function migrateSettingsSectionId(id: string): SettingsSectionId {
	switch (id) {
		case "general":
		case "appearance":
		case "chat":
		case "agents":
		case "voice":
		case "skills":
		case "keybindings":
		case "mcp":
		case "git":
		case "environments":
		case "worktrees":
		case "archived":
		case "usage":
			return id;
		// Legacy ids
		case "configuration":
			return "agents";
		case "personalization":
			return "voice";
		case "project":
			return "agents";
		default:
			return "general";
	}
}
