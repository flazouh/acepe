export type SettingsSectionId =
	| "general"
	| "appearance"
	| "chat"
	| "agents"
	| "skills"
	| "keybindings"
	| "mcp"
	| "git"
	| "project"
	| "environments"
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
		case "skills":
		case "keybindings":
		case "mcp":
		case "git":
		case "project":
		case "environments":
		case "archived":
		case "usage":
			return id;
		// Legacy ids
		case "worktrees":
			return "git";
		case "configuration":
			return "agents";
		case "voice":
		case "personalization":
			return "chat";
		default:
			return "general";
	}
}
