import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const qaStatusSchema = Schema.Literals(["ok", "warn", "fail"]);

export const qaArtifactSchema = Schema.Struct({
	path: Schema.String,
	kind: Schema.String,
});

export const qaErrorSchema = Schema.Struct({
	code: Schema.String,
	message: Schema.String,
	nextStep: Schema.optionalKey(Schema.String),
});

export const qaCommandResultSchema = Schema.Struct({
	command: Schema.String,
	status: qaStatusSchema,
	summary: Schema.Array(Schema.String),
	artifact: Schema.optionalKey(qaArtifactSchema),
	error: Schema.optionalKey(qaErrorSchema),
});

export const targetProcessSchema = Schema.Struct({
	pid: Schema.Number,
	command: Schema.String,
	kind: Schema.Literals(["dev", "production", "other"]),
});

export const targetDoctorResultSchema = Schema.Struct({
	checkoutRoot: Schema.String,
	appIdentifier: Schema.String,
	status: qaStatusSchema,
	devProcessCount: Schema.Number,
	productionProcessCount: Schema.Number,
	devProcesses: Schema.Array(targetProcessSchema),
	productionProcesses: Schema.Array(targetProcessSchema),
	bridge: Schema.Struct({
		port: Schema.String,
		available: Schema.Boolean,
	}),
	binaryFreshness: Schema.Struct({
		status: Schema.Literals(["fresh", "stale", "unknown"]),
		message: Schema.String,
	}),
	frontendFreshness: Schema.Struct({
		status: Schema.Literals(["fresh", "stale", "unknown"]),
		message: Schema.String,
	}),
	webview: Schema.Struct({
		responsive: Schema.Boolean,
		url: Schema.NullOr(Schema.String),
		title: Schema.NullOr(Schema.String),
		error: Schema.NullOr(Schema.String),
	}),
	findings: Schema.Array(Schema.String),
});

export const observeLevelSchema = Schema.Literals(["summary", "focused", "raw"]);

export const appObservationSchema = Schema.Struct({
	url: Schema.NullOr(Schema.String),
	title: Schema.NullOr(Schema.String),
	route: Schema.NullOr(Schema.String),
	panelCount: Schema.Number,
	focusedPanelTitle: Schema.NullOr(Schema.String),
	visibleSessionErrors: Schema.Array(Schema.String),
	composer: Schema.Struct({
		present: Schema.Boolean,
		text: Schema.String,
		sendEnabled: Schema.Boolean,
		sessionCanSubmit: Schema.NullOr(Schema.Boolean),
	}),
	consoleErrors: Schema.Array(Schema.String),
	refs: Schema.Array(
		Schema.Struct({
			ref: Schema.String,
			role: Schema.String,
			name: Schema.String,
			selector: Schema.String,
		})
	),
	rawTextPreview: Schema.NullOr(Schema.String),
});

export const focusAppResultSchema = Schema.Struct({
	route: Schema.NullOr(Schema.String),
	documentVisibilityState: Schema.NullOr(Schema.String),
	documentHasFocus: Schema.NullOr(Schema.Boolean),
	windowVisible: Schema.NullOr(Schema.Boolean),
	windowMinimized: Schema.NullOr(Schema.Boolean),
	windowFocused: Schema.NullOr(Schema.Boolean),
	windowOuterWidth: Schema.NullOr(Schema.Number),
	windowOuterHeight: Schema.NullOr(Schema.Number),
	windowStateError: Schema.NullOr(Schema.String),
	tauriActivateAttempted: Schema.Boolean,
	tauriActivateOk: Schema.Boolean,
	tauriActivateError: Schema.NullOr(Schema.String),
	windowFocusAttempted: Schema.Boolean,
	windowFocusOk: Schema.Boolean,
	windowFocusError: Schema.NullOr(Schema.String),
	windowRaiseAttempted: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
	windowRaiseOk: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
	windowRaiseError: Schema.NullOr(Schema.String).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	message: Schema.String,
});

export const agentPanelPerformanceSampleSchema = Schema.Struct({
	phase: Schema.String,
	durationMs: Schema.Number,
	itemCount: Schema.NullOr(Schema.Number),
	nodeCount: Schema.NullOr(Schema.Number),
	timestampMs: Schema.Number,
});

export const agentPanelPerformancePhaseSummarySchema = Schema.Struct({
	phase: Schema.String,
	count: Schema.Number,
	totalDurationMs: Schema.Number,
	averageDurationMs: Schema.Number,
	maxDurationMs: Schema.Number,
	maxItemCount: Schema.NullOr(Schema.Number),
	maxNodeCount: Schema.NullOr(Schema.Number),
});

export const frameRateProbeResultSchema = Schema.Struct({
	route: Schema.NullOr(Schema.String),
	selector: Schema.NullOr(Schema.String),
	selectorIndex: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	selectorMatchCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	selectorMatched: Schema.Boolean,
	scrolled: Schema.Boolean,
	sampleCount: Schema.Number,
	frameDeltasMs: Schema.Array(Schema.Number),
	averageFrameDeltaMs: Schema.NullOr(Schema.Number),
	minFrameDeltaMs: Schema.NullOr(Schema.Number),
	maxFrameDeltaMs: Schema.NullOr(Schema.Number),
	estimatedFps: Schema.NullOr(Schema.Number),
	jankFrameCount: Schema.Number,
	visibilityState: Schema.NullOr(Schema.String),
	documentHasFocus: Schema.NullOr(Schema.Boolean),
	requestAnimationFrameAvailable: Schema.Boolean,
	rafWaitCount: Schema.Number,
	timeoutWaitCount: Schema.Number,
	likelyThrottled: Schema.Boolean,
	rowChurnSamples: Schema.Array(
		Schema.Struct({
			frameIndex: Schema.Number,
			scrollTopPx: Schema.Number,
			domRowCount: Schema.Number,
			firstRowIndex: Schema.NullOr(Schema.Number),
			lastRowIndex: Schema.NullOr(Schema.Number),
			mountedRowCount: Schema.Number,
			unmountedRowCount: Schema.Number,
			mountedRows: Schema.Array(
				Schema.Struct({
					rowId: Schema.String,
					rowIndex: Schema.Number,
					text: Schema.String,
					visualSignature: Schema.NullOr(Schema.String).pipe(
						Schema.withDecodingDefault(Effect.succeed(null))
					),
				})
			).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
			unmountedRows: Schema.Array(
				Schema.Struct({
					rowId: Schema.String,
					rowIndex: Schema.Number,
					text: Schema.String,
					visualSignature: Schema.NullOr(Schema.String).pipe(
						Schema.withDecodingDefault(Effect.succeed(null))
					),
				})
			).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
		})
	),
	visualChangeCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	visualChanges: Schema.Array(
		Schema.Struct({
			frameIndex: Schema.Number,
			rowId: Schema.String,
			rowIndex: Schema.Number,
			previousSignature: Schema.String,
			nextSignature: Schema.String,
			text: Schema.String,
		})
	).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
	maxMountedRowCount: Schema.NullOr(Schema.Number),
	maxUnmountedRowCount: Schema.NullOr(Schema.Number),
	maxDomRowCount: Schema.NullOr(Schema.Number),
	agentPanelProfileSamples: Schema.Array(agentPanelPerformanceSampleSchema),
	agentPanelProfilePhaseSummaries: Schema.Array(agentPanelPerformancePhaseSummarySchema),
});

