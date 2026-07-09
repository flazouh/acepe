import { z } from "zod";

export const qaStatusSchema = z.enum(["ok", "warn", "fail"]);

export const qaArtifactSchema = z.object({
	path: z.string(),
	kind: z.string(),
});

export const qaErrorSchema = z.object({
	code: z.string(),
	message: z.string(),
	nextStep: z.string().optional(),
});

export const qaCommandResultSchema = z.object({
	command: z.string(),
	status: qaStatusSchema,
	summary: z.array(z.string()),
	artifact: qaArtifactSchema.optional(),
	error: qaErrorSchema.optional(),
});

export const targetProcessSchema = z.object({
	pid: z.number(),
	command: z.string(),
	kind: z.enum(["dev", "production", "other"]),
});

export const targetDoctorResultSchema = z.object({
	checkoutRoot: z.string(),
	appIdentifier: z.string(),
	status: qaStatusSchema,
	devProcessCount: z.number(),
	productionProcessCount: z.number(),
	devProcesses: z.array(targetProcessSchema),
	productionProcesses: z.array(targetProcessSchema),
	bridge: z.object({
		port: z.string(),
		available: z.boolean(),
	}),
	binaryFreshness: z.object({
		status: z.enum(["fresh", "stale", "unknown"]),
		message: z.string(),
	}),
	frontendFreshness: z.object({
		status: z.enum(["fresh", "stale", "unknown"]),
		message: z.string(),
	}),
	webview: z.object({
		responsive: z.boolean(),
		url: z.string().nullable(),
		title: z.string().nullable(),
		error: z.string().nullable(),
	}),
	findings: z.array(z.string()),
});

export const observeLevelSchema = z.enum(["summary", "focused", "raw"]);

export const appObservationSchema = z.object({
	url: z.string().nullable(),
	title: z.string().nullable(),
	route: z.string().nullable(),
	panelCount: z.number(),
	focusedPanelTitle: z.string().nullable(),
	visibleSessionErrors: z.array(z.string()),
	composer: z.object({
		present: z.boolean(),
		text: z.string(),
		sendEnabled: z.boolean(),
		sessionCanSubmit: z.boolean().nullable(),
	}),
	consoleErrors: z.array(z.string()),
	refs: z.array(
		z.object({
			ref: z.string(),
			role: z.string(),
			name: z.string(),
			selector: z.string(),
		})
	),
	rawTextPreview: z.string().nullable(),
});

export const focusAppResultSchema = z.object({
	route: z.string().nullable(),
	documentVisibilityState: z.string().nullable(),
	documentHasFocus: z.boolean().nullable(),
	windowVisible: z.boolean().nullable(),
	windowMinimized: z.boolean().nullable(),
	windowFocused: z.boolean().nullable(),
	windowOuterWidth: z.number().nullable(),
	windowOuterHeight: z.number().nullable(),
	windowStateError: z.string().nullable(),
	tauriActivateAttempted: z.boolean(),
	tauriActivateOk: z.boolean(),
	tauriActivateError: z.string().nullable(),
	windowFocusAttempted: z.boolean(),
	windowFocusOk: z.boolean(),
	windowFocusError: z.string().nullable(),
	windowRaiseAttempted: z.boolean().optional().default(false),
	windowRaiseOk: z.boolean().optional().default(false),
	windowRaiseError: z.string().nullable().optional().default(null),
	message: z.string(),
});

export const agentPanelPerformanceSampleSchema = z.object({
	phase: z.string(),
	durationMs: z.number(),
	itemCount: z.number().nullable(),
	nodeCount: z.number().nullable(),
	timestampMs: z.number(),
});

export const agentPanelPerformancePhaseSummarySchema = z.object({
	phase: z.string(),
	count: z.number(),
	totalDurationMs: z.number(),
	averageDurationMs: z.number(),
	maxDurationMs: z.number(),
	maxItemCount: z.number().nullable(),
	maxNodeCount: z.number().nullable(),
});

