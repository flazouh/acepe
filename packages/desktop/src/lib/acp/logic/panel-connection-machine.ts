/**
 * XState machine for managing panel connection lifecycle.
 *
 * Handles the state transitions for connecting a panel to an ACP session.
 * States: idle -> connecting -> connected | error
 */

import { assign, createMachine } from "xstate";

import {
	type PanelConnectionContext,
	PanelConnectionEvent,
	PanelConnectionState,
} from "../types/panel-connection-state.js";

export const panelConnectionMachine = createMachine({
	id: "panelConnection",
	types: {
		context: {} as PanelConnectionContext,
		input: {} as { panelId: string },
		events: {} as
			| {
					type: PanelConnectionEvent.START_CONNECTION;
					projectPath: string;
					agentId: string;
					title?: string;
			  }
			| { type: PanelConnectionEvent.CONNECTION_SUCCESS; sessionId: string }
			| { type: PanelConnectionEvent.CONNECTION_ERROR; error: string }
			| { type: PanelConnectionEvent.RETRY }
			| { type: PanelConnectionEvent.CANCEL },
	},
	initial: PanelConnectionState.IDLE,
	context: ({ input }) => ({
		panelId: input.panelId,
		projectPath: "",
		agentId: "",
		sessionId: null,
	}),
	states: {
		[PanelConnectionState.IDLE]: {
			on: {
				[PanelConnectionEvent.START_CONNECTION]: {
					target: PanelConnectionState.CONNECTING,
					actions: assign({
						projectPath: ({ event }) => event.projectPath,
						agentId: ({ event }) => event.agentId,
						title: ({ event }) => event.title,
						startedAt: () => new Date(),
					}),
				},
			},
		},
		[PanelConnectionState.CONNECTING]: {
			on: {
				[PanelConnectionEvent.CONNECTION_SUCCESS]: {
					target: PanelConnectionState.CONNECTED,
					actions: assign({
						sessionId: ({ event }) => event.sessionId,
					}),
				},
				[PanelConnectionEvent.CONNECTION_ERROR]: {
					target: PanelConnectionState.ERROR,
					actions: assign({
						error: ({ event }) => event.error,
					}),
				},
				[PanelConnectionEvent.CANCEL]: {
					target: PanelConnectionState.IDLE,
					actions: assign({
						projectPath: () => "",
						agentId: () => "",
						title: () => undefined,
						startedAt: () => undefined,
						error: () => undefined,
					}),
				},
			},
		},
		[PanelConnectionState.CONNECTED]: {
			type: "final",
		},
		[PanelConnectionState.ERROR]: {
			on: {
				[PanelConnectionEvent.RETRY]: {
					target: PanelConnectionState.CONNECTING,
					actions: assign({
						error: () => undefined,
						startedAt: () => new Date(),
					}),
				},
				[PanelConnectionEvent.CANCEL]: {
					target: PanelConnectionState.IDLE,
					actions: assign({
						projectPath: () => "",
						agentId: () => "",
						title: () => undefined,
						startedAt: () => undefined,
						error: () => undefined,
					}),
				},
			},
		},
	},
});