export const agentPanelRowScanRowSchema = Schema.Struct({
	index: Schema.Number,
	rowId: Schema.NullOr(Schema.String),
	rowIndex: Schema.NullOr(Schema.Number),
	text: Schema.String,
	heightPx: Schema.Number,
	entryType: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
	toolKind: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
	toolStatus: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
	toolTitle: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
	toolPresentationState: Schema.NullOr(Schema.String).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	missingEntry: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});

export const agentPanelRowScanResultSchema = Schema.Struct({
	route: Schema.NullOr(Schema.String),
	selector: Schema.String,
	selectorIndex: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	selectorMatchCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	selectorMatched: Schema.Boolean,
	scrollTopPx: Schema.NullOr(Schema.Number),
	scrollHeightPx: Schema.NullOr(Schema.Number),
	clientHeightPx: Schema.NullOr(Schema.Number),
	maxScrollTopPx: Schema.NullOr(Schema.Number),
	rowCount: Schema.Number,
	emptyRowCount: Schema.Number,
	exactGenericToolRowCount: Schema.Number,
	prefixGenericToolRowCount: Schema.Number,
	rawProviderToolRowCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	missingEntryRowCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	degradedToolRowCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	firstRowIndex: Schema.NullOr(Schema.Number),
	lastRowIndex: Schema.NullOr(Schema.Number),
	rows: Schema.Array(agentPanelRowScanRowSchema),
	genericToolRows: Schema.Array(agentPanelRowScanRowSchema),
	rawProviderToolRows: Schema.Array(agentPanelRowScanRowSchema).pipe(
		Schema.withDecodingDefault(Effect.succeed([]))
	),
	missingEntryRows: Schema.Array(agentPanelRowScanRowSchema).pipe(
		Schema.withDecodingDefault(Effect.succeed([]))
	),
	degradedToolRows: Schema.Array(agentPanelRowScanRowSchema).pipe(
		Schema.withDecodingDefault(Effect.succeed([]))
	),
});

export const agentPanelScrollPageProbeSampleSchema = Schema.Struct({
	stepIndex: Schema.Number,
	scrollTopPx: Schema.Number,
	scrollHeightPx: Schema.Number,
	clientHeightPx: Schema.Number,
	maxScrollTopPx: Schema.Number,
	bufferStartIndex: Schema.NullOr(Schema.Number),
	bufferEndIndex: Schema.NullOr(Schema.Number),
	bufferRowCount: Schema.NullOr(Schema.Number),
	bufferTotalRowCount: Schema.NullOr(Schema.Number),
	bufferLastAction: Schema.NullOr(Schema.String),
	bufferLastStatus: Schema.NullOr(Schema.String),
	bufferLastReason: Schema.NullOr(Schema.String),
	rowCount: Schema.Number,
	emptyRowCount: Schema.Number,
	exactGenericToolRowCount: Schema.Number,
	prefixGenericToolRowCount: Schema.Number,
	rawProviderToolRowCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	firstRowId: Schema.NullOr(Schema.String),
	lastRowId: Schema.NullOr(Schema.String),
	firstRowText: Schema.NullOr(Schema.String),
	lastRowText: Schema.NullOr(Schema.String),
});

export const agentPanelScrollPageProbeTimingSampleSchema = Schema.Struct({
	stepIndex: Schema.Number,
	frameDeltaMs: Schema.Number,
	scrollToFrameMs: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	beforeScrollTopPx: Schema.Number,
	targetScrollTopPx: Schema.Number,
	afterScrollTopPx: Schema.Number,
	beforeScrollHeightPx: Schema.Number,
	afterScrollHeightPx: Schema.Number,
	scrollHeightDeltaPx: Schema.Number,
	scrollTopCorrectionPx: Schema.Number,
	bufferStartIndex: Schema.NullOr(Schema.Number),
	bufferEndIndex: Schema.NullOr(Schema.Number),
	bufferRowCount: Schema.NullOr(Schema.Number),
	bufferTotalRowCount: Schema.NullOr(Schema.Number),
	bufferLastAction: Schema.NullOr(Schema.String),
	bufferLastStatus: Schema.NullOr(Schema.String),
	bufferLastReason: Schema.NullOr(Schema.String),
	rowCount: Schema.Number,
	firstRowId: Schema.NullOr(Schema.String),
	lastRowId: Schema.NullOr(Schema.String),
});

export const agentPanelScrollPageProbeResultSchema = Schema.Struct({
	route: Schema.NullOr(Schema.String),
	selector: Schema.String,
	selectorIndex: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	selectorMatchCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	selectorMatched: Schema.Boolean,
	scrollStepPx: Schema.Number,
	settleMs: Schema.Number,
	sampleCount: Schema.Number,
	initialScrollTopPx: Schema.NullOr(Schema.Number),
	finalScrollTopPx: Schema.NullOr(Schema.Number),
	initialScrollHeightPx: Schema.NullOr(Schema.Number),
	finalScrollHeightPx: Schema.NullOr(Schema.Number),
	clientHeightPx: Schema.NullOr(Schema.Number),
	maxScrollTopPx: Schema.NullOr(Schema.Number),
	reachedTop: Schema.Boolean,
	moved: Schema.Boolean,
	loadedMoreRows: Schema.Boolean,
	distinctRowIdCount: Schema.Number,
	distinctFirstRowIdCount: Schema.Number,
	maxSampleRowCount: Schema.Number,
	zeroRowSampleCount: Schema.Number,
	blankViewportSampleCount: Schema.Number,
	maxEmptyRowCount: Schema.Number,
	maxExactGenericToolRowCount: Schema.Number,
	maxPrefixGenericToolRowCount: Schema.Number,
	maxRawProviderToolRowCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	frameDeltasMs: Schema.Array(Schema.Number).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
	averageFrameDeltaMs: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	minFrameDeltaMs: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	maxFrameDeltaMs: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	estimatedFps: Schema.NullOr(Schema.Number).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
	missed120FrameCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	missed60FrameCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	visibilityState: Schema.NullOr(Schema.String).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	documentHasFocus: Schema.NullOr(Schema.Boolean).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	rafWaitCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	timeoutWaitCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	likelyThrottled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
	maxScrollHeightDeltaPx: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	maxScrollTopCorrectionPx: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	timingSamples: Schema.Array(agentPanelScrollPageProbeTimingSampleSchema).pipe(
		Schema.withDecodingDefault(Effect.succeed([]))
	),
	samples: Schema.Array(agentPanelScrollPageProbeSampleSchema),
});

export const screenshotResultSchema = Schema.Struct({
	path: Schema.String,
});

export const domRectSchema = Schema.Struct({
	x: Schema.Number,
	y: Schema.Number,
	width: Schema.Number,
	height: Schema.Number,
	top: Schema.Number,
	right: Schema.Number,
	bottom: Schema.Number,
	left: Schema.Number,
});

