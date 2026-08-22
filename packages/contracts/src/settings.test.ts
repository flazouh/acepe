import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"

import { SettingsId } from "./ids.ts"
import { APP_SETTINGS_ID, USER_SETTING_KEYS, UserSettingKey } from "./settings.ts"

const decodeKey = Schema.decodeUnknownEffect(UserSettingKey)

describe("UserSettingKey", () => {
	it("decodes every shipping app_settings key", () => {
		expect(USER_SETTING_KEYS).toHaveLength(40)
		for (const key of USER_SETTING_KEYS) {
			expect(Effect.runSync(decodeKey(key))).toBe(key)
		}
	})

	it("keeps the hyphenated notification-preferences storage key", () => {
		expect(Effect.runSync(decodeKey("notification-preferences"))).toBe("notification-preferences")
	})

	it("rejects an unknown key", () => {
		expect(Exit.isFailure(Effect.runSyncExit(decodeKey("not_a_setting")))).toBe(true)
	})
})

describe("APP_SETTINGS_ID", () => {
	it("is the singleton settings aggregate", () => {
		expect(APP_SETTINGS_ID).toBe(SettingsId.make("app"))
	})
})
