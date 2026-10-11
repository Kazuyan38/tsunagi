/* つなぎ — 共通コア（API・状態・リアルタイム・チャット・ファイルビューア）
 * PC 版（pc.html）とスマホ版（mobile.html）が共有する。レイアウト固有の動きは window.UI に委ねる。
 */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

/* ---------- アイコン（24px ストローク） ---------- */
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  shift: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
  task: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12 3 3 5-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
  clip: '<path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4L14.5 7.5"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>',
  reply: '<path d="M10 8 4 13l6 5"/><path d="M4 13h10a6 6 0 0 1 6 6"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  dl: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 20h16"/>',
  share: '<path d="M14 5h5v5"/><path d="M19 5 10 14"/><path d="M19 14v5H5V5h5"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>',
  hash: '<path d="M5 9h15M4 15h15M10 4 8 20M16 4l-2 16"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.3L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.3L20 15"/><path d="M20 20v-5h-5"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01" stroke-width="2.4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.4 4-7 8-7s7.2 2.6 8 7"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  chevl: '<path d="m15 6-6 6 6 6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
};
const icon = (name, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;
const CLAUDE_MARK = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5c.5 3.9 1.3 5.6 2.4 6.7 1.1 1.1 2.8 1.9 6.6 2.3v1c-3.8.4-5.5 1.2-6.6 2.3-1.1 1.1-1.9 2.8-2.4 6.7h-1c-.4-3.9-1.2-5.6-2.3-6.7C7.6 13.7 5.9 12.9 2 12.5v-1c3.9-.4 5.6-1.2 6.7-2.3C9.8 8.1 10.6 6.4 11 2.5z"/></svg>`;

/* ---------- 状態 ---------- */
const S = {
  me: null, cfg: null, users: {}, online: new Set(), channels: [], joinable: [],
  cur: null, cache: {}, replyTo: null, typing: {},
};
const bus = new EventTarget();
const on = (type, fn) => { const w = e => fn(e.detail); bus.addEventListener(type, w); return () => bus.removeEventListener(type, w); };
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

/* ---------- 小物 ---------- */
function toast(msg, err) {
  let w = $(".toast-wrap"); if (!w) { w = h('<div class="toast-wrap" role="status"></div>'); document.body.appendChild(w); }
  const t = h(`<div class="toast${err ? " err" : ""}">${esc(msg)}</div>`); w.appendChild(t);
  setTimeout(() => t.remove(), err ? 4200 : 2600);
}
const fail = e => toast(e.message || String(e), true);

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
function fmtTime(iso) { return iso ? iso.slice(11, 16) : ""; }
function fmtDay(iso) { const d = new Date(iso.slice(0, 10) + "T00:00"); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; }
function fmtRel(iso) {
  if (!iso) return "";
  const d = iso.slice(0, 10), t = todayStr();
  if (d === t) return fmtTime(iso);
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d === ymd(y)) return "昨日";
  return `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
}
function dayLabel(iso) {
  const d = iso.slice(0, 10), t = todayStr();
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d === t) return "今日"; if (d === ymd(y)) return "昨日";
  return fmtDay(iso);
}
const fmtSize = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const U = id => S.users[id] || { id, name: "（退出したメンバー）", color: "#94a3b8" };
const initial = name => (name || "?").trim().slice(0, 1);
function avatar(u, size = 36, showOnline = true) {
  if (!u) return "";
  const on = showOnline && S.online.has(u.id) ? " online" : "";
  return `<span class="avatar${on}" style="--s:${size}px;--c:${esc(u.color)}" title="${esc(u.name)}">${esc(initial(u.name))}</span>`;
}

function chName(ch) {
  if (!ch) return "";
  if (ch.kind === "channel") return ch.name;
  const ids = (ch.dm_user_ids || ch.member_ids || []).filter(i => i !== S.me.id);
  if (!ids.length) return `${S.me.name}（自分メモ）`;
  return ids.map(i => U(i).name).join("、");
}
function chIcon(ch, size = 22) {
  if (ch.kind === "channel") return `<span class="ch-emoji" style="width:${size}px">${esc(ch.emoji && ch.emoji !== "#" ? ch.emoji : "#")}</span>`;
  const ids = (ch.dm_user_ids || []).filter(i => i !== S.me.id);
  if (ids.length <= 1) return avatar(U(ids[0] || S.me.id), size);
  return `<span class="avatars">${ids.slice(0, 2).map(i => avatar(U(i), size - 4, false)).join("")}</span>`;
}

const KIND_LABEL = { image: "IMG", pdf: "PDF", video: "MOV", audio: "AUD", doc: "DOC", sheet: "XLS", slide: "PPT", text: "TXT", archive: "ZIP", other: "FILE" };
const KIND_NAME = { image: "画像", pdf: "PDF", doc: "文書", sheet: "表計算", slide: "スライド", video: "動画", audio: "音声", text: "テキスト", archive: "圧縮", other: "その他" };
function fileIcon(f) {
  const ext = (f.name.split(".").pop() || "").toUpperCase().slice(0, 4);
  return `<span class="file-ico fk-${f.kind}">${esc(f.kind === "other" || f.kind === "text" ? ext || KIND_LABEL[f.kind] : KIND_LABEL[f.kind])}</span>`;
}

function formatBody(text) {
  let s = esc(text);
  const blocks = [];
  s = s.replace(/```\n?([\s\S]*?)```/g, (_, c) => { blocks.push(`<pre>${c}</pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]」』）])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const names = Object.values(S.users).map(u => u.name).sort((a, b) => b.length - a.length);
  if (names.length) {
    const re = new RegExp("@(" + names.map(n => esc(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "g");
    s = s.replace(re, (m, n) => `<span class="mention-tag${n === esc(S.me.name) ? " me" : ""}">@${n}</span>`);
  }
  s = s.replace(/\n/g, "<br>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

function openClaude(text) {
  const url = "https://claude.ai/new" + (text ? "?q=" + encodeURIComponent(text.slice(0, 1800)) : "");
  window.open(url, "_blank", "noopener");
}

/* ---------- モーダル / ポップオーバー ---------- */
function modal(title, body, { foot = "", wide = false, onClose, cls = "" } = {}) {
  closePop();
  const ov = h(`<div class="overlay ${cls}"><div class="modal${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h3>${esc(title)}</h3><span class="head-extra"></span><button class="btn ghost icon" data-close aria-label="閉じる">${icon("x")}</button></div>
    <div class="modal-body"></div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}</div></div>`);
  const b = $(".modal-body", ov);
  typeof body === "string" ? (b.innerHTML = body) : b.appendChild(body);
  const close = () => { ov.remove(); document.removeEventListener("keydown", key); onClose && onClose(); };
  const key = e => { if (e.key === "Escape" && document.body.lastElementChild === ov) close(); };
  ov.addEventListener("mousedown", e => { if (e.target === ov) close(); });
  $("[data-close]", ov).onclick = close;
  document.addEventListener("keydown", key);
  document.body.appendChild(ov);
  ov.close = close;
  setTimeout(() => { const f = $("[autofocus]", ov); f && f.focus(); }, 30);
  return ov;
}
let _pop = null;
function closePop() { if (_pop) { _pop.remove(); _pop = null; } }
function popover(anchor, html, { onMount } = {}) {
  closePop();
  const p = h(`<div class="popover">${html}</div>`);
  document.body.appendChild(p);
  const r = anchor.getBoundingClientRect(), pr = p.getBoundingClientRect();
  let x = Math.min(r.left, innerWidth - pr.width - 8), y = r.bottom + 6;
  if (y + pr.height > innerHeight - 8) y = Math.max(8, r.top - pr.height - 6);
  p.style.left = Math.max(8, x) + "px"; p.style.top = y + "px";
  _pop = p; onMount && onMount(p);
  setTimeout(() => document.addEventListener("mousedown", function off(e) {
    if (_pop === p && !p.contains(e.target)) { closePop(); document.removeEventListener("mousedown", off); }
  }), 0);
  return p;
}
function confirmBox(text, okLabel = "OK", danger = false) {
  return new Promise(res => {
    const ov = modal("確認", `<p style="margin:0">${esc(text)}</p>`, {
      foot: `<button class="btn" data-n>やめる</button><button class="btn ${danger ? "danger" : "primary"}" data-y>${esc(okLabel)}</button>`,
      onClose: () => res(false)
    });
    $("[data-n]", ov).onclick = () => ov.close();
    $("[data-y]", ov).onclick = () => { res(true); ov.remove(); };
  });
}

const EMOJIS = ["👍", "🙏", "✅", "🎉", "❤️", "😂", "👀", "🙆", "👏", "🔥", "💯", "🤔", "😮", "😢", "☕", "🆗"];
function emojiPicker(anchor, pick) {
  popover(anchor, `<div class="emoji-grid">${EMOJIS.map(e => `<button data-e="${e}" aria-label="${e}">${e}</button>`).join("")}</div>`, {
    onMount: p => p.onclick = e => { const b = e.target.closest("[data-e]"); if (b) { closePop(); pick(b.dataset.e); } }
  });
}

/* ---------- 起動・認証・リアルタイム ---------- */
async function boot() {
  S.cfg = { shift_kinds: SHIFT_KINDS, mail: { configured: false, address: "" }, max_upload_mb: TSUNAGI.maxUploadMB, team: "つなぎ" };
  const { data: { session } } = await SB.auth.getSession();
  if (!session) return renderLogin();
  const { data: me } = await SB.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (!me || !me.active) { await SB.auth.signOut(); return renderLogin("このアカウントは現在利用できません。管理者に確認してください"); }
  S.me = me;
  const [t, mail] = await Promise.all([SB.from("teams").select("name").maybeSingle(), SB.rpc("mail_status")]);
  S.cfg.team = (t.data && t.data.name) || "つなぎ";
  if (mail.data) S.cfg.mail = mail.data;
  await Promise.all([loadUsers(), loadChannels()]);
  connectWS();
  UI.start();
  SB.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT") location.reload(); });
}

async function loadUsers() {
  const list = await api("/api/users");
  S.users = Object.fromEntries(list.map(u => [u.id, u]));
  if (S.me) S.me = { ...S.me, ...S.users[S.me.id] };
  emit("users");
}
async function loadChannels() {
  const d = await api("/api/channels");
  S.channels = d.joined; S.joinable = d.joinable;
  updateTitle();
  emit("channels");
}
function updateTitle() {
  const n = S.channels.reduce((a, c) => a + (c.muted ? 0 : c.unread), 0);
  document.title = (n ? `(${n}) ` : "") + "つなぎ";
}

let chReload = 0;
function reloadChannelsSoon() { clearTimeout(chReload); chReload = setTimeout(() => loadChannels().catch(() => { }), 250); }

function handleWS(ev) {
  switch (ev.type) {
    case "message": {
      const m = ev.message, c = S.cache[m.channel_id];
      if (c && !c.messages.some(x => x.id === m.id)) c.messages.push(m);
      const ch = S.channels.find(x => x.id === m.channel_id);
      const viewing = S.cur === m.channel_id && document.visibilityState === "visible" && UI.chatVisible();
      if (ch) {
        ch.last_at = m.created_at; ch.last_body = m.body;
        if (m.user_id !== S.me.id && !viewing) {
          ch.unread++; if (ch.kind === "dm" || (m.body || "").includes("@" + S.me.name)) ch.mentions++;
        }
      } else reloadChannelsSoon();
      delete S.typing[m.channel_id + ":" + m.user_id];
      emit("message", m); updateTitle(); emit("channels");
      if (viewing && m.user_id !== S.me.id) markRead(m.channel_id, m.id);
      break;
    }
    case "message_update": {
      const m = ev.message, c = S.cache[m.channel_id];
      if (c) { const i = c.messages.findIndex(x => x.id === m.id); if (i >= 0) c.messages[i] = m; }
      emit("message_update", m); break;
    }
    case "read": {
      const c = S.cache[ev.channel_id];
      if (c) for (const m of c.messages) if (m.id <= ev.message_id && m.user_id !== ev.user_id && !m.read_by.includes(ev.user_id)) m.read_by.push(ev.user_id);
      emit("read", ev); break;
    }
    case "typing": {
      const k = ev.channel_id + ":" + ev.user_id; S.typing[k] = Date.now() + 4000; emit("typing", ev);
      setTimeout(() => emit("typing", ev), 4100); break;
    }
    case "channels": reloadChannelsSoon(); break;
    case "users": loadUsers(); break;
    default: emit(ev.type, ev);
  }
}

async function markRead(cid, mid) {
  const ch = S.channels.find(x => x.id === cid);
  if (ch) { ch.unread = 0; ch.mentions = 0; ch.last_read_id = Math.max(ch.last_read_id || 0, mid || 0); updateTitle(); emit("channels"); }
  api(`/api/channels/${cid}/read`, { method: "POST", body: { message_id: mid || 0 } }).catch(() => { });
}

function renderLogin(notice) {
  document.body.className = "is-login";
  let saved = ""; try { saved = localStorage.getItem("tsunagi_invite") || ""; } catch { }
  document.body.innerHTML = `<main class="login"><div class="login-stage">
    <div class="owl-stage" aria-hidden="true"><div class="owl-shadow"></div><div class="owl" id="owl"></div></div>
    <div class="card login-card">
      <h1>つなぎ</h1><p class="muted login-lead">チームの連絡・予定・シフト・共有メールを 1 か所に。</p>
      ${notice ? `<p class="login-notice">${esc(notice)}</p>` : ""}
      <div class="seg login-seg"><button type="button" data-m="login" class="on">ログイン</button><button type="button" data-m="register">新規登録</button></div>
      <form id="lf" autocomplete="on">
        <label class="field"><span>招待コード</span><input class="input code-input" name="invite" value="${esc(saved)}" placeholder="XXXXX-XXXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
        <label class="field"><span>ID（半角英数）</span><input class="input" name="login" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
        <label class="field" id="nameField" hidden><span>表示名</span><input class="input" name="name" autocomplete="name"></label>
        <label class="field"><span>パスワード（8 文字以上）</span><input class="input" name="password" type="password" autocomplete="current-password" minlength="8" required></label>
        <label class="row small muted" style="margin:-2px 0 16px;gap:8px"><input type="checkbox" name="remember" ${saved ? "checked" : ""}> この端末に招待コードを保存する</label>
        <button class="btn primary" style="width:100%;height:46px;font-size:15px" id="lbtn">ログイン</button>
      </form>
      <p class="small muted login-foot">招待コードは管理者から受け取ってください。データはチームのメンバーにしか見えません。</p>
    </div></div></main>`;
  const f = $("#lf"); let mode = "login";
  $$(".login-seg button").forEach(b => b.onclick = () => {
    mode = b.dataset.m; $$(".login-seg button").forEach(x => x.classList.toggle("on", x === b));
    $("#nameField").hidden = mode !== "register"; f.name.required = mode === "register";
    f.password.autocomplete = mode === "register" ? "new-password" : "current-password";
    $("#lbtn").textContent = mode === "register" ? "登録してはじめる" : "ログイン";
  });
  f.invite.addEventListener("input", () => {
    const raw = f.invite.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    f.invite.value = raw.length > 5 ? raw.slice(0, 5) + "-" + raw.slice(5) : raw;
  });
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = $("#lbtn"); btn.disabled = true; btn.textContent = "確認しています…";
    try {
      await authCall(mode, { invite: f.invite.value, login: f.login.value, password: f.password.value, name: f.name.value });
      try { f.remember.checked ? localStorage.setItem("tsunagi_invite", f.invite.value) : localStorage.removeItem("tsunagi_invite"); } catch { }
      location.reload();
    } catch (err) { fail(err); btn.disabled = false; btn.textContent = mode === "register" ? "登録してはじめる" : "ログイン"; }
  };
  startOwl($("#owl"));
  (saved ? f.login : f.invite).focus();
}

/** ログイン画面のフクロウ。24 コマの首振りをポインタの位置に追従させる（静止画で始め、読み込めたら差し替え）。 */
function startOwl(el) {
  el.style.backgroundImage = "url(img/owl_hero.webp)";
  el.classList.add("still");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const FR = 24, sheet = new Image();
  sheet.onload = () => {
    el.classList.remove("still"); el.style.backgroundImage = `url(${sheet.src})`;
    let target = 0.5, cur = 0.5, last = performance.now(), idle = 0;
    const set = x => { target = Math.min(1, Math.max(0, x)); idle = 0; };
    addEventListener("pointermove", e => set(e.clientX / innerWidth));
    addEventListener("deviceorientation", e => e.gamma != null && set(0.5 + e.gamma / 60));
    const tick = now => {
      if (!document.body.contains(el)) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now; idle += dt;
      // 操作が無いときはゆっくり見回す
      const goal = idle > 3 ? 0.5 + Math.sin(now / 2200) * 0.32 : target;
      cur += (goal - cur) * Math.min(1, dt * 5);
      const i = Math.round(cur * (FR - 1));
      el.style.backgroundPosition = `${(i / (FR - 1)) * 100}% 0`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  sheet.src = "img/owl_turn.webp";
}

/* ---------- チャット ---------- */
function msgHTML(m, prev, ch, memberIds) {
  const u = U(m.user_id);
  const cont = prev && prev.user_id === m.user_id && !prev.meta?.kind && !m.reply &&
    (new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60 * 1000 && prev.created_at.slice(0, 10) === m.created_at.slice(0, 10);
  const mine = m.user_id === S.me.id;
  const mention = !mine && (m.body || "").includes("@" + S.me.name);
  let body = m.deleted ? `<div class="msg-body deleted">このメッセージは削除されました</div>` :
    (m.body ? `<div class="msg-body">${formatBody(m.body)}${m.edited_at ? ' <span class="small muted">(編集済み)</span>' : ""}</div>` : "");
  if (m.reply) body = `<div class="msg-reply" data-jump="${m.reply.id}">↩ ${esc(U(m.reply.user_id).name)}: ${esc(m.reply.body || "（添付）")}</div>` + body;
  if (m.files.length) {
    body += `<div class="att-grid">${m.files.map(f => f.kind === "image"
      ? `<img class="att-img" data-fsrc="${esc(f.path)}" alt="${esc(f.name)}" loading="lazy" data-file="${f.id}">`
      : `<button class="file-card" data-file="${f.id}">${fileIcon(f)}<span class="file-meta"><div class="file-name">${esc(f.name)}</div><div class="file-sub">${KIND_NAME[f.kind]} · ${fmtSize(f.size)} · クリックでプレビュー</div></span></button>`).join("")}</div>`;
  }
  if (m.meta && m.meta.kind === "email") {
    body += `<div class="mini-card" data-mail="${m.meta.id}"><div class="k">${icon("mail")} 共有されたメール</div><div class="t">${esc(m.meta.subject)}</div><div class="s">${esc(m.meta.from_name)} — ${esc(m.meta.snippet)}</div></div>`;
  }
  const reacts = m.reactions.map(r => `<button class="react${r.user_ids.includes(S.me.id) ? " mine" : ""}" data-react="${esc(r.emoji)}" title="${esc(r.user_ids.map(i => U(i).name).join("、"))}">${r.emoji} <b>${r.user_ids.length}</b></button>`).join("");
  let read = "";
  if (mine && !m.deleted) {
    const others = memberIds.filter(i => i !== S.me.id).length;
    const n = m.read_by.length;
    if (ch.kind === "dm" && others === 1) read = n ? `<span class="read-mark all">既読</span>` : "";
    else if (others) read = `<button class="read-mark${n >= others ? " all" : ""}" data-readers>${n >= others ? "全員既読" : `既読 ${n}/${others}`}</button>`;
  }
  const foot = (reacts || !m.deleted ? reacts + (m.deleted ? "" : `<button class="react react-add" data-addreact aria-label="リアクション">${icon("smile")}</button>`) : "") + read;
  return `<div class="msg${cont ? " cont" : ""}${mention ? " mention" : ""}" data-id="${m.id}">
    ${avatar(u, 40)}<div class="msg-gutter">${fmtTime(m.created_at)}</div>
    <div class="msg-main"><div class="msg-head"><span class="msg-name" data-user="${u.id}">${esc(u.name)}</span><span class="msg-time">${fmtTime(m.created_at)}</span></div>
    ${body}<div class="msg-foot">${foot}</div></div>
    ${m.deleted ? "" : `<div class="msg-tools">
      <button data-addreact title="リアクション">${icon("smile")}</button>
      <button data-reply title="返信">${icon("reply")}</button>
      <button data-task title="タスクバスターに登録">${icon("task")}</button>
      <button data-claude title="Claude に相談">${CLAUDE_MARK}</button>
      <button data-more title="その他">${icon("more")}</button></div>`}
  </div>`;
}

function renderMsgList(listEl, cid, { newSepAfter } = {}) {
  const c = S.cache[cid]; if (!c) return;
  const ch = c.channel; let html = "", prev = null, sepDone = false;
  if (c.has_more) html += `<div class="day-sep"><button class="btn sm ghost" data-older>さらに前を読み込む</button></div>`;
  for (const m of c.messages) {
    if (!prev || prev.created_at.slice(0, 10) !== m.created_at.slice(0, 10)) { html += `<div class="day-sep">${dayLabel(m.created_at)}</div>`; prev = null; }
    if (newSepAfter != null && !sepDone && m.id > newSepAfter && m.user_id !== S.me.id) { html += `<div class="new-sep">ここから未読</div>`; sepDone = true; prev = null; }
    html += msgHTML(m, prev, ch, c.member_ids); prev = m;
  }
  if (!c.messages.length) html = `<div class="empty"><b>${esc(chName(ch))} のはじまり</b>最初のメッセージを送ってみましょう。ファイルはドラッグ＆ドロップか貼り付けで共有できます。</div>`;
  listEl.innerHTML = html;
  hydrateFiles(listEl);
}

/** チャット画面を el に描画する。PC / スマホとも同じ部品を使い、ヘッダーだけ UI 側が差し込む。 */
async function renderChat(el, cid) {
  S.cur = cid; S.replyTo = null;
  el.innerHTML = `<section class="chat">
    <header class="chat-head"></header>
    <div class="chat-scroll"><div class="msgs" aria-live="polite"></div></div>
    <div class="typing"></div>
    <div class="composer"><div class="composer-box">
      <div class="reply-bar" hidden></div><div class="pending"></div>
      <textarea rows="1" placeholder="メッセージを入力" aria-label="メッセージ"></textarea>
      <div class="composer-bar">
        <button class="btn ghost icon sm" data-attach title="ファイルを添付">${icon("clip")}</button>
        <button class="btn ghost icon sm" data-emoji title="絵文字">${icon("smile")}</button>
        <span class="hint">${UI.isMobile ? "" : "Enter で送信 · Shift+Enter で改行 · @ でメンション"}</span>
        <button class="send-btn" data-send aria-label="送信" disabled>${icon("send")}</button>
      </div></div><input type="file" multiple hidden></div>
  </section>`;
  const scroll = $(".chat-scroll", el), list = $(".msgs", el), ta = $("textarea", el), box = $(".composer-box", el);
  const pend = $(".pending", el), fileIn = $("input[type=file]", el), sendBtn = $("[data-send]", el), head = $(".chat-head", el);
  const pending = [];

  let data;
  try { data = await api(`/api/channels/${cid}/messages`); } catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (S.cur !== cid) return;
  S.cache[cid] = data;
  const ch = S.channels.find(x => x.id === cid) || data.channel;
  const drawHead = () => UI.chatHeader(head, ch, data);
  drawHead();
  renderMsgList(list, cid, { newSepAfter: data.my_last_read });
  const sep = $(".new-sep", list);
  requestAnimationFrame(() => { if (sep) sep.scrollIntoView({ block: "center" }); else scroll.scrollTop = scroll.scrollHeight; });
  const last = data.messages[data.messages.length - 1];
  markRead(cid, last ? last.id : 0);
  ta.placeholder = ch.kind === "channel" ? `#${ch.name} へメッセージ` : `${chName(ch)} へメッセージ`;
  if (!UI.isMobile) ta.focus();

  const nearBottom = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 140;
  const redraw = (keep) => {
    const atBottom = nearBottom(), prevH = scroll.scrollHeight, prevTop = scroll.scrollTop;
    renderMsgList(list, cid);
    if (keep === "top") scroll.scrollTop = scroll.scrollHeight - prevH + prevTop;
    else if (atBottom) scroll.scrollTop = scroll.scrollHeight;
  };

  // ---- リアルタイム反映（この画面が生きている間だけ）
  const alive = () => document.body.contains(list) && S.cur === cid;
  const handlers = {
    message: m => { if (!alive()) return; if (m.channel_id === cid) { const mine = m.user_id === S.me.id; redraw(); if (mine) scroll.scrollTop = scroll.scrollHeight; } },
    message_update: m => { if (alive() && m.channel_id === cid) { const node = $(`.msg[data-id="${m.id}"]`, list); node ? redraw() : 0; } },
    read: ev => { if (alive() && ev.channel_id === cid) redraw(); },
    presence: () => { if (alive()) drawHead(); },
    resync: id => { if (alive() && id === cid) api(`/api/channels/${cid}/messages`).then(d => { S.cache[cid] = d; redraw(); }); },
    typing: () => {
      if (!alive()) return;
      const now = Date.now();
      const who = Object.entries(S.typing).filter(([k, t]) => k.startsWith(cid + ":") && t > now).map(([k]) => U(k.split(":")[1]).name);
      $(".typing", el).textContent = who.length ? `${who.join("、")} さんが入力中…` : "";
    },
  };
  if (S.chatOff) S.chatOff();
  const offs = Object.entries(handlers).map(([k, fn]) => on(k, fn));
  S.chatOff = () => offs.forEach(f => f());

  // ---- 古い履歴
  scroll.addEventListener("scroll", () => { if (scroll.scrollTop < 40 && data.has_more && !scroll.dataset.loading) loadOlder(); });
  async function loadOlder() {
    scroll.dataset.loading = 1;
    try {
      const first = S.cache[cid].messages[0];
      const d = await api(`/api/channels/${cid}/messages?before=${first ? first.id : 0}`);
      S.cache[cid].messages = [...d.messages, ...S.cache[cid].messages]; S.cache[cid].has_more = d.has_more; data.has_more = d.has_more;
      redraw("top");
    } finally { delete scroll.dataset.loading; }
  }

  // ---- メッセージ上の操作
  list.addEventListener("click", e => {
    const t = e.target, msgEl = t.closest(".msg"), mid = msgEl ? +msgEl.dataset.id : 0;
    const m = mid && S.cache[cid].messages.find(x => x.id === mid);
    if (t.closest("[data-older]")) return loadOlder();
    if (t.closest("[data-file]")) { const f = m.files.find(x => x.id === +t.closest("[data-file]").dataset.file); return openViewer(f); }
    if (t.closest("[data-mail]")) return UI.openMail(+t.closest("[data-mail]").dataset.mail);
    if (t.closest("[data-user]")) return showProfile(t.closest("[data-user]").dataset.user);
    if (t.closest("[data-jump]")) { const n = $(`.msg[data-id="${t.closest("[data-jump]").dataset.jump}"]`, list); if (n) { n.scrollIntoView({ block: "center", behavior: "smooth" }); n.classList.add("flash"); setTimeout(() => n.classList.remove("flash"), 1700); } return; }
    if (!m) return;
    if (t.closest("[data-react]")) return toggleReact(m.id, t.closest("[data-react]").dataset.react);
    if (t.closest("[data-addreact]")) return emojiPicker(t.closest("button"), em => toggleReact(m.id, em));
    if (t.closest("[data-readers]")) return showReaders(t.closest("button"), m, S.cache[cid]);
    if (t.closest("[data-reply]")) return setReply(m);
    if (t.closest("[data-task]")) return taskFromText(m.body || (m.files[0] && m.files[0].name) || "", `${chName(ch)} のメッセージ（${U(m.user_id).name}）`);
    if (t.closest("[data-claude]")) return openClaude(`次のチャットメッセージについて相談させてください。\n\n「${m.body}」\n（${U(m.user_id).name}, ${chName(ch)}）`);
    if (t.closest("[data-more]")) return msgMenu(t.closest("button"), m);
  });
  // スマホ: 長押しでアクションシート
  let pressT = 0;
  list.addEventListener("touchstart", e => {
    const msgEl = e.target.closest(".msg"); if (!msgEl || e.target.closest("button,a,img")) return;
    pressT = setTimeout(() => { const m = S.cache[cid].messages.find(x => x.id === +msgEl.dataset.id); if (m && !m.deleted) UI.messageSheet(m, ch, { setReply, toggleReact, msgMenuActions }); }, 420);
  }, { passive: true });
  ["touchend", "touchmove", "touchcancel"].forEach(n => list.addEventListener(n, () => clearTimeout(pressT), { passive: true }));

  function toggleReact(mid, emoji) { api(`/api/messages/${mid}/reactions`, { method: "POST", body: { emoji } }).then(() => refreshReactions(mid)).catch(fail); }
  function setReply(m) {
    S.replyTo = m.id; const rb = $(".reply-bar", el); rb.hidden = false;
    rb.innerHTML = `${icon("reply")}<span class="grow ellipsis">${esc(U(m.user_id).name)}: ${esc(m.body || "（添付）")}</span><button aria-label="返信をやめる">${icon("x")}</button>`;
    $("button", rb).onclick = () => { S.replyTo = null; rb.hidden = true; }; ta.focus();
  }
  function msgMenuActions(m) {
    const acts = [
      ["コピー", () => navigator.clipboard.writeText(m.body || "").then(() => toast("コピーしました"))],
      ["別のチャンネルへ転送", () => pickChannel("転送先", async to => { await api(`/api/channels/${to}/messages`, { method: "POST", body: { body: `> ${U(m.user_id).name}: ${m.body}`, file_ids: m.files.map(f => f.id) } }); toast("転送しました"); })],
    ];
    if (m.user_id === S.me.id) {
      acts.push(["編集", () => editMessage(m)]);
      acts.push(["削除", async () => { if (await confirmBox("このメッセージを削除しますか？", "削除", true)) api(`/api/messages/${m.id}`, { method: "DELETE" }).then(() => refreshMessage(m.id)).catch(fail); }, true]);
    }
    return acts;
  }
  function msgMenu(anchor, m) {
    const acts = msgMenuActions(m);
    popover(anchor, `<div class="menu">${acts.map((a, i) => `<button data-i="${i}" class="${a[2] ? "danger" : ""}">${a[0]}</button>`).join("")}</div>`,
      { onMount: p => p.onclick = e => { const b = e.target.closest("[data-i]"); if (b) { closePop(); acts[+b.dataset.i][1](); } } });
  }
  function editMessage(m) {
    const ov = modal("メッセージを編集", `<textarea class="input" rows="5" autofocus>${esc(m.body)}</textarea>`,
      { foot: `<button class="btn" data-c>やめる</button><button class="btn primary" data-s>保存</button>` });
    $("[data-c]", ov).onclick = () => ov.close();
    $("[data-s]", ov).onclick = () => api(`/api/messages/${m.id}`, { method: "PUT", body: { body: $("textarea", ov).value } }).then(() => { ov.close(); refreshMessage(m.id); }).catch(fail);
  }

  // ---- 入力・送信
  const canSend = () => ta.value.trim() || pending.some(p => p.file);
  const sync = () => { sendBtn.disabled = !canSend() || pending.some(p => !p.done); ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, innerHeight * .4) + "px"; };
  let lastTyping = 0;
  ta.addEventListener("input", () => {
    sync(); mentionAssist();
    if (Date.now() - lastTyping > 2500 && ta.value) { lastTyping = Date.now(); wsSend({ type: "typing", channel_id: cid }); }
  });
  ta.addEventListener("keydown", e => {
    if (_pop && _pop.dataset.mention && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); $("button", _pop).click(); return; }
    // IME 変換確定の Enter では送らない（日本語入力の必須対応）
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !UI.isMobile) { e.preventDefault(); send(); }
    if (e.key === "ArrowUp" && !ta.value) {
      const mine = [...S.cache[cid].messages].reverse().find(x => x.user_id === S.me.id && !x.deleted);
      if (mine) { e.preventDefault(); editMessage(mine); }
    }
  });
  function mentionAssist() {
    const before = ta.value.slice(0, ta.selectionStart), mm = before.match(/@([^\s@]*)$/);
    if (!mm) { if (_pop && _pop.dataset.mention) closePop(); return; }
    const qq = mm[1].toLowerCase();
    const cands = Object.values(S.users).filter(u => (u.name + (u.kana || "") + u.login).toLowerCase().includes(qq)).slice(0, 6);
    if (!cands.length) return closePop();
    const p = popover(ta, `<div class="menu">${cands.map(u => `<button data-n="${esc(u.name)}">${avatar(u, 22)} ${esc(u.name)} <span class="muted small">${esc(u.title || "")}</span></button>`).join("")}</div>`, {
      onMount: p => {
        p.onmousedown = e => e.preventDefault();  // 入力欄のフォーカスを奪わない
        p.onclick = e => {
          const b = e.target.closest("[data-n]"); if (!b) return;
          const pos = ta.selectionStart, start = before.length - mm[0].length;
          ta.value = ta.value.slice(0, start) + "@" + b.dataset.n + " " + ta.value.slice(pos);
          ta.selectionStart = ta.selectionEnd = start + b.dataset.n.length + 2; closePop(); ta.focus(); sync();
        };
      }
    });
    p.dataset.mention = 1;
  }
  async function send() {
    if (!canSend() || pending.some(p => !p.done)) return;
    const body = ta.value, file_ids = pending.filter(p => p.file).map(p => p.file.id), reply_to = S.replyTo;
    ta.value = ""; pending.length = 0; pend.innerHTML = ""; S.replyTo = null; $(".reply-bar", el).hidden = true; sync();
    try { const m = await api(`/api/channels/${cid}/messages`, { method: "POST", body: { body, file_ids, reply_to } }); handleWS({ type: "message", message: m }); }
    catch (e) { ta.value = body; sync(); fail(e); }
  }
  sendBtn.onclick = send;
  $("[data-emoji]", el).onclick = e => emojiPicker(e.currentTarget, em => { ta.setRangeText(em, ta.selectionStart, ta.selectionEnd, "end"); ta.focus(); sync(); });

  // ---- 添付（ボタン・ドラッグ＆ドロップ・貼り付け）
  $("[data-attach]", el).onclick = () => fileIn.click();
  fileIn.onchange = () => { addFiles([...fileIn.files]); fileIn.value = ""; };
  ta.addEventListener("paste", e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  const chatEl = $(".chat", el);
  chatEl.addEventListener("dragover", e => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); box.classList.add("drag"); } });
  chatEl.addEventListener("dragleave", e => { if (!chatEl.contains(e.relatedTarget)) box.classList.remove("drag"); });
  chatEl.addEventListener("drop", e => { e.preventDefault(); box.classList.remove("drag"); addFiles([...e.dataTransfer.files]); });
  function addFiles(files) {
    const max = (S.cfg.max_upload_mb || 200) * 1048576;
    for (const f of files) {
      if (f.size > max) { toast(`${f.name} は大きすぎます（上限 ${S.cfg.max_upload_mb}MB）`, true); continue; }
      const item = { done: false, file: null };
      const isImg = f.type.startsWith("image/");
      const node = h(`<div class="pend">${isImg ? `<img alt="">` : fileIcon({ name: f.name, kind: guessKind(f.name) })}<span class="ellipsis">${esc(f.name || "画像")}</span><button aria-label="取り消す">×</button><span class="bar" style="width:0"></span></div>`);
      if (isImg) { const r = new FileReader(); r.onload = () => $("img", node).src = r.result; r.readAsDataURL(f); }
      $("button", node).onclick = () => { pending.splice(pending.indexOf(item), 1); node.remove(); sync(); };
      pend.appendChild(node); pending.push(item); sync();
      uploadFile(f, cid, p => $(".bar", node).style.width = (p * 100) + "%")
        .then(r => { item.file = r; item.done = true; $(".bar", node).style.width = "100%"; setTimeout(() => $(".bar", node).style.opacity = 0, 300); sync(); })
        .catch(err => { fail(err); node.remove(); pending.splice(pending.indexOf(item), 1); sync(); });
    }
    ta.focus();
  }
}