export const domElementSummarySchema = Schema.Struct({
	index: Schema.Number,
	tag: Schema.String,
	role: Schema.NullOr(Schema.String),
	name: Schema.String,
	text: Schema.String,
	value: Schema.NullOr(Schema.String),
	src: Schema.NullOr(Schema.String),
	attributes: Schema.Record(Schema.String, Schema.String),
	classes: Schema.String,
	visible: Schema.Boolean,
	focused: Schema.Boolean,
	computedStyle: Schema.Struct({
		display: Schema.String,
		opacity: Schema.optionalKey(Schema.String),
		color: Schema.String,
		backgroundColor: Schema.String,
		gap: Schema.String,
		rowGap: Schema.String,
		columnGap: Schema.String,
		paddingTop: Schema.String,
		paddingRight: Schema.String,
		paddingBottom: Schema.String,
		paddingLeft: Schema.String,
		animationName: Schema.String,
		animationDuration: Schema.String,
		animationDelay: Schema.String,
		animationIterationCount: Schema.String,
	}),
	rect: domRectSchema,
	animationNames: Schema.Array(Schema.String),
});

export const domInspectionResultSchema = Schema.Struct({
	selector: Schema.String,
	count: Schema.Number,
	elements: Schema.Array(domElementSummarySchema),
});

export const clickResultSchema = Schema.Struct({
	clicked: Schema.Boolean,
	match: Schema.NullOr(domElementSummarySchema),
});

export const panelProjectSelectionResultSchema = Schema.Struct({
	panelId: Schema.String,
	projectPath: Schema.String,
	projectName: Schema.NullOr(Schema.String),
	projectFound: Schema.Boolean,
	ambiguousName: Schema.Boolean,
	triggerFound: Schema.Boolean,
	optionFound: Schema.Boolean,
	selected: Schema.Boolean,
	selectedAriaLabel: Schema.NullOr(Schema.String),
	errorMessage: Schema.NullOr(Schema.String),
});

export const hoverResultSchema = Schema.Struct({
	hovered: Schema.Boolean,
	matchesHoverPseudoClass: Schema.Boolean,
	pointerMoved: Schema.Boolean,
	screenPoint: Schema.NullOr(
		Schema.Struct({
			x: Schema.Number,
			y: Schema.Number,
		})
	),
	match: Schema.NullOr(domElementSummarySchema),
	after: Schema.optionalKey(Schema.NullOr(domInspectionResultSchema)),
});

export const hoverTargetResultSchema = Schema.Struct({
	found: Schema.Boolean,
	marker: Schema.String,
	screenPoint: Schema.NullOr(
		Schema.Struct({
			x: Schema.Number,
			y: Schema.Number,
		})
	),
});

export const thinkingToggleProbeResultSchema = Schema.Struct({
	found: Schema.Boolean,
	clicked: Schema.Boolean,
	samples: Schema.Array(
		Schema.Struct({
			label: Schema.String,
			expandCount: Schema.Number,
			collapseCount: Schema.Number,
			contentCount: Schema.Number,
			firstButtonName: Schema.NullOr(Schema.String),
			firstContentText: Schema.NullOr(Schema.String),
		})
	),
});

export const resetOnboardingResultSchema = Schema.Struct({
	clickedDevTools: Schema.Boolean,
	clickedReset: Schema.Boolean,
	hasWelcome: Schema.Boolean,
	panelCount: Schema.Number,
	animated: Schema.Array(
		Schema.Struct({
			className: Schema.String,
			animationName: Schema.String,
		})
	),
});

export const streamingReproLabResultSchema = Schema.Struct({
	hookAvailable: Schema.Boolean,
	opened: Schema.Boolean,
	labPresent: Schema.Boolean,
	phaseLabel: Schema.NullOr(Schema.String),
	tokenRevealAnimatedCount: Schema.Number,
	tokenRevealMode: Schema.NullOr(Schema.String),
	performance: Schema.NullOr(
		Schema.Struct({
			presetId: Schema.String,
			phaseCount: Schema.Number,
			totalMs: Schema.Number,
			visibilityState: Schema.String,
			documentHasFocus: Schema.NullOr(Schema.Boolean),
			steps: Schema.Array(
				Schema.Struct({
					phaseId: Schema.String,
					label: Schema.String,
					phaseIndex: Schema.Number,
					assistantTextLength: Schema.Number,
					turnState: Schema.String,
					domFlushMs: Schema.Number,
					rowCount: Schema.Number,
					animatedTokenSpans: Schema.Number,
					tokenRevealMode: Schema.NullOr(Schema.String),
				})
			),
		})
	),
});

export const agentPanelStressPresetSchema = Schema.Literals([
	"mixed",
	"text-heavy",
	"tool-heavy",
	"streaming-tail",
]);

export const agentPanelStressRendererModeSchema = Schema.Literals([
	"full",
	"text-only",
	"shell-only",
]);

export const agentPanelStressMemoryMeasurementSchema = Schema.Struct({
	usedJSHeapSize: Schema.Number,
	totalJSHeapSize: Schema.Number,
	jsHeapSizeLimit: Schema.Number,
});

export const agentPanelStressFrameEnvironmentSchema = Schema.Struct({
	visibilityState: Schema.String,
	documentHasFocus: Schema.NullOr(Schema.Boolean),
	requestAnimationFrameAvailable: Schema.Boolean,
	longAnimationFrameObserverAvailable: Schema.Boolean.pipe(
		Schema.withDecodingDefault(Effect.succeed(false))
	),
	rafWaitCount: Schema.Number,
	timeoutWaitCount: Schema.Number,
});

export const agentPanelStressScrollUpdateMeasurementSchema = Schema.Struct({
	scrollTopPx: Schema.Number,
	updateMs: Schema.Number,
	domRowCount: Schema.Number,
	firstRowIndex: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	lastRowIndex: Schema.NullOr(Schema.Number).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
	mountedRowCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	unmountedRowCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	profileSampleCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	profileDurationMs: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	profileMaxDurationMs: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	profileSlowestPhase: Schema.NullOr(Schema.String).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
});

export const agentPanelStressFrameAttributionCauseSchema = Schema.Literals([
	"within-120hz-budget",
	"js-profile-work",
	"dom-window-churn",
	"probe-overhead",
	"browser-layout-paint-suspected",
]);

export const agentPanelStressFrameAttributionSchema = Schema.Struct({
	frameIndex: Schema.Number,
	targetScrollTopPx: Schema.Number,
	frameDeltaMs: Schema.Number,
	frameBudgetOverrunMs: Schema.Number,
	scrollSetMs: Schema.Number,
	afterFrameInspectionMs: Schema.Number,
	browserRenderMs: Schema.Number,
	previousBrowserRenderMs: Schema.Number,
	preFrameGapMs: Schema.Number,
	domRowCount: Schema.Number,
	firstRowIndex: Schema.NullOr(Schema.Number),
	lastRowIndex: Schema.NullOr(Schema.Number),
	mountedRowCount: Schema.Number,
	unmountedRowCount: Schema.Number,
	coldRevealedRowCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	staticEstimateRowCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	measuredEstimateRowCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	maxStaticEstimateErrorPx: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	averageStaticEstimateErrorPx: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	profileSampleCount: Schema.Number,
	profileDurationMs: Schema.Number,
	profileMaxDurationMs: Schema.NullOr(Schema.Number),
	profileSlowestPhase: Schema.NullOr(Schema.String),
	cause: agentPanelStressFrameAttributionCauseSchema,
});

