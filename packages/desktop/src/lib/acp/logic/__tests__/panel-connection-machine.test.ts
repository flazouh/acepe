import { describe, expect, it } from "bun:test";
import { createActor } from "xstate";

import { panelConnectionMachine } from "../panel-connection-machine.js";
import {
	PanelConnectionEvent,
	PanelConnectionState,
} from "../../types/panel-connection-state.js";

describe("panelConnectionMachine", () => {
	it("surfaces pre-session creation errors even if connecting never started", () => {
		const actor = createActor(panelConnectionMachine, { input: { panelId: "panel-1" } });
		actor.start();

		actor.send({
			type: PanelConnectionEvent.CONNECTION_ERROR,
			error: {
				message: "No agent selected for this panel",
			},
		});

		const snapshot = actor.getSnapshot();
		expect(snapshot.value).toBe(PanelConnectionState.ERROR);
		expect(snapshot.context.error?.message).toBe("No agent selected for this panel");
	});
});
