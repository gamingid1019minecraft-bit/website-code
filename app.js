/* ==========================================================================
   IlmCore AI — app.js
   Shared engine: animated background (stars, bubbles, particles), mouse
   ripple effects, toast notifications, page transitions, and the API client
   used by every page to talk to the Flask backend.
   ========================================================================== */

/* ---------------------------------------------------------------------- *
 *  API CONFIG
 * ---------------------------------------------------------------------- */
const IlmAPI = (() => {
  const BASE_URL = 'http://127.0.0.1:5000';

  async function request(path, options = {}) {
    const token = localStorage.getItem('ilmcore_token');
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }

    if (!res.ok) {
      const message = (data && (data.error || data.message)) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    BASE_URL,
    health: () => request('/health'),
    login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    register: (name, email, password) => request('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
    googleAuth: (idToken) => request('/auth/google', { method: 'POST', body: JSON.stringify({ id_token: idToken }) }),
    chat: (message, sessionId) => request('/chat', { method: 'POST', body: JSON.stringify({ message, session_id: sessionId }) }),
    getSessions: () => request('/sessions'),
    getMessages: (sessionId) => request(`/sessions/${sessionId}/messages`),
    deleteSession: (sessionId) => request(`/sessions/${sessionId}`, { method: 'DELETE' }),
  };
})();

/* ---------------------------------------------------------------------- *
 *  TOASTS
 * ---------------------------------------------------------------------- */
function showToast(message, type = 'success', duration = 3200) {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    document.body.appendChild(stack);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 280);
  }, duration);
}
window.showToast = showToast;
window.IlmAPI = IlmAPI;

/* ---------------------------------------------------------------------- *
 *  PAGE TRANSITIONS (fade between pages on internal navigation)
 * ---------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('page-fade');
  document.querySelectorAll('a[data-nav]').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      e.preventDefault();
      document.body.classList.remove('page-fade');
      document.body.classList.add('page-leaving');
      setTimeout(() => { window.location.href = href; }, 260);
    });
  });
});

/* ---------------------------------------------------------------------- *
 *  BUTTON CLICK RIPPLE (material-style, inside .btn elements)
 * ---------------------------------------------------------------------- */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn, .btn-icon, .btn-google, .suggested-prompt, .sidebar-item');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement('span');
  const size = Math.max(rect.width, rect.height);
  ripple.className = 'click-ripple';
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
  const prevPosition = getComputedStyle(btn).position;
  if (prevPosition === 'static') btn.style.position = 'relative';
  btn.style.overflow = btn.style.overflow || 'hidden';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 620);
});

/* ---------------------------------------------------------------------- *
 *  ANIMATED BACKGROUND ENGINE
 *  - Layered canvases: stars (twinkle) / bubbles (float up) / particles
 *    (drift + react to cursor) — all running on a single rAF loop at 60fps.
 *  - CSS handles aurora + gradient waves + blur (see style.css .aurora).
 * ---------------------------------------------------------------------- */
