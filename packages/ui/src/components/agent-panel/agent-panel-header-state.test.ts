import { describe, expect, test } from "bun:test";
import {
	getAgentPanelHeaderTitle,
	getHeaderStatusIndicatorKind,
	getVisibleHeaderActionButtons,
	hasAgentPanelHeaderMetaChips,
	hasAgentPanelHeaderTooltipDetails,
	isHeaderActionDisabled,
	shouldShowAgentPanelHeaderTitleTooltip,
} from "./agent-panel-header-state.js";
import type { AgentPanelActionDescriptor } from "./types.js";

const actions: readonly AgentPanelActionDescriptor[] = [
	{ id: "status.retry", label: "Retry", state: "enabled" },
	{ id: "status.archive", label: "Archive", state: "hidden" },
	{ id: "status.resume", label: "Resume", state: "busy" },
];

describe("agent panel header state", () => {
	test("resolves title with display, session, and fallback order", () => {
		expect(
			getAgentPanelHeaderTitle({
				displayTitle: "Display",
				sessionTitle: "Session",
			})
		).toBe("Display");
		expect(getAgentPanelHeaderTitle({ sessionTitle: "Session" })).toBe("Session");
		expect(getAgentPanelHeaderTitle({})).toBe("New thread");
	});

	test("filters hidden action buttons and detects disabled states", () => {
		const visible = getVisibleHeaderActionButtons(actions);

		expect(visible.map((action) => action.id)).toEqual([
			"status.retry",
			"status.resume",
		]);
		expect(isHeaderActionDisabled(actions[0]!)).toBe(false);
		expect(isHeaderActionDisabled({ id: "status.resume", state: "disabled" })).toBe(
			true
		);
		expect(isHeaderActionDisabled(actions[2]!)).toBe(true);
	});

	test("detects meta chips from subtitle, agent, branch, or badges", () => {
		expect(hasAgentPanelHeaderMetaChips({})).toBe(false);
		expect(hasAgentPanelHeaderMetaChips({ subtitle: "Working" })).toBe(true);
		expect(hasAgentPanelHeaderMetaChips({ agentLabel: "Codex" })).toBe(true);
		expect(hasAgentPanelHeaderMetaChips({ branchLabel: "main" })).toBe(true);
		expect(
			hasAgentPanelHeaderMetaChips({ badges: [{ id: "one", label: "One" }] })
		).toBe(true);
	});

	test("detects title tooltip visibility and extra tooltip details", () => {
		expect(
			shouldShowAgentPanelHeaderTitleTooltip({
				pendingProjectSelection: true,
			})
		).toBe(false);
		expect(
			shouldShowAgentPanelHeaderTitleTooltip({
				pendingProjectSelection: false,
			})
		).toBe(true);
		expect(
			hasAgentPanelHeaderTooltipDetails({
				hasExpansionSlot: false,
				hasMetaChips: false,
			})
		).toBe(false);
		expect(
			hasAgentPanelHeaderTooltipDetails({
				hasExpansionSlot: true,
				hasMetaChips: false,
			})
		).toBe(true);
		expect(
			hasAgentPanelHeaderTooltipDetails({
				hasExpansionSlot: false,
				hasMetaChips: true,
			})
		).toBe(true);
	});

	test("maps status indicator kind", () => {
		expect(
			getHeaderStatusIndicatorKind({
				hasCustomStatusIndicator: true,
				isConnecting: false,
				sessionStatus: "connected",
			})
		).toBe("custom");
		expect(
			getHeaderStatusIndicatorKind({
				hasCustomStatusIndicator: false,
				isConnecting: true,
				sessionStatus: "empty",
			})
		).toBe("connecting");
		expect(
			getHeaderStatusIndicatorKind({
				hasCustomStatusIndicator: false,
				isConnecting: false,
				sessionStatus: "warming",
			})
		).toBe("connecting");
		expect(
			getHeaderStatusIndicatorKind({
				hasCustomStatusIndicator: false,
				isConnecting: false,
				sessionStatus: "connected",
			})
		).toBe("connected");
		expect(
			getHeaderStatusIndicatorKind({
				hasCustomStatusIndicator: false,
				isConnecting: false,
				sessionStatus: "error",
			})
		).toBe("error");
		expect(
			getHeaderStatusIndicatorKind({
				hasCustomStatusIndicator: false,
				isConnecting: false,
				sessionStatus: "empty",
			})
		).toBe("none");
	});
});
