import { describe, expect, it } from "bun:test";

import {
	formatSessionOpenBackendTiming,
	summarizeSessionOpenContentProbe,
} from "../session-open-probe-summary";
import {
	sessionOpenContentProbeResultSchema,
	type SessionOpenContentProbeResult,
} from "../schemas";

type SessionOpenEvent = SessionOpenContentProbeResult["openEvents"][number];
type SessionOpenTiming = NonNullable<SessionOpenEvent["openResultTiming"]>;

function timing(fields: {
	readonly source: string;
	readonly openPath: SessionOpenTiming["openPath"];
	readonly providerLoadMs: number;
	readonly ledgerTailReadMs: number | null;
	readonly assembleMs: number;
	readonly compactMs: number;
	readonly totalMs: number;
}): SessionOpenTiming {
	return {
		source: fields.source,
		openPath: fields.openPath,
		ledgerProbeStatus: fields.openPath === "hot_ledger" ? "current" : "missing",
		contextMs: 1,
		providerLoadMs: fields.providerLoadMs,
		ledgerTailReadMs: fields.ledgerTailReadMs,
		ledgerJournalCutoffMs: 0,
		ledgerPageReadMs: 0,
		ledgerHeaderDecodeMs: 0,
		ledgerRowsDecodeMs: 0,
		ledgerResultBuildMs: 0,
		runtimeLookupMs: 0,
		assembleMs: fields.assembleMs,
		restoreAuthorityMs: 2,
		compactMs: fields.compactMs,
		localJournalFallbackMs: 0,
		totalMs: fields.totalMs,
		transcriptEntryCount: 128,
		operationCount: 7,
	};
}

function eventWithTiming(input: {
	readonly stage?: SessionOpenEvent["stage"];
	readonly openResultTiming: SessionOpenTiming | null;
	readonly initialRowPageRowCount?: number | null;
	readonly initialRowPageTotalRowCount?: number | null;
	readonly initialRowPageStartRowIndex?: number | null;
	readonly initialRowPagePayloadBytes?: number | null;
}): SessionOpenEvent {
	return {
		stage: input.stage ?? "result-found",
		source: "session-handler",
		panelId: "panel-1",
		sessionId: "session-1",
		elapsedMs: 4,
		canonicalSessionId: "session-1",
		outcome: "found",
		message: null,
		hasSessionIdentity: true,
		hasSessionMetadata: true,
		shouldAttemptLocalReattach: true,
		hasInitialViewportEnvelope: true,
		initialRowPageRowCount: input.initialRowPageRowCount ?? null,
		initialRowPageTotalRowCount: input.initialRowPageTotalRowCount ?? null,
		initialRowPageStartRowIndex: input.initialRowPageStartRowIndex ?? null,
		initialRowPagePayloadBytes: input.initialRowPagePayloadBytes ?? null,
		openResultTiming: input.openResultTiming,
	};
}

function probeWithTiming(input: {
	readonly firstRowPaintMs: number | null;
	readonly openResultTiming: SessionOpenTiming | null;
	readonly hookAvailable?: boolean;
	readonly timedOut?: boolean;
	readonly openEventStage?: SessionOpenEvent["stage"];
}): SessionOpenContentProbeResult {
	return {
		hookAvailable: input.hookAvailable ?? true,
		sessionId: "session-1",
		panelId: "panel-1",
		documentVisibilityAtStart: "visible",
		documentVisibilityAtEnd: "visible",
		documentHasFocusAtStart: true,
		documentHasFocusAtEnd: true,
		foregroundFrameTimingValid: true,
		sessionKnownBeforeOpen: true,
		placeholderRegistered: false,
		closedExistingPanel: false,
		closeAfterRequested: true,
		selectCallMs: 1,
		panelDomReadyMs: 2,
		transcriptViewportReadyMs: 3,
		firstRowDomReadyMs: 4,
		firstRowPaintMs: input.firstRowPaintMs,
		rowCountAtFirstPaint: 1,
		finalRowCount: 128,
		panelStillOpenAtEnd: false,
		panelDomPresentAtEnd: false,
		sessionKnownAtEnd: true,
		sessionHasCanonicalProjectionAtEnd: true,
		sessionCanSendAtEnd: true,
		sessionLifecycleStatusAtEnd: "ready",
		sessionMessageCountAtEnd: 128,
		timedOut: input.timedOut ?? false,
		errorMessage: null,
		runtimeErrors: [],
		tauriInvokeTimings: [],
		pendingTauriInvokes: [],
		openEvents: [
			eventWithTiming({
				stage: input.openEventStage,
				openResultTiming: input.openResultTiming,
				initialRowPageRowCount: 64,
				initialRowPageTotalRowCount: 100_000,
				initialRowPageStartRowIndex: 99_936,
				initialRowPagePayloadBytes: 12_345,
			}),
		],
		hydrationTimings: [],
		panelOpenMarks: {},
		agentPanelPerformanceSamples: [],
	};
}

