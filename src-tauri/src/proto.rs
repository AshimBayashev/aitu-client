//! Минимальный разбор protobuf для диалогов и истории Aitu.
//! Номера полей сняты с официального веб-клиента.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteChat {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub peer_type: String,
    pub unread: i64,
    pub members: Option<i64>,
    pub online: bool,
    pub preview: String,
    pub last_at: i64,
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMessage {
    pub id: String,
    pub outgoing: bool,
    pub text: String,
    pub sent_at: i64,
    pub author: Option<String>,
    pub files: Vec<RemoteFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply: Option<RemoteReply>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteReply {
    pub id: String,
    pub author: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    pub id: String,
    pub name: String,
    pub size: i64,
    pub kind: String,
}

#[derive(Clone)]
enum Val {
    Var(u64),
    Bytes(Vec<u8>),
}

pub fn encode_peer(id: &str, peer_type: i32) -> Vec<u8> {
    let mut out = Vec::new();
    write_str(&mut out, 1, id);
    write_var(&mut out, 2, peer_type as u64);
    out
}

pub fn encode_query_dialogs() -> Vec<u8> {
    Vec::new()
}

pub fn encode_query_history(peer_id: &str, peer_type: i32) -> Vec<u8> {
    let mut out = Vec::new();
    write_msg(&mut out, 1, &encode_peer(peer_id, peer_type));
    write_var(&mut out, 3, 40);
    out
}

pub fn encode_send(
    peer_id: &str,
    peer_type: i32,
    local_id: &str,
    text: &str,
    files: &[(String, String, i32)],
) -> Vec<u8> {
    let mut out = Vec::new();
    if peer_type == 2 {
        let mut channel = Vec::new();
        write_str(&mut channel, 1, peer_id);
        write_msg(&mut out, 1, &channel);
    } else {
        write_msg(&mut out, 1, &encode_peer(peer_id, peer_type));
    }
    write_str(&mut out, 2, local_id);
    if !text.is_empty() {
        write_str(&mut out, 3, text);
    }
    for (file_id, name, kind) in files {
        write_msg(&mut out, 4, &encode_input_media(file_id, name, *kind));
    }
    out
}

pub fn encode_reply(
    message_id: &str,
    peer_id: &str,
    peer_type: i32,
    local_id: &str,
    text: &str,
    files: &[(String, String, i32)],
) -> Vec<u8> {
    let mut out = Vec::new();
    write_str(&mut out, 1, message_id);
    write_msg(
        &mut out,
        2,
        &encode_send(peer_id, peer_type, local_id, text, files),
    );
    out
}

fn encode_input_media(file_id: &str, name: &str, kind: i32) -> Vec<u8> {
    let mut out = Vec::new();
    write_str(&mut out, 1, file_id);
    if !name.is_empty() {
        write_str(&mut out, 2, name);
    }
    if kind != 0 {
        write_var(&mut out, 3, kind as u64);
    }
    out
}

pub fn encode_read(peer_id: &str, peer_type: i32, message_ids: &[String]) -> Vec<u8> {
    let mut out = Vec::new();
    for id in message_ids {
        write_str(&mut out, 1, id);
    }
    write_msg(&mut out, 2, &encode_peer(peer_id, peer_type));
    out
}

pub fn parse_dialogs(bytes: &[u8]) -> Result<Vec<RemoteChat>, String> {
    let root = read_fields(bytes)?;
    let dialogs = if looks_like_dialogs(&root)? {
        root
    } else if let Some(inner) = first_msg(&root, 2) {
        read_fields(inner)?
    } else {
        root
    };

    let mut people = std::collections::HashMap::<String, Party>::new();
    for raw in msgs(&dialogs, 2) {
        if let Some((id, party)) = party_user(raw)? {
            people.insert(id, party);
        }
    }
    for raw in msgs(&dialogs, 5) {
        if let Some((id, party)) = party_channel(raw)? {
            people.insert(id, party);
        }
    }
    for raw in msgs(&dialogs, 6) {
        if let Some((id, party)) = party_bot(raw)? {
            people.insert(id, party);
        }
    }
    for raw in msgs(&dialogs, 8) {
        if let Some((id, party)) = party_group(raw)? {
            people.insert(id, party);
        }
    }
    for raw in msgs(&dialogs, 10) {
        if let Some((id, party)) = party_business(raw)? {
            people.insert(id, party);
        }
    }

    let mut previews = std::collections::HashMap::<String, (i64, String)>::new();
    for raw in msgs(&dialogs, 3) {
        if let Some(message) = parse_message(raw, "", "")? {
            let dialog_id = message.dialog_id;
            let better = previews
                .get(&dialog_id)
                .map(|(time, _)| message.sent_at >= *time)
                .unwrap_or(true);
            let label = preview_label(&message.text, &message.files);
            if better && !dialog_id.is_empty() && !label.is_empty() {
                previews.insert(dialog_id, (message.sent_at, label));
            }
        }
    }

    let mut chats = Vec::new();
    for raw in msgs(&dialogs, 1) {
        let fields = read_fields(raw)?;
        if var(&fields, 9) == Some(1) {
            continue;
        }
        let peer = match first_msg(&fields, 1) {
            Some(raw) => read_fields(raw)?,
            None => continue,
        };
        let id = text(&peer, 1);
        if id.is_empty() {
            continue;
        }
        let peer_type = peer_name(var(&peer, 2).unwrap_or(0));
        let party = people.get(&id);
        let title = party
            .map(|item| item.title.clone())
            .filter(|item| !item.is_empty())
            .unwrap_or_else(|| "Чат".to_string());
        let (preview_at, preview) = previews.get(&id).cloned().unwrap_or((0, String::new()));
        let last_at = millis(var(&fields, 3).unwrap_or(0));
        chats.push(RemoteChat {
            id,
            title,
            kind: kind_of(&peer_type).to_string(),
            peer_type,
            unread: var(&fields, 2).unwrap_or(0) as i64,
            members: party.and_then(|item| item.members),
            online: party.map(|item| item.online).unwrap_or(false),
            preview,
            last_at: if last_at > 0 { last_at } else { preview_at },
            avatar: party.and_then(|item| item.avatar.clone()),
        });
    }
    chats.sort_by(|a, b| b.last_at.cmp(&a.last_at));
    Ok(chats)
}

pub fn parse_history(
    bytes: &[u8],
    me: &str,
    peer_type: &str,
) -> Result<Vec<RemoteMessage>, String> {
    let root = read_fields(bytes)?;
    let mut names = std::collections::HashMap::<String, String>::new();
    for raw in msgs(&root, 3) {
        if let Some((id, party)) = party_user(raw)? {
            names.insert(id, party.title);
        }
    }
    for raw in msgs(&root, 5) {
        if let Some((id, party)) = party_bot(raw)? {
            names.insert(id, party.title);
        }
    }
    for raw in msgs(&root, 7) {
        let fields = read_fields(raw)?;
        let id = text(&fields, 1);
        let title = text(&fields, 2);
        if !id.is_empty() && !title.is_empty() {
            names.insert(id, title);
        }
    }

    let mut timeline = Vec::new();
    for raw in msgs(&root, 2) {
        if let Some(message) = parse_message(raw, me, peer_type)? {
            timeline.push(message);
        }
    }
    let mut sources = Vec::new();
    for raw in msgs(&root, 6) {
        if let Some(message) = parse_message(raw, me, peer_type)? {
            sources.push(message);
        }
    }
    let mut index = std::collections::HashMap::<String, &ParsedBody>::new();
    for message in sources.iter().chain(timeline.iter()) {
        index.entry(message.id.clone()).or_insert(message);
    }

    let mut messages = Vec::new();
    for message in &timeline {
        if message.text.is_empty() && message.files.is_empty() {
            continue;
        }
        let author = if message.outgoing || !matches!(peer_type, "GROUP" | "DISCUSSION") {
            None
        } else {
            names.get(&message.sender_id).filter(|name| !name.is_empty()).cloned()
        };
        messages.push(RemoteMessage {
            id: message.id.clone(),
            outgoing: message.outgoing,
            text: message.text.clone(),
            sent_at: message.sent_at,
            author,
            files: message.files.clone(),
            reply: quote_for(&message.reply_to, &index, &names),
        });
    }
    messages.sort_by(|a, b| a.sent_at.cmp(&b.sent_at).then(a.id.cmp(&b.id)));
    Ok(messages)
}

struct Party {
    title: String,
    members: Option<i64>,
    online: bool,
    avatar: Option<String>,
}

struct ParsedBody {
    id: String,
    dialog_id: String,
    sender_id: String,
    outgoing: bool,
    text: String,
    files: Vec<RemoteFile>,
    sent_at: i64,
    reply_to: String,
}

fn party_user(raw: &[u8]) -> Result<Option<(String, Party)>, String> {
    let fields = read_fields(raw)?;
    let id = text(&fields, 1);
    if id.is_empty() {
        return Ok(None);
    }
    let title = join_name(&text(&fields, 2), &text(&fields, 3), &text(&fields, 5));
    let online = first_msg(&fields, 8)
        .map(read_fields)
        .transpose()?
        .map(|status| first_msg(&status, 2).is_some())
        .unwrap_or(false);
    Ok(Some((
        id,
        Party {
            title,
            members: None,
            online,
            avatar: avatar_of(&fields, 7),
        },
    )))
}

fn party_group(raw: &[u8]) -> Result<Option<(String, Party)>, String> {
    let fields = read_fields(raw)?;
    let id = text(&fields, 1);
    if id.is_empty() {
        return Ok(None);
    }
    let count = var(&fields, 9).unwrap_or(0) as i64;
    Ok(Some((
        id,
        Party {
            title: text(&fields, 3),
            members: if count > 0 { Some(count) } else { None },
            online: false,
            avatar: avatar_of(&fields, 6),
        },
    )))
}

fn party_channel(raw: &[u8]) -> Result<Option<(String, Party)>, String> {
    let fields = read_fields(raw)?;
    let id = text(&fields, 1);
    if id.is_empty() {
        return Ok(None);
    }
    let count = var(&fields, 8).unwrap_or(0) as i64;
    Ok(Some((
        id,
        Party {
            title: text(&fields, 3),
            members: if count > 0 { Some(count) } else { None },
            online: false,
            avatar: avatar_of(&fields, 5),
        },
    )))
}

fn party_bot(raw: &[u8]) -> Result<Option<(String, Party)>, String> {
    let fields = read_fields(raw)?;
    let id = text(&fields, 1);
    if id.is_empty() {
        return Ok(None);
    }
    Ok(Some((
        id,
        Party {
            title: text(&fields, 2),
            members: None,
            online: false,
            avatar: avatar_of(&fields, 7),
        },
    )))
}

fn party_business(raw: &[u8]) -> Result<Option<(String, Party)>, String> {
    let fields = read_fields(raw)?;
    let id = text(&fields, 1);
    if id.is_empty() {
        return Ok(None);
    }
    Ok(Some((
        id,
        Party {
            title: text(&fields, 4),
            members: None,
            online: false,
            avatar: avatar_of(&fields, 11),
        },
    )))
}

fn avatar_of(fields: &[(u32, Val)], field: u32) -> Option<String> {
    let raw = first_msg(fields, field)?;
    let avatar = read_fields(raw).ok()?;
    for image_field in [2, 1] {
        let Some(image) = first_msg(&avatar, image_field) else {
            continue;
        };
        if let Ok(Some((id, _, _))) = nested_file(image) {
            return Some(id);
        }
    }
    None
}

fn parse_message(raw: &[u8], me: &str, _peer_type: &str) -> Result<Option<ParsedBody>, String> {
    let fields = read_fields(raw)?;
    let id = text(&fields, 1);
    if id.is_empty() {
        return Ok(None);
    }
    let sender = first_msg(&fields, 3).map(read_fields).transpose()?;
    let dialog = first_msg(&fields, 4).map(read_fields).transpose()?;
    let sender_id = sender.as_ref().map(|item| text(item, 1)).unwrap_or_default();
    let dialog_id = dialog.as_ref().map(|item| text(item, 1)).unwrap_or_default();
    let outgoing = !me.is_empty() && sender_id == me;
    let reply_to = text(&fields, 5);
    let (text, files) = message_parts(&fields)?;
    Ok(Some(ParsedBody {
        id,
        dialog_id,
        sender_id,
        outgoing,
        text,
        files,
        sent_at: millis(var(&fields, 2).unwrap_or(0)),
        reply_to,
    }))
}

fn message_parts(fields: &[(u32, Val)]) -> Result<(String, Vec<RemoteFile>), String> {
    if let Some(raw) = first_msg(fields, 12)
        .or_else(|| first_msg(fields, 17))
        .or_else(|| first_msg(fields, 22))
    {
        let body = read_fields(raw)?;
        let mut files = Vec::new();
        for raw in msgs(&body, 3).into_iter().chain(msgs(&body, 7)) {
            if let Some(file) = media_file(raw)? {
                files.push(file);
            }
        }
        let text = text(&body, 1);
        if !text.is_empty() || !files.is_empty() {
            return Ok((text, files));
        }
    }
    if first_msg(fields, 13).is_some() {
        return Ok(("Служебное сообщение".to_string(), Vec::new()));
    }
    if first_msg(fields, 20).is_some() {
        return Ok(("Звонок".to_string(), Vec::new()));
    }
    if first_msg(fields, 16).is_some() {
        return Ok(("Вложение".to_string(), Vec::new()));
    }
    Ok((String::new(), Vec::new()))
}

fn media_file(raw: &[u8]) -> Result<Option<RemoteFile>, String> {
    let fields = read_fields(raw)?;
    const KINDS: [(u32, &str); 7] = [
        (11, "file"),
        (12, "image"),
        (13, "video"),
        (14, "audio"),
        (16, "sticker"),
        (17, "music"),
        (18, "gif"),
    ];
    for (field, kind) in KINDS {
        let Some(part) = first_msg(&fields, field) else {
            continue;
        };
        let Some((id, name, size)) = nested_file(part)? else {
            continue;
        };
        return Ok(Some(RemoteFile {
            id,
            name,
            size,
            kind: kind.to_string(),
        }));
    }
    Ok(None)
}

fn nested_file(raw: &[u8]) -> Result<Option<(String, String, i64)>, String> {
    let fields = read_fields(raw)?;
    let id = text(&fields, 1);
    if looks_like_file_id(&id) {
        return Ok(Some((id, text(&fields, 3), var(&fields, 4).unwrap_or(0) as i64)));
    }
    if let Some(inner) = first_msg(&fields, 1) {
        return nested_file(inner).or(Ok(None));
    }
    Ok(None)
}

fn looks_like_file_id(value: &str) -> bool {
    let len = value.chars().count();
    len >= 8
        && len <= 96
        && value
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || matches!(char, '-' | '_' | '?' | '='))
}

