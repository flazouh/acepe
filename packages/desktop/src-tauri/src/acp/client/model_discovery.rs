use super::*;
use crate::acp::runtime_resolver::resolve_effective_runtime;

impl AcpClient {
    pub(super) async fn discover_models_from_provider_cli(&self) -> Vec<AvailableModel> {
        let Some(provider) = self.provider.as_ref() else {
            return Vec::new();
        };

        let attempts = provider.model_discovery_commands();
        if attempts.is_empty() {
            return Vec::new();
        }

        for attempt in attempts {
            let runtime = resolve_effective_runtime(provider.id(), &self.cwd, &attempt, None);
            let mut command = Command::new(&runtime.command);
            command.args(&runtime.args);
            command.stdin(Stdio::null());
            command.stdout(Stdio::piped());
            command.stderr(Stdio::piped());

            command.current_dir(&runtime.cwd);

            for (key, value) in &runtime.env {
                command.env(key, value);
            }

            let output = match timeout(Duration::from_secs(10), command.output()).await {
                Ok(Ok(output)) => output,
                Ok(Err(error)) => {
                    tracing::debug!(
                        command = %runtime.command,
                        args = ?runtime.args,
                        error = %error,
                        "Failed to execute provider model discovery command"
                    );
                    continue;
                }
                Err(_) => {
                    tracing::debug!(
                        command = %runtime.command,
                        args = ?runtime.args,
                        "Provider model discovery command timed out"
                    );
                    continue;
                }
            };

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let mut models = parse_model_discovery_output(&stdout);

            if !models.is_empty() {
                tracing::info!(
                    provider = provider.id(),
                    args = ?runtime.args,
                    models_count = models.len(),
                    "Discovered models from provider CLI"
                );
                models.sort_by(|a, b| a.model_id.cmp(&b.model_id));
                return models;
            }

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                tracing::debug!(
                    provider = provider.id(),
                    args = ?runtime.args,
                    status = ?output.status.code(),
                    stderr = %truncate_for_log(&stderr, MAX_LOGGED_SUBPROCESS_LINE_BYTES),
                    "Provider model discovery returned non-zero status"
                );
            }
        }

        Vec::new()
    }

    pub(super) async fn hydrate_missing_models_for_provider(
        &self,
        provider: &dyn AgentProvider,
        model_state: &mut SessionModelState,
    ) {
        if !model_state.available_models.is_empty() {
            return;
        }

        let discovered = self.discover_models_from_provider_cli().await;
        if !discovered.is_empty() {
            model_state.available_models = discovered;
            tracing::debug!(
                provider = %provider.id(),
                models_count = model_state.available_models.len(),
                "Hydrated provider models from discovery command"
            );
        }
    }
}
