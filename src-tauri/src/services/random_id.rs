//! Random ids that name what more than one device may make: devices, keys.

/// A random UUID (version 4). The standard library seeds `RandomState` from
/// the system's random source; two of them and the clock give 128 bits that
/// no other device repeats.
pub fn new_uuid() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut bytes = Vec::with_capacity(48);
    for _ in 0..2 {
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_u128(crate::services::clock::now_ns());
        bytes.extend(hasher.finish().to_le_bytes());
    }
    bytes.extend(crate::services::clock::now_ns().to_le_bytes());
    bytes.extend(std::process::id().to_le_bytes());
    let digest = crate::services::sha256::sha256_hex(&bytes);
    let mut hex: Vec<char> = digest.chars().take(32).collect();
    // the version, and the variant of RFC 4122
    hex[12] = '4';
    hex[16] = ['8', '9', 'a', 'b'][hex[16].to_digit(16).unwrap_or(0) as usize % 4];
    let hex: String = hex.into_iter().collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuids_are_random_and_of_version_4() {
        let id = new_uuid();
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "4");
        assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
        assert_ne!(id, new_uuid());
    }
}
