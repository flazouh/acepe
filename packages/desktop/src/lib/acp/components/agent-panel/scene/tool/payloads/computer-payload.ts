import type { ComputerOperationPayload } from "../../../../../../services/acp-types.js";
import type { ToolCall } from "../../../../../types/tool-call.js";

function permissionLabel(permissionKind: string | null | undefined): string | null {
	if (permissionKind === "accessibility") {
		return "Accessibility";
	}
	if (permissionKind === "screen_recording") {
		return "Screen Recording";
	}
	if (permissionKind === "app_window_scope") {
		return "App/window scope";
	}
	return null;
}

function compactComputerLine(
	label: string,
	value: string | number | boolean | null | undefined
): string | null {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	return `${label}: ${String(value)}`;
}

function buildInputLines(payload: ComputerOperationPayload): string[] {
	const lines: string[] = [];
	const verbLine = compactComputerLine("Action", payload.input.verb);
	if (verbLine !== null) lines.push(verbLine);
	const targetLine = compactComputerLine("Target", payload.input.target_id);
	if (targetLine !== null) lines.push(targetLine);
	const epochLine = compactComputerLine("Epoch", payload.input.epoch);
	if (epochLine !== null) lines.push(epochLine);
	const textLine = compactComputerLine("Text", payload.input.text);
	if (textLine !== null) lines.push(textLine);
	const keyLine = compactComputerLine("Key", payload.input.key);
	if (keyLine !== null) lines.push(keyLine);
	const deltaXLine = compactComputerLine("Delta X", payload.input.delta_x);
	if (deltaXLine !== null) lines.push(deltaXLine);
	const deltaYLine = compactComputerLine("Delta Y", payload.input.delta_y);
	if (deltaYLine !== null) lines.push(deltaYLine);
	return lines;
}

function buildOutputLines(payload: ComputerOperationPayload): string[] {
	const output = payload.output;
	if (output === null || output === undefined) {
		return [];
	}

	const lines: string[] = [];
	const epochLine = compactComputerLine("Observed epoch", output.epoch);
	if (epochLine !== null) lines.push(epochLine);
	const settledLine = compactComputerLine("Settled", output.settled_ms);
	if (settledLine !== null) lines.push(`${settledLine} ms`);
	const appLine = compactComputerLine("App", output.app);
	if (appLine !== null) lines.push(appLine);
	const windowLine = compactComputerLine("Window", output.window);
	if (windowLine !== null) lines.push(windowLine);
	const focusLine = compactComputerLine("Focus", output.focused_target_id);
	if (focusLine !== null) lines.push(focusLine);
	const busyLine = compactComputerLine("Busy", output.busy);
	if (busyLine !== null) lines.push(busyLine);
	const elementCountLine = compactComputerLine("Elements", output.element_count);
	if (elementCountLine !== null) lines.push(elementCountLine);
	if (output.changed_target_ids.length > 0) {
		lines.push(`Changed targets: ${output.changed_target_ids.join(", ")}`);
	}
	const screenshotLine = compactComputerLine("Screenshot ref", output.screenshot_ref);
	if (screenshotLine !== null) lines.push(screenshotLine);
	return lines;
}

function buildErrorLines(payload: ComputerOperationPayload): string[] {
	const error = payload.error;
	if (error === null || error === undefined) {
		return [];
	}

	const lines = [`Error: ${error.message || error.code}`];
	const codeLine = compactComputerLine("Code", error.code);
	if (codeLine !== null) lines.push(codeLine);
	const permission = permissionLabel(error.permission_kind);
	const permissionLine = compactComputerLine("Permission", permission);
	if (permissionLine !== null) lines.push(permissionLine);
	const appLine = compactComputerLine("App", error.app);
	if (appLine !== null) lines.push(appLine);
	const windowLine = compactComputerLine("Window", error.window);
	if (windowLine !== null) lines.push(windowLine);
	const epochLine = compactComputerLine("Current epoch", error.current_epoch);
	if (epochLine !== null) lines.push(epochLine);
	const reobserveLine = compactComputerLine("Reobserve", error.reobserve);
	if (reobserveLine !== null) lines.push(reobserveLine);
	return lines;
}

export function mapComputerPayload(toolCall: ToolCall): {
	detailsText?: string | null;
} {
	if (toolCall.kind !== "computer") {
		return {};
	}

	const payload = toolCall.computerPayload;
	if (payload === null || payload === undefined) {
		return {};
	}

	const lines: string[] = [];
	for (const line of buildInputLines(payload)) {
		lines.push(line);
	}
	for (const line of buildOutputLines(payload)) {
		lines.push(line);
	}
	for (const line of buildErrorLines(payload)) {
		lines.push(line);
	}

	return {
		detailsText: lines.length > 0 ? lines.join("\n") : null,
	};
}