export const frameRateProbeResultSchema = z.object({
	route: z.string().nullable(),
	selector: z.string().nullable(),
	selectorIndex: z.number().optional().default(0),
	selectorMatchCount: z.number().optional().default(0),
	selectorMatched: z.boolean(),
	scrolled: z.boolean(),
	sampleCount: z.number(),
	frameDeltasMs: z.array(z.number()),
	averageFrameDeltaMs: z.number().nullable(),
	minFrameDeltaMs: z.number().nullable(),
	maxFrameDeltaMs: z.number().nullable(),
	estimatedFps: z.number().nullable(),
	jankFrameCount: z.number(),
	visibilityState: z.string().nullable(),
	documentHasFocus: z.boolean().nullable(),
	requestAnimationFrameAvailable: z.boolean(),
	rafWaitCount: z.number(),
	timeoutWaitCount: z.number(),
	likelyThrottled: z.boolean(),
	rowChurnSamples: z.array(
		z.object({
			frameIndex: z.number(),
			scrollTopPx: z.number(),
			domRowCount: z.number(),
			firstRowIndex: z.number().nullable(),
			lastRowIndex: z.number().nullable(),
			mountedRowCount: z.number(),
			unmountedRowCount: z.number(),
			mountedRows: z
				.array(
					z.object({
						rowId: z.string(),
						rowIndex: z.number(),
						text: z.string(),
						visualSignature: z.string().nullable().optional().default(null),
					})
				)
				.optional()
				.default([]),
			unmountedRows: z
				.array(
					z.object({
						rowId: z.string(),
						rowIndex: z.number(),
						text: z.string(),
						visualSignature: z.string().nullable().optional().default(null),
					})
				)
				.optional()
				.default([]),
		})
	),
	visualChangeCount: z.number().optional().default(0),
	visualChanges: z
		.array(
			z.object({
				frameIndex: z.number(),
				rowId: z.string(),
				rowIndex: z.number(),
				previousSignature: z.string(),
				nextSignature: z.string(),
				text: z.string(),
			})
		)
		.optional()
		.default([]),
	maxMountedRowCount: z.number().nullable(),
	maxUnmountedRowCount: z.number().nullable(),
	maxDomRowCount: z.number().nullable(),
	agentPanelProfileSamples: z.array(agentPanelPerformanceSampleSchema),
	agentPanelProfilePhaseSummaries: z.array(agentPanelPerformancePhaseSummarySchema),
});

export const agentPanelRowScanRowSchema = z.object({
	index: z.number(),
	rowId: z.string().nullable(),
	rowIndex: z.number().nullable(),
	text: z.string(),
	heightPx: z.number(),
	entryType: z.string().nullable().optional().default(null),
	toolKind: z.string().nullable().optional().default(null),
	toolStatus: z.string().nullable().optional().default(null),
	toolTitle: z.string().nullable().optional().default(null),
	toolPresentationState: z.string().nullable().optional().default(null),
	missingEntry: z.boolean().optional().default(false),
});

export const agentPanelRowScanResultSchema = z.object({
	route: z.string().nullable(),
	selector: z.string(),
	selectorIndex: z.number().optional().default(0),
	selectorMatchCount: z.number().optional().default(0),
	selectorMatched: z.boolean(),
	scrollTopPx: z.number().nullable(),
	scrollHeightPx: z.number().nullable(),
	clientHeightPx: z.number().nullable(),
	maxScrollTopPx: z.number().nullable(),
	rowCount: z.number(),
	emptyRowCount: z.number(),
	exactGenericToolRowCount: z.number(),
	prefixGenericToolRowCount: z.number(),
	rawProviderToolRowCount: z.number().optional().default(0),
	missingEntryRowCount: z.number().optional().default(0),
	degradedToolRowCount: z.number().optional().default(0),
	firstRowIndex: z.number().nullable(),
	lastRowIndex: z.number().nullable(),
	rows: z.array(agentPanelRowScanRowSchema),
	genericToolRows: z.array(agentPanelRowScanRowSchema),
	rawProviderToolRows: z.array(agentPanelRowScanRowSchema).optional().default([]),
	missingEntryRows: z.array(agentPanelRowScanRowSchema).optional().default([]),
	degradedToolRows: z.array(agentPanelRowScanRowSchema).optional().default([]),
});

