<script lang="ts">
import { Plugs } from "phosphor-svelte";
import SettingsComingSoon from "../settings-coming-soon.svelte";
import SettingsSection from "../settings-section.svelte";
</script>

<div class="w-full">
	<SettingsSection>
		<SettingsComingSoon
			icon={Plugs}
			headline="MCP server management"
			description="Install, configure, and toggle MCP servers across your agents. Share server configurations per project or across the app."
		/>
	</SettingsSection>
</div>
