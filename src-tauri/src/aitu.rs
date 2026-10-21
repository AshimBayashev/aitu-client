use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindow};
use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};

use crate::proto::{self, RemoteChat, RemoteMessage};

const API: &str = "https://api.aitu.io";
const LOGIN_WINDOW: &str = "aitu-login";

pub struct AituState {
    cookie: Mutex<String>,
    installation_id: Mutex<String>,
    user_id: Mutex<String>,
    name: Mutex<String>,
    http: reqwest::Client,
    login_busy: AtomicBool,
    login_done: AtomicBool,
}

impl AituState {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .http1_only()
            .no_proxy()
            .user_agent("AituDesktop/0.1")
            .build()
            .expect("http client");
        Self {
            cookie: Mutex::new(String::new()),
            installation_id: Mutex::new(String::new()),
            user_id: Mutex::new(String::new()),
            name: Mutex::new(String::new()),
            http,
            login_busy: AtomicBool::new(false),
            login_done: AtomicBool::new(false),
        }
    }

    pub fn load(&self, app: &AppHandle) {
        let Ok(path) = session_path(app) else {
            return;
        };
        let Ok(text) = std::fs::read_to_string(path) else {
            let id = uuid::Uuid::new_v4().to_string();
            *self.installation_id.lock().expect("installation") = id;
            let _ = self.save(app);
            return;
        };
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            return;
        };
        if let Some(id) = value.get("installation_id").and_then(Value::as_str) {
            *self.installation_id.lock().expect("installation") = id.to_string();
        }
        if self.installation_id.lock().expect("installation").is_empty() {
            *self.installation_id.lock().expect("installation") = uuid::Uuid::new_v4().to_string();
        }
        if let Some(cookie) = value.get("cookie").and_then(Value::as_str) {
            *self.cookie.lock().expect("cookie") = cookie.to_string();
        }
        if let Some(user_id) = value.get("user_id").and_then(Value::as_str) {
            *self.user_id.lock().expect("user") = user_id.to_string();
        }
        if let Some(name) = value.get("name").and_then(Value::as_str) {
            *self.name.lock().expect("name") = name.to_string();
        }
    }

    fn save(&self, app: &AppHandle) -> Result<(), String> {
        let path = session_path(app)?;
        let value = json!({
            "installation_id": self.installation_id.lock().expect("installation").clone(),
            "cookie": self.cookie.lock().expect("cookie").clone(),
            "user_id": self.user_id.lock().expect("user").clone(),
            "name": self.name.lock().expect("name").clone(),
        });
        std::fs::write(path, serde_json::to_string(&value).map_err(|err| err.to_string())?)
            .map_err(|err| err.to_string())
    }
}

fn session_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join("session.json"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub logged_in: bool,
    pub name: Option<String>,
    pub user_id: Option<String>,
}

#[tauri::command]
pub async fn session_status(app: AppHandle, state: State<'_, AituState>) -> Result<SessionStatus, String> {
    let cookie = state.cookie.lock().expect("cookie").clone();
    if cookie.is_empty() {
        return Ok(SessionStatus {
            logged_in: false,
            name: None,
            user_id: None,
        });
    }
    let installation = state.installation_id.lock().expect("installation").clone();
    match fetch_me(&state.http, &cookie, &installation).await {
        Ok(me) => {
            *state.user_id.lock().expect("user") = me.id.clone();
            *state.name.lock().expect("name") = me.name.clone();
            let _ = state.save(&app);
            Ok(SessionStatus {
                logged_in: true,
                name: Some(me.name),
                user_id: Some(me.id),
            })
        }
        Err(_) => {
            *state.cookie.lock().expect("cookie") = String::new();
            let _ = state.save(&app);
            Ok(SessionStatus {
                logged_in: false,
                name: None,
                user_id: None,
            })
        }
    }
}

