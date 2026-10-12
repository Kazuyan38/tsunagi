"use strict";
const TABS = [["home", "ホーム", "home"], ["chat", "チャット", "chat"], ["mail", "メール", "mail"], ["plan", "予定", "cal"], ["more", "その他", "more"]];
const TITLES = { home: "ホーム", chat: "チャット", mail: "共有メール", plan: "予定", more: "その他" };

const UI = {
  isMobile: true,
  tab: "home",
  planView: "calendar",
  chatFilter: "all",
  pushes: [],
  chatVisible() { return this.pushes.some(p => p.kind === "chat"); },

  start() {
    document.body.className = "";
    document.body.innerHTML = `<div class="m-app">
      <header class="m-head"><h1></h1>
        <button class="icon-btn bell-btn" data-bell aria-label="通知">${icon("bell")}<span class="badge alert" hidden></span></button>
        <button class="icon-btn" data-search aria-label="検索">${icon("search")}</button>
        <button class="claude-pill" data-claude aria-label="Claude を開く">${CLAUDE_MARK}Claude</button></header>
      <main class="m-main" id="main"></main>
      <nav class="m-tabs">${TABS.map(([k, l, i]) => `<button class="m-tab" data-tab="${k}">${icon(i)}<span>${l}</span><span class="badge" hidden></span></button>`).join("")}</nav></div>`;
    $(".m-head h1").before(owlBuddy(38));   // 見出しの左のフクロウ。押すと owl とのチャット
    document.addEventListener("click", e => {
      const t = e.target.closest(".m-tab[data-tab]"); if (t) return this.go(t.dataset.tab);
      if (e.target.closest("[data-claude]")) return openClaude();
      if (e.target.closest("[data-search]")) return openSwitcher();
      if (e.target.closest(".m-head [data-bell]")) return this.push("通知", el => renderNotifPanel(el, { mobile: true }));
    });
    window.addEventListener("popstate", () => { if (this.pushes.length) this.pop(true); });
    on("channels", () => { this.badges(); if (this.tab === "chat" && !this.pushes.length) this.drawChatList(); });
    on("presence", () => { if (this.tab === "chat" && !this.pushes.length) this.drawChatList(); });
    on("mail", () => this.badges()); on("mail_read", () => this.badges());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && S.cur && this.chatVisible()) { const c = S.cache[S.cur]; const m = c && c.messages[c.messages.length - 1]; if (m) markRead(S.cur, m.id); }
    });
    this.badges();
    this.gestures();
    initNotifs();
    let last = "home"; try { last = sessionStorage.getItem("tsunagi_tab") || "home"; } catch { }
    this.go(last);
  },

  /** スマホの払う操作: 下部タブの左右移動・引っ張って再読み込み・チャット一覧の行スワイプ。 */
  gestures() {
    const main = $("#main"), order = TABS.map(t => t[0]);
    main.dataset.swipeNav = 1;
    swipeNav(main, () => { const i = order.indexOf(this.tab); if (i > 0) this.go(order[i - 1]); },
      () => { const i = order.indexOf(this.tab); if (i < order.length - 1) this.go(order[i + 1]); });
    swipeRows(main, ".chat-list .li[data-ch]", row => {
      const ch = S.channels.find(c => c.id === +row.dataset.ch); if (!ch) return {};
      return {
        left: ch.unread ? { label: "既読にする", icon: "check", tone: "ok", run: () => readChannel(ch.id) } : null,
        right: { label: ch.starred ? "スターを外す" : "スター", icon: "star", tone: "warn", run: async () => {
          await api(`/api/channels/${ch.id}/star`, { method: "POST" }); await loadChannels(); toast(ch.starred ? "スターを外しました" : "スターを付けました"); } },
      };
    });
    // 一番上で下に引くと再読み込み
    const ptr = h(`<div class="ptr">${icon("dl")}<span>離すと更新</span></div>`);
    let p = null;
    main.addEventListener("touchstart", e => { if (main.scrollTop <= 0 && !e.target.closest("input,textarea,.swiping")) p = { y: e.touches[0].clientY, dy: 0 }; }, { passive: true });
    main.addEventListener("touchmove", e => {
      if (!p) return;
      p.dy = e.touches[0].clientY - p.y;
      if (p.dy <= 0 || main.scrollTop > 0) { p = null; ptr.style.height = "0"; return; }
      if (!ptr.isConnected) main.prepend(ptr);
      ptr.style.transition = "none"; ptr.style.height = Math.min(70, p.dy * 0.45) + "px";
      ptr.classList.toggle("ready", p.dy * 0.45 >= 56);
    }, { passive: true });
    main.addEventListener("touchend", async () => {
      if (!p) return;
      const go = p.dy * 0.45 >= 56; p = null;
      ptr.style.transition = ""; ptr.style.height = "0";
      if (go) { buzz(); await Promise.all([loadChannels(), loadUsers()]).catch(() => { }); this.go(this.tab); this.badges(); }
    });
  },

  async badges() {
    const n = S.channels.reduce((a, c) => a + (c.muted ? 0 : c.unread), 0);
    const b = $('[data-tab="chat"] .badge'); if (b) { b.hidden = !n; b.textContent = n; }
    try { const d = await api("/api/mail?box=inbox"); const m = d.items.filter(x => !x.read_by_me).length; const mb = $('[data-tab="mail"] .badge'); mb.hidden = !m; mb.textContent = m; } catch { }
  },

  openRepo(path) { repoState.q = ""; repoState.current = path; openRepoFile(path); },

  goto(kind) {
    if (kind === "calendar") { this.planView = "calendar"; return this.go("plan"); }
    if (kind === "shifts") { this.planView = "shifts"; return this.go("plan"); }
    if (kind === "tasks") return this.push("タスク", el => renderTasks(el));
    this.go(kind);
  },

  go(tab) {
    if (this.pushes.length) { this.pushes.forEach(p => p.el.remove()); this.pushes = []; S.cur = null; if (S.chatOff) { S.chatOff(); S.chatOff = null; } }
    if (S.screenOff) { S.screenOff(); S.screenOff = null; }
    this.tab = tab; try { sessionStorage.setItem("tsunagi_tab", tab); } catch { }
    $$(".m-tab").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
    $(".m-head h1").textContent = tab === "home" ? S.cfg.team : TITLES[tab];   // ホームは下のあいさつと重ねない
    const main = $("#main"); main.scrollTop = 0; main.onclick = null; main.innerHTML = "";
    $(".fab")?.remove();
    if (tab === "home") renderHome(main);
    if (tab === "chat") this.drawChatList();
    if (tab === "mail") renderMail(main, { mobile: true });
    if (tab === "plan") this.drawPlan();
    if (tab === "more") this.drawMore();
  },

  drawChatList() {
    const main = $("#main");
    const filt = c => this.chatFilter === "all" || c.unread;
    const sorted = [...S.channels].filter(filt).sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));
    const row = c => `<button class="li${c.unread ? " unread" : ""}" data-ch="${c.id}">${chIcon(c, 44)}
      <span class="grow" style="min-width:0"><div class="li-title ellipsis">${esc(chName(c))}</div><div class="li-sub">${esc((c.last_body || c.topic || "").replace(/\s+/g, " "))}</div></span>
      <span class="meta"><span class="small muted">${fmtRel(c.last_at)}</span>${c.mentions ? `<span class="badge alert">${c.mentions}</span>` : c.unread ? `<span class="badge">${c.unread}</span>` : ""}</span></button>`;
    const chans = sorted.filter(c => c.kind === "channel"), dms = sorted.filter(c => c.kind === "dm");
    main.innerHTML = `<div style="padding:0 16px 6px"><div class="seg"><button data-f="all" class="${this.chatFilter === "all" ? "on" : ""}">すべて</button><button data-f="unread" class="${this.chatFilter === "unread" ? "on" : ""}">未読だけ</button></div></div>
      <div class="chat-list">${chans.length ? `<div class="list-sec">チャンネル</div>${chans.map(row).join("")}` : ""}
      ${dms.length ? `<div class="list-sec">ダイレクトメッセージ</div>${dms.map(row).join("")}` : ""}
      ${!sorted.length ? `<div class="empty"><b>未読はありません</b></div>` : ""}
      ${S.joinable.length && this.chatFilter === "all" ? `<button class="li" data-browse style="color:var(--accent)">${icon("plus")} 他のチャンネルに参加（${S.joinable.length}）</button>` : ""}
      <div style="height:90px"></div></div>`;
    main.onclick = e => {
      const c = e.target.closest("[data-ch]"); if (c) return this.openChannel(+c.dataset.ch);
      const f = e.target.closest("[data-f]"); if (f) { this.chatFilter = f.dataset.f; return this.drawChatList(); }
      if (e.target.closest("[data-browse]")) return browseChannels();
    };
    if (!$(".fab")) {
      const fab = h(`<button class="fab" aria-label="新規">${icon("plus")}</button>`);
      fab.onclick = () => this.sheet("新しく始める", [[icon("chat"), "ダイレクトメッセージ", newDM], [icon("hash"), "チャンネルを作る", newChannel], [icon("search"), "チャンネルを探す", browseChannels]]);
      document.body.appendChild(fab);
    }
  },

  drawPlan() {
    const main = $("#main");
    main.innerHTML = `<div style="padding:0 16px 10px"><div class="seg" style="width:100%;display:grid;grid-template-columns:1fr 1fr"><button data-pv="calendar" class="${this.planView === "calendar" ? "on" : ""}">${"予定"}</button><button data-pv="shifts" class="${this.planView === "shifts" ? "on" : ""}">シフト</button></div></div><div class="plan-body"></div>`;
    $$("[data-pv]", main).forEach(b => b.onclick = () => { this.planView = b.dataset.pv; this.drawPlan(); });
    const body = $(".plan-body", main);
    this.planView === "calendar" ? renderCalendar(body, { mobile: true }) : renderShifts(body, { mobile: true });
  },

  drawMore() {
    const main = $("#main");
    const items = [["people", "連絡先", "チーム・社外の連絡先とプロフィール", () => this.push("連絡先", el => renderPeople(el))],
      ["file", "ファイル", "共有された資料をまとめて見る", () => this.push("ファイル", el => renderFiles(el, { mobile: true }))],
      ["book", "リポジトリ", "会社の資料をさがす・読む", () => this.push("リポジトリ", el => renderRepo(el, { mobile: true }))],
      ["task", "タスク", "チームのタスクと自分のタスクバスター", () => this.push("タスク", el => renderTasks(el))],
      ["user", "プロフィール", "表示名・状態・連絡先・パスワード", () => editProfile()],
      ...(S.me.role === "admin" ? [["info", "管理", "招待コード・メンバー・共有 Gmail・書き出し", () => this.push("管理", el => renderAdmin(el))]] : [])];
    main.innerHTML = `<div class="page"><div class="card" style="padding:16px;display:flex;gap:14px;align-items:center;margin-bottom:14px" data-me>${avatar(S.me, 52)}
      <div class="grow"><b style="font-size:17px">${esc(S.me.name)}</b><div class="small muted">${esc([S.me.title, S.me.dept].filter(Boolean).join(" · ") || "プロフィールを設定しましょう")}</div></div>${icon("chev")}</div>
      <div class="card list more-list" style="overflow:hidden">${items.map(([i, l, d], k) => `<button class="li" data-k="${k}">${icon(i)}<span class="grow"><div class="li-title">${l}</div><div class="li-sub">${d}</div></span>${icon("chev")}</button>`).join("")}</div>
      <button class="card" data-claude style="width:100%;margin-top:14px;padding:16px;display:flex;gap:12px;align-items:center;text-align:left;background:linear-gradient(145deg,#fdf6f1,#f9e6db);border-color:#f1d8c8;color:#b4532a">${CLAUDE_MARK}<span class="grow"><b>Claude を開く</b><div class="small" style="opacity:.8">文章作成・要約・相談はここから</div></span>${icon("share")}</button>
      <a class="btn" href="pc.html" style="width:100%;margin-top:14px">PC 版で開く</a>
      <button class="btn danger" data-out style="width:100%;margin-top:8px">${icon("logout")} ログアウト</button></div>`;
    main.onclick = e => {
      const k = e.target.closest("[data-k]"); if (k) return items[+k.dataset.k][3]();
      if (e.target.closest("[data-me]")) return showProfile(S.me.id);
      if (e.target.closest("[data-out]")) return signOut();
    };
  },

  /* ---- プッシュ遷移（右からスライド・端スワイプ / 戻るボタン / Android の戻るで閉じる） */
  push(title, render, { kind = "page", head } = {}) {
    const el = h(`<section class="m-push"><div class="p-head"><button class="icon-btn" data-back aria-label="戻る">${icon("back")}</button><div class="ttl ellipsis">${esc(title)}</div></div><div class="p-body"></div></section>`);
    document.body.appendChild(el);
    if (head) head($(".p-head", el));
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in")));
    $("[data-back]", el).onclick = () => history.back();
    let sx = null, dx = 0;
    el.addEventListener("touchstart", e => { const t = e.touches[0]; sx = t.clientX < 28 ? t.clientX : null; dx = 0; }, { passive: true });
    el.addEventListener("touchmove", e => { if (sx == null) return; dx = Math.max(0, e.touches[0].clientX - sx); el.style.transition = "none"; el.style.transform = `translateX(${dx}px)`; }, { passive: true });
    el.addEventListener("touchend", () => { if (sx == null) return; el.style.transition = ""; el.style.transform = ""; if (dx > 90) history.back(); sx = null; });
    this.pushes.push({ el, kind });
    history.pushState({ push: this.pushes.length }, "");
    render($(".p-body", el), el);
    return el;
  },
  pop() {
    const p = this.pushes.pop(); if (!p) return;
    if (p.kind === "chat") { S.cur = null; if (S.chatOff) { S.chatOff(); S.chatOff = null; } }
    p.el.classList.remove("in"); setTimeout(() => p.el.remove(), 300);
    if (!this.pushes.length) { if (S.screenOff) { S.screenOff(); S.screenOff = null; } const t = this.tab; if (t === "chat") this.drawChatList(); else if (t === "mail") renderMail($("#main"), { mobile: true }); else if (t === "home") renderHome($("#main")); else if (t === "plan") this.drawPlan(); }
  },

  openChannel(cid) {
    while (this.pushes.length && this.pushes[this.pushes.length - 1].kind === "chat") { const p = this.pushes.pop(); p.el.remove(); history.replaceState(null, ""); }
    const ch = S.channels.find(c => c.id === cid);
    this.push(ch ? chName(ch) : "", body => { body.style.overflow = "hidden"; renderChat(body, cid); }, { kind: "chat" });
  },

  openMail(id) {
    this.push("メール", body => renderMailDetail(body, id), { kind: "mail" });
  },

  chatHeader(_, ch, data) {
    const p = this.pushes.find(x => x.kind === "chat"); if (!p) return;
    const head = $(".p-head", p.el), members = data.member_ids, isCh = ch.kind === "channel";
    const other = !isCh && members.length === 2 ? U(members.find(i => i !== S.me.id)) : null;
    head.innerHTML = `<button class="icon-btn" data-back aria-label="戻る">${icon("back")}</button>${chIcon(ch, 32)}
      <div class="ttl" style="margin-left:6px"><div class="ellipsis">${esc(chName(ch))}</div><div class="sub ellipsis">${isCh ? `${members.length} 人${ch.topic ? " · " + esc(ch.topic) : ""}` : other ? (S.online.has(other.id) ? '<span style="color:var(--ok)">● オンライン</span>' : "オフライン") : `${members.length} 人`}</div></div>
      <button class="icon-btn" data-sum aria-label="Claude で要約" style="color:#c15f33">${CLAUDE_MARK}</button>
      <button class="icon-btn" data-info aria-label="情報">${icon("info")}</button>`;
    $("[data-back]", head).onclick = () => history.back();
    $("[data-info]", head).onclick = () => channelInfo({ ...ch, member_ids: members });
    $("[data-sum]", head).onclick = () => {
      const msgs = (S.cache[ch.id]?.messages || []).filter(m => !m.deleted).slice(-30).map(m => `${U(m.user_id).name}: ${m.body}`).join("\n");
      openClaude(`次のチャット（${chName(ch)}）を、決まったこと・未決事項・誰が何をするか に分けて要約してください。\n\n${msgs}`);
    };
  },

  sheet(title, actions, top = "") {
    const ov = modal(title, `${top}<div class="sheet-actions">${actions.map((a, i) => `<button data-i="${i}" class="${a[3] ? "danger" : ""}">${a[0]}${esc(a[1])}</button>`).join("")}</div>`);
    $(".modal-body", ov).addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) { ov.close(); actions[+b.dataset.i][2](); } });
    return ov;
  },

  messageSheet(m, ch, a) {
    navigator.vibrate && navigator.vibrate(10);
    const acts = [[icon("reply"), "返信", () => a.setReply(m)], [icon("task"), "タスクバスターに登録", () => taskFromText(m.body || "", `${chName(ch)} のメッセージ（${U(m.user_id).name}）`)],
      [CLAUDE_MARK, "Claude に相談", () => openClaude(`次のチャットメッセージについて相談させてください。\n\n「${m.body}」`)],
      ...a.msgMenuActions(m).map(x => [icon(x[0] === "削除" ? "trash" : x[0] === "編集" ? "edit" : x[0].startsWith("ピン") ? "pin" : "share"), x[0], x[1], x[2]])];
    const ov = this.sheet(`${U(m.user_id).name} のメッセージ`, acts, `<div class="emoji-row">${EMOJIS.slice(0, 7).map(e => `<button data-e="${e}">${e}</button>`).join("")}</div>`);
    $(".emoji-row", ov).onclick = e => { const b = e.target.closest("[data-e]"); if (b) { ov.close(); a.toggleReact(m.id, b.dataset.e); } };
  },
};
