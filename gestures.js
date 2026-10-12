/* つなぎ — スワイプ操作（タッチ端末のみ）。
 * 行スワイプ: 行を左右に払うと、背面に出た操作を実行する（メールを完了・タスクを完了・返信 など）
 * 前後スワイプ: 月・日・ファイルを左右に払って送る
 * シートを下に払って閉じる
 * 画面の左端 28px は「戻る」用に空けておく（m.js の push が使う）。
 * タッチの無い端末では touch イベントが来ないだけなので、常に登録して構わない。
 */
"use strict";

const SWIPE_TH = 76;          // これ以上払ったら実行
const EDGE = 28;
const buzz = () => { try { navigator.vibrate && navigator.vibrate(8); } catch { } };
const TONE = { ok: "#12a37f", accent: "#4b63e6", warn: "#d98a07", danger: "#dc4a4a", muted: "#8a91a3" };

/** 一度だけ次のクリックを握りつぶす（払った指を離した瞬間の誤タップ防止）。 */
function swallowClick(el) {
  const h = e => { e.preventDefault(); e.stopPropagation(); };
  el.addEventListener("click", h, { capture: true, once: true });
  setTimeout(() => el.removeEventListener("click", h, { capture: true }), 450);
}

/**
 * root 内の sel に一致する行を左右スワイプできるようにする。
 * actions(row) は { left, right } を返す。left = 左へ払う（右側に出る操作）。各操作は { label, icon, tone, run(row) }。
 * root を描き直しても、root 自体が残っていれば有効のまま（委譲）。
 */
function swipeRows(root, sel, actions) {
  root._swipeSels = root._swipeSels || new Set();
  if (root._swipeSels.has(sel)) return;      // 同じ root を描き直しても二重に付けない
  root._swipeSels.add(sel);
  let st = null;
  const reset = (row, under) => {
    row.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1)";
    row.style.transform = "";
    setTimeout(() => { row.classList.remove("swiping"); row.style.transition = ""; under && under.remove(); }, 230);
  };
  root.addEventListener("touchstart", e => {
    if (e.touches.length > 1) return;
    const row = e.target.closest(sel);
    if (!row || !root.contains(row) || e.target.closest("input,textarea,select,[data-noswipe]")) return;
    const t = e.touches[0];
    if (t.clientX < EDGE) return;
    st = { row, x: t.clientX, y: t.clientY, dx: 0, lock: null, acts: null, under: null, ready: false };
  }, { passive: true });
  root.addEventListener("touchmove", e => {
    if (!st) return;
    const t = e.touches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
    if (st.lock === null) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      st.lock = Math.abs(dx) > Math.abs(dy) * 1.3 ? "x" : "y";
      if (st.lock === "y") { st = null; return; }
      st.acts = actions(st.row) || {};
      const row = st.row;
      if (getComputedStyle(row.parentElement).position === "static") row.parentElement.style.position = "relative";
      const under = document.createElement("div");
      under.className = "swipe-under";
      Object.assign(under.style, { top: row.offsetTop + "px", left: row.offsetLeft + "px", width: row.offsetWidth + "px", height: row.offsetHeight + "px" });
      row.parentElement.insertBefore(under, row);
      row.classList.add("swiping");
      st.under = under;
    }
    if (st.lock !== "x") return;
    e.preventDefault();
    const act = dx < 0 ? st.acts.left : st.acts.right;
    const d = Math.max(-170, Math.min(170, act ? dx : dx * 0.18));   // 操作が無い向きはゴムのように少しだけ
    st.dx = d;
    st.row.style.transform = `translateX(${d}px)`;
    const ready = !!act && Math.abs(d) >= SWIPE_TH;
    if (ready !== st.ready) { st.ready = ready; if (ready) buzz(); }
    if (act) {
      st.under.style.background = TONE[act.tone || "accent"];
      st.under.style.justifyContent = d < 0 ? "flex-end" : "flex-start";
      st.under.innerHTML = `<span class="swipe-act${ready ? " ready" : ""}">${act.icon ? icon(act.icon) : ""}<b>${esc(act.label)}</b></span>`;
    } else st.under.style.background = "var(--bg-2)";
  }, { passive: false });
  const end = () => {
    if (!st) return;
    const s = st; st = null;
    if (s.lock !== "x") return;
    swallowClick(s.row);
    const act = s.dx < 0 ? s.acts.left : s.acts.right;
    if (act && Math.abs(s.dx) >= SWIPE_TH) {
      s.row.style.transition = "transform .12s ease-in";
      s.row.style.transform = `translateX(${s.dx < 0 ? -48 : 48}px)`;
      setTimeout(() => { reset(s.row, s.under); Promise.resolve(act.run(s.row)).catch(fail); }, 120);
    } else reset(s.row, s.under);
  };
  root.addEventListener("touchend", end);
  root.addEventListener("touchcancel", end);
}

/** 左右に払って前後へ送る（月・日・ファイル）。縦スクロールや行スワイプとはぶつからない。 */
function swipeNav(el, onPrev, onNext) {
  el.dataset.swipeNav = 1;
  let s = null;
  el.addEventListener("touchstart", e => {
    if (e.touches.length > 1 || e.target.closest("input,textarea,select,[data-noswipe],.tt-tabs,.mail-boxes,.day-strip,.sheet-tabs")) return;
    if (e.target.closest("[data-swipe-nav]") !== el) return;   // 内側の前後スワイプを優先
    const t = e.touches[0]; if (t.clientX < EDGE) return;
    s = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, { passive: true });
  el.addEventListener("touchend", e => {
    if (!s) return;
    const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, dt = Date.now() - s.t; s = null;
    if (e.target.closest(".swiping")) return;                  // 行スワイプの指はここで拾わない
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6 && dt < 600) {
      buzz();
      el.classList.remove("nav-in-l", "nav-in-r"); void el.offsetWidth;
      el.classList.add(dx < 0 ? "nav-in-r" : "nav-in-l");
      (dx < 0 ? onNext : onPrev)();
    }
  }, { passive: true });
}

/** モーダル（スマホではボトムシート）を下に払って閉じる。 */
function dragToClose(ov) {
  const sheet = ov.querySelector(".modal"); if (!sheet) return;
  let s = null;
  sheet.addEventListener("touchstart", e => {
    const t = e.touches[0], r = sheet.getBoundingClientRect();
    const body = sheet.querySelector(".modal-body");
    // つまみと見出しの帯か、本文が一番上までスクロールされているときだけ
    if (t.clientY - r.top > 64 && !(body && body.scrollTop <= 0 && e.target.closest(".modal-body"))) return;
    s = { y: t.clientY, dy: 0, fromBody: t.clientY - r.top > 64 };
  }, { passive: true });
  sheet.addEventListener("touchmove", e => {
    if (!s) return;
    const dy = e.touches[0].clientY - s.y;
    if (dy <= 0) { if (s.fromBody) s = null; return; }
    if (s.fromBody && dy < 12) return;
    e.preventDefault();
    s.dy = dy; sheet.style.transition = "none"; sheet.style.transform = `translateY(${dy}px)`;
    ov.style.background = `rgba(28,33,50,${Math.max(0, .32 - dy / 900)})`;
  }, { passive: false });
  sheet.addEventListener("touchend", () => {
    if (!s) return;
    const dy = s.dy; s = null;
    sheet.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1)";
    if (dy > 110) { sheet.style.transform = "translateY(100%)"; setTimeout(() => ov.close(), 200); }
    else { sheet.style.transform = ""; ov.style.background = ""; }
  });
}