#[tauri::command]
pub async fn begin_login(app: AppHandle, state: State<'_, AituState>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LOGIN_WINDOW) {
        window.set_focus().map_err(|err| err.to_string())?;
        return Ok(());
    }
    let installation = state.installation_id.lock().expect("installation").clone();
    let oauth = oauth_url(&state.http, &installation).await?;
    let url = Url::parse(&oauth).map_err(|err| err.to_string())?;
    state.login_done.store(false, Ordering::SeqCst);
    let window = WebviewWindowBuilder::new(&app, LOGIN_WINDOW, WebviewUrl::External(url))
        .title("Вход в Aitu")
        .inner_size(460.0, 740.0)
        .center()
        .on_page_load(|window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let host = payload.url().host_str().unwrap_or("");
            if host != "aitu.io" && host != "www.aitu.io" {
                return;
            }
            let app = window.app_handle().clone();
            let state = app.state::<AituState>();
            if state
                .login_busy
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                return;
            }
            let window = window.clone();
            std::thread::spawn(move || finish_login(app, window));
        })
        .build()
        .map_err(|err| err.to_string())?;
    let app_for_close = app.clone();
    window.on_window_event(move |event| {
        if !matches!(event, tauri::WindowEvent::Destroyed) {
            return;
        }
        let state = app_for_close.state::<AituState>();
        if state.login_done.swap(false, Ordering::SeqCst) {
            return;
        }
        state.login_busy.store(false, Ordering::SeqCst);
        let _ = app_for_close.emit("aitu-login-closed", json!({}));
    });
    Ok(())
}