fn preview_label(text: &str, files: &[RemoteFile]) -> String {
    if !text.is_empty() {
        return text.to_string();
    }
    match files.first() {
        Some(file) if file.kind == "image" || file.kind == "gif" => "Фото".to_string(),
        Some(file) if file.kind == "video" => "Видео".to_string(),
        Some(file) if file.kind == "audio" && is_voice_name(&file.name) => "Голосовое сообщение".to_string(),
        Some(file) if file.kind == "audio" || file.kind == "music" => "Аудио".to_string(),
        Some(file) if file.kind == "sticker" => "Стикер".to_string(),
        Some(file) if !file.name.is_empty() => file.name.clone(),
        Some(_) => "Файл".to_string(),
        None => String::new(),
    }
}

fn quote_for(
    reply_to: &str,
    index: &std::collections::HashMap<String, &ParsedBody>,
    names: &std::collections::HashMap<String, String>,
) -> Option<RemoteReply> {
    if reply_to.is_empty() {
        return None;
    }
    let Some(source) = index.get(reply_to) else {
        return Some(RemoteReply {
            id: reply_to.to_string(),
            author: String::new(),
            text: "Сообщение".to_string(),
        });
    };
    let author = if source.outgoing {
        "Вы".to_string()
    } else {
        names
            .get(&source.sender_id)
            .filter(|name| !name.is_empty())
            .cloned()
            .unwrap_or_default()
    };
    Some(RemoteReply {
        id: reply_to.to_string(),
        author,
        text: quote_line(&source.text, &source.files),
    })
}

