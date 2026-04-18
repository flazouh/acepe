<script lang="ts">
import { ThemeToggle } from "$lib/components/theme/index.js";
import SettingRow from "../setting-row.svelte";
import SettingsSection from "../settings-section.svelte";
</script>

<div class="w-full">
	<SettingsSection
		title={"Appearance"}
		description="Choose how Acepe looks."
	>
		<SettingRow
			label={"Theme"}
			description="Use light, dark, or match your system."
		>
			<ThemeToggle />
		</SettingRow>
	</SettingsSection>
</div>