export const agentPanelStressMetricsSchema = Schema.Struct({
	generationMs: Schema.NullOr(Schema.Number),
	renderSettleMs: Schema.NullOr(Schema.Number),
	domRowCount: Schema.Number,
	scrollToTopMs: Schema.NullOr(Schema.Number),
	scrollToBottomMs: Schema.NullOr(Schema.Number),
	scrollUpdateMeasurements: Schema.Array(agentPanelStressScrollUpdateMeasurementSchema),
	frameDeltasMs: Schema.Array(Schema.Number),
	frameAttributions: Schema.Array(agentPanelStressFrameAttributionSchema).pipe(
		Schema.withDecodingDefault(Effect.succeed([]))
	),
	frameEnvironment: Schema.NullOr(agentPanelStressFrameEnvironmentSchema),
	memory: Schema.NullOr(agentPanelStressMemoryMeasurementSchema),
});

export const agentPanelStressSummarySchema = Schema.Struct({
	generationMsLabel: Schema.String,
	renderSettleMsLabel: Schema.String,
	domRowCount: Schema.Number,
	scrollToTopMsLabel: Schema.String,
	scrollToBottomMsLabel: Schema.String,
	scrollUpdateSampleCount: Schema.Number,
	averageScrollUpdateMs: Schema.NullOr(Schema.Number),
	maxScrollUpdateMs: Schema.NullOr(Schema.Number),
	maxScrollUpdateDomRowCount: Schema.NullOr(Schema.Number),
	maxScrollUpdateMountedRowCount: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	maxScrollUpdateUnmountedRowCount: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	maxScrollUpdateProfileDurationMs: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	maxScrollUpdateProfileSlowestPhase: Schema.NullOr(Schema.String).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	frameSampleCount: Schema.Number,
	jankFrameCount: Schema.Number,
	averageFrameDeltaMs: Schema.NullOr(Schema.Number),
	maxFrameDeltaMs: Schema.NullOr(Schema.Number),
	estimatedFps: Schema.NullOr(Schema.Number),
	targetFrameBudgetMs: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(8.33))),
	missed120HzFrameCount: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
	maxFrameBudgetOverrunMs: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameIndex: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameDeltaMs: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameCause: Schema.NullOr(agentPanelStressFrameAttributionCauseSchema).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameProfileDurationMs: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameBrowserRenderMs: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFramePreviousBrowserRenderMs: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFramePreFrameGapMs: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameMountedRowCount: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameUnmountedRowCount: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameColdRevealedRowCount: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameStaticEstimateRowCount: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameMeasuredEstimateRowCount: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameMaxStaticEstimateErrorPx: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameAverageStaticEstimateErrorPx: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	slowestFrameDomRowCount: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	maxFrameColdRevealedRowCount: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	maxFrameStaticEstimateErrorPx: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	frameSamplingLikelyThrottled: Schema.Boolean,
	frameEnvironmentLabel: Schema.String,
	memoryLabel: Schema.String,
});

export const agentPanelStressProfilePhaseSummarySchema = Schema.Struct({
	phase: Schema.String,
	count: Schema.Number,
	totalDurationMs: Schema.Number,
	maxDurationMs: Schema.Number,
	averageDurationMs: Schema.Number,
	maxItemCount: Schema.NullOr(Schema.Number),
	maxNodeCount: Schema.NullOr(Schema.Number),
});

export const agentPanelStressProfileSummarySchema = Schema.Struct({
	sampleCount: Schema.Number,
	totalDurationMs: Schema.Number,
	phases: Schema.Array(agentPanelStressProfilePhaseSummarySchema),
});

export const agentPanelStressDumpSchema = Schema.Struct({
	route: Schema.String,
	preset: agentPanelStressPresetSchema,
	rendererMode: agentPanelStressRendererModeSchema.pipe(
		Schema.withDecodingDefault(Effect.succeed("full"))
	),
	rowCount: Schema.Number,
	seed: Schema.Number,
	timestampIso: Schema.String,
	metrics: agentPanelStressMetricsSchema,
	summary: agentPanelStressSummarySchema,
	profileSamples: Schema.Array(agentPanelPerformanceSampleSchema),
	profileSummary: agentPanelStressProfileSummarySchema,
});

export const agentPanelStressLabResultSchema = Schema.Struct({
	hookAvailable: Schema.Boolean,
	opened: Schema.Boolean,
	labPresent: Schema.Boolean,
	route: Schema.NullOr(Schema.String),
	preset: Schema.NullOr(agentPanelStressPresetSchema),
	rendererMode: Schema.NullOr(agentPanelStressRendererModeSchema).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	rowCount: Schema.NullOr(Schema.Number),
	seed: Schema.NullOr(Schema.Number),
	renderSettleMs: Schema.NullOr(Schema.Number),
	domRowCount: Schema.NullOr(Schema.Number),
	scrollToTopMs: Schema.NullOr(Schema.Number),
	scrollToBottomMs: Schema.NullOr(Schema.Number),
	frameSampleCount: Schema.Number,
	jankFrameCount: Schema.Number,
	averageFrameDeltaMs: Schema.NullOr(Schema.Number),
	maxFrameDeltaMs: Schema.NullOr(Schema.Number),
	estimatedFps: Schema.NullOr(Schema.Number),
	frameSamplingLikelyThrottled: Schema.NullOr(Schema.Boolean),
	frameEnvironmentLabel: Schema.NullOr(Schema.String),
	memoryLabel: Schema.NullOr(Schema.String),
	dump: Schema.NullOr(agentPanelStressDumpSchema),
});

export const agentPanelStressLabRunStatusSchema = Schema.Struct({
	runId: Schema.NullOr(Schema.String),
	status: Schema.Literals(["missing", "running", "done", "error"]),
	message: Schema.NullOr(Schema.String),
	result: Schema.NullOr(agentPanelStressLabResultSchema),
});

export const sendAttachStressSampleSchema = Schema.Struct({
	label: Schema.String,
	rowCount: Schema.Number,
	stableRowId: Schema.String,
	stableRowVersion: Schema.NullOr(Schema.String),
	stableRowContent: Schema.NullOr(Schema.String),
	stableRowShellPreserved: Schema.NullOr(Schema.Boolean),
	scrollHeightPx: Schema.Number,
	clientHeightPx: Schema.Number,
	maxScrollTopPx: Schema.Number,
	scrollTopPx: Schema.Number,
	distFromBottomPx: Schema.Number,
	geometryReleased: Schema.Boolean,
	controllerReleased: Schema.Boolean,
	longMarkdownRowId: Schema.String,
	longMarkdownHeightPx: Schema.Number,
	longMarkdownNative: Schema.Boolean,
	placeholderCount: Schema.Number,
	spacerCount: Schema.Number,
});

export const sendAttachStressProbeResultSchema = Schema.Struct({
	hookAvailable: Schema.Boolean,
	opened: Schema.Boolean,
	labPresent: Schema.Boolean,
	route: Schema.String,
	requestedRowCount: Schema.Number,
	rowCount: Schema.Number,
	requestedPreScrollOffsetPx: Schema.Number,
	preconditionPassed: Schema.Boolean,
	passed: Schema.Boolean,
	maxExtentCollapsePx: Schema.Number,
	nativeClampDetected: Schema.Boolean,
	stableRowShellPreserved: Schema.Boolean,
	samples: Schema.Array(sendAttachStressSampleSchema),
});