function showReaders(anchor, m, c) {
  const others = c.member_ids.filter(i => i !== S.me.id);
  const read = others.filter(i => m.read_by.includes(i)), unread = others.filter(i => !m.read_by.includes(i));
  const row = ids => ids.map(i => `<div class="row" style="padding:4px 2px">${avatar(U(i), 24)}<span>${esc(U(i).name)}</span></div>`).join("") || `<div class="muted small" style="padding:4px 2px">なし</div>`;
  popover(anchor, `<div style="min-width:200px;max-height:320px;overflow:auto"><div class="section-title">既読 ${read.length}</div>${row(read)}
    <div class="section-title" style="margin-top:10px">未読 ${unread.length}</div>${row(unread)}</div>`);
}

function pickChannel(title, onPick) {
  const list = [...S.channels].sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));
  const ov = modal(title, `<input class="input" placeholder="チャンネル・人の名前で絞り込み" autofocus style="margin-bottom:10px">
    <div class="list" style="border:1px solid var(--line);border-radius:12px;overflow:hidden;max-height:50vh;overflow-y:auto"></div>`);
  const draw = (q = "") => {
    $(".list", ov).innerHTML = list.filter(c => chName(c).includes(q)).map(c => `<button class="li" data-c="${c.id}">${chIcon(c)}<span class="grow ellipsis">${esc(chName(c))}</span></button>`).join("");
  };
  draw(); $("input", ov).oninput = e => draw(e.target.value.trim());
  $(".list", ov).onclick = e => { const b = e.target.closest("[data-c]"); if (b) { ov.close(); Promise.resolve(onPick(+b.dataset.c)).catch(fail); } };
}

