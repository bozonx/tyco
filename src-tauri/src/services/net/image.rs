//! Explicit user image downloads are public, credential-free requests.
use std::net::IpAddr;
use std::time::Duration;

use super::http::FetchRequest;
use super::request::{prepare, PreparedRequest, Protocol};
use crate::errors::AppError;
use crate::services::secrets::Secrets;

fn is_public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let [a, b, c, _] = address.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 168 || (b == 0 && (c == 0 || c == 2))))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(address) => {
            if let Some(mapped) = address.to_ipv4_mapped() {
                return is_public_address(IpAddr::V4(mapped));
            }
            let segments = address.segments();
            (segments[0] & 0xe000) == 0x2000
                && segments[0] != 0x2002
                && !(segments[0] == 0x2001 && matches!(segments[1], 0 | 2 | 0xdb8))
        }
    }
}

fn validate_request(request: &FetchRequest) -> Result<PreparedRequest, AppError> {
    if request.method != "GET" || request.body.is_some() || !request.headers.is_empty() {
        return Err(AppError::InvalidInput(
            "Image requests must be credential-free GET requests".into(),
        ));
    }
    let prepared = prepare(Protocol::Http, &request.url, &[], &Secrets::new())
        .map_err(AppError::InvalidInput)?;
    if !prepared.url.username().is_empty()
        || prepared.url.password().is_some()
        || !matches!(prepared.url.port_or_known_default(), Some(80 | 443))
    {
        return Err(AppError::InvalidInput("Unsupported image URL".into()));
    }
    Ok(prepared)
}

pub async fn prepare_image(
    request: &FetchRequest,
) -> Result<(PreparedRequest, reqwest::Client), AppError> {
    let prepared = validate_request(request)?;
    let host = prepared
        .url
        .host_str()
        .ok_or_else(|| AppError::InvalidInput("Image URL has no host".into()))?;
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let port = prepared.url.port_or_known_default().unwrap_or(443);
    let addresses = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::net::lookup_host((host, port)),
    )
    .await
    .map_err(|_| AppError::InvalidInput("Image host resolution timed out".into()))?
    .map_err(|_| AppError::InvalidInput("Could not resolve image host".into()))?
    .collect::<Vec<_>>();
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|address| !is_public_address(address.ip()))
    {
        return Err(AppError::InvalidInput(
            "Image URLs must resolve to public addresses".into(),
        ));
    }
    // Pin the checked addresses to prevent DNS rebinding, and bypass ambient proxies.
    let client = reqwest::Client::builder()
        .no_proxy()
        .resolve_to_addrs(host, &addresses)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| AppError::Failed(format!("Image client: {error}")))?;
    Ok((prepared, client))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_private_reserved_and_mapped_addresses() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "198.18.0.1",
            "203.0.113.1",
            "224.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "2001:db8::1",
            "2002:7f00:1::",
        ] {
            assert!(!is_public_address(ip.parse().unwrap()), "{ip}");
        }
        assert!(is_public_address("8.8.8.8".parse().unwrap()));
        assert!(is_public_address("2606:4700::1111".parse().unwrap()));
    }
    #[test]
    fn rejects_credentials_headers_and_non_get_methods() {
        let mut request = FetchRequest {
            method: "GET".into(),
            url: "https://example.com/image.png".into(),
            headers: vec![],
            body: None,
            purpose: Some(crate::services::net::http::FetchPurpose::ChatImage),
        };
        assert!(validate_request(&request).is_ok());
        request
            .headers
            .push(("authorization".into(), "tyco-secret:google".into()));
        assert!(validate_request(&request).is_err());
        request.headers.clear();
        request.url = "https://user:password@example.com/image.png".into();
        assert!(validate_request(&request).is_err());
        request.url = "https://example.com/image.png?key=tyco-secret%3Agoogle".into();
        assert!(validate_request(&request).is_err());
        request.url = "https://example.com/image.png".into();
        request.method = "POST".into();
        assert!(validate_request(&request).is_err());
    }
}
