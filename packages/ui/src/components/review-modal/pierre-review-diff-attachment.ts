import { type FileContents, FileDiff, parseDiffFromFile } from "@pierre/diffs"
import type { Attachment } from "svelte/attachments"

export type PierreReviewDiffInput = {
	readonly oldContent: string | null
	readonly newContent: string
	readonly fileName: string
}

export const pierreReviewDiffKey = (input: PierreReviewDiffInput): string =>
	`${input.fileName}\u0000${input.oldContent ?? ""}\u0000${input.newContent}`

export const pierreReviewFileContents = (
	input: PierreReviewDiffInput,
): { readonly oldFile: FileContents; readonly newFile: FileContents } => ({
	oldFile: {
		name: input.fileName,
		contents: input.oldContent ?? "",
	},
	newFile: {
		name: input.fileName,
		contents: input.newContent,
	},
})

export const createPierreReviewDiffAttachment = (
	readInput: () => PierreReviewDiffInput,
): Attachment<HTMLElement> => {
	return (node) => {
		const input = readInput()
		node.replaceChildren()
		const files = pierreReviewFileContents(input)
		const metadata = parseDiffFromFile(files.oldFile, files.newFile)
		const instance = new FileDiff(
			{
				themeType: "dark",
				diffStyle: "unified",
			},
			undefined,
			true,
		)
		instance.render({
			fileDiff: metadata,
			containerWrapper: node,
		})
		return () => {
			instance.cleanUp()
			node.replaceChildren()
		}
	}
}