export const agentPanelScrollPageProbeSampleSchema = z.object({
	stepIndex: z.number(),
	scrollTopPx: z.number(),
	scrollHeightPx: z.number(),
	clientHeightPx: z.number(),
	maxScrollTopPx: z.number(),
	bufferStartIndex: z.number().nullable(),
	bufferEndIndex: z.number().nullable(),
	bufferRowCount: z.number().nullable(),
	bufferTotalRowCount: z.number().nullable(),
	bufferLastAction: z.string().nullable(),
	bufferLastStatus: z.string().nullable(),
	bufferLastReason: z.string().nullable(),
	rowCount: z.number(),
	emptyRowCount: z.number(),
	exactGenericToolRowCount: z.number(),
	prefixGenericToolRowCount: z.number(),
	rawProviderToolRowCount: z.number().optional().default(0),
	firstRowId: z.string().nullable(),
	lastRowId: z.string().nullable(),
	firstRowText: z.string().nullable(),
	lastRowText: z.string().nullable(),
});

export const agentPanelScrollPageProbeTimingSampleSchema = z.object({
	stepIndex: z.number(),
	frameDeltaMs: z.number(),
	scrollToFrameMs: z.number().optional().default(0),
	beforeScrollTopPx: z.number(),
	targetScrollTopPx: z.number(),
	afterScrollTopPx: z.number(),
	beforeScrollHeightPx: z.number(),
	afterScrollHeightPx: z.number(),
	scrollHeightDeltaPx: z.number(),
	scrollTopCorrectionPx: z.number(),
	bufferStartIndex: z.number().nullable(),
	bufferEndIndex: z.number().nullable(),
	bufferRowCount: z.number().nullable(),
	bufferTotalRowCount: z.number().nullable(),
	bufferLastAction: z.string().nullable(),
	bufferLastStatus: z.string().nullable(),
	bufferLastReason: z.string().nullable(),
	rowCount: z.number(),
	firstRowId: z.string().nullable(),
	lastRowId: z.string().nullable(),
});

export const agentPanelScrollPageProbeResultSchema = z.object({
	route: z.string().nullable(),
	selector: z.string(),
	selectorIndex: z.number().optional().default(0),
	selectorMatchCount: z.number().optional().default(0),
	selectorMatched: z.boolean(),
	scrollStepPx: z.number(),
	settleMs: z.number(),
	sampleCount: z.number(),
	initialScrollTopPx: z.number().nullable(),
	finalScrollTopPx: z.number().nullable(),
	initialScrollHeightPx: z.number().nullable(),
	finalScrollHeightPx: z.number().nullable(),
	clientHeightPx: z.number().nullable(),
	maxScrollTopPx: z.number().nullable(),
	reachedTop: z.boolean(),
	moved: z.boolean(),
	loadedMoreRows: z.boolean(),
	distinctRowIdCount: z.number(),
	distinctFirstRowIdCount: z.number(),
	maxSampleRowCount: z.number(),
	zeroRowSampleCount: z.number(),
	blankViewportSampleCount: z.number(),
	maxEmptyRowCount: z.number(),
	maxExactGenericToolRowCount: z.number(),
	maxPrefixGenericToolRowCount: z.number(),
	maxRawProviderToolRowCount: z.number().optional().default(0),
	frameDeltasMs: z.array(z.number()).optional().default([]),
	averageFrameDeltaMs: z.number().nullable().optional().default(null),
	minFrameDeltaMs: z.number().nullable().optional().default(null),
	maxFrameDeltaMs: z.number().nullable().optional().default(null),
	estimatedFps: z.number().nullable().optional().default(null),
	missed120FrameCount: z.number().optional().default(0),
	missed60FrameCount: z.number().optional().default(0),
	visibilityState: z.string().nullable().optional().default(null),
	documentHasFocus: z.boolean().nullable().optional().default(null),
	rafWaitCount: z.number().optional().default(0),
	timeoutWaitCount: z.number().optional().default(0),
	likelyThrottled: z.boolean().optional().default(false),
	maxScrollHeightDeltaPx: z.number().optional().default(0),
	maxScrollTopCorrectionPx: z.number().optional().default(0),
	timingSamples: z.array(agentPanelScrollPageProbeTimingSampleSchema).optional().default([]),
	samples: z.array(agentPanelScrollPageProbeSampleSchema),
});

export const screenshotResultSchema = z.object({
	path: z.string(),
});

export const domRectSchema = z.object({
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
	top: z.number(),
	right: z.number(),
	bottom: z.number(),
	left: z.number(),
});