fn quote_line(text: &str, files: &[RemoteFile]) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if !flat.is_empty() {
        return trim_chars(&flat, 140);
    }
    let label = preview_label("", files);
    if label.is_empty() {
        "Сообщение".to_string()
    } else {
        label
    }
}

fn trim_chars(value: &str, max: usize) -> String {
    let mut chars = value.chars();
    let trimmed: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{trimmed}…")
    } else {
        trimmed
    }
}

fn is_voice_name(name: &str) -> bool {
    name.to_ascii_lowercase().starts_with("voice.")
}

fn looks_like_dialogs(fields: &[(u32, Val)]) -> Result<bool, String> {
    for raw in msgs(fields, 1) {
        let dialog = read_fields(raw)?;
        if let Some(peer) = first_msg(&dialog, 1) {
            let peer = read_fields(peer)?;
            if !text(&peer, 1).is_empty() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn peer_name(code: u64) -> String {
    match code {
        1 => "GROUP",
        2 => "CHANNEL",
        3 => "BOT",
        4 => "DISCUSSION",
        5 => "APP",
        6 => "BUSINESS_CHAT",
        _ => "USER",
    }
    .to_string()
}

fn kind_of(peer_type: &str) -> &'static str {
    match peer_type {
        "GROUP" | "DISCUSSION" => "group",
        "CHANNEL" => "channel",
        _ => "direct",
    }
}

pub fn peer_code(name: &str) -> Result<i32, String> {
    match name {
        "USER" => Ok(0),
        "GROUP" => Ok(1),
        "CHANNEL" => Ok(2),
        "BOT" => Ok(3),
        "DISCUSSION" => Ok(4),
        "APP" => Ok(5),
        "BUSINESS_CHAT" => Ok(6),
        _ => Err(format!("Неизвестный тип чата: {name}")),
    }
}

fn join_name(first: &str, last: &str, username: &str) -> String {
    let full = format!("{first} {last}").trim().to_string();
    if !full.is_empty() {
        full
    } else {
        username.to_string()
    }
}

fn millis(value: u64) -> i64 {
    if value == 0 {
        0
    } else if value < 10_000_000_000 {
        (value as i64).saturating_mul(1000)
    } else {
        value as i64
    }
}

fn read_fields(bytes: &[u8]) -> Result<Vec<(u32, Val)>, String> {
    let mut fields = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        let (key, next) = read_varint(bytes, index)?;
        index = next;
        let field = (key >> 3) as u32;
        let wire = (key & 7) as u8;
        if field == 0 {
            return Err("Повреждённый ответ Aitu".to_string());
        }
        match wire {
            0 => {
                let (value, next) = read_varint(bytes, index)?;
                index = next;
                fields.push((field, Val::Var(value)));
            }
            1 => {
                if index + 8 > bytes.len() {
                    return Err("Повреждённый ответ Aitu".to_string());
                }
                index += 8;
            }
            2 => {
                let (len, next) = read_varint(bytes, index)?;
                index = next;
                let len = len as usize;
                if index + len > bytes.len() {
                    return Err("Повреждённый ответ Aitu".to_string());
                }
                fields.push((field, Val::Bytes(bytes[index..index + len].to_vec())));
                index += len;
            }
            5 => {
                if index + 4 > bytes.len() {
                    return Err("Повреждённый ответ Aitu".to_string());
                }
                index += 4;
            }
            _ => return Err("Повреждённый ответ Aitu".to_string()),
        }
    }
    Ok(fields)
}

fn read_varint(bytes: &[u8], mut index: usize) -> Result<(u64, usize), String> {
    let mut value = 0u64;
    let mut shift = 0;
    while index < bytes.len() && shift < 64 {
        let byte = bytes[index];
        index += 1;
        value |= ((byte & 0x7f) as u64) << shift;
        if byte & 0x80 == 0 {
            return Ok((value, index));
        }
        shift += 7;
    }
    Err("Повреждённый ответ Aitu".to_string())
}

fn var(fields: &[(u32, Val)], number: u32) -> Option<u64> {
    fields.iter().find_map(|(field, value)| match value {
        Val::Var(value) if *field == number => Some(*value),
        _ => None,
    })
}

fn text(fields: &[(u32, Val)], number: u32) -> String {
    fields
        .iter()
        .find_map(|(field, value)| match value {
            Val::Bytes(bytes) if *field == number => Some(String::from_utf8_lossy(bytes).into_owned()),
            _ => None,
        })
        .unwrap_or_default()
}

fn first_msg<'a>(fields: &'a [(u32, Val)], number: u32) -> Option<&'a [u8]> {
    fields.iter().find_map(|(field, value)| match value {
        Val::Bytes(bytes) if *field == number => Some(bytes.as_slice()),
        _ => None,
    })
}

