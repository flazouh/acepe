import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type { PlatformError } from "effect/PlatformError"
import type * as Schema from "effect/Schema"
import type { FileIndexNotADirectoryError, FileIndexRootNotFoundError } from "../Errors.ts"
import type { FileIndexUpdate, ProjectIndex } from "../Schemas.ts"

export type FileIndexError =
	| FileIndexRootNotFoundError
	| FileIndexNotADirectoryError
	| PlatformError
	| Schema.SchemaError

export interface FileIndexServiceShape {
	readonly getProjectIndex: (projectPath: string) => Effect.Effect<ProjectIndex, FileIndexError>
	readonly prewarm: (projectPath: string) => Effect.Effect<ProjectIndex, FileIndexError>
	readonly applyUpdates: (
		projectPath: string,
		updates: ReadonlyArray<FileIndexUpdate>
	) => Effect.Effect<ProjectIndex, FileIndexError>
	readonly invalidate: (projectPath: string) => Effect.Effect<void>
}

export class FileIndexService extends Context.Service<
	FileIndexService,
	FileIndexServiceShape
>()("@acepe/server/fileIndex/Services/FileIndexService") {}
