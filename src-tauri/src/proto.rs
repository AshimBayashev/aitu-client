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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMessage {
    pub id: String,
    pub outgoing: bool,
    pub text: String,
    pub sent_at: i64,
    pub author: Option<String>,
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

pub fn encode_send(peer_id: &str, peer_type: i32, local_id: &str, text: &str) -> Vec<u8> {
    let mut out = Vec::new();
    if peer_type == 2 {
        let mut channel = Vec::new();
        write_str(&mut channel, 1, peer_id);
        write_msg(&mut out, 1, &channel);
    } else {
        write_msg(&mut out, 1, &encode_peer(peer_id, peer_type));
    }
    write_str(&mut out, 2, local_id);
    write_str(&mut out, 3, text);
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
            if better && !dialog_id.is_empty() {
                previews.insert(dialog_id, (message.sent_at, message.text));
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

    let mut messages = Vec::new();
    for raw in msgs(&root, 2) {
        if let Some(message) = parse_message(raw, me, peer_type)? {
            if message.text.is_empty() {
                continue;
            }
            let author = if message.outgoing || !matches!(peer_type, "GROUP" | "DISCUSSION") {
                None
            } else {
                names.get(&message.sender_id).filter(|name| !name.is_empty()).cloned()
            };
            messages.push(RemoteMessage {
                id: message.id,
                outgoing: message.outgoing,
                text: message.text,
                sent_at: message.sent_at,
                author,
            });
        }
    }
    messages.sort_by(|a, b| a.sent_at.cmp(&b.sent_at).then(a.id.cmp(&b.id)));
    Ok(messages)
}

struct Party {
    title: String,
    members: Option<i64>,
    online: bool,
}

struct ParsedBody {
    id: String,
    dialog_id: String,
    sender_id: String,
    outgoing: bool,
    text: String,
    sent_at: i64,
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
        },
    )))
}

fn parse_message(raw: &[u8], me: &str, peer_type: &str) -> Result<Option<ParsedBody>, String> {
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
    let text = message_text(&fields, peer_type)?;
    Ok(Some(ParsedBody {
        id,
        dialog_id,
        sender_id,
        outgoing,
        text,
        sent_at: millis(var(&fields, 2).unwrap_or(0)),
    }))
}

fn message_text(fields: &[(u32, Val)], _peer_type: &str) -> Result<String, String> {
    if let Some(raw) = first_msg(fields, 12)
        .or_else(|| first_msg(fields, 17))
        .or_else(|| first_msg(fields, 22))
    {
        let body = read_fields(raw)?;
        let text = text(&body, 1);
        if !text.is_empty() {
            return Ok(text);
        }
        if first_msg(&body, 3).is_some() || first_msg(&body, 7).is_some() {
            return Ok("Вложение".to_string());
        }
    }
    if first_msg(fields, 13).is_some() {
        return Ok("Служебное сообщение".to_string());
    }
    if first_msg(fields, 20).is_some() {
        return Ok("Звонок".to_string());
    }
    if first_msg(fields, 16).is_some() {
        return Ok("Вложение".to_string());
    }
    Ok(String::new())
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
}
