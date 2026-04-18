/**
 * Canonical composer policy machine (XState v5).
 *
 * Owns config-blocking and send-dispatch phases for a bound session so UI affordances
 * and controller submit gates cannot drift (see docs/plans/2026-04-17-003-*).
 *
 * SESSION_BOUND does not apply while dispatching — dispatch ends only via DISPATCH_END
 * so rebind cannot clear an in-flight send's dispatch phase (see bindSession skip).
 */

import { assign, setup } from "xstate";

export interface ComposerMachineContext {
	readonly sessionId: string;
	/** Incremented on every SESSION_BOUND for stale async invalidation tests. */
	boundGeneration: number;
	committedModeId: string | null;
	committedModelId: string | null;
	committedAutonomousEnabled: boolean;
	provisionalModeId: string | null;
	provisionalModelId: string | null;
	provisionalAutonomousEnabled: boolean | null;
}

export type ComposerMachineEvent =
	| {
			type: "SESSION_BOUND";
			committedModeId: string | null;
			committedModelId: string | null;
			committedAutonomousEnabled: boolean;
	  }
	| {
			type: "CONFIG_BLOCK_BEGIN";
			provisionalModeId?: string | null;
			provisionalModelId?: string | null;
			provisionalAutonomousEnabled?: boolean | null;
	  }
	| {
			type: "CONFIG_BLOCK_SUCCESS";
			committedModeId: string | null;
			committedModelId: string | null;
			committedAutonomousEnabled: boolean;
	  }
	| { type: "CONFIG_BLOCK_FAIL" }
	| { type: "DISPATCH_BEGIN" }
	| { type: "DISPATCH_END" };

const initialContext = (sessionId: string): ComposerMachineContext => ({
	sessionId,
	boundGeneration: 0,
	committedModeId: null,
	committedModelId: null,
	committedAutonomousEnabled: false,
	provisionalModeId: null,
	provisionalModelId: null,
	provisionalAutonomousEnabled: null,
});

export const composerMachine = setup({
	types: {
		context: {} as ComposerMachineContext,
		events: {} as ComposerMachineEvent,
		input: {} as { sessionId: string },
	},
	actions: {
		applySessionBound: assign(({ context, event }) => {
			if (event.type !== "SESSION_BOUND") {
				return {};
			}
			return {
				boundGeneration: context.boundGeneration + 1,
				committedModeId: event.committedModeId,
				committedModelId: event.committedModelId,
				committedAutonomousEnabled: event.committedAutonomousEnabled,
				provisionalModeId: null,
				provisionalModelId: null,
				provisionalAutonomousEnabled: null,
			};
		}),
	},
}).createMachine({
	id: "composer",
	context: ({ input }) => initialContext(input.sessionId),
	initial: "interactive",
	states: {
		interactive: {
			on: {
				SESSION_BOUND: {
					target: "interactive",
					actions: "applySessionBound",
				},
				CONFIG_BLOCK_BEGIN: {
					target: "configBlocking",
					actions: assign({
						provisionalModeId: ({ context, event }) =>
							event.provisionalModeId !== undefined
								? event.provisionalModeId
								: context.provisionalModeId,
						provisionalModelId: ({ context, event }) =>
							event.provisionalModelId !== undefined
								? event.provisionalModelId
								: context.provisionalModelId,
						provisionalAutonomousEnabled: ({ context, event }) =>
							event.provisionalAutonomousEnabled !== undefined
								? event.provisionalAutonomousEnabled
								: context.provisionalAutonomousEnabled,
					}),
				},
				DISPATCH_BEGIN: "dispatching",
			},
		},
		configBlocking: {
			on: {
				SESSION_BOUND: {
					target: "interactive",
					actions: "applySessionBound",
				},
				CONFIG_BLOCK_SUCCESS: {
					target: "interactive",
					actions: assign({
						committedModeId: ({ event }) => event.committedModeId,
						committedModelId: ({ event }) => event.committedModelId,
						committedAutonomousEnabled: ({ event }) => event.committedAutonomousEnabled,
						provisionalModeId: () => null,
						provisionalModelId: () => null,
						provisionalAutonomousEnabled: () => null,
					}),
				},
				CONFIG_BLOCK_FAIL: {
					target: "interactive",
					actions: assign({
						provisionalModeId: () => null,
						provisionalModelId: () => null,
						provisionalAutonomousEnabled: () => null,
					}),
				},
			},
		},
		dispatching: {
			on: {
				DISPATCH_END: "interactive",
			},
		},
	},
});
