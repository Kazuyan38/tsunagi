"use strict";
const NAV = [["home", "ホーム", "home"], ["chat", "チャット", "chat"], ["mail", "メール", "mail"], ["calendar", "予定", "cal"], ["shifts", "シフト", "shift"], ["people", "連絡先", "people"], ["files", "ファイル", "file"], ["tasks", "タスク", "task"], ["repo", "リポジトリ", "book"]];
const LOGO = `<img class="logo brand-owl" src="img/favicon-64.png" alt="owl" width="42" height="42">`;

const UI = {
  isMobile: false,
  section: "home",
  filterUnread: false,
  chatVisible() { return this.section === "chat"; },

  start() {
    document.body.className = "";
    let collapsed = innerWidth < 1100;
    try { const v = localStorage.getItem("tsunagi_side"); if (v) collapsed = v === "collapsed"; } catch { }
    document.body.innerHTML = `<div class="app${collapsed ? " collapsed" : ""}">
      <nav class="rail" aria-label="メイン">${LOGO}
        <button class="rail-toggle" data-sidetoggle title="チャンネル一覧を開く／閉じる（Ctrl+\\）" aria-label="チャンネル一覧を開閉">${icon("panel")}</button>
        ${[...NAV, ...(S.me.role === "admin" ? [["admin", "管理", "user"]] : [])].map(([k, l, i]) => `<button class="rail-btn" data-go="${k}" title="${l}">${icon(i)}<span>${l}</span><span class="badge" hidden></span></button>`).join("")}
        <span class="sp"></span>
        <button class="rail-btn" data-bell title="通知" aria-label="通知">${icon("bell")}<span>通知</span><span class="badge alert" hidden></span></button>
        <button class="claude-btn" data-aimenu title="AI を開く（Claude・ChatGPT・Gemini・WorkOS）" aria-haspopup="menu">${CLAUDE_MARK}</button><span class="claude-cap">AI</span>
        <button class="me-btn" data-me title="プロフィール"></button>
      </nav>
      <aside class="side" aria-label="チャンネル">
        <div class="side-top"><div class="row" style="gap:6px"><button class="search-btn grow" data-search>${icon("search")} 移動・検索<kbd>Ctrl K</kbd></button>
          <button class="btn ghost icon" data-sidetoggle title="閉じる（Ctrl+\\）" aria-label="チャンネル一覧を閉じる">${icon("panel")}</button></div>
          <div class="side-filter"><button class="chip" data-filter="unread" aria-pressed="false">${icon("filter")} 未読だけ表示</button></div></div>
        <div class="side-scroll"></div>
        <div class="conn" hidden><span class="dot"></span><span>再接続しています…</span></div>
      </aside>
      <main class="main" id="main"></main></div>`;
    $(".rail .logo").replaceWith(owlBuddy(50));   // 左上のフクロウ。押すと owl とのチャット
    document.addEventListener("click", e => {
      const g = e.target.closest("[data-go]"); if (g) { this.go(g.dataset.go); return; }
      const bell = e.target.closest("[data-bell]"); if (bell) { this.openNotifs(bell); return; }
      const aiBtn = e.target.closest("[data-aimenu]"); if (aiBtn) { openAiMenu(aiBtn); return; }
      if (e.target.closest("[data-claude]")) openClaude();
      if (e.target.closest("[data-me]")) showProfile(S.me.id);
      if (e.target.closest("[data-search]")) openSwitcher();
      const f = e.target.closest("[data-filter]"); if (f) { this.filterUnread = !this.filterUnread; this.drawSide(); }
      if (e.target.closest("[data-sidetoggle]")) this.toggleSide();
      const c = e.target.closest(".side [data-ch]"); if (c) this.openChannel(+c.dataset.ch);
      const a = e.target.closest("[data-side]"); if (a) ({ ch: newChannel, dm: newDM, browse: browseChannels })[a.dataset.side]();
    });
    document.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSwitcher(); }
      // 日本語キーボードでは \ が ¥ キー・ろ キーになるので、物理キーでも受ける
      if ((e.ctrlKey || e.metaKey) && (e.key === "\\" || e.key === "¥" || ["Backslash", "IntlYen", "IntlRo"].includes(e.code))) { e.preventDefault(); this.toggleSide(); }
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const ids = $$(".side [data-ch]").map(b => +b.dataset.ch); if (!ids.length) return;
        const i = ids.indexOf(S.cur), n = e.key === "ArrowDown" ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length;
        this.openChannel(ids[i < 0 ? 0 : n]);
      }
    });
    on("channels", () => this.drawSide());
    on("presence", () => this.drawSide());
    on("users", () => { this.drawMe(); this.drawSide(); });
    // 接続できている間は何も出さない（問題があるときだけ知らせる）
    on("ws", ok => { const c = $(".conn"); c.hidden = ok; c.classList.toggle("off", !ok); });
    on("mail", () => this.mailBadge()); on("mail_read", () => this.mailBadge());
    window.addEventListener("focus", () => { if (S.cur && this.section === "chat") { const c = S.cache[S.cur]; const m = c && c.messages[c.messages.length - 1]; if (m) markRead(S.cur, m.id); } });
    this.drawMe(); this.drawSide(); this.mailBadge(); initNotifs(); owlInstallNudge();
    let last = {}; try { last = JSON.parse(localStorage.getItem("tsunagi_pc") || "{}"); } catch { }
    if (last.section === "chat" && S.channels.some(c => c.id === last.cid)) this.openChannel(last.cid); else this.go(last.section && last.section !== "chat" ? last.section : "home");
  },

  drawMe() { const b = $("[data-me]"); if (b) b.innerHTML = avatar(S.me, 38); },

  /** 通知: レールのベルの右側に一覧を開く（もう一度押すと閉じる） */
  openNotifs(bell) {
    if (_pop && _pop.classList.contains("nt-pop")) return closePop();
    const p = popover(bell, `<div class="nt-wrap"></div>`);
    p.classList.add("nt-pop");
    const r = bell.getBoundingClientRect();
    p.style.left = (r.right + 10) + "px"; p.style.top = "auto"; p.style.bottom = Math.max(8, innerHeight - r.bottom - 8) + "px";
    renderNotifPanel($(".nt-wrap", p));
  },

  async mailBadge() {
    try {
      const d = await api("/api/mail?box=inbox"); const n = d.items.filter(m => !m.read_by_me).length;
      const b = $('[data-go="mail"] .badge'); b.hidden = !n; b.textContent = n;
    } catch { }
  },

  toggleSide(force) {
    if (this.section === "repo" && $(".repo")) return repoToggleFold($(".repo"));   // リポジトリ画面では、フォルダ一覧の開閉
    const app = $(".app");
    const collapsed = force ?? !app.classList.contains("collapsed");
    app.classList.toggle("collapsed", collapsed);
    try { localStorage.setItem("tsunagi_side", collapsed ? "collapsed" : "open"); } catch { }
    $$("[data-sidetoggle]").forEach(b => b.setAttribute("aria-expanded", !collapsed));
  },

  drawSide() {
    const el = $(".side-scroll"); if (!el) return;
    $$("[data-filter]").forEach(b => { b.classList.toggle("on", this.filterUnread); b.setAttribute("aria-pressed", this.filterUnread); });
    const vis = c => !this.filterUnread || c.unread || c.id === S.cur;
    const sortName = (a, b) => chName(a).localeCompare(chName(b), "ja");
    const row = c => `<button class="ch${c.id === S.cur && this.section === "chat" ? " on" : ""}${c.unread && !c.muted ? " unread" : ""}" data-ch="${c.id}">${chIcon(c)}<span class="nm">${esc(chName(c))}</span>
      ${c.mentions ? `<span class="badge alert">${c.mentions}</span>` : c.unread && !c.muted ? `<span class="badge soft">${c.unread}</span>` : ""}</button>`;
    const starred = S.channels.filter(c => c.starred && vis(c)).sort(sortName);
    const chans = S.channels.filter(c => c.kind === "channel" && !c.starred && vis(c)).sort(sortName);
    const dms = S.channels.filter(c => c.kind === "dm" && !c.starred && vis(c)).sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));
    el.innerHTML = `
      ${starred.length ? `<div class="side-sec">スター</div>${starred.map(row).join("")}` : ""}
      <div class="side-sec">チャンネル<button data-side="ch" title="チャンネルを作る">${icon("plus")}</button></div>${chans.map(row).join("") || '<div class="side-more">未読はありません</div>'}
      ${S.joinable.length && !this.filterUnread ? `<button class="side-more" data-side="browse">＋ 他のチャンネル（${S.joinable.length}）</button>` : ""}
      <div class="side-sec">ダイレクトメッセージ<button data-side="dm" title="DM を始める">${icon("plus")}</button></div>${dms.map(row).join("") || '<div class="side-more">—</div>'}`;
    const total = S.channels.reduce((a, c) => a + (c.muted ? 0 : c.unread), 0);
    const b = $('[data-go="chat"] .badge'); if (b) { b.hidden = !total; b.textContent = total; }
  },

  save() { try { localStorage.setItem("tsunagi_pc", JSON.stringify({ section: this.section, cid: S.cur })); } catch { } },

  goto(kind) { this.go(kind); },
  openRepo(path) { repoState.current = path; repoState.q = ""; this.go("repo"); },

  go(section, arg) {
    if (section === "chat") {
      const target = S.cur || (S.channels.find(c => c.unread) || S.channels.find(c => c.kind === "channel") || {}).id;
      if (target) return this.openChannel(target);
    }
    this.section = section;
    if (S.screenOff) { S.screenOff(); S.screenOff = null; }
    if (S.chatOff) { S.chatOff(); S.chatOff = null; }
    S.cur = section === "chat" ? S.cur : null;
    $$(".rail-btn").forEach(b => b.classList.toggle("on", b.dataset.go === section));
    // メールとリポジトリは画面自体に一覧があるので、チャンネル一覧は一時的に隠す（保存した開閉設定は変えない）
    $(".app").classList.toggle("own-list", ["mail", "repo"].includes(section));
    const main = $("#main"); main.className = "main"; main.scrollTop = 0;
    const r = { home: renderHome, mail: el => renderMail(el), calendar: el => renderCalendar(el), shifts: el => renderShifts(el), people: renderPeople, files: el => renderFiles(el), tasks: el => renderTasks(el), repo: el => renderRepo(el), admin: renderAdmin }[section];
    r && r(main, arg);
    this.drawSide(); this.save();
  },

  openChannel(cid) {
    this.section = "chat";
    $(".app").classList.remove("own-list");
    if (S.screenOff) { S.screenOff(); S.screenOff = null; }
    $$(".rail-btn").forEach(b => b.classList.toggle("on", b.dataset.go === "chat"));
    const main = $("#main"); main.className = "main chat-mode";
    renderChat(main, cid).then(() => this.drawSide());
    S.cur = cid; this.drawSide(); this.save();
  },

  openMail(id) {
    mailState.sel = id; mailState.box = "inbox";
    if (this.section === "mail") { const d = $(".mail-detail"); if (d) return renderMailDetail(d, id); }
    this.go("mail");
  },

  chatHeader(head, ch, data) {
    const isCh = ch.kind === "channel";
    const members = data.member_ids;
    const dmUser = !isCh && members.length === 2 ? U(members.find(i => i !== S.me.id)) : null;
    head.innerHTML = `${chIcon(ch, 28)}<span class="ttl">${esc(isCh ? ch.name : chName(ch))}</span>
      <span class="topic">${isCh ? esc(ch.topic || "") : dmUser ? (S.online.has(dmUser.id) ? '<span style="color:var(--ok)">● オンライン</span>' : "オフライン") + (dmUser.status_text ? " · " + esc(dmUser.status_emoji + " " + dmUser.status_text) : "") : `${members.length} 人のグループ`}</span>
      <button class="btn ghost sm" data-info title="メンバー・設定"><span class="avatars">${members.slice(0, 3).map(i => avatar(U(i), 22, false)).join("")}</span> ${members.length}</button>
      <button class="btn ghost icon" data-taskall title="このチャンネルからタスク登録">${icon("task")}</button>
      <button class="btn claude sm" data-askclaude>${CLAUDE_MARK} 要約を Claude に</button>`;
    $("[data-info]", head).onclick = () => channelInfo({ ...ch, member_ids: members });
    $("[data-taskall]", head).onclick = () => taskFromText("", `${chName(ch)}`);
    $("[data-askclaude]", head).onclick = () => {
      const msgs = (S.cache[ch.id]?.messages || []).filter(m => !m.deleted).slice(-30).map(m => `${U(m.user_id).name}: ${m.body}`).join("\n");
      openClaude(`次のチャット（${chName(ch)}）を、決まったこと・未決事項・誰が何をするか に分けて要約してください。\n\n${msgs}`);
    };
  },

  messageSheet(m, ch, a) { emojiPicker(document.querySelector(`.msg[data-id="${m.id}"] .msg-main`), em => a.toggleReact(m.id, em)); },
};
