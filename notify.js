/* owl — 通知センター（ベル・一覧・既読）と、この端末への通知（Web Push）。PC / スマホ共通。
 * 通知はサーバ（DB トリガー・毎朝の期日チェック）だけが作る。ここでできるのは
 * 「自分の通知を読む・既読にする・種類ごとに止める・この端末で受け取るか決める」だけ（権限は RLS が守る）。 */
"use strict";

const NT = { unread: 0, items: [], loaded: false };
// 種類は 3 つだけ（覚えることを増やさない）
const NT_KIND = {
  chat: ["chat", "チャット", "DM と、あなた宛てのメンション"],
  task: ["task", "タスク・担当", "担当になったとき・期日の前日と当日・メールの担当"],
  schedule: ["cal", "予定・シフト", "新しい予定・日時の変更と、あなたのシフトの変更"],
};

/* ---------------------------------------------------------------- 読み込み・既読 */
async function loadNotifs() {
  const [list, cnt] = await Promise.all([
    SB.from("notifications").select("id,kind,title,body,link,count,created_at,read_at").order("created_at", { ascending: false }).limit(40),
    SB.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null)]);
  NT.items = must(list).map(n => ({ ...n, created_at: localISO(n.created_at) }));
  NT.unread = cnt.count || 0; NT.loaded = true;
  paintBells(); emit("notif_drawn");
}
let _ntT = 0;
const loadNotifsSoon = () => { clearTimeout(_ntT); _ntT = setTimeout(() => loadNotifs().catch(() => { }), 300); };

function paintBells() {
  for (const b of $$("[data-bell] .badge")) { b.hidden = !NT.unread; b.textContent = NT.unread > 99 ? "99+" : NT.unread; }
  for (const b of $$("[data-bell]")) b.setAttribute("aria-label", NT.unread ? `通知（未読 ${NT.unread} 件）` : "通知");
}

async function readNotif(id) {
  const n = NT.items.find(x => x.id === id);
  if (n && !n.read_at) { n.read_at = new Date().toISOString(); NT.unread = Math.max(0, NT.unread - 1); paintBells(); emit("notif_drawn"); }
  await SB.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
}
async function readAllNotifs() {
  NT.items.forEach(n => n.read_at ||= new Date().toISOString()); NT.unread = 0; paintBells(); emit("notif_drawn");
  must(await SB.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null));
}

/** 通知の行き先を開く。 */
function openNotifLink(l) {
  if (!l || !l.t) return;
  if (l.t === "ch") return UI.openChannel(l.id);
  if (l.t === "task") return openTeamTask(l.id).catch(() => toast("このタスクは見つかりませんでした", true));
  if (l.t === "mail") return UI.openMail(l.id);
  if (l.t === "event") return UI.goto("calendar");
  if (l.t === "shift") return UI.goto("shifts");
}
async function openNotif(n) {
  closePop();
  readNotif(n.id).catch(() => { });
  openNotifLink(n.link);
}
async function openNotifById(id) {
  const { data } = await SB.from("notifications").select("id,link,read_at").eq("id", id).maybeSingle();
  if (data) openNotif(data);
}

/* ---------------------------------------------------------------- 一覧（PC はポップオーバー、スマホは 1 画面） */
function renderNotifPanel(el, { mobile = false } = {}) {
  el.innerHTML = `<div class="nt${mobile ? " nt-m" : ""}">
    <div class="nt-head">${mobile ? "" : "<b>通知</b>"}<span class="grow"></span>
      <button class="btn ghost sm" data-allread>${icon("check")} すべて既読</button>
      <button class="btn ghost icon sm" data-ntset title="通知の設定" aria-label="通知の設定">${icon("gear")}</button></div>
    <div class="nt-push"></div>
    <div class="nt-list"><div class="muted small" style="padding:16px">読み込み中…</div></div></div>`;
  const draw = () => {
    const box = $(".nt-list", el); if (!box) return;
    $("[data-allread]", el).hidden = !NT.unread;
    box.innerHTML = NT.items.length ? NT.items.map(n => {
      const [ic] = NT_KIND[n.kind] || ["bell"];
      return `<button class="nt-item${n.read_at ? "" : " unread"}" data-n="${n.id}">
        <span class="nt-ico k-${esc(n.kind)}">${icon(ic)}</span>
        <span class="nt-main"><span class="nt-title">${esc(n.title)}${n.count > 1 ? `<span class="nt-count">${n.count} 件</span>` : ""}</span>
          <span class="nt-body">${esc(n.body)}</span></span>
        <span class="nt-time">${fmtRel(n.created_at)}</span></button>`;
    }).join("") : `<div class="empty"><b>通知はありません</b>DM・あなた宛てのメンション・担当・予定の変更がここに届きます</div>`;
  };
  draw();
  if (!NT.loaded) loadNotifs().catch(fail);
  const off = on("notif_drawn", () => { if (!el.isConnected) return off(); draw(); });
  el.onclick = async e => {
    const it = e.target.closest("[data-n]");
    if (it) { const n = NT.items.find(x => x.id === +it.dataset.n); if (n) openNotif(n); return; }
    if (e.target.closest("[data-allread]")) return readAllNotifs().catch(fail);
    if (e.target.closest("[data-ntset]")) return notifSettings();
    if (e.target.closest("[data-pushon]")) return pushOnFlow(() => drawPushBanner(el));
    if (e.target.closest("[data-pushlater]")) { try { localStorage.setItem("tsunagi_push_later", "1"); } catch { } return drawPushBanner(el); }
  };
  drawPushBanner(el);
}

