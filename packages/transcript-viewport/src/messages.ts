import type { RpcProjectedMessage } from "@acepe/contracts"
import * as Match from "effect/Match"

/**
 * Display rows for the transcript viewport. Order is the messages projection
 * order (event `sequence`). This module does not sort, timestamp-tiebreak, or
 * repair provider ids. Canonical transcript order is already on the snapshot.
 */
export type TranscriptViewportRow = {
	readonly rowId: string
	readonly sequence: RpcProjectedMessage["sequence"]
	readonly rowType: RpcProjectedMessage["rowType"]
	readonly text: string | null
	readonly estimatePx: number
	readonly isActiveTail: boolean
	readonly anchorEligible: boolean
}

const estimatePxFor = (rowType: RpcProjectedMessage["rowType"]): number =>
	Match.value(rowType).pipe(
		Match.when("user", () => 80),
		Match.when("assistant", () => 150),
		Match.when("compaction", () => 76),
		Match.exhaustive,
	)

const textFor = (message: RpcProjectedMessage): string | null =>
	Match.value(message).pipe(
		Match.discriminatorsExhaustive("rowType")({
			user: (row) => row.content.text,
			assistant: (row) => row.content.text,
			compaction: (row) => row.content.summary,
		}),
	)

const rowFromProjectedMessage = (
	message: RpcProjectedMessage,
	index: number,
	count: number,
): TranscriptViewportRow => ({
	rowId: message.messageId,
	sequence: message.sequence,
	rowType: message.rowType,
	text: textFor(message),
	estimatePx: estimatePxFor(message.rowType),
	isActiveTail: index === count - 1 && message.rowType === "assistant",
	anchorEligible: message.rowType === "user",
})

/**
 * Project viewport rows from `projection.session-messages`. Input order is
 * display order. Do not re-sort.
 */
export const rowsFromProjectedMessages = (
	messages: ReadonlyArray<RpcProjectedMessage>,
): ReadonlyArray<TranscriptViewportRow> => {
	const count = messages.length
	const rows: Array<TranscriptViewportRow> = []
	let index = 0
	for (const message of messages) {
		rows.push(rowFromProjectedMessage(message, index, count))
		index += 1
	}
	return rows
}
