use super::*;

impl OpenCodeHttpClient {
    pub(super) fn resolve_configured_model(
        configured_model_id: &str,
        available_models: &[AvailableModel],
    ) -> Option<String> {
        if let Some(exact) = available_models
            .iter()
            .find(|model| model.model_id == configured_model_id)
        {
            return Some(exact.model_id.clone());
        }

        // OpenCode's canonical config format is provider/model. Only migrate a
        // legacy leaf-only value when exactly one connected provider exposes it.
        if configured_model_id.contains('/') {
            return None;
        }
        let mut matches = available_models.iter().filter(|model| {
            model
                .model_id
                .split_once('/')
                .map(|(_, provider_model_id)| provider_model_id == configured_model_id)
                .unwrap_or(false)
        });
        let unique = matches.next()?;
        if matches.next().is_some() {
            return None;
        }
        Some(unique.model_id.clone())
    }

    /// Fetch user's configured model preference from OpenCode's /config endpoint.
    async fn fetch_config_model(&self) -> AcpResult<Option<String>> {
        let base_url = self.base_url().await?;
        let url = format!("{}/config", base_url);
        let config: ConfigResponse = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(AcpError::HttpError)?
            .error_for_status()
            .map_err(AcpError::HttpError)?
            .json()
            .await
            .map_err(AcpError::HttpError)?;

        tracing::info!("Fetched user config model: {:?}", config.model);
        Ok(config.model)
    }

    /// Fetch available models from OpenCode's /provider endpoint.
    pub(crate) async fn fetch_available_models(
        &self,
    ) -> AcpResult<(Vec<AvailableModel>, Option<String>)> {
        let base_url = self.base_url().await?;
        let url = format!("{}/provider", base_url);

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(AcpError::HttpError)?
            .error_for_status()
            .map_err(AcpError::HttpError)?;

        let provider_response: ProviderResponse =
            response.json().await.map_err(AcpError::HttpError)?;

        let connected_set: std::collections::HashSet<&str> = provider_response
            .connected
            .iter()
            .map(|s| s.as_str())
            .collect();

        let mut available_models: Vec<AvailableModel> = Vec::new();
        for provider in &provider_response.all {
            if !connected_set.contains(provider.id.as_str()) {
                continue;
            }

            for (model_key, model) in &provider.models {
                if !model.supports_tool_calls() {
                    continue;
                }
                let model_id = format!("{}/{}", provider.id, model_key);

                available_models.push(AvailableModel {
                    model_id: model_id.clone(),
                    provider: Some(AvailableModelProvider {
                        provider_id: provider.id.clone(),
                        model_id: model_key.clone(),
                    }),
                    name: model.name.clone(),
                    description: None,
                });
            }
        }

        let config_model = self.fetch_config_model().await?;

        let current_model_id = if let Some(model_id) = config_model {
            if let Some(canonical_model_id) =
                Self::resolve_configured_model(&model_id, &available_models)
            {
                tracing::info!(
                    configured_model_id = %model_id,
                    canonical_model_id = %canonical_model_id,
                    "Using user's configured model from config"
                );
                Some(canonical_model_id)
            } else {
                tracing::warn!(
                    configured_model_id = %model_id,
                    "Configured OpenCode model is unavailable or ambiguous; explicit selection required"
                );
                None
            }
        } else {
            None
        };

        tracing::info!(
            models_count = available_models.len(),
            connected_providers = ?provider_response.connected,
            current_model_id = ?current_model_id,
            "Fetched available models from OpenCode"
        );

        Ok((available_models, current_model_id))
    }

    /// Fetch available slash commands from OpenCode's /command endpoint.
    pub(super) async fn fetch_available_commands(&self) -> Vec<AvailableCommand> {
        let base_url = match self.base_url().await {
            Ok(url) => url,
            Err(error) => {
                tracing::debug!(
                    %error,
                    "Failed to resolve OpenCode base URL for command list"
                );
                return vec![];
            }
        };

        let url = format!("{}/command", base_url);
        let request = self
            .http_client
            .get(&url)
            .query(&[("directory", &self.runtime_root)]);

        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                tracing::debug!(%error, "Failed to fetch OpenCode command list");
                return vec![];
            }
        };

        if !response.status().is_success() {
            tracing::debug!(
                status = %response.status(),
                "OpenCode /command endpoint returned non-success status"
            );
            return vec![];
        }

        let commands: Vec<OpenCodeCommand> = match response.json().await {
            Ok(commands) => commands,
            Err(error) => {
                tracing::debug!(%error, "Failed to parse OpenCode command list");
                return vec![];
            }
        };

        let mut available_commands: Vec<AvailableCommand> = commands
            .into_iter()
            .map(|command| AvailableCommand {
                name: command.name,
                description: command.description.unwrap_or_default(),
                input: None,
            })
            .collect();

        let has_compact = available_commands
            .iter()
            .any(|command| command.name == "compact");
        if !has_compact {
            available_commands.push(AvailableCommand {
                name: "compact".to_string(),
                description: "compact the session".to_string(),
                input: None,
            });
        }

        tracing::info!(
            commands_count = available_commands.len(),
            "Fetched available commands from OpenCode"
        );

        available_commands
    }
}