#[tauri::command]
pub async fn logout(app: AppHandle, state: State<'_, AituState>) -> Result<(), String> {
    *state.cookie.lock().expect("cookie") = String::new();
    *state.user_id.lock().expect("user") = String::new();
    *state.name.lock().expect("name") = String::new();
    state.login_busy.store(false, Ordering::SeqCst);
    state.save(&app)?;
    if let Some(window) = app.get_webview_window(LOGIN_WINDOW) {
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
pub async fn list_dialogs(state: State<'_, AituState>) -> Result<Vec<RemoteChat>, String> {
    let cookie = require_cookie(&state)?;
    let installation = state.installation_id.lock().expect("installation").clone();
    let bytes = grpc(
        &state.http,
        &cookie,
        &installation,
        "/kz.btsd.messenger.dialogs.DialogService/GetDialogs",
        proto::encode_query_dialogs(),
    )
    .await?;
    let chats = proto::parse_dialogs(&bytes)?;
    if chats.is_empty() && bytes.len() > 200 {
        return Err(format!(
            "Aitu прислал список чатов, но разобрать его не удалось ({} байт)",
            bytes.len()
        ));
    }
    Ok(chats)
}

#[tauri::command]
pub async fn list_history(
    state: State<'_, AituState>,
    peer_id: String,
    peer_type: String,
) -> Result<Vec<RemoteMessage>, String> {
    let cookie = require_cookie(&state)?;
    let installation = state.installation_id.lock().expect("installation").clone();
    let code = proto::peer_code(&peer_type)?;
    let bytes = grpc(
        &state.http,
        &cookie,
        &installation,
        "/kz.btsd.messenger.messages.MessageService/GetHistory",
        proto::encode_query_history(&peer_id, code),
    )
    .await?;
    let me = state.user_id.lock().expect("user").clone();
    proto::parse_history(&bytes, &me, &peer_type)
}

#[tauri::command]
pub async fn send_message(
    state: State<'_, AituState>,
    peer_id: String,
    peer_type: String,
    local_id: String,
    text: String,
) -> Result<(), String> {
    let cookie = require_cookie(&state)?;
    let installation = state.installation_id.lock().expect("installation").clone();
    let code = proto::peer_code(&peer_type)?;
    let method = if peer_type == "CHANNEL" {
        "SendChannelMessage"
    } else {
        "SendMessage"
    };
    grpc(
        &state.http,
        &cookie,
        &installation,
        &format!("/kz.btsd.messenger.messages.MessageService/{method}"),
        proto::encode_send(&peer_id, code, &local_id, &text),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn mark_read(
    state: State<'_, AituState>,
    peer_id: String,
    peer_type: String,
    message_ids: Vec<String>,
) -> Result<(), String> {
    if message_ids.is_empty() {
        return Ok(());
    }
    let cookie = require_cookie(&state)?;
    let installation = state.installation_id.lock().expect("installation").clone();
    let code = proto::peer_code(&peer_type)?;
    grpc(
        &state.http,
        &cookie,
        &installation,
        "/kz.btsd.messenger.messages.MessageService/MessageReadCommand",
        proto::encode_read(&peer_id, code, &message_ids),
    )
    .await?;
    Ok(())
}

fn require_cookie(state: &AituState) -> Result<String, String> {
    let cookie = state.cookie.lock().expect("cookie").clone();
    if cookie.is_empty() {
        Err("Сначала войдите в Aitu".to_string())
    } else {
        Ok(cookie)
    }
}

struct Me {
    id: String,
    name: String,
}

fn finish_login(app: AppHandle, window: WebviewWindow) {
    let outcome = (|| {
        let state = app.state::<AituState>();
        let installation = state.installation_id.lock().expect("installation").clone();
        let mut last_error = "Сессия не появилась".to_string();
        for attempt in 0..2 {
            if attempt == 1 {
                std::thread::sleep(Duration::from_millis(600));
            }
            let cookie = match collect_cookies(&window) {
                Ok(cookie) => cookie,
                Err(error) => {
                    last_error = error;
                    continue;
                }
            };
            match fetch_me_blocking(&cookie, &installation) {
                Ok(me) => {
                    *state.cookie.lock().expect("cookie") = cookie;
                    *state.user_id.lock().expect("user") = me.id.clone();
                    *state.name.lock().expect("name") = me.name.clone();
                    state.save(&app)?;
                    return Ok(me);
                }
                Err(error) => last_error = error,
            }
        }
        Err(last_error)
    })();
    app.state::<AituState>().login_busy.store(false, Ordering::SeqCst);
    match outcome {
        Ok(me) => {
            let _ = app.emit(
                "aitu-session",
                json!({ "loggedIn": true, "name": me.name, "userId": me.id }),
            );
            app.state::<AituState>().login_done.store(true, Ordering::SeqCst);
            let _ = window.close();
        }
        Err(message) => {
            let _ = app.emit("aitu-login-error", json!({ "message": message }));
        }
    }
}

fn collect_cookies(window: &WebviewWindow) -> Result<String, String> {
    let mut pairs = std::collections::BTreeMap::<String, String>::new();
    for raw in ["https://api.aitu.io/", "https://aitu.io/", "https://passport.aitu.io/"] {
        let url = Url::parse(raw).map_err(|err| err.to_string())?;
        let cookies = window.cookies_for_url(url).map_err(|err| err.to_string())?;
        for cookie in cookies {
            if !cookie.value().is_empty() {
                pairs.insert(cookie.name().to_string(), cookie.value().to_string());
            }
        }
    }
    if pairs.is_empty() {
        return Err("Сессионная cookie не появилась".to_string());
    }
    Ok(pairs
        .iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; "))
}

async fn oauth_url(client: &reqwest::Client, installation: &str) -> Result<String, String> {
    let response = client
        .post(format!("{API}/twirp/kz.btsd.messenger.auth.AuthService/GetPassportOAuthUrl"))
        .headers(headers("", installation)?)
        .json(&json!({
            "url": "https://aitu.io/",
            "installation_id": installation,
        }))
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(format!("Вход: {}", explain(status, &text)));
    }
    let value: Value = serde_json::from_str(&text).map_err(|_| "Aitu не открыл страницу входа".to_string())?;
    value
        .get("oauth_url")
        .or_else(|| value.get("oauthUrl"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|url| !url.is_empty())
        .ok_or_else(|| "Aitu не открыл страницу входа".to_string())
}

async fn fetch_me(client: &reqwest::Client, cookie: &str, installation: &str) -> Result<Me, String> {
    let response = client
        .post(format!("{API}/twirp/kz.btsd.messenger.users.UserService/GetMe"))
        .headers(headers(cookie, installation)?)
        .json(&json!({}))
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(explain(status, &text));
    }
    parse_me(&text)
}

fn fetch_me_blocking(cookie: &str, installation: &str) -> Result<Me, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(25))
        .http1_only()
        .no_proxy()
        .user_agent("AituDesktop/0.1")
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .post(format!("{API}/twirp/kz.btsd.messenger.users.UserService/GetMe"))
        .headers(headers(cookie, installation)?)
        .json(&json!({}))
        .send()
        .map_err(|err| err.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(explain(status, &text));
    }
    parse_me(&text)
}

fn parse_me(text: &str) -> Result<Me, String> {
    let value: Value = serde_json::from_str(text).map_err(|_| "Aitu не вернул профиль".to_string())?;
    let user = value.get("user").cloned().unwrap_or(value);
    let id = string_field(&user, "id", "id");
    if id.is_empty() {
        return Err("Aitu не вернул профиль".to_string());
    }
    let first = string_field(&user, "first_name", "firstName");
    let last = string_field(&user, "last_name", "lastName");
    let username = string_field(&user, "username", "username");
    let name = format!("{first} {last}").trim().to_string();
    Ok(Me {
        id,
        name: if name.is_empty() { username } else { name },
    })
}

async fn grpc(
    client: &reqwest::Client,
    cookie: &str,
    installation: &str,
    path: &str,
    message: Vec<u8>,
) -> Result<Vec<u8>, String> {
    let mut frame = Vec::with_capacity(message.len() + 5);
    frame.push(0);
    frame.extend_from_slice(&u32::try_from(message.len()).unwrap_or(0).to_be_bytes());
    frame.extend_from_slice(&message);
    let body = STANDARD.encode(frame);
    let response = client
        .post(format!("{API}{path}"))
        .headers(headers(cookie, installation)?)
        .header(reqwest::header::CONTENT_TYPE, "application/grpc-web-text")
        .header(reqwest::header::ACCEPT, "application/grpc-web-text")
        .header("X-Grpc-Web", "1")
        .body(body)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status();
    let grpc_status = response
        .headers()
        .get("grpc-status")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let grpc_message = response
        .headers()
        .get("grpc-message")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    if status.as_u16() == 401 {
        return Err("Сессия закончилась. Войдите снова.".to_string());
    }
    if !status.is_success() {
        return Err(explain(status, &String::from_utf8_lossy(&bytes)));
    }
    if !grpc_status.is_empty() && grpc_status != "0" {
        return Err(if grpc_message.is_empty() {
            format!("Aitu отклонил запрос ({grpc_status})")
        } else {
            grpc_message
        });
    }
    let raw = decode_grpc_body(&content_type, &bytes)?;
    let (payload, trailers) = split_frames(&raw)?;
    if let Some(code) = trailer_value(&trailers, "grpc-status") {
        if code != "0" {
            let message = trailer_value(&trailers, "grpc-message").unwrap_or_default();
            return Err(if message.is_empty() {
                format!("Aitu отклонил запрос ({code})")
            } else {
                message
            });
        }
    }
    Ok(payload)
}

fn decode_grpc_body(content_type: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let compact: String = String::from_utf8_lossy(bytes)
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect();
    let textual = content_type.contains("grpc-web-text")
        || (!compact.is_empty()
            && compact.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=')
            }));
    if textual {
        return decode_grpc_web_text(&compact);
    }
    Ok(bytes.to_vec())
}