export const planningBetweenToolsSampleSchema = Schema.Struct({
	stage: Schema.Literals(["completed_tool_tail", "active_assistant_tail"]),
	sessionId: Schema.String,
	lifecycleStatus: Schema.Literal("ready"),
	activityKind: Schema.Literal("awaiting_model"),
	turnState: Schema.Literal("Running"),
	trailingRowId: Schema.NullOr(Schema.String),
	trailingRowKind: Schema.NullOr(Schema.String),
	trailingOperationStates: Schema.Array(Schema.String),
	activeStreamingTail: Schema.NullOr(Schema.String),
	localPlaceholderMode: Schema.Literals(["none", "connection", "planning"]),
	planningRowCount: Schema.Number,
	planningText: Schema.NullOr(Schema.String),
	planningVisible: Schema.Boolean,
});

export const planningBetweenToolsProbeResultSchema = Schema.Struct({
	hookAvailable: Schema.Boolean,
	opened: Schema.Boolean,
	labPresent: Schema.Boolean,
	route: Schema.String,
	passed: Schema.Boolean,
	restoredCompletedToolStage: Schema.Boolean,
	samples: Schema.Array(planningBetweenToolsSampleSchema),
});

export const startupPerformanceTraceEntrySchema = Schema.Struct({
	name: Schema.String,
	startedAtMs: Schema.Number,
	completedAtMs: Schema.NullOr(Schema.Number),
	durationMs: Schema.NullOr(Schema.Number),
	status: Schema.Literals(["pending", "ok", "error"]),
	errorMessage: Schema.NullOr(Schema.String),
});

export const panelClosePerformanceTraceSchema = Schema.Struct({
	panelId: Schema.String,
	kind: Schema.String,
	captureStateMs: Schema.Number,
	suppressionMs: Schema.Number,
	clearOpeningSessionMs: Schema.Number,
	removePanelMs: Schema.Number,
	hotStateCleanupMs: Schema.Number,
	fileOwnershipCleanupMs: Schema.Number,
	embeddedTerminalCleanupMs: Schema.Number,
	focusStateApplyMs: Schema.Number,
	persistMs: Schema.Number,
	totalMs: Schema.Number,
});

export const projectLoadPerformanceTraceSchema = Schema.Struct({
	totalMs: Schema.Number,
	getProjectCountMs: Schema.Number,
	getProjectsMs: Schema.Number,
	assignStateMs: Schema.Number,
	projectCount: Schema.Number,
});

export const tauriInvokeTimingRecordSchema = Schema.Struct({
	id: Schema.String,
	command: Schema.String,
	argsSummary: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
	startedAtMs: Schema.Number,
	completedAtMs: Schema.Number,
	durationMs: Schema.Number,
	status: Schema.Literals(["ok", "error"]),
});

export const tauriPendingInvokeRecordSchema = Schema.Struct({
	id: Schema.String,
	command: Schema.String,
	argsSummary: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
	startedAtMs: Schema.Number,
	elapsedMs: Schema.Number,
});

export const happyPathPerformanceResultSchema = Schema.Struct({
	hookAvailable: Schema.Boolean,
	route: Schema.String,
	runtimeErrors: Schema.Array(Schema.String),
	timingEnvironment: Schema.Struct({
		visibilityState: Schema.String,
		documentHasFocus: Schema.NullOr(Schema.Boolean),
		requestAnimationFrameAvailable: Schema.Boolean,
		frameWaitCount: Schema.Number,
		frameFallbackCount: Schema.Number,
		likelyThrottled: Schema.Boolean,
		label: Schema.String,
	}).pipe(
		Schema.withDecodingDefault(
			Effect.succeed({
				visibilityState: "unknown",
				documentHasFocus: null,
				requestAnimationFrameAvailable: false,
				frameWaitCount: 0,
				frameFallbackCount: 0,
				likelyThrottled: true,
				label: "unavailable",
			})
		)
	),
	navigation: Schema.Struct({
		type: Schema.NullOr(Schema.String),
		startTimeMs: Schema.NullOr(Schema.Number),
		domInteractiveMs: Schema.NullOr(Schema.Number),
		domContentLoadedMs: Schema.NullOr(Schema.Number),
		loadEventEndMs: Schema.NullOr(Schema.Number),
		durationMs: Schema.NullOr(Schema.Number),
	}),
	app: Schema.Struct({
		mountStartedAtMs: Schema.NullOr(Schema.Number),
		shellReadyAtMs: Schema.NullOr(Schema.Number),
		shellReadyDurationMs: Schema.NullOr(Schema.Number),
		shellReady: Schema.Boolean,
		shellReadyWaitMs: Schema.NullOr(Schema.Number),
		initializationCompleteAtMs: Schema.NullOr(Schema.Number),
		initializationDurationMs: Schema.NullOr(Schema.Number),
		initializationComplete: Schema.Boolean,
		initializationWaitMs: Schema.NullOr(Schema.Number),
		projectReady: Schema.Boolean,
		projectReadyWaitMs: Schema.NullOr(Schema.Number),
		projectCountAtPanelCreate: Schema.Number,
		startupTrace: Schema.Array(startupPerformanceTraceEntrySchema),
		projectLoadTrace: Schema.NullOr(projectLoadPerformanceTraceSchema),
		tauriInvokeTimings: Schema.Array(tauriInvokeTimingRecordSchema),
		panelCountBefore: Schema.Number,
		panelCountAfter: Schema.Number,
		domPanelCountBefore: Schema.Number,
		domPanelCountAfter: Schema.Number,
	}),
	openClose: Schema.Struct({
		panelId: Schema.String,
		projectPath: Schema.NullOr(Schema.String),
		panelOpenMarks: Schema.Record(Schema.String, Schema.Number),
		panelFirstMarkMs: Schema.NullOr(Schema.Number).pipe(
			Schema.withDecodingDefault(Effect.succeed(null))
		),
		panelLastMarkMs: Schema.NullOr(Schema.Number).pipe(
			Schema.withDecodingDefault(Effect.succeed(null))
		),
		panelMarkedWorkMs: Schema.NullOr(Schema.Number).pipe(
			Schema.withDecodingDefault(Effect.succeed(null))
		),
		panelPreMarkDelayMs: Schema.NullOr(Schema.Number).pipe(
			Schema.withDecodingDefault(Effect.succeed(null))
		),
		panelDomReadyAfterLastMarkMs: Schema.NullOr(Schema.Number).pipe(
			Schema.withDecodingDefault(Effect.succeed(null))
		),
		composerReadyAfterLastMarkMs: Schema.NullOr(Schema.Number).pipe(
			Schema.withDecodingDefault(Effect.succeed(null))
		),
		panelCreateMs: Schema.Number,
		panelDomPresentAfterCreate: Schema.Boolean,
		panelDomMutationMs: Schema.NullOr(Schema.Number),
		panelDomAfterDomFlushMs: Schema.NullOr(Schema.Number),
		panelDomAfterFirstFrameMs: Schema.NullOr(Schema.Number),
		panelDomReadyMs: Schema.NullOr(Schema.Number),
		composerMutationMs: Schema.NullOr(Schema.Number),
		composerReadyMs: Schema.NullOr(Schema.Number),
		composerReadyAfterCreateMs: Schema.NullOr(Schema.Number),
		panelDomNodeCount: Schema.Number,
		panelRowNodeCount: Schema.Number,
		panelDropdownContentNodeCount: Schema.Number,
		resizeObserverConstructCount: Schema.NullOr(Schema.Number),
		resizeObserverObserveCount: Schema.NullOr(Schema.Number),
		resizeObserverCallbackCount: Schema.NullOr(Schema.Number),
		closeCallReturnMs: Schema.Number,
		closeMicrotaskMs: Schema.Number,
		closeDomGoneAfterMicrotask: Schema.Boolean,
		closeFirstFrameMs: Schema.NullOr(Schema.Number),
		closeDomGoneAfterFirstFrame: Schema.Boolean,
		closeDomGoneMs: Schema.NullOr(Schema.Number),
		closeTrace: Schema.NullOr(panelClosePerformanceTraceSchema),
		totalMs: Schema.Number,
	}),
});

