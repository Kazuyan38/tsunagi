/* owl — 各画面（ホーム・メール・予定・シフト・連絡先・ファイル・タスク・検索）。PC / スマホ共通。 */
"use strict";

/** 画面単位の購読。画面を切り替えたら前の画面の購読を外す。 */
function screenOn(handlers) {
  if (S.screenOff) S.screenOff();
  const offs = Object.entries(handlers).map(([k, fn]) => on(k, fn));
  S.screenOff = () => offs.forEach(f => f());
}
const greet = () => { const h = new Date().getHours(); return h < 5 ? "おつかれさまです" : h < 11 ? "おはようございます" : h < 18 ? "こんにちは" : "おつかれさまです"; };

/** チャンネルを最新のメッセージまで既読にする（一覧の左スワイプ用）。 */
async function readChannel(cid) {
  const { data } = await SB.from("messages").select("id").eq("channel_id", cid).order("id", { ascending: false }).limit(1);
  if (data && data[0]) await markRead(cid, data[0].id);
  toast("既読にしました");
}
async function setMailStatus(id, body, msg) { await api(`/api/mail/${id}`, { method: "PUT", body }); toast(msg); emit("mail"); }

/* ================================================================ ホーム */
async function renderHome(el) {
  const d = new Date();
  el.innerHTML = `<div class="home">
    <header class="home-hero">
      <div class="home-greet"><div class="muted small">${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）</div>
        <h1>${greet()}、${esc(S.me.name.split(/\s/).pop())}さん</h1>
        <button class="home-next" data-next hidden></button></div>
      <nav class="home-stats" aria-label="今日の数字">
        <button class="stat" data-goto="chat" data-stat="unread"><span class="stat-ico">${icon("chat")}</span><span class="stat-n">–</span><span class="stat-l"><span class="l-long">未読メッセージ</span><span class="l-short">未読</span></span></button>
        <button class="stat" data-goto="mail" data-stat="mail"><span class="stat-ico">${icon("mail")}</span><span class="stat-n">–</span><span class="stat-l"><span class="l-long">対応メール</span><span class="l-short">メール</span></span></button>
        <button class="stat" data-goto="calendar" data-stat="events"><span class="stat-ico">${icon("cal")}</span><span class="stat-n">–</span><span class="stat-l"><span class="l-long">今日の予定</span><span class="l-short">予定</span></span></button>
        <button class="stat" data-goto="tasks" data-stat="tasks"><span class="stat-ico">${icon("task")}</span><span class="stat-n">–</span><span class="stat-l"><span class="l-long">担当タスク</span><span class="l-short">タスク</span></span></button>
      </nav>
    </header>
    <p class="home-calm" hidden></p>
    <div class="home-grid">
      <section class="card home-card" data-k="attention"><h2 class="section-title">${icon("chat")} 未読のメッセージ</h2><div class="hc-body"></div></section>
      <section class="card home-card" data-k="mail"><h2 class="section-title">${icon("mail")} 対応が必要なメール</h2><div class="hc-body"></div></section>
      <section class="card home-card" data-k="events"><h2 class="section-title">${icon("cal")} 今日の予定</h2><div class="hc-body"></div></section>
      <section class="card home-card" data-k="shift"><h2 class="section-title">${icon("shift")} 今日のシフト</h2><div class="hc-body"></div></section>
      <section class="card home-card" data-k="tasks"><h2 class="section-title">${icon("task")} あなたの担当タスク</h2><div class="hc-body"><div class="muted small">読み込み中…</div></div></section>
    </div></div>`;

  // 数字は 0 なら灰色、1 以上なら色付き、要注意（メンション・期日超過）は赤
  const setStat = (k, n, tone = "", tip = "") => {
    const b = $(`[data-stat="${k}"]`, el); if (!b) return;
    $(".stat-n", b).textContent = n;
    b.className = `stat${n ? " has" : ""}${tone ? " " + tone : ""}`;
    b.title = tip;
  };
  const LIMIT = UI.isMobile ? 3 : 5;
  const more = (n, goto) => n > LIMIT ? `<button class="more-link" data-goto="${goto}">すべて見る（${n} 件）</button>` : "";
  // 空のカードは隠して 1 行にまとめる（「何も無い」を 5 枚のカードで見せない）
  const empties = new Set();
  const calm = () => {
    const names = { attention: "未読", mail: "対応メール", events: "今日の予定", shift: "今日のシフト", tasks: "担当タスク" };
    const list = ["attention", "mail", "events", "tasks", "shift"].filter(k => empties.has(k)).map(k => names[k]);
    const p = $(".home-calm", el); if (!p) return;
    p.hidden = !list.length;
    p.innerHTML = `${icon("check")} ${list.join("・")}はありません`;
  };
  const setCard = (k, html, isEmpty) => {
    const sec = $(`[data-k="${k}"]`, el); if (!sec) return;
    sec.hidden = isEmpty; isEmpty ? empties.add(k) : empties.delete(k);
    if (!isEmpty) $(".hc-body", sec).innerHTML = html;
    calm();
  };
  // いちばん先にやることを 1 つだけ示す（優先: 期日超過 > メンション > 担当メール > 未読 DM > 次の予定）
  const next = { task: null, rest: null };
  const showNext = () => {
    const b = $("[data-next]", el); if (!b) return;
    const n = next.task || next.rest;
    b.hidden = !n;
    if (n) { b.innerHTML = `<span class="next-k">まずこれ</span><span class="next-t">${n.html}</span>${icon("chev")}`; b.onclick = n.go; }
  };
  const load = async () => {
    const h = await api("/api/home");
    if (!document.body.contains(el.firstElementChild)) return;
    const att = h.attention;
    setCard("attention", `<div class="list">${att.slice(0, LIMIT).map(c => `<button class="li" data-ch="${c.id}">${chIcon(c, 28)}
      <span class="grow" style="min-width:0"><div class="li-title ellipsis">${esc(chName(c))}</div><div class="li-sub">${esc(c.last_body || "")}</div></span>
      ${c.mentions ? `<span class="badge alert" title="あなた宛て">@${c.mentions}</span>` : ""}<span class="badge">${c.unread}</span></button>`).join("")}</div>${more(att.length, "chat")}`, !att.length);
    setCard("mail", `<div class="list">${h.mail.slice(0, LIMIT).map(m => mailRow(m, true)).join("")}</div>${more(h.mail.length, "mail")}`, !h.mail.length);
    setCard("events", h.events.map(e => `<button class="ev-row" data-ev="${e.id}"><span class="tm">${e.all_day ? "終日" : fmtTime(e.start)}</span><span class="bar" style="background:${esc(e.color || "var(--accent)")}"></span>
      <span class="grow"><b>${esc(e.title)}</b><div class="small muted">${esc(e.location || "")}${e.all_day ? "" : ` · 〜${fmtTime(e.end)}`}</div></span></button>`).join(""), !h.events.length);
    const mine = h.my_shift;
    setCard("shift", `<div class="row" style="margin-bottom:10px"><span class="small muted">あなた</span>${mine ? `<span class="chip${mine.kind === "work" ? " on" : ""}">${shiftLabel(mine)}</span>` : `<span class="chip">未設定</span>`}</div>
      ${h.working.length ? `<div class="row wrap" style="gap:6px">${h.working.map(w => `<span class="chip">${avatar(U(w.user_id), 18, false)} ${esc(shortName(U(w.user_id)))} <span class="muted">${shiftLabel(w)}</span></span>`).join("")}</div>` : `<div class="muted small">出勤予定のメンバーはいません</div>`}`, !mine && !h.working.length);
    const unreadTotal = att.reduce((a, c) => a + c.unread, 0);
    const parts = [unreadTotal ? `未読 ${unreadTotal} 件` : "", h.mail.length ? `メール ${h.mail.length} 件` : "", h.events.length ? `予定 ${h.events.length} 件` : ""].filter(Boolean);
    setStat("unread", unreadTotal, att.some(c => c.mentions) ? "alert" : "");
    setStat("mail", h.mail.length);
    setStat("events", h.events.length);
    void parts;
    const mention = att.find(c => c.mentions);
    const myMail = h.mail.find(m => m.assignee_id === S.me.id);
    const dm = att.find(c => c.kind === "dm");
    const nowT = fmtTime(localISO(new Date().toISOString()));
    const upcoming = h.events.find(e => e.all_day || fmtTime(e.start) >= nowT);
    next.rest = mention ? { html: `${esc(chName(mention))} であなた宛ての連絡が ${mention.mentions} 件`, go: () => UI.openChannel(mention.id) }
      : myMail ? { html: `担当のメール「${esc(myMail.subject)}」`, go: () => UI.openMail(myMail.id) }
      : dm ? { html: `${esc(chName(dm))} から未読 ${dm.unread} 件`, go: () => UI.openChannel(dm.id) }
      : upcoming ? { html: `${upcoming.all_day ? "今日" : fmtTime(upcoming.start)} ${esc(upcoming.title)}`, go: () => UI.goto("calendar") } : null;
    showNext();
  };
  const loadTasks = async () => {
    if (!$('[data-k="tasks"]', el)) return;
    const rows = (await SB.from("team_tasks").select("*").eq("assignee_id", S.me.id).in("status", ["todo", "doing", "waiting"]).order("due", { nullsFirst: false }).limit(30)).data || [];
    rows.sort(byDue);
    const over = rows.filter(t => t.due && t.due < todayStr()).length;
    setStat("tasks", rows.length, over ? "alert" : "", over ? `うち ${over} 件が期日超過` : "");
    setCard("tasks", `<div class="list">${rows.slice(0, LIMIT).map(t => `<button class="li" data-tt="${t.id}"><span class="grow" style="min-width:0"><div class="ellipsis">${esc(t.title)}</div><div class="tt-meta">${dueLabel(t.due)}<span class="status-pill st-${t.status}">${TASK_STATUS[t.status]}</span></div></span></button>`).join("")}</div>`
      + more(rows.length, "tasks"), !rows.length);
    const od = rows.find(t => t.due && t.due < todayStr());
    next.task = od ? { html: `期日を過ぎたタスク「${esc(od.title)}」`, go: () => openTeamTask(od.id) } : null;
    showNext();
  };
  el.onclick = e => {
    const c = e.target.closest("[data-ch]"); if (c) return UI.openChannel(+c.dataset.ch);
    const m = e.target.closest("[data-mail]"); if (m) return UI.openMail(+m.dataset.mail);
    const ev = e.target.closest("[data-ev]"); if (ev) return UI.goto("calendar");
    const st = e.target.closest("[data-goto]"); if (st) return UI.goto(st.dataset.goto);
    const tt = e.target.closest("[data-tt]"); if (tt) return openTeamTask(+tt.dataset.tt);
  };
  swipeRows(el, ".home-card .li[data-ch]", row => ({ left: { label: "既読にする", icon: "check", tone: "ok", run: () => readChannel(+row.dataset.ch) } }));
  swipeRows(el, ".home-card .mail-row", row => ({ left: { label: "完了", icon: "check", tone: "ok", run: () => setMailStatus(+row.dataset.mail, { status: "done" }, "完了にしました") } }));
  screenOn({ channels: () => load(), mail: load, mail_read: load, events: load, shifts: load, team_tasks: loadTasks });
  await load(); loadTasks();
}

/* ================================================================ メール */
const MAIL_BOXES = [["inbox", "受信（未完了）"], ["mine", "自分の担当"], ["unassigned", "担当なし"], ["done", "完了"], ["sent", "送信済み"], ["starred", "スター"], ["archived", "アーカイブ"]];
const MAIL_STATUS = { open: "未対応", doing: "対応中", done: "完了" };

