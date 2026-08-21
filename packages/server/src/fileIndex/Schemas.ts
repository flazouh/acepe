import {
	FileGitStatus as FileGitStatusSchema,
	FileIndexRemove as FileIndexRemoveSchema,
	FileIndexUpdate as FileIndexUpdateSchema,
	FileIndexUpsert as FileIndexUpsertSchema,
	IndexedFile as IndexedFileSchema,
	ProjectIndex as ProjectIndexSchema
} from "@acepe/contracts"

export const FileGitStatus = FileGitStatusSchema
export type FileGitStatus = typeof FileGitStatusSchema.Type

export const FileIndexRemove = FileIndexRemoveSchema
export type FileIndexRemove = typeof FileIndexRemoveSchema.Type

export const FileIndexUpdate = FileIndexUpdateSchema
export type FileIndexUpdate = typeof FileIndexUpdateSchema.Type

export const FileIndexUpsert = FileIndexUpsertSchema
export type FileIndexUpsert = typeof FileIndexUpsertSchema.Type

export const IndexedFile = IndexedFileSchema
export type IndexedFile = typeof IndexedFileSchema.Type

export const ProjectIndex = ProjectIndexSchema
export type ProjectIndex = typeof ProjectIndexSchema.Type
