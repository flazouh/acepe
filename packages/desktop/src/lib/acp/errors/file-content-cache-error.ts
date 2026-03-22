import { AcpError } from "./acp-error.js";

/**
 * Error thrown when file content operations fail.
 *
 * This includes errors during file reading, diff fetching,
 * or cache operations.
 */
export class FileContentCacheError extends AcpError {
	constructor(message: string, code: string, cause?: unknown) {
		super(message, code, cause);
		this.name = "FileContentCacheError";
	}
}
