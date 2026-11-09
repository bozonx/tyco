//! The id the system gives this machine: a copy of the device folder on
//! another machine, e.g. a restored backup or a cloned virtual machine, is
//! told apart by it.

/// The machine id, or `None` when the system does not tell it.
pub fn machine_id() -> Option<String> {
    read_machine_id()
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
}

#[cfg(target_os = "linux")]
fn read_machine_id() -> Option<String> {
    ["/etc/machine-id", "/var/lib/dbus/machine-id"]
        .iter()
        .find_map(|path| std::fs::read_to_string(path).ok())
}

#[cfg(target_os = "windows")]
fn read_machine_id() -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6464KEY,
    };

    let wide = |text: &str| text.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let subkey = wide("SOFTWARE\\Microsoft\\Cryptography");
    let value = wide("MachineGuid");
    let mut buffer = [0u16; 128];
    let mut size_bytes = std::mem::size_of_val(&buffer) as u32;
    // SAFETY: the strings are NUL-terminated and outlive the call; the
    // buffer and its size in bytes describe writable memory.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size_bytes,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    let length = (size_bytes as usize / 2).min(buffer.len());
    let text = String::from_utf16(&buffer[..length]).ok()?;
    Some(text.trim_end_matches('\0').to_owned())
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn read_machine_id() -> Option<String> {
    None
}

/// The name of this computer as the user knows it, for telling devices apart
/// in the settings; `None` when the system does not tell it.
pub fn host_name() -> Option<String> {
    read_host_name()
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
}

#[cfg(target_os = "windows")]
fn read_host_name() -> Option<String> {
    std::env::var("COMPUTERNAME").ok()
}

#[cfg(not(target_os = "windows"))]
fn read_host_name() -> Option<String> {
    std::fs::read_to_string("/etc/hostname")
        .ok()
        .or_else(|| std::env::var("HOSTNAME").ok())
}