/// grpc-web-text склеивает кадры отдельными base64-строками. Знак `=` стоит в конце
/// кадра, поэтому весь ответ нельзя декодировать одной строкой.
fn decode_grpc_web_text(compact: &str) -> Result<Vec<u8>, String> {
    if compact.is_empty() {
        return Ok(Vec::new());
    }
    let bytes = compact.as_bytes();
    let mut out = Vec::new();
    let mut start = 0;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'=' {
            let mut end = index + 1;
            if end < bytes.len() && bytes[end] == b'=' {
                end += 1;
            }
            out.extend(decode_base64_chunk(&compact[start..end])?);
            start = end;
            index = end;
            continue;
        }
        index += 1;
    }
    if start < compact.len() {
        out.extend(decode_base64_chunk(&compact[start..])?);
    }
    Ok(out)
}

fn decode_base64_chunk(chunk: &str) -> Result<Vec<u8>, String> {
    let mut padded = chunk.to_string();
    while padded.len() % 4 != 0 {
        padded.push('=');
    }
    STANDARD
        .decode(padded)
        .map_err(|_| "Неполный ответ Aitu".to_string())
}

#[cfg(test)]
mod tests {
    use super::{decode_grpc_web_text, split_frames};
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    #[test]
    fn text_frames_are_decoded_separately_when_padding_sits_in_the_middle() {
        let message = STANDARD.encode([0, 0, 0, 0, 0]);
        let trailer = STANDARD.encode([0x80, 0, 0, 0, 5, b'a', b'b', b'c', b'd', b'e']);
        let raw = decode_grpc_web_text(&format!("{message}{trailer}")).unwrap();
        let (payload, trailers) = split_frames(&raw).unwrap();
        assert!(payload.is_empty());
        assert_eq!(trailers, "abcde");
    }
}

