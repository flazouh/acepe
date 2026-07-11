use super::*;

const AUTHENTICATION_STATUS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Upper bound on the interactive `authenticate` round-trip.
///
/// Providers without a dedicated status/login action can block this request on
/// out-of-band authentication. This bound turns that silent wait into a
/// canonical sign-in requirement.
const INTERACTIVE_AUTH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

impl AcpClient {
    async fn provider_authentication_is_satisfied(
        &self,
        action: &crate::acp::provider::ProviderAuthenticationAction,
    ) -> bool {
        let Some(provider) = self.provider.as_ref() else {
            return false;
        };
        let saved_overrides = match self.app_handle.as_ref() {
            Some(app_handle) => load_saved_agent_env_overrides(app_handle).await.ok(),
            None => None,
        };
        let runtime = crate::acp::runtime_resolver::resolve_effective_runtime(
            provider.id(),
            &self.cwd,
            &action.status,
            saved_overrides.as_ref(),
        );
        let mut command = Command::new(&runtime.command);
        command
            .args(&runtime.args)
            .current_dir(&runtime.cwd)
            .env_clear()
            .envs(&runtime.env)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);

        matches!(
            tokio::time::timeout(AUTHENTICATION_STATUS_TIMEOUT, command.status()).await,
            Ok(Ok(status)) if status.success()
        )
    }

    pub(super) async fn authenticate_if_required(
        &mut self,
        response: &InitializeResponse,
    ) -> AcpResult<()> {
        let Some(provider) = self.provider.as_ref() else {
            return Ok(());
        };
        let provider_name = provider.name().to_string();

        if let Some(action) = provider.authentication_action() {
            if self.provider_authentication_is_satisfied(&action).await {
                return Ok(());
            }
            return Err(AcpError::AuthenticationRequired {
                agent: provider_name.clone(),
                instructions: format!("Sign in to {provider_name}, then retry the connection."),
            });
        }

        let maybe_params = provider.authenticate_request_params(&response.auth_methods)?;
        // Release the immutable `provider` borrow before `send_request` (&mut self).

        let Some(params) = maybe_params else {
            return Ok(());
        };

        let instructions =
            format!("Sign in to {provider_name} from its CLI, then retry the connection.");

        match tokio::time::timeout(
            INTERACTIVE_AUTH_TIMEOUT,
            self.send_request(acp_methods::AUTHENTICATE, params),
        )
        .await
        {
            Ok(Ok(_)) => Ok(()),
            // The agent actively rejected authentication — distinct, actionable
            // sign-in fault, not a generic protocol error.
            Ok(Err(error)) => {
                tracing::warn!(
                    agent = %provider_name,
                    error = %error,
                    "Interactive authentication rejected by agent"
                );
                Err(AcpError::AuthenticationRequired {
                    agent: provider_name,
                    instructions,
                })
            }
            // No response within the bound: the agent is blocked awaiting an
            // out-of-band interactive sign-in. Convert the silent hang into an
            // actionable canonical fault.
            Err(_elapsed) => {
                tracing::warn!(
                    agent = %provider_name,
                    timeout_secs = INTERACTIVE_AUTH_TIMEOUT.as_secs(),
                    "Interactive authentication timed out; agent awaiting out-of-band sign-in"
                );
                Err(AcpError::AuthenticationRequired {
                    agent: provider_name,
                    instructions,
                })
            }
        }
    }
}