/* ---------- タスク化（チームタスク / 自分のタスク） ---------- */
function taskFromText(text, source, { dest = "team", assignee = "" } = {}) {
  const first = (text || "").split("\n").find(Boolean) || "";
  const members = Object.values(S.users).filter(u => u.active);
  const ov = modal("タスクにする", `
    <div class="seg" style="width:100%;display:grid;grid-template-columns:1fr 1fr;margin-bottom:14px">
      <button type="button" data-d="team" class="${dest === "team" ? "on" : ""}">チームタスク</button>
      <button type="button" data-d="me" class="${dest === "me" ? "on" : ""}">自分のタスク</button></div>
    <label class="field"><span>やること（動詞で終える）</span><input class="input" name="title" value="${esc(first.slice(0, 60))}" autofocus></label>
    <div class="row"><label class="field grow"><span>期日</span><input class="input" type="date" name="due"></label>
      <label class="field grow" data-only="team"><span>担当</span><select class="input" name="assignee"><option value="">未定</option>
        ${members.map(u => `<option value="${u.id}"${u.id === assignee ? " selected" : ""}>${esc(u.name)}${u.id === S.me.id ? "（自分）" : ""}</option>`).join("")}</select></label></div>
    <label class="field"><span>メモ</span><textarea class="input" name="memo" rows="4">${esc(text)}</textarea></label>
    <p class="small muted" style="margin:0" data-hint></p>`,
    { foot: `<button class="btn" data-c>やめる</button><button class="btn primary" data-s>${icon("task")} 登録</button>` });
  const hint = () => {
    $("[data-only=team]", ov).hidden = dest !== "team";
    $("[data-hint]", ov).textContent = dest === "team" ? `チーム全員に見えます · 登録元: ${source}` : "あなたにだけ見えます（タスクバスターをつないでいればそちらに入ります）";
    $$("[data-d]", ov).forEach(b => b.classList.toggle("on", b.dataset.d === dest));
  };
  $$("[data-d]", ov).forEach(b => b.onclick = () => { dest = b.dataset.d; hint(); });
  hint();
  $("[data-c]", ov).onclick = () => ov.close();
  $("[data-s]", ov).onclick = async () => {
    const title = $("[name=title]", ov).value.trim(), due = $("[name=due]", ov).value, memo = $("[name=memo]", ov).value;
    if (!title) return toast("やることを入力してください", true);
    try {
      if (dest === "team") {
        await teamTaskCreate({ title, due: due || null, memo, assignee_id: $("[name=assignee]", ov).value || null, source });
        ov.close(); toast("チームタスクに登録しました");
      } else {
        const r = await api("/api/tasks", { method: "POST", body: { title, due, memo, source } });
        ov.close(); toast(r.mode === "taskbuster" ? "タスクバスターに登録しました" : "自分のタスクに登録しました");
      }
      emit("tasks"); emit("team_tasks");
    } catch (e) { fail(e); }
  };
}
async function teamTaskCreate(t) {
  const row = must(await SB.from("team_tasks").insert({ team_id: S.me.team_id, created_by: S.me.id, title: t.title, due: t.due || null,
    memo: t.memo || "", assignee_id: t.assignee_id || null, source: t.source || "", priority: t.priority || 2,
    goal: t.goal || "", done_def: t.done_def || "", deliverable: t.deliverable || "" }).select().single());
  await SB.from("team_task_logs").insert({ task_id: row.id, team_id: S.me.team_id, user_id: S.me.id, body: "登録しました" });
  return row;
}

