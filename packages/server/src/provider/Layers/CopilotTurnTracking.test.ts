import { TurnId } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import {
	beginCopilotPrompt,
	cancelCopilotTurn,
	completeCopilotPrompt,
	emptyCopilotTurnState
} from "./CopilotTurnTracking.ts"

const firstTurn = TurnId.make("session-1:turn:1")
const secondTurn = TurnId.make("session-1:turn:2")

Vitest.describe("CopilotTurnTracking", () => {
	Vitest.it("starts a turn on the first prompt", () => {
		const started = beginCopilotPrompt(emptyCopilotTurnState, firstTurn)
		Vitest.assert.strictEqual(started.phase, "start")
		Vitest.assert.strictEqual(started.turnId, firstTurn)
		Vitest.assert.strictEqual(started.seq, 1)
		Vitest.assert.strictEqual(started.state.promptsInFlight, 1)
		Vitest.assert.deepStrictEqual(started.state.activeTurnId, Option.some(firstTurn))
	})

	Vitest.it("treats a prompt during an active turn as a steer", () => {
		const started = beginCopilotPrompt(emptyCopilotTurnState, firstTurn)
		const steered = beginCopilotPrompt(started.state, secondTurn)
		Vitest.assert.strictEqual(steered.phase, "steer")
		Vitest.assert.strictEqual(steered.turnId, firstTurn)
		Vitest.assert.strictEqual(steered.seq, 2)
		Vitest.assert.strictEqual(steered.state.promptsInFlight, 2)
		Vitest.assert.deepStrictEqual(steered.state.activeTurnId, Option.some(firstTurn))
	})

	Vitest.it("emits turn complete only when the last in-flight prompt settles", () => {
		const started = beginCopilotPrompt(emptyCopilotTurnState, firstTurn)
		const steered = beginCopilotPrompt(started.state, secondTurn)
		const firstDone = completeCopilotPrompt(steered.state, started.seq, "end_turn")
		Vitest.assert.strictEqual(firstDone.emitComplete, false)
		Vitest.assert.strictEqual(firstDone.state.promptsInFlight, 1)
		const lastDone = completeCopilotPrompt(firstDone.state, steered.seq, "end_turn")
		Vitest.assert.strictEqual(lastDone.emitComplete, true)
		Vitest.assert.strictEqual(lastDone.stopReason, "end_turn")
		Vitest.assert.strictEqual(lastDone.state.promptsInFlight, 0)
		Vitest.assert.deepStrictEqual(lastDone.state.activeTurnId, Option.none())
	})

	Vitest.it("keeps the steering prompt stop reason when a superseded prompt finishes last", () => {
		const started = beginCopilotPrompt(emptyCopilotTurnState, firstTurn)
		const steered = beginCopilotPrompt(started.state, secondTurn)
		const steerDone = completeCopilotPrompt(steered.state, steered.seq, "end_turn")
		Vitest.assert.strictEqual(steerDone.emitComplete, false)
		const supersededDone = completeCopilotPrompt(steerDone.state, started.seq, "cancelled")
		Vitest.assert.strictEqual(supersededDone.emitComplete, true)
		Vitest.assert.strictEqual(supersededDone.stopReason, "end_turn")
	})

	Vitest.it("clears the active turn on cancel", () => {
		const started = beginCopilotPrompt(emptyCopilotTurnState, firstTurn)
		const cancelled = cancelCopilotTurn(started.state)
		Vitest.assert.deepStrictEqual(cancelled, emptyCopilotTurnState)
	})
})
