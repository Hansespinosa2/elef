//! Strict remote-image policy for desktop PPTX export.
//!
//! Ported from `Presentations::PptxExport::RemoteImageFetcher` plus
//! `remote_image_data_uri`
//! (`apps/web/app/services/presentations/pptx_export.rb`). The webview cannot
//! fetch remote bytes itself — the desktop CSP restricts `connect-src` to
//! IPC — so the desktop `prepareMedia` seam routes remote URLs through the
//! `fetch_remote_image` command below, which applies the same policy the
//! server applies before inlining: HTTPS-only on port 443, no userinfo,
//! public-DNS pinning, a 3-redirect cap, connect/read timeouts, the image
//! content-type allowlist, and the 10 MB per-image cap. Error messages match
//! the server verbatim so both hosts fail the same Work the same way. The
//! 30 MB per-export total stays in the JS seam, which sees every image;
//! per-image HTTP behavior here is what must stay byte-identical.

use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::OnceLock;
use std::time::Duration;

use base64::Engine as _;
use futures_util::StreamExt as _;
use ipnet::IpNet;
use reqwest::redirect::Policy;
use url::Url;

use crate::error::CommandError;

pub(crate) const MAX_REMOTE_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_REDIRECTS: u32 = 3;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const READ_TIMEOUT: Duration = Duration::from_secs(5);

// Ported from BLOCKED_NETWORKS in pptx_export.rb: any resolved address
// inside these networks rejects the host (SSRF pinning).
const BLOCKED_NETWORKS: &[&str] = &[
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.88.99.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4",
    "::/128",
    "::1/128",
    "::ffff:0:0/96",
    "64:ff9b::/96",
    "64:ff9b:1::/48",
    "100::/64",
    "2001::/23",
    "2001:db8::/32",
    "2002::/16",
    "fc00::/7",
    "fe80::/10",
    "fec0::/10",
    "ff00::/8",
];

fn blocked_networks() -> &'static [IpNet] {
    static NETWORKS: OnceLock<Vec<IpNet>> = OnceLock::new();
    NETWORKS.get_or_init(|| {
        BLOCKED_NETWORKS
            .iter()
            .map(|network| {
                network
                    .parse()
                    .expect("blocked remote-image networks are static and valid")
            })
            .collect()
    })
}

fn policy_error(message: &'static str) -> CommandError {
    CommandError::new("invalid_input", message, false)
}

fn fetch_failed() -> CommandError {
    policy_error("A linked image could not be fetched for PPTX export.")
}

pub(crate) fn blocked_address(address: &IpAddr) -> bool {
    // Mirror Ruby's ipv4_mapped? normalization before the network check.
    let normalized = match address {
        IpAddr::V6(mapped) => mapped.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(*address),
        IpAddr::V4(_) => *address,
    };
    blocked_networks()
        .iter()
        .any(|network| network.contains(&normalized))
}

fn validate_image_url(raw_url: &str) -> Result<Url, CommandError> {
    // Ruby parses leniently and rejects non-HTTPS with the policy message;
    // anything the strict parser refuses is likewise not a public HTTPS URL.
    let url = Url::parse(raw_url).map_err(|_| {
        policy_error("Only public HTTPS images on port 443 can be embedded in a PPTX.")
    })?;
    let https_only = url.scheme() == "https"
        && url.host_str().is_some_and(|host| !host.is_empty())
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none();
    if https_only {
        Ok(url)
    } else {
        Err(policy_error(
            "Only public HTTPS images on port 443 can be embedded in a PPTX.",
        ))
    }
}

fn select_public_address(addresses: &[IpAddr]) -> Result<IpAddr, CommandError> {
    let mut unique: Vec<IpAddr> = Vec::with_capacity(addresses.len());
    for address in addresses {
        if !unique.contains(address) {
            unique.push(*address);
        }
    }
    let Some(first) = unique.first().copied() else {
        return Err(policy_error("A linked image host could not be resolved."));
    };
    if unique.iter().any(blocked_address) {
        return Err(policy_error(
            "A linked image host must resolve to public internet addresses.",
        ));
    }
    Ok(first)
}