export const sendComposerResultSchema = Schema.Struct({
	composerFound: Schema.Boolean,
	textApplied: Schema.String,
	sendReady: Schema.Boolean,
	sent: Schema.Boolean,
});

export const composerEnterSubmitProbeResultSchema = Schema.Struct({
	targetFound: Schema.Boolean,
	composerFound: Schema.Boolean,
	textApplied: Schema.String,
	sendReadyBeforeEnter: Schema.Boolean,
	enterDefaultPrevented: Schema.Boolean,
	newlineWouldBeInserted: Schema.Boolean,
	draftAfterEnter: Schema.String,
	submittedUserRowFound: Schema.Boolean,
	planningBefore: Schema.suspend(() => Schema.NullOr(planningDebugSnapshotSchema)),
	planningAfter: Schema.suspend(() => Schema.NullOr(planningDebugSnapshotSchema)),
});

export const navigateResultSchema = Schema.Struct({
	from: Schema.String,
	to: Schema.String,
	path: Schema.String,
});

export const watchResultSchema = Schema.Struct({
	text: Schema.String,
	presentInDom: Schema.Boolean,
	visible: Schema.Boolean,
	firstVisibleAtMs: Schema.NullOr(Schema.Number),
	elapsedMs: Schema.Number,
	timedOut: Schema.Boolean,
	matched: Schema.NullOr(
		Schema.Struct({
			rect: domRectSchema,
			display: Schema.String,
			visibility: Schema.String,
			opacity: Schema.String,
			hasOffsetParent: Schema.Boolean,
		})
	),
});

export const resizeProbeSampleSchema = Schema.Struct({
	step: Schema.Number,
	elapsedMs: Schema.Number,
	targetDelta: Schema.Number,
	expectedWidth: Schema.Number,
	immediateWidth: Schema.Number,
	microtaskWidth: Schema.Number,
	frameWidth: Schema.Number,
	dispatchMs: Schema.Number,
	frameDelayMs: Schema.Number,
});

export const resizeProbeResultSchema = Schema.Struct({
	found: Schema.Boolean,
	edgeRect: Schema.NullOr(domRectSchema),
	panelRectBefore: Schema.NullOr(domRectSchema),
	panelRectAfter: Schema.NullOr(domRectSchema),
	requestedDelta: Schema.Number,
	steps: Schema.Number,
	stepDelayMs: Schema.Number,
	originalWidth: Schema.NullOr(Schema.Number),
	finalWidthBeforeRestore: Schema.NullOr(Schema.Number),
	restoredWidth: Schema.NullOr(Schema.Number),
	observedDeltaBeforeRestore: Schema.NullOr(Schema.Number),
	finalLagPx: Schema.NullOr(Schema.Number),
	maxImmediateLagPx: Schema.NullOr(Schema.Number),
	maxFrameLagPx: Schema.NullOr(Schema.Number),
	avgFrameDelayMs: Schema.NullOr(Schema.Number),
	maxFrameDelayMs: Schema.NullOr(Schema.Number),
	transitionProperty: Schema.NullOr(Schema.String),
	transitionDuration: Schema.NullOr(Schema.String),
	samples: Schema.Array(resizeProbeSampleSchema),
});

export const resizeStreamProbeSampleSchema = Schema.Struct({
	elapsedMs: Schema.Number,
	expectedWidth: Schema.Number,
	width: Schema.Number,
	lagPx: Schema.Number,
});

export const resizeStreamProbeResultSchema = Schema.Struct({
	found: Schema.Boolean,
	edgeRect: Schema.NullOr(domRectSchema),
	panelRectBefore: Schema.NullOr(domRectSchema),
	panelRectAfter: Schema.NullOr(domRectSchema),
	requestedDelta: Schema.Number,
	durationMs: Schema.Number,
	moveIntervalMs: Schema.Number,
	originalWidth: Schema.NullOr(Schema.Number),
	finalWidthBeforeRestore: Schema.NullOr(Schema.Number),
	restoredWidth: Schema.NullOr(Schema.Number),
	moveCount: Schema.Number,
	frameCount: Schema.Number,
	maxLagPx: Schema.NullOr(Schema.Number),
	avgLagPx: Schema.NullOr(Schema.Number),
	maxFrameIntervalMs: Schema.NullOr(Schema.Number),
	avgFrameIntervalMs: Schema.NullOr(Schema.Number),
	framesOver50Ms: Schema.Number,
	transitionProperty: Schema.NullOr(Schema.String),
	transitionDuration: Schema.NullOr(Schema.String),
	samples: Schema.Array(resizeStreamProbeSampleSchema),
});

export const firstSendTimelineSampleSchema = Schema.Struct({
	label: Schema.String,
	elapsedMs: Schema.Number,
	composerText: Schema.String,
	composerContainsPrompt: Schema.Boolean,
	messageVisible: Schema.Boolean,
	messageVisibleInTranscript: Schema.Boolean,
	sentRowVisibleInViewport: Schema.Boolean,
	planningVisible: Schema.Boolean,
	readyVisible: Schema.Boolean,
	matchingTextLeafCount: Schema.Number,
	matchingTranscriptViewportCount: Schema.Number,
	transcriptViewportCount: Schema.Number,
	maxOnscreenRowHeightPx: Schema.Number,
	placeholderHeightPx: Schema.NullOr(Schema.Number),
	placeholderText: Schema.optionalKey(Schema.NullOr(Schema.String)),
	panelId: Schema.NullOr(Schema.String),
	sessionId: Schema.NullOr(Schema.String),
	planningSourceKind: Schema.optionalKey(Schema.NullOr(Schema.String)),
	planningLifecycleStatus: Schema.optionalKey(Schema.NullOr(Schema.String)),
	planningHasLocalPendingSendIntent: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	planningHasTrailingCompletedTool: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	planningLocalPlaceholderMode: Schema.optionalKey(
		Schema.NullOr(Schema.Literals(["none", "connection", "planning"]))
	),
	scrollTopPx: Schema.Number,
	maxScrollTopPx: Schema.Number,
	scrollAttached: Schema.Boolean,
	scrollReleased: Schema.Boolean,
	distFromBottomPx: Schema.Number,
	bodyPreview: Schema.String,
});

export const firstSendScrollTopWriteSchema = Schema.Struct({
	elapsedMs: Schema.Number,
	requestedScrollTopPx: Schema.Number,
	beforeScrollTopPx: Schema.Number,
	afterScrollTopPx: Schema.Number,
	scrollHeightPx: Schema.Number,
	clientHeightPx: Schema.Number,
	maxScrollTopPx: Schema.Number,
	distFromBottomPx: Schema.Number,
	stack: Schema.String,
});

