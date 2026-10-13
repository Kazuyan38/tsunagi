/* owl — メモ（自分のメモ・共有メモ）。本文は自動保存。画像・資料を添付できる。
 * 自分のメモは本人だけ、共有メモはチームの全員が読み書きできる（守っているのは DB の RLS。画面の絞り込みは表示の都合）。
 * 添付は note_files（メモが見える人にだけ見える）。実体は Storage の「<team>/notes/<乱数>.<拡張子>」。 */
"use strict";

const NOTES = { scope: "personal", q: "", list: [], cur: null, dirty: false, timer: null, saving: false, again: false, poll: null, el: null, ed: null, mobile: false, busy: 0 };
const NOTE_SEL = "id,team_id,owner_id,scope,title,body,pinned,created_at,updated_at,updated_by,note_files(id,note_id,name,mime,size,path,kind,uploader_id,created_at)";
const NOTE_MAX_FILES = 30;
const noteById = id => NOTES.list.find(n => n.id === id);
const noteLabel = n => (n.title || "").trim() || ((n.body || "").split("\n").find(l => l.trim()) || "").trim().slice(0, 40) || "無題のメモ";
const noteSnippet = n => {
  const lines = (n.body || "").split("\n").map(l => l.trim()).filter(Boolean);
  const skip = (n.title || "").trim() ? 0 : 1;   // タイトルが空なら、最初の行は見出し代わりに使っている
  return lines.slice(skip).join(" ").slice(0, 80);
};
const p2 = v => String(v).padStart(2, "0");
const noteWhen = iso => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()}`; };
const noteWhenFull = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const notesOf = scope => NOTES.list.filter(n => (scope === "shared" ? n.scope === "shared" : n.scope === "personal" && n.owner_id === S.me.id));

async function notesLoad() {
  NOTES.list = must(await SB.from("notes").select(NOTE_SEL).order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(500));
}

/* ---------------------------------------------------------------- 一覧 */
function notesDrawList() {
  const side = NOTES.el && $(".nt-side", NOTES.el); if (!side) return;
  const q = NOTES.q.trim().toLowerCase();
  const match = n => !q || (noteLabel(n) + " " + (n.body || "") + " " + n.note_files.map(f => f.name).join(" ")).toLowerCase().includes(q);
  const mine = notesOf("personal"), shared = notesOf("shared");
  $$(".nt-tabs [data-sc]", side).forEach(b => {
    b.classList.toggle("on", b.dataset.sc === NOTES.scope); b.setAttribute("aria-selected", b.dataset.sc === NOTES.scope);
    $("i", b).textContent = (b.dataset.sc === "shared" ? shared : mine).length || "";
  });
  const L = (NOTES.scope === "shared" ? shared : mine).filter(match);
  $(".nt-list", side).innerHTML = L.length ? L.map(n => `<button class="nt-row${n.id === NOTES.cur ? " on" : ""}" data-note="${n.id}">
      <div class="nt-t">${n.pinned ? icon("pin") : ""}<span>${esc(noteLabel(n))}</span></div>
      <div class="nt-s">${esc(noteSnippet(n)) || "&nbsp;"}</div>
      <div class="nt-m"><span>${noteWhen(n.updated_at)}</span>${n.scope === "shared" ? `<span>${esc(U(n.updated_by || n.owner_id).name)}</span>` : ""}${n.note_files.length ? `<span>${icon("clip")} ${n.note_files.length}</span>` : ""}</div></button>`).join("")
    : `<div class="empty">${q ? "見つかりませんでした" : NOTES.scope === "shared" ? "<b>共有メモはまだありません</b>チームの全員が読み書きできるメモです" : "<b>自分のメモはまだありません</b>本人だけが読み書きできるメモです"}</div>`;
}

/* ---------------------------------------------------------------- 画面 */
async function renderNotes(el, { mobile = false } = {}) {
  NOTES.el = el; NOTES.mobile = mobile; NOTES.cur = null; NOTES.dirty = false; NOTES.ed = null; NOTES.q = "";
  try { const s = localStorage.getItem("tsunagi_notes_scope"); if (s === "shared" || s === "personal") NOTES.scope = s; } catch { }
  el.innerHTML = `<div class="notes${mobile ? " is-mobile" : ""}">
    <section class="nt-side">
      <div class="nt-head"><h2>メモ</h2><button class="btn primary sm" data-new>${icon("plus")} 新しいメモ</button></div>
      <div class="nt-tabs" role="tablist"><button role="tab" data-sc="personal">自分のメモ<i></i></button><button role="tab" data-sc="shared">共有メモ<i></i></button></div>
      <div class="nt-search"><span class="ico-in">${icon("search")}</span><input class="input" type="search" placeholder="メモを探す" aria-label="メモを探す"></div>
      <div class="nt-list"><div class="empty">読み込み中…</div></div>
    </section>
    ${mobile ? "" : `<section class="nt-main"><div class="empty"><b>メモを選ぶか、新しいメモを作ります</b>自分のメモは本人だけ、共有メモはチームの全員が読み書きできます。画像や資料も添付できます</div></section>`}
  </div>`;
  const side = $(".nt-side", el);
  $("[data-new]", side).onclick = notesNew;
  $$(".nt-tabs [data-sc]", side).forEach(b => b.onclick = () => {
    NOTES.scope = b.dataset.sc; try { localStorage.setItem("tsunagi_notes_scope", NOTES.scope); } catch { }
    notesDrawList();
  });
  $(".nt-search input", side).oninput = e => { NOTES.q = e.target.value; notesDrawList(); };
  $(".nt-list", side).onclick = e => { const r = e.target.closest("[data-note]"); if (r) notesOpen(+r.dataset.note); };
  S.screenOff = () => { notesFlush(); clearInterval(NOTES.poll); NOTES.el = null; NOTES.ed = null; };   // PC: 別の画面へ移るとき
  try { await notesLoad(); } catch (e) { $(".nt-list", side).innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  notesDrawList();
  if (!mobile) { let last = 0; try { last = +localStorage.getItem("tsunagi_note") || 0; } catch { } const n = noteById(last); if (n) { NOTES.scope = n.scope === "shared" ? "shared" : "personal"; notesDrawList(); notesOpen(n.id); } }
  clearInterval(NOTES.poll);
  NOTES.poll = setInterval(() => { if (!NOTES.el || !NOTES.el.isConnected) return clearInterval(NOTES.poll); if (!document.hidden) notesRefresh(); }, 20000);
}

async function notesNew() {
  try {
    const n = must(await SB.from("notes").insert({ team_id: team(), owner_id: S.me.id, scope: NOTES.scope, title: "", body: "" }).select(NOTE_SEL).single());
    NOTES.list.unshift(n); notesDrawList(); notesOpen(n.id, true);
  } catch (e) { fail(e); }
}

/** メモを開く（PC は右の欄、スマホは重ねる画面） */
function notesOpen(id, focus = false) {
  const n = noteById(id); if (!n) return;
  notesFlush();
  NOTES.cur = id; try { localStorage.setItem("tsunagi_note", String(id)); } catch { }
  notesDrawList();
  if (NOTES.mobile) return UI.push(noteLabel(n), el => notesEditor(el, id, focus), { kind: "note" });
  notesEditor($(".nt-main", NOTES.el), id, focus);
}

/* ---------------------------------------------------------------- 編集 */
function notesEditor(el, id, focus) {
  const n = noteById(id); if (!n) { el.innerHTML = `<div class="empty"><b>このメモは見つかりません</b>削除されたか、見られなくなりました</div>`; return; }
  const owner = n.owner_id === S.me.id, canDel = owner || (n.scope === "shared" && S.me.role === "admin");
  NOTES.ed = el;
  el.innerHTML = `<div class="nt-ed" data-id="${id}">
    <div class="nt-bar"><span class="nt-scope ${n.scope}">${n.scope === "shared" ? "共有メモ（チームの全員が読み書き）" : "自分のメモ（あなただけ）"}</span><span class="small muted nt-state" data-state></span><span class="grow"></span>
      <button class="btn ghost icon sm" data-pin title="${n.pinned ? "ピン留めを外す" : "ピン留めする"}" aria-pressed="${n.pinned}">${icon("pin")}</button>
      ${owner ? `<button class="btn sm" data-scope>${n.scope === "shared" ? "自分のメモに戻す" : "共有メモにする"}</button>` : ""}
      ${canDel ? `<button class="btn ghost icon sm" data-del title="削除" aria-label="削除">${icon("trash")}</button>` : ""}</div>
    <div class="nt-conflict" hidden></div>
    <input class="nt-title" maxlength="200" placeholder="タイトル" aria-label="タイトル" value="${esc(n.title)}">
    <textarea class="nt-body" placeholder="ここに書きます。画像や資料は、貼り付け・ドラッグ・下の「添付」で追加できます" aria-label="本文">${esc(n.body)}</textarea>
    <div class="nt-atts-head"><button class="btn sm" data-attach>${icon("clip")} 添付</button><span class="small muted">画像・PDF・Office など（1 つ ${TSUNAGI.maxUploadMB}MB まで、${NOTE_MAX_FILES} 個まで）</span></div>
    <div class="nt-atts"></div>
    <div class="nt-foot small muted"></div>
    <input type="file" multiple hidden></div>`;
  const ed = $(".nt-ed", el), title = $(".nt-title", ed), body = $(".nt-body", ed);
  const grow = () => { body.style.height = "auto"; body.style.height = Math.max(220, body.scrollHeight + 4) + "px"; };
  grow(); notesFoot(n); notesAttDraw(n);
  const dirty = () => { NOTES.dirty = true; notesState("未保存"); clearTimeout(NOTES.timer); NOTES.timer = setTimeout(notesSave, 700); };
  title.oninput = dirty; body.oninput = () => { grow(); dirty(); };
  title.onblur = body.onblur = () => notesSave();
  title.onkeydown = e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); body.focus(); } };
  $("[data-pin]", ed).onclick = () => notesPatch(n, { pinned: !n.pinned }, () => notesOpenAgain(n.id));
  const sc = $("[data-scope]", ed);
  if (sc) sc.onclick = async () => {
    const toShared = n.scope !== "shared";
    if (toShared && !(await confirmBox("共有メモにすると、チームの全員がこのメモと添付を読み書きできます。", "共有する"))) return;
    await notesSave();
    notesPatch(n, { scope: toShared ? "shared" : "personal" }, () => { NOTES.scope = n.scope === "shared" ? "shared" : "personal"; notesDrawList(); notesOpenAgain(n.id); toast(toShared ? "共有メモにしました" : "自分のメモに戻しました"); });
  };
  const del = $("[data-del]", ed);
  if (del) del.onclick = () => notesDelete(n);
  // 添付: ボタン・貼り付け・ドラッグ
  const fileIn = $("input[type=file]", ed);
  $("[data-attach]", ed).onclick = () => fileIn.click();
  fileIn.onchange = () => { notesAttach(n, [...fileIn.files]); fileIn.value = ""; };
  body.addEventListener("paste", e => { const fs = [...(e.clipboardData ? e.clipboardData.files : [])]; if (fs.length) { e.preventDefault(); notesAttach(n, fs); } });
  ed.addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); ed.classList.add("drop"); } });
  ed.addEventListener("dragleave", e => { if (!ed.contains(e.relatedTarget)) ed.classList.remove("drop"); });
  ed.addEventListener("drop", e => { ed.classList.remove("drop"); const fs = [...(e.dataTransfer?.files || [])]; if (fs.length) { e.preventDefault(); notesAttach(n, fs); } });
  $(".nt-atts", ed).onclick = e => {
    const x = e.target.closest("[data-nfx]"); if (x) return notesDetach(n, +x.dataset.nfx);
    const a = e.target.closest("[data-nf]"); if (a) { const f = n.note_files.find(v => v.id === +a.dataset.nf); if (f) openViewer(f, n.note_files); }
  };
  if (focus) (n.title ? body : title).focus();
}
const notesOpenAgain = id => { if (NOTES.cur === id && NOTES.ed && NOTES.ed.isConnected) notesEditor(NOTES.ed, id, false); notesDrawList(); };
const notesState = t => { const s = NOTES.ed && $("[data-state]", NOTES.ed); if (s) s.textContent = t; };
function notesFoot(n) {
  const f = NOTES.ed && $(".nt-foot", NOTES.ed); if (!f) return;
  f.textContent = `作成 ${U(n.owner_id).name}（${noteWhenFull(n.created_at)}）${n.updated_by ? ` · 更新 ${U(n.updated_by).name}（${noteWhenFull(n.updated_at)}）` : ""}`;
}

/** 本文・タイトルの保存。同時に 2 回走らせず、他の人が先に更新していたら上書きせずに知らせる */
async function notesSave() {
  clearTimeout(NOTES.timer);
  if (!NOTES.dirty) return;
  if (NOTES.saving) { NOTES.again = true; return; }
  const n = noteById(NOTES.cur), ed = NOTES.ed && $(".nt-ed", NOTES.ed); if (!n || !ed || +ed.dataset.id !== n.id) { NOTES.dirty = false; return; }
  const patch = { title: $(".nt-title", ed).value, body: $(".nt-body", ed).value };
  NOTES.dirty = false; NOTES.saving = true; notesState("保存中…");
  try {
    const { data, error } = await SB.from("notes").update(patch).eq("id", n.id).eq("updated_at", n.updated_at).select(NOTE_SEL).maybeSingle();
    if (error) throw error;
    if (!data) { NOTES.saving = false; return notesConflict(n, patch); }
    Object.assign(n, data); notesState("保存しました"); notesFoot(n); notesDrawList();
  } catch (e) { NOTES.dirty = true; notesState("保存できませんでした"); fail(e); }
  NOTES.saving = false;
  if (NOTES.again || NOTES.dirty) { NOTES.again = false; NOTES.timer = setTimeout(notesSave, 300); }
}
function notesFlush() { clearTimeout(NOTES.timer); if (NOTES.dirty) notesSave(); }

/** 他の人が先に更新していた。自分の内容で上書きするか、最新を読み込むかを選んでもらう */
async function notesConflict(n, mine) {
  let latest = null;
  try { latest = (await SB.from("notes").select(NOTE_SEL).eq("id", n.id).maybeSingle()).data; } catch { }
  const bar = NOTES.ed && $(".nt-conflict", NOTES.ed);
  if (!latest) { notesState(""); toast("このメモは削除されたか、見られなくなりました", true); NOTES.list = NOTES.list.filter(x => x.id !== n.id); notesDrawList(); if (NOTES.ed) NOTES.ed.innerHTML = `<div class="empty"><b>このメモは見つかりません</b></div>`; return; }
  notesState("");
  if (!bar) return;
  bar.hidden = false;
  bar.innerHTML = `<b>${esc(U(latest.updated_by || latest.owner_id).name)} さんが先に更新しました。</b> どちらを残しますか？
    <span><button class="btn sm primary" data-ow>自分の内容で上書き</button> <button class="btn sm" data-ld>最新を読み込む（自分の編集は捨てる）</button></span>`;
  $("[data-ow]", bar).onclick = async () => {
    try {
      const { data, error } = await SB.from("notes").update(mine).eq("id", n.id).eq("updated_at", latest.updated_at).select(NOTE_SEL).maybeSingle();
      if (error) throw error; if (!data) return notesConflict(n, mine);
      Object.assign(n, data); bar.hidden = true; notesState("保存しました"); notesFoot(n); notesDrawList();
    } catch (e) { fail(e); }
  };
  $("[data-ld]", bar).onclick = () => { Object.assign(n, latest); NOTES.dirty = false; notesOpenAgain(n.id); };
}

async function notesPatch(n, patch, done) {
  try {
    const data = must(await SB.from("notes").update(patch).eq("id", n.id).select(NOTE_SEL).single());
    const keepTitle = n.title, keepBody = n.body; Object.assign(n, data);
    if (NOTES.dirty) { n.title = keepTitle; n.body = keepBody; }   // まだ保存していない編集は、画面の値を残す
    NOTES.list.sort((a, b) => (b.pinned - a.pinned) || (b.updated_at || "").localeCompare(a.updated_at || ""));
    done && done();
  } catch (e) { fail(e); }
}

async function notesDelete(n) {
  if (!(await confirmBox(`「${noteLabel(n)}」を削除しますか？${n.note_files.length ? `添付 ${n.note_files.length} 個も消えます。` : ""}元に戻せません。`, "削除", true))) return;
  const paths = n.note_files.map(f => f.path);
  try {
    // 実体は、添付の行が見えているうちに消す（行が消えたあとは権限を判定できず、消せない）。置いた人か管理者でなければ消せない分は残る（誰にも見えない）
    if (paths.length) await SB.storage.from("files").remove(paths).catch(() => { });
    must(await SB.from("notes").delete().eq("id", n.id));
    NOTES.list = NOTES.list.filter(x => x.id !== n.id); NOTES.dirty = false; NOTES.cur = null;
    try { localStorage.removeItem("tsunagi_note"); } catch { }
    notesDrawList(); toast("削除しました");
    if (NOTES.mobile) UI.pop && UI.pop(); else if (NOTES.ed) NOTES.ed.innerHTML = `<div class="empty"><b>削除しました</b></div>`;
  } catch (e) { fail(e); }
}

/* ---------------------------------------------------------------- 添付 */
function notesAttDraw(n) {
  const box = NOTES.ed && $(".nt-atts", NOTES.ed); if (!box) return;
  const can = f => f.uploader_id === S.me.id || n.owner_id === S.me.id || S.me.role === "admin";
  box.innerHTML = n.note_files.map(f => f.kind === "image"
    ? `<div class="nt-att img" data-nf="${f.id}" title="${esc(f.name)}"><img data-fsrc="${esc(f.path)}"${cachedSrc(f.path)} alt="${esc(f.name)}" loading="lazy">${can(f) ? `<button class="nt-x" data-nfx="${f.id}" aria-label="外す">×</button>` : ""}</div>`
    : `<div class="nt-att file" data-nf="${f.id}" title="${esc(f.name)}">${fileIcon(f)}<span class="nm">${esc(f.name)}</span><span class="sz">${fmtSize(f.size || 0)}</span>${can(f) ? `<button class="nt-x" data-nfx="${f.id}" aria-label="外す">×</button>` : ""}</div>`).join("")
    + (NOTES.busy ? `<div class="nt-att pend"><span class="nm">アップロード中…</span></div>` : "");
  hydrateFiles(box);
}

/** 添付を 1 つ上げる（Storage の実体 → note_files の行）。進み具合は onProgress(0〜1) */
function noteUpload(file, noteId, onProgress) {
  return new Promise(async (resolve, reject) => {
    const max = TSUNAGI.maxUploadMB * 1048576;
    if (file.size > max) return reject(new Error(`${file.name || "ファイル"} は大きすぎます（上限 ${TSUNAGI.maxUploadMB}MB）`));
    const { data: { session } } = await SB.auth.getSession();
    const name = safeName(file.name || `image-${Date.now()}.png`);
    const ext = ((name.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || (file.type.startsWith("image/") ? file.type.slice(6).replace(/[^a-z0-9]/gi, "").slice(0, 4) : "bin") || "bin").toLowerCase();
    const path = `${team()}/notes/${crypto.randomUUID()}.${ext}`;   // Storage のキーは ASCII だけ。元の名前は note_files.name に残す
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
        resolve(must(await SB.from("note_files").insert({ note_id: noteId, team_id: team(), name, mime: file.type || "", size: file.size, path, kind: guessKind(name), uploader_id: S.me.id }).select().single()));
      } catch (e) { SB.storage.from("files").remove([path]); reject(/row-level security/i.test(e.message || "") ? new Error(`添付は 1 つのメモに ${NOTE_MAX_FILES} 個までです`) : e); }
    };
    x.send(file);
  });
}
async function notesAttach(n, files) {
  for (const f of files) {
    if (n.note_files.length >= NOTE_MAX_FILES) { toast(`添付は 1 つのメモに ${NOTE_MAX_FILES} 個までです`, true); break; }
    NOTES.busy++; notesAttDraw(n);
    try { const row = await noteUpload(f, n.id, () => { }); if (!n.note_files.some(v => v.id === row.id)) n.note_files.push(row); }
    catch (e) { toast(e.message, true); }
    finally { NOTES.busy--; if (NOTES.cur === n.id) notesAttDraw(n); notesDrawList(); }
  }
}
async function notesDetach(n, fid) {
  const f = n.note_files.find(v => v.id === fid); if (!f) return;
  if (!(await confirmBox(`「${f.name}」を外しますか？`, "外す", true))) return;
  try {
    await SB.storage.from("files").remove([f.path]).catch(() => { });   // 行が見えているうちに実体を消す
    must(await SB.from("note_files").delete().eq("id", fid));
    n.note_files = n.note_files.filter(v => v.id !== fid);
    if (NOTES.cur === n.id) notesAttDraw(n); notesDrawList();
  } catch (e) { fail(e); }
}

/* ---------------------------------------------------------------- 他の人の更新を取り込む（20 秒おき） */
async function notesRefresh() {
  if (NOTES.saving) return;
  let rows; try { rows = must(await SB.from("notes").select(NOTE_SEL).order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(500)); } catch { return; }
  const cur = NOTES.cur, old = noteById(cur);
  NOTES.list = rows;
  const now = noteById(cur);
  if (cur && old && !now) { NOTES.cur = null; if (NOTES.ed && !NOTES.mobile) NOTES.ed.innerHTML = `<div class="empty"><b>このメモは削除されたか、見られなくなりました</b></div>`; }
  else if (now && old && now.updated_at !== old.updated_at && !NOTES.dirty) notesOpenAgain(cur);   // 手元に未保存の編集があるときは触らない（保存のときに知らせる）
  notesDrawList();
}
