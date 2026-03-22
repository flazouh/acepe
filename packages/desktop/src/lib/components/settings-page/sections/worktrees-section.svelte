<script lang="ts">
import { getWorktreeDefaultStore } from "$lib/acp/components/worktree-toggle/worktree-default-store.svelte.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as m from "$lib/paraglide/messages.js";
import SettingsControlCard from "../settings-control-card.svelte";
import SettingsSection from "../settings-section.svelte";

const worktreeDefaultStore = getWorktreeDefaultStore();
</script>

<div class="w-full">
	<SettingsSection
		title={m.settings_worktree_section()}
		description="Choose the default behavior for worktree-aware sessions."
	>
		<SettingsControlCard
			label={m.settings_worktree_default_label()}
			description={m.settings_worktree_default_description()}
		>
			<Switch
				checked={worktreeDefaultStore.globalDefault}
				onCheckedChange={(checked) => {
					void worktreeDefaultStore.set(checked === true).match(
						() => {},
						() => {}
					);
				}}
			/>
		</SettingsControlCard>
	</SettingsSection>
</div>