function seenBy(readers, max = 4) {
  // 一覧では顔だけ並べる（誰が・いつ は詳細画面とツールチップに任せる）
  if (!readers || !readers.length) return `<span class="seen-by seen-none" title="まだ誰も見ていません">未確認</span>`;
  return `<span class="seen-by" title="確認した人: ${esc(readers.map(r => `${U(r.user_id).name}（${fmtRel(r.at)}）`).join("、"))}"><span class="avatars">${readers.slice(0, max).map(r => avatar(U(r.user_id), 18, false)).join("")}</span>${readers.length > max ? `+${readers.length - max}` : ""}</span>`;
}
function mailRow(m, compact) {
  const readMe = (m.readers || []).some(r => r.user_id === S.me.id);
  const who = m.direction === "out" ? `宛先: ${m.to_addr}` : (m.from_name || m.from_addr);
  return `<button class="li mail-row${readMe ? "" : " unread"}" data-mail="${m.id}">
    ${m.direction === "out" ? `<span class="file-ico fk-other" style="width:32px;height:32px">${icon("send")}</span>` : avatar({ name: m.from_name || m.from_addr, color: "#94a3b8", id: -1 }, 32, false)}
    <span class="grow" style="min-width:0">
      <div class="row" style="gap:6px">${readMe ? "" : '<span class="dot" title="あなたは未読"></span>'}<span class="li-title ellipsis grow">${esc(who)}</span><span class="small muted" style="flex:none">${fmtRel(m.date)}</span></div>
      <div class="ellipsis" style="font-size:14px">${esc(m.subject)}</div>
      ${compact || UI.isMobile ? "" : `<div class="li-sub">${esc((m.snippet || "").replace(/\s+/g, " "))}</div>`}
      <div class="mr-meta">${m.direction === "in" && m.status !== "open" ? `<span class="status-pill st-${m.status}">${MAIL_STATUS[m.status]}</span>` : ""}
        ${m.assignee_id ? `<span class="mr-who">${avatar(U(m.assignee_id), 18, false)}${esc(shortName(U(m.assignee_id)))}</span>` : ""}
        ${m.n_files ? `<span class="mr-clip">${icon("clip")}${m.n_files}</span>` : ""}
        <span class="grow"></span>${seenBy(m.readers, 3)}</div>
    </span></button>`;
}

const mailState = { box: "inbox", q: "", sel: null };
async function renderMail(el, { mobile = false } = {}) {
  el.innerHTML = `<div class="mail${mobile ? " is-mobile" : ""}">
    <aside class="mail-boxes"></aside>
    <section class="mail-list"><div class="mail-tools">
        <input class="input" type="search" placeholder="メールを検索" value="${esc(mailState.q)}">
        ${mobile ? "" : `<button class="btn icon" data-sync title="Gmail と同期">${icon("sync")}</button>`}
        <button class="btn primary" data-compose>${icon("edit")}${mobile ? "" : " 作成"}</button></div>
      <div class="mail-status small muted"></div><div class="list mail-items"></div></section>
    ${mobile ? "" : `<section class="mail-detail"><div class="empty"><b>メールを選んでください</b>誰が確認したかは各メールの右下に出ます</div></section>`}
  </div>`;
  const boxes = $(".mail-boxes", el), items = $(".mail-items", el);
  const load = async () => {
    const d = await api(`/api/mail?box=${mailState.box}&q=${encodeURIComponent(mailState.q)}`);
    const PRIMARY = ["inbox", "mine", "unassigned"];
    if (mobile) {
      // スマホはよく使う 3 つだけチップにし、残りは「その他」にしまう
      const other = MAIL_BOXES.find(([k]) => k === mailState.box && !PRIMARY.includes(k));
      boxes.innerHTML = MAIL_BOXES.filter(([k]) => PRIMARY.includes(k)).map(([k, l]) => `<button class="chip${k === mailState.box ? " on" : ""}" data-box="${k}">${l.replace("（未完了）", "")}${d.counts[k] ? ` <span class="badge soft">${d.counts[k]}</span>` : ""}</button>`).join("")
        + `<button class="chip${other ? " on" : ""}" data-boxmore>${other ? esc(other[1]) : "その他"} ▾</button>`;
    } else boxes.innerHTML = MAIL_BOXES.map(([k, l]) => `<button class="${mobile ? "chip" : "box-btn"}${k === mailState.box ? (mobile ? " on" : " sel") : ""}" data-box="${k}"><span class="grow">${l}</span>${d.counts[k] ? `<span class="badge soft">${d.counts[k]}</span>` : ""}</button>`).join("");
    const st = d.status;
    // 正常に同期できているときのスマホでは出さない（未設定・エラーのときだけ知らせる）
    $(".mail-status", el).hidden = mobile && st.configured && st.mode !== "gmail-error";
    $(".mail-status", el).innerHTML = st.configured
      ? `${icon("mail")} ${esc(st.address)} · ${st.mode === "gmail-error" ? `<span style="color:var(--danger)">同期エラー: ${esc(st.error)}</span>` : `Gmail 同期 ${st.last_sync ? fmtRel(st.last_sync) : "待機中"}`}`
      : `${icon("info")} 共有 Gmail はまだ設定されていません${S.me.role === "admin" ? "（管理 → 共有 Gmail から設定できます）" : "（管理者が設定します）"}`;
    items._rows = d.items;
    items.innerHTML = d.items.length ? d.items.map(m => mailRow(m)).join("") : `<div class="empty"><b>メールはありません</b></div>`;
    if (mailState.sel) $(`[data-mail="${mailState.sel}"]`, items)?.classList.add("sel");
  };
  swipeRows(items, ".mail-row", row => {
    const m = (items._rows || []).find(x => x.id === +row.dataset.mail);
    if (!m || m.direction !== "in") return {};
    return {
      left: m.status === "done" ? { label: "未対応に戻す", icon: "reply", tone: "warn", run: () => setMailStatus(m.id, { status: "open" }, "未対応に戻しました") }
                                : { label: "完了", icon: "check", tone: "ok", run: () => setMailStatus(m.id, { status: "done" }, "完了にしました") },
      right: m.assignee_id === S.me.id ? null : { label: "自分が担当", icon: "user", tone: "accent", run: () => setMailStatus(m.id, { assignee_id: S.me.id, status: "doing" }, "担当になりました") },
    };
  });
  boxes.onclick = e => {
    const b = e.target.closest("[data-box]"); if (b) { mailState.box = b.dataset.box; return load(); }
    const mo = e.target.closest("[data-boxmore]");
    if (mo) popover(mo, `<div class="menu">${MAIL_BOXES.slice(3).map(([k, l]) => `<button data-k="${k}">${l}</button>`).join("")}</div>`,
      { onMount: p => p.onclick = ev => { const x = ev.target.closest("[data-k]"); if (x) { closePop(); mailState.box = x.dataset.k; load(); } } });
  };
  let qt; $("input", el).oninput = e => { clearTimeout(qt); qt = setTimeout(() => { mailState.q = e.target.value.trim(); load(); }, 250); };
  if (!mobile) $("[data-sync]", el).onclick = async e => { e.currentTarget.disabled = true; try { const r = await api("/api/mail/sync", { method: "POST" }); toast(r.mode === "none" ? "共有 Gmail が未設定です" : `同期しました（新着 ${r.added} 件）`); load(); } catch (er) { fail(er); } finally { e.currentTarget.disabled = false; } };
  $("[data-compose]", el).onclick = () => composeMail({});
  items.onclick = e => { const b = e.target.closest("[data-mail]"); if (!b) return; mailState.sel = +b.dataset.mail; $$(".li.sel", items).forEach(x => x.classList.remove("sel")); b.classList.add("sel"); b.classList.remove("unread"); mobile ? UI.openMail(mailState.sel) : renderMailDetail($(".mail-detail", el), mailState.sel); };
  if (S.cfg.mail.configured) fn("mail", { action: "sync" }).catch(() => { });
  screenOn({ mail: load, mail_read: ev => { load(); if (!mobile && mailState.sel === ev.email_id && ev.user_id !== S.me.id) renderMailDetail($(".mail-detail", el), mailState.sel, true); } });
  await load();
  if (!mobile && mailState.sel) renderMailDetail($(".mail-detail", el), mailState.sel);
}

async function renderMailDetail(el, id, quiet) {
  if (!quiet) el.innerHTML = `<div class="empty">読み込み中…</div>`;
  let m; try { m = await api(`/api/mail/${id}`); } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const members = Object.values(S.users);
  const notSeen = members.filter(u => !m.readers.some(r => r.user_id === u.id));
  el.innerHTML = `<article class="mail-view">
    <div class="mail-actions">
      ${m.direction === "in" ? `<div class="seg">${Object.entries(MAIL_STATUS).map(([k, l]) => `<button class="${m.status === k ? "on st-" + k : ""}" data-status="${k}">${l}</button>`).join("")}</div>
      <select class="input sm-select" data-assign aria-label="担当者"><option value="">担当なし</option>${members.map(u => `<option value="${u.id}"${m.assignee_id === u.id ? " selected" : ""}>${esc(u.name)}${u.id === S.me.id ? "（自分）" : ""}</option>`).join("")}</select>` : ""}
      <span class="grow"></span>
      <button class="btn ghost icon" data-star title="スター" style="${m.starred ? "color:var(--warn)" : ""}">${icon("star")}</button>
      <button class="btn ghost icon" data-archive title="${m.archived ? "アーカイブから戻す" : "アーカイブ"}">${icon("archive")}</button>
    </div>
    <h2 class="mail-subject">${esc(m.subject)}</h2>
    <div class="row mail-from">${avatar({ name: m.from_name || m.from_addr, color: "#94a3b8", id: -1 }, 40, false)}
      <div class="grow" style="min-width:0"><b>${esc(m.from_name)}</b> <span class="muted small">&lt;${esc(m.from_addr)}&gt;</span>
      <div class="small muted ellipsis">宛先: ${esc(m.to_addr)}${m.cc ? ` · CC: ${esc(m.cc)}` : ""}</div></div>
      <span class="small muted" style="flex:none">${fmtDay(m.date)} ${fmtTime(m.date)}</span></div>
    <div class="seen-panel">
      <div class="small" style="font-weight:700;margin-bottom:6px">${icon("user")} このメールを見た人</div>
      <div class="row wrap" style="gap:6px">${m.readers.map(r => `<span class="chip">${avatar(U(r.user_id), 18, false)} ${esc(U(r.user_id).name)} <span class="muted">${fmtRel(r.at)}</span></span>`).join("")}</div>
      ${notSeen.length ? `<div class="small muted" style="margin-top:6px">未確認: ${notSeen.map(u => esc(u.name)).join("、")}</div>` : `<div class="small" style="margin-top:6px;color:var(--ok)">全員が確認済み</div>`}
    </div>
    <div class="mail-body">${formatBody(m.body)}</div>
    ${m.files.length ? `<div class="att-grid" style="margin:0 0 18px">${m.files.map(f => `<button class="file-card" data-file="${f.id}">${fileIcon(f)}<span class="file-meta"><div class="file-name">${esc(f.name)}</div><div class="file-sub">${fmtSize(f.size)} · プレビュー</div></span></button>`).join("")}</div>` : ""}
    ${m.thread.length ? `<div class="section-title">返信履歴</div>${m.thread.map(t => `<div class="card" style="padding:12px 14px;margin-bottom:8px"><div class="small muted">${fmtDay(t.date)} ${fmtTime(t.date)} · ${esc(U(t.sent_by).name)} が送信</div><div style="white-space:pre-wrap">${esc(t.snippet)}…</div></div>`).join("")}` : ""}
    <div class="row wrap mail-foot">
      ${m.direction === "in" ? `<button class="btn primary" data-reply>${icon("reply")} 返信</button>` : ""}
      <button class="btn" data-share>${icon("share")} チャンネルに共有</button>
      <button class="btn" data-task>${icon("task")} タスク化</button>
      <button class="btn claude" data-claude>${CLAUDE_MARK} Claude で返信案</button>
    </div></article>`;
  const put = body => api(`/api/mail/${id}`, { method: "PUT", body }).then(() => renderMailDetail(el, id, true)).catch(fail);
  el.onclick = e => {
    const t = e.target;
    if (t.closest("[data-status]")) return put({ status: t.closest("[data-status]").dataset.status, ...(m.assignee_id ? {} : { assignee_id: S.me.id }) });
    if (t.closest("[data-star]")) return put({ starred: m.starred ? 0 : 1 });
    if (t.closest("[data-archive]")) return put({ archived: m.archived ? 0 : 1 });
    if (t.closest("[data-file]")) return openViewer(m.files.find(f => f.id === +t.closest("[data-file]").dataset.file), m.files);
    if (t.closest("[data-reply]")) return composeMail({ to: m.from_addr, subject: /^re:/i.test(m.subject) ? m.subject : "Re: " + m.subject, in_reply_to: m.id, quote: m });
    if (t.closest("[data-share]")) return pickChannel("メールを共有するチャンネル", async cid => { await api(`/api/mail/${id}/share`, { method: "POST", body: { channel_id: cid, body: "" } }); toast("共有しました"); });
    if (t.closest("[data-task]")) return taskFromText(`${m.subject}\n\n${m.from_name} <${m.from_addr}>\n${m.body.slice(0, 600)}`, `共有メール「${m.subject}」`);
    if (t.closest("[data-claude]")) return openClaude(`次のメールへの返信文を、丁寧なビジネス日本語で作ってください。\n\n件名: ${m.subject}\n差出人: ${m.from_name} <${m.from_addr}>\n\n${m.body}`);
  };
  const sel = $("[data-assign]", el); if (sel) sel.onchange = () => put(sel.value ? { assignee_id: sel.value } : { unassign: true });
}