export const firstSendScrollEventSchema = Schema.Struct({
	elapsedMs: Schema.Number,
	isTrusted: Schema.NullOr(Schema.Boolean),
	scrollTopPx: Schema.Number,
	previousScrollTopPx: Schema.Number,
	deltaScrollTopPx: Schema.Number,
	scrollHeightPx: Schema.Number,
	clientHeightPx: Schema.Number,
	maxScrollTopPx: Schema.Number,
	distFromBottomPx: Schema.Number,
	nearestSetterAtMs: Schema.NullOr(Schema.Number),
	nearestSetterDeltaMs: Schema.NullOr(Schema.Number),
	nearestSetterMovedScrollTop: Schema.NullOr(Schema.Boolean),
	nearestSetterResultMatchesEvent: Schema.NullOr(Schema.Boolean),
	nearestInputIntentKind: Schema.NullOr(Schema.String),
	nearestInputIntentAtMs: Schema.NullOr(Schema.Number),
	nearestInputIntentDeltaMs: Schema.NullOr(Schema.Number),
	provenance: Schema.Literals([
		"setter",
		"input-intent",
		"native-layout-or-anchoring",
		"synthetic-or-unknown",
	]),
});

export const firstSendScrollProvenanceSchema = Schema.Struct({
	installed: Schema.Boolean,
	restored: Schema.Boolean,
	writes: Schema.Array(firstSendScrollTopWriteSchema),
	events: Schema.Array(firstSendScrollEventSchema),
});

export const firstSendPreScrollSchema = Schema.Struct({
	requestedOffsetPx: Schema.NullOr(Schema.Number),
	attempted: Schema.Boolean,
	passed: Schema.Boolean,
	tolerancePx: Schema.Number,
	scrollTopPx: Schema.NullOr(Schema.Number),
	maxScrollTopPx: Schema.NullOr(Schema.Number),
	distFromBottomPx: Schema.NullOr(Schema.Number),
});

export const firstSendTimelineProbeResultSchema = Schema.Struct({
	composerFound: Schema.Boolean,
	selectedComposerIndex: Schema.NullOr(Schema.Number),
	selectedComposerName: Schema.NullOr(Schema.String),
	sendFound: Schema.Boolean,
	sendReadyBeforeClick: Schema.Boolean,
	sent: Schema.Boolean,
	prompt: Schema.String,
	samples: Schema.Array(firstSendTimelineSampleSchema),
	preScroll: firstSendPreScrollSchema,
	scrollProvenance: firstSendScrollProvenanceSchema,
});

export const openPersistedSessionDiagnosticEventSchema = Schema.Struct({
	stage: Schema.Literals([
		"started",
		"skipped-duplicate",
		"stale-panel",
		"missing-metadata",
		"request-started",
		"result-preparing",
		"result-missing",
		"result-error",
		"result-found",
		"hydrated",
		"request-failed",
		"timed-out",
		"finished",
	]),
	source: Schema.Literals(["initialization-manager", "session-handler"]),
	panelId: Schema.String,
	sessionId: Schema.String,
	elapsedMs: Schema.Number,
	canonicalSessionId: Schema.NullOr(Schema.String),
	outcome: Schema.NullOr(Schema.String),
	message: Schema.NullOr(Schema.String),
	hasSessionIdentity: Schema.NullOr(Schema.Boolean),
	hasSessionMetadata: Schema.NullOr(Schema.Boolean),
	shouldAttemptLocalReattach: Schema.NullOr(Schema.Boolean),
	hasInitialViewportEnvelope: Schema.NullOr(Schema.Boolean).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	initialRowPageRowCount: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	initialRowPageTotalRowCount: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	initialRowPageStartRowIndex: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	initialRowPagePayloadBytes: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	openResultTiming: Schema.NullOr(
		Schema.Struct({
			source: Schema.String,
			openPath: Schema.NullOr(
				Schema.Literals(["hot_ledger", "legacy_rebuild", "compat_snapshot", "fold_history"])
			).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
			ledgerProbeStatus: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("unknown"))),
			contextMs: Schema.Number,
			providerLoadMs: Schema.Number,
			ledgerTailReadMs: Schema.NullOr(Schema.Number).pipe(
				Schema.withDecodingDefault(Effect.succeed(null))
			),
			ledgerProjectionFrontierMs: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
			ledgerPageReadMs: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
			ledgerHeaderDecodeMs: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
			ledgerRowsDecodeMs: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
			ledgerResultBuildMs: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
			runtimeLookupMs: Schema.Number,
			assembleMs: Schema.Number,
			restoreAuthorityMs: Schema.Number,
			compactMs: Schema.Number,
			localJournalFallbackMs: Schema.Number,
			totalMs: Schema.Number,
			transcriptEntryCount: Schema.Number,
			operationCount: Schema.Number,
		})
	).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});

export const sessionOpenHydrationTimingRecordSchema = Schema.Struct({
	panelId: Schema.String,
	requestedSessionId: Schema.String,
	canonicalSessionId: Schema.String,
	applied: Schema.Boolean,
	skippedReason: Schema.NullOr(Schema.Literals(["stale_request", "older_revision"])),
	totalMs: Schema.Number,
	materializeSnapshotMs: Schema.Number,
	replaceOpenSnapshotMs: Schema.Number,
	replaceStateGraphMs: Schema.Number,
	applyViewportEnvelopeMs: Schema.Number,
	applyInitialRowPageMs: Schema.Number,
	ensureRowsBootstrapMs: Schema.Number,
	updatePanelSessionMs: Schema.Number,
	initialRowPageRowCount: Schema.NullOr(Schema.Number),
	totalRowCount: Schema.NullOr(Schema.Number),
	rowPayloadBytes: Schema.NullOr(Schema.Number),
});

export const sessionOpenContentProbeResultSchema = Schema.Struct({
	hookAvailable: Schema.Boolean,
	sessionId: Schema.String,
	panelId: Schema.NullOr(Schema.String),
	documentVisibilityAtStart: Schema.String.pipe(
		Schema.withDecodingDefault(Effect.succeed("unknown"))
	),
	documentVisibilityAtEnd: Schema.String.pipe(
		Schema.withDecodingDefault(Effect.succeed("unknown"))
	),
	documentHasFocusAtStart: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
	documentHasFocusAtEnd: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
	foregroundFrameTimingValid: Schema.Boolean.pipe(
		Schema.withDecodingDefault(Effect.succeed(false))
	),
	sessionKnownBeforeOpen: Schema.Boolean,
	placeholderRegistered: Schema.Boolean,
	closedExistingPanel: Schema.Boolean,
	closeAfterRequested: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
	selectCallMs: Schema.NullOr(Schema.Number),
	panelDomReadyMs: Schema.NullOr(Schema.Number),
	transcriptViewportReadyMs: Schema.NullOr(Schema.Number),
	firstRowDomReadyMs: Schema.NullOr(Schema.Number),
	firstRowPaintMs: Schema.NullOr(Schema.Number),
	rowCountAtFirstPaint: Schema.Number,
	finalRowCount: Schema.Number,
	panelStillOpenAtEnd: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
	panelDomPresentAtEnd: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
	sessionKnownAtEnd: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
	sessionHasCanonicalProjectionAtEnd: Schema.Boolean.pipe(
		Schema.withDecodingDefault(Effect.succeed(false))
	),
	sessionCanSendAtEnd: Schema.NullOr(Schema.Boolean).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	sessionLifecycleStatusAtEnd: Schema.NullOr(Schema.String).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	sessionMessageCountAtEnd: Schema.NullOr(Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed(null))
	),
	timedOut: Schema.Boolean,
	errorMessage: Schema.NullOr(Schema.String),
	runtimeErrors: Schema.Array(Schema.String),
	tauriInvokeTimings: Schema.Array(tauriInvokeTimingRecordSchema),
	pendingTauriInvokes: Schema.Array(tauriPendingInvokeRecordSchema).pipe(
		Schema.withDecodingDefault(Effect.succeed([]))
	),
	openEvents: Schema.Array(openPersistedSessionDiagnosticEventSchema).pipe(
		Schema.withDecodingDefault(Effect.succeed([]))
	),
	hydrationTimings: Schema.Array(sessionOpenHydrationTimingRecordSchema).pipe(
		Schema.withDecodingDefault(Effect.succeed([]))
	),
	panelOpenMarks: Schema.Record(Schema.String, Schema.Number).pipe(
		Schema.withDecodingDefault(Effect.succeed({}))
	),
	agentPanelPerformanceSamples: Schema.Array(agentPanelPerformanceSampleSchema).pipe(
		Schema.withDecodingDefault(Effect.succeed([]))
	),
});

