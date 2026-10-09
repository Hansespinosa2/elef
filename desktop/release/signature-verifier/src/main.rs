use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use minisign_verify::{PublicKey, Signature};
use std::env;
use std::fs;

fn main() {
    if let Err(error) = run() {
        eprintln!("updater signature verification failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let arguments: Vec<String> = env::args().collect();
    if arguments.len() != 5 {
        return Err("usage: elef-update-signature-verifier <archive> <signature-file> <base64-public-key> <version>".to_string());
    }
    let archive =
        fs::read(&arguments[1]).map_err(|_| "could not read the updater archive".to_string())?;
    let signature_text = fs::read_to_string(&arguments[2])
        .map_err(|_| "could not read the updater signature".to_string())?;
    verify_update_signature(&archive, &signature_text, &arguments[3], &arguments[4])?;
    println!(
        "Tauri updater signature verified for version {}.",
        arguments[4]
    );
    Ok(())
}

fn verify_update_signature(
    data: &[u8],
    signature_base64: &str,
    public_key_base64: &str,
    version: &str,
) -> Result<(), String> {
    let public_key_text = decode_base64_text(public_key_base64, "public key")?;
    let signature_text = decode_base64_text(signature_base64.trim(), "signature")?;
    let public_key = PublicKey::decode(&public_key_text)
        .map_err(|_| "the updater public key is invalid".to_string())?;
    let signature = Signature::decode(&signature_text)
        .map_err(|_| "the updater signature is invalid".to_string())?;
    public_key.verify(data, &signature, true).map_err(|_| {
        "the updater archive does not match its cryptographic signature".to_string()
    })?;

    let signed_version = signature
        .trusted_comment()
        .split('\t')
        .find_map(|field| field.strip_prefix("version:"))
        .ok_or_else(|| "the signed updater metadata does not include a version".to_string())?;
    if signed_version.trim_start_matches('v') != version.trim_start_matches('v') {
        return Err("the updater signature is bound to a different version".to_string());
    }
    Ok(())
}

fn decode_base64_text(value: &str, description: &str) -> Result<String, String> {
    let decoded = STANDARD
        .decode(value)
        .map_err(|_| format!("the updater {description} is not valid base64"))?;
    String::from_utf8(decoded).map_err(|_| format!("the updater {description} is not UTF-8"))
}

#[cfg(test)]
mod tests {
    use super::{decode_base64_text, verify_update_signature};
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;

    const MINISIGN_PUBLIC_KEY: &str = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
    const MINISIGN_SIGNATURE: &str = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==";

    #[test]
    fn parses_tauri_encoded_public_key_and_signature() {
        let key = STANDARD.encode(format!(
            "untrusted comment: minisign public key\n{MINISIGN_PUBLIC_KEY}"
        ));
        let signature = STANDARD.encode(MINISIGN_SIGNATURE);
        assert!(decode_base64_text(&key, "public key").is_ok());
        assert!(decode_base64_text(&signature, "signature").is_ok());
    }

    #[test]
    fn rejects_signatures_without_version_binding() {
        let key = STANDARD.encode(format!(
            "untrusted comment: minisign public key\n{MINISIGN_PUBLIC_KEY}"
        ));
        let signature = STANDARD.encode(MINISIGN_SIGNATURE);
        assert_eq!(
            verify_update_signature(b"test", &signature, &key, "0.1.0").unwrap_err(),
            "the signed updater metadata does not include a version"
        );
    }

    #[test]
    fn rejects_invalid_or_modified_signature_input_without_printing_it() {
        let key = STANDARD.encode(format!(
            "untrusted comment: minisign public key\n{MINISIGN_PUBLIC_KEY}"
        ));
        let signature = STANDARD.encode(MINISIGN_SIGNATURE);
        assert_eq!(
            verify_update_signature(b"hostile sentinel", &signature, &key, "0.1.0").unwrap_err(),
            "the updater archive does not match its cryptographic signature"
        );
    }
}