fn msgs<'a>(fields: &'a [(u32, Val)], number: u32) -> Vec<&'a [u8]> {
    fields
        .iter()
        .filter_map(|(field, value)| match value {
            Val::Bytes(bytes) if *field == number => Some(bytes.as_slice()),
            _ => None,
        })
        .collect()
}

fn write_var(out: &mut Vec<u8>, field: u32, value: u64) {
    write_key(out, field, 0);
    write_varint(out, value);
}

fn write_str(out: &mut Vec<u8>, field: u32, value: &str) {
    write_bytes(out, field, value.as_bytes());
}

fn write_msg(out: &mut Vec<u8>, field: u32, value: &[u8]) {
    write_bytes(out, field, value);
}

fn write_bytes(out: &mut Vec<u8>, field: u32, value: &[u8]) {
    write_key(out, field, 2);
    write_varint(out, value.len() as u64);
    out.extend_from_slice(value);
}

fn write_key(out: &mut Vec<u8>, field: u32, wire: u8) {
    write_varint(out, ((field as u64) << 3) | wire as u64);
}

fn write_varint(out: &mut Vec<u8>, mut value: u64) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if value == 0 {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peer_bytes_match_the_wire_format() {
        assert_eq!(encode_peer("ab", 0), vec![0x0a, 0x02, b'a', b'b', 0x10, 0x00]);
    }

    #[test]
    fn reply_command_names_the_message_and_carries_the_text() {
        let bytes = encode_reply("m-origin", "u1", 0, "local", "Да", &[]);
        let fields = read_fields(&bytes).unwrap();
        assert_eq!(text(&fields, 1), "m-origin");
        let nested = read_fields(first_msg(&fields, 2).unwrap()).unwrap();
        assert_eq!(text(&nested, 2), "local");
        assert_eq!(text(&nested, 3), "Да");
    }

    #[test]
    fn dialogs_round_trip_names_and_preview() {
        let mut user = Vec::new();
        write_str(&mut user, 1, "u1");
        write_str(&mut user, 2, "Айгерим");
        let peer = encode_peer("u1", 0);
        let mut dialog = Vec::new();
        write_msg(&mut dialog, 1, &peer);
        write_var(&mut dialog, 2, 2);
        write_var(&mut dialog, 3, 1_700_000_000_000);
        let mut data = Vec::new();
        write_str(&mut data, 1, "привет");
        let mut message = Vec::new();
        write_str(&mut message, 1, "m1");
        write_var(&mut message, 2, 1_700_000_000_000);
        write_msg(&mut message, 4, &peer);
        write_msg(&mut message, 12, &data);
        let mut dialogs = Vec::new();
        write_msg(&mut dialogs, 1, &dialog);
        write_msg(&mut dialogs, 2, &user);
        write_msg(&mut dialogs, 3, &message);
        let mut root = Vec::new();
        write_msg(&mut root, 2, &dialogs);

        let chats = parse_dialogs(&root).unwrap();
        assert_eq!(chats.len(), 1);
        assert_eq!(chats[0].title, "Айгерим");
        assert_eq!(chats[0].preview, "привет");
        assert_eq!(chats[0].unread, 2);
        assert_eq!(chats[0].peer_type, "USER");
        assert_eq!(chats[0].last_at, 1_700_000_000_000);
    }

    #[test]
    fn history_keeps_a_document_without_caption() {
        let mut file = Vec::new();
        write_str(&mut file, 1, "11111111-2222-3333-4444-555555555555");
        write_str(&mut file, 3, "заметка.txt");
        write_var(&mut file, 4, 120);
        let mut document = Vec::new();
        write_msg(&mut document, 1, &file);
        let mut media = Vec::new();
        write_msg(&mut media, 11, &document);
        let mut data = Vec::new();
        write_msg(&mut data, 3, &media);
        let peer = encode_peer("u1", 0);
        let mut message = Vec::new();
        write_str(&mut message, 1, "m-file");
        write_var(&mut message, 2, 1_700_000_000_000);
        write_msg(&mut message, 3, &peer);
        write_msg(&mut message, 4, &peer);
        write_msg(&mut message, 12, &data);
        let mut root = Vec::new();
        write_msg(&mut root, 2, &message);

        let messages = parse_history(&root, "me", "USER").unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].text, "");
        assert_eq!(messages[0].files.len(), 1);
        assert_eq!(messages[0].files[0].name, "заметка.txt");
        assert_eq!(messages[0].files[0].kind, "file");
        assert_eq!(messages[0].files[0].size, 120);
    }

    #[test]
    fn history_reads_an_image_nested_inside_media() {
        let mut file = Vec::new();
        write_str(&mut file, 1, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        write_str(&mut file, 3, "photo.jpg");
        write_var(&mut file, 4, 80);
        let mut image = Vec::new();
        write_msg(&mut image, 1, &file);
        write_var(&mut image, 2, 100);
        write_var(&mut image, 3, 40);
        let mut media_image = Vec::new();
        write_msg(&mut media_image, 1, &image);
        let mut media = Vec::new();
        write_msg(&mut media, 12, &media_image);
        let mut data = Vec::new();
        write_str(&mut data, 1, "смотри");
        write_msg(&mut data, 3, &media);
        let peer = encode_peer("u1", 0);
        let mut message = Vec::new();
        write_str(&mut message, 1, "m-img");
        write_var(&mut message, 2, 1_700_000_000_000);
        write_msg(&mut message, 3, &peer);
        write_msg(&mut message, 12, &data);
        let mut root = Vec::new();
        write_msg(&mut root, 2, &message);

        let messages = parse_history(&root, "u1", "USER").unwrap();
        assert_eq!(messages[0].text, "смотри");
        assert!(messages[0].outgoing);
        assert_eq!(messages[0].files[0].kind, "image");
        assert_eq!(messages[0].files[0].name, "photo.jpg");
    }

    #[test]
    fn dialog_uses_the_small_avatar() {
        let mut file = Vec::new();
        write_str(&mut file, 1, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?thumb");
        let mut image = Vec::new();
        write_msg(&mut image, 1, &file);
        let mut avatar = Vec::new();
        write_msg(&mut avatar, 2, &image);
        let mut user = Vec::new();
        write_str(&mut user, 1, "u1");
        write_str(&mut user, 2, "Айгерим");
        write_msg(&mut user, 7, &avatar);
        let peer = encode_peer("u1", 0);
        let mut dialog = Vec::new();
        write_msg(&mut dialog, 1, &peer);
        let mut dialogs = Vec::new();
        write_msg(&mut dialogs, 1, &dialog);
        write_msg(&mut dialogs, 2, &user);
        let mut root = Vec::new();
        write_msg(&mut root, 2, &dialogs);

        let chats = parse_dialogs(&root).unwrap();
        assert_eq!(
            chats[0].avatar.as_deref(),
            Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?thumb")
        );
    }

    #[test]
    fn history_shows_who_a_message_replies_to() {
        let me = encode_peer("me", 0);
        let them = encode_peer("u1", 0);
        let mut user = Vec::new();
        write_str(&mut user, 1, "u1");
        write_str(&mut user, 2, "Айгерим");

        let mut origin_body = Vec::new();
        write_str(&mut origin_body, 1, "Ты на связи?");
        let mut origin = Vec::new();
        write_str(&mut origin, 1, "m-origin");
        write_var(&mut origin, 2, 1_700_000_000_000);
        write_msg(&mut origin, 3, &them);
        write_msg(&mut origin, 12, &origin_body);

        let mut reply_body = Vec::new();
        write_str(&mut reply_body, 1, "Да, кидай.");
        let mut reply = Vec::new();
        write_str(&mut reply, 1, "m-reply");
        write_var(&mut reply, 2, 1_700_000_060_000);
        write_msg(&mut reply, 3, &me);
        write_str(&mut reply, 5, "m-origin");
        write_msg(&mut reply, 12, &reply_body);

        let mut photo = Vec::new();
        write_str(&mut photo, 1, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        let mut image = Vec::new();
        write_msg(&mut image, 1, &photo);
        let mut media = Vec::new();
        write_msg(&mut media, 12, &image);
        let mut photo_body = Vec::new();
        write_msg(&mut photo_body, 3, &media);
        let mut photo_message = Vec::new();
        write_str(&mut photo_message, 1, "m-photo");
        write_var(&mut photo_message, 2, 1_699_000_000_000);
        write_msg(&mut photo_message, 3, &me);
        write_msg(&mut photo_message, 12, &photo_body);
        let mut photo_reply_body = Vec::new();
        write_str(&mut photo_reply_body, 1, "видел");
        let mut photo_reply = Vec::new();
        write_str(&mut photo_reply, 1, "m-photo-reply");
        write_var(&mut photo_reply, 2, 1_700_000_120_000);
        write_msg(&mut photo_reply, 3, &them);
        write_str(&mut photo_reply, 5, "m-photo");
        write_msg(&mut photo_reply, 12, &photo_reply_body);

        let mut root = Vec::new();
        write_msg(&mut root, 2, &origin);
        write_msg(&mut root, 2, &reply);
        write_msg(&mut root, 2, &photo_reply);
        write_msg(&mut root, 3, &user);
        write_msg(&mut root, 6, &photo_message);

        let messages = parse_history(&root, "me", "USER").unwrap();
        assert_eq!(messages.len(), 3);
        let reply = messages.iter().find(|item| item.id == "m-reply").unwrap();
        let quote = reply.reply.as_ref().unwrap();
        assert_eq!(quote.id, "m-origin");
        assert_eq!(quote.author, "Айгерим");
        assert_eq!(quote.text, "Ты на связи?");
        let photo = messages.iter().find(|item| item.id == "m-photo-reply").unwrap();
        let photo_quote = photo.reply.as_ref().unwrap();
        assert_eq!(photo_quote.author, "Вы");
        assert_eq!(photo_quote.text, "Фото");
        assert!(messages.iter().all(|item| item.id != "m-photo"));
    }
}
