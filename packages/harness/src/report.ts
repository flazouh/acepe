import { encodeJsonLine } from "./fixture.ts"
import type { Divergence, ExchangeGrade } from "./grade.ts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export type FixtureReport = {
	readonly fixture: string
	readonly pass: number
	readonly fail: number
	readonly skipped: number
	readonly grades: ReadonlyArray<ExchangeGrade>
	readonly firstDivergence: Option.Option<Divergence>
}

const emptyCounts = {
	pass: 0,
	fail: 0,
	skipped: 0,
}

const addStatus = (
	counts: { readonly pass: number; readonly fail: number; readonly skipped: number },
	status: ExchangeGrade["status"],
): { readonly pass: number; readonly fail: number; readonly skipped: number } => {
	if (status === "pass") {
		return { pass: counts.pass + 1, fail: counts.fail, skipped: counts.skipped }
	}
	if (status === "fail") {
		return { pass: counts.pass, fail: counts.fail + 1, skipped: counts.skipped }
	}
	return { pass: counts.pass, fail: counts.fail, skipped: counts.skipped + 1 }
}

export const makeReport = (fixture: string, grades: ReadonlyArray<ExchangeGrade>): FixtureReport => {
	const counts = Arr.reduce(grades, emptyCounts, (current, grade) => addStatus(current, grade.status))
	const firstFail = Arr.findFirst(grades, (grade) => grade.status === "fail")
	return {
		fixture,
		pass: counts.pass,
		fail: counts.fail,
		skipped: counts.skipped,
		grades,
		firstDivergence: Option.flatMap(firstFail, (grade) => grade.divergence),
	}
}

const formatJson = Effect.fn("formatJson")((value: Option.Option<Schema.Json>) =>
	Option.match(value, {
		onNone: () => Effect.succeed("<missing>"),
		onSome: (json) => encodeJsonLine(json),
	}),
)

export const formatReport = Effect.fn("formatReport")(function* (report: FixtureReport) {
	const header = Arr.join(
		[
			`fixture: ${report.fixture}`,
			`pass: ${String(report.pass)}`,
			`fail: ${String(report.fail)}`,
			`skipped: ${String(report.skipped)}`,
		],
		"\n",
	)
	if (Option.isNone(report.firstDivergence)) {
		return header
	}
	const divergence = report.firstDivergence.value
	const expected = yield* formatJson(divergence.expected)
	const actual = yield* formatJson(divergence.actual)
	return `${header}\nfirst divergence: ${divergence.path}\n  expected: ${expected}\n  actual: ${actual}`
})
