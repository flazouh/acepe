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
	planningVisible: z.boolean(),
	readyVisible: z.boolean(),
	matchingTextLeafCount: z.number(),
	matchingTranscriptViewportCount: z.number(),
	transcriptViewportCount: z.number(),
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

export type SendComposerResult = z.infer<typeof sendComposerResultSchema>;
export type PlanningDebugResult = z.infer<typeof planningDebugResultSchema>;
export type ComputerUseProbeResult = z.infer<typeof computerUseProbeResultSchema>;
export type NavigateResult = z.infer<typeof navigateResultSchema>;
export type WatchResult = z.infer<typeof watchResultSchema>;
export type ResizeProbeResult = z.infer<typeof resizeProbeResultSchema>;
export type ResizeStreamProbeResult = z.infer<typeof resizeStreamProbeResultSchema>;
export type FirstSendTimelineProbeResult = z.infer<typeof firstSendTimelineProbeResultSchema>;

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
export type ThinkingToggleProbeResult = z.infer<typeof thinkingToggleProbeResultSchema>;
export type ResetOnboardingResult = z.infer<typeof resetOnboardingResultSchema>;
export type StreamingReproLabResult = z.infer<typeof streamingReproLabResultSchema>;
