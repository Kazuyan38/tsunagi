/* owl — GitHub リポジトリ画面（閲覧・キーワード検索）。
 * 中身の取得は Edge Function `repo` が行い、トークンはブラウザに来ない。
 * 検索は Supabase 上の索引（repo_docs）を RLS 付きで引く。
 */
"use strict";

const repoState = { q: "", open: new Set(), tree: null, status: null, current: null, indexing: false };
const TEXT_LIKE = new Set(["md", "txt", "csv", "tsv", "json", "yml", "yaml", "toml", "ini", "py", "js", "ts", "tsx", "jsx", "html", "css", "xml", "sql", "sh", "ps1", "bat", "log", "rst", "tex", "svg"]);
const extOfPath = p => ((p.split("/").pop().match(/\.([^.]+)$/) || [])[1] || "").toLowerCase();

async function repoCall(body) {
  const { data: { session } } = await SB.auth.getSession();
  const r = await fetch(`${TSUNAGI.url}/functions/v1/repo`, {
    method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, apikey: TSUNAGI.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (body.action === "file" && r.ok) return { blob: await r.blob(), type: r.headers.get("content-type") || "" };
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "リポジトリに接続できませんでした");
  return d;
}

/** ひらがな・カタカナの両方で強調できるよう、語の表記違いを作る。 */
function kanaVariants(t) {
  const kata = t.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
  const hira = t.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  return [...new Set([t, kata, hira])];
}
function highlightRe(q) {
  const terms = q.normalize("NFKC").split(/\s+/).filter(Boolean).flatMap(kanaVariants)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  return terms.length ? new RegExp(`(${terms.join("|")})`, "gi") : null;
}
const markText = (text, re) => re ? esc(text).replace(re, "<mark>$1</mark>") : esc(text);
/** 描画済みの要素の文字だけに <mark> を付ける（タグは壊さない）。 */
function markDom(root, re) {
  if (!re) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = []; let n;
  while ((n = walker.nextNode())) if (re.test(n.nodeValue)) hits.push(n), re.lastIndex = 0;
  for (const node of hits) {
    const span = document.createElement("span");
    span.innerHTML = esc(node.nodeValue).replace(re, "<mark>$1</mark>");
    node.replaceWith(...span.childNodes);
  }
  return root.querySelector("mark");
}

/* ---------------------------------------------------------------- Markdown（安全な最小実装） */
function renderMarkdown(md, basePath) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const dir = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/") + 1) : "";
  const inline = s => {
    const codes = [];
    s = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${c}</code>`); return `\u0000${codes.length - 1}\u0000`; });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
      const href = u.replace(/&amp;/g, "&");
      if (/^https?:\/\//.test(href)) return `<a href="${esc(href)}" target="_blank" rel="noopener">${t}</a>`;
      if (/^(mailto:|#)/.test(href)) return `<a href="${esc(href)}">${t}</a>`;
      // リポジトリ内の相対リンクはアプリ内で開く
      const parts = []; for (const seg of (dir + decodeURIComponent(href.split("#")[0])).split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
      return `<a href="#" data-repo-link="${esc(parts.join("/"))}">${t}</a>`;
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]」』）])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[i]);
  };
  let html = "", i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      html += `<pre class="md-code">${esc(buf.join("\n"))}</pre>`; i++; continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) { html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) { html += "<hr>"; i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim()));
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      html += `<div class="md-table"><table><thead><tr>${head.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      continue;
    }
    if (/^\s*>/.test(l)) {
      const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      html += `<blockquote>${buf.map(inline).join("<br>")}</blockquote>`; continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l), items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        items.push(`<li style="margin-left:${Math.min(4, Math.floor(m[1].length / 2)) * 18}px">${inline(m[3].replace(/^\[( |x)\]\s*/i, (_, x) => x.trim() ? "☑ " : "☐ "))}</li>`); i++;
      }
      html += ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`; continue;
    }
    if (!l.trim()) { i++; continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-*+]|\d+[.)])\s|\s*>|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
    html += `<p>${buf.map(inline).join("<br>")}</p>`;
  }
  return html;
}

/* ---------------------------------------------------------------- 画面 */
function buildTree(items) {
  const root = { dirs: new Map(), files: [] };
  for (const it of items) {
    const parts = it.path.split("/"); let node = root;
    for (let k = 0; k < parts.length - 1; k++) {
      if (!node.dirs.has(parts[k])) node.dirs.set(parts[k], { dirs: new Map(), files: [], path: parts.slice(0, k + 1).join("/") });
      node = node.dirs.get(parts[k]);
    }
    if (it.type === "file") node.files.push(it);
    else if (!node.dirs.has(parts.at(-1))) node.dirs.set(parts.at(-1), { dirs: new Map(), files: [], path: it.path });
  }
  return root;
}
function treeHTML(node, depth = 0) {
  const pad = d => `style="padding-left:${10 + d * 16}px"`;
  const sortJa = (a, b) => a.localeCompare(b, "ja", { numeric: true });
  let html = "";
  for (const [name, d] of [...node.dirs].sort(([a], [b]) => sortJa(a, b))) {
    const open = repoState.open.has(d.path);
    const count = (function n(x) { return x.files.length + [...x.dirs.values()].reduce((s, y) => s + n(y), 0); })(d);
    html += `<button class="rt-row rt-dir${open ? " open" : ""}" data-dir="${esc(d.path)}" ${pad(depth)}><span class="rt-caret">${icon("chev")}</span>${icon("file")}<span class="rt-name">${esc(name)}</span><span class="rt-count">${count}</span></button>`;
    if (open) html += treeHTML(d, depth + 1);
  }
  for (const f of node.files.sort((a, b) => sortJa(a.path, b.path))) {
    const name = f.path.split("/").pop();
    html += `<button class="rt-row rt-file${repoState.current === f.path ? " sel" : ""}" data-path="${esc(f.path)}" ${pad(depth)}>${fileIcon({ name, kind: guessKind(name) })}<span class="rt-name">${esc(name)}</span></button>`;
  }
  return html;
}

async function renderRepo(el, { mobile = false } = {}) {
  el.innerHTML = `<div class="repo${mobile ? " is-mobile" : ""}">
    <section class="repo-side">
      <div class="repo-head"><div class="grow" style="min-width:0"><div class="repo-name ellipsis">${icon("file")} <span>リポジトリ</span></div><div class="repo-sub small muted ellipsis"></div></div>
        <a class="btn ghost icon" data-gh target="_blank" rel="noopener" title="GitHub で開く" hidden>${icon("share")}</a></div>
      <div class="repo-search"><span class="ico-in">${icon("search")}</span><input class="input" type="search" placeholder="キーワードで検索（中身も探します）" value="${esc(repoState.q)}" aria-label="リポジトリを検索"></div>
      <div class="repo-list"><div class="empty">読み込み中…</div></div>
    </section>
    ${mobile ? "" : `<section class="repo-view"><div class="empty"><b>左の一覧からファイルを選ぶか、キーワードで探してください</b>Markdown・Word・Excel・PowerPoint・PDF・画像はこの画面で開けます</div></section>`}
  </div>`;
  const list = $(".repo-list", el), input = $(".repo-search input", el), sub = $(".repo-sub", el);
  const st = repoState.status = must(await SB.rpc("repo_status"));
  if (!st.configured) {
    list.innerHTML = `<div class="empty"><b>リポジトリはまだつながっていません</b>${S.me.role === "admin" ? "管理 → GitHub リポジトリ から設定できます" : "管理者が設定します"}</div>`;
    input.disabled = true; return;
  }
  const gh = $("[data-gh]", el); gh.hidden = false; gh.href = `https://github.com/${st.repo}`;
  $(".repo-name span", el).textContent = st.repo.split("/")[1];
  const showStatus = (extra = "") => {
    const s = repoState.status;
    sub.innerHTML = `${esc(s.repo)}${repoState.tree ? ` · ${esc(repoState.tree.branch)}` : ""} · ${extra || (s.indexed_at ? `検索の索引 ${s.docs} 件（本文 ${s.with_text} 件）` : "索引はまだありません")}`;
  };
  showStatus();

  const drawTree = () => {
    if (repoState.q) return;
    if (!repoState.tree) { list.innerHTML = `<div class="empty">読み込み中…</div>`; return; }
    list.innerHTML = `<div class="rt">${treeHTML(buildTree(repoState.tree.items))}</div>`;
  };
  const search = async () => {
    const q = repoState.q.trim();
    if (!q) return drawTree();
    const { data, error } = await SB.rpc("repo_search", { q, lim: 40 });
    if (q !== repoState.q.trim()) return;
    if (error) { list.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
    const re = highlightRe(q), full = data.filter(r => !r.related), rel = data.filter(r => r.related);
    const row = r => `<button class="rs-row${repoState.current === r.path ? " sel" : ""}" data-path="${esc(r.path)}">
      <div class="row" style="gap:8px">${fileIcon({ name: r.name, kind: guessKind(r.name) })}<div class="grow" style="min-width:0">
        <div class="rs-name ellipsis">${markText(r.name, re)}</div><div class="rs-path ellipsis">${markText(r.path.split("/").slice(0, -1).join(" / ") || "（トップ）", re)}</div></div>
        ${r.related ? `<span class="chip rs-tag">${r.matched}/${r.terms} 語</span>` : ""}</div>
      ${r.snippet ? `<div class="rs-snip">${markText(r.snippet, re)}</div>` : ""}</button>`;
    list.innerHTML = data.length ? `${full.length ? `<div class="rs-sec">一致 ${full.length} 件</div>${full.map(row).join("")}` : ""}
      ${rel.length ? `<div class="rs-sec">関連（一部の語・近い表記） ${rel.length} 件</div>${rel.map(row).join("")}` : ""}`
      : `<div class="empty"><b>見つかりませんでした</b>語を減らすか、別の言い方で探してください</div>`;
  };
  let qt;
  input.oninput = () => { repoState.q = input.value; clearTimeout(qt); qt = setTimeout(search, 220); };
  list.onclick = e => {
    const d = e.target.closest("[data-dir]");
    if (d) { repoState.open.has(d.dataset.dir) ? repoState.open.delete(d.dataset.dir) : repoState.open.add(d.dataset.dir); return drawTree(); }
    const f = e.target.closest("[data-path]");
    if (f) { repoState.current = f.dataset.path; $$(".sel", list).forEach(x => x.classList.remove("sel")); f.classList.add("sel"); openRepoFile(f.dataset.path, mobile ? null : $(".repo-view", el)); }
  };

  try { repoState.tree = await repoCall({ action: "tree" }); } catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  showStatus();
  repoState.q ? search() : drawTree();
  if (!mobile && repoState.current) openRepoFile(repoState.current, $(".repo-view", el));

  // 索引が無い・古い（30 分以上）・ファイル数が合わないときは、開いた人の画面で少しずつ更新する
  const stale = !st.indexed_at || Date.now() - new Date(st.indexed_at) > 30 * 60 * 1000 || st.docs !== repoState.tree.items.filter(x => x.type === "file").length;
  if (stale && !repoState.indexing) {
    repoState.indexing = true;
    try {
      for (let k = 0; k < 60; k++) {
        const r = await repoCall({ action: "reindex" });
        if (!document.body.contains(list)) break;
        showStatus(`検索の索引を更新中… ${r.total - r.remaining}/${r.total}`);
        if (!r.remaining) break;
      }
      repoState.status = must(await SB.rpc("repo_status")); if (document.body.contains(list)) { showStatus(); if (repoState.q) search(); }
    } catch (e) { showStatus(`索引の更新に失敗: ${esc(e.message)}`); }
    finally { repoState.indexing = false; }
  }
}

/** ファイルを開く。target が無ければ（スマホ）次の画面として開く。 */
async function openRepoFile(path, target) {
  if (!target) return UI.push(path.split("/").pop(), el => openRepoFile(path, el), { kind: "repo" });
  const name = path.split("/").pop(), ext = extOfPath(path), kind = guessKind(name);
  const st = repoState.status || {};
  const branch = repoState.tree ? repoState.tree.branch : "";
  target.innerHTML = `<div class="repo-file">
    <header class="rf-head"><div class="grow" style="min-width:0"><div class="rf-name ellipsis">${fileIcon({ name, kind })}<b>${esc(name)}</b></div>
      <div class="small muted ellipsis">${esc(path.split("/").slice(0, -1).join(" / ") || "トップ")}</div></div>
      <button class="btn sm claude" data-claude hidden>${CLAUDE_MARK}<span class="hide-m"> Claude に聞く</span></button>
      <button class="btn sm" data-share title="チャンネルに共有">${icon("share")}<span class="hide-m"> 共有</span></button>
      <a class="btn sm" data-ghfile target="_blank" rel="noopener" title="GitHub で開く">GitHub</a></header>
    <div class="rf-body viewer-stage center"><div class="empty">読み込み中…</div></div></div>`;
  $("[data-ghfile]", target).href = `https://github.com/${st.repo}/blob/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  $("[data-share]", target).onclick = () => pickChannel(`「${name}」を共有`, async cid => {
    await api(`/api/channels/${cid}/messages`, { method: "POST", body: { body: "", meta: { kind: "repo", path, name } } }).then(m => handleWS({ type: "message", message: m }));
    toast("共有しました");
  });
  const body = $(".rf-body", target);
  let file;
  try { file = await repoCall({ action: "file", path }); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const url = URL.createObjectURL(file.blob);
  const re = highlightRe(repoState.q);
  let plain = "";
  if (ext === "md") {
    plain = await file.blob.text();
    body.classList.remove("center");
    body.innerHTML = `<article class="doc-page md-body">${renderMarkdown(plain, path)}</article>`;
  } else if (TEXT_LIKE.has(ext) && !["csv", "tsv"].includes(ext)) {
    plain = await file.blob.text();
    body.classList.remove("center");
    body.innerHTML = `<pre class="code-view">${esc(plain)}</pre>`;
  } else if (kind === "image" && ext !== "svg") {
    body.innerHTML = `<img src="${url}" alt="${esc(name)}">`;
  } else if (kind === "pdf") {
    body.innerHTML = `<iframe src="${url}" title="${esc(name)}"></iframe>`;
  } else if (kind === "video" || kind === "audio") {
    body.innerHTML = kind === "video" ? `<video src="${url}" controls playsinline></video>` : `<audio src="${url}" controls style="width:min(520px,90%)"></audio>`;
  } else {
    const p = await previewBuffer(await file.blob.arrayBuffer(), { name, kind, mime: file.type });
    plain = paintPreview(body, p, { name, kind, size: file.blob.size }, url);
  }
  const first = markDom(body, re);
  if (first) setTimeout(() => first.scrollIntoView({ block: "center" }), 60);
  if (plain) {
    const b = $("[data-claude]", target); b.hidden = false;
    b.onclick = () => openClaude(`社内リポジトリの資料「${path}」です。要点をまとめてください。\n\n${plain.slice(0, 1500)}`);
  }
  body.onclick = e => {
    const a = e.target.closest("[data-repo-link]"); if (!a) return;
    e.preventDefault(); repoState.current = a.dataset.repoLink;
    UI.isMobile ? openRepoFile(a.dataset.repoLink) : openRepoFile(a.dataset.repoLink, target);
  };
}
