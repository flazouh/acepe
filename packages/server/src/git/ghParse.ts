import * as Arr from "effect/Array"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
	CiJobDetails,
	OpenPrInfo,
	PrCheckConclusion,
	PrChecks,
	PrCheckStatus,
	PrDetails,
	PrState
} from "./Schemas.ts"

const RawPrCommit = Schema.Struct({
	oid: Schema.optionalKey(Schema.String),
	messageHeadline: Schema.optionalKey(Schema.String),
	additions: Schema.optionalKey(Schema.Int),
	deletions: Schema.optionalKey(Schema.Int)
})

const RawPrDetails = Schema.Struct({
	number: Schema.optionalKey(Schema.Int),
	title: Schema.optionalKey(Schema.String),
	body: Schema.optionalKey(Schema.String),
	state: Schema.optionalKey(Schema.String),
	url: Schema.optionalKey(Schema.String),
	isDraft: Schema.optionalKey(Schema.Boolean),
	additions: Schema.optionalKey(Schema.Int),
	deletions: Schema.optionalKey(Schema.Int),
	commits: RawPrCommit.pipe(Schema.Array, Schema.optionalKey),
	mergedAt: Schema.String.pipe(Schema.NullOr, Schema.optionalKey)
})

const RawOpenPr = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	url: Schema.String
})

const RawCheckEntry = Schema.Struct({
	__typename: Schema.optionalKey(Schema.String),
	name: Schema.optionalKey(Schema.String),
	status: Schema.optionalKey(Schema.String),
	conclusion: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
	detailsUrl: Schema.optionalKey(Schema.String),
	startedAt: Schema.optionalKey(Schema.String),
	completedAt: Schema.optionalKey(Schema.String),
	workflowName: Schema.optionalKey(Schema.String)
})

const RawPrChecks = Schema.Struct({
	headRefOid: Schema.optionalKey(Schema.String),
	statusCheckRollup: RawCheckEntry.pipe(Schema.Array, Schema.NullOr, Schema.optionalKey)
})

const RawCiJobStep = Schema.Struct({
	number: Schema.Int,
	name: Schema.String,
	status: Schema.String,
	conclusion: Schema.String.pipe(Schema.NullOr, Schema.optionalKey)
})

const RawCiJob = Schema.Struct({
	id: Schema.Int,
	name: Schema.String,
	status: Schema.String,
	conclusion: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
	steps: RawCiJobStep.pipe(Schema.Array, Schema.optionalKey)
})

const decodeRawPrDetails = Schema.decodeUnknownSync(Schema.fromJsonString(RawPrDetails))
const decodeRawOpenPrs = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(RawOpenPr)))
const decodeRawPrChecks = Schema.decodeUnknownSync(Schema.fromJsonString(RawPrChecks))
const decodeRawCiJob = Schema.decodeUnknownSync(Schema.fromJsonString(RawCiJob))

const toPrState = (raw: string | undefined, mergedAt: string | null | undefined): PrState => {
	if (mergedAt !== undefined && mergedAt !== null) {
		return "MERGED"
	}
	if (raw === "CLOSED") {
		return "CLOSED"
	}
	if (raw === "MERGED") {
		return "MERGED"
	}
	return "OPEN"
}

const toCheckStatus = (raw: string | undefined): PrCheckStatus => {
	if (raw === "QUEUED") {
		return "QUEUED"
	}
	if (raw === "IN_PROGRESS") {
		return "IN_PROGRESS"
	}
	if (raw === "COMPLETED") {
		return "COMPLETED"
	}
	return "UNKNOWN"
}

const toCheckConclusion = (raw: string | null | undefined): PrCheckConclusion | null => {
	if (raw === undefined || raw === null || raw === "") {
		return null
	}
	if (raw === "SUCCESS") {
		return "SUCCESS"
	}
	if (raw === "FAILURE") {
		return "FAILURE"
	}
	if (raw === "NEUTRAL") {
		return "NEUTRAL"
	}
	if (raw === "CANCELLED") {
		return "CANCELLED"
	}
	if (raw === "SKIPPED") {
		return "SKIPPED"
	}
	if (raw === "TIMED_OUT") {
		return "TIMED_OUT"
	}
	if (raw === "ACTION_REQUIRED") {
		return "ACTION_REQUIRED"
	}
	if (raw === "STALE") {
		return "STALE"
	}
	if (raw === "STARTUP_FAILURE") {
		return "STARTUP_FAILURE"
	}
	return "UNKNOWN"
}