/* ---------- ファイルビューア ---------- */
async function openViewer(f) {
  const stage = h(`<div class="viewer"><div class="viewer-stage center"><div class="empty">読み込み中…</div></div></div>`);
  const ov = modal(f.name, stage, { wide: true });
  const extra = $(".head-extra", ov);
  extra.className = "row";
  extra.innerHTML = `<span class="small muted">${KIND_NAME[f.kind] || ""} · ${fmtSize(f.size || 0)}</span>
    <button class="btn sm claude" data-claude hidden>${CLAUDE_MARK} Claude に聞く</button>
    <button class="btn sm" data-share>${icon("share")} 共有</button>
    <a class="btn sm" data-dl target="_blank" rel="noopener">${icon("dl")} 保存</a>`;
  $("[data-share]", extra).onclick = () => pickChannel(`「${f.name}」を共有`, async cid => { await api(`/api/files/${f.id}/share`, { method: "POST", body: { channel_id: cid } }); toast("共有しました"); });
  const st = $(".viewer-stage", stage);
  let url, dl;
  try { [url, dl] = await Promise.all([fileUrl(f), fileUrl(f, true)]); } catch (e) { st.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  $("[data-dl]", extra).href = dl;
  if (f.kind === "image") { st.innerHTML = `<img src="${esc(url)}" alt="${esc(f.name)}">`; return; }
  if (f.kind === "pdf") {
    // iOS の iframe は 1 ページ目しか出ないので、別タブで開く導線を必ず添える
    st.innerHTML = `<iframe src="${esc(url)}" title="${esc(f.name)}"></iframe>`;
    extra.insertAdjacentHTML("afterbegin", `<a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">別タブで開く</a>`);
    return;
  }
  if (f.kind === "video") { st.innerHTML = `<video src="${esc(url)}" controls playsinline></video>`; return; }
  if (f.kind === "audio") { st.innerHTML = `<div style="padding:40px;width:min(560px,100%)"><div class="row" style="margin-bottom:16px">${fileIcon(f)}<b>${esc(f.name)}</b></div><audio src="${esc(url)}" controls style="width:100%"></audio></div>`; return; }
  let p;
  try { p = await previewFile(f); } catch (e) { st.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  st.classList.remove("center");
  let plain = "";
  if (p.type === "text") { st.innerHTML = `<pre class="code-view">${esc(p.text)}</pre>`; plain = p.text; }
  else if (p.type === "doc") {
    st.innerHTML = `<article class="doc-page">${p.blocks.map(b => b.h === 1 ? `<h1>${esc(b.t)}</h1>` : b.h === 2 ? `<h2>${esc(b.t)}</h2>` : `<p>${esc(b.t)}</p>`).join("") || '<p class="muted">本文が見つかりませんでした</p>'}</article>`;
    plain = p.blocks.map(b => b.t).join("\n");
  } else if (p.type === "table") {
    const draw = i => {
      const sh = p.sheets[i];
      return `${p.sheets.length > 1 ? `<div class="sheet-tabs">${p.sheets.map((s, j) => `<button class="chip${i === j ? " on" : ""}" data-sh="${j}">${esc(s.name)}</button>`).join("")}</div>` : ""}
        <div style="padding:16px;overflow:auto"><table class="sheet"><tbody>${sh.rows.map((r, ri) => `<tr><th>${ri + 1}</th>${r.map(c => `<td title="${esc(c)}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    };
    st.innerHTML = draw(0); st.style.display = "block";
    st.onclick = e => { const b = e.target.closest("[data-sh]"); if (b) st.innerHTML = draw(+b.dataset.sh); };
    plain = p.sheets[0] ? p.sheets[0].rows.slice(0, 60).map(r => r.join(",")).join("\n") : "";
  } else if (p.type === "slides") {
    st.innerHTML = `<div class="slide-list" style="margin:0 auto">${p.slides.map((s, i) => `<div class="slide"><h4>${esc(s.title)}</h4><ul>${s.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul><span class="no">${i + 1} / ${p.slides.length}</span></div>`).join("")}</div>`;
    plain = p.slides.map((s, i) => `[${i + 1}] ${s.title}\n${s.lines.join("\n")}`).join("\n\n");
  } else if (p.type === "list") { st.innerHTML = `<pre class="code-view">${esc(p.items.join("\n"))}</pre>`; }
  else { st.classList.add("center"); st.innerHTML = `<div class="empty">${fileIcon(f)}<b style="margin-top:12px">${esc(f.name)}</b>${esc(p.reason || "")}<div style="margin-top:14px"><a class="btn primary" href="${esc(dl)}" target="_blank" rel="noopener">${icon("dl")} ダウンロード</a></div></div>`; }
  if (plain) {
    const b = $("[data-claude]", extra); b.hidden = false;
    b.onclick = () => openClaude(`ファイル「${f.name}」の内容です。要点をまとめてください。\n\n${plain.slice(0, 1500)}`);
  }
}

/* ---------- プロフィール ---------- */
function showProfile(uid) {
  const u = U(uid), isMe = uid === S.me.id;
  const ov = modal(isMe ? "あなたのプロフィール" : "プロフィール", `
    <div class="profile-hero">${avatar(u, 72)}<div><div style="font-size:20px;font-weight:800">${esc(u.name)}</div>
      <div class="muted">${esc([u.title, u.dept].filter(Boolean).join(" · "))}</div>
      <div class="small" style="margin-top:4px">${S.online.has(uid) ? '<span style="color:var(--ok)">● オンライン</span>' : '<span class="muted">○ オフライン</span>'}
      ${u.status_text || u.status_emoji ? ` · ${esc(u.status_emoji)} ${esc(u.status_text)}` : ""}</div></div></div>
    ${u.bio ? `<p style="margin:16px 0 0;white-space:pre-wrap">${esc(u.bio)}</p>` : ""}
    <dl class="kv">
      ${u.email ? `<dt>メール</dt><dd><a href="mailto:${esc(u.email)}">${esc(u.email)}</a></dd>` : ""}
      ${u.phone ? `<dt>電話</dt><dd><a href="tel:${esc(u.phone)}">${esc(u.phone)}</a></dd>` : ""}
      ${u.kana ? `<dt>ふりがな</dt><dd>${esc(u.kana)}</dd>` : ""}
      <dt>ID</dt><dd>${esc(u.login)}</dd>
    </dl>`, {
    foot: isMe ? `<button class="btn danger" data-out>${icon("logout")} ログアウト</button><span class="grow"></span><button class="btn primary" data-edit>${icon("edit")} 編集</button>`
      : `${u.phone ? `<a class="btn" href="tel:${esc(u.phone)}">${icon("phone")} 電話</a>` : ""}<button class="btn primary" data-dm>${icon("chat")} メッセージ</button>`
  });
  if (isMe) { $("[data-edit]", ov).onclick = () => { ov.close(); editProfile(); }; $("[data-out]", ov).onclick = () => signOut(); }
  else $("[data-dm]", ov).onclick = async () => { ov.close(); const r = await api("/api/dm", { method: "POST", body: { user_ids: [uid] } }); await loadChannels(); UI.openChannel(r.id); };
}

function editProfile() {
  const u = S.me;
  const colors = ["#5b7cfa", "#14b8a6", "#f59e0b", "#ec4899", "#8b5cf6", "#10b981", "#ef6c4a", "#0ea5e9", "#64748b"];
  const f = (n, label, type = "text") => `<label class="field"><span>${label}</span><input class="input" name="${n}" type="${type}" value="${esc(u[n] || "")}"></label>`;
  const ov = modal("プロフィールを編集", `<form>
    <div class="row" style="align-items:flex-start;gap:14px">${avatar(u, 56, false)}<div class="grow">${f("name", "表示名")}${f("kana", "ふりがな")}</div></div>
    <div class="row"><div class="grow">${f("title", "役割")}</div><div class="grow">${f("dept", "部署")}</div></div>
    <div class="row"><div style="width:84px">${f("status_emoji", "状態")}</div><div class="grow">${f("status_text", "ひとこと（例: 15時まで外出）")}</div></div>
    <div class="row"><div class="grow">${f("email", "メール", "email")}</div><div class="grow">${f("phone", "電話", "tel")}</div></div>
    <label class="field"><span>自己紹介</span><textarea class="input" name="bio" rows="3">${esc(u.bio || "")}</textarea></label>
    <div class="field"><span>色</span><div class="row wrap">${colors.map(c => `<button type="button" class="avatar" data-col="${c}" style="--s:30px;--c:${c};${c === u.color ? "outline:3px solid var(--accent);outline-offset:2px" : ""}"></button>`).join("")}</div></div>
    ${f("password", "新しいパスワード（変えるときだけ・8 文字以上）", "password")}
  </form>`, { foot: `<button class="btn" data-c>やめる</button><button class="btn primary" data-s>保存</button>` });
  let color = u.color;
  $$("[data-col]", ov).forEach(b => b.onclick = () => { color = b.dataset.col; $$("[data-col]", ov).forEach(x => x.style.outline = x === b ? "3px solid var(--accent)" : ""); });
  $("[data-c]", ov).onclick = () => ov.close();
  $("[data-s]", ov).onclick = async () => {
    const fd = Object.fromEntries(new FormData($("form", ov)));
    if (!fd.password) delete fd.password;
    try { S.me = await api("/api/me", { method: "PUT", body: { ...fd, color } }); await loadUsers(); ov.close(); toast("保存しました"); } catch (e) { fail(e); }
  };
}

window.addEventListener("DOMContentLoaded", () => boot().catch(e => { document.body.innerHTML = `<div class="empty"><b>起動できませんでした</b>${esc(e.message)}</div>`; }));