export const sessionOpenContentProbeRunStatusSchema = Schema.Struct({
	runId: Schema.String,
	status: Schema.Literals(["missing", "running", "done"]),
	result: Schema.NullOr(sessionOpenContentProbeResultSchema),
});

export const planningDebugSnapshotSchema = Schema.Struct({
	sessionId: Schema.NullOr(Schema.String),
	sourceKind: Schema.NullOr(Schema.String),
	lifecycleStatus: Schema.NullOr(Schema.String),
	activityKind: Schema.NullOr(Schema.String),
	turnState: Schema.NullOr(Schema.String),
	hasOptimisticPendingEntry: Schema.Boolean,
	hasLocalPendingSendIntent: Schema.Boolean,
	pendingSendIntentAttemptId: Schema.NullOr(Schema.String),
	hasMessages: Schema.Boolean,
	visibleEntryCount: Schema.Number,
	hasTrailingCompletedTool: Schema.Boolean,
	localPlaceholderMode: Schema.Literals(["none", "connection", "planning"]),
	actionabilityCanSend: Schema.NullOr(Schema.Boolean),
	sessionCanSubmit: Schema.Boolean,
	disableSendForFailedFirstSend: Schema.Boolean,
	capturedAtMs: Schema.Number,
});

export const planningDebugResultSchema = Schema.Struct({
	available: Schema.Boolean,
	snapshots: Schema.Array(planningDebugSnapshotSchema),
});

export const computerUseProbeResultSchema = Schema.Struct({
	serverName: Schema.String,
	toolName: Schema.String,
	sessionId: Schema.String,
	transport: Schema.String,
	ok: Schema.Boolean,
	isError: Schema.Boolean,
	payloadJson: Schema.String,
	app: Schema.NullOr(Schema.String),
	window: Schema.NullOr(Schema.String),
	elementCount: Schema.Number,
	errorCode: Schema.NullOr(Schema.String),
	permissionKind: Schema.NullOr(Schema.String),
	actionVerb: Schema.NullOr(Schema.String),
	actionTargetLabel: Schema.NullOr(Schema.String),
	actionTargetId: Schema.NullOr(Schema.String),
	actionOk: Schema.NullOr(Schema.Boolean),
	actionErrorCode: Schema.NullOr(Schema.String),
	actionChangedCount: Schema.NullOr(Schema.Number),
	actionElementCount: Schema.NullOr(Schema.Number),
});

export const ledgerBackfillProbeResultSchema = Schema.Struct({
	requestedLimit: Schema.Number,
	candidateCount: Schema.Number,
	checkedCount: Schema.Number,
	rebuiltCount: Schema.Number,
	rebuiltFromProviderCount: Schema.Number,
	skippedCurrentCount: Schema.Number,
	skippedNoJournalCount: Schema.Number,
	skippedMissingFactsCount: Schema.Number,
	failedCount: Schema.Number,
	failedSessionIds: Schema.Array(Schema.String),
});

export type SendComposerResult = typeof sendComposerResultSchema.Type;
export type ComposerEnterSubmitProbeResult = typeof composerEnterSubmitProbeResultSchema.Type;
export type PlanningDebugResult = typeof planningDebugResultSchema.Type;
export type ComputerUseProbeResult = typeof computerUseProbeResultSchema.Type;
export type LedgerBackfillProbeResult = typeof ledgerBackfillProbeResultSchema.Type;
export type NavigateResult = typeof navigateResultSchema.Type;
export type WatchResult = typeof watchResultSchema.Type;
export type ResizeProbeResult = typeof resizeProbeResultSchema.Type;
export type ResizeStreamProbeResult = typeof resizeStreamProbeResultSchema.Type;
export type FirstSendTimelineProbeResult = typeof firstSendTimelineProbeResultSchema.Type;
export type SessionOpenContentProbeResult = typeof sessionOpenContentProbeResultSchema.Type;
export type SessionOpenContentProbeRunStatus = typeof sessionOpenContentProbeRunStatusSchema.Type;
export type FocusAppResult = typeof focusAppResultSchema.Type;
export type FrameRateProbeResult = typeof frameRateProbeResultSchema.Type;
export type AgentPanelRowScanResult = typeof agentPanelRowScanResultSchema.Type;
export type AgentPanelScrollPageProbeResult = typeof agentPanelScrollPageProbeResultSchema.Type;
export type QaStatus = typeof qaStatusSchema.Type;
export type QaCommandResult = typeof qaCommandResultSchema.Type;
export type QaError = typeof qaErrorSchema.Type;
export type TargetProcess = typeof targetProcessSchema.Type;
export type TargetDoctorResult = typeof targetDoctorResultSchema.Type;
export type ObserveLevel = typeof observeLevelSchema.Type;
export type AppObservation = typeof appObservationSchema.Type;
export type ScreenshotResult = typeof screenshotResultSchema.Type;
export type DomInspectionResult = typeof domInspectionResultSchema.Type;
export type ClickResult = typeof clickResultSchema.Type;
export type PanelProjectSelectionResult = typeof panelProjectSelectionResultSchema.Type;
export type HoverResult = typeof hoverResultSchema.Type;
export type ThinkingToggleProbeResult = typeof thinkingToggleProbeResultSchema.Type;
export type ResetOnboardingResult = typeof resetOnboardingResultSchema.Type;
export type StreamingReproLabResult = typeof streamingReproLabResultSchema.Type;
export type AgentPanelStressLabResult = typeof agentPanelStressLabResultSchema.Type;
export type AgentPanelStressLabRunStatus = typeof agentPanelStressLabRunStatusSchema.Type;
export type SendAttachStressProbeResult = typeof sendAttachStressProbeResultSchema.Type;
export type PlanningBetweenToolsProbeResult = typeof planningBetweenToolsProbeResultSchema.Type;
export type TauriInvokeTimingRecord = typeof tauriInvokeTimingRecordSchema.Type;
export type TauriPendingInvokeRecord = typeof tauriPendingInvokeRecordSchema.Type;
export type HappyPathPerformanceResult = typeof happyPathPerformanceResultSchema.Type;
