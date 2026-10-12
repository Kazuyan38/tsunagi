/* owl — フクロウ（起動画面・どこからでも話しかけられる相棒・フクロウとのチャット）
 * フクロウの動きは 24 コマの首振りスプライト（img/owl_turn.webp）＋ CSS の浮遊・首かしげ・跳ねで作る。
 * チャットの中身（AI）は未定。返事は OWL_AI.reply を差し替えれば変わる（いまは仮の返事）。 */
"use strict";

const OWL_SPLASH_MIN = 1800;   // 起動画面を最低これだけ見せる（ms）。一瞬で消えて落ち着かないのを防ぐ
const OWL_FRAMES = 24;
const owlReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 首振りスプライトを el に描く。ポインタ（スマホは傾き）を目で追い、何もしないときはゆっくり見回す。 */
function owlSprite(el, { follow = true } = {}) {
  el.classList.add("owl-sprite", "still");
  el.style.backgroundImage = "url(img/owl_hero.webp)";
  if (owlReduced()) return;
  const sheet = new Image();
  sheet.onload = () => {
    el.classList.remove("still"); el.style.backgroundImage = `url(${sheet.src})`;
    let target = 0.5, cur = 0.5, last = performance.now(), idle = 9;
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
      el.style.backgroundPosition = `${(Math.round(cur * (OWL_FRAMES - 1)) / (OWL_FRAMES - 1)) * 100}% 0`;
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

/* ---------- 起動画面 ---------- */
const OWL_T0 = performance.now();
(function owlSplash() {
  const s = document.createElement("div");
  s.id = "owlSplash"; s.setAttribute("role", "status"); s.setAttribute("aria-label", "読み込み中");
  s.innerHTML = `<div class="os-stage"><div class="owl-shadow"></div><div class="os-owl owl-float"></div></div>
    <div class="os-name">owl</div><div class="os-dots" aria-hidden="true"><i></i><i></i><i></i></div>`;
  document.body.appendChild(s);
  owlSprite(s.querySelector(".os-owl"));
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
  /** 返事を作る。history: [{ who: "me" | "owl", text }]。AI の中身が決まったらここを差し替える */
  async reply(history) {
    await new Promise(r => setTimeout(r, 650 + Math.random() * 500));
    const last = history[history.length - 1].text;
    return `「${last.length > 40 ? last.slice(0, 40) + "…" : last}」だね。ホー、ちゃんと聞いたよ。\nまだ考える頭（AI）を準備しているところなんだ。決まったら、ここで相談に乗れるようになるよ。`;
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
  const bubble = (who, text) => `<div class="oc-msg ${who}">${who === "owl" ? '<span class="oc-av"></span>' : ""}<div class="oc-b">${esc(text).replace(/\n/g, "<br>")}</div></div>`;
  const draw = () => {
    list.innerHTML = bubble("owl", OWL_GREET) + L.map(m => bubble(m.who, m.text)).join("");
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
    list.insertAdjacentHTML("beforeend", `<div class="oc-msg owl typing"><span class="oc-av"></span><div class="oc-b"><i></i><i></i><i></i></div></div>`);
    scroll.scrollTop = scroll.scrollHeight;
    let ans;
    try { ans = await OWL_AI.reply(L.slice()); } catch { ans = "ごめんね、いまは返事ができないみたい。少しあとでもう一度話しかけてね。"; }
    L.push({ who: "owl", text: ans }); owlSave(L); delete form.dataset.busy;
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