export const domElementSummarySchema = z.object({
	index: z.number(),
	tag: z.string(),
	role: z.string().nullable(),
	name: z.string(),
	text: z.string(),
	value: z.string().nullable(),
	src: z.string().nullable(),
	attributes: z.record(z.string(), z.string()),
	classes: z.string(),
	visible: z.boolean(),
	focused: z.boolean(),
	computedStyle: z.object({
		display: z.string(),
		color: z.string(),
		backgroundColor: z.string(),
		gap: z.string(),
		rowGap: z.string(),
		columnGap: z.string(),
		paddingTop: z.string(),
		paddingRight: z.string(),
		paddingBottom: z.string(),
		paddingLeft: z.string(),
		animationName: z.string(),
		animationDuration: z.string(),
		animationDelay: z.string(),
		animationIterationCount: z.string(),
	}),
	rect: domRectSchema,
	animationNames: z.array(z.string()),
});

export const domInspectionResultSchema = z.object({
	selector: z.string(),
	count: z.number(),
	elements: z.array(domElementSummarySchema),
});

export const clickResultSchema = z.object({
	clicked: z.boolean(),
	match: domElementSummarySchema.nullable(),
});

export const hoverResultSchema = z.object({
	hovered: z.boolean(),
	match: domElementSummarySchema.nullable(),
	after: domInspectionResultSchema.nullable().optional(),
});

export const thinkingToggleProbeResultSchema = z.object({
	found: z.boolean(),
	clicked: z.boolean(),
	samples: z.array(
		z.object({
			label: z.string(),
			expandCount: z.number(),
			collapseCount: z.number(),
			contentCount: z.number(),
			firstButtonName: z.string().nullable(),
			firstContentText: z.string().nullable(),
		})
	),
});

export const resetOnboardingResultSchema = z.object({
	clickedDevTools: z.boolean(),
	clickedReset: z.boolean(),
	hasWelcome: z.boolean(),
	panelCount: z.number(),
	animated: z.array(
		z.object({
			className: z.string(),
			animationName: z.string(),
		})
	),
});

export const streamingReproLabResultSchema = z.object({
	hookAvailable: z.boolean(),
	opened: z.boolean(),
	labPresent: z.boolean(),
	phaseLabel: z.string().nullable(),
	tokenRevealAnimatedCount: z.number(),
	tokenRevealMode: z.string().nullable(),
});

export const sendComposerResultSchema = z.object({
	composerFound: z.boolean(),
	textApplied: z.string(),
	sendReady: z.boolean(),
	sent: z.boolean(),
});

export const navigateResultSchema = z.object({
	from: z.string(),
	to: z.string(),
	path: z.string(),
});

export const watchResultSchema = z.object({
	text: z.string(),
	presentInDom: z.boolean(),
	visible: z.boolean(),
	firstVisibleAtMs: z.number().nullable(),
	elapsedMs: z.number(),
	timedOut: z.boolean(),
	matched: z
		.object({
			rect: domRectSchema,
			display: z.string(),
			visibility: z.string(),
			opacity: z.string(),
			hasOffsetParent: z.boolean(),
		})
		.nullable(),
});

export const resizeProbeSampleSchema = z.object({
	step: z.number(),
	elapsedMs: z.number(),
	targetDelta: z.number(),
	expectedWidth: z.number(),
	immediateWidth: z.number(),
	microtaskWidth: z.number(),
	frameWidth: z.number(),
	dispatchMs: z.number(),
	frameDelayMs: z.number(),
});

export const resizeProbeResultSchema = z.object({
	found: z.boolean(),
	edgeRect: domRectSchema.nullable(),
	panelRectBefore: domRectSchema.nullable(),
	panelRectAfter: domRectSchema.nullable(),
	requestedDelta: z.number(),
	steps: z.number(),
	stepDelayMs: z.number(),
	originalWidth: z.number().nullable(),
	finalWidthBeforeRestore: z.number().nullable(),
	restoredWidth: z.number().nullable(),
	observedDeltaBeforeRestore: z.number().nullable(),
	finalLagPx: z.number().nullable(),
	maxImmediateLagPx: z.number().nullable(),
	maxFrameLagPx: z.number().nullable(),
	avgFrameDelayMs: z.number().nullable(),
	maxFrameDelayMs: z.number().nullable(),
	transitionProperty: z.string().nullable(),
	transitionDuration: z.string().nullable(),
	samples: z.array(resizeProbeSampleSchema),
});

