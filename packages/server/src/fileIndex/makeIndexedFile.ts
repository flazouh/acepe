import { extensionFromRelativePath, toPosixPath } from "./gitignore.ts"
import type { IndexedFile } from "./Schemas.ts"

export const makeIndexedFile = (relativePath: string): IndexedFile => {
	const posix = toPosixPath(relativePath)
	return {
		path: posix,
		extension: extensionFromRelativePath(posix),
		lineCount: 0,
		gitStatus: null
	}
}