fn split_frames(bytes: &[u8]) -> Result<(Vec<u8>, String), String> {
    let mut index = 0;
    let mut payload = Vec::new();
    let mut trailers = String::new();
    while index + 5 <= bytes.len() {
        let flag = bytes[index];
        let len = u32::from_be_bytes([
            bytes[index + 1],
            bytes[index + 2],
            bytes[index + 3],
            bytes[index + 4],
        ]) as usize;
        index += 5;
        if index + len > bytes.len() {
            return Err("Неполный ответ Aitu".to_string());
        }
        let chunk = &bytes[index..index + len];
        index += len;
        if flag & 0x80 != 0 {
            trailers = String::from_utf8_lossy(chunk).into_owned();
        } else {
            payload.extend_from_slice(chunk);
        }
    }
    Ok((payload, trailers))
}

fn trailer_value(trailers: &str, name: &str) -> Option<String> {
    trailers.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.trim().eq_ignore_ascii_case(name) {
            Some(value.trim().to_string())
        } else {
            None
        }
    })
}

fn headers(cookie: &str, installation: &str) -> Result<reqwest::header::HeaderMap, String> {
    let mut map = reqwest::header::HeaderMap::new();
    map.insert("X-Application", header("Aitu")?);
    map.insert("X-App-Locale", header("ru")?);
    if !installation.is_empty() {
        map.insert("X-Device-Id", header(installation)?);
    }
    if !cookie.is_empty() {
        map.insert(reqwest::header::COOKIE, header(cookie)?);
    }
    Ok(map)
}

fn header(value: &str) -> Result<reqwest::header::HeaderValue, String> {
    reqwest::header::HeaderValue::from_str(value).map_err(|_| "Некорректный заголовок запроса".to_string())
}

fn explain(status: reqwest::StatusCode, body: &str) -> String {
    if status.as_u16() == 401 {
        return "Сессия закончилась. Войдите снова.".to_string();
    }
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        if let Some(message) = value.get("msg").and_then(Value::as_str) {
            return format!("{status}: {message}");
        }
    }
    let snippet: String = body.trim().chars().take(160).collect();
    if snippet.is_empty() {
        status.to_string()
    } else {
        format!("{status}: {snippet}")
    }
}

fn string_field(value: &Value, snake: &str, camel: &str) -> String {
    value
        .get(snake)
        .or_else(|| value.get(camel))
        .and_then(|item| match item {
            Value::String(text) => Some(text.clone()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        })
        .unwrap_or_default()
}