export const resizeStreamProbeSampleSchema = z.object({
	elapsedMs: z.number(),
	expectedWidth: z.number(),
	width: z.number(),
	lagPx: z.number(),
});

export const resizeStreamProbeResultSchema = z.object({
	found: z.boolean(),
	edgeRect: domRectSchema.nullable(),
	panelRectBefore: domRectSchema.nullable(),
	panelRectAfter: domRectSchema.nullable(),
	requestedDelta: z.number(),
	durationMs: z.number(),
	moveIntervalMs: z.number(),
	originalWidth: z.number().nullable(),
	finalWidthBeforeRestore: z.number().nullable(),
	restoredWidth: z.number().nullable(),
	moveCount: z.number(),
	frameCount: z.number(),
	maxLagPx: z.number().nullable(),
	avgLagPx: z.number().nullable(),
	maxFrameIntervalMs: z.number().nullable(),
	avgFrameIntervalMs: z.number().nullable(),
	framesOver50Ms: z.number(),
	transitionProperty: z.string().nullable(),
	transitionDuration: z.string().nullable(),
	samples: z.array(resizeStreamProbeSampleSchema),
});

export const firstSendTimelineSampleSchema = z.object({
	label: z.string(),
	elapsedMs: z.number(),
	composerText: z.string(),
	composerContainsPrompt: z.boolean(),
	messageVisible: z.boolean(),
	messageVisibleInTranscript: z.boolean(),
	sentRowVisibleInViewport: z.boolean(),
	planningVisible: z.boolean(),
	readyVisible: z.boolean(),
	matchingTextLeafCount: z.number(),
	matchingTranscriptViewportCount: z.number(),
	transcriptViewportCount: z.number(),
	maxOnscreenRowHeightPx: z.number(),
	placeholderHeightPx: z.number().nullable(),
	distFromBottomPx: z.number(),
	bodyPreview: z.string(),
});

export const firstSendTimelineProbeResultSchema = z.object({
	composerFound: z.boolean(),
	selectedComposerIndex: z.number().nullable(),
	selectedComposerName: z.string().nullable(),
	sendFound: z.boolean(),
	sendReadyBeforeClick: z.boolean(),
	sent: z.boolean(),
	prompt: z.string(),
	samples: z.array(firstSendTimelineSampleSchema),
});

export const openPersistedSessionDiagnosticEventSchema = z.object({
	stage: z.enum([
		"started",
		"skipped-duplicate",
		"stale-panel",
		"missing-metadata",
		"request-started",
		"result-missing",
		"result-error",
		"result-found",
		"hydrated",
		"request-failed",
		"timed-out",
		"finished",
	]),
	source: z.enum(["initialization-manager", "session-handler"]),
	panelId: z.string(),
	sessionId: z.string(),
	elapsedMs: z.number(),
	canonicalSessionId: z.string().nullable(),
	outcome: z.string().nullable(),
	message: z.string().nullable(),
	hasSessionIdentity: z.boolean().nullable(),
	hasSessionMetadata: z.boolean().nullable(),
	shouldAttemptLocalReattach: z.boolean().nullable(),
	hasInitialViewportEnvelope: z
		.boolean()
		.nullable()
		.optional()
		.transform((value) => value ?? null),
	initialRowPageRowCount: z
		.number()
		.nullable()
		.optional()
		.transform((value) => value ?? null),
	initialRowPageTotalRowCount: z
		.number()
		.nullable()
		.optional()
		.transform((value) => value ?? null),
	initialRowPageStartRowIndex: z
		.number()
		.nullable()
		.optional()
		.transform((value) => value ?? null),
	initialRowPagePayloadBytes: z
		.number()
		.nullable()
		.optional()
		.transform((value) => value ?? null),
	openResultTiming: z
		.object({
			source: z.string(),
			openPath: z
				.enum(["hot_ledger", "legacy_rebuild", "compat_snapshot"])
				.nullable()
				.optional()
				.transform((value) => value ?? null),
			ledgerProbeStatus: z.string().optional().default("unknown"),
			contextMs: z.number(),
			providerLoadMs: z.number(),
			ledgerTailReadMs: z
				.number()
				.nullable()
				.optional()
				.transform((value) => value ?? null),
			ledgerJournalCutoffMs: z.number().optional().default(0),
			ledgerPageReadMs: z.number().optional().default(0),
			ledgerHeaderDecodeMs: z.number().optional().default(0),
			ledgerRowsDecodeMs: z.number().optional().default(0),
			ledgerResultBuildMs: z.number().optional().default(0),
			runtimeLookupMs: z.number(),
			assembleMs: z.number(),
			restoreAuthorityMs: z.number(),
			compactMs: z.number(),
			localJournalFallbackMs: z.number(),
			totalMs: z.number(),
			transcriptEntryCount: z.number(),
			operationCount: z.number(),
		})
		.nullable()
		.optional()
		.transform((value) => value ?? null),
});

