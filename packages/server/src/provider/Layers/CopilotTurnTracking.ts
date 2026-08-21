import { TurnId } from "@acepe/contracts"
import * as Option from "effect/Option"

export type CopilotTurnPhase = "start" | "steer"

export type CopilotStopReason = {
	readonly seq: number
	readonly stopReason: string
}

export type CopilotTurnState = {
	readonly activeTurnId: Option.Option<TurnId>
	readonly promptsInFlight: number
	readonly promptSequence: number
	readonly latestStop: Option.Option<CopilotStopReason>
}

export const emptyCopilotTurnState: CopilotTurnState = {
	activeTurnId: Option.none(),
	promptsInFlight: 0,
	promptSequence: 0,
	latestStop: Option.none()
}

export type CopilotBeginPrompt = {
	readonly state: CopilotTurnState
	readonly phase: CopilotTurnPhase
	readonly turnId: TurnId
	readonly seq: number
}

export type CopilotCompletePrompt = {
	readonly state: CopilotTurnState
	readonly emitComplete: boolean
	readonly stopReason: string
}

export const beginCopilotPrompt = (state: CopilotTurnState, turnId: TurnId): CopilotBeginPrompt => {
	const seq = state.promptSequence + 1
	if (state.promptsInFlight > 0 && Option.isSome(state.activeTurnId)) {
		return {
			state: {
				activeTurnId: state.activeTurnId,
				promptsInFlight: state.promptsInFlight + 1,
				promptSequence: seq,
				latestStop: state.latestStop
			},
			phase: "steer",
			turnId: state.activeTurnId.value,
			seq
		}
	}
	return {
		state: {
			activeTurnId: Option.some(turnId),
			promptsInFlight: 1,
			promptSequence: seq,
			latestStop: Option.none()
		},
		phase: "start",
		turnId,
		seq
	}
}

const nextStop = (
	current: Option.Option<CopilotStopReason>,
	seq: number,
	stopReason: string
): CopilotStopReason =>
	Option.match(current, {
		onNone: () => ({ seq, stopReason }),
		onSome: (latest) => (seq >= latest.seq ? { seq, stopReason } : latest)
	})

export const completeCopilotPrompt = (
	state: CopilotTurnState,
	seq: number,
	stopReason: string
): CopilotCompletePrompt => {
	const inFlight = state.promptsInFlight <= 1 ? 0 : state.promptsInFlight - 1
	const latestStop = nextStop(state.latestStop, seq, stopReason)
	if (inFlight === 0) {
		return {
			state: emptyCopilotTurnState,
			emitComplete: true,
			stopReason: latestStop.stopReason
		}
	}
	return {
		state: {
			activeTurnId: state.activeTurnId,
			promptsInFlight: inFlight,
			promptSequence: state.promptSequence,
			latestStop: Option.some(latestStop)
		},
		emitComplete: false,
		stopReason: latestStop.stopReason
	}
}

export const cancelCopilotTurn = (_state: CopilotTurnState): CopilotTurnState => emptyCopilotTurnState
