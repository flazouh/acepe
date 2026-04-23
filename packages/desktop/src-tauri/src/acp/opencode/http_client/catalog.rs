use std::collections::HashMap;

use super::*;

impl OpenCodeHttpClient {
    /// Helper function to get the provider default model ID.
    /// Uses the provider-reported defaults for connected providers,
    /// falling back to the first available model.
    pub(super) fn get_provider_default_model(
        connected_set: &std::collections::HashSet<&str>,
        provider_defaults: &HashMap<String, String>,
        fallback_model: Option<&String>,
    ) -> Option<String> {
        // Use the first connected provider that has a default model
        for &provider_id in connected_set.iter() {
            if let Some(model_id) = provider_defaults.get(provider_id) {
                return Some(format!("{}/{}", provider_id, model_id));
            }
        }

        // Fall back to the first available model from any connected provider
        fallback_model.cloned()
    }

    /// Fetch user's configured model preference from OpenCode's /config endpoint.
    async fn fetch_config_model(&self) -> AcpResult<Option<String>> {
        let base_url = match self.base_url().await {
            Ok(url) => url,
            Err(e) => {
                tracing::debug!("Failed to get OpenCode base URL: {}", e);
                return Ok(None);
            }
        };

        let url = format!("{}/config", base_url);

        let response = match self.http_client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::debug!("Failed to fetch OpenCode config: {}", e);
                return Ok(None);
            }
        };

        if !response.status().is_success() {
            tracing::debug!(
                "OpenCode /config endpoint returned status: {}",
                response.status()
            );
            return Ok(None);
        }

        let config: ConfigResponse = match response.json().await {
            Ok(c) => c,
            Err(e) => {
                tracing::debug!("Failed to parse OpenCode config response: {}", e);
                return Ok(None);
            }
        };

        tracing::info!("Fetched user config model: {:?}", config.model);
        Ok(config.model)
    }

    /// Fetch available models from OpenCode's /provider endpoint.
    pub(crate) async fn fetch_available_models(&self) -> AcpResult<(Vec<AvailableModel>, String)> {
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
        let mut default_model_id: Option<String> = None;

        for provider in &provider_response.all {
            if !connected_set.contains(provider.id.as_str()) {
                continue;
            }

            for (model_key, model) in &provider.models {
                let model_id = format!("{}/{}", provider.id, model_key);

                available_models.push(AvailableModel {
                    model_id: model_id.clone(),
                    name: model.name.clone(),
                    description: None,
                });

                if default_model_id.is_none() {
                    default_model_id = Some(model_id);
                }
            }
        }

        let config_model = self.fetch_config_model().await.unwrap_or(None);

        let current_model_id = if let Some(model_id) = config_model {
            let matching_model = available_models.iter().find(|m| {
                m.model_id == model_id
                    || model_id.ends_with(&format!(
                        "/{}",
                        m.model_id.split('/').next_back().unwrap_or(&m.model_id)
                    ))
            });

            if matching_model.is_some() {
                let canonical_model_id = matching_model
                    .map(|model| model.model_id.clone())
                    .unwrap_or(model_id.clone());
                tracing::info!(
                    configured_model_id = %model_id,
                    canonical_model_id = %canonical_model_id,
                    "Using user's configured model from config"
                );
                Some(canonical_model_id)
            } else {
                tracing::debug!(
                    "Configured model '{}' not in available models, using provider default",
                    model_id
                );
                Self::get_provider_default_model(
                    &connected_set,
                    &provider_response.default,
                    default_model_id.as_ref(),
                )
            }
        } else {
            Self::get_provider_default_model(
                &connected_set,
                &provider_response.default,
                default_model_id.as_ref(),
            )
        };

        let current_model_id = current_model_id.unwrap_or_default();

        tracing::info!(
            models_count = available_models.len(),
            connected_providers = ?provider_response.connected,
            current_model_id = %current_model_id,
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
