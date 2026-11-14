import { TARGETS, positionAtEpoch } from "./targets.js";

const canvas = document.getElementById("sky-globe");
if (canvas) {
  const ctx = canvas.getContext("2d");
  const fallback = document.getElementById("globe-fallback");
  if (!ctx) {
    fallback.hidden = false;
    canvas.hidden = true;
  } else {
    const colors = ["#ffcf70", "#70e1dc", "#ff8ab1", "#b4a0ff", "#a7ef9d"];
    const targets = TARGETS.map((target, index) => ({
      target, color: colors[index % colors.length], ...positionAtEpoch(target), point: null,
    }));
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0, height = 0, radius = 0, yaw = -0.55, pitch = 0.2;
    let selectedId = null, pointer = null, lastFrame = 0, spin = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      width = rect.width; height = rect.height; radius = Math.min(width * 0.39, height * 0.44);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function project(ra, dec) {
      const lon = (ra - 180) * Math.PI / 180 + yaw;
      const lat = dec * Math.PI / 180;
      const x0 = Math.cos(lat) * Math.sin(lon);
      const y0 = Math.sin(lat);
      const z0 = Math.cos(lat) * Math.cos(lon);
      const y = y0 * Math.cos(pitch) - z0 * Math.sin(pitch);
      const z = y0 * Math.sin(pitch) + z0 * Math.cos(pitch);
      return { x: width / 2 + radius * x0, y: height / 2 - radius * y, z };
    }

    function draw(now = 0) {
      if (!width || !height) resize();
      if (!width || !height) { requestAnimationFrame(draw); return; }
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
      lastFrame = now;
      if (!pointer && !reducedMotion.matches) yaw += dt * 0.055;
      spin += dt;
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2, cy = height / 2;
      const halo = ctx.createRadialGradient(cx, cy, radius * .68, cx, cy, radius * 1.34);
      halo.addColorStop(0, "rgba(31,177,207,.16)"); halo.addColorStop(.68, "rgba(96,89,218,.12)"); halo.addColorStop(1, "rgba(96,89,218,0)");
      ctx.fillStyle = halo; ctx.fillRect(0, 0, width, height);
      const sphere = ctx.createRadialGradient(cx - radius * .35, cy - radius * .42, radius * .05, cx, cy, radius * 1.12);
      sphere.addColorStop(0, "#234d84"); sphere.addColorStop(.52, "#162d59"); sphere.addColorStop(.85, "#10192f"); sphere.addColorStop(1, "#08101e");
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fillStyle = sphere; ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2); ctx.clip();
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(166,211,255,.2)";
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath(); let drawing = false;
        for (let lon = -180; lon <= 180; lon += 4) {
          const p = project((lon + 180 + 360) % 360, lat);
          if (p.z > 0) { drawing ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); drawing = true; }
          else drawing = false;
        }
        ctx.stroke();
      }
      for (let ra = 0; ra < 360; ra += 30) {
        ctx.beginPath(); let drawing = false;
        for (let dec = -88; dec <= 88; dec += 3) {
          const p = project(ra, dec);
          if (p.z > 0) { drawing ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); drawing = true; }
          else drawing = false;
        }
        ctx.stroke();
      }
      // Decorative, deterministic star field; it is not a survey or catalogue layer.
      for (let i = 0; i < 90; i++) {
        const a = i * 2.399963, r = radius * Math.sqrt(((i * 37) % 97) / 97);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        ctx.beginPath(); ctx.arc(x, y, i % 11 === 0 ? 1.35 : .65, 0, Math.PI * 2);
        ctx.fillStyle = i % 7 === 0 ? "rgba(255,206,118,.75)" : "rgba(207,227,255,.62)"; ctx.fill();
      }
      // A soft, illustrative color band adds depth without implying measured sky coverage.
      ctx.beginPath();
      for (let a = -1.1; a < 1.35; a += .035) {
        const x = cx + Math.cos(a) * radius * .86;
        const y = cy + Math.sin(a) * radius * .42 + Math.sin(a * 2 + spin * .08) * radius * .07;
        a === -1.1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(113,231,220,.25)"; ctx.lineWidth = radius * .08; ctx.lineCap = "round"; ctx.stroke();
      for (const item of targets) {
        const p = project(item.ra, item.dec); item.point = p;
        if (p.z <= 0) continue;
        const active = selectedId === item.target.id, r = active ? 7 : 5;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + (active ? 6 : 3), 0, Math.PI * 2);
        ctx.fillStyle = `${item.color}35`; ctx.fill();
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = item.color; ctx.fill();
        ctx.strokeStyle = "#091321"; ctx.lineWidth = 2; ctx.stroke();
        ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = p.x > cx ? "right" : "left";
        ctx.fillStyle = "#fff"; ctx.shadowColor = "#08101e"; ctx.shadowBlur = 5;
        ctx.fillText(item.target.label, p.x + (p.x > cx ? -10 : 10), p.y - 9); ctx.shadowBlur = 0;
      }
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.strokeStyle = "rgba(153,214,255,.55)"; ctx.lineWidth = 1.5; ctx.stroke();
      requestAnimationFrame(draw);
    }

    function hit(x, y) {
      return targets.find(item => item.point?.z > 0 && Math.hypot(item.point.x - x, item.point.y - y) < 19);
    }
    canvas.addEventListener("pointerdown", event => {
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) pointer.moved = true;
      yaw += dx / Math.max(radius, 1) * 1.3;
      pitch = Math.max(-1.15, Math.min(1.15, pitch + dy / Math.max(radius, 1) * 1.3));
      pointer.x = event.clientX; pointer.y = event.clientY;
    });
    canvas.addEventListener("pointerup", event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const rect = canvas.getBoundingClientRect();
      const selected = !pointer.moved && hit(event.clientX - rect.left, event.clientY - rect.top);
      pointer = null;
      if (selected) document.dispatchEvent(new CustomEvent("sky-target-select", { detail: { id: selected.target.id } }));
    });
    canvas.addEventListener("pointercancel", () => { pointer = null; });
    canvas.addEventListener("keydown", event => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { yaw += event.key === "ArrowLeft" ? -.12 : .12; event.preventDefault(); }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") { pitch += event.key === "ArrowUp" ? .12 : -.12; event.preventDefault(); }
    });
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-describedby", "globe-help");
    document.addEventListener("sky-target-selected", event => { selectedId = event.detail?.id ?? null; });
    new ResizeObserver(resize).observe(canvas);
    reducedMotion.addEventListener?.("change", () => { lastFrame = 0; });
    requestAnimationFrame(draw);
  }
}
