use super::*;

impl AcpClient {
    pub(super) async fn authenticate_if_required(
        &mut self,
        response: &InitializeResponse,
    ) -> AcpResult<()> {
        let Some(provider) = self.provider.as_ref() else {
            return Ok(());
        };
        let provider_name = provider.name().to_string();

        if let Some(params) = provider.authenticate_request_params(&response.auth_methods)? {
            self.send_request(acp_methods::AUTHENTICATE, params)
                .await
                .map(|_| ())
                .map_err(|error| {
                    AcpError::ProtocolError(format!(
                        "{} authentication failed. {error}",
                        provider_name
                    ))
                })?;
        }

        Ok(())
    }
}
