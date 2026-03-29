//! Example to check which Claude account is currently active
//!
//! This demonstrates that cc-sdk uses the same account as the Claude CLI
//! that is currently logged in on your system.
//!
//! # How it works
//!
//! 1. The Claude CLI stores authentication in ~/.config/claude/ (or similar)
//! 2. All terminal sessions share the same authentication
//! 3. cc-sdk uses the same Claude CLI process, so it uses the same account
//!
//! # Usage
//!
//! ```bash
//! # First, check which account Claude CLI is using
//! echo "/status" | claude
//!
//! # Then run this example - it should use the same account
//! cargo run --example check_current_account
//! ```

use cc_sdk::{ClaudeCodeOptions, ClaudeSDKClient, Message, Result};
use futures::StreamExt;

#[tokio::main]
async fn main() -> Result<()> {
    println!("╔═══════════════════════════════════════════════╗");
    println!("║   Current Claude Account Detection           ║");
    println!("╚═══════════════════════════════════════════════╝\n");

    println!("This example demonstrates that cc-sdk uses the");
    println!("same account as your current Claude CLI login.\n");

    // Check if ANTHROPIC_USER_EMAIL is set
    if let Ok(email) = std::env::var("ANTHROPIC_USER_EMAIL") {
        println!("ℹ️  Environment variable set: {}", email);
        println!("   (This is used for SDK identification)\n");
    } else {
        println!("ℹ️  ANTHROPIC_USER_EMAIL not set");
        println!("   Will attempt to detect from CLI session\n");
    }

    let options = ClaudeCodeOptions::builder().max_turns(1).build();

    let mut client = ClaudeSDKClient::new(options);

    println!("📡 Connecting to Claude CLI...");
    client.connect(None).await?;
    println!("   ✅ Connected\n");

    // Method 1: Try get_account_info (uses env var if set)
    println!("🔍 Method 1: Using get_account_info()");
    match client.get_account_info().await {
        Ok(info) => {
            println!("   ✅ Account detected: {}\n", info);
        }
        Err(e) => {
            println!("   ⚠️  Could not detect via env var: {}\n", e);
        }
    }

    // Method 2: Ask Claude who they are
    println!("🔍 Method 2: Asking Claude directly");
    println!("   Sending query: 'What account am I using?'\n");

    client
        .send_user_message(
            "What is the current account email or user that you're running under? \
         Just tell me the account identifier, nothing else."
                .to_string(),
        )
        .await?;

    let mut messages = client.receive_messages().await;
    while let Some(msg_result) = messages.next().await {
        match msg_result? {
            Message::Assistant { message } => {
                for block in message.content {
                    if let cc_sdk::ContentBlock::Text(text) = block {
                        println!("   🤖 Response: {}\n", text.text);
                    }
                }
            }
            Message::Result { .. } => break,
            _ => {}
        }
    }

    client.disconnect().await?;

    println!("─────────────────────────────────────────────────");
    println!("\n📝 Summary:\n");
    println!("• cc-sdk uses the Claude CLI that's installed on your system");
    println!("• It inherits the authentication from Claude CLI");
    println!("• All terminals/sessions use the SAME account");
    println!("• To switch accounts, use: claude (and follow prompts)");
    println!("• Or set ANTHROPIC_USER_EMAIL for SDK identification\n");

    Ok(())
}