/** この端末でまだ通知を受けていないときだけ、控えめな 1 行を出す。 */
async function drawPushBanner(el) {
  const box = $(".nt-push", el); if (!box) return;
  const st = await pushState();
  let later = false; try { later = !!localStorage.getItem("tsunagi_push_later"); } catch { }
  box.className = "nt-push";
  if (st === "off" && !later) {
    box.innerHTML = `<span class="grow">アプリを閉じていても、この端末に通知を出せます</span>
      <button class="btn sm ghost" data-pushlater>あとで</button><button class="btn sm primary" data-pushon>${icon("bell")} オンにする</button>`;
    box.classList.add("show");
  } else if (st === "ios") {
    box.innerHTML = `<span class="grow">${PUSH_IOS_HELP}</span>`; box.classList.add("show", "info");
  } else box.innerHTML = "";
}
const PUSH_IOS_HELP = "iPhone・iPad では、ホーム画面に追加した owl から通知を受け取れます（共有ボタン →「ホーム画面に追加」→ 追加したアイコンから開いて、ここでオンにする）";

/* ---------------------------------------------------------------- 設定 */
async function notifSettings() {
  const { data } = await SB.from("notify_prefs").select("chat,task,schedule").maybeSingle();
  const prefs = { chat: true, task: true, schedule: true, ...(data || {}) };
  const ov = modal("通知の設定", `<div class="nt-set">
    <div class="section-title">届ける通知</div>
    ${Object.entries(NT_KIND).map(([k, [ic, l, d]]) => `<label class="nt-row"><span class="nt-ico k-${k}">${icon(ic)}</span>
      <span class="grow"><b>${l}</b><span class="small muted">${d}</span></span>
      <input type="checkbox" class="switch" data-k="${k}"${prefs[k] ? " checked" : ""} aria-label="${l}"></label>`).join("")}
    <div class="section-title" style="margin-top:18px">この端末</div>
    <div class="nt-dev"></div></div>`);
  $$("[data-k]", ov).forEach(cb => cb.onchange = async () => {
    prefs[cb.dataset.k] = cb.checked;
    try { must(await SB.from("notify_prefs").upsert({ user_id: S.me.id, ...prefs, updated_at: new Date().toISOString() })); }
    catch (e) { cb.checked = !cb.checked; fail(e); }
  });
  const dev = $(".nt-dev", ov);
  const drawDev = async () => {
    const st = await pushState();
    const msg = { on: "この端末に通知が届きます", off: "この端末には通知を出していません（アプリを開いている間はベルに届きます）",
      denied: "ブラウザで通知がブロックされています。アドレスバーのサイト設定から「通知」を許可してください",
      ios: PUSH_IOS_HELP, none: "このブラウザは端末への通知に対応していません。アプリを開いている間はベルに届きます" }[st];
    dev.innerHTML = `<p class="small" style="margin:0 0 10px">${esc(msg)}</p>
      ${st === "on" ? `<div class="row"><button class="btn sm" data-test>テスト通知を送る</button><button class="btn sm ghost" data-off>この端末ではオフにする</button></div>` : ""}
      ${st === "off" ? `<button class="btn sm primary" data-on>${icon("bell")} この端末でオンにする</button>` : ""}`;
  };
  dev.onclick = async e => {
    if (e.target.closest("[data-on]")) return pushOnFlow(drawDev);
    if (e.target.closest("[data-off]")) { await pushOff().catch(fail); toast("この端末への通知をオフにしました"); return drawDev(); }
    if (e.target.closest("[data-test]")) {
      try { const r = await fn("push", { action: "test" }); toast(r.sent ? "テスト通知を送りました（アプリを閉じると表示されます）" : "送れませんでした。オフ→オンをやり直してください", !r.sent); }
      catch (er) { fail(er); }
    }
  };
  drawDev();
}

/* ---------------------------------------------------------------- Web Push */
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
/** on / off / denied / ios（ホーム画面に追加が必要）/ none（非対応） */
async function pushState() {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIOS() && !isStandalone()) return "ios";
  if (!supported || !TSUNAGI.vapidPublicKey) return "none";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    return sub && Notification.permission === "granted" ? "on" : "off";
  } catch { return "off"; }
}
const b64uBytes = s => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };

async function saveSub(sub) {
  const j = sub.toJSON();
  must(await SB.rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 200) }));
}
/** 利用者が押したときだけ呼ぶ（許可ダイアログはボタン操作の直後でないと Safari で出ない）。 */
async function pushOnFlow(after) {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error(perm === "denied" ? "通知がブロックされました。サイトの設定から許可できます" : "通知は許可されませんでした");
    const reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(TSUNAGI.vapidPublicKey) });
    await saveSub(sub);
    toast("この端末に通知が届くようになりました");
  } catch (e) { fail(e); }
  after && after();
}
async function pushOff() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration(); if (!reg) return;
  const sub = await reg.pushManager.getSubscription(); if (!sub) return;
  await SB.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

/* ---------------------------------------------------------------- 起動 */
function initNotifs() {
  on("notif", loadNotifsSoon);
  loadNotifs().catch(() => { });
  if ("serviceWorker" in navigator) {
    // 通知を押したとき、開いているタブがあればそこで開く（sw.js から届く）
    navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.type === "open-notif" && e.data.id) openNotifById(+e.data.id); });
    // すでに許可済みの端末は、購読を今のログインに結び直す（鍵の更新・別の人がログインし直した場合）
    pushState().then(async st => {
      if (st !== "on") return;
      const reg = await navigator.serviceWorker.register("sw.js");
      const sub = await reg.pushManager.getSubscription(); if (sub) await saveSub(sub);
    }).catch(() => { });
  }
  const m = location.hash.match(/^#n=(\d+)$/);
  if (m) { history.replaceState(null, "", location.pathname + location.search); openNotifById(+m[1]); }
}
