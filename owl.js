/* owl — フクロウ（起動画面・どこからでも話しかけられる相棒・フクロウとのチャット）
 * フクロウの動きは 24 コマの首振りスプライト（img/owl_turn.webp）＋ CSS の浮遊・首かしげ・跳ねで作る。
 * 返事は OWL_AI.reply（Edge Function owl-ai 経由で Cloudflare Workers AI の gpt-oss）。会話はタブの中だけに残し、サーバに保存しない。 */
"use strict";

const OWL_SPLASH_MIN = 2800;   // 起動画面を最低これだけ見せる（ms）。一瞬で消えて落ち着かないのを防ぐ
const OWL_FRAMES = 24;
const owlReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 首振りスプライトを el に描く。ポインタ（スマホは傾き）を目で追い、何もしないときはゆっくり見回す。
 *  24 コマの隣り合う 2 枚を重ねて濃さを混ぜるので、首の動きがコマ送りにならない。 */
function owlSprite(el, { follow = true } = {}) {
  el.classList.add("owl-sprite", "still");
  el.style.backgroundImage = "url(img/owl_hero.webp)";
  if (owlReduced()) return;
  const sheet = new Image();
  sheet.onload = () => {
    el.classList.remove("still"); el.style.backgroundImage = `url(${sheet.src})`;
    const over = document.createElement("i");   // 次のコマを上に重ねる層
    over.className = "owl-sprite osp"; over.style.backgroundImage = `url(${sheet.src})`; over.setAttribute("aria-hidden", "true");
    el.appendChild(over);
    let target = 0.5, cur = 0.5, last = performance.now(), idle = 9, shown = -1;
    const set = x => { target = Math.min(1, Math.max(0, x)); idle = 0; };
    if (follow) {
      addEventListener("pointermove", e => {
        const r = el.getBoundingClientRect();   // 自分の位置から見た左右（遠いほど大きく首を振る）
        set(0.5 + (e.clientX - (r.left + r.width / 2)) / Math.max(320, innerWidth * 0.6));
      }, { passive: true });
      addEventListener("deviceorientation", e => e.gamma != null && set(0.5 + e.gamma / 60));
    }
    const seed = Math.random() * 6000;
    const tick = now => {
      if (!el.isConnected) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now; idle += dt;
      const goal = idle > 3 ? 0.5 + Math.sin((now + seed) / 2300) * 0.34 : target;
      cur += (goal - cur) * Math.min(1, dt * 5);
      if (Math.abs(cur - shown) > 0.0015) {   // 動いていないときは描き直さない
        shown = cur;
        const p = cur * (OWL_FRAMES - 1), i = Math.min(OWL_FRAMES - 2, Math.floor(p)), f = p - i;
        el.style.backgroundPosition = `${(i / (OWL_FRAMES - 1)) * 100}% 0`;
        over.style.backgroundPosition = `${((i + 1) / (OWL_FRAMES - 1)) * 100}% 0`; over.style.opacity = f.toFixed(3);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  sheet.src = "img/owl_turn.webp";
}

/** 押したときの小さな跳ね（押せたことが分かる） */
function owlHop(el) {
  el.classList.remove("hop"); void el.offsetWidth; el.classList.add("hop");
  el.addEventListener("animationend", () => el.classList.remove("hop"), { once: true });   // 跳ね終わったら浮遊に戻す
}

/* ---------- アプリとしてインストール（デスクトップ・ホーム画面に追加） ----------
 * Edge・Chrome は beforeinstallprompt で「追加」を呼べる。できない端末（Firefox・Safari など）には手順を案内する（.url ファイルの配布は、ブラウザが危険な種類として警告するのでしない）。 */
const OWL_INSTALL = { evt: null, started: false };
const OWL_NUDGE_KEY = "tsunagi_install_nudge";
addEventListener("beforeinstallprompt", e => { e.preventDefault(); OWL_INSTALL.evt = e; if (OWL_INSTALL.started) owlInstallNudge(); });
addEventListener("appinstalled", () => {
  OWL_INSTALL.evt = null; owlNudgeRemember(); const b = document.getElementById("owlInstallBar"); if (b) b.remove();
  if (typeof toast === "function") toast("インストールしました");
});
const owlStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const owlWhere = () => (UI.isMobile ? "ホーム画面" : "デスクトップ");
function owlNudgeRemember() { try { localStorage.setItem(OWL_NUDGE_KEY, String(Date.now())); } catch { } }

/** プロフィールに出す「アプリとして追加」の行。すでにアプリとして開いていれば何も出さない */
function owlInstallRow() {
  if (owlStandalone()) return "";
  const where = owlWhere();
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const win = /Windows/.test(navigator.userAgent) && !UI.isMobile;
  const how = OWL_INSTALL.evt ? `<button class="btn sm primary" data-install>${icon("dl")} ${where}に追加</button>`
    : ios ? `<span class="small muted">Safari の共有ボタン →「ホーム画面に追加」</span>`
    : `<span class="small muted">Edge・Chrome: メニュー →「アプリとしてインストール」${win ? "<br>それ以外のブラウザ: アドレス欄の左のアイコンをデスクトップへドラッグ" : ""}</span>`;
  return `<div class="install-row"><div><b>${where}にアプリとして置く</b><div class="small muted">タブを探さず、アイコンから開けます。通知も届きます。</div></div><div class="install-how">${how}</div></div>`;
}
async function owlInstall() {
  const e = OWL_INSTALL.evt; if (!e) return;
  e.prompt(); await e.userChoice.catch(() => { }); OWL_INSTALL.evt = null;
}
/** 本体の起動後に 1 回呼ぶ。追加できる状態のときだけ、画面の隅に小さな案内を出す（「あとで」なら 14 日出さない） */
function owlInstallNudge() {
  OWL_INSTALL.started = true;
  if (!OWL_INSTALL.evt || owlStandalone() || document.getElementById("owlInstallBar")) return;
  let t = 0; try { t = +localStorage.getItem(OWL_NUDGE_KEY) || 0; } catch { }
  if (Date.now() - t < 14 * 864e5) return;
  setTimeout(() => {
    if (!OWL_INSTALL.evt || document.getElementById("owlInstallBar")) return;
    const where = owlWhere();
    const bar = document.createElement("div");
    bar.id = "owlInstallBar"; bar.className = "install-bar" + (UI.isMobile ? " m" : ""); bar.setAttribute("role", "dialog"); bar.setAttribute("aria-label", "アプリとして追加");
    bar.innerHTML = `<img src="img/icon-192.png" alt="" width="40" height="40"><div class="ib-t"><b>owl を${where}に置く</b><span>アイコンから開けて、通知も届きます</span></div>
      <button class="btn primary sm" data-ibyes>追加する</button><button class="btn ghost sm" data-ibno>あとで</button>`;
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add("in"));
    bar.querySelector("[data-ibyes]").onclick = async () => { bar.remove(); await owlInstall(); owlNudgeRemember(); };
    bar.querySelector("[data-ibno]").onclick = () => { owlNudgeRemember(); bar.classList.remove("in"); setTimeout(() => bar.remove(), 250); };
  }, 5000);
}

/* ---------- 起動画面 ---------- */
const OWL_T0 = performance.now();
(function owlSplash() {
  // 起動中は JS が忙しいので、動きは JS に頼らず CSS（transform / opacity だけ）で作る。単一の画像＝首振りの読み込みも待たない
  const s = document.createElement("div");
  s.id = "owlSplash"; s.setAttribute("role", "status"); s.setAttribute("aria-label", "読み込み中");
  s.innerHTML = `<div class="os-stage"><div class="os-shadow"></div><div class="os-float"><img class="os-owl" src="img/owl_hero.webp" alt="" width="190" height="190" decoding="async"></div></div>
    <div class="os-name">owl</div><div class="os-bar" aria-hidden="true"><i></i></div>`;
  document.body.appendChild(s);
})();
/** 起動が終わったら呼ぶ（ログイン画面・アプリ本体・失敗のどれでも）。最低表示時間を待ってから消す */
const OWL_SPLASH = { node: document.getElementById("owlSplash"), gone: false };
function owlSplashDone() {
  const s = OWL_SPLASH.node; if (s.dataset.done) return;
  s.dataset.done = 1;
  setTimeout(() => { s.classList.add("out"); setTimeout(() => { OWL_SPLASH.gone = true; s.remove(); }, 500); }, Math.max(0, OWL_SPLASH_MIN - (performance.now() - OWL_T0)));
}
// ログイン画面・本体は body の中身を丸ごと差し替えるので、消し終わるまでは起動画面を前面に戻す
new MutationObserver(() => { if (!OWL_SPLASH.gone && !OWL_SPLASH.node.isConnected) document.body.appendChild(OWL_SPLASH.node); })
  .observe(document.body, { childList: true });

/* ---------- フクロウとのチャット ---------- */
const OWL_AI = {
  /** 返事を作る。history: [{ who: "me" | "owl", text }]。中身は Edge Function owl-ai（OpenAI の gpt-oss）。
   *  owl は必要に応じて自分でアプリ内を検索して答える（searched: 調べた先の名前）。会話の履歴には本文だけを送る */
  async reply(history) {
    const d = await fn("owl-ai", { action: "chat", messages: history.slice(-12).map(m => ({ who: m.who, text: m.text })) });
    if (d.configured === false) return { text: "ホー、まだ考える頭（AI）がつながっていないんだ。\n管理者が「管理」画面の「owl の AI」で設定すると、ここで相談に乗れるようになるよ。" };
    if (d.quota) return { text: "今日はたくさん話して、ちょっと疲れちゃった。ホー……\n毎朝 9 時に元気が戻るから、また話しかけてね。" };
    return { text: d.reply, searched: Array.isArray(d.searched) ? d.searched : [] };
  },
};
const OWL_GREET = "ホー。owl だよ。\n困ったこと・確認したいことがあったら、ここで話しかけてね。";
const owlLogKey = () => "tsunagi_owlchat_" + ((typeof S !== "undefined" && S.me && S.me.id) || "");
function owlLog() { try { return JSON.parse(sessionStorage.getItem(owlLogKey())) || []; } catch { return []; } }
function owlSave(L) { try { sessionStorage.setItem(owlLogKey(), JSON.stringify(L.slice(-60))); } catch { } }

/** フクロウとの会話を el に描く（PC は右の引き出し、スマホは全面の画面の中身） */
function renderOwlChat(el) {
  const L = owlLog();
  el.classList.add("owlchat");
  el.innerHTML = `<div class="oc-scroll"><div class="oc-hero"><div class="oc-owl owl-float"></div><b>owl</b><span>チームのフクロウ</span></div><div class="oc-list"></div></div>
    <form class="oc-form"><textarea class="input" rows="1" placeholder="owl に話しかける" aria-label="owl に話しかける"></textarea>
      <button class="btn primary" aria-label="送る">${icon("send")}</button></form>`;
  owlSprite($(".oc-owl", el));
  const list = $(".oc-list", el), scroll = $(".oc-scroll", el), ta = $("textarea", el), form = $(".oc-form", el);
  const bubble = (who, text, searched) => `<div class="oc-msg ${who}">${who === "owl" ? '<span class="oc-av"></span>' : ""}<div class="oc-b">${esc(text).replace(/\n/g, "<br>")}${searched && searched.length ? `<div class="oc-note">${icon("search")} 調べた先: ${searched.map(esc).join("・")}</div>` : ""}</div></div>`;
  const draw = () => {
    list.innerHTML = bubble("owl", OWL_GREET) + L.map(m => bubble(m.who, m.text, m.searched)).join("");
    scroll.scrollTop = scroll.scrollHeight;
  };
  draw();
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; };
  ta.addEventListener("input", grow);
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.onsubmit = async e => {
    e.preventDefault();
    const text = ta.value.trim(); if (!text || form.dataset.busy) return;
    ta.value = ""; grow(); form.dataset.busy = 1;
    L.push({ who: "me", text }); owlSave(L); draw();
    list.insertAdjacentHTML("beforeend", `<div class="oc-msg owl typing"><span class="oc-av"></span><div class="oc-b"><i></i><i></i><i></i><span class="oc-wait">調べています…</span></div></div>`);
    scroll.scrollTop = scroll.scrollHeight;
    let ans;
    try { ans = await OWL_AI.reply(L.slice()); } catch (e) { ans = { text: `ごめんね、いまは返事ができないみたい。
（${e.message}）` }; }
    L.push({ who: "owl", text: ans.text, searched: ans.searched }); owlSave(L); delete form.dataset.busy;
    if (el.isConnected) { draw(); ta.focus(); }
  };
  if (!UI.isMobile) setTimeout(() => ta.focus(), 60);
}

/** フクロウを押したとき。スマホは画面を重ね、PC は右から引き出す */
function openOwlChat(from) {
  if (from) owlHop(from);
  if (UI.isMobile) return UI.push("owl", el => renderOwlChat(el), { kind: "owl" });
  let d = document.getElementById("owlDrawer");
  if (d) { d.remove(); return; }   // もう一度押すと閉じる
  d = h(`<aside id="owlDrawer" class="owl-drawer" role="dialog" aria-label="owl とのチャット">
    <div class="od-head"><b>owl</b><button class="btn ghost icon" data-owlclose aria-label="閉じる">${icon("x")}</button></div><div class="od-body"></div></aside>`);
  document.body.appendChild(d);
  requestAnimationFrame(() => d.classList.add("in"));
  renderOwlChat($(".od-body", d));
  const close = () => { d.classList.remove("in"); setTimeout(() => d.remove(), 220); removeEventListener("keydown", esc_); };
  const esc_ = e => { if (e.key === "Escape") close(); };
  addEventListener("keydown", esc_);
  $("[data-owlclose]", d).onclick = close;
}

/** 本体の画面に置くフクロウ（PC は左の帯の一番上、スマホは見出しの左） */
function owlBuddy(size) {
  const b = h(`<button class="owl-buddy" data-owl title="owl に話しかける" aria-label="owl に話しかける" style="--s:${size}px"><span class="ob-owl owl-float"></span></button>`);
  owlSprite($(".ob-owl", b));
  b.onclick = () => openOwlChat($(".ob-owl", b));
  return b;
}
