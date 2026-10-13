/* owl — データ層（Supabase）。画面側は従来どおり api("/api/...") を呼び、ここで Supabase の問い合わせに読み替える。
 * 権限はすべて DB の RLS が決める。ここで絞り込みを書いても、それは表示上の都合であって守りではない。 */
"use strict";

const SB = supabase.createClient(TSUNAGI.url, TSUNAGI.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "tsunagi-auth" },
  realtime: { params: { eventsPerSecond: 10 } },
});


const localISO = ts => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
function must({ data, error }) {
  if (error) throw new Error(friendlyError(error.message || String(error)));
  return data;
}
function friendlyError(m) {
  if (/row-level security|permission denied/i.test(m)) return "この操作の権限がありません";
  if (/JWT|token/i.test(m)) return "ログインの有効期限が切れました。もう一度ログインしてください";
  if (/Failed to fetch|NetworkError/i.test(m)) return "通信できませんでした。電波の状態を確認してください";
  return m;
}
async function fn(name, body) {
  const { data, error } = await SB.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch { }
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
const team = () => S.me.team_id;

/* ---------------------------------------------------------------- 認証 */
async function authCall(action, body) {
  const r = await fetch(`${TSUNAGI.url}/functions/v1/auth`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: TSUNAGI.anonKey },
    body: JSON.stringify({ action, ...body }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "通信に失敗しました");
  must(await SB.auth.setSession(d.session));
}

async function signOut() {
  // この端末の通知の購読を外してからログアウトする（次にこの端末を使う人へ前の人の通知が届かないように）
  try { if (typeof pushOff === "function") await pushOff(); } catch { }
  try { await SB.auth.signOut(); } catch { }
  location.reload();
}

/* ---------------------------------------------------------------- メッセージの整形 */
async function serialize(rows, members, cache) {
  if (!rows.length) return [];
  const ids = rows.map(m => m.id);
  const reacts = {};
  const rs = must(await SB.from("reactions").select("message_id,user_id,emoji").in("message_id", ids));
  for (const r of rs) ((reacts[r.message_id] ||= {})[r.emoji] ||= []).push(r.user_id);
  const fids = [...new Set(rows.flatMap(m => m.file_ids || []))];
  const files = {};
  if (fids.length) for (const f of must(await SB.from("files").select("id,name,mime,size,kind,path").in("id", fids))) files[f.id] = f;
  const rids = [...new Set(rows.map(m => m.reply_to).filter(Boolean))];
  const replies = {};
  if (rids.length) for (const r of must(await SB.from("messages").select("id,user_id,body").in("id", rids))) replies[r.id] = r;
  return rows.map(m => shape(m, members, { reacts: reacts[m.id] || {}, files, replies }));
}
function shape(m, members, { reacts = {}, files = {}, replies = {} } = {}) {
  return {
    id: m.id, channel_id: m.channel_id, user_id: m.user_id, body: m.deleted ? "" : m.body, deleted: m.deleted,
    created_at: localISO(m.created_at), edited_at: m.edited_at ? localISO(m.edited_at) : null, meta: m.meta || {},
    files: (m.file_ids || []).map(id => files[id]).filter(Boolean),
    reactions: Object.entries(reacts).map(([emoji, user_ids]) => ({ emoji, user_ids })),
    reply: m.reply_to ? replies[m.reply_to] || null : null,
    // 既読 = 送信者以外で、そのメッセージまで読み進めたメンバー
    read_by: members.filter(x => x.user_id !== m.user_id && x.last_read_id >= m.id).map(x => x.user_id),
  };
}

/* ---------------------------------------------------------------- ファイル（非公開バケット + 署名 URL） */
const KINDS = { image: "png jpg jpeg gif webp bmp svg heic avif", pdf: "pdf", video: "mp4 webm mov m4v", audio: "mp3 wav m4a ogg flac aac",
  doc: "docx doc odt rtf pages", sheet: "xlsx xls csv tsv ods numbers", slide: "pptx ppt odp key", archive: "zip 7z rar tar gz",
  text: "txt md log json py js ts html css xml yaml yml ini toml sql sh ps1 bat c cpp java go rs rb php" };
function guessKind(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  for (const [k, v] of Object.entries(KINDS)) if (v.split(" ").includes(ext)) return k;
  return "other";
}
const safeName = n => (n || "file").replace(/[\\/:*?"<>|#%\x00-\x1f]/g, "_").slice(0, 150);

function uploadFile(file, channelId, onProgress) {
  return new Promise(async (resolve, reject) => {
    const max = TSUNAGI.maxUploadMB * 1048576;
    if (file.size > max) return reject(new Error(`${TSUNAGI.maxUploadMB}MB を超えるファイルは送れません`));
    const { data: { session } } = await SB.auth.getSession();
    const name = safeName(file.name || `image-${Date.now()}.png`);
    // Storage のキーは ASCII しか受け付けないので、乱数 + 拡張子だけにする（元の名前は files.name に残す）
    const ext = ((name.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || "bin").toLowerCase();
    const path = `${team()}/${crypto.randomUUID()}.${ext}`;
    const x = new XMLHttpRequest();
    x.open("POST", `${TSUNAGI.url}/storage/v1/object/files/${path.split("/").map(encodeURIComponent).join("/")}`);
    x.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    x.setRequestHeader("apikey", TSUNAGI.anonKey);
    x.setRequestHeader("x-upsert", "false");
    if (file.type) x.setRequestHeader("Content-Type", file.type);
    x.upload.onprogress = e => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    x.onerror = () => reject(new Error("通信エラー"));
    x.onload = async () => {
      if (x.status >= 300) { let d = {}; try { d = JSON.parse(x.responseText); } catch { } return reject(new Error(d.message || "アップロードに失敗しました")); }
      try {
        resolve(must(await SB.from("files").insert({ team_id: team(), name, mime: file.type || "", size: file.size, path,
          kind: guessKind(name), channel_id: channelId || null }).select().single()));
      } catch (e) { SB.storage.from("files").remove([path]); reject(e); }
    };
    x.send(file);
  });
}

const _urls = new Map();
async function fileUrl(f, download) {
  const key = f.path + (download ? "#dl" : "");
  const hit = _urls.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const d = must(await SB.storage.from("files").createSignedUrl(f.path, 3600, download ? { download: f.name } : undefined));
  _urls.set(key, { url: d.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return d.signedUrl;
}
/** data-fsrc / data-fhref を持つ要素へ、署名 URL をまとめて差し込む。 */
async function hydrateFiles(root) {
  const els = [...root.querySelectorAll("[data-fsrc]:not([data-ready]),[data-fhref]:not([data-ready])")];
  if (!els.length) return;
  const paths = [...new Set(els.map(e => e.dataset.fsrc || e.dataset.fhref).filter(p => !_urls.has(p) || _urls.get(p).exp < Date.now()))];
  if (paths.length) {
    const { data } = await SB.storage.from("files").createSignedUrls(paths, 3600);
    for (const d of data || []) if (d.signedUrl) _urls.set(d.path, { url: d.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  }
  for (const e of els) {
    const u = _urls.get(e.dataset.fsrc || e.dataset.fhref); if (!u) continue;
    if (e.dataset.fsrc) e.src = u.url; else e.href = u.url;
    e.dataset.ready = 1;
  }
}

/* ---- ブラウザ内プレビュー（zip を DecompressionStream で展開し、Office の XML を読む） */
async function unzip(buf) {
  const dv = new DataView(buf); let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("zip ではありません");
  const n = dv.getUint16(eocd + 10, true); let off = dv.getUint32(eocd + 16, true);
  const entries = new Map(), td = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), usize = dv.getUint32(off + 24, true);
    const nlen = dv.getUint16(off + 28, true), elen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true), lho = dv.getUint32(off + 42, true);
    entries.set(td.decode(new Uint8Array(buf, off + 46, nlen)), { method, csize, usize, lho });
    off += 46 + nlen + elen + clen;
  }
  const read = async name => {
    const f = entries.get(name); if (!f) return null;
    const start = f.lho + 30 + dv.getUint16(f.lho + 26, true) + dv.getUint16(f.lho + 28, true);
    const data = new Uint8Array(buf, start, f.csize);
    if (f.method === 0) return data;
    const s = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  };
  return { entries, read, xml: async name => { const b = await read(name); return b && new DOMParser().parseFromString(td.decode(b), "application/xml"); } };
}
const byTag = (node, tag) => [...node.getElementsByTagNameNS("*", tag)];
function decodeText(bytes) {
  for (const enc of ["utf-8", "shift_jis", "euc-jp"]) {
    try { return new TextDecoder(enc, { fatal: true }).decode(bytes); } catch { }
  }
  return new TextDecoder().decode(bytes);
}
function parseCSV(text, sep) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; if (rows.length >= 500) break; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
async function previewFile(f) {
  const res = await fetch(await fileUrl(f));
  if (!res.ok) throw new Error("ファイルを読み込めませんでした");
  return previewBuffer(await res.arrayBuffer(), f);
}
/** バイト列から表示用の構造を作る。f は { name, kind, mime } だけを使う。 */
async function previewBuffer(buf, f) {
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  if (ext === "docx") {
    const doc = await (await unzip(buf)).xml("word/document.xml");
    const blocks = byTag(doc, "p").map(p => {
      const st = byTag(p, "pStyle")[0]; const sv = st ? st.getAttribute("w:val") || "" : "";
      const t = byTag(p, "t").map(x => x.textContent).join("");
      return { h: /(Heading|見出し)\s*1|Title/i.test(sv) ? 1 : /(Heading|見出し)\s*[23]/i.test(sv) ? 2 : 0, t };
    }).filter(b => b.t.trim());
    return { type: "doc", blocks: blocks.slice(0, 800) };
  }
  if (ext === "xlsx") {
    const z = await unzip(buf);
    const ss = await z.xml("xl/sharedStrings.xml");
    const shared = ss ? byTag(ss, "si").map(si => byTag(si, "t").map(t => t.textContent).join("")) : [];
    const wb = await z.xml("xl/workbook.xml");
    const names = byTag(wb, "sheet").map(s => s.getAttribute("name"));
    const files = [...z.entries.keys()].filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
    const col = r => [...r.match(/^[A-Z]+/)[0]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const sheets = [];
    for (const [i, path] of files.slice(0, 8).entries()) {
      const x = await z.xml(path); const rows = [];
      for (const r of byTag(x, "row")) {
        const cells = {};
        for (const c of byTag(r, "c")) {
          const v = byTag(c, "v")[0]; let val = v ? v.textContent : byTag(c, "t").map(t => t.textContent).join("");
          if (c.getAttribute("t") === "s") val = shared[+val] ?? "";
          if (c.getAttribute("r")) cells[col(c.getAttribute("r"))] = val;
        }
        const keys = Object.keys(cells).map(Number);
        if (keys.length) rows.push([...Array(Math.min(Math.max(...keys) + 1, 40))].map((_, j) => cells[j] ?? ""));
        if (rows.length >= 300) break;
      }
      sheets.push({ name: names[i] || `Sheet${i + 1}`, rows });
    }
    return { type: "table", sheets };
  }
  if (ext === "pptx") {
    const z = await unzip(buf);
    const files = [...z.entries.keys()].filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
    const slides = [];
    for (const p of files.slice(0, 200)) {
      const x = await z.xml(p);
      const paras = byTag(x, "p").map(pp => byTag(pp, "t").map(t => t.textContent).join("").trim()).filter(Boolean);
      slides.push({ title: paras[0] || "", lines: paras.slice(1, 30) });
    }
    return { type: "slides", slides };
  }
  if (ext === "csv" || ext === "tsv") return { type: "table", sheets: [{ name: f.name, rows: parseCSV(decodeText(new Uint8Array(buf.slice(0, 2_000_000))), ext === "tsv" ? "\t" : ",") }] };
  if (ext === "zip") { const z = await unzip(buf); return { type: "list", items: [...z.entries].slice(0, 500).map(([n, e]) => `${n}  (${e.usize.toLocaleString()} B)`) }; }
  if (f.kind === "text" || (f.mime || "").startsWith("text/")) {
    let text = decodeText(new Uint8Array(buf.slice(0, 180_000))).slice(0, 60_000);
    if (ext === "json") { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { } }
    return { type: "text", text };
  }
  return { type: "none", reason: "この形式はダウンロードして開いてください" };
}

/* ---------------------------------------------------------------- ルーター */
const MAIL_SEL = "id,direction,from_addr,from_name,to_addr,subject,snippet,date,status,assignee_id,starred,archived,sent_by";
async function mailExtras(rows) {
  const ids = rows.map(r => r.id);
  const readers = {}, nfiles = {};
  if (ids.length) {
    for (const r of must(await SB.from("email_reads").select("email_id,user_id,read_at").in("email_id", ids).order("read_at")))
      (readers[r.email_id] ||= []).push({ user_id: r.user_id, at: localISO(r.read_at) });
    for (const f of must(await SB.from("files").select("email_id").in("email_id", ids))) nfiles[f.email_id] = (nfiles[f.email_id] || 0) + 1;
  }
  return rows.map(r => ({ ...r, date: localISO(r.date), readers: readers[r.id] || [], n_files: nfiles[r.id] || 0,
    read_by_me: (readers[r.id] || []).some(x => x.user_id === S.me.id) }));
}
function mailFilter(qb, box) {
  const me = S.me.id;
  switch (box) {
    case "mine": return qb.eq("direction", "in").eq("archived", false).eq("assignee_id", me).neq("status", "done");
    case "unassigned": return qb.eq("direction", "in").eq("archived", false).is("assignee_id", null).neq("status", "done");
    case "done": return qb.eq("direction", "in").eq("status", "done").eq("archived", false);
    case "sent": return qb.eq("direction", "out");
    case "starred": return qb.eq("starred", true);
    case "archived": return qb.eq("archived", true);
    default: return qb.eq("direction", "in").eq("archived", false).neq("status", "done");
  }
}
const pgLike = s => `%${s.replace(/[%_,()]/g, " ")}%`;

async function postMessage(cid, { body = "", file_ids = [], reply_to = null, meta = {} }) {
  if (!body.trim() && !file_ids.length && !Object.keys(meta).length) throw new Error("空のメッセージです");
  const row = must(await SB.from("messages").insert({ channel_id: cid, user_id: S.me.id, body: body.trim(), file_ids, reply_to, meta }).select().single());
  if (file_ids.length) await SB.from("files").update({ channel_id: cid }).in("id", file_ids).is("channel_id", null);
  return row;
}

/** ピン留め（新しい順）。本文はメッセージ表から引く（RLS でメンバー以外は読めない） */
async function loadPins(cid) {
  const pins = must(await SB.from("message_pins").select("message_id,pinned_by,pinned_at").eq("channel_id", cid).order("pinned_at", { ascending: false }).limit(50));
  if (!pins.length) return [];
  const msgs = must(await SB.from("messages").select("id,user_id,body,created_at,file_ids").in("id", pins.map(p => p.message_id)));
  const by = Object.fromEntries(msgs.map(m => [m.id, m]));
  return pins.filter(p => by[p.message_id]).map(p => ({ ...p, pinned_at: localISO(p.pinned_at), message: { ...by[p.message_id], created_at: localISO(by[p.message_id].created_at) } }));
}

const ROUTES = [
  ["GET", /^\/api\/me$/, async () => S.me],
  ["PUT", /^\/api\/me$/, async (_, b) => {
    const { password, ...fields } = b;
    if (password) { if (password.length < 8) throw new Error("パスワードは 8 文字以上"); must(await SB.auth.updateUser({ password })); }
    const cols = ["name", "kana", "dept", "title", "phone", "email", "bio", "color", "status_emoji", "status_text"];
    const upd = Object.fromEntries(Object.entries(fields).filter(([k]) => cols.includes(k)));
    return must(await SB.from("profiles").update(upd).eq("id", S.me.id).select().single());
  }],
  ["GET", /^\/api\/users$/, async () => must(await SB.from("profiles").select("*").order("kana").order("name"))],
  ["GET", /^\/api\/channels$/, async () => {
    const joined = must(await SB.rpc("my_channels")).map(c => ({ ...c, last_at: localISO(c.last_at), member_ids: c.member_ids || [],
      dm_user_ids: c.kind === "dm" ? (c.member_ids || []).filter(i => i !== S.me.id) : undefined }));
    const ids = new Set(joined.map(c => c.id));
    const all = must(await SB.from("channels").select("id,name,kind,topic,emoji").eq("kind", "channel").eq("archived", false));
    return { joined, joinable: all.filter(c => !ids.has(c.id)).map(c => ({ ...c, member_ids: [], joined: 0, unread: 0, mentions: 0 })) };
  }],
  ["POST", /^\/api\/channels$/, async (_, b) => ({ id: must(await SB.rpc("create_channel", { p_name: b.name, p_topic: b.topic || "", p_emoji: b.emoji || "", p_members: b.member_ids || [] })) })],
  ["PUT", /^\/api\/channels\/(\d+)$/, async ([cid], b) => must(await SB.from("channels").update(b).eq("id", cid).select())],
  ["POST", /^\/api\/channels\/(\d+)\/join$/, async ([cid]) => must(await SB.rpc("join_channel", { p_channel: +cid }))],
  ["POST", /^\/api\/channels\/(\d+)\/members$/, async ([cid], b) => must(await SB.rpc("add_channel_members", { p_channel: +cid, p_users: b.user_ids }))],
  ["POST", /^\/api\/channels\/(\d+)\/leave$/, async ([cid]) => must(await SB.from("channel_members").delete().eq("channel_id", cid).eq("user_id", S.me.id))],
  ["POST", /^\/api\/channels\/(\d+)\/star$/, async ([cid]) => {
    const ch = S.channels.find(c => c.id === +cid);
    return must(await SB.from("channel_members").update({ starred: !(ch && ch.starred) }).eq("channel_id", cid).eq("user_id", S.me.id));
  }],
  ["POST", /^\/api\/channels\/(\d+)\/read$/, async ([cid], b) => {
    const mid = b.message_id || 0; if (!mid) return {};
    return must(await SB.from("channel_members").update({ last_read_id: mid }).eq("channel_id", cid).eq("user_id", S.me.id).lt("last_read_id", mid));
  }],
  ["POST", /^\/api\/dm$/, async (_, b) => ({ id: must(await SB.rpc("open_dm", { p_users: b.user_ids })) })],
  ["GET", /^\/api\/channels\/(\d+)\/messages$/, async ([cid], _, qs) => {
    const before = +(qs.get("before") || 0), limit = 60;
    let q = SB.from("messages").select("*").eq("channel_id", cid).order("id", { ascending: false }).limit(limit);
    if (before) q = q.lt("id", before);
    const [rows, members, channel, pins] = await Promise.all([q.then(must), SB.from("channel_members").select("user_id,last_read_id").eq("channel_id", cid).then(must),
      SB.from("channels").select("*").eq("id", cid).single().then(must), before ? Promise.resolve(null) : loadPins(+cid)]);
    const asc = rows.reverse();
    return { channel, members, member_ids: members.map(m => m.user_id), messages: await serialize(asc, members), pins,
      my_last_read: (members.find(m => m.user_id === S.me.id) || {}).last_read_id || 0, has_more: rows.length >= limit };
  }],
  ["POST", /^\/api\/channels\/(\d+)\/messages$/, async ([cid], b) => {
    const row = await postMessage(+cid, b);
    const members = S.cache[cid]?.members || [];
    return (await serialize([row], members))[0];
  }],
  ["PUT", /^\/api\/messages\/(\d+)$/, async ([mid], b) => must(await SB.from("messages").update({ body: String(b.body || "").trim(), edited_at: new Date().toISOString() }).eq("id", mid))],
  ["DELETE", /^\/api\/messages\/(\d+)$/, async ([mid]) => must(await SB.from("messages").update({ deleted: true, body: "", file_ids: [], meta: {} }).eq("id", mid))],
  ["POST", /^\/api\/messages\/(\d+)\/pin$/, async ([mid], b) => b.on
    ? must(await SB.from("message_pins").insert({ message_id: +mid }))
    : must(await SB.from("message_pins").delete().eq("message_id", mid))],
  ["POST", /^\/api\/messages\/(\d+)\/reactions$/, async ([mid], b) => {
    const del = must(await SB.from("reactions").delete().eq("message_id", mid).eq("user_id", S.me.id).eq("emoji", b.emoji).select());
    if (!del.length) {
      const cid = Object.values(S.cache).find(c => c.messages.some(m => m.id === +mid))?.channel.id;
      must(await SB.from("reactions").insert({ message_id: +mid, channel_id: cid, user_id: S.me.id, emoji: b.emoji }));
    }
    return {};
  }],

  ["GET", /^\/api\/files$/, async (_, __, qs) => {
    let q = SB.from("files").select("*, channels(name,kind), emails(subject)").order("id", { ascending: false }).limit(300);
    if (qs.get("kind")) q = q.eq("kind", qs.get("kind"));
    if (qs.get("q")) q = q.ilike("name", pgLike(qs.get("q")));
    return must(await q).map(f => ({ ...f, created_at: localISO(f.created_at), channel_name: f.channels?.name, channel_kind: f.channels?.kind, email_subject: f.emails?.subject }));
  }],
  ["POST", /^\/api\/files\/(\d+)\/share$/, async ([fid], b) => postMessage(+b.channel_id, { body: b.body || "", file_ids: [+fid] })],

  ["GET", /^\/api\/mail$/, async (_, __, qs) => {
    const box = qs.get("box") || "inbox", text = qs.get("q") || "";
    let q = mailFilter(SB.from("emails").select(MAIL_SEL), box).order("date", { ascending: false }).limit(200);
    if (text) { const l = pgLike(text); q = q.or(`subject.ilike.${l},body.ilike.${l},from_name.ilike.${l},from_addr.ilike.${l}`); }
    const count = async b => (await mailFilter(SB.from("emails").select("id", { count: "exact", head: true }), b)).count || 0;
    const [rows, inbox, mine, unassigned, status] = await Promise.all([q.then(must), count("inbox"), count("mine"), count("unassigned"), SB.rpc("mail_status").then(must)]);
    S.cfg.mail = status;
    return { items: await mailExtras(rows), counts: { inbox, mine, unassigned }, status: { ...status, mode: status.configured ? (status.error ? "gmail-error" : "gmail") : "none", last_sync: localISO(status.last_sync) } };
  }],
  ["POST", /^\/api\/mail\/sync$/, async () => fn("mail", { action: "sync", force: true })],
  ["POST", /^\/api\/mail\/send$/, async (_, b) => fn("mail", { action: "send", ...b })],
  ["GET", /^\/api\/mail\/(\d+)$/, async ([eid]) => {
    await SB.from("email_reads").upsert({ email_id: +eid, team_id: team(), user_id: S.me.id }, { onConflict: "email_id,user_id", ignoreDuplicates: true });
    const [e, files, thread] = await Promise.all([SB.from("emails").select("*").eq("id", eid).single().then(must),
      SB.from("files").select("id,name,mime,size,kind,path").eq("email_id", eid).then(must),
      SB.from("emails").select(MAIL_SEL).eq("in_reply_to", eid).order("date").then(must)]);
    const [x] = await mailExtras([e]);
    return { ...x, files, thread: thread.map(t => ({ ...t, date: localISO(t.date) })) };
  }],
  ["PUT", /^\/api\/mail\/(\d+)$/, async ([eid], b) => {
    const upd = {};
    for (const k of ["status", "assignee_id", "starred", "archived", "note"]) if (b[k] !== undefined && b[k] !== null) upd[k] = k === "starred" || k === "archived" ? !!b[k] : b[k];
    if (b.unassign) upd.assignee_id = null;
    return must(await SB.from("emails").update(upd).eq("id", eid));
  }],
  ["POST", /^\/api\/mail\/(\d+)\/share$/, async ([eid], b) => {
    const e = must(await SB.from("emails").select("id,subject,from_name,from_addr,snippet").eq("id", eid).single());
    return postMessage(+b.channel_id, { body: b.body || "", meta: { kind: "email", ...e } });
  }],

  ["GET", /^\/api\/events$/, async (_, __, qs) => {
    const start = qs.get("start") || "0000", end = qs.get("end") || "9999";
    return must(await SB.from("events").select("*").gte("end_at", start).lte("start_at", end + "T99").order("start_at"))
      .map(e => ({ ...e, start: e.start_at, end: e.end_at, all_day: e.all_day ? 1 : 0 }));
  }],
  ["POST", /^\/api\/events$/, async (_, b) => must(await SB.from("events").insert(evRow(b)).select().single())],
  ["PUT", /^\/api\/events\/(\d+)$/, async ([id], b) => must(await SB.from("events").update(evRow(b)).eq("id", id))],
  ["DELETE", /^\/api\/events\/(\d+)$/, async ([id]) => must(await SB.from("events").delete().eq("id", id))],

  ["GET", /^\/api\/shifts$/, async (_, __, qs) => must(await SB.from("shifts").select("*").gte("date", qs.get("start")).lte("date", qs.get("end")))],
  // シフトは「入る（開始〜終了）」か「休み」。kind が空なら消す
  ["PUT", /^\/api\/shifts$/, async (_, b) => b.kind
    ? must(await SB.from("shifts").upsert({ team_id: team(), user_id: b.user_id, date: b.date, kind: b.kind, note: b.note || "",
        start_time: b.kind === "work" ? b.start : null, end_time: b.kind === "work" ? b.end : null }, { onConflict: "user_id,date" }))
    : must(await SB.from("shifts").delete().eq("user_id", b.user_id).eq("date", b.date))],

  ["GET", /^\/api\/contacts$/, async (_, __, qs) => {
    let q = SB.from("contacts").select("*").order("company").order("name");
    if (qs.get("q")) { const l = pgLike(qs.get("q")); q = q.or(`name.ilike.${l},kana.ilike.${l},company.ilike.${l},email.ilike.${l},tags.ilike.${l}`); }
    return must(await q);
  }],
  ["POST", /^\/api\/contacts$/, async (_, b) => must(await SB.from("contacts").insert({ ...b, team_id: team() }).select().single())],
  ["PUT", /^\/api\/contacts\/(\d+)$/, async ([id], b) => must(await SB.from("contacts").update(b).eq("id", id))],
  ["DELETE", /^\/api\/contacts\/(\d+)$/, async ([id]) => must(await SB.from("contacts").delete().eq("id", id))],

  // 個人タスク: タスクバスターをつないでいれば中継、なければ本人だけが読める personal_tasks
  ["GET", /^\/api\/tasks$/, async () => {
    const r = await fn("taskbuster", { action: "overview" }).catch(e => ({ mode: "error", error: e.message }));
    if (r.mode === "taskbuster") return r;
    const rows = must(await SB.from("personal_tasks").select("*").in("status", ["todo", "doing", "waiting"]).order("due", { nullsFirst: false }).order("id", { ascending: false }));
    return { mode: "local", error: r.mode === "error" ? r.error : "", web_url: "",
      tasks: rows.map(t => ({ id: `p-${t.id}`, title: t.title, status: t.status, due: t.due || "", owner: "me", source: t.source })) };
  }],
  ["POST", /^\/api\/tasks$/, async (_, b) => {
    const st = must(await SB.rpc("tb_status"));
    if (st.configured) return fn("taskbuster", { action: "add", title: b.title, due: b.due, memo: b.memo });
    must(await SB.from("personal_tasks").insert({ user_id: S.me.id, title: b.title, due: b.due || null, memo: b.memo || "", source: b.source || "" }));
    return { mode: "local" };
  }],
  ["PUT", /^\/api\/tasks\/(.+)$/, async ([id], b) => id.startsWith("p-")
    ? must(await SB.from("personal_tasks").update({ status: b.status || "done" }).eq("id", +id.slice(2)))
    : fn("taskbuster", { action: "update", id: decodeURIComponent(id), status: b.status || "done" })],

  ["GET", /^\/api\/home$/, async () => {
    const today = todayStr();
    const [evs, working, mine, mail] = await Promise.all([
      SB.from("events").select("*").lte("start_at", today + "T99").gte("end_at", today).order("start_at").then(must),
      SB.from("shifts").select("user_id,kind,start_time,end_time").eq("date", today).eq("kind", "work").order("start_time").then(must),
      SB.from("shifts").select("kind,start_time,end_time").eq("date", today).eq("user_id", S.me.id).maybeSingle().then(must),
      SB.from("emails").select(MAIL_SEL).eq("direction", "in").eq("archived", false).neq("status", "done")
        .or(`assignee_id.eq.${S.me.id},assignee_id.is.null`).order("date", { ascending: false }).limit(20).then(must),
    ]);
    const mx = (await mailExtras(mail)).filter(m => m.assignee_id === S.me.id || !m.read_by_me).slice(0, 6);
    const attention = S.channels.filter(c => c.unread && !c.muted).sort((a, b) => (b.mentions > 0) - (a.mentions > 0) || (b.last_at || "").localeCompare(a.last_at || ""));
    return { attention: attention.slice(0, 8), events: evs.map(e => ({ ...e, start: e.start_at, end: e.end_at })), working, my_shift: mine || null, mail: mx };
  }],
  ["GET", /^\/api\/search$/, async (_, __, qs) => {
    const l = pgLike(qs.get("q") || "");
    const [messages, files, mail, contacts] = await Promise.all([
      SB.from("messages").select("id,channel_id,user_id,body,created_at").eq("deleted", false).ilike("body", l).order("id", { ascending: false }).limit(20).then(must),
      SB.from("files").select("*").ilike("name", l).limit(12).then(must),
      SB.from("emails").select("id,subject,from_name,date").or(`subject.ilike.${l},from_name.ilike.${l},body.ilike.${l}`).order("date", { ascending: false }).limit(10).then(must),
      SB.from("contacts").select("*").or(`name.ilike.${l},company.ilike.${l},email.ilike.${l}`).limit(10).then(must),
    ]);
    return { messages: messages.map(m => ({ ...m, created_at: localISO(m.created_at) })), files, mail: mail.map(m => ({ ...m, date: localISO(m.date) })), contacts };
  }],
];
function evRow(b) {
  return { team_id: team(), title: b.title, start_at: b.start, end_at: b.end, all_day: !!b.all_day, location: b.location || "",
    note: b.note || "", color: b.color || "", attendees: b.attendees || [] };
}

async function api(path, { method = "GET", body } = {}) {
  const u = new URL(path, location.href);
  for (const [m, re, h] of ROUTES) {
    if (m !== method) continue;
    const mt = u.pathname.match(re);
    if (mt) return h(mt.slice(1), body || {}, u.searchParams);
  }
  throw new Error(`未対応の操作: ${method} ${u.pathname}`);
}

/* ---------------------------------------------------------------- リアルタイム */
let rtDb = null, rtTeam = null;
function connectWS() {
  rtDb = SB.channel("tsunagi-db")
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, async p => {
      const row = p.new; if (!row || !row.id) return;
      const c = S.cache[row.channel_id];
      const members = c ? c.members : [];
      if (p.eventType === "INSERT") {
        const [m] = await serialize([row], members);
        handleWS({ type: "message", message: m });
      } else if (p.eventType === "UPDATE" && c) {
        const prev = c.messages.find(x => x.id === row.id);
        const [m] = await serialize([row], members);
        if (prev) m.read_by = prev.read_by;
        handleWS({ type: "message_update", message: m });
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, p => {
      refreshReactions((p.new && p.new.message_id) || (p.old && p.old.message_id));
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "channel_members" }, p => {
      if (p.eventType === "UPDATE" && p.new) {
        const c = S.cache[p.new.channel_id];
        if (c) { const mm = c.members.find(x => x.user_id === p.new.user_id); if (mm) mm.last_read_id = p.new.last_read_id; }
        if (p.new.user_id !== S.me.id) handleWS({ type: "read", channel_id: p.new.channel_id, user_id: p.new.user_id, message_id: p.new.last_read_id });
      } else handleWS({ type: "channels" });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "channels" }, () => handleWS({ type: "channels" }))
    .on("postgres_changes", { event: "*", schema: "public", table: "emails" }, () => handleWS({ type: "mail" }))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "email_reads" }, p => handleWS({ type: "mail_read", email_id: p.new.email_id, user_id: p.new.user_id }))
    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => handleWS({ type: "events" }))
    .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => handleWS({ type: "shifts" }))
    .on("postgres_changes", { event: "*", schema: "public", table: "team_tasks" }, () => handleWS({ type: "team_tasks" }))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_task_logs" }, () => handleWS({ type: "team_tasks" }))
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => handleWS({ type: "users" }))
    .on("postgres_changes", { event: "*", schema: "public", table: "message_pins" }, p => handleWS({ type: "pins", channel_id: (p.new && p.new.channel_id) || null }))
    .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${S.me.id}` }, () => handleWS({ type: "notif" }))
    .subscribe(st => {
      emit("ws", st === "SUBSCRIBED");
      if (st === "SUBSCRIBED" && rtDb._was) { loadChannels(); S.cur && emit("resync", S.cur); emit("notif"); }
      if (st === "SUBSCRIBED") rtDb._was = true;
    });
  joinTeamRoom(true);
  if (typeof OwlCall !== "undefined") OwlCall.init();
}
/** 在席と入力中。まず非公開チャンネル（RLS で同じチームだけ）を試し、使えなければ推測困難なトピック名の公開チャンネルに退避する。 */
function joinTeamRoom(priv) {
  rtTeam = SB.channel(`team:${team()}`, { config: { private: priv, presence: { key: S.me.id }, broadcast: { self: false } } })
    .on("presence", { event: "sync" }, () => { S.online = new Set(Object.keys(rtTeam.presenceState())); emit("presence"); })
    .on("broadcast", { event: "typing" }, ({ payload }) => handleWS({ type: "typing", ...payload }))
    .subscribe(async st => {
      if (st === "SUBSCRIBED") await rtTeam.track({ at: Date.now() });
      if (st === "CHANNEL_ERROR" && priv) { SB.removeChannel(rtTeam); joinTeamRoom(false); }
    });
}
async function refreshReactions(mid) {
  const c = Object.values(S.cache).find(x => x.messages.some(m => m.id === mid)); if (!c) return;
  const rs = must(await SB.from("reactions").select("user_id,emoji").eq("message_id", mid));
  const m = c.messages.find(x => x.id === mid); const g = {};
  for (const r of rs) (g[r.emoji] ||= []).push(r.user_id);
  handleWS({ type: "message_update", message: { ...m, reactions: Object.entries(g).map(([emoji, user_ids]) => ({ emoji, user_ids })) } });
}
async function refreshMessage(mid) {
  const c = Object.values(S.cache).find(x => x.messages.some(m => m.id === mid)); if (!c) return;
  const row = must(await SB.from("messages").select("*").eq("id", mid).single());
  const prev = c.messages.find(x => x.id === mid);
  const [m] = await serialize([row], c.members);
  handleWS({ type: "message_update", message: { ...m, read_by: prev ? prev.read_by : m.read_by } });
}
function wsSend(obj) {
  if (obj.type === "typing" && rtTeam) rtTeam.send({ type: "broadcast", event: "typing", payload: { channel_id: obj.channel_id, user_id: S.me.id } });
}
