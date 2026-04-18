<script lang="ts">
import { ThemeToggle } from "$lib/components/theme/index.js";
import * as m from "$lib/messages.js";
import SettingRow from "../setting-row.svelte";
import SettingsSection from "../settings-section.svelte";
</script>

<div class="w-full">
	<SettingsSection
		title={m.settings_appearance()}
		description="Choose how Acepe looks."
	>
		<SettingRow
			label={m.settings_theme()}
			description="Use light, dark, or match your system."
		>
			<ThemeToggle />
		</SettingRow>
	</SettingsSection>
</div>
