use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};

pub(crate) const PASSWORD_TOKEN_PREFIX: &str = "obf:v1:";

pub(crate) fn password_key_material() -> [u8; 32] {
    let user = std::env::var("USER").unwrap_or_default();
    let home = dirs::home_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let salt = format!("acepe-sql-studio-passwords:{}:{}", user, home);
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    let digest = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest[..32]);
    key
}

pub(crate) fn xor_stream_bytes(input: &[u8], key: &[u8; 32], nonce: &[u8; 16]) -> Vec<u8> {
    let mut output = Vec::with_capacity(input.len());
    let mut counter: u64 = 0;
    let mut offset = 0usize;

    while offset < input.len() {
        let mut hasher = Sha256::new();
        hasher.update(key);
        hasher.update(nonce);
        hasher.update(counter.to_le_bytes());
        let block = hasher.finalize();

        for byte in block {
            if offset >= input.len() {
                break;
            }
            output.push(input[offset] ^ byte);
            offset += 1;
        }

        counter += 1;
    }

    output
}

pub(crate) fn obfuscate_password(password: &str) -> String {
    let key = password_key_material();
    let mut nonce = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut nonce);
    let encrypted = xor_stream_bytes(password.as_bytes(), &key, &nonce);
    let mut payload = nonce.to_vec();
    payload.extend(encrypted);
    format!(
        "{}{}",
        PASSWORD_TOKEN_PREFIX,
        base64::engine::general_purpose::STANDARD.encode(payload)
    )
}

pub(crate) fn reveal_password(password_token: &str) -> Result<String, String> {
    if !password_token.starts_with(PASSWORD_TOKEN_PREFIX) {
        return Ok(password_token.to_string());
    }

    let encoded = &password_token[PASSWORD_TOKEN_PREFIX.len()..];
    let payload = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Failed to decode stored SQL password token: {}", e))?;

    if payload.len() < 16 {
        return Err("Stored SQL password token is invalid".to_string());
    }

    let mut nonce = [0u8; 16];
    nonce.copy_from_slice(&payload[..16]);
    let encrypted = &payload[16..];
    let key = password_key_material();
    let decrypted = xor_stream_bytes(encrypted, &key, &nonce);

    String::from_utf8(decrypted)
        .map_err(|e| format!("Stored SQL password is not valid UTF-8: {}", e))
}
