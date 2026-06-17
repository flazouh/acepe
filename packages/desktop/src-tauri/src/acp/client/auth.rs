use super::*;

/// Upper bound on the interactive `authenticate` round-trip.
///
/// Agents that advertise an interactive sign-in method (e.g. cursor-agent's
/// `cursor_login`) block this request on an out-of-band browser OAuth that
/// Acepe cannot surface or complete in-process. Without a dedicated bound the
/// request only fails after the generic 30s operation timeout, producing a
/// silent hang and a misleading "unable to connect" fault. Already-authenticated
/// providers validate their existing token well within this window, so the bound
/// cleanly separates "auth already satisfied" (fast return) from "user must sign
/// in" (timeout → [`AcpError::AuthenticationRequired`]).
const INTERACTIVE_AUTH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

impl AcpClient {
    pub(super) async fn authenticate_if_required(
        &mut self,
        response: &InitializeResponse,
    ) -> AcpResult<()> {
        let Some(provider) = self.provider.as_ref() else {
            return Ok(());
        };
        let provider_name = provider.name().to_string();
        let maybe_params = provider.authenticate_request_params(&response.auth_methods)?;
        // Release the immutable `provider` borrow before `send_request` (&mut self).

        let Some(params) = maybe_params else {
            return Ok(());
        };

        let instructions = format!(
            "Sign in to {provider_name} from its CLI, then retry the connection."
        );

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
