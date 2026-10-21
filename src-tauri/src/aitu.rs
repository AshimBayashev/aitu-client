use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindow};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};

use crate::proto::{self, RemoteChat, RemoteMessage};

const API: &str = "https://api.aitu.io";
const MEDIA_UPLOAD: &str = "https://media-upload.api.aitu.io/api/v1/media/uploadfile";
const MEDIA_DOWNLOAD: &str = "https://media-cdn.aitu.io/api/v2/media/download/file";
const LOGIN_WINDOW: &str = "aitu-login";
const MAX_UPLOAD_BYTES: u64 = 200 * 1024 * 1024;

pub struct AituState {
    cookie: Mutex<String>,
    installation_id: Mutex<String>,
    user_id: Mutex<String>,
    name: Mutex<String>,
    http: reqwest::Client,
    login_busy: AtomicBool,
    login_done: AtomicBool,
    active_chat: Mutex<Option<String>>,
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
            active_chat: Mutex::new(None),
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
    pub avatar: Option<String>,
}

#[tauri::command]
pub async fn session_status(app: AppHandle, state: State<'_, AituState>) -> Result<SessionStatus, String> {
    let cookie = state.cookie.lock().expect("cookie").clone();
    if cookie.is_empty() {
        return Ok(SessionStatus {
            logged_in: false,
            name: None,
            user_id: None,
            avatar: None,
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
                avatar: me.avatar,
            })
        }
        Err(_) => {
            *state.cookie.lock().expect("cookie") = String::new();
            let _ = state.save(&app);
            Ok(SessionStatus {
                logged_in: false,
                name: None,
                user_id: None,
                avatar: None,
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
    *state.active_chat.lock().expect("active") = None;
    state.login_busy.store(false, Ordering::SeqCst);
    state.save(&app)?;
    if let Some(window) = app.get_webview_window(LOGIN_WINDOW) {
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
pub fn set_active_chat(state: State<'_, AituState>, chat_id: Option<String>) {
    *state.active_chat.lock().expect("active") = chat_id.filter(|id| !id.is_empty());
}

pub fn start_message_watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut known: Option<HashMap<String, i64>> = None;
        loop {
            match tauri::async_runtime::block_on(poll_dialogs(&app)) {
                Poll::SignedOut => known = None,
                Poll::Unavailable => {}
                Poll::Ready(snapshot) => {
                    if let Some(before) = known.as_ref() {
                        notify_incoming(&app, before, &snapshot.chats);
                    }
                    known = Some(snapshot.unread);
                }
            }
            std::thread::sleep(Duration::from_secs(12));
        }
    });
}

enum Poll {
    SignedOut,
    Unavailable,
    Ready(DialogSnapshot),
}

struct DialogSnapshot {
    chats: Vec<RemoteChat>,
    unread: HashMap<String, i64>,
}

async fn poll_dialogs(app: &AppHandle) -> Poll {
    let state = app.state::<AituState>();
    let cookie = state.cookie.lock().expect("cookie").clone();
    if cookie.is_empty() {
        return Poll::SignedOut;
    }
    let installation = state.installation_id.lock().expect("installation").clone();
    let http = state.http.clone();
    drop(state);
    let Ok(bytes) = grpc(
        &http,
        &cookie,
        &installation,
        "/kz.btsd.messenger.dialogs.DialogService/GetDialogs",
        proto::encode_query_dialogs(),
    )
    .await
    else {
        return Poll::Unavailable;
    };
    let Ok(chats) = proto::parse_dialogs(&bytes) else {
        return Poll::Unavailable;
    };
    if chats.is_empty() && bytes.len() > 200 {
        return Poll::Unavailable;
    }
    let unread = chats.iter().map(|chat| (chat.id.clone(), chat.unread)).collect();
    Poll::Ready(DialogSnapshot { chats, unread })
}

fn notify_incoming(app: &AppHandle, previous: &HashMap<String, i64>, chats: &[RemoteChat]) {
    let state = app.state::<AituState>();
    let active = state.active_chat.lock().expect("active").clone();
    drop(state);
    let window = app.get_webview_window("main");
    let visible = window.as_ref().and_then(|item| item.is_visible().ok()).unwrap_or(false);
    let focused = window.as_ref().and_then(|item| item.is_focused().ok()).unwrap_or(false);
    for alert in incoming_alerts(previous, chats, active.as_deref(), visible && focused) {
        let _ = app
            .notification()
            .builder()
            .title(alert.title)
            .body(alert.body)
            .extra("chatId", alert.id)
            .show();
    }
}

struct Alert {
    id: String,
    title: String,
    body: String,
}

fn incoming_alerts(
    previous: &HashMap<String, i64>,
    chats: &[RemoteChat],
    active: Option<&str>,
    focused: bool,
) -> Vec<Alert> {
    let mut alerts = Vec::new();
    for chat in chats {
        let before = previous.get(&chat.id).copied().unwrap_or(0);
        if chat.unread <= before || chat.unread <= 0 {
            continue;
        }
        if focused && active == Some(chat.id.as_str()) {
            continue;
        }
        let title = if chat.title.trim().is_empty() {
            "Aitu".to_string()
        } else {
            chat.title.clone()
        };
        alerts.push(Alert {
            id: chat.id.clone(),
            title,
            body: preview_text(&chat.preview),
        });
    }
    alerts
}

fn preview_text(preview: &str) -> String {
    let trimmed = preview.trim();
    if trimmed.is_empty() {
        "Новое сообщение".to_string()
    } else {
        trimmed.chars().take(140).collect()
    }
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
    paths: Vec<String>,
) -> Result<(), String> {
    let caption = text.trim().to_string();
    if caption.is_empty() && paths.is_empty() {
        return Err("Нечего отправлять".to_string());
    }
    let cookie = require_cookie(&state)?;
    let installation = state.installation_id.lock().expect("installation").clone();
    let code = proto::peer_code(&peer_type)?;
    let mut files = Vec::new();
    for path in &paths {
        let uploaded = upload_file(&state.http, &cookie, &installation, path).await?;
        files.push(uploaded);
    }
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
        proto::encode_send(&peer_id, code, &local_id, &caption, &files),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn send_voice(
    state: State<'_, AituState>,
    peer_id: String,
    peer_type: String,
    local_id: String,
    data: String,
    mime: String,
) -> Result<(), String> {
    let (name, content_type) = voice_file(&mime)?;
    let bytes = STANDARD
        .decode(data.trim())
        .map_err(|_| "Не удалось прочитать запись".to_string())?;
    if bytes.is_empty() {
        return Err("Пустая запись".to_string());
    }
    if bytes.len() as u64 > 16 * 1024 * 1024 {
        return Err("Запись слишком длинная".to_string());
    }
    let cookie = require_cookie(&state)?;
    let installation = state.installation_id.lock().expect("installation").clone();
    let code = proto::peer_code(&peer_type)?;
    let uploaded = upload_bytes(
        &state.http,
        &cookie,
        &installation,
        name,
        content_type,
        bytes,
        3,
    )
    .await?;
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
        proto::encode_send(&peer_id, code, &local_id, "", &[uploaded]),
    )
    .await?;
    Ok(())
}

fn voice_file(mime: &str) -> Result<(&'static str, &'static str), String> {
    let base = mime
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match base.as_str() {
        "audio/wav" | "audio/x-wav" | "audio/wave" => Ok(("voice.wav", "audio/wav")),
        "audio/webm" => Ok(("voice.webm", "audio/webm")),
        "audio/ogg" => Ok(("voice.ogg", "audio/ogg")),
        "audio/mp4" | "audio/m4a" | "audio/aac" => Ok(("voice.m4a", "audio/mp4")),
        "audio/mpeg" => Ok(("voice.mp3", "audio/mpeg")),
        _ => Err("Неподдерживаемая запись".to_string()),
    }
}

#[tauri::command]
pub async fn open_attachment(app: AppHandle, file_id: String, name: String) -> Result<(), String> {
    let id = safe_id(&file_id)?;
    let file_name = safe_name(&name);
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("media")
        .join(&id);
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let path = dir.join(&file_name);
    if !path.is_file() {
        let response = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .http1_only()
            .no_proxy()
            .user_agent("AituDesktop/0.1")
            .build()
            .map_err(|err| err.to_string())?
            .get(format!("{MEDIA_DOWNLOAD}/{id}"))
            .send()
            .await
            .map_err(|_| "Не удалось скачать файл".to_string())?;
        if !response.status().is_success() {
            return Err("Не удалось скачать файл".to_string());
        }
        let bytes = response.bytes().await.map_err(|_| "Не удалось скачать файл".to_string())?;
        std::fs::write(&path, &bytes).map_err(|err| err.to_string())?;
    }
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|_| "Не удалось открыть файл".to_string())
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
    avatar: Option<String>,
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
                json!({ "loggedIn": true, "name": me.name, "userId": me.id, "avatar": me.avatar }),
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
        avatar: avatar_from_profile(&user),
    })
}

