/**
 * Information about an installed plugin.
 */
export interface PluginInfo {
	/** Unique plugin ID (marketplace::name) */
	id: string;
	/** Marketplace name (e.g., "example-marketplace") */
	marketplace: string;
	/** Plugin name (e.g., "example-plugin") */
	name: string;
	/** Installed version (latest) */
	version: string;
	/** Full path to the plugin's skills directory */
	skillsDir: string;
	/** Number of skills in this plugin */
	skillCount: number;
}
