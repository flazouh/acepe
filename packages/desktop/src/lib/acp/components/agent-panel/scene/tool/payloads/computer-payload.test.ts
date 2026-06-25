import { describe, expect, it } from "bun:test";

import type { ComputerOperationPayload } from "../../../../../../services/acp-types.js";
import type { ToolCall } from "../../../../../types/tool-call.js";
import { mapComputerPayload } from "./computer-payload.js";

function computerToolCall(payload: ComputerOperationPayload): ToolCall {
	return {
		id: "tool-computer-1",
		name: "mcp__acepe_computer__act",
		arguments: {
			kind: "computer",
			verb: "click",
			target_id: "e_button",
			epoch: "s_1",
			text: null,
			key: null,
			delta_x: null,
			delta_y: null,
			include_bounds: false,
			include_screenshot: false,
		},
		status: "completed",
		kind: "computer",
		title: "Computer",
		result: null,
		locations: null,
		skillMeta: null,
		normalizedQuestions: null,
		normalizedTodos: null,
		parentToolUseId: null,
		taskChildren: null,
		questionAnswer: null,
		awaitingPlanApproval: false,
		computerPayload: payload,
	};
}

describe("mapComputerPayload", () => {
	it("maps canonical computer action input and output into compact details", () => {
		const mapped = mapComputerPayload(
			computerToolCall({
				input: {
					verb: "click",
					target_id: "e_button",
					epoch: "s_1",
					text: null,
					key: null,
					delta_x: null,
					delta_y: null,
					include_bounds: false,
					include_screenshot: false,
				},
				output: {
					epoch: "s_2",
					settled_ms: 128,
					app: "Acepe",
					window: "Main",
					focused_target_id: "e_button",
					busy: false,
					changed_target_ids: ["e_button", "e_label"],
					element_count: 12,
					screenshot_ref: "computer-screenshots/s_2.png",
				},
				error: null,
			})
		);

		expect(mapped.detailsText).toBe(
			[
				"Action: click",
				"Target: e_button",
				"Epoch: s_1",
				"Observed epoch: s_2",
				"Settled: 128 ms",
				"App: Acepe",
				"Window: Main",
				"Focus: e_button",
				"Busy: false",
				"Elements: 12",
				"Changed targets: e_button, e_label",
				"Screenshot ref: computer-screenshots/s_2.png",
			].join("\n")
		);
	});

	it("maps structured computer permission errors without raw sidecar data", () => {
		const mapped = mapComputerPayload(
			computerToolCall({
				input: {
					verb: "observe",
					target_id: null,
					epoch: null,
					text: null,
					key: null,
					delta_x: null,
					delta_y: null,
					include_bounds: false,
					include_screenshot: false,
				},
				output: null,
				error: {
					code: "computer_permission_required",
					message: "Accessibility permission is required.",
					permission_kind: "accessibility",
					current_epoch: null,
					reobserve: null,
				},
			})
		);

		expect(mapped.detailsText).toBe(
			[
				"Action: observe",
				"Error: Accessibility permission is required.",
				"Code: computer_permission_required",
				"Permission: Accessibility",
			].join("\n")
		);
	});

	it("maps app/window scope permission errors", () => {
		const mapped = mapComputerPayload(
			computerToolCall({
				input: {
					verb: "observe",
					target_id: null,
					epoch: null,
					text: null,
					key: null,
					delta_x: null,
					delta_y: null,
					include_bounds: false,
					include_screenshot: false,
				},
				output: null,
				error: {
					code: "computer_permission_required",
					message: "Allow computer use for Safari / GitHub?",
					permission_kind: "app_window_scope",
					app: "Safari",
					window: "GitHub",
					current_epoch: null,
					reobserve: null,
				},
			})
		);

		expect(mapped.detailsText).toBe(
			[
				"Action: observe",
				"Error: Allow computer use for Safari / GitHub?",
				"Code: computer_permission_required",
				"Permission: App/window scope",
				"App: Safari",
				"Window: GitHub",
			].join("\n")
		);
	});

	it("maps scope-changed reobserve errors without permission wording", () => {
		const mapped = mapComputerPayload(
			computerToolCall({
				input: {
					verb: "click",
					target_id: "e_button",
					epoch: "s_1",
					text: null,
					key: null,
					delta_x: null,
					delta_y: null,
					include_bounds: false,
					include_screenshot: false,
				},
				output: null,
				error: {
					code: "computer_scope_changed",
					message: "Focused app or window changed after observation; observe again before acting.",
					permission_kind: null,
					app: "Safari",
					window: "GitHub",
					current_epoch: null,
					reobserve: true,
				},
			})
		);

		expect(mapped.detailsText).toBe(
			[
				"Action: click",
				"Target: e_button",
				"Epoch: s_1",
				"Error: Focused app or window changed after observation; observe again before acting.",
				"Code: computer_scope_changed",
				"App: Safari",
				"Window: GitHub",
				"Reobserve: true",
			].join("\n")
		);
	});
});