fn avatar_from_profile(user: &Value) -> Option<String> {
    let avatar = user.get("avatar")?;
    for key in ["small", "full"] {
        let id = avatar
            .get(key)
            .and_then(|image| image.get("file"))
            .and_then(|file| file.get("file_id").or_else(|| file.get("fileId")))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| {
                (8..=96).contains(&id.len())
                    && id.chars().all(|char| {
                        char.is_ascii_alphanumeric() || matches!(char, '-' | '_' | '?' | '=')
                    })
            });
        if id.is_some() {
            return id.map(str::to_string);
        }
    }
    None
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

async fn upload_file(
    client: &reqwest::Client,
    cookie: &str,
    installation: &str,
    path: &str,
) -> Result<(String, String, i32), String> {
    let file_path = std::path::PathBuf::from(path);
    let name = file_path
        .file_name()
        .and_then(|item| item.to_str())
        .filter(|item| !item.is_empty())
        .unwrap_or("file")
        .to_string();
    let kind = input_kind(&name);
    let mime = guess_mime(&name);
    let owned = file_path.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(owned))
        .await
        .map_err(|_| "Не удалось прочитать файл".to_string())?
        .map_err(|_| "Не удалось прочитать файл".to_string())?;
    upload_bytes(client, cookie, installation, &name, mime, bytes, kind).await
}