async fn public_address_for(host: &str) -> Result<IpAddr, CommandError> {
    // Name resolution is blocking; keep it off the async executor. A
    // resolver failure surfaces as a fetch failure, matching Ruby's rescue.
    let host = host.to_owned();
    let resolved = tauri::async_runtime::spawn_blocking(move || {
        (host.as_str(), 443)
            .to_socket_addrs()
            .map(|addrs| addrs.map(|addr| addr.ip()).collect::<Vec<_>>())
    })
    .await
    .map_err(|_| fetch_failed())?
    .map_err(|_| fetch_failed())?;
    select_public_address(&resolved)
}

fn ensure_tls_provider() {
    // reqwest builds on rustls-no-provider (shared with the updater); the
    // ring provider ships in the tree, so install it exactly as the updater
    // does instead of pulling a second TLS stack.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

fn pinned_client(host: &str, address: IpAddr) -> Result<reqwest::Client, CommandError> {
    ensure_tls_provider();
    let mut builder = reqwest::Client::builder()
        .redirect(Policy::none())
        .no_proxy()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT);
    // IP-literal hosts need no pinning: without DNS there is nothing to
    // override, and the connection already targets the validated address.
    if host.parse::<IpAddr>().is_err() {
        builder = builder.resolve(host, SocketAddr::new(address, 443));
    }
    builder.build().map_err(|_| fetch_failed())
}

enum FetchOutcome {
    Image {
        bytes: Vec<u8>,
        content_type: String,
    },
    Redirect(String),
}

async fn fetch_once(client: &reqwest::Client, url: &Url) -> Result<FetchOutcome, CommandError> {
    let response = client
        .get(url.clone())
        .header(
            reqwest::header::ACCEPT,
            "image/png,image/jpeg,image/gif,image/webp,image/svg+xml",
        )
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|_| fetch_failed())?;
    if response.status().is_redirection() {
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        return Ok(FetchOutcome::Redirect(location));
    }
    if !response.status().is_success() {
        return Err(fetch_failed());
    }
    check_content_length(response.content_length())?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .to_lowercase();
    let mut body: Vec<u8> = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| fetch_failed())?;
        body.extend_from_slice(&chunk);
        check_body_cap(body.len())?;
    }
    Ok(FetchOutcome::Image {
        bytes: body,
        content_type,
    })
}

fn check_content_length(len: Option<u64>) -> Result<(), CommandError> {
    if len.is_some_and(|len| len > MAX_REMOTE_IMAGE_BYTES as u64) {
        return Err(policy_error(
            "A linked image exceeds the 10 MB PPTX export limit.",
        ));
    }
    Ok(())
}

fn check_body_cap(body_len: usize) -> Result<(), CommandError> {
    if body_len > MAX_REMOTE_IMAGE_BYTES {
        return Err(policy_error(
            "A linked image exceeds the 10 MB PPTX export limit.",
        ));
    }
    Ok(())
}

fn check_redirect_budget(redirects: u32) -> Result<(), CommandError> {
    if redirects > MAX_REDIRECTS {
        return Err(policy_error("A linked image redirects too many times."));
    }
    Ok(())
}

fn join_redirect(current: &Url, location: &str) -> Result<Url, CommandError> {
    if location.trim().is_empty() {
        return Err(policy_error(
            "A linked image redirected without a destination.",
        ));
    }
    current.join(location).map_err(|_| fetch_failed())
}

fn validate_image_content_type(content_type: &str) -> Result<&str, CommandError> {
    // Ported from remote_image_data_uri's allowlist: png, jpeg/jpg, gif,
    // webp, svg+xml. The caller strips parameters and lowercases first.
    match content_type {
        "image/png" | "image/jpeg" | "image/jpg" | "image/gif" | "image/webp" | "image/svg+xml" => {
            Ok(content_type)
        }
        _ => Err(policy_error(
            "A linked image uses an unsupported image format.",
        )),
    }
}

