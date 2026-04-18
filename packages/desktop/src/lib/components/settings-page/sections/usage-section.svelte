<script lang="ts">
import { ChartLine } from "phosphor-svelte";
import SettingsComingSoon from "../settings-coming-soon.svelte";
import SettingsSection from "../settings-section.svelte";
</script>

<div class="w-full">
	<SettingsSection
		title="Usage"
		description="Track your agent usage, costs, and activity over time."
	>
		<SettingsComingSoon
			icon={ChartLine}
			headline="Usage & cost insights"
			description="Per-agent token usage, session counts, and estimated costs across providers will appear here."
		/>
	</SettingsSection>
</div>
