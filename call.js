/* owl — 音声通話（WebRTC のメッシュ型・最大 5 人）
 * 音声はブラウザ同士の直接通信で、サーバを通らない。接続の手順（着信・応答・offer/answer/ICE）だけを
 * call_signals 表（migrations/019）で運ぶ。表は RLS で「同じチャンネルのメンバー同士」「宛先本人だけが読める」。
 * 中継（TURN）は使わない＝無料。STUN（stun.cloudflare.com）で届かない厳しいネットワーク同士は繋がらない。
 * 2 人が同時に offer を出さないよう、offer を出すのは「uid の大きい側」と決めている。 */
const CALL_MAX = 5;
const CALL_RING_MS = 45000;
const CALL_ICE = [{ urls: "stun:stun.cloudflare.com:3478" }];

const OwlCall = (() => {
  let cur = null;                 // 参加中の通話 { id, cid, peers: Map, stream, muted, t0, state, ids }
  const ringing = new Map();      // 着信中 call_id -> { cid, from, ids, accepted:Set, timer }
  let started = false, recoveringRings = false, ringRecovery = null, deferredRingDeletes = new Set(), ui = null, tick = null;

  const send = async (cid, callId, toIds, kind, payload = {}) => {
    const rows = toIds.filter(id => id !== S.me.id).map(to => ({ channel_id: cid, call_id: callId, to_user: to, kind, payload }));
    if (!rows.length) return;
    const { error } = await SB.from("call_signals").insert(rows);
    if (error) console.warn("call signal", kind, error.message);
  };

  /* ---------------- 画面 ---------------- */
  // UI.start() が画面を描き直すと置き場が切り離されるので、切れていたら作り直してクリックも付け直す
  const mount = () => {
    if (ui && ui.isConnected) return ui;
    ui = h('<div class="call-wrap" aria-live="polite"></div>');
    document.body.appendChild(ui);
    ui.addEventListener("click", onClick);
    return ui;
  };
  const draw = () => {
    const w = mount();
    const cards = [];
    for (const [id, r] of ringing) {
      const ch = S.channels.find(c => c.id === r.cid);
      const who = U(r.from);
      cards.push(`<div class="call-card ring" data-ring="${id}">
        ${avatar(who, 40, false)}
        <div class="grow"><div class="call-ttl">${esc(who.name)} から着信</div><div class="call-sub">${esc(ch ? chName(ch) : "")}</div></div>
        <button class="btn danger" data-decline="${id}">拒否</button><button class="btn call-ok" data-accept="${id}">${icon("phone")} 応答</button></div>`);
    }
    if (cur) {
      const ch = S.channels.find(c => c.id === cur.cid);
      const people = [...cur.peers.entries()].map(([uid, p]) => `<span class="call-p${p.speaking ? " on" : ""}" title="${esc(U(uid).name)}">${avatar(U(uid), 30, false)}${p.state === "connected" ? "" : '<i class="call-dot"></i>'}</span>`).join("");
      const label = cur.state === "calling" ? "呼び出し中…" : fmtDur(Date.now() - cur.t0);
      cards.push(`<div class="call-card live">
        <div class="call-p${cur.speaking ? " on" : ""}">${avatar(S.me, 30, false)}</div>${people}
        <div class="grow"><div class="call-ttl">${esc(ch ? chName(ch) : "通話")}</div><div class="call-sub" data-dur>${label}</div></div>
        <button class="btn ghost" data-mute>${cur.muted ? "ミュート解除" : "ミュート"}</button>
        <button class="btn danger" data-hang>${icon("phone")} 終了</button></div>`);
    }
    w.innerHTML = cards.join("");
    w.classList.toggle("on", cards.length > 0);
  };
  const fmtDur = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  const onClick = e => {
    const a = e.target.closest("[data-accept]"), d = e.target.closest("[data-decline]");
    if (a) return accept(a.dataset.accept).catch(fail);
    if (d) return decline(d.dataset.decline);
    if (e.target.closest("[data-hang]")) return hangup();
    if (e.target.closest("[data-mute]") && cur) {
      cur.muted = !cur.muted; cur.stream.getAudioTracks().forEach(t => { t.enabled = !cur.muted; }); draw();
    }
  };

  /* ---------------- 音の準備 ---------------- */
  const getMic = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("このブラウザでは通話を使えません（HTTPS のページで開いてください）");
    try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
    catch (e) { throw new Error("マイクを使えません。ブラウザのマイクの許可を確認してください"); }
  };
  /** 話している人の印。AudioContext の音量を 150ms ごとに見るだけ（音は加工しない） */
  const watch = (stream, set) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)(); const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 256; src.connect(an); const buf = new Uint8Array(an.frequencyBinCount);
      const iv = setInterval(() => { an.getByteFrequencyData(buf); let s = 0; for (const v of buf) s += v; const on = s / buf.length > 14; set(on); }, 150);
      return () => { clearInterval(iv); ctx.close().catch(() => {}); };
    } catch { return () => {}; }
  };

  /* ---------------- 接続 ---------------- */
  const peerOf = uid => {
    let p = cur.peers.get(uid); if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: CALL_ICE });
    p = { pc, state: "new", queue: [], hasRemote: false, audio: null, stop: null, speaking: false, timer: null };
    cur.peers.set(uid, p);
    cur.stream.getTracks().forEach(t => pc.addTrack(t, cur.stream));
    pc.onicecandidate = e => { if (e.candidate && cur) send(cur.cid, cur.id, [uid], "ice", { c: e.candidate.toJSON() }); };
    pc.ontrack = e => {
      const a = new Audio(); a.autoplay = true; a.srcObject = e.streams[0]; a.play().catch(() => {});
      p.audio = a; p.stop = watch(e.streams[0], on => { if (p.speaking !== on) { p.speaking = on; draw(); } });
    };
    pc.onconnectionstatechange = () => {
      p.state = pc.connectionState;
      if (pc.connectionState === "connected") { clearTimeout(p.timer); if (cur && cur.state === "calling") { cur.state = "live"; cur.t0 = Date.now(); } }
      if (pc.connectionState === "failed") { toast(`${U(uid).name} さんと繋がりませんでした（ネットワークの制限の可能性）`, true); dropPeer(uid); }
      if (pc.connectionState === "disconnected") p.timer = setTimeout(() => { if (cur && cur.peers.get(uid) === p && pc.connectionState !== "connected") dropPeer(uid); }, 8000);
      draw();
    };
    return p;
  };
  const dropPeer = uid => {
    if (!cur) return; const p = cur.peers.get(uid); if (!p) return;
    clearTimeout(p.timer); p.stop && p.stop(); p.audio && (p.audio.srcObject = null); try { p.pc.close(); } catch {}
    cur.peers.delete(uid);
    if (!cur.peers.size && cur.state === "live") end("通話が終わりました");
    else draw();
  };
  const offerTo = async uid => {
    const p = peerOf(uid);
    const o = await p.pc.createOffer(); await p.pc.setLocalDescription(o);
    send(cur.cid, cur.id, [uid], "offer", { sdp: p.pc.localDescription.sdp });
  };
  const flush = async p => { p.hasRemote = true; for (const c of p.queue.splice(0)) { try { await p.pc.addIceCandidate(c); } catch {} } };

  /* ---------------- 発信・応答・終了 ---------------- */
  const start = async cid => {
    if (cur) return toast("すでに通話中です", true);
    const ch = S.channels.find(c => c.id === cid), cache = S.cache[cid];
    const members = ((cache && cache.member_ids) || []).filter(x => x !== S.me.id);
    if (!members.length) return toast("通話する相手がいません", true);
    if (members.length + 1 > CALL_MAX) return toast(`通話は ${CALL_MAX} 人までです（このチャンネルは ${members.length + 1} 人）`, true);
    const stream = await getMic();
    const id = crypto.randomUUID(), ids = [S.me.id, ...members];
    cur = { id, cid, peers: new Map(), stream, muted: false, t0: Date.now(), state: "calling", ids, accepted: new Set(), speaking: false };
    cur.stopSelf = watch(stream, on => { if (cur && cur.speaking !== on) { cur.speaking = on; draw(); } });
    startTick();
    await send(cid, id, members, "ring", { ids });
    cur.ringTimer = setTimeout(() => { if (cur && cur.id === id && cur.state === "calling") end("応答がありませんでした"); }, CALL_RING_MS);
    draw();
  };
  const accept = async id => {
    const r = ringing.get(id); if (!r) return;
    if (cur) { toast("すでに通話中です", true); return; }
    const stream = await getMic().catch(e => { decline(id); throw e; });
    clearTimeout(r.timer); ringing.delete(id);
    cur = { id, cid: r.cid, peers: new Map(), stream, muted: false, t0: Date.now(), state: "calling", ids: r.ids, accepted: new Set(r.accepted), speaking: false };
    cur.stopSelf = watch(stream, on => { if (cur && cur.speaking !== on) { cur.speaking = on; draw(); } });
    startTick();
    await send(r.cid, id, r.ids, "accept");
    // 2 人通話では、UID の大きい側が offer を作る。着信側が大きい場合は
    // 発信者を明示的に offer 対象にしないと、両者とも offer を送らず止まる。
    if (S.me.id > r.from) await offerTo(r.from);
    for (const uid of cur.accepted) if (S.me.id > uid) await offerTo(uid);   // 先に応答していた人へ。offer を出すのは uid の大きい側
    draw();
  };
  const decline = (id, busy) => {
    const r = ringing.get(id); if (!r) return;
    clearTimeout(r.timer); ringing.delete(id);
    send(r.cid, id, [r.from], "decline", busy ? { busy: true } : {}); draw();
  };
  const hangup = () => { if (cur) end(); };
  const end = msg => {
    if (!cur) return; const c = cur; cur = null;
    clearTimeout(c.ringTimer); c.stopSelf && c.stopSelf(); clearInterval(tick); tick = null;
    for (const [uid, p] of c.peers) { clearTimeout(p.timer); p.stop && p.stop(); p.audio && (p.audio.srcObject = null); try { p.pc.close(); } catch {} }
    c.stream.getTracks().forEach(t => t.stop());
    send(c.cid, c.id, c.ids, "leave");
    if (msg) toast(msg); draw();
  };
  const startTick = () => { clearInterval(tick); tick = setInterval(() => { const d = $("[data-dur]", mount()); if (d && cur && cur.state === "live") d.textContent = fmtDur(Date.now() - cur.t0); }, 1000); };

  /* ---------------- 受信 ---------------- */
  const onSignal = async row => {
    // 起動時の回収が終わるまでは ring を消さない。push から開いた場合でも
    // Realtime と catch-up query の競合で着信カードが失われないようにする。
    if (row.kind === "ring" && recoveringRings) deferredRingDeletes.add(row.id);
    else SB.from("call_signals").delete().eq("id", row.id).then(() => {}, () => {});
    if (Date.now() - new Date(row.created_at).getTime() > 90000) return;       // 古い手順は無視
    const { call_id: id, from_user: from, kind, payload: pl = {} } = row;
    if (kind === "ring") {
      if (cur || ringing.has(id)) { if (!ringing.has(id)) send(row.channel_id, id, [from], "decline", { busy: true }); return; }
      const timer = setTimeout(() => { ringing.delete(id); draw(); }, CALL_RING_MS);
      ringing.set(id, { cid: row.channel_id, from, ids: pl.ids || [from, S.me.id], accepted: new Set(), timer });
      try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {}
      return draw();
    }
    const r = ringing.get(id);
    if (kind === "accept") {
      if (r) { r.accepted.add(from); return; }
      if (!cur || cur.id !== id) return;
      cur.accepted.add(from); clearTimeout(cur.ringTimer);
      if (S.me.id > from) await offerTo(from);
      return draw();
    }
    if (kind === "decline") {
      if (!cur || cur.id !== id) return;
      (cur.declined ||= new Set()).add(from);
      if (pl.busy) toast(`${U(from).name} さんは通話中です`);
      if (cur.state === "calling" && !cur.peers.size && cur.ids.every(x => x === S.me.id || cur.declined.has(x))) end("相手が出られませんでした");
      return;
    }
    if (kind === "leave") {
      if (r && r.from === from) { clearTimeout(r.timer); ringing.delete(id); toast("着信が終わりました"); return draw(); }
      if (r) { r.accepted.delete(from); return; }
      if (cur && cur.id === id) dropPeer(from);
      return;
    }
    if (!cur || cur.id !== id) return;
    if (kind === "offer") {
      const p = peerOf(from);
      await p.pc.setRemoteDescription({ type: "offer", sdp: pl.sdp }); await flush(p);
      const a = await p.pc.createAnswer(); await p.pc.setLocalDescription(a);
      return send(cur.cid, id, [from], "answer", { sdp: p.pc.localDescription.sdp });
    }
    if (kind === "answer") {
      const p = cur.peers.get(from); if (!p || p.pc.signalingState !== "have-local-offer") return;
      await p.pc.setRemoteDescription({ type: "answer", sdp: pl.sdp }); return flush(p);
    }
    if (kind === "ice" && pl.c) {
      const p = peerOf(from);
      if (p.hasRemote) { try { await p.pc.addIceCandidate(pl.c); } catch {} } else p.queue.push(pl.c);
    }
  };

  /* ---------------- 起動 ---------------- */
  const recoverRings = async () => {
    if (!S.me) return;
    if (ringRecovery) return ringRecovery;
    recoveringRings = true;
    ringRecovery = (async () => {
      try {
        // call_signals の RLS でも宛先本人だけ読める。期限内の未処理 ring だけを復元。
        const since = new Date(Date.now() - 90000).toISOString();
        const { data, error } = await SB.from("call_signals")
          .select("id, channel_id, call_id, from_user, to_user, kind, payload, created_at")
          .eq("kind", "ring").gte("created_at", since).order("id").limit(20);
        if (error) throw error;
        for (const row of data || []) await onSignal(row);
      } catch (e) { console.warn("call ring recovery", e); }
      finally {
        recoveringRings = false; ringRecovery = null;
        const ids = [...deferredRingDeletes]; deferredRingDeletes.clear();
        if (ids.length) SB.from("call_signals").delete().in("id", ids).then(() => {}, () => {});
      }
    })();
    return ringRecovery;
  };
  const init = () => {
    if (started || !S.me || typeof RTCPeerConnection === "undefined") return; started = true;
    SB.channel("tsunagi-calls")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "call_signals", filter: `to_user=eq.${S.me.id}` }, p => { onSignal(p.new).catch(e => console.warn("call", e)); })
      .subscribe(status => { if (status === "SUBSCRIBED") recoverRings(); });
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => {
      if (e.data?.type === "open-call") recoverRings();
    });
    window.addEventListener("beforeunload", () => { if (cur) end(); });
  };
  return { init, start: cid => start(cid).catch(fail), busy: () => !!cur, available: () => typeof RTCPeerConnection !== "undefined" };
})();

/** チャットのヘッダーに置く通話ボタン。人数が多すぎるチャンネルには出さない */
function callButton(data, cls) {
  const n = (data.member_ids || []).length;
  if (!OwlCall.available() || n < 2 || n > CALL_MAX) return "";
  return `<button class="${cls}" data-call title="音声通話を始める" aria-label="音声通話">${icon("phone")}</button>`;
}