export const sessionOpenHydrationTimingRecordSchema = z.object({
	panelId: z.string(),
	requestedSessionId: z.string(),
	canonicalSessionId: z.string(),
	applied: z.boolean(),
	skippedReason: z.enum(["stale_request", "older_revision"]).nullable(),
	totalMs: z.number(),
	materializeSnapshotMs: z.number(),
	replaceOpenSnapshotMs: z.number(),
	replaceStateGraphMs: z.number(),
	applyViewportEnvelopeMs: z.number(),
	applyInitialRowPageMs: z.number(),
	ensureRowsBootstrapMs: z.number(),
	updatePanelSessionMs: z.number(),
	initialRowPageRowCount: z.number().nullable(),
	totalRowCount: z.number().nullable(),
	rowPayloadBytes: z.number().nullable(),
});

export const sessionOpenContentProbeResultSchema = z.object({
	hookAvailable: z.boolean(),
	sessionId: z.string(),
	panelId: z.string().nullable(),
	documentVisibilityAtStart: z.string().optional().default("unknown"),
	documentVisibilityAtEnd: z.string().optional().default("unknown"),
	documentHasFocusAtStart: z.boolean().optional().default(false),
	documentHasFocusAtEnd: z.boolean().optional().default(false),
	foregroundFrameTimingValid: z.boolean().optional().default(false),
	sessionKnownBeforeOpen: z.boolean(),
	placeholderRegistered: z.boolean(),
	closedExistingPanel: z.boolean(),
	closeAfterRequested: z.boolean().optional().default(true),
	selectCallMs: z.number().nullable(),
	panelDomReadyMs: z.number().nullable(),
	transcriptViewportReadyMs: z.number().nullable(),
	firstRowDomReadyMs: z.number().nullable(),
	firstRowPaintMs: z.number().nullable(),
	rowCountAtFirstPaint: z.number(),
	finalRowCount: z.number(),
	panelStillOpenAtEnd: z.boolean().optional().default(false),
	panelDomPresentAtEnd: z.boolean().optional().default(false),
	sessionKnownAtEnd: z.boolean().optional().default(false),
	sessionHasCanonicalProjectionAtEnd: z.boolean().optional().default(false),
	sessionCanSendAtEnd: z.boolean().nullable().optional().default(null),
	sessionLifecycleStatusAtEnd: z.string().nullable().optional().default(null),
	sessionMessageCountAtEnd: z.number().nullable().optional().default(null),
	timedOut: z.boolean(),
	errorMessage: z.string().nullable(),
	runtimeErrors: z.array(z.string()),
	tauriInvokeTimings: z.array(tauriInvokeTimingRecordSchema),
	pendingTauriInvokes: z.array(tauriPendingInvokeRecordSchema).optional().default([]),
	openEvents: z.array(openPersistedSessionDiagnosticEventSchema).optional().default([]),
	hydrationTimings: z.array(sessionOpenHydrationTimingRecordSchema).optional().default([]),
	panelOpenMarks: z.record(z.string(), z.number()).optional().default({}),
	agentPanelPerformanceSamples: z.array(agentPanelPerformanceSampleSchema).optional().default([]),
});

export const sessionOpenContentProbeRunStatusSchema = z.object({
	runId: z.string(),
	status: z.enum(["missing", "running", "done"]),
	result: sessionOpenContentProbeResultSchema.nullable(),
});