async fn upload_bytes(
    client: &reqwest::Client,
    cookie: &str,
    installation: &str,
    name: &str,
    mime: &str,
    bytes: Vec<u8>,
    kind: i32,
) -> Result<(String, String, i32), String> {
    if bytes.is_empty() {
        return Err("Пустой файл".to_string());
    }
    if bytes.len() as u64 > MAX_UPLOAD_BYTES {
        return Err("Файл больше 200 МБ".to_string());
    }
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(name.to_string())
        .mime_str(mime)
        .map_err(|_| "Не удалось подготовить файл".to_string())?;
    let response = client
        .post(MEDIA_UPLOAD)
        .timeout(Duration::from_secs(180))
        .headers(headers(cookie, installation)?)
        .multipart(reqwest::multipart::Form::new().part("file", part))
        .send()
        .await
        .map_err(|_| "Не удалось загрузить файл".to_string())?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(explain(status, &body));
    }
    let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let file_id = find_file_id(&value).ok_or_else(|| "Aitu не принял файл".to_string())?;
    Ok((file_id, name.to_string(), kind))
}

fn find_file_id(value: &Value) -> Option<String> {
    let direct = value
        .get("fileId")
        .or_else(|| value.get("file_id"))
        .and_then(Value::as_str)
        .filter(|item| !item.is_empty());
    if let Some(id) = direct {
        return Some(id.to_string());
    }
    let nested = value.as_object()?.values().find_map(find_file_id);
    nested
}

fn input_kind(name: &str) -> i32 {
    match extension(name).as_str() {
        "gif" => 6,
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "heic" => 1,
        "mp4" | "webm" | "mov" | "mkv" => 2,
        "mp3" | "wav" | "ogg" | "m4a" | "aac" => 3,
        _ => 0,
    }
}

fn guess_mime(name: &str) -> &'static str {
    match extension(name).as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "heic" => "image/heic",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" | "aac" => "audio/mp4",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}

fn extension(name: &str) -> String {
    name.rsplit_once('.')
        .map(|(_, ext)| ext.trim().to_ascii_lowercase())
        .unwrap_or_default()
}

fn safe_id(id: &str) -> Result<String, String> {
    if (8..=80).contains(&id.len())
        && id
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '-' || char == '_')
    {
        Ok(id.to_string())
    } else {
        Err("Некорректный файл".to_string())
    }
}

fn safe_name(name: &str) -> String {
    let base = std::path::Path::new(name)
        .file_name()
        .and_then(|item| item.to_str())
        .unwrap_or("file");
    let cleaned: String = base
        .chars()
        .map(|char| if char.is_control() || char == '/' || char == '\\' { '_' } else { char })
        .collect();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "file".to_string()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_grpc_web_text, incoming_alerts, split_frames};
    use crate::proto::RemoteChat;
    use std::collections::HashMap;
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

    fn chat(id: &str, unread: i64, title: &str) -> RemoteChat {
        RemoteChat {
            id: id.to_string(),
            title: title.to_string(),
            kind: "direct".to_string(),
            peer_type: "USER".to_string(),
            unread,
            members: None,
            online: false,
            preview: "preview".to_string(),
            last_at: 1,
            avatar: None,
        }
    }

    #[test]
    fn alerts_skip_the_open_chat_and_the_first_snapshot_baseline() {
        let mut previous = HashMap::new();
        previous.insert("open".to_string(), 1);
        previous.insert("other".to_string(), 0);
        let chats = vec![chat("open", 3, "Open"), chat("other", 2, "Other"), chat("quiet", 0, "Quiet")];
        let focused = incoming_alerts(&previous, &chats, Some("open"), true);
        assert_eq!(focused.len(), 1);
        assert_eq!(focused[0].id, "other");
        let hidden = incoming_alerts(&previous, &chats, Some("open"), false);
        assert_eq!(hidden.len(), 2);
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
