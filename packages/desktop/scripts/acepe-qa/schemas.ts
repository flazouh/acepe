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
	src: z.string().nullable(),
	classes: z.string(),
	visible: z.boolean(),
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
export type ResetOnboardingResult = z.infer<typeof resetOnboardingResultSchema>;
