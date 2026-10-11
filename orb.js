/* つなぎ — チームの在席を「粘土の球」で見せる 3D シーン（WebGL1 レイマーチング・外部ライブラリなし）
 * 中央 = 自分、周回 = メンバー。在席は持ち上がって色が付き、不在は沈んで淡くなる。
 * 名前ラベルは HTML で重ね、クリックで DM を開く。画面外・非表示タブでは描画を止める。
 */
(function () {
  const MAX = 16;
  const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FRAG = `
precision highp float;
uniform vec2 R; uniform vec3 ro; uniform vec3 ta; uniform float FL;
uniform vec4 S[${MAX}]; uniform vec3 C[${MAX}]; uniform int N;
float sdS(vec3 p, out int id){
  float d = p.y; id = -1;
  for(int i=0;i<${MAX};i++){ if(i>=N) break; float s = length(p-S[i].xyz)-S[i].w; if(s<d){ d=s; id=i; } }
  return d;
}
float map(vec3 p){ int k; return sdS(p,k); }
vec3 nrm(vec3 p){ vec2 e=vec2(.0015,0.); return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx))); }
float shadow(vec3 o, vec3 d){ float r=1., t=.03; for(int i=0;i<28;i++){ float h=map(o+d*t); r=min(r,10.*h/t); t+=clamp(h,.03,.4); if(r<.002||t>9.) break; } return clamp(r,0.,1.); }
float ao(vec3 p, vec3 n){ float o=0., s=1.; for(int i=1;i<=5;i++){ float h=.06*float(i); o+=(h-map(p+n*h))*s; s*=.6; } return clamp(1.-2.2*o,0.,1.); }
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*R)/R.y;
  vec3 f=normalize(ta-ro), r=normalize(cross(f,vec3(0,1,0))), u=cross(r,f);
  vec3 rd=normalize(uv.x*r+uv.y*u+FL*f);
  vec3 bg=mix(vec3(.935,.945,.972), vec3(.988,.991,1.), smoothstep(-.4,.5,uv.y));
  float t=0.; int id=-1; bool hit=false;
  for(int i=0;i<90;i++){ vec3 p=ro+rd*t; float d=sdS(p,id); if(d<.0012){ hit=true; break; } t+=d; if(t>30.) break; }
  vec3 col=bg;
  if(hit){
    vec3 p=ro+rd*t, n=nrm(p);
    vec3 L=normalize(vec3(-.55,.95,.45));
    float dif=max(dot(n,L),0.)*shadow(p+n*.004,L);
    float a=ao(p,n);
    float sky=.55+.45*n.y;
    vec3 base;
    if(id<0){
      base=vec3(.955,.962,.982);
      float ring=smoothstep(.02,0.,abs(length(p.xz)-2.35)-.004)*.05;
      base-=ring;
    } else {
      // GLSL ES 1.0 は uniform 配列を非定数で添字できないのでループで拾う
      base=vec3(1.); for(int i=0;i<${MAX};i++){ if(i==id){ base=C[i]; } }
    }
    vec3 h=normalize(L-rd);
    float spec=pow(max(dot(n,h),0.),48.)*(id<0?0.:.35);
    float fres=pow(1.-max(dot(n,-rd),0.),3.);
    col=base*(.62*dif+.48*sky*a)+spec+fres*(id<0?0.:.16)*vec3(1.);
    col=mix(col,bg,smoothstep(7.,18.,t));
  }
  col=pow(col,vec3(.98));
  gl_FragColor=vec4(col,1.);
}`;

  function hex(h) {
    const n = parseInt(h.replace("#", ""), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const mix = (a, b, k) => a.map((v, i) => v * (1 - k) + b[i] * k);

  class TeamOrb {
    constructor(wrap, { onPick } = {}) {
      this.wrap = wrap; this.onPick = onPick; this.people = []; this.me = null;
      this.canvas = document.createElement("canvas");
      wrap.appendChild(this.canvas);
      this.labels = document.createElement("div");
      wrap.appendChild(this.labels);
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.visible = true; this.t0 = performance.now(); this.lastDraw = 0;
      this.gl = this.canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
      if (!this.gl || !this._init()) { this.gl = null; this.canvas.remove(); }
      new ResizeObserver(() => this._resize()).observe(wrap);
      new IntersectionObserver(es => { this.visible = es[0].isIntersecting; this._kick(); }).observe(wrap);
      document.addEventListener("visibilitychange", () => this._kick());
      this._resize();
    }
    _init() {
      const gl = this.gl;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; } return s; };
      const v = sh(gl.VERTEX_SHADER, VERT), f = sh(gl.FRAGMENT_SHADER, FRAG);
      if (!v || !f) return false;
      const pr = gl.createProgram(); gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return false;
      gl.useProgram(pr); this.pr = pr;
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.U = {}; for (const n of ["R", "ro", "ta", "FL", "S", "C", "N"]) this.U[n] = gl.getUniformLocation(pr, n);
      return true;
    }
    _resize() {
      const r = this.wrap.getBoundingClientRect();
      // 1x 以下の解像度で十分（柔らかい粘土の質感なので精細さより省電力を優先）
      // 実測 1 フレーム 1〜2ms（内蔵 GPU）なので、端末の解像度どおりに描く（上限 2x）
      const scale = Math.min(devicePixelRatio || 1, 2);
      this.W = Math.max(1, Math.round(r.width * scale)); this.H = Math.max(1, Math.round(r.height * scale));
      this.cw = r.width; this.ch = r.height;
      if (this.gl) { this.canvas.width = this.W; this.canvas.height = this.H; }
      this._kick(true);
    }
    set(people, meId) {
      this.people = people.slice(0, MAX - 1); this.me = meId;
      this._buildLabels(); this._kick(true);
    }
    _buildLabels() {
      this.labels.innerHTML = "";
      if (!this.gl) {
        this.labels.className = "orb-fallback";
        for (const p of this.people) {
          const b = document.createElement("button"); b.className = "orb-label" + (p.online ? "" : " off");
          b.style.position = "static"; b.style.transform = "none"; b.textContent = (p.online ? "● " : "○ ") + p.name;
          b.onclick = () => this.onPick && this.onPick(p); this.labels.appendChild(b);
        }
        return;
      }
      this.labels.className = "";
      this.labelEls = this.people.map(p => {
        const b = document.createElement("button");
        b.className = "orb-label" + (p.online ? "" : " off");
        b.textContent = p.id === this.me ? "あなた" : p.name.split(/\s/)[0];
        b.title = p.id === this.me ? p.name : `${p.name}（${p.online ? "オンライン" : "オフライン"}）— クリックで DM`;
        b.onclick = () => p.id !== this.me && this.onPick && this.onPick(p);
        this.labels.appendChild(b); return b;
      });
    }
    _layout(t) {
      const others = this.people.filter(p => p.id !== this.me);
      const out = [];
      const meP = this.people.find(p => p.id === this.me);
      if (meP) out.push({ p: meP, pos: [0, .62 + Math.sin(t * 1.1) * .04, 0], r: .62, col: hex(meP.color) });
      others.forEach((p, i) => {
        const a = (i / Math.max(others.length, 1)) * Math.PI * 2 + t * .12;
        const R = 2.35;
        const on = p.online;
        const r = on ? .42 : .3;
        const y = on ? r + .28 + Math.sin(t * 1.3 + i * 1.7) * .08 : r;
        const c = hex(p.color);
        out.push({ p, pos: [Math.cos(a) * R, y, Math.sin(a) * R], r, col: on ? c : mix(c, [.86, .88, .92], .72) });
      });
      return out;
    }
    _cam(t) {
      const a = .6 + Math.sin(t * .07) * .35;
      return { ro: [Math.sin(a) * 6.4, 3.05, Math.cos(a) * 6.4], ta: [0, .45, 0], fl: 1.75 };
    }
    _project(pt, cam) {
      const sub = (a, b) => a.map((v, i) => v - b[i]);
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const f = norm(sub(cam.ta, cam.ro)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
      const d = sub(pt, cam.ro); const z = dot(d, f);
      const x = dot(d, r) / z * cam.fl, y = dot(d, u) / z * cam.fl;
      return [x * this.ch + this.cw / 2, this.ch / 2 - y * this.ch];
    }
    _kick(force) {
      if (force) this.dirty = true;
      if (!this.gl || this.raf) return;
      // 非表示タブでは rAF が来ないので、静止画 1 枚だけはタイマーで描いておく（空白の枠を見せない）
      if (document.hidden) { if (this.dirty) this.raf = setTimeout(() => this._frame(performance.now()), 0); return; }
      this.raf = requestAnimationFrame(ts => this._frame(ts));
    }
    _frame(ts) {
      this.raf = 0;
      if ((!this.visible || document.hidden) && !this.dirty) return;
      // 30fps に間引く（チャット画面の横で GPU を食わない）
      if (ts - this.lastDraw < 33 && !this.dirty) { this._kick(); return; }
      this.lastDraw = ts; this.dirty = false;
      const t = this.reduced ? 0 : (ts - this.t0) / 1000;
      const gl = this.gl, U = this.U, items = this._layout(t), cam = this._cam(t);
      gl.viewport(0, 0, this.W, this.H);
      gl.uniform2f(U.R, this.W, this.H);
      gl.uniform3fv(U.ro, cam.ro); gl.uniform3fv(U.ta, cam.ta); gl.uniform1f(U.FL, cam.fl);
      const S = new Float32Array(MAX * 4), C = new Float32Array(MAX * 3);
      items.forEach((it, i) => { S.set([...it.pos, it.r], i * 4); C.set(it.col, i * 3); });
      gl.uniform4fv(U.S, S); gl.uniform3fv(U.C, C); gl.uniform1i(U.N, items.length);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (this.labelEls) {
        items.forEach(it => {
          const idx = this.people.indexOf(it.p); const el = this.labelEls[idx]; if (!el) return;
          const [x, y] = this._project([it.pos[0], it.pos[1] - it.r - .12, it.pos[2]], cam);
          el.style.left = x + "px"; el.style.top = y + "px"; el.style.position = "absolute";
        });
      }
      if (!this.reduced) this._kick();
    }
  }
  window.TeamOrb = TeamOrb;
})();
