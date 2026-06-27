<script lang="ts">
import { ChartLine } from "@acepe/ui/icons";
import SettingsComingSoon from "../settings-coming-soon.svelte";
import SettingsSection from "../settings-section.svelte";
</script>

<div class="w-full">
	<SettingsSection>
		<SettingsComingSoon
			icon={ChartLine}
			headline="Usage & cost insights"
			description="Per-agent token usage, session counts, and estimated costs across providers will appear here."
		/>
	</SettingsSection>
</div>
