use super::*;

impl OpenCodeHttpClient {
    /// Convert OpenCode API response format to internal OpenCodeMessage format
    pub(super) fn convert_api_response_to_message(
        response: OpenCodeApiMessageResponse,
    ) -> OpenCodeMessage {
        let timestamp = response.info.time.created.to_string();

        let parts: Vec<OpenCodeMessagePart> = response
            .parts
            .into_iter()
            .map(opencode_history_parser::convert_api_part)
            .collect();

        OpenCodeMessage {
            id: response.info.id,
            role: response.info.role,
            parts,
            model: response
                .info
                .model
                .map(|m| format!("{}/{}", m.provider_id, m.model_id)),
            timestamp: Some(timestamp),
        }
    }

    /// Get session messages via HTTP API
    pub async fn get_session_messages(
        &self,
        session_id: &str,
        _directory: &str,
    ) -> AcpResult<Vec<OpenCodeMessage>> {
        let base_url = self.base_url().await?;
        let url = format!("{}/session/{}/message", base_url, session_id);

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(AcpError::HttpError)?
            .error_for_status()
            .map_err(AcpError::HttpError)?;

        let api_responses: Vec<OpenCodeApiMessageResponse> =
            response.json().await.map_err(AcpError::HttpError)?;

        let messages: Vec<OpenCodeMessage> = api_responses
            .into_iter()
            .map(Self::convert_api_response_to_message)
            .collect();

        Ok(messages)
    }

    /// List sessions via HTTP API
    pub async fn list_sessions(
        &self,
        directory: Option<String>,
    ) -> AcpResult<Vec<OpenCodeSession>> {
        let base_url = self.base_url().await?;
        let mut url = format!("{}/session", base_url);

        if let Some(dir) = directory {
            url = format!("{}?directory={}", url, urlencoding::encode(&dir));
        }

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(AcpError::HttpError)?
            .error_for_status()
            .map_err(AcpError::HttpError)?;

        let sessions: Vec<OpenCodeSession> = response.json().await.map_err(AcpError::HttpError)?;

        Ok(sessions)
    }
}