(function initBackground() {
  const mount = () => {
    if (document.getElementById('bg-layer')) return;
    const layer = document.createElement('div');
    layer.id = 'bg-layer';
    layer.innerHTML = `
      <div class="aurora"></div>
      <div class="wave-layer"></div>
      <canvas id="stars-canvas"></canvas>
      <canvas id="bubbles-canvas"></canvas>
      <canvas id="particles-canvas"></canvas>
    `;
    document.body.prepend(layer);
  };
  mount();

  const starsCanvas = document.getElementById('stars-canvas');
  const bubblesCanvas = document.getElementById('bubbles-canvas');
  const particlesCanvas = document.getElementById('particles-canvas');
  const starsCtx = starsCanvas.getContext('2d');
  const bubblesCtx = bubblesCanvas.getContext('2d');
  const particlesCtx = particlesCanvas.getContext('2d');

  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    [starsCanvas, bubblesCanvas, particlesCanvas].forEach(c => {
      c.width = W * DPR;
      c.height = H * DPR;
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    });
    starsCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    bubblesCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    particlesCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const rand = (a, b) => a + Math.random() * (b - a);

  /* --- Stars: twinkling points, denser + subtle sparkle glints --- */
  const STAR_COUNT = Math.floor((W * H) / 9000);
  const stars = Array.from({ length: Math.max(STAR_COUNT, 90) }, () => ({
    x: rand(0, W), y: rand(0, H), r: rand(0.4, 1.6),
    baseAlpha: rand(0.15, 0.9), phase: rand(0, Math.PI * 2), speed: rand(0.4, 1.4),
    sparkle: Math.random() < 0.08,
  }));

  /* --- Bubbles: hundreds, float upward, glow, gentle horizontal sway --- */
  const BUBBLE_COUNT = Math.min(Math.floor((W * H) / 5200), 260);
  function makeBubble(initial) {
    const r = rand(2, 9);
    return {
      x: rand(0, W),
      y: initial ? rand(0, H) : H + r + rand(0, 60),
      r,
      speed: rand(0.18, 0.65) * (r < 5 ? 1.3 : 0.8),
      sway: rand(0.3, 1.2),
      swayPhase: rand(0, Math.PI * 2),
      hue: Math.random() < 0.5 ? 'blue' : 'purple',
      alpha: rand(0.12, 0.42),
    };
  }
  let bubbles = Array.from({ length: BUBBLE_COUNT }, () => makeBubble(true));

  /* --- Particles: flying glowing motes that react to cursor --- */
  const PARTICLE_COUNT = Math.min(Math.floor((W * H) / 9000), 140);
  const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x: rand(0, W), y: rand(0, H),
    vx: rand(-0.25, 0.25), vy: rand(-0.25, 0.25),
    r: rand(0.8, 2.6),
    hue: Math.random() < 0.5 ? '99,102,241' : '168,85,247',
    alpha: rand(0.25, 0.7),
  }));

  const mouse = { x: W / 2, y: H / 2, active: false };
  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true;
    spawnRipple(e.clientX, e.clientY);
  });
  window.addEventListener('mouseleave', () => { mouse.active = false; });

  /* throttled ripple spawn on movement */
  let lastRipple = 0;
  function spawnRipple(x, y) {
    const now = performance.now();
    if (now - lastRipple < 90) return;
    lastRipple = now;
    const el = document.createElement('div');
    el.className = 'ripple';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  /* click -> burst ripple, slightly bigger */
  window.addEventListener('click', (e) => {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => spawnRipple(e.clientX, e.clientY), i * 70);
    }
  });

  function drawStars() {
    starsCtx.clearRect(0, 0, W, H);
    for (const s of stars) {
      s.phase += 0.02 * s.speed;
      const a = s.baseAlpha * (0.55 + 0.45 * Math.sin(s.phase));
      starsCtx.beginPath();
      starsCtx.fillStyle = `rgba(255,255,255,${a})`;
      starsCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      starsCtx.fill();
      if (s.sparkle && a > 0.7) {
        starsCtx.strokeStyle = `rgba(200,210,255,${a * 0.6})`;
        starsCtx.lineWidth = 0.6;
        starsCtx.beginPath();
        starsCtx.moveTo(s.x - s.r * 3, s.y);
        starsCtx.lineTo(s.x + s.r * 3, s.y);
        starsCtx.moveTo(s.x, s.y - s.r * 3);
        starsCtx.lineTo(s.x, s.y + s.r * 3);
        starsCtx.stroke();
      }
    }
  }

  function drawBubbles() {
    bubblesCtx.clearRect(0, 0, W, H);
    for (const b of bubbles) {
      b.y -= b.speed;
      b.swayPhase += 0.01 * b.sway;
      b.x += Math.sin(b.swayPhase) * 0.35;

      const color = b.hue === 'blue' ? '91,140,255' : '168,85,247';
      const grad = bubblesCtx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 4);
      grad.addColorStop(0, `rgba(${color},${b.alpha})`);
      grad.addColorStop(0.5, `rgba(${color},${b.alpha * 0.35})`);
      grad.addColorStop(1, `rgba(${color},0)`);
      bubblesCtx.fillStyle = grad;
      bubblesCtx.beginPath();
      bubblesCtx.arc(b.x, b.y, b.r * 4, 0, Math.PI * 2);
      bubblesCtx.fill();

      bubblesCtx.beginPath();
      bubblesCtx.fillStyle = `rgba(${color},${Math.min(b.alpha + 0.25, 0.9)})`;
      bubblesCtx.arc(b.x, b.y, b.r * 0.5, 0, Math.PI * 2);
      bubblesCtx.fill();

      if (b.y + b.r * 4 < 0) Object.assign(b, makeBubble(false));
    }
  }

  function drawParticles() {
    particlesCtx.clearRect(0, 0, W, H);
    for (const p of particles) {
      if (mouse.active) {
        const dx = mouse.x - p.x, dy = mouse.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 140) {
          const force = (140 - dist) / 140;
          p.vx -= (dx / dist) * force * 0.03;
          p.vy -= (dy / dist) * force * 0.03;
        }
      }
      p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy;

      if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10; if (p.y > H + 10) p.y = -10;

      particlesCtx.beginPath();
      particlesCtx.fillStyle = `rgba(${p.hue},${p.alpha})`;
      particlesCtx.shadowColor = `rgba(${p.hue},0.9)`;
      particlesCtx.shadowBlur = 6;
      particlesCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      particlesCtx.fill();
      particlesCtx.shadowBlur = 0;
    }
  }

  function loop() {
    drawStars();
    drawBubbles();
    drawParticles();
    requestAnimationFrame(loop);
  }
  loop();
})();
