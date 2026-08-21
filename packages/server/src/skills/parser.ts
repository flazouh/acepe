import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Str from "effect/String"
import { SkillParseError } from "./Errors.ts"
import type { ParsedSkillContent } from "./Schemas.ts"

const stripCr = (line: string): string => {
	if (Str.endsWith("\r")(line)) {
		return line.slice(0, line.length - 1)
	}
	return line
}

const trimMatches = (value: string, char: string): string => {
	let start = 0
	let end = value.length
	while (start < end && value[start] === char) {
		start = start + 1
	}
	while (end > start && value[end - 1] === char) {
		end = end - 1
	}
	return value.slice(start, end)
}

const extractYamlValue = (line: string, prefix: string): string => {
	const raw = Str.trim(line.slice(prefix.length))
	return trimMatches(trimMatches(raw, "\""), "'")
}

export const parseSkillContent = (
	content: string
): Result.Result<ParsedSkillContent, SkillParseError> => {
	const lines = Arr.map(Str.split(content, "\n"), stripCr)
	const first = lines[0]
	if (first === undefined || first !== "---") {
		return Result.fail(
			new SkillParseError({
				reason: "No YAML frontmatter found. Skill files must start with ---"
			})
		)
	}
	const rest = Arr.drop(lines, 1)
	const closing = Arr.findFirstIndex(rest, (line) => line === "---")
	if (Option.isNone(closing)) {
		return Result.fail(
			new SkillParseError({
				reason: "Invalid frontmatter: missing closing ---"
			})
		)
	}
	const endIdx = closing.value + 1
	if (endIdx < 2) {
		return Result.fail(
			new SkillParseError({
				reason: "Invalid frontmatter format"
			})
		)
	}
	const frontmatterYaml = Arr.join(Arr.take(rest, closing.value), "\n")
	const bodyLines = Arr.drop(lines, endIdx + 1)
	const body = bodyLines.length === 0 ? "" : Str.trimStart(Arr.join(bodyLines, "\n"))
	let name = ""
	let description = ""
	for (const rawLine of Str.split(frontmatterYaml, "\n")) {
		const line = Str.trim(rawLine)
		if (Str.startsWith("name:")(line)) {
			name = extractYamlValue(line, "name:")
		} else if (Str.startsWith("description:")(line)) {
			description = extractYamlValue(line, "description:")
		}
	}
	if (name.length === 0) {
		return Result.fail(
			new SkillParseError({
				reason: "Required field 'name' not found in frontmatter"
			})
		)
	}
	return Result.succeed({
		metadata: {
			name,
			description
		},
		body
	})
}

export const generateSkillContent = (name: string, description: string, body: string): string => {
	const escapedName = Str.replaceAll("\"", "\\\"")(name)
	const escapedDescription = Str.replaceAll("\"", "\\\"")(description)
	return `---\nname: "${escapedName}"\ndescription: "${escapedDescription}"\n---\n\n${body}`
}
