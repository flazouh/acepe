<script lang="ts">
import SettingsComingSoon from "../settings-coming-soon.svelte";
import SettingsSection from "../settings-section.svelte";
</script>

<div class="w-full">
	<SettingsSection>
		<SettingsComingSoon
			roundedIcon="folder"
			headline="Environment management"
			description="Env-file copy allowlist for worktree creation and per-agent environment variable overrides will live here."
		/>
	</SettingsSection>
</div>