export const planningDebugSnapshotSchema = z.object({
	sessionId: z.string().nullable(),
	sourceKind: z.string().nullable(),
	lifecycleStatus: z.string().nullable(),
	activityKind: z.string().nullable(),
	turnState: z.string().nullable(),
	hasOptimisticPendingEntry: z.boolean(),
	hasLocalPendingSendIntent: z.boolean(),
	pendingSendIntentAttemptId: z.string().nullable(),
	hasMessages: z.boolean(),
	visibleEntryCount: z.number(),
	showPlanningIndicator: z.boolean(),
	actionabilityCanSend: z.boolean().nullable(),
	sessionCanSubmit: z.boolean(),
	disableSendForFailedFirstSend: z.boolean(),
	capturedAtMs: z.number(),
});

export const planningDebugResultSchema = z.object({
	available: z.boolean(),
	snapshots: z.array(planningDebugSnapshotSchema),
});

export const computerUseProbeResultSchema = z.object({
	serverName: z.string(),
	toolName: z.string(),
	sessionId: z.string(),
	transport: z.string(),
	ok: z.boolean(),
	isError: z.boolean(),
	payloadJson: z.string(),
	app: z.string().nullable(),
	window: z.string().nullable(),
	elementCount: z.number(),
	errorCode: z.string().nullable(),
	permissionKind: z.string().nullable(),
	actionVerb: z.string().nullable(),
	actionTargetLabel: z.string().nullable(),
	actionTargetId: z.string().nullable(),
	actionOk: z.boolean().nullable(),
	actionErrorCode: z.string().nullable(),
	actionChangedCount: z.number().nullable(),
	actionElementCount: z.number().nullable(),
});

export const ledgerBackfillProbeResultSchema = z.object({
	requestedLimit: z.number(),
	candidateCount: z.number(),
	checkedCount: z.number(),
	rebuiltCount: z.number(),
	rebuiltFromProviderCount: z.number(),
	skippedCurrentCount: z.number(),
	skippedNoJournalCount: z.number(),
	skippedMissingFactsCount: z.number(),
	failedCount: z.number(),
	failedSessionIds: z.array(z.string()),
});

export type SendComposerResult = z.infer<typeof sendComposerResultSchema>;
export type PlanningDebugResult = z.infer<typeof planningDebugResultSchema>;
export type ComputerUseProbeResult = z.infer<typeof computerUseProbeResultSchema>;
export type LedgerBackfillProbeResult = z.infer<typeof ledgerBackfillProbeResultSchema>;
export type NavigateResult = z.infer<typeof navigateResultSchema>;
export type WatchResult = z.infer<typeof watchResultSchema>;
export type ResizeProbeResult = z.infer<typeof resizeProbeResultSchema>;
export type ResizeStreamProbeResult = z.infer<typeof resizeStreamProbeResultSchema>;
export type FirstSendTimelineProbeResult = z.infer<typeof firstSendTimelineProbeResultSchema>;
export type SessionOpenContentProbeResult = z.infer<typeof sessionOpenContentProbeResultSchema>;
export type SessionOpenContentProbeRunStatus = z.infer<
	typeof sessionOpenContentProbeRunStatusSchema
>;
export type FocusAppResult = z.infer<typeof focusAppResultSchema>;
export type FrameRateProbeResult = z.infer<typeof frameRateProbeResultSchema>;
export type AgentPanelRowScanResult = z.infer<typeof agentPanelRowScanResultSchema>;
export type AgentPanelScrollPageProbeResult = z.infer<typeof agentPanelScrollPageProbeResultSchema>;
export type QaStatus = z.infer<typeof qaStatusSchema>;
export type QaCommandResult = z.infer<typeof qaCommandResultSchema>;
export type QaError = z.infer<typeof qaErrorSchema>;
export type TargetProcess = z.infer<typeof targetProcessSchema>;
export type TargetDoctorResult = z.infer<typeof targetDoctorResultSchema>;
export type ObserveLevel = z.infer<typeof observeLevelSchema>;
export type AppObservation = z.infer<typeof appObservationSchema>;
export type ScreenshotResult = z.infer<typeof screenshotResultSchema>;
export type DomInspectionResult = z.infer<typeof domInspectionResultSchema>;
export type ClickResult = z.infer<typeof clickResultSchema>;
export type HoverResult = z.infer<typeof hoverResultSchema>;
export type ThinkingToggleProbeResult = z.infer<typeof thinkingToggleProbeResultSchema>;
export type ResetOnboardingResult = z.infer<typeof resetOnboardingResultSchema>;
export type StreamingReproLabResult = z.infer<typeof streamingReproLabResultSchema>;
