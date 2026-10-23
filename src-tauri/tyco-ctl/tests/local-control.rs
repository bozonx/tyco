//! End-to-end CLI framing and transport tests, also runnable on Windows CI.
use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tyco_activation_protocol::{ErrorCode, Request, Response, API_VERSION};

#[test]
fn server_fixture() {
    if std::env::var_os("TYCO_TEST_CONTROL_SERVER").is_none() {
        return;
    }
    tyco_activation_protocol::transport::serve(|request| match request {
        Request::Status => Response::json(&serde_json::json!({"apiVersion":API_VERSION})),
        Request::ListJobs => Response::json(&serde_json::json!([{ "id": "test-job", "commandId": "test", "state": "failed" }])),
        Request::Run { request } => Response::json(&serde_json::json!({"id":"test-job","commandId":request.target,"state":"succeeded","output":request.text})),
        Request::JobStatus { .. } => Response::json(&serde_json::json!({"id":"test-job","commandId":"test","state":"failed","error":"Test failure","code":"ExecutionFailed"})),
        _ => Response::coded_error(ErrorCode::AccessDenied, "Test denial"),
    }).unwrap();
}

struct Server(Child, std::path::PathBuf);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
        let _ = std::fs::remove_dir_all(&self.1);
    }
}

#[test]
fn cli_round_trip_and_failures() {
    let directory = std::env::temp_dir().join(format!("tyco-control-test-{}", std::process::id()));
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&directory)
            .unwrap();
    }
    #[cfg(windows)]
    std::fs::create_dir_all(&directory).unwrap();
    let child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "server_fixture", "--nocapture"])
        .env("TYCO_TEST_CONTROL_SERVER", "1")
        .env("XDG_RUNTIME_DIR", &directory)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let _server = Server(child, directory.clone());
    let client = || {
        let mut command = Command::new(env!("CARGO_BIN_EXE_tyco-ctl"));
        command.env("XDG_RUNTIME_DIR", &directory);
        command
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if client().arg("status").output().unwrap().status.success() {
            break;
        }
        assert!(Instant::now() < deadline, "IPC server did not start");
        std::thread::sleep(Duration::from_millis(20));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let socket = directory.join("tyco-control/control.sock");
        assert_eq!(
            std::fs::metadata(&socket).unwrap().permissions().mode() & 0o777,
            0o600
        );
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            client().arg("status").output().unwrap().status.code(),
            Some(4)
        );
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    // An incomplete frame must not block other callers.
    #[cfg(unix)]
    let _idle_client = {
        let mut stream =
            std::os::unix::net::UnixStream::connect(directory.join("tyco-control/control.sock"))
                .unwrap();
        stream.write_all(b"{\"command\":").unwrap();
        stream
    };
    #[cfg(unix)]
    {
        use std::io::{BufRead, BufReader};
        let mut stream =
            std::os::unix::net::UnixStream::connect(directory.join("tyco-control/control.sock"))
                .unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream.write_all(b"{\"command\":\"quit\"}\n").unwrap();
        let mut response = String::new();
        BufReader::new(stream).read_line(&mut response).unwrap();
        let response: Response = serde_json::from_str(&response).unwrap();
        assert!(!response.success);
        assert_eq!(response.error_code(), ErrorCode::InvalidRequest);
        assert!(client().arg("status").output().unwrap().status.success());
    }
    let mut process = client()
        .args(["run", "test", "--stdin", "--wait"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let input = "Hello\n\u{1f642}\n\n";
    process
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    let output = process.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8(output.stdout).unwrap(), input);
    assert_eq!(
        client()
            .args(["jobs", "wait", "test-job"])
            .output()
            .unwrap()
            .status
            .code(),
        Some(5)
    );
    let list = client().args(["jobs", "list"]).output().unwrap();
    assert!(list.status.success());
    let jobs: serde_json::Value = serde_json::from_slice(&list.stdout).unwrap();
    assert_eq!(jobs[0]["id"], "test-job");
    let failure = client()
        .args(["jobs", "wait", "test-job", "--json"])
        .output()
        .unwrap();
    assert_eq!(failure.status.code(), Some(5));
    let job: serde_json::Value = serde_json::from_slice(&failure.stdout).unwrap();
    assert_eq!(job["state"], "failed");
    let error: serde_json::Value = serde_json::from_slice(&failure.stderr).unwrap();
    assert_eq!(error["code"], "ExecutionFailed");
    let denial = client()
        .args(["run", "test", "--replace", "--json"])
        .output()
        .unwrap();
    assert_eq!(denial.status.code(), Some(2));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&denial.stderr).unwrap()["code"],
        "InvalidInput"
    );
    for args in [
        ["run", "--help"],
        ["jobs", "--help"],
        ["commands", "--help"],
    ] {
        let help = client().args(args).output().unwrap();
        assert!(help.status.success());
        assert!(String::from_utf8(help.stdout)
            .unwrap()
            .starts_with("Usage:"));
    }
    assert_eq!(
        client().arg("quit").output().unwrap().status.code(),
        Some(2)
    );
    assert_eq!(
        client()
            .args(["run", "test", "--replace"])
            .output()
            .unwrap()
            .status
            .code(),
        Some(2)
    );
    drop(_server);
    let unavailable = client().args(["status", "--json"]).output().unwrap();
    assert_eq!(unavailable.status.code(), Some(4));
    assert!(unavailable.stdout.is_empty());
    let error: serde_json::Value = serde_json::from_slice(&unavailable.stderr).unwrap();
    assert_eq!(error["code"], "Unavailable");
    assert!(client()
        .args(["jobs", "list", "--help"])
        .output()
        .unwrap()
        .status
        .success());
}