async function composeMail({ to = "", subject = "", in_reply_to = null, quote = null, body = "" }) {
  const contacts = await api("/api/contacts").catch(() => []);
  if (quote) body = `\n\n${fmtDay(quote.date)} ${fmtTime(quote.date)} ${quote.from_name} <${quote.from_addr}>:\n` + quote.body.split("\n").map(l => "> " + l).join("\n");
  const ov = modal(in_reply_to ? "返信" : "新しいメール", `<form>
    <datalist id="mailTo">${contacts.filter(c => c.email).map(c => `<option value="${esc(c.email)}">${esc(c.name)}（${esc(c.company)}）</option>`).join("")}</datalist>
    <label class="field"><span>宛先</span><input class="input" name="to" list="mailTo" value="${esc(to)}" required ${to ? "" : "autofocus"}></label>
    <label class="field"><span>CC</span><input class="input" name="cc"></label>
    <label class="field"><span>件名</span><input class="input" name="subject" value="${esc(subject)}"></label>
    <label class="field"><span>本文</span><textarea class="input" name="body" rows="10" ${to ? "autofocus" : ""}>${esc(body)}</textarea></label>
    <p class="small muted" style="margin:0">送信元: ${S.cfg.mail.configured ? esc(S.cfg.mail.address) : "未設定（管理者が共有 Gmail を設定すると送信できます）"}</p></form>`,
    { foot: `<button class="btn claude" data-cl>${CLAUDE_MARK} 文面を Claude に相談</button><span class="grow"></span><button class="btn" data-c>やめる</button><button class="btn primary" data-s>${icon("send")} 送信</button>` });
  const f = $("form", ov);
  if (to) { const t = f.body; setTimeout(() => { t.focus(); t.setSelectionRange(0, 0); }, 40); }
  $("[data-c]", ov).onclick = () => ov.close();
  $("[data-cl]", ov).onclick = () => openClaude(`次のメール文面を推敲してください（宛先: ${f.to.value} / 件名: ${f.subject.value}）\n\n${f.body.value}`);
  $("[data-s]", ov).onclick = async () => {
    try {
      const r = await api("/api/mail/send", { method: "POST", body: { to: f.to.value, cc: f.cc.value, subject: f.subject.value, body: f.body.value, in_reply_to } });
      ov.close(); toast("送信しました");
    } catch (e) { fail(e); }
  };
}

/* ================================================================ 予定 */
const calState = { month: null, view: null };
async function renderCalendar(el, { mobile = false } = {}) {
  const base = calState.month || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  calState.month = base;
  const view = calState.view || (mobile ? "agenda" : "month");
  const first = new Date(base), start = new Date(first); start.setDate(1 - first.getDay());
  const end = new Date(start); end.setDate(start.getDate() + 41);
  const agendaEnd = new Date(); agendaEnd.setDate(agendaEnd.getDate() + 45);
  const evs = await api(`/api/events?start=${ymd(view === "month" ? start : new Date())}&end=${ymd(view === "month" ? end : agendaEnd)}`);
  el.innerHTML = `<div class="page">
    <header class="page-head"><h1 class="keep-title">${view === "month" ? `${base.getFullYear()}年${base.getMonth() + 1}月` : "これからの予定"}</h1>
      ${view === "month" ? `<button class="btn icon" data-prev aria-label="前の月">${icon("chevl")}</button><button class="btn sm" data-today>今日</button><button class="btn icon" data-next aria-label="次の月">${icon("chev")}</button>` : ""}
      <span class="grow"></span>
      <div class="seg"><button class="${view === "month" ? "on" : ""}" data-view="month">月</button><button class="${view === "agenda" ? "on" : ""}" data-view="agenda">一覧</button></div>
      <button class="btn primary" data-new>${icon("plus")}${mobile ? "" : " 予定を追加"}</button></header>
    <div class="cal-body"></div></div>`;
  const body = $(".cal-body", el), t = todayStr();
  if (view === "month") {
    let html = `<div class="cal">${WD.map(w => `<div class="cal-h">${w}</div>`).join("")}`;
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i); const ds = ymd(d);
      const list = evs.filter(e => e.start.slice(0, 10) <= ds && ds <= e.end.slice(0, 10));
      html += `<div class="cal-d${d.getMonth() !== base.getMonth() ? " other" : ""}${ds === t ? " today" : ""}${d.getDay() === 0 ? " sun" : d.getDay() === 6 ? " sat" : ""}" data-day="${ds}" role="button" tabindex="0">
        <span class="n">${d.getDate()}</span>${list.slice(0, 3).map(e => `<button class="ev" data-ev="${e.id}" style="${e.color ? `background:${e.color}1f;color:${e.color}` : ""}">${e.all_day ? "" : fmtTime(e.start) + " "}${esc(e.title)}</button>`).join("")}${list.length > 3 ? `<span class="small muted">他 ${list.length - 3} 件</span>` : ""}</div>`;
    }
    body.innerHTML = html + "</div>";
  } else {
    const byDay = {};
    for (const e of evs) (byDay[e.start.slice(0, 10)] ||= []).push(e);
    const days = Object.keys(byDay).sort().filter(d => d >= t);
    body.innerHTML = days.length ? days.map(d => `<div class="agenda-day${d === t ? " today" : ""}">${d === t ? "今日" : ""} <span>${fmtDay(d)}</span></div>
      ${byDay[d].map(e => `<button class="ev-row" data-ev="${e.id}"><span class="tm">${e.all_day ? "終日" : fmtTime(e.start)}</span><span class="bar" style="background:${esc(e.color || "var(--accent)")}"></span>
        <span class="grow"><b>${esc(e.title)}</b><div class="small muted">${[e.all_day ? "" : `〜${fmtTime(e.end)}`, e.location].filter(Boolean).map(esc).join(" · ")}</div>
        ${e.attendees.length ? `<span class="avatars" style="margin-top:4px">${e.attendees.slice(0, 6).map(i => avatar(U(i), 20, false)).join("")}</span>` : ""}</span></button>`).join("")}`).join("")
      : `<div class="empty"><b>予定はありません</b>右上の「＋」から追加できます</div>`;
  }
  el.onclick = e => {
    const tg = e.target;
    if (tg.closest("[data-prev]")) { calState.month = new Date(base.getFullYear(), base.getMonth() - 1, 1); return renderCalendar(el, { mobile }); }
    if (tg.closest("[data-next]")) { calState.month = new Date(base.getFullYear(), base.getMonth() + 1, 1); return renderCalendar(el, { mobile }); }
    if (tg.closest("[data-today]")) { calState.month = null; return renderCalendar(el, { mobile }); }
    if (tg.closest("[data-view]")) { calState.view = tg.closest("[data-view]").dataset.view; return renderCalendar(el, { mobile }); }
    if (tg.closest("[data-new]")) return editEvent(null, t);
    if (tg.closest("[data-ev]")) return editEvent(evs.find(x => x.id === +tg.closest("[data-ev]").dataset.ev));
    if (tg.closest("[data-day]")) return editEvent(null, tg.closest("[data-day]").dataset.day);
  };
  if (view === "month") swipeNav(body, () => { calState.month = new Date(base.getFullYear(), base.getMonth() - 1, 1); renderCalendar(el, { mobile }); },
    () => { calState.month = new Date(base.getFullYear(), base.getMonth() + 1, 1); renderCalendar(el, { mobile }); });
  screenOn({ events: () => renderCalendar(el, { mobile }) });
}

function editEvent(ev, day) {
  const e = ev || { title: "", start: `${day}T10:00`, end: `${day}T11:00`, all_day: 0, location: "", note: "", color: "", attendees: [S.me.id] };
  const colors = ["", "#14b8a6", "#f59e0b", "#ec4899", "#8b5cf6", "#ef6c4a"];
  const ov = modal(ev ? "予定" : "予定を追加", `<form>
    <label class="field"><span>タイトル</span><input class="input" name="title" value="${esc(e.title)}" ${ev ? "" : "autofocus"} required></label>
    <div class="ev-when"><label class="field f-date"><span>日付</span><input class="input" type="date" name="date" value="${e.start.slice(0, 10)}"></label>
      <label class="field"><span>開始</span><input class="input" type="time" name="s" value="${e.start.slice(11, 16)}"></label>
      <label class="field"><span>終了</span><input class="input" type="time" name="e" value="${e.end.slice(11, 16)}"></label></div>
    <label class="row small" style="margin:-4px 0 14px"><input type="checkbox" name="all_day" ${e.all_day ? "checked" : ""}> 終日</label>
    <label class="field"><span>場所</span><input class="input" name="location" value="${esc(e.location)}"></label>
    <div class="field"><span>参加者</span><div class="row wrap" style="gap:6px">${Object.values(S.users).map(u => `<label class="chip${e.attendees.includes(u.id) ? " on" : ""}"><input type="checkbox" name="att" value="${u.id}" ${e.attendees.includes(u.id) ? "checked" : ""} hidden>${esc(u.name)}</label>`).join("")}</div></div>
    <div class="field"><span>色</span><div class="row">${colors.map(c => `<label><input type="radio" name="color" value="${c}" ${c === (e.color || "") ? "checked" : ""} hidden><span class="avatar" style="--s:26px;--c:${c || "#4b63e6"};cursor:pointer"></span></label>`).join("")}</div></div>
    <label class="field"><span>メモ</span><textarea class="input" name="note" rows="3">${esc(e.note)}</textarea></label></form>`, {
    foot: `${ev ? `<button class="btn danger" data-del>${icon("trash")}</button><a class="btn" data-g target="_blank" rel="noopener">Google カレンダーへ</a>` : ""}<span class="grow"></span><button class="btn" data-c>やめる</button><button class="btn primary" data-s>保存</button>`
  });
  const f = $("form", ov);
  $$("input[name=att]", ov).forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
  $$("input[name=color]", ov).forEach(i => { const mark = () => $$("input[name=color]", ov).forEach(x => x.nextElementSibling.style.outline = x.checked ? "3px solid var(--accent)" : ""); i.onchange = mark; mark(); });
  const payload = () => {
    const d = f.date.value, ad = f.all_day.checked;
    return { title: f.title.value.trim(), start: `${d}T${ad ? "00:00" : f.s.value || "00:00"}`, end: `${d}T${ad ? "23:59" : f.e.value || f.s.value || "23:59"}`, all_day: ad ? 1 : 0,
      location: f.location.value, note: f.note.value, color: (f.querySelector("[name=color]:checked") || {}).value || "", attendees: $$("input[name=att]:checked", ov).map(i => i.value) };
  };
  if (ev) {
    const g = $("[data-g]", ov), z = s => s.replace(/[-:]/g, "") + "00";
    g.href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${e.all_day ? e.start.slice(0, 10).replace(/-/g, "") + "/" + e.start.slice(0, 10).replace(/-/g, "") : z(e.start) + "/" + z(e.end)}&location=${encodeURIComponent(e.location)}&details=${encodeURIComponent(e.note)}`;
    $("[data-del]", ov).onclick = async () => { if (await confirmBox("この予定を削除しますか？", "削除", true)) { await api(`/api/events/${ev.id}`, { method: "DELETE" }); ov.close(); } };
  }
  $("[data-c]", ov).onclick = () => ov.close();
  $("[data-s]", ov).onclick = async () => {
    const p = payload(); if (!p.title) return toast("タイトルを入力してください", true);
    try { await api(ev ? `/api/events/${ev.id}` : "/api/events", { method: ev ? "PUT" : "POST", body: p }); ov.close(); toast("保存しました"); } catch (er) { fail(er); }
  };
}

/* ================================================================ シフト（各自が時間帯を入れる） */
const shiftState = { week: null, day: null };
const hm = t => (t || "").slice(0, 5);
/** 時間数（日をまたぐ夜勤も正しく数える）。 */
function shiftHours(s) {
  if (!s || s.kind !== "work" || !s.start_time || !s.end_time) return 0;
  const [a, b] = [s.start_time, s.end_time].map(x => { const [h, m] = x.split(":").map(Number); return h * 60 + m; });
  return ((b - a + 1440) % 1440 || 1440) / 60;
}
/** 狭い枠用: 10:00 → 10、17:30 → 17:30 */
const shortTime = t => hm(t).replace(/:00$/, "").replace(/^0(\d)/, "$1");
const fmtH = h => (Math.round(h * 10) / 10).toString().replace(/\.0$/, "") + "h";
function shiftLabel(s, short) {
  if (!s) return "";
  if (s.kind === "off") return "休み";
  return short ? `${hm(s.start_time)}<small>–${hm(s.end_time)}</small>` : `${hm(s.start_time)}–${hm(s.end_time)}`;
}