fn image_data_uri(content_type: &str, bytes: &[u8]) -> String {
    format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

pub(crate) async fn fetch_remote_image_data_uri(raw_url: &str) -> Result<String, CommandError> {
    let mut current = raw_url.to_owned();
    let mut redirects = 0u32;
    loop {
        // Order mirrors request(): validate the URL, then the redirect
        // budget, so a non-HTTPS redirect target reports the HTTPS policy.
        let url = validate_image_url(&current)?;
        check_redirect_budget(redirects)?;
        // host_str() keeps IPv6 brackets; resolve the unbracketed form
        // exactly as Ruby's hostname does.
        let host = match url.host() {
            Some(url::Host::Domain(domain)) => domain.to_owned(),
            Some(url::Host::Ipv4(address)) => address.to_string(),
            Some(url::Host::Ipv6(address)) => address.to_string(),
            None => String::new(),
        };
        let address = public_address_for(&host).await?;
        let client = pinned_client(&host, address)?;
        match fetch_once(&client, &url).await? {
            FetchOutcome::Image {
                bytes,
                content_type,
            } => {
                let content_type = validate_image_content_type(&content_type)?;
                check_body_cap(bytes.len())?;
                return Ok(image_data_uri(content_type, &bytes));
            }
            FetchOutcome::Redirect(location) => {
                current = join_redirect(&url, &location)?.to_string();
                redirects += 1;
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn fetch_remote_image(url: String) -> Result<String, CommandError> {
    fetch_remote_image_data_uri(&url).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fetch_blocking(url: &str) -> Result<String, CommandError> {
        tauri::async_runtime::block_on(fetch_remote_image_data_uri(url))
    }

    #[test]
    fn image_urls_require_public_https_without_userinfo_on_port_443() {
        for rejected in [
            "http://example.com/image.png",
            "https://example.com:8443/image.png",
            "https://user@example.com/image.png",
            "https://user:pass@example.com/image.png",
            "https://",
            "elefasset://localhost/work-id/deadbeef",
            "data:image/png;base64,aGk=",
            "not a url",
        ] {
            let error = validate_image_url(rejected).unwrap_err();
            assert_eq!(
                error,
                policy_error("Only public HTTPS images on port 443 can be embedded in a PPTX."),
                "unexpected acceptance of {rejected}"
            );
        }
        for accepted in [
            "https://example.com/image.png",
            "https://example.com:443/image.png",
            "HTTPS://EXAMPLE.COM/image.png",
            "https://93.184.216.34/image.png",
        ] {
            validate_image_url(accepted)
                .unwrap_or_else(|_| panic!("unexpected rejection of {accepted}"));
        }
    }

    #[test]
    fn blocked_networks_reject_private_loopback_and_reserved_addresses() {
        // One representative per BLOCKED_NETWORKS entry plus the mapped form.
        for blocked in [
            "0.1.2.3",
            "10.1.2.3",
            "100.64.1.2",
            "127.0.0.1",
            "169.254.1.2",
            "172.16.1.2",
            "192.0.0.1",
            "192.0.2.1",
            "192.88.99.1",
            "192.168.1.2",
            "198.18.1.2",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "240.0.0.1",
            "::",
            "::1",
            "::ffff:10.0.0.1",
            "64:ff9b::1",
            "64:ff9b:1::1",
            "100::1",
            "2001::1",
            "2001:db8::1",
            "2002::1",
            "fc00::1",
            "fe80::1",
            "fec0::1",
            "ff00::1",
        ] {
            let address: IpAddr = blocked.parse().unwrap();
            assert!(blocked_address(&address), "{blocked} must be blocked");
        }
        for public in [
            "8.8.8.8",
            "93.184.216.34",
            "1.1.1.1",
            "2606:4700:4700::1111",
        ] {
            let address: IpAddr = public.parse().unwrap();
            assert!(!blocked_address(&address), "{public} must stay reachable");
        }
        // An IPv4-mapped public address normalizes to its public target.
        let mapped: IpAddr = "::ffff:8.8.8.8".parse().unwrap();
        assert!(!blocked_address(&mapped));
    }

    #[test]
    fn public_address_selection_rejects_empty_and_mixed_resolutions() {
        let error = select_public_address(&[]).unwrap_err();
        assert_eq!(
            error,
            policy_error("A linked image host could not be resolved.")
        );
        let mixed = ["93.184.216.34", "10.0.0.1"]
            .into_iter()
            .map(|addr| addr.parse().unwrap())
            .collect::<Vec<_>>();
        let error = select_public_address(&mixed).unwrap_err();
        assert_eq!(
            error,
            policy_error("A linked image host must resolve to public internet addresses.")
        );
        let public = ["93.184.216.34", "93.184.216.34"]
            .into_iter()
            .map(|addr| addr.parse().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            select_public_address(&public).unwrap(),
            "93.184.216.34".parse::<IpAddr>().unwrap()
        );
    }

    #[test]
    fn private_literal_hosts_reject_before_any_network_use() {
        for url in [
            "https://127.0.0.1/image.png",
            "https://10.0.0.1/image.png",
            "https://[::1]/image.png",
        ] {
            let error = fetch_blocking(url).unwrap_err();
            assert_eq!(
                error,
                policy_error("A linked image host must resolve to public internet addresses."),
                "unexpected result for {url}"
            );
        }
    }

    #[test]
    fn non_https_urls_reject_without_resolving() {
        let error = fetch_blocking("http://example.com/image.png").unwrap_err();
        assert_eq!(
            error,
            policy_error("Only public HTTPS images on port 443 can be embedded in a PPTX.")
        );
    }

    #[test]
    fn redirect_budget_allows_three_follows_then_rejects_the_loop() {
        assert_eq!(MAX_REDIRECTS, 3);
        for allowed in 0..=3 {
            check_redirect_budget(allowed).unwrap();
        }
        let error = check_redirect_budget(4).unwrap_err();
        assert_eq!(
            error,
            policy_error("A linked image redirects too many times.")
        );
    }

    #[test]
    fn redirect_targets_join_relatively_and_report_a_blank_destination() {
        let base = Url::parse("https://example.com/a/b.png").unwrap();
        assert_eq!(
            join_redirect(&base, "/c.png").unwrap().as_str(),
            "https://example.com/c.png"
        );
        assert_eq!(
            join_redirect(&base, "https://cdn.example.com/d.png")
                .unwrap()
                .as_str(),
            "https://cdn.example.com/d.png"
        );
        for blank in ["", "   "] {
            let error = join_redirect(&base, blank).unwrap_err();
            assert_eq!(
                error,
                policy_error("A linked image redirected without a destination.")
            );
        }
    }

    #[test]
    fn image_content_types_allow_only_the_server_formats() {
        for allowed in [
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/gif",
            "image/webp",
            "image/svg+xml",
        ] {
            assert_eq!(validate_image_content_type(allowed).unwrap(), allowed);
        }
        for rejected in [
            "",
            "image/bmp",
            "image/tiff",
            "image/avif",
            "video/mp4",
            "text/html",
            "application/octet-stream",
            "image/png ",
            "IMAGE/PNG",
        ] {
            let error = validate_image_content_type(rejected).unwrap_err();
            assert_eq!(
                error,
                policy_error("A linked image uses an unsupported image format."),
                "unexpected acceptance of {rejected}"
            );
        }
    }

    #[test]
    fn oversize_bodies_reject_above_ten_megabytes() {
        assert_eq!(MAX_REMOTE_IMAGE_BYTES, 10 * 1024 * 1024);
        check_content_length(None).unwrap();
        check_content_length(Some(MAX_REMOTE_IMAGE_BYTES as u64)).unwrap();
        check_body_cap(MAX_REMOTE_IMAGE_BYTES).unwrap();
        for oversize in [
            check_content_length(Some(MAX_REMOTE_IMAGE_BYTES as u64 + 1)).unwrap_err(),
            check_body_cap(MAX_REMOTE_IMAGE_BYTES + 1).unwrap_err(),
        ] {
            assert_eq!(
                oversize,
                policy_error("A linked image exceeds the 10 MB PPTX export limit.")
            );
        }
    }

    #[test]
    fn image_data_uris_carry_the_lowered_type_and_strict_base64() {
        assert_eq!(
            image_data_uri("image/png", b"hi"),
            "data:image/png;base64,aGk="
        );
        assert!(!image_data_uri("image/png", &[0u8; 60]).contains('\n'));
    }
}
