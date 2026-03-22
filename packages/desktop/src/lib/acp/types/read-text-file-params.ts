/**
 * Parameters for the fs/read_text_file ACP request.
 */
export interface ReadTextFileParams {
	/** The session ID making the request */
	sessionId: string;
	/** Absolute path to the file to read */
	path: string;
	/** 1-based line number to start reading from (optional) */
	line?: number;
	/** Maximum number of lines to read (optional) */
	limit?: number;
}
