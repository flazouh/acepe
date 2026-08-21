import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import {
	parseCiJob,
	parseGithubJobUrl,
	parseOpenPrList,
	parsePrChecks,
	parsePrDetails,
	parseStepLogs
} from "./ghParse.ts"

const PR_DETAILS_FIXTURE = `{
  "number": 12,
  "title": "Add git panel",
  "body": "Does the thing",
  "state": "OPEN",
  "url": "https://github.com/a/b/pull/12",
  "isDraft": false,
  "additions": 10,
  "deletions": 2,
  "commits": [{ "oid": "abc", "messageHeadline": "Add panel", "additions": 10, "deletions": 2 }],
  "mergedAt": null
}`

const PR_CHECKS_FIXTURE = `{
  "headRefOid": "deadbeef",
  "statusCheckRollup": [
    {
      "__typename": "CheckRun",
      "name": "test",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/a/b/actions/runs/1/job/2",
      "startedAt": "2026-08-21T12:00:00Z",
      "completedAt": "2026-08-21T12:01:00Z",
      "workflowName": "CI"
    },
    { "__typename": "StatusContext", "name": "legacy" }
  ]
}`

Vitest.describe("parsePrDetails", () => {
	Vitest.it("grades gh pr view JSON into the UI PrDetails shape", () => {
		const details = parsePrDetails(PR_DETAILS_FIXTURE)
		Vitest.assert.strictEqual(details.number, 12)
		Vitest.assert.strictEqual(details.title, "Add git panel")
		Vitest.assert.strictEqual(details.state, "OPEN")
		Vitest.assert.strictEqual(details.commits[0]?.oid, "abc")
	})

	Vitest.it("promotes mergedAt to MERGED", () => {
		const details = parsePrDetails(
			`{"number":1,"title":"t","body":"","state":"OPEN","url":"u","mergedAt":"2026-08-21T12:00:00Z"}`
		)
		Vitest.assert.strictEqual(details.state, "MERGED")
	})
})

Vitest.describe("parseOpenPrList", () => {
	Vitest.it("returns the first open PR", () => {
		const found = parseOpenPrList(
			`[{"number":4,"title":"Ready","url":"https://github.com/a/b/pull/4"}]`
		)
		Vitest.assert.strictEqual(Option.getOrUndefined(found)?.number, 4)
		Vitest.assert.strictEqual(Option.isNone(parseOpenPrList("[]")), true)
	})
})

Vitest.describe("parsePrChecks", () => {
	Vitest.it("keeps CheckRun entries and drops status contexts", () => {
		const checks = parsePrChecks(PR_CHECKS_FIXTURE, 12)
		Vitest.assert.strictEqual(checks.prNumber, 12)
		Vitest.assert.strictEqual(checks.headSha, "deadbeef")
		Vitest.assert.strictEqual(checks.checkRuns.length, 1)
		Vitest.assert.strictEqual(checks.checkRuns[0]?.name, "test")
		Vitest.assert.strictEqual(checks.checkRuns[0]?.status, "COMPLETED")
		Vitest.assert.strictEqual(checks.checkRuns[0]?.conclusion, "SUCCESS")
	})
})

Vitest.describe("parseGithubJobUrl", () => {
	Vitest.it("reads owner, repo, and job id from a GitHub job URL", () => {
		const parsed = parseGithubJobUrl("https://github.com/acepe/app/actions/runs/9/job/77")
		Vitest.assert.deepStrictEqual(Option.getOrUndefined(parsed), {
			owner: "acepe",
			repo: "app",
			jobId: 77
		})
		Vitest.assert.strictEqual(Option.isNone(parseGithubJobUrl("https://example.com/x")), true)
	})
})

Vitest.describe("parseStepLogs and parseCiJob", () => {
	Vitest.it("attaches grouped log text to CI job steps", () => {
		const logs = parseStepLogs(
			[
				"2026-08-21T12:00:00Z ##[group]Install",
				"2026-08-21T12:00:01Z bun install",
				"2026-08-21T12:00:02Z ##[endgroup]",
				"2026-08-21T12:00:03Z ##[group]Test",
				"2026-08-21T12:00:04Z bun test",
				""
			].join("\n"),
			["Install", "Test"]
		)
		const job = parseCiJob(
			`{"id":77,"name":"CI","status":"completed","conclusion":"success","steps":[{"number":1,"name":"Install","status":"completed","conclusion":"success"},{"number":2,"name":"Test","status":"completed","conclusion":"success"}]}`,
			logs
		)
		Vitest.assert.strictEqual(job.id, 77)
		Vitest.assert.strictEqual(job.steps[0]?.log, "bun install")
		Vitest.assert.strictEqual(job.steps[1]?.log, "bun test")
	})
})
