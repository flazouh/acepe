/**
 * Parameters for the fs/write_text_file ACP request.
 */
export interface WriteTextFileParams {
	/** The session ID making the request */
	sessionId: string;
	/** Absolute path to the file to write */
	path: string;
	/** Content to write to the file */
	content: string;
}
