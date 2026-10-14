//! Request admission, authorization and task startup belong to the network service.
use super::{
    authorization::NetworkPolicy,
    http::{self, FetchRequest},
    request::Protocol,
    socket::{self, SocketRequest},
    EventSink, NetState,
};
use crate::errors::AppError;
use crate::services::secrets::Secrets;
use futures_util::future::Abortable;
use std::future::Future;
use tokio::sync::mpsc;

pub async fn fetch<S: EventSink>(
    net: &NetState,
    policy: NetworkPolicy,
    secret_snapshot: impl Future<Output = Result<Secrets, AppError>>,
    request: FetchRequest,
    sink: S,
) -> Result<u64, AppError> {
    let (task, registration) = net.register_task()?;
    let (prepared, client) = if request.purpose.as_deref() == Some("chat-image") {
        crate::services::net::image::prepare_image(&request).await?
    } else {
        if request.purpose.is_some() {
            return Err(AppError::InvalidInput(
                "Unknown network request purpose".into(),
            ));
        }
        let secrets = secret_snapshot.await?;
        let prepared = policy.prepare(Protocol::Http, &request.url, &request.headers, &secrets)?;
        (prepared, net.client().clone())
    };
    let method = http::parse_method(&request.method).map_err(AppError::InvalidInput)?;
    let body = http::decode_body(request.body.as_deref()).map_err(AppError::InvalidInput)?;

    let id = task.id();
    let chunk_permits = task.response_chunk_permits();
    let response_limit_bytes = if request.purpose.is_some() {
        10 * 1024 * 1024
    } else {
        http::MAX_RESPONSE_BODY_BYTES
    };

    tauri::async_runtime::spawn(async move {
        let run = http::run_fetch_controlled(
            &client,
            method,
            prepared,
            body,
            &sink,
            Some(chunk_permits),
            response_limit_bytes,
        );
        let _ = Abortable::new(run, registration).await;
        drop(task);
    });

    Ok(id)
}

pub async fn open_socket<S: EventSink>(
    net: &NetState,
    policy: NetworkPolicy,
    secret_snapshot: impl Future<Output = Result<Secrets, AppError>>,
    request: SocketRequest,
    sink: S,
) -> Result<u64, AppError> {
    let (task, registration) = net.register_task()?;
    let secrets = secret_snapshot.await?;
    let prepared = policy.prepare(
        Protocol::WebSocket,
        &request.url,
        &request.headers,
        &secrets,
    )?;
    let id = task.id();

    tauri::async_runtime::spawn(async move {
        let run = async {
            let connection = match socket::connect(&prepared, &request.protocols).await {
                Ok(connection) => connection,
                Err(message) => {
                    sink.send_event(&socket::SocketEvent::Error { message });
                    return;
                }
            };
            let (sender, receiver) = mpsc::channel(socket::SOCKET_QUEUE_CAPACITY);
            if !task.register_socket(sender) {
                return;
            }
            if sink.send_event(&socket::SocketEvent::Open) {
                socket::run_socket(connection, receiver, &sink).await;
            }
        };
        let _ = Abortable::new(run, registration).await;
        drop(task);
    });

    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Sink;
    impl EventSink for Sink {
        fn send_event<T: serde::Serialize>(&self, _: &T) -> bool {
            true
        }
        fn send_bytes(&self, _: Vec<u8>) -> bool {
            true
        }
    }
    fn request() -> FetchRequest {
        FetchRequest {
            method: "GET".into(),
            url: "https://example.com".into(),
            headers: Vec::new(),
            body: None,
            purpose: None,
        }
    }
    #[tokio::test]
    async fn failed_authorization_releases_admission_without_starting_a_request() {
        let net = NetState::new().unwrap();
        let result = fetch(
            &net,
            NetworkPolicy::default(),
            async { Ok(Secrets::new()) },
            request(),
            Sink,
        )
        .await;
        assert!(matches!(result, Err(AppError::InvalidInput(_))));
        assert!(net.wait_until(std::time::Instant::now()));
    }
    #[tokio::test]
    async fn shutdown_rejects_work_before_accessing_the_keychain() {
        let net = NetState::new().unwrap();
        net.close_all();
        let secrets = async { panic!("a stopping service must not access the keychain") };
        let result = fetch(&net, NetworkPolicy::default(), secrets, request(), Sink).await;
        assert!(matches!(result, Err(AppError::ServiceUnavailable(_))));
    }
}