const nonEmpty = (value: string | undefined): string | null => {
	if (value === undefined || value === "") {
		return null
	}
	return value
}

export const parsePrDetails = (output: string): PrDetails => {
	const raw = decodeRawPrDetails(output)
	return {
		number: raw.number ?? 0,
		title: raw.title ?? "",
		body: raw.body ?? "",
		state: toPrState(raw.state, raw.mergedAt),
		url: raw.url ?? "",
		isDraft: raw.isDraft ?? false,
		additions: raw.additions ?? 0,
		deletions: raw.deletions ?? 0,
		commits: Arr.map(raw.commits ?? Arr.empty(), (commit) => ({
			oid: commit.oid ?? "",
			messageHeadline: commit.messageHeadline ?? "",
			additions: commit.additions ?? 0,
			deletions: commit.deletions ?? 0
		}))
	}
}

export const parseOpenPrList = (output: string): Option.Option<OpenPrInfo> => {
	const parsed = decodeRawOpenPrs(output)
	return Arr.head(parsed)
}

export const parsePrChecks = (output: string, prNumber: number): PrChecks => {
	const raw = decodeRawPrChecks(output)
	const rollup = raw.statusCheckRollup
	const entries = rollup === undefined || rollup === null ? Arr.empty() : rollup
	const checkRuns = Arr.filterMap(
		entries,
		Filter.fromPredicateOption((entry) => {
			if (entry.__typename !== "CheckRun") {
				return Option.none()
			}
			return Option.some({
				name: entry.name ?? "",
				status: toCheckStatus(entry.status),
				conclusion: toCheckConclusion(entry.conclusion),
				detailsUrl: nonEmpty(entry.detailsUrl),
				startedAt: nonEmpty(entry.startedAt),
				completedAt: nonEmpty(entry.completedAt),
				workflowName: nonEmpty(entry.workflowName)
			})
		})
	)
	return {
		prNumber,
		headSha: raw.headRefOid ?? "",
		checkRuns
	}
}

export const parseGithubJobUrl = (
	url: string
): Option.Option<{ readonly owner: string; readonly repo: string; readonly jobId: number }> => {
	const prefix = "https://github.com/"
	if (url.startsWith(prefix) === false) {
		return Option.none()
	}
	const path = url.slice(prefix.length)
	const parts = path.split("/")
	const owner = parts[0]
	const repo = parts[1]
	const jobMarker = parts[5]
	const jobIdRaw = parts[6]
	if (owner === undefined || repo === undefined || jobMarker !== "job" || jobIdRaw === undefined) {
		return Option.none()
	}
	const jobId = Number.parseInt(jobIdRaw, 10)
	if (Number.isNaN(jobId)) {
		return Option.none()
	}
	return Option.some({
		owner,
		repo,
		jobId
	})
}

export const parseCiJob = (output: string, logsByStep: ReadonlyMap<string, string>): CiJobDetails => {
	const raw = decodeRawCiJob(output)
	return {
		id: raw.id,
		name: raw.name,
		status: raw.status,
		conclusion: raw.conclusion === undefined ? null : raw.conclusion,
		steps: Arr.map(raw.steps ?? Arr.empty(), (step) => ({
			number: step.number,
			name: step.name,
			status: step.status,
			conclusion: step.conclusion === undefined ? null : step.conclusion,
			log: logsByStep.get(step.name) ?? ""
		}))
	}
}

export const parseStepLogs = (
	logText: string,
	stepNames: ReadonlyArray<string>
): ReadonlyMap<string, string> => {
	const allowed = new Set(stepNames)
	const result = new Map<string, string>()
	let currentStep: string | undefined
	let currentLines: ReadonlyArray<string> = Arr.empty()
	const flush = (): void => {
		if (currentStep !== undefined) {
			result.set(currentStep, Arr.join(currentLines, "\n").trimEnd())
		}
	}
	for (const rawLine of logText.split("\n")) {
		const space = rawLine.indexOf(" ")
		const content = space < 0 ? rawLine : rawLine.slice(space + 1)
		if (content.startsWith("##[group]")) {
			const groupName = content.slice("##[group]".length)
			if (allowed.has(groupName)) {
				flush()
				currentStep = groupName
				currentLines = Arr.empty()
			} else if (currentStep !== undefined) {
				currentLines = Arr.append(currentLines, `▶ ${groupName}`)
			}
			continue
		}
		if (content === "##[endgroup]") {
			continue
		}
		if (currentStep !== undefined) {
			currentLines = Arr.append(currentLines, content)
		}
	}
	flush()
	return result
}
