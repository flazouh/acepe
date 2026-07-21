import type { SessionOpenContentProbeResult } from "./schemas";

const HOT_LEDGER_FIRST_ROW_PAINT_TARGET_MS = 32;
const NON_HOT_FIRST_ROW_PAINT_TARGET_MS = 100;

type SessionOpenProbeStatus = "ok" | "warn" | "fail";
type SessionOpenEvent = SessionOpenContentProbeResult["openEvents"][number];
type SessionOpenTiming = SessionOpenEvent["openResultTiming"];

export type SessionOpenContentProbeSummary = {
	readonly status: SessionOpenProbeStatus;
	readonly backendLine: string;
	readonly targetLine: string;
};

function formatOptionalMs(value: number | null): string {
	if (value === null || !Number.isFinite(value)) {
		return "unavailable";
	}
	return `${value.toFixed(2)} ms`;
}

function formatOptionalCount(value: number | null): string {
	if (value === null || !Number.isFinite(value)) {
		return "unavailable";
	}
	return value.toString();
}

function formatWorkBeforePaint(value: number | null): string {
	if (value === null || !Number.isFinite(value)) {
		return "unknown";
	}
	return value > 0 ? "yes" : "no";
}

function latestSessionOpenBackendEvent(
	events: readonly SessionOpenEvent[]
): SessionOpenEvent | null {
	let event: SessionOpenEvent | null = null;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const candidate = events[index];
		if (candidate === undefined) {
			continue;
		}
		if (
			candidate.openResultTiming !== null ||
			candidate.initialRowPageRowCount !== null ||
			candidate.initialRowPageTotalRowCount !== null ||
			candidate.initialRowPageStartRowIndex !== null ||
			candidate.initialRowPagePayloadBytes !== null
		) {
			event = candidate;
			break;
		}
	}
	return event;
}

export function latestSessionOpenTiming(events: readonly SessionOpenEvent[]): SessionOpenTiming {
	let timing: SessionOpenTiming = null;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const candidate = events[index]?.openResultTiming ?? null;
		if (candidate !== null) {
			timing = candidate;
			break;
		}
	}
	return timing;
}

export function formatSessionOpenBackendTiming(events: readonly SessionOpenEvent[]): string {
	const event = latestSessionOpenBackendEvent(events);
	if (event === null) {
		return "unavailable";
	}
	const timing = event.openResultTiming;
	if (timing === null) {
		return [
			"source=unavailable",
			"path=unknown",
			"total=unavailable",
			"provider=unavailable",
			"ledger=unavailable",
			"providerBeforePaint=unknown",
			"assembleBeforePaint=unknown",
			"compactBeforePaint=unknown",
			`tailRows=${formatOptionalCount(event.initialRowPageRowCount)}`,
			`totalRows=${formatOptionalCount(event.initialRowPageTotalRowCount)}`,
			`startRow=${formatOptionalCount(event.initialRowPageStartRowIndex)}`,
			`payloadBytes=${formatOptionalCount(event.initialRowPagePayloadBytes)}`,
		].join(" ");
	}
	return [
		`source=${timing.source}`,
		`path=${timing.openPath ?? "unknown"}`,
		`ledgerProbe=${timing.ledgerProbeStatus}`,
		`total=${formatOptionalMs(timing.totalMs)}`,
		`context=${formatOptionalMs(timing.contextMs)}`,
		`provider=${formatOptionalMs(timing.providerLoadMs)}`,
		`ledger=${formatOptionalMs(timing.ledgerTailReadMs)}`,
		`ledgerProjection=${formatOptionalMs(timing.ledgerProjectionFrontierMs)}`,
		`ledgerPage=${formatOptionalMs(timing.ledgerPageReadMs)}`,
		`ledgerHeader=${formatOptionalMs(timing.ledgerHeaderDecodeMs)}`,
		`ledgerRows=${formatOptionalMs(timing.ledgerRowsDecodeMs)}`,
		`ledgerBuild=${formatOptionalMs(timing.ledgerResultBuildMs)}`,
		`assemble=${formatOptionalMs(timing.assembleMs)}`,
		`restore=${formatOptionalMs(timing.restoreAuthorityMs)}`,
		`compact=${formatOptionalMs(timing.compactMs)}`,
		`localJournal=${formatOptionalMs(timing.localJournalFallbackMs)}`,
		`providerBeforePaint=${formatWorkBeforePaint(timing.providerLoadMs)}`,
		`assembleBeforePaint=${formatWorkBeforePaint(timing.assembleMs)}`,
		`compactBeforePaint=${formatWorkBeforePaint(timing.compactMs)}`,
		`rows=${timing.transcriptEntryCount.toString()}`,
		`ops=${timing.operationCount.toString()}`,
		`tailRows=${formatOptionalCount(event.initialRowPageRowCount)}`,
		`totalRows=${formatOptionalCount(event.initialRowPageTotalRowCount)}`,
		`startRow=${formatOptionalCount(event.initialRowPageStartRowIndex)}`,
		`payloadBytes=${formatOptionalCount(event.initialRowPagePayloadBytes)}`,
	].join(" ");
}

function isHotLedgerTiming(timing: SessionOpenTiming): boolean {
	if (timing === null) {
		return false;
	}
	return timing.openPath === "hot_ledger" || timing.source === "transcript-row-ledger";
}

function targetLabel(timing: SessionOpenTiming): string {
	if (isHotLedgerTiming(timing)) {
		return "hot_ledger";
	}
	if (timing === null || timing.openPath === null) {
		return "unknown-path";
	}
	return "non-hot";
}

function targetMs(timing: SessionOpenTiming): number {
	return isHotLedgerTiming(timing)
		? HOT_LEDGER_FIRST_ROW_PAINT_TARGET_MS
		: NON_HOT_FIRST_ROW_PAINT_TARGET_MS;
}

function targetStatus(input: {
	readonly hookAvailable: boolean;
	readonly timedOut: boolean;
	readonly firstRowPaintMs: number | null;
	readonly foregroundFrameTimingValid: boolean;
	readonly timing: SessionOpenTiming;
}): SessionOpenProbeStatus {
	if (!input.hookAvailable || input.timedOut || input.firstRowPaintMs === null) {
		return "fail";
	}
	if (!input.foregroundFrameTimingValid) {
		return "warn";
	}
	const thresholdMs = targetMs(input.timing);
	if (input.firstRowPaintMs > thresholdMs) {
		return "fail";
	}
	return isHotLedgerTiming(input.timing) ? "ok" : "warn";
}

export function summarizeSessionOpenContentProbe(
	probe: SessionOpenContentProbeResult
): SessionOpenContentProbeSummary {
	const timing = latestSessionOpenTiming(probe.openEvents);
	const status = targetStatus({
		hookAvailable: probe.hookAvailable,
		timedOut: probe.timedOut,
		firstRowPaintMs: probe.firstRowPaintMs,
		foregroundFrameTimingValid: probe.foregroundFrameTimingValid,
		timing,
	});
	const thresholdMs = targetMs(timing);
	const hotEligible = isHotLedgerTiming(timing);
	const targetSuffix = hotEligible ? "" : " hotEligible=no";
	return {
		status,
		backendLine: `backend open: ${formatSessionOpenBackendTiming(probe.openEvents)}`,
		targetLine: `target: ${targetLabel(timing)} firstRowPaint <= ${thresholdMs.toFixed(
			2
		)} ms status=${status}${targetSuffix} foreground=${
			probe.foregroundFrameTimingValid ? "valid" : "invalid"
		}`,
	};
}
