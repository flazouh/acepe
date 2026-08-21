export type TracerTranscriptRole = "user" | "assistant"

export type TracerTranscriptRow = {
	readonly key: string
	readonly role: TracerTranscriptRole
	readonly text: string
}

export const tracerTranscriptRow = (input: {
	readonly key: string
	readonly role: TracerTranscriptRole
	readonly text: string
}): TracerTranscriptRow => ({
	key: input.key,
	role: input.role,
	text: input.text
})