describe("summarizeSessionOpenContentProbe", () => {
	it("passes hot ledger opens under the first-row paint target", () => {
		const summary = summarizeSessionOpenContentProbe(
			probeWithTiming({
				firstRowPaintMs: 24,
				openResultTiming: timing({
					source: "transcript-row-ledger",
					openPath: "hot_ledger",
					providerLoadMs: 0,
					ledgerTailReadMs: 3.5,
					assembleMs: 0,
					compactMs: 0,
					totalMs: 9,
				}),
			})
		);

		expect(summary.status).toBe("ok");
		expect(summary.backendLine).toContain("path=hot_ledger");
		expect(summary.backendLine).toContain("ledgerProbe=current");
		expect(summary.backendLine).toContain("ledger=3.50 ms");
		expect(summary.backendLine).toContain("providerBeforePaint=no");
		expect(summary.backendLine).toContain("assembleBeforePaint=no");
		expect(summary.backendLine).toContain("compactBeforePaint=no");
		expect(summary.backendLine).toContain("tailRows=64");
		expect(summary.backendLine).toContain("totalRows=100000");
		expect(summary.backendLine).toContain("startRow=99936");
		expect(summary.backendLine).toContain("payloadBytes=12345");
		expect(summary.targetLine).toBe(
			"target: hot_ledger firstRowPaint <= 32.00 ms status=ok foreground=valid"
		);
	});

	it("warns for non-hot opens even when they meet the cold threshold", () => {
		const summary = summarizeSessionOpenContentProbe(
			probeWithTiming({
				firstRowPaintMs: 84,
				openResultTiming: timing({
					source: "provider-owned-legacy-rebuild",
					openPath: "legacy_rebuild",
					providerLoadMs: 22,
					ledgerTailReadMs: 0,
					assembleMs: 31,
					compactMs: 4,
					totalMs: 90,
				}),
			})
		);

		expect(summary.status).toBe("warn");
		expect(summary.backendLine).toContain("path=legacy_rebuild");
		expect(summary.backendLine).toContain("ledgerProbe=missing");
		expect(summary.backendLine).toContain("providerBeforePaint=yes");
		expect(summary.backendLine).toContain("assembleBeforePaint=yes");
		expect(summary.backendLine).toContain("compactBeforePaint=yes");
		expect(summary.targetLine).toBe(
			"target: non-hot firstRowPaint <= 100.00 ms status=warn hotEligible=no foreground=valid"
		);
	});

	it("fails hot ledger opens that miss the 32ms target", () => {
		const summary = summarizeSessionOpenContentProbe(
			probeWithTiming({
				firstRowPaintMs: 45,
				openResultTiming: timing({
					source: "transcript-row-ledger",
					openPath: "hot_ledger",
					providerLoadMs: 0,
					ledgerTailReadMs: 18,
					assembleMs: 0,
					compactMs: 0,
					totalMs: 30,
				}),
			})
		);

		expect(summary.status).toBe("fail");
		expect(summary.targetLine).toBe(
			"target: hot_ledger firstRowPaint <= 32.00 ms status=fail foreground=valid"
		);
	});

	it("warns instead of failing when foreground frame timing is invalid", () => {
		const probe = probeWithTiming({
			firstRowPaintMs: 180,
			openResultTiming: timing({
				source: "transcript-row-ledger",
				openPath: "hot_ledger",
				providerLoadMs: 0,
				ledgerTailReadMs: 2,
				assembleMs: 0,
				compactMs: 0,
				totalMs: 7,
			}),
		});
		const summary = summarizeSessionOpenContentProbe({
			hookAvailable: probe.hookAvailable,
			sessionId: probe.sessionId,
			panelId: probe.panelId,
			documentVisibilityAtStart: "hidden",
			documentVisibilityAtEnd: "hidden",
			documentHasFocusAtStart: false,
			documentHasFocusAtEnd: false,
			foregroundFrameTimingValid: false,
			sessionKnownBeforeOpen: probe.sessionKnownBeforeOpen,
			placeholderRegistered: probe.placeholderRegistered,
			closedExistingPanel: probe.closedExistingPanel,
			closeAfterRequested: probe.closeAfterRequested,
			selectCallMs: probe.selectCallMs,
			panelDomReadyMs: probe.panelDomReadyMs,
			transcriptViewportReadyMs: probe.transcriptViewportReadyMs,
			firstRowDomReadyMs: probe.firstRowDomReadyMs,
			firstRowPaintMs: probe.firstRowPaintMs,
			rowCountAtFirstPaint: probe.rowCountAtFirstPaint,
			finalRowCount: probe.finalRowCount,
			panelStillOpenAtEnd: probe.panelStillOpenAtEnd,
			panelDomPresentAtEnd: probe.panelDomPresentAtEnd,
			sessionKnownAtEnd: probe.sessionKnownAtEnd,
			sessionHasCanonicalProjectionAtEnd: probe.sessionHasCanonicalProjectionAtEnd,
			sessionCanSendAtEnd: probe.sessionCanSendAtEnd,
			sessionLifecycleStatusAtEnd: probe.sessionLifecycleStatusAtEnd,
			sessionMessageCountAtEnd: probe.sessionMessageCountAtEnd,
			timedOut: probe.timedOut,
			errorMessage: probe.errorMessage,
			runtimeErrors: probe.runtimeErrors,
			tauriInvokeTimings: probe.tauriInvokeTimings,
			pendingTauriInvokes: probe.pendingTauriInvokes,
			openEvents: probe.openEvents,
			hydrationTimings: probe.hydrationTimings,
			panelOpenMarks: probe.panelOpenMarks,
			agentPanelPerformanceSamples: [],
		});

		expect(summary.status).toBe("warn");
		expect(summary.targetLine).toBe(
			"target: hot_ledger firstRowPaint <= 32.00 ms status=warn foreground=invalid"
		);
	});

	it("formats unavailable ledger timing for older payloads", () => {
		const line = formatSessionOpenBackendTiming([
			eventWithTiming({
				openResultTiming: timing({
					source: "provider-owned-snapshot",
					openPath: null,
					providerLoadMs: 10,
					ledgerTailReadMs: null,
					assembleMs: 20,
					compactMs: 5,
					totalMs: 40,
				}),
				initialRowPageRowCount: null,
				initialRowPageTotalRowCount: null,
				initialRowPageStartRowIndex: null,
				initialRowPagePayloadBytes: null,
			}),
		]);

		expect(line).toContain("path=unknown");
		expect(line).toContain("ledger=unavailable");
	});
});

