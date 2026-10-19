//! Calls from outside the app: `tyco-ctl` over the local socket and D-Bus
//! share one authorization and dispatch boundary, `api`.

pub mod access;
pub mod api;
pub mod command_library;
pub mod jobs;