/** 時間帯の入力。前に使った時間帯（この人の直近）を 1 回で選べるようにする。 */
async function editShift(uid, date, current, done) {
  const { data: hist } = await SB.from("shifts").select("start_time,end_time").eq("user_id", uid).eq("kind", "work").order("date", { ascending: false }).limit(40);
  const recent = [...new Map((hist || []).map(h => [`${hm(h.start_time)}-${hm(h.end_time)}`, h])).values()].slice(0, 4);
  const d = new Date(date + "T00:00");
  const ov = modal(`${U(uid).name} · ${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`, `
    ${recent.length ? `<div class="field"><span>前に入れた時間帯</span><div class="row wrap" style="gap:6px">${recent.map(r => `<button type="button" class="chip" data-pre="${hm(r.start_time)}-${hm(r.end_time)}">${hm(r.start_time)}–${hm(r.end_time)}</button>`).join("")}</div></div>` : ""}
    <div class="ev-when shift-when"><label class="field"><span>開始</span><input class="input" type="time" name="s" step="900" value="${current && current.kind === "work" ? hm(current.start_time) : "10:00"}"></label>
      <label class="field"><span>終了</span><input class="input" type="time" name="e" step="900" value="${current && current.kind === "work" ? hm(current.end_time) : "15:00"}"></label></div>
    <p class="small muted shift-dur" style="margin:-4px 0 12px"></p>
    <label class="field"><span>メモ（任意）</span><input class="input" name="note" value="${esc(current?.note || "")}" placeholder="例: 3限のあと／テスト期間"></label>`,
    { foot: `${current ? `<button class="btn ghost" data-clear>クリア</button>` : ""}<button class="btn" data-off>休み</button><span class="grow"></span><button class="btn primary" data-save>保存</button>` });
  const s = $("[name=s]", ov), e = $("[name=e]", ov);
  const dur = () => { $(".shift-dur", ov).textContent = s.value && e.value ? `${fmtH(shiftHours({ kind: "work", start_time: s.value, end_time: e.value }))}${e.value <= s.value ? "（翌日まで）" : ""}` : ""; };
  [s, e].forEach(x => x.oninput = dur); dur();
  $$("[data-pre]", ov).forEach(b => b.onclick = () => { [s.value, e.value] = b.dataset.pre.split("-"); dur(); });
  const put = async body => {
    try { await api("/api/shifts", { method: "PUT", body: { user_id: uid, date, note: $("[name=note]", ov).value, ...body } }); ov.close(); done && done(); }
    catch (er) { fail(er); }
  };
  $("[data-save]", ov).onclick = () => { if (!s.value || !e.value) return toast("開始と終了を入れてください", true); if (s.value === e.value) return toast("開始と終了が同じです", true); put({ kind: "work", start: s.value, end: e.value }); };
  $("[data-off]", ov).onclick = () => put({ kind: "off" });
  const c = $("[data-clear]", ov); if (c) c.onclick = () => put({ kind: "" });
}