describe("sessionOpenContentProbeResultSchema", () => {
	it("accepts stale-panel diagnostics from the real app probe", () => {
		const parsed = sessionOpenContentProbeResultSchema.parse(
			probeWithTiming({
				firstRowPaintMs: 16,
				openResultTiming: null,
				openEventStage: "stale-panel",
			})
		);

		expect(parsed.openEvents[0]?.stage).toBe("stale-panel");
	});

	it("preserves open-path classification and ledger tail timing", () => {
		const parsed = sessionOpenContentProbeResultSchema.parse(
			probeWithTiming({
				firstRowPaintMs: 16,
				openResultTiming: timing({
					source: "transcript-row-ledger",
					openPath: "hot_ledger",
					providerLoadMs: 0,
					ledgerTailReadMs: 2,
					assembleMs: 0,
					compactMs: 0,
					totalMs: 7,
				}),
			})
		);
		const openResultTiming = parsed.openEvents[0]?.openResultTiming ?? null;
		const openEvent = parsed.openEvents[0];

		expect(openResultTiming?.openPath).toBe("hot_ledger");
		expect(openResultTiming?.ledgerTailReadMs).toBe(2);
		expect(openEvent?.initialRowPageRowCount).toBe(64);
		expect(openEvent?.initialRowPageTotalRowCount).toBe(100_000);
		expect(openEvent?.initialRowPageStartRowIndex).toBe(99_936);
		expect(openEvent?.initialRowPagePayloadBytes).toBe(12_345);
	});
});
