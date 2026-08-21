import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Option from "effect/Option"

export type BootstrapArgs = {
	readonly stdio: boolean
	readonly dbFilename: Option.Option<string>
	readonly tokenDelay: Duration.Duration
}

const valueAfter = (args: ReadonlyArray<string>, flag: string): Option.Option<string> =>
	Option.flatMap(Arr.findFirstIndex(args, (arg) => arg === flag), (index) =>
		Arr.get(args, index + 1)
	)

const parseTokenDelay = (raw: Option.Option<string>): Duration.Duration =>
	Option.match(raw, {
		onNone: () => Duration.zero,
		onSome: (value) => {
			const millis = Number.parseInt(value, 10)
			if (Number.isFinite(millis) === false || millis <= 0) {
				return Duration.zero
			}
			return Duration.millis(millis)
		}
	})

export const parseBootstrapArgs = (args: ReadonlyArray<string>): BootstrapArgs => ({
	stdio: Arr.contains(args, "--stdio"),
	dbFilename: Option.filter(valueAfter(args, "--db"), (value) => value.startsWith("--") === false),
	tokenDelay: parseTokenDelay(valueAfter(args, "--token-delay"))
})
