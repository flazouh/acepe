/**
 * Result of a successful git clone operation.
 */
export interface CloneResult {
	/** The path where the repository was cloned */
	path: string;
	/** The name of the repository (extracted from path) */
	name: string;
}