async function renderShifts(el, { mobile = false } = {}) {
  const mon = shiftState.week || (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
  shiftState.week = mon;
  const days = [...Array(7)].map((_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
  const rows = await api(`/api/shifts?start=${ymd(days[0])}&end=${ymd(days[6])}`);
  const t = todayStr(), users = Object.values(S.users).filter(u => u.active !== false);
  const get = (uid, ds) => rows.find(r => r.user_id === uid && r.date === ds);
  const weekH = uid => rows.filter(r => r.user_id === uid).reduce((a, r) => a + shiftHours(r), 0);
  const cell = (uid, ds) => {
    const s = get(uid, ds);
    const cls = !s ? " blank" : s.kind === "off" ? " off" : " work";
    return `<button class="shift-cell${cls}" data-u="${uid}" data-d="${ds}" title="${s && s.note ? esc(s.note) : ""}">${s ? shiftLabel(s, !mobile) : "＋"}${s && s.note ? '<i class="shift-note"></i>' : ""}</button>`;
  };
  const head = `<header class="page-head"><h1>シフト</h1>
    <button class="btn icon" data-pw aria-label="前の週">${icon("chevl")}</button><button class="btn sm" data-tw>今週</button><button class="btn icon" data-nw aria-label="次の週">${icon("chev")}</button>
    <span class="small muted">${fmtDay(ymd(days[0]))} 〜 ${fmtDay(ymd(days[6]))}</span></header>`;
  if (!mobile) {
    el.innerHTML = `<div class="page">${head}<div style="overflow-x:auto"><table class="shift-grid"><thead><tr><th style="text-align:left;padding-left:12px">メンバー</th>
      ${days.map(d => `<th class="${ymd(d) === t ? "today" : ""}">${d.getMonth() + 1}/${d.getDate()}<br>${WD[d.getDay()]}</th>`).join("")}<th>週の合計</th></tr></thead><tbody>
      ${users.map(u => `<tr><td class="who"><span class="row">${avatar(u, 26)}<span>${esc(u.name)}</span></span></td>${days.map(d => `<td>${cell(u.id, ymd(d))}</td>`).join("")}<td class="week-h">${weekH(u.id) ? fmtH(weekH(u.id)) : "—"}</td></tr>`).join("")}
      <tr><td class="who small muted">入る人数</td>${days.map(d => `<td class="small"><b>${rows.filter(r => r.date === ymd(d) && r.kind === "work").length}</b> 人</td>`).join("")}<td></td></tr>
      </tbody></table></div><p class="small muted">自分のセルを押して、入れる時間帯を入れます（15 分単位）。変更は全員の画面にすぐ反映されます。</p></div>`;
  } else {
    const sel = shiftState.day && days.some(d => ymd(d) === shiftState.day) ? shiftState.day : (days.some(d => ymd(d) === t) ? t : ymd(days[0]));
    shiftState.day = sel;
    const me = S.me.id;
    el.innerHTML = `<div class="page">${head}
      <div class="day-strip">${days.map(d => { const ds = ymd(d); const n = rows.filter(r => r.date === ds && r.kind === "work").length;
        return `<button class="${ds === sel ? "on" : ""}${ds === t ? " today" : ""}" data-pick="${ds}"><small>${WD[d.getDay()]}</small><b>${d.getDate()}</b><small>${n}人</small></button>`; }).join("")}</div>
      <div class="list card" style="overflow:hidden">${users.map(u => `<div class="li">${avatar(u, 32)}<span class="grow">${esc(u.name)}${u.id === me ? ' <span class="small muted">（あなた）</span>' : ""}</span><span style="width:124px">${cell(u.id, sel)}</span></div>`).join("")}</div>
      <div class="section-title" style="margin-top:18px">あなたの今週 <span class="badge soft">${fmtH(weekH(me))}</span></div>
      <div class="my-week">${days.map(d => { const s = get(me, ymd(d)); return `<button class="mw-day${ymd(d) === t ? " today" : ""}" data-mine="${ymd(d)}"><small>${d.getDate()}(${WD[d.getDay()]})</small><b>${!s ? "—" : s.kind === "off" ? "休み" : `${shortTime(s.start_time)}<br>–${shortTime(s.end_time)}`}</b></button>`; }).join("")}</div></div>`;
  }
  el.onclick = e => {
    const tg = e.target;
    const shift = n => { const d = new Date(mon); d.setDate(d.getDate() + n); shiftState.week = n ? d : null; renderShifts(el, { mobile }); };
    if (tg.closest("[data-pw]")) return shift(-7);
    if (tg.closest("[data-nw]")) return shift(7);
    if (tg.closest("[data-tw]")) { shiftState.week = null; return renderShifts(el, { mobile }); }
    if (tg.closest("[data-pick]")) { shiftState.day = tg.closest("[data-pick]").dataset.pick; return renderShifts(el, { mobile }); }
    const mine = tg.closest("[data-mine]"); if (mine) return editShift(S.me.id, mine.dataset.mine, get(S.me.id, mine.dataset.mine));
    const c = tg.closest(".shift-cell"); if (!c) return;
    if (c.dataset.u !== S.me.id && S.me.role !== "admin") return toast("ほかの人のシフトは本人か管理者だけが変更できます", true);
    editShift(c.dataset.u, c.dataset.d, get(c.dataset.u, c.dataset.d));
  };
  const moveWeek = n => { const d = new Date(mon); d.setDate(d.getDate() + n); shiftState.week = d; renderShifts(el, { mobile }); };
  if (mobile) {
    const moveDay = n => {
      const d = new Date(shiftState.day + "T00:00"); d.setDate(d.getDate() + n);
      shiftState.day = ymd(d);
      if (!days.some(x => ymd(x) === shiftState.day)) { const w = new Date(mon); w.setDate(w.getDate() + 7 * n); shiftState.week = w; }
      renderShifts(el, { mobile });
    };
    const card = $(".list.card", el); if (card) swipeNav(card, () => moveDay(-1), () => moveDay(1));
  } else {
    const grid = $(".shift-grid", el); if (grid) swipeNav(grid.parentElement, () => moveWeek(-7), () => moveWeek(7));
  }
  screenOn({ shifts: () => renderShifts(el, { mobile }), users: () => renderShifts(el, { mobile }) });
}

/* ================================================================ 連絡先 */
const peopleState = { tab: "team", q: "" };
async function renderPeople(el) {
  el.innerHTML = `<div class="page"><header class="page-head"><h1>連絡先</h1>
    <div class="seg"><button data-tab="team" class="${peopleState.tab === "team" ? "on" : ""}">チーム</button><button data-tab="ext" class="${peopleState.tab === "ext" ? "on" : ""}">社外</button></div>
    <span class="grow"></span><input class="input" type="search" placeholder="名前・会社・タグで検索" value="${esc(peopleState.q)}" style="max-width:260px">
    ${peopleState.tab === "ext" ? `<button class="btn primary" data-add>${icon("plus")} 追加</button>` : `<button class="btn hide-m" data-me>${icon("edit")} 自分のプロフィール</button>`}</header>
    <div class="people-body"></div></div>`;
  const body = $(".people-body", el);
  const draw = async () => {
    const q = peopleState.q.toLowerCase();
    if (peopleState.tab === "team") {
      const list = Object.values(S.users).filter(u => !q || [u.name, u.kana, u.dept, u.title, u.login].join(" ").toLowerCase().includes(q))
        .sort((a, b) => (S.online.has(b.id) - S.online.has(a.id)));
      body.innerHTML = `<div class="people-grid">${list.map(u => `<button class="card person" data-u="${u.id}">${avatar(u, 48)}
        <div class="grow" style="min-width:0;text-align:left"><b class="ellipsis" style="display:block">${esc(u.name)}</b><div class="small muted ellipsis">${esc([u.title, u.dept].filter(Boolean).join(" · ") || "—")}</div>
        ${u.status_text || u.status_emoji ? `<div class="small ellipsis">${esc(u.status_emoji)} ${esc(u.status_text)}</div>` : ""}</div></button>`).join("")}</div>`;
    } else {
      const list = await api(`/api/contacts?q=${encodeURIComponent(peopleState.q)}`);
      body.innerHTML = list.length ? `<div class="card list" style="overflow:hidden">${list.map(c => `<button class="li" data-c="${c.id}">${avatar({ name: c.name, color: "#64748b", id: -1 }, 36, false)}
        <span class="grow" style="min-width:0"><div class="li-title">${esc(c.name)} <span class="small muted">${esc(c.title)}</span></div><div class="li-sub">${esc(c.company)}${c.email ? " · " + esc(c.email) : ""}</div></span>
        ${c.tags ? c.tags.split(",").filter(Boolean).slice(0, 2).map(t => `<span class="chip">${esc(t.trim())}</span>`).join("") : ""}</button>`).join("")}</div>`
        : `<div class="empty"><b>連絡先はまだありません</b>「追加」から登録できます</div>`;
      body._list = list;
    }
  };
  el.onclick = e => {
    const t = e.target;
    if (t.closest("[data-tab]")) { peopleState.tab = t.closest("[data-tab]").dataset.tab; return renderPeople(el); }
    if (t.closest("[data-me]")) return editProfile();
    if (t.closest("[data-add]")) return editContact(null, () => draw());
    if (t.closest("[data-u]")) return showProfile(t.closest("[data-u]").dataset.u);
    if (t.closest("[data-c]")) return showContact(body._list.find(c => c.id === +t.closest("[data-c]").dataset.c), () => draw());
  };
  let qt; $("input[type=search]", el).oninput = e => { clearTimeout(qt); qt = setTimeout(() => { peopleState.q = e.target.value.trim(); draw(); }, 200); };
  screenOn({ users: draw, presence: () => peopleState.tab === "team" && draw() });
  await draw();
}
function showContact(c, done) {
  const ov = modal("社外の連絡先", `<div class="profile-hero">${avatar({ name: c.name, color: "#64748b", id: -1 }, 64, false)}<div><div style="font-size:19px;font-weight:800">${esc(c.name)}</div><div class="muted">${esc([c.company, c.title].filter(Boolean).join(" · "))}</div></div></div>
    <dl class="kv">${c.email ? `<dt>メール</dt><dd>${esc(c.email)}</dd>` : ""}${c.phone ? `<dt>電話</dt><dd><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></dd>` : ""}
    ${c.tags ? `<dt>タグ</dt><dd>${esc(c.tags)}</dd>` : ""}${c.note ? `<dt>メモ</dt><dd style="white-space:pre-wrap">${esc(c.note)}</dd>` : ""}</dl>`,
    { foot: `<button class="btn" data-e>${icon("edit")} 編集</button><span class="grow"></span>${c.phone ? `<a class="btn" href="tel:${esc(c.phone)}">${icon("phone")}</a>` : ""}${c.email ? `<button class="btn primary" data-m>${icon("mail")} メールを書く</button>` : ""}` });
  $("[data-e]", ov).onclick = () => { ov.close(); editContact(c, done); };
  const m = $("[data-m]", ov); if (m) m.onclick = () => { ov.close(); composeMail({ to: c.email }); };
}
function editContact(c, done) {
  const v = c || {}; const f = (n, l, t = "text") => `<label class="field"><span>${l}</span><input class="input" type="${t}" name="${n}" value="${esc(v[n] || "")}"></label>`;
  const ov = modal(c ? "連絡先を編集" : "連絡先を追加", `<form><div class="row"><div class="grow">${f("name", "名前")}</div><div class="grow">${f("kana", "ふりがな")}</div></div>
    <div class="row"><div class="grow">${f("company", "会社・団体")}</div><div class="grow">${f("title", "役職")}</div></div>
    <div class="row"><div class="grow">${f("email", "メール", "email")}</div><div class="grow">${f("phone", "電話", "tel")}</div></div>
    ${f("tags", "タグ（カンマ区切り）")}<label class="field"><span>メモ</span><textarea class="input" name="note" rows="3">${esc(v.note || "")}</textarea></label></form>`,
    { foot: `${c ? `<button class="btn danger" data-del>${icon("trash")} 削除</button>` : ""}<span class="grow"></span><button class="btn" data-c>やめる</button><button class="btn primary" data-s>保存</button>` });
  $("[data-c]", ov).onclick = () => ov.close();
  if (c) $("[data-del]", ov).onclick = async () => { if (await confirmBox(`${c.name} を削除しますか？`, "削除", true)) { await api(`/api/contacts/${c.id}`, { method: "DELETE" }); ov.close(); done(); } };
  $("[data-s]", ov).onclick = async () => {
    const d = Object.fromEntries(new FormData($("form", ov))); if (!d.name.trim()) return toast("名前を入力してください", true);
    try { await api(c ? `/api/contacts/${c.id}` : "/api/contacts", { method: c ? "PUT" : "POST", body: d }); ov.close(); done(); toast("保存しました"); } catch (e) { fail(e); }
  };
}

/* ================================================================ ファイル */
const filesState = { kind: "", q: "" };
async function renderFiles(el, { mobile = false } = {}) {
  const kinds = [["", "すべて"], ["image", "画像"], ["pdf", "PDF"], ["doc", "文書"], ["sheet", "表計算"], ["slide", "スライド"], ["video", "動画"], ["audio", "音声"], ["text", "テキスト"], ["other", "その他"]];
  el.innerHTML = `<div class="page files-page"><header class="page-head"><h1>ファイル</h1><span class="grow"></span>
    <input class="input" type="search" placeholder="ファイル名で検索" value="${esc(filesState.q)}" style="max-width:240px">
    <button class="btn primary" data-up>${icon("plus")} アップロード</button><input type="file" multiple hidden></header>
    <div class="kind-chips">${kinds.map(([k, l]) => `<button class="chip${filesState.kind === k ? " on" : ""}" data-k="${k}">${l}</button>`).join("")}</div>
    <div class="drop-hint hide-m">${mobile ? "" : "ここにファイルをドロップすると全員で共有できます · "}画像・PDF・Word・Excel・PowerPoint・CSV・テキスト・動画・音声はその場でプレビューできます</div>
    <div class="file-grid"></div></div>`;
  const grid = $(".file-grid", el);
  const draw = async () => {
    const list = await api(`/api/files?kind=${filesState.kind}&q=${encodeURIComponent(filesState.q)}`);
    grid._list = list;
    grid.innerHTML = list.length ? list.map(f => `<button class="file-tile" data-f="${f.id}">
      <div class="thumb">${f.kind === "image" ? `<img data-fsrc="${esc(f.path)}" alt="" loading="lazy">` : fileIcon(f)}</div>
      <div class="file-name">${esc(f.name)}</div>
      <div class="file-sub ellipsis">${f.channel_name ? (f.channel_kind === "dm" ? "DM" : "#" + esc(f.channel_name)) : f.email_subject ? "📧 " + esc(f.email_subject) : "共有ライブラリ"} · ${fmtRel(f.created_at)} · ${fmtSize(f.size)}</div></button>`).join("")
      : `<div class="empty" style="grid-column:1/-1"><b>ファイルはありません</b></div>`;
    hydrateFiles(grid);
  };
  const up = async files => {
    for (const f of files) { try { await uploadFile(f, null); toast(`${f.name} を共有しました`); } catch (e) { fail(e); } }
    draw();
  };
  const fi = $("input[type=file]", el);
  el.onclick = e => {
    const t = e.target;
    if (t.closest("[data-up]")) return fi.click();
    if (t.closest("[data-k]")) { filesState.kind = t.closest("[data-k]").dataset.k; $$("[data-k]", el).forEach(b => b.classList.toggle("on", b === t.closest("[data-k]"))); return draw(); }
    if (t.closest("[data-f]")) return openViewer(grid._list.find(f => f.id === +t.closest("[data-f]").dataset.f), grid._list);
  };
  fi.onchange = () => { up([...fi.files]); fi.value = ""; };
  const page = $(".files-page", el);
  page.addEventListener("dragover", e => { e.preventDefault(); page.classList.add("drag"); });
  page.addEventListener("dragleave", e => { if (!page.contains(e.relatedTarget)) page.classList.remove("drag"); });
  page.addEventListener("drop", e => { e.preventDefault(); page.classList.remove("drag"); up([...e.dataTransfer.files]); });
  let qt; $("input[type=search]", el).oninput = e => { clearTimeout(qt); qt = setTimeout(() => { filesState.q = e.target.value.trim(); draw(); }, 200); };
  screenOn({ message: m => m.files.length && draw() });
  await draw();
}

/* ================================================================ タスク（チーム / 自分） */
const TASK_STATUS = { todo: "未着手", doing: "進行中", waiting: "確認待ち", done: "完了", cut: "取り下げ" };
const PRIO = { 1: "高", 2: "中", 3: "低" };
function taskRow(t) {
  return `<div class="li"><button class="task-check" data-tdone="${esc(t.id)}" aria-label="完了にする" title="完了にする"></button>
    <span class="grow" style="min-width:0"><div class="ellipsis">${esc(t.title)}</div><div class="small muted">${t.due ? `期日 ${fmtDay(t.due)}` : "期日なし"}${t.owner === "agent" ? " · AI 担当" : ""}</div></span>
    <span class="status-pill st-${t.status}">${TASK_STATUS[t.status] || t.status}</span></div>`;
}
async function doneTask(id) {
  try { await api(`/api/tasks/${encodeURIComponent(id)}`, { method: "PUT", body: { status: "done" } }); toast("完了にしました"); emit("tasks"); } catch (e) { fail(e); }
}
function dueLabel(due) {
  if (!due) return `<span class="due">期日なし</span>`;
  const t = todayStr(), d = new Date(due + "T00:00"), diff = Math.round((d - new Date(t + "T00:00")) / 86400000);
  const cls = diff < 0 ? "over" : diff === 0 ? "today" : diff <= 3 ? "soon" : "";
  const word = diff < 0 ? `${-diff}日超過` : diff === 0 ? "今日まで" : diff === 1 ? "明日まで" : `${fmtDay(due)}まで`;
  return `<span class="due ${cls}">${word}</span>`;
}
/** 期日が早い順（期日なしは最後）→ 優先度 → 登録順。 */
const byDue = (a, b) => (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31") || a.priority - b.priority || a.id - b.id;

const tasksState = { view: "team", tab: "all", showDone: false };
async function renderTasks(el, opts = {}) {
  el.innerHTML = `<div class="page"><header class="page-head"><h1>タスク</h1>
    <div class="seg"><button data-view="team" class="${tasksState.view === "team" ? "on" : ""}">チーム</button><button data-view="me" class="${tasksState.view === "me" ? "on" : ""}">自分<span class="hide-m">（タスクバスター）</span></button></div>
    <span class="grow"></span><span class="head-right row"></span></header><div class="tasks-body"></div></div>`;
  $$("[data-view]", el).forEach(b => b.onclick = () => { tasksState.view = b.dataset.view; renderTasks(el, opts); });
  const body = $(".tasks-body", el);
  return tasksState.view === "team" ? renderTeamTasks(body, $(".head-right", el)) : renderMyTasks(body, $(".head-right", el));
}

async function renderTeamTasks(el, right) {
  right.innerHTML = "";
  const members = () => Object.values(S.users).filter(u => u.active);
  let rows = [];
  const draw = async () => {
    let q = SB.from("team_tasks").select("*").order("due", { ascending: true, nullsFirst: false }).limit(500);
    q = tasksState.showDone ? q.neq("status", "cut") : q.in("status", ["todo", "doing", "waiting"]);
    rows = must(await q);
    const open = rows.filter(t => !["done", "cut"].includes(t.status));
    const tab = tasksState.tab;
    const count = uid => open.filter(t => uid === "none" ? !t.assignee_id : t.assignee_id === uid).length;
    const tabs = [["all", `全体 <span class="badge soft">${open.length}</span>`],
      ...members().map(u => [u.id, `${avatar(u, 20, false)} ${esc(shortName(u))} <span class="badge soft">${count(u.id)}</span>`]),
      ["none", `担当未定 <span class="badge soft">${count("none")}</span>`]];
    const list = rows.filter(t => tab === "all" || (tab === "none" ? !t.assignee_id : t.assignee_id === tab)).sort(byDue);
    const showWho = tab === "all";
    el.innerHTML = `<div class="tt-tabs" role="tablist">${tabs.map(([k, l]) => `<button class="chip${k === tab ? " on" : ""}" data-tab="${k}" role="tab">${l}</button>`).join("")}
        <button class="chip chip-toggle${tasksState.showDone ? " on" : ""}" data-showdone aria-pressed="${tasksState.showDone}">${icon("check")} 完了も表示</button></div>
      <form class="tt-add card"><input class="input" name="title" placeholder="${tab !== "all" && tab !== "none" ? esc(U(tab).name) + " さんに頼むこと" : "チームでやること"}（Enter で追加）" required>
        <span class="tt-add-more"><input class="input" type="date" name="due" aria-label="期日">
        <select class="input" name="assignee" aria-label="担当"><option value="">担当未定</option>${members().map(u => `<option value="${u.id}"${u.id === tab ? " selected" : ""}>${esc(u.name)}</option>`).join("")}</select>
</span>
        <button class="btn primary" aria-label="追加">${icon("plus")}<span class="hide-m"> 追加</span></button></form>
      ${list.length ? `<div class="card" style="overflow:hidden">${list.map(t => {
        const who = t.assignee_id ? U(t.assignee_id) : null; const done = t.status === "done";
        return `<div class="tt-row${done ? " done" : ""}" data-t="${t.id}" role="button" tabindex="0">
          <button class="task-check${done ? " on" : ""}" data-check="${t.id}" aria-label="${done ? "未完了に戻す" : "完了にする"}"></button>
          <div style="min-width:0"><div class="tt-title ellipsis">${t.priority === 1 ? '<span class="prio prio-1">高</span> ' : ""}${esc(t.title)}</div>
            <div class="tt-meta">${dueLabel(t.due)}<span class="status-pill st-${t.status}">${TASK_STATUS[t.status]}</span>${t.source ? `<span class="ellipsis" style="max-width:220px">元: ${esc(t.source)}</span>` : ""}</div></div>
          ${showWho ? `<span class="tt-who">${who ? `${avatar(who, 22, false)}${esc(who.name)}` : '<span class="muted">担当未定</span>'}</span>` : "<span></span>"}</div>`;
      }).join("")}</div>` : `<div class="empty"><b>${tab === "all" ? "未完了のチームタスクはありません" : "このメンバーの未完了タスクはありません"}</b>チャットやメールの「タスク化」からも登録できます</div>`}`;
    $(".tt-add", el).onsubmit = async e => {
      e.preventDefault(); const f = e.target;
      try { await teamTaskCreate({ title: f.title.value.trim(), due: f.due.value || null, assignee_id: f.assignee.value || null, source: "" }); f.title.value = ""; f.due.value = ""; draw(); }
      catch (er) { fail(er); }
    };
  };
  el.onclick = async e => {
    const tg = e.target;
    const tb = tg.closest("[data-tab]"); if (tb) { tasksState.tab = tb.dataset.tab; return draw(); }
    if (tg.closest("[data-showdone]")) { tasksState.showDone = !tasksState.showDone; return draw(); }
    const ck = tg.closest("[data-check]");
    if (ck) {
      e.stopPropagation();
      const t = rows.find(x => x.id === +ck.dataset.check);
      ck.classList.toggle("on", t.status !== "done");
      return toggleDone(t);
    }
    const row = tg.closest("[data-t]"); if (row) openTeamTask(+row.dataset.t);
  };
  el.onkeydown = e => { if (e.key === "Enter" && e.target.matches("[data-t]")) openTeamTask(+e.target.dataset.t); };
  const log = (t, body) => SB.from("team_task_logs").insert({ task_id: t.id, team_id: S.me.team_id, user_id: S.me.id, body });
  async function toggleDone(t) {
    const status = t.status === "done" ? "todo" : "done";
    try { must(await SB.from("team_tasks").update({ status }).eq("id", t.id)); await log(t, status === "done" ? "完了にしました" : "未完了に戻しました");
      if (status === "done") toast("完了にしました"); draw(); } catch (er) { fail(er); }
  }
  swipeRows(el, ".tt-row", row => {
    const t = rows.find(x => x.id === +row.dataset.t); if (!t) return {};
    return {
      right: { label: t.status === "done" ? "未完了に戻す" : "完了", icon: "check", tone: t.status === "done" ? "warn" : "ok", run: () => toggleDone(t) },
      left: t.assignee_id === S.me.id ? null : { label: "自分が担当", icon: "user", tone: "accent", run: async () => {
        must(await SB.from("team_tasks").update({ assignee_id: S.me.id }).eq("id", t.id)); await log(t, "担当を引き受けました"); toast("担当になりました"); draw(); } },
    };
  });
  screenOn({ team_tasks: draw, users: draw });
  await draw();
}

async function openTeamTask(id) {
  const [t, logs] = await Promise.all([SB.from("team_tasks").select("*").eq("id", id).single().then(must),
    SB.from("team_task_logs").select("*").eq("task_id", id).order("created_at", { ascending: false }).limit(50).then(must)]);
  const members = Object.values(S.users).filter(u => u.active || u.id === t.assignee_id);
  const ta = (n, l, v, rows = 2) => `<label class="field"><span>${l}</span><textarea class="input" name="${n}" rows="${rows}">${esc(v)}</textarea></label>`;
  const ov = modal("チームタスク", `<form>
    <label class="field"><span>やること</span><input class="input" name="title" value="${esc(t.title)}"></label>
    <div class="row wrap">
      <label class="field grow"><span>担当</span><select class="input" name="assignee_id"><option value="">担当未定</option>${members.map(u => `<option value="${u.id}"${u.id === t.assignee_id ? " selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>
      <label class="field"><span>期日</span><input class="input" type="date" name="due" value="${t.due || ""}"></label>
      <label class="field"><span>優先度</span><select class="input" name="priority">${[1, 2, 3].map(p => `<option value="${p}"${p === t.priority ? " selected" : ""}>${PRIO[p]}</option>`).join("")}</select></label>
      <label class="field"><span>状態</span><select class="input" name="status">${Object.entries(TASK_STATUS).map(([k, l]) => `<option value="${k}"${k === t.status ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>
    ${ta("goal", "ゴール（何が良くなれば終わりか）", t.goal)}${ta("done_def", "完了条件", t.done_def)}${ta("deliverable", "成果物の形と置き場所", t.deliverable)}${ta("memo", "メモ", t.memo, 3)}
    ${t.source ? `<p class="small muted" style="margin:-4px 0 12px">登録元: ${esc(t.source)}</p>` : ""}
    <div class="section-title">経過</div>
    <div class="row"><input class="input grow" name="log" placeholder="経過を書く（例: 見積を依頼済み）"><button type="button" class="btn" data-log>記録</button></div>
    <div class="log-list">${logs.map(l => `<div class="log-item">${avatar(U(l.user_id), 24, false)}<div><b>${esc(U(l.user_id).name)}</b> <span class="small muted">${fmtDay(localISO(l.created_at))} ${fmtTime(localISO(l.created_at))}</span><div style="white-space:pre-wrap">${esc(l.body)}</div></div></div>`).join("")}</div></form>`,
    { foot: `${S.me.role === "admin" ? `<button class="btn danger" data-del>${icon("trash")}</button>` : ""}<button class="btn claude" data-cl>${CLAUDE_MARK} 進め方を Claude に相談</button><span class="grow"></span><button class="btn" data-c>閉じる</button><button class="btn primary" data-s>保存</button>` });
  const f = $("form", ov);
  $("[data-c]", ov).onclick = () => ov.close();
  $("[data-log]", ov).onclick = async () => {
    const body = f.log.value.trim(); if (!body) return;
    try { must(await SB.from("team_task_logs").insert({ task_id: id, team_id: S.me.team_id, user_id: S.me.id, body })); ov.close(); openTeamTask(id); } catch (e) { fail(e); }
  };
  $("[data-cl]", ov).onclick = () => openClaude(`チームのタスクの進め方を一緒に考えてください。\n\nやること: ${f.title.value}\nゴール: ${f.goal.value}\n完了条件: ${f.done_def.value}\n成果物: ${f.deliverable.value}\n期日: ${f.due.value || "未定"}\nメモ: ${f.memo.value}`);
  const del = $("[data-del]", ov);
  if (del) del.onclick = async () => { if (await confirmBox("このタスクを削除しますか？（通常は状態を「取り下げ」にしてください）", "削除", true)) { must(await SB.from("team_tasks").delete().eq("id", id)); ov.close(); } };
  $("[data-s]", ov).onclick = async () => {
    const d = Object.fromEntries(new FormData(f)); delete d.log;
    const upd = { ...d, assignee_id: d.assignee_id || null, due: d.due || null, priority: +d.priority };
    const changes = [];
    if (upd.status !== t.status) changes.push(`状態を「${TASK_STATUS[upd.status]}」に`);
    if ((upd.assignee_id || "") !== (t.assignee_id || "")) changes.push(`担当を「${upd.assignee_id ? U(upd.assignee_id).name : "未定"}」に`);
    if ((upd.due || "") !== (t.due || "")) changes.push(`期日を「${upd.due || "なし"}」に`);
    try {
      must(await SB.from("team_tasks").update(upd).eq("id", id));
      if (changes.length) await SB.from("team_task_logs").insert({ task_id: id, team_id: S.me.team_id, user_id: S.me.id, body: changes.join("、") + "変更" });
      ov.close(); toast("保存しました");
    } catch (e) { fail(e); }
  };
}

async function renderMyTasks(el, right) {
  right.innerHTML = `<a class="btn" data-web target="_blank" rel="noopener" hidden>タスクバスターを開く</a><button class="btn" data-conn>${icon("sync")} 接続設定</button>`;
  el.innerHTML = `<p class="small muted tb-mode" style="margin:-6px 0 12px"></p>
    <form class="task-add card"><input class="input" name="title" placeholder="自分のやることを入力して Enter" required><input class="input" type="date" name="due" style="width:160px"><button class="btn primary">${icon("plus")} 追加</button></form>
    <div class="task-body"><div class="empty">読み込み中…</div></div>`;
  const draw = async () => {
    const d = await api("/api/tasks");
    $(".tb-mode", el).innerHTML = d.mode === "taskbuster"
      ? `<span style="color:var(--ok)">● あなたのタスクバスターと連携中</span> · この一覧はあなたにしか見えません`
      : `○ タスクバスター未接続 — あなた専用の一覧に保存しています（他のメンバーには見えません）${d.error ? ` · ${esc(d.error.slice(0, 80))}` : ""}`;
    const web = $("[data-web]", right); if (d.web_url) { web.hidden = false; web.href = d.web_url; }
    const list = [...d.tasks].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    $(".task-body", el).innerHTML = list.length ? `<div class="card list" style="overflow:hidden">${list.map(taskRow).join("")}</div>`
      : `<div class="empty"><b>未完了のタスクはありません</b></div>`;
  };
  $(".task-add", el).onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    try { const r = await api("/api/tasks", { method: "POST", body: { title: f.title.value, due: f.due.value, source: "owl" } }); f.reset(); toast(r.mode === "taskbuster" ? "タスクバスターに登録しました" : "登録しました"); draw(); } catch (er) { fail(er); }
  };
  el.onclick = e => { const b = e.target.closest("[data-tdone]"); if (b) { b.classList.add("on"); doneTask(b.dataset.tdone).then(draw); } };
  swipeRows(el, ".task-body .li", row => {
    const id = row.querySelector("[data-tdone]")?.dataset.tdone; if (!id) return {};
    return { right: { label: "完了", icon: "check", tone: "ok", run: () => doneTask(id).then(draw) } };
  });
  $("[data-conn]", right).onclick = () => tbSettings(draw);
  screenOn({ tasks: draw });
  await draw();
}

async function tbSettings(done) {
  const st = must(await SB.rpc("tb_status"));
  const ov = modal("自分のタスクバスターをつなぐ", `
    <p class="small" style="margin-top:0">${st.configured ? `<span style="color:var(--ok)">● 接続済み</span>（${esc(st.host)}）` : "○ 未接続"}</p>
    <p class="small muted">各自が自分のタスクバスターをつなぎます。トークンはサーバにだけ保存され、<b>あなた自身を含めてブラウザからは二度と読み出せません</b>。他のメンバーがあなたのタスクを見ることもできません。</p>
    <label class="field"><span>MCP の URL（https://…）</span><input class="input" name="mcp_url" placeholder="https://…/mcp" autocomplete="off"></label>
    <label class="field"><span>トークン</span><input class="input" name="token" type="password" autocomplete="off"></label>
    <label class="field"><span>タスクバスターの画面の URL（任意）</span><input class="input" name="web_url" placeholder="https://…" value="${esc(st.web_url || "")}"></label>
    <details class="small muted"><summary>どこで分かる？</summary>Claude Code の設定ファイル（~/.claude.json の mcpServers.taskbuster）にある url と、Authorization の Bearer の後ろの文字列です。</details>`,
    { foot: `${st.configured ? `<button class="btn danger" data-clear>接続を解除</button>` : ""}<span class="grow"></span><button class="btn" data-c>閉じる</button><button class="btn primary" data-s>確認して保存</button>` });
  $("[data-c]", ov).onclick = () => ov.close();
  const clr = $("[data-clear]", ov);
  if (clr) clr.onclick = async () => { await fn("taskbuster", { action: "clear_config" }); ov.close(); toast("解除しました"); done && done(); };
  $("[data-s]", ov).onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = "接続を確認中…";
    try {
      await fn("taskbuster", { action: "set_config", mcp_url: $("[name=mcp_url]", ov).value, token: $("[name=token]", ov).value, web_url: $("[name=web_url]", ov).value });
      ov.close(); toast("タスクバスターをつなぎました"); done && done();
    } catch (er) { fail(er); b.disabled = false; b.textContent = "確認して保存"; }
  };
}

/* ================================================================ 管理（管理者のみ。権限は DB と Edge Function が最終判断する） */
async function renderAdmin(el) {
  if (S.me.role !== "admin") { el.innerHTML = `<div class="empty"><b>管理者だけが開けます</b></div>`; return; }
  el.innerHTML = `<div class="page"><header class="page-head"><h1>管理</h1><span class="small muted">データと参加者の管理。操作はすべて監査ログに残ります</span></header>
    <div class="admin-grid">
      <section class="card admin-card" data-k="invites"><h2>招待コード</h2><p class="desc">新規登録のときだけ必要です（ログインは ID とパスワードだけ）。漏れたら「無効にする」で、そのコードでの新規登録を止められます。メンバーを外すときは下の「メンバー」で利用を停止してください。</p><div class="body"></div></section>
      <section class="card admin-card" data-k="members"><h2>メンバー</h2><p class="desc">利用停止にすると、その人はすぐにどのデータも読めなくなります（データは残ります）。</p><div class="body"></div></section>
      <section class="card admin-card" data-k="mail"><h2>共有 Gmail</h2><p class="desc">Gmail の 2 段階認証を有効にし、アプリパスワード（16 桁）を発行して入力します。パスワードはサーバにだけ保存され、画面には二度と表示されません。</p><div class="body"></div></section>
      <section class="card admin-card" data-k="repo"><h2>GitHub リポジトリ</h2><p class="desc">会社の資料リポジトリを「リポジトリ」画面で読めるようにします。<b>読み取り専用</b>の Fine-grained トークン（対象リポジトリだけ・Contents: Read-only）を使ってください。トークンはサーバにだけ保存され、画面には二度と表示されません。</p><div class="body"></div></section>
      <section class="card admin-card" data-k="team"><h2>チームとデータ</h2><p class="desc">チーム名の変更と、データの書き出し（バックアップ）。</p><div class="body"></div></section>
      <section class="card admin-card" data-k="audit" style="grid-column:1/-1"><h2>監査ログ</h2><p class="desc">誰がいつ何をしたか（直近 100 件）。</p><div class="body"></div></section>
    </div></div>`;
  const box = k => $(`[data-k="${k}"] .body`, el);
  const fmtTs = ts => ts ? `${fmtDay(localISO(ts))} ${fmtTime(localISO(ts))}` : "—";

  const invites = async () => {
    const rows = must(await SB.from("invites").select("*").order("created_at", { ascending: false }));
    const valid = i => !i.revoked && (!i.expires_at || new Date(i.expires_at) > new Date());
    box("invites").innerHTML = `<table class="tbl"><thead><tr><th>コード</th><th>権限</th><th class="hide-sm">登録数</th><th class="hide-sm">期限</th><th></th></tr></thead><tbody>
      ${rows.map(i => `<tr class="${valid(i) ? "" : "off"}"><td><span class="code-pill">${esc(i.code)}</span>${i.note ? `<div class="small muted">${esc(i.note)}</div>` : ""}</td>
        <td>${i.role === "admin" ? "管理者" : "メンバー"}</td><td class="hide-sm">${i.uses}/${i.max_uses}</td><td class="hide-sm small">${i.expires_at ? fmtTs(i.expires_at) : "なし"}</td>
        <td style="white-space:nowrap">${valid(i) ? `<button class="btn sm" data-copy="${esc(i.code)}">コピー</button> <button class="btn sm danger" data-revoke="${esc(i.code)}">無効にする</button>` : '<span class="small muted">無効</span>'}</td></tr>`).join("")}</tbody></table>
      <form class="row wrap" style="margin-top:12px;gap:8px" data-newinv>
        <select class="input" name="role" style="width:auto"><option value="member">メンバー用</option><option value="admin">管理者用</option></select>
        <input class="input" name="max" type="number" min="1" value="20" style="width:90px" title="登録できる人数">
        <select class="input" name="days" style="width:auto"><option value="0">期限なし</option><option value="7">7日</option><option value="30" selected>30日</option><option value="90">90日</option></select>
        <input class="input grow" name="note" placeholder="メモ（例: 10月入社）"><button class="btn primary">発行</button></form>`;
    $("[data-newinv]", el).onsubmit = async e => {
      e.preventDefault(); const f = e.target;
      try {
        const code = must(await SB.rpc("create_invite", { p_role: f.role.value, p_max_uses: +f.max.value, p_days: +f.days.value, p_note: f.note.value }));
        await navigator.clipboard.writeText(code).catch(() => { }); toast(`発行しました: ${code}（コピー済み）`); invites(); audit();
      } catch (er) { fail(er); }
    };
  };
  const members = async () => {
    const rows = must(await SB.from("profiles").select("*").order("created_at"));
    box("members").innerHTML = `<table class="tbl"><tbody>${rows.map(u => `<tr class="${u.active ? "" : "off"}">
      <td><span class="row" style="gap:8px">${avatar(u, 26, false)}<span><b>${esc(u.name)}</b><div class="small muted">${esc(u.login)}</div></span></span></td>
      <td><select class="input" data-role="${u.id}" style="width:auto;min-height:32px;padding:2px 8px">
        <option value="member"${u.role === "member" ? " selected" : ""}>メンバー</option><option value="admin"${u.role === "admin" ? " selected" : ""}>管理者</option></select></td>
      <td style="white-space:nowrap;text-align:right">${u.id === S.me.id ? '<span class="small muted">あなた</span>' : `<button class="btn sm" data-reset="${u.id}">仮パスワード</button> ${u.active ? `<button class="btn sm danger" data-stop="${u.id}">利用停止</button>` : `<button class="btn sm" data-start="${u.id}">再開</button>`}`}</td></tr>`).join("")}</tbody></table>`;
  };
  const mail = async () => {
    const st = must(await SB.rpc("mail_status"));
    box("mail").innerHTML = `${st.configured ? `<p style="margin:0 0 10px"><span style="color:var(--ok)">● 接続中</span> ${esc(st.address)}<br><span class="small muted">最終同期: ${fmtTs(st.last_sync)}${st.error ? ` · <span style="color:var(--danger)">${esc(st.error)}</span>` : ""}</span></p>` : '<p class="small" style="margin:0 0 10px">○ 未設定</p>'}
      <form class="row wrap" style="gap:8px" data-mailcfg><input class="input grow" name="address" type="email" placeholder="team@example.com" value="${esc(st.address || "")}" autocomplete="off">
        <input class="input grow" name="pass" type="password" placeholder="アプリパスワード 16 桁" autocomplete="new-password"><button class="btn primary">確認して保存</button>
        ${st.configured ? `<button type="button" class="btn danger" data-mailclear>切断</button>` : ""}</form>`;
    $("[data-mailcfg]", el).onsubmit = async e => {
      e.preventDefault(); const f = e.target, b = $("button.primary", f); b.disabled = true; b.textContent = "Gmail に接続中…";
      try {
        await fn("mail", { action: "set_config", address: f.address.value, app_password: f.pass.value }); toast("共有 Gmail をつなぎました");
        S.cfg.mail = must(await SB.rpc("mail_status"));
        fn("mail", { action: "sync", force: true }).catch(() => { }); mail(); audit();
      } catch (er) { fail(er); b.disabled = false; b.textContent = "確認して保存"; }
    };
    const c = $("[data-mailclear]", el);
    if (c) c.onclick = async () => { if (await confirmBox("共有 Gmail の接続を解除しますか？（取り込み済みのメールは残ります）", "解除", true)) { await fn("mail", { action: "clear_config" }); mail(); audit(); } };
  };
  const repoBox = async () => {
    const st = must(await SB.rpc("repo_status"));
    const fmt = ts => ts ? `${fmtDay(localISO(ts))} ${fmtTime(localISO(ts))}` : "—";
    box("repo").innerHTML = `${st.configured ? `<p style="margin:0 0 10px"><span style="color:var(--ok)">● 接続中</span> ${esc(st.repo)}${st.branch ? `（${esc(st.branch)}）` : ""}<br><span class="small muted">索引 ${st.docs} 件・本文あり ${st.with_text} 件・更新 ${fmt(st.indexed_at)}${st.error ? ` · <span style="color:var(--danger)">${esc(st.error)}</span>` : ""}</span></p>` : '<p class="small" style="margin:0 0 10px">○ 未設定</p>'}
      <form class="row wrap" style="gap:8px" data-repocfg>
        <input class="input grow" name="repo" placeholder="持ち主/リポジトリ名" value="${esc(st.repo || "Kazuyan38/our-company-work-place")}" autocomplete="off" style="min-width:220px">
        <input class="input" name="branch" placeholder="ブランチ（空なら既定）" value="${esc(st.branch || "")}" style="width:180px">
        <input class="input grow" name="token" type="password" placeholder="github_pat_…（読み取り専用）" autocomplete="new-password" style="min-width:220px">
        <button class="btn primary">確認して保存</button>
        ${st.configured ? `<button type="button" class="btn danger" data-repoclear>切断</button>` : ""}</form>
      <div class="pat-steps small">
        <a class="btn sm" data-patlink target="_blank" rel="noopener">${icon("share")} GitHub で読み取り専用の鍵を作る</a>
        <ol>
          <li>開いた画面は名前・期限（1 年）・権限（Contents: 読み取り）が入力済みです</li>
          <li><b>Repository access</b> で「Only select repositories」を選び、<b class="pat-repo"></b> だけを選ぶ</li>
          <li>一番下の <b>Generate token</b> を押し、表示された <code>github_pat_…</code> をコピーして上の欄に貼る</li>
        </ol></div>`;
    // 持ち主（target_name）を入れて、名前・権限・期限を入力済みの作成画面を開く（GitHub の template URL）
    const patLink = () => {
      const repo = $("[data-repocfg] [name=repo]", el).value.trim();
      const owner = repo.split("/")[0] || "", name = repo.split("/")[1] || "";
      const u = new URL("https://github.com/settings/personal-access-tokens/new");
      u.searchParams.set("name", `owl-read-${name}`.slice(0, 40));
      u.searchParams.set("description", `owl（チーム連絡ツール）から ${repo} を読むための読み取り専用トークン`);
      if (owner) u.searchParams.set("target_name", owner);
      u.searchParams.set("expires_in", "366");
      u.searchParams.set("contents", "read");
      $("[data-patlink]", el).href = u.toString();
      $(".pat-repo", el).textContent = repo || "対象のリポジトリ";
    };
    patLink();
    $("[data-repocfg] [name=repo]", el).addEventListener("input", patLink);
    $("[data-repocfg]", el).onsubmit = async e => {
      e.preventDefault(); const f = e.target, b = $("button.primary", f); b.disabled = true; b.textContent = "GitHub に接続中…";
      try {
        await repoCall({ action: "set_config", repo: f.repo.value, branch: f.branch.value, token: f.token.value });
        toast("リポジトリをつなぎました。リポジトリ画面を開くと検索の索引を作ります"); repoBox(); audit();
      } catch (er) { fail(er); b.disabled = false; b.textContent = "確認して保存"; }
    };
    const c = $("[data-repoclear]", el);
    if (c) c.onclick = async () => { if (await confirmBox("リポジトリの接続を解除しますか？（検索の索引も消えます）", "解除", true)) { await repoCall({ action: "clear_config" }); repoBox(); audit(); } };
  };
  const teamBox = async () => {
    box("team").innerHTML = `<form class="row" style="gap:8px;margin-bottom:14px" data-rename><input class="input grow" name="name" value="${esc(S.cfg.team)}"><button class="btn">名前を変更</button></form>
      <button class="btn primary" data-export>${icon("dl")} チームのデータを書き出す（JSON）</button>
      <p class="small muted" style="margin:8px 0 0">あなたが閲覧できる範囲（公開チャンネル・自分が参加する DM・予定・シフト・連絡先・メール・チームタスク・ファイル一覧）を書き出します。他人同士の DM は管理者でも含みません。</p>`;
    $("[data-rename]", el).onsubmit = async e => { e.preventDefault(); try { await fn("admin", { action: "rename_team", name: e.target.name.value }); S.cfg.team = e.target.name.value; toast("変更しました"); audit(); } catch (er) { fail(er); } };
    $("[data-export]", el).onclick = exportData;
  };
  const audit = async () => {
    const rows = must(await SB.from("audit_log").select("*").order("at", { ascending: false }).limit(100));
    const L = { "invite.create": "招待コードを発行", "invite.revoke": "招待コードを無効化", "member.register": "新規登録", "member.role": "権限を変更", "member.deactivate": "利用停止",
      "member.reactivate": "利用再開", "member.reset_password": "仮パスワードを発行", "mail.configure": "共有 Gmail を設定", "mail.disconnect": "共有 Gmail を切断", "team.rename": "チーム名を変更", "data.export": "データを書き出し", "repo.configure": "リポジトリを接続", "repo.disconnect": "リポジトリを切断" };
    box("audit").innerHTML = rows.length ? `<table class="tbl"><tbody>${rows.map(r => `<tr><td class="small" style="white-space:nowrap">${fmtTs(r.at)}</td><td>${esc(r.actor_id ? U(r.actor_id).name : "—")}</td>
      <td>${esc(L[r.action] || r.action)}</td><td class="small muted hide-sm">${esc(Object.entries(r.detail || {}).map(([k, v]) => `${k}: ${v}`).join(" / "))}</td></tr>`).join("")}</tbody></table>` : '<p class="small muted">まだ記録はありません</p>';
  };
  el.onclick = async e => {
    const t = e.target;
    const cp = t.closest("[data-copy]"); if (cp) { await navigator.clipboard.writeText(cp.dataset.copy).catch(() => { }); return toast("コピーしました"); }
    const rv = t.closest("[data-revoke]");
    if (rv) {
      if (!await confirmBox(`招待コード ${rv.dataset.revoke} を無効にしますか？このコードでは新しく登録できなくなります（登録済みのメンバーはそのまま使えます）。`, "無効にする", true)) return;
      try { must(await SB.rpc("revoke_invite", { p_code: rv.dataset.revoke })); invites(); audit(); } catch (er) { fail(er); }
      return;
    }
    const call = async (action, uid) => { try { const r = await fn("admin", { action, user_id: uid }); members(); audit(); return r; } catch (er) { fail(er); } };
    const st = t.closest("[data-stop]"); if (st && await confirmBox(`${U(st.dataset.stop).name} さんを利用停止にしますか？`, "利用停止", true)) return call("deactivate", st.dataset.stop);
    const sa = t.closest("[data-start]"); if (sa) return call("reactivate", sa.dataset.start);
    const rs = t.closest("[data-reset]");
    if (rs && await confirmBox(`${U(rs.dataset.reset).name} さんに仮パスワードを発行しますか？今のパスワードは使えなくなります。`, "発行")) {
      const r = await call("reset_password", rs.dataset.reset);
      if (r) modal("仮パスワード", `<p>本人に直接伝え、ログイン後にプロフィールから変更してもらってください。この画面を閉じると二度と表示されません。</p><p class="code-pill" style="font-size:20px">${esc(r.password)}</p>`);
    }
  };
  el.onchange = async e => {
    const r = e.target.closest("[data-role]"); if (!r) return;
    try { await fn("admin", { action: "set_role", user_id: r.dataset.role, role: r.value }); toast("権限を変更しました"); audit(); } catch (er) { fail(er); members(); }
  };
  await Promise.all([invites(), members(), mail(), repoBox(), teamBox(), audit()]);
}

async function exportData() {
  toast("書き出しています…");
  try {
    const all = async (table, order) => {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = must(await SB.from(table).select("*").order(order).range(from, from + 999)); out.push(...rows);
        if (rows.length < 1000) break;
      }
      return out;
    };
    const tables = { profiles: "created_at", channels: "id", channel_members: "channel_id", messages: "id", reactions: "message_id", files: "id", events: "id",
      shifts: "id", contacts: "id", emails: "id", email_reads: "email_id", team_tasks: "id", team_task_logs: "id", invites: "created_at", audit_log: "id" };
    const data = { exported_at: new Date().toISOString(), team: S.cfg.team, exported_by: S.me.login };
    for (const [t, o] of Object.entries(tables)) data[t] = await all(t, o);
    await SB.rpc("log_export", { p_rows: Object.values(data).filter(Array.isArray).reduce((a, x) => a + x.length, 0) });
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `owl-export-${todayStr()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("書き出しました");
  } catch (e) { fail(e); }
}

/* ================================================================ 検索 / クイックスイッチャ */
function openSwitcher() {
  const ov = modal("移動・検索", `<input class="input" placeholder="チャンネル・人・メッセージ・ファイル・メールを検索" autofocus style="height:46px;font-size:16px">
    <div class="sw-results" style="margin-top:12px;max-height:60vh;overflow:auto"></div>`, { cls: "switcher" });
  const input = $("input", ov), res = $(".sw-results", ov);
  let items = [], idx = 0, qt;
  const render = (remote) => {
    const q = input.value.trim();
    const chs = [...S.channels].filter(c => !q || chName(c).toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (b.unread - a.unread) || (b.last_at || "").localeCompare(a.last_at || "")).slice(0, 8);
    const ppl = q ? Object.values(S.users).filter(u => u.id !== S.me.id && (u.name + u.kana + u.login).toLowerCase().includes(q.toLowerCase())).slice(0, 5) : [];
    items = [...chs.map(c => ({ html: `${chIcon(c)}<span class="grow ellipsis">${esc(chName(c))}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : ""}`, go: () => UI.openChannel(c.id) })),
      ...ppl.map(u => ({ html: `${avatar(u, 22)}<span class="grow">${esc(u.name)} <span class="small muted">に DM</span></span>`, go: async () => { const r = await api("/api/dm", { method: "POST", body: { user_ids: [u.id] } }); await loadChannels(); UI.openChannel(r.id); } }))];
    if (remote) {
      items.push(...remote.messages.map(m => ({ html: `${icon("chat")}<span class="grow" style="min-width:0"><div class="ellipsis">${esc(m.body)}</div><div class="small muted">${esc(U(m.user_id).name)} · ${esc(chName(S.channels.find(c => c.id === m.channel_id)))} · ${fmtRel(m.created_at)}</div></span>`, go: () => UI.openChannel(m.channel_id) })));
      items.push(...remote.files.map(f => ({ html: `${fileIcon(f)}<span class="grow ellipsis">${esc(f.name)}</span>`, go: () => openViewer(f) })));
      items.push(...remote.mail.map(m => ({ html: `${icon("mail")}<span class="grow" style="min-width:0"><div class="ellipsis">${esc(m.subject)}</div><div class="small muted">${esc(m.from_name)} · ${fmtRel(m.date)}</div></span>`, go: () => UI.openMail(m.id) })));
      items.push(...(remote.repo || []).map(r => ({ html: `${icon("book")}<span class="grow" style="min-width:0"><div class="ellipsis">${esc(r.name)}</div><div class="small muted ellipsis">${esc(r.snippet || r.path)}</div></span>`, go: () => UI.openRepo(r.path) })));
      items.push(...remote.contacts.map(c => ({ html: `${icon("user")}<span class="grow">${esc(c.name)} <span class="small muted">${esc(c.company)}</span></span>`, go: () => showContact(c, () => { }) })));
    }
    idx = Math.min(idx, Math.max(items.length - 1, 0));
    res.innerHTML = items.length ? items.map((it, i) => `<button class="li${i === idx ? " sel" : ""}" data-i="${i}" style="border-radius:10px;border:0">${it.html}</button>`).join("") : `<div class="empty">見つかりませんでした</div>`;
  };
  const pick = i => { const it = items[i]; if (it) { ov.close(); it.go(); } };
  input.oninput = () => { idx = 0; render(); clearTimeout(qt); const q = input.value.trim(); if (q.length >= 1) qt = setTimeout(async () => {
      const [r, rp] = await Promise.all([api(`/api/search?q=${encodeURIComponent(q)}`), SB.rpc("repo_search", { q, lim: 5 }).then(x => x.data || [], () => [])]);
      if (input.value.trim() === q) render({ ...r, repo: rp });
    }, 220); };
  input.onkeydown = e => {
    if (e.key === "ArrowDown") { idx = Math.min(idx + 1, items.length - 1); $$(".li", res).forEach((b, i) => b.classList.toggle("sel", i === idx)); $$(".li", res)[idx]?.scrollIntoView({ block: "nearest" }); e.preventDefault(); }
    if (e.key === "ArrowUp") { idx = Math.max(idx - 1, 0); $$(".li", res).forEach((b, i) => b.classList.toggle("sel", i === idx)); $$(".li", res)[idx]?.scrollIntoView({ block: "nearest" }); e.preventDefault(); }
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); pick(idx); }
  };
  res.onclick = e => { const b = e.target.closest("[data-i]"); if (b) pick(+b.dataset.i); };
  render();
}

/* ================================================================ チャンネル作成 */
function newChannel() {
  const ov = modal("チャンネルを作る", `<form>
    <div class="row"><label class="field" style="width:80px"><span>絵文字</span><input class="input" name="emoji" placeholder="#" maxlength="4"></label>
    <label class="field grow"><span>名前</span><input class="input" name="name" placeholder="例: 新店舗プロジェクト" autofocus required></label></div>
    <label class="field"><span>目的（一行）</span><input class="input" name="topic" placeholder="何を話す場所か書くと迷いません"></label>
    <div class="field"><span>メンバー</span><div class="row wrap" style="gap:6px">${Object.values(S.users).filter(u => u.id !== S.me.id).map(u => `<label class="chip on"><input type="checkbox" name="m" value="${u.id}" checked hidden>${esc(u.name)}</label>`).join("")}</div></div></form>`,
    { foot: `<button class="btn" data-c>やめる</button><button class="btn primary" data-s>作成</button>` });
  $$("input[name=m]", ov).forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
  $("[data-c]", ov).onclick = () => ov.close();
  $("[data-s]", ov).onclick = async () => {
    const f = $("form", ov);
    try { const r = await api("/api/channels", { method: "POST", body: { name: f.name.value, topic: f.topic.value, emoji: f.emoji.value, member_ids: $$("input[name=m]:checked", ov).map(i => i.value) } });
      ov.close(); await loadChannels(); UI.openChannel(r.id); } catch (e) { fail(e); }
  };
}
function newDM() {
  const ov = modal("ダイレクトメッセージ", `<p class="small muted" style="margin-top:0">1 人なら 1 対 1、複数選ぶとグループ DM になります。</p>
    <div class="list card" style="overflow:hidden">${Object.values(S.users).filter(u => u.id !== S.me.id).map(u => `<label class="li" style="cursor:pointer"><input type="checkbox" value="${u.id}">${avatar(u, 30)}<span class="grow">${esc(u.name)}</span><span class="small muted">${esc(u.title || "")}</span></label>`).join("")}</div>`,
    { foot: `<button class="btn" data-c>やめる</button><button class="btn primary" data-s>開く</button>` });
  $("[data-c]", ov).onclick = () => ov.close();
  $("[data-s]", ov).onclick = async () => {
    const ids = $$("input:checked", ov).map(i => i.value); if (!ids.length) return toast("相手を選んでください", true);
    const r = await api("/api/dm", { method: "POST", body: { user_ids: ids } }); ov.close(); await loadChannels(); UI.openChannel(r.id);
  };
}
function browseChannels() {
  const ov = modal("参加できるチャンネル", S.joinable.length ? `<div class="list card" style="overflow:hidden">${S.joinable.map(c => `<div class="li">${chIcon(c)}<span class="grow"><b>${esc(c.name)}</b><div class="small muted">${esc(c.topic || "")} · ${c.member_ids.length} 人</div></span><button class="btn sm primary" data-j="${c.id}">参加</button></div>`).join("")}</div>` : `<div class="empty">参加していないチャンネルはありません</div>`);
  $(".modal-body", ov).onclick = async e => { const b = e.target.closest("[data-j]"); if (b) { await api(`/api/channels/${b.dataset.j}/join`, { method: "POST" }); ov.close(); await loadChannels(); UI.openChannel(+b.dataset.j); } };
}
function channelInfo(ch) {
  const isCh = ch.kind === "channel";
  const ov = modal(isCh ? `#${ch.name}` : chName(ch), `
    ${isCh ? `<label class="field"><span>目的</span><input class="input" name="topic" value="${esc(ch.topic || "")}"></label>` : ""}
    <div class="section-title">メンバー ${ch.member_ids.length} 人</div>
    <div class="list card" style="overflow:hidden">${ch.member_ids.map(i => `<button class="li" data-u="${i}">${avatar(U(i), 28)}<span class="grow">${esc(U(i).name)}</span><span class="small muted">${S.online.has(i) ? "オンライン" : ""}</span></button>`).join("")}</div>
    ${isCh ? `<div class="row wrap" style="margin-top:12px">${Object.values(S.users).filter(u => !ch.member_ids.includes(u.id)).map(u => `<button class="chip" data-add="${u.id}">${icon("plus")} ${esc(u.name)}</button>`).join("")}</div>` : ""}`,
    { foot: `${isCh ? `<button class="btn danger" data-leave>退出</button>` : ""}<span class="grow"></span><button class="btn" data-star>${icon("star")} ${ch.starred ? "スターを外す" : "スター"}</button>${isCh ? `<button class="btn primary" data-save>保存</button>` : ""}` });
  ov.onclick = async e => {
    const t = e.target;
    if (t.closest("[data-u]")) { ov.close(); return showProfile(t.closest("[data-u]").dataset.u); }
    if (t.closest("[data-add]")) { await api(`/api/channels/${ch.id}/members`, { method: "POST", body: { user_ids: [t.closest("[data-add]").dataset.add] } }); ov.close(); toast("追加しました"); return; }
    if (t.closest("[data-star]")) { await api(`/api/channels/${ch.id}/star`, { method: "POST" }); ov.close(); return loadChannels(); }
    if (t.closest("[data-leave]")) { if (await confirmBox(`#${ch.name} から退出しますか？`, "退出", true)) { await api(`/api/channels/${ch.id}/leave`, { method: "POST" }); ov.close(); await loadChannels(); UI.go("home"); } return; }
    if (t.closest("[data-save]")) { await api(`/api/channels/${ch.id}`, { method: "PUT", body: { topic: $("[name=topic]", ov).value } }); ov.close(); toast("保存しました"); }
  };
}
