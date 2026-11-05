// Cursada: pantallas y acciones. Los datos de cada usuario viven en el servidor.
(function () {
  const APP_NAME = 'Cursada'; // el nombre se cambia acá, en index.html y en el título
  const L = window.CursadaLogic;
  const $ = (q, el = document) => el.querySelector(q);
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ratio = (a, b) => (b ? a / b : 0);

  // ---------- Estado y guardado
  let S = null; let me = null; let rev = 0;
  let dirty = false; let inflight = false; let saveTimer = null; let deferring = false;
  const ui = { kindFilter: null, authMode: 'login', authNotice: '', recovery: false, pracFilter: null, openPrac: new Set(), phoneWeek: null, msgI: Math.floor(Math.random() * 100), planDraft: '' };

  const Backend = window.CursadaBackend;
  const api = (method, url, body) => Backend.request(method, url, body);
  function save() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 350);
  }
  async function flush() {
    if (inflight || !dirty) return;
    inflight = true; dirty = false;
    let retry = 350;
    try {
      const r = await api('PUT', '/api/state', { state: S, rev });
      if (r.status === 200) rev = r.data.rev;
      else if (r.status === 409) { S = migrate(r.data.state); rev = r.data.rev; dirty = false; render(); toast('Se actualizó con lo último que guardaste en otra pestaña o dispositivo.'); }
      else if (r.status === 401) { location.reload(); return; }
      else throw new Error('save');
    } catch (e) {
      dirty = true; retry = 5000;
      toast('No se pudo guardar. Reintento en unos segundos.');
    }
    inflight = false;
    if (dirty) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, retry); }
  }
  window.addEventListener('pagehide', () => {
    if (dirty && S) { dirty = false; Backend.beacon(S, rev); }
  });
  let undoSnap = null;
  function mutate(fn, msg) {
    undoSnap = JSON.stringify(S);
    fn();
    save();
    render();
    if (msg) toast(msg, true);
  }

  const PALETTE = ['#B4A7D6', '#F9CB9C', '#D5A6BD', '#A4C2F4', '#B6D7A8', '#FFE599', '#A2C4C9', '#EA9999'];
  const isHex = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '');
  function mondayOf(d) { return L.addDays(d, -L.dow(d)); }
  function emptyState(user) {
    return {
      v: 2,
      settings: { name: (user.name || '').split(' ')[0], greet: 'Hola', university: '', career: '', entryYear: '', theme: 'lavanda', font: 'clasica', custom: { accent: '#674EA7', mode: 'light' }, minAtt: 0.75, semStart: L.iso(mondayOf(today())), termWord: 'Semestre', onboarded: false, wizStep: 0 },
      classes: [], weeks: L.buildWeeks(16, [], []), att: {}, cellNotes: {}, weekNotes: {}, courses: [], practices: [], milestones: [], agenda: [], links: [], scratch: '', matColors: {}, history: [],
    };
  }
  // Acepta datos viejos o importados y los deja en la forma actual.
  function migrate(s) {
    const base = emptyState(me || {});
    const out = { ...base, ...s, v: 2 };
    out.settings = { ...base.settings, ...(s.settings || {}) };
    out.settings.custom = { ...base.settings.custom, ...(out.settings.custom || {}) };
    if (!GREETS.includes(out.settings.greet)) out.settings.greet = 'Hola';
    if (!isHex(out.settings.custom.accent)) out.settings.custom.accent = '#674EA7';
    out.classes = (out.classes || []).map((c) => {
      const co = out.courses.find((x) => x.id === c.course);
      return { ...c, mat: co ? co.subj : c.mat };
    });
    const colors = {};
    let i = 0;
    for (const c of out.courses) {
      if (colors[c.subj]) continue;
      const given = (out.matColors || {})[c.subj];
      const active = c.status === 'cursando' || c.status === 'recursando' || out.classes.some((x) => x.mat === c.subj) || out.practices.some((p) => p.course === c.id);
      if (isHex(given)) colors[c.subj] = given; else if (active) colors[c.subj] = PALETTE[i++ % PALETTE.length];
    }
    out.matColors = colors;
    out.practices = out.practices.map((p) => ({ kind: 'practica', ...p }));
    return out;
  }

  // Fecha de hoy; ?hoy=AAAA-MM-DD sirve para probar otros días.
  function today() {
    const q = new URLSearchParams(location.search).get('hoy');
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return L.parseDate(q);
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  const longDate = (d) => `${L.DIAS[L.dow(d)]} ${d.getDate()} de ${L.MESES[d.getMonth()]}`;
  const shortDate = (d) => `${d.getDate()}/${d.getMonth() + 1}`;
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
  const course = (id) => S.courses.find((c) => c.id === id);
  const label = (c) => c.short || c.name;
  const mats = () => [...new Set(S.classes.map((c) => c.mat))];
  const latestOf = (subj) => [...S.courses].reverse().find((c) => c.subj === subj);
  const matLabel = (m) => { const co = latestOf(m); return co ? label(co) : m; };
  const colorOf = (subj) => (S.matColors && isHex(S.matColors[subj]) ? S.matColors[subj] : PALETTE[0]);
  function ensureColor(subj) {
    if (!S.matColors[subj]) { const used = new Set(Object.values(S.matColors)); S.matColors[subj] = PALETTE.find((p) => !used.has(p)) || PALETTE[Object.keys(S.matColors).length % PALETTE.length]; }
  }
  const STATE_WORD = { p: 'Fui', a: 'Falté', n: 'No hubo' };
  const STATE_GLYPH = { p: '✓', a: '✕', n: '–' };
  const STATUS = ['cursando', 'recursando', 'aprobada 1ra instancia', 'aprobada 2da instancia', 'desaprobada', 'proximamente'];
  const statusLabel = (s) => (s === 'proximamente' ? 'próximamente' : s);
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const termLabel = (sem) => (sem === 'Anual' ? 'Anual' : `${S.settings.termWord || 'Semestre'} ${sem}`);
  const termShort = (y, sem) => `${y}° año${sem === 'Anual' ? ', anual' : `, ${(S.settings.termWord || 'Semestre').slice(0, 3).toLowerCase()}. ${sem}`}`;
  const signedPct = (x) => (x === null ? '' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.round(Math.abs(x) * 100)}%`);
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
  const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  function newCourse(name, year, sem) {
    const subj = L.slug(name);
    let id = `${subj}-${year}${sem}`;
    while (course(id)) id += 'x';
    return { id, subj, name, short: '', year, sem, status: 'proximamente', p1: null, p2: null, final: null, profs: '', note: '' };
  }

  const GREETS = ['Bienvenida', 'Bienvenido', 'Hola'];

  // ---------- Temas
  const THEMES = [
    { id: 'lavanda', n: 'Lavanda', c: '#D9D2E9' }, { id: 'noche', n: 'Noche', c: '#1D1440' }, { id: 'manteca', n: 'Manteca', c: '#FFF2CC' }, { id: 'menta', n: 'Menta', c: '#CFE8C3' },
    { id: 'cielo', n: 'Cielo', c: '#BBD7F5', accent: '#2F6DB5', mode: 'light' }, { id: 'frambuesa', n: 'Frambuesa', c: '#F4BFD3', accent: '#B0306A', mode: 'light' }, { id: 'grafito', n: 'Grafito', c: '#2B3138', accent: '#8FA3B8', mode: 'dark' },
  ];
  const rgb = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const toHex = (a) => `#${a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => { const A = rgb(a); const B = rgb(b); return toHex(A.map((v, i) => v * t + B[i] * (1 - t))); };
  const lum = (x) => { const [r, g, b] = rgb(x).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function fit(color, against, target, toward) { let c = color; for (let i = 0; i < 24 && contrast(c, against) < target; i++) c = mix(toward, c, 0.08); return c; }
  function deriveVars(accent, mode) {
    if (mode === 'dark') {
      const dark = '#0B0916';
      const card = mix(accent, dark, 0.14);
      const a = fit(accent, card, 4.5, '#FFFFFF');
      return { '--bg': mix(accent, dark, 0.07), '--card': card, '--card-2': mix(accent, dark, 0.21), '--line': mix(accent, dark, 0.34), '--ink': mix(accent, '#FFFFFF', 0.08), '--ink-2': fit(mix(accent, '#FFFFFF', 0.28), card, 7, '#FFFFFF'), '--muted': fit(mix(accent, '#FFFFFF', 0.45), card, 4.6, '#FFFFFF'), '--accent': a, '--accent-ink': dark };
    }
    const ink = mix(accent, '#0E0A1E', 0.24);
    const card = mix(accent, '#FFFFFF', 0.02);
    const a = fit(accent, card, 3.4, '#0E0A1E');
    return { '--bg': mix(accent, '#FFFFFF', 0.14), '--card': card, '--card-2': mix(accent, '#FFFFFF', 0.07), '--line': mix(accent, '#FFFFFF', 0.24), '--ink': ink, '--ink-2': fit(mix(accent, '#0E0A1E', 0.55), card, 6, '#0E0A1E'), '--muted': fit(mix(accent, '#0E0A1E', 0.7), card, 4.6, '#0E0A1E'), '--accent': a, '--accent-ink': contrast(a, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#0E0A1E' };
  }
  function applyTheme() {
    const root = document.documentElement;
    root.removeAttribute('style');
    const st = S ? S.settings : { theme: 'lavanda', font: 'clasica' };
    root.dataset.font = st.font || 'clasica';
    const preset = THEMES.find((t) => t.id === st.theme);
    let accent = null; let mode = null;
    if (st.theme === 'custom') { accent = st.custom.accent; mode = st.custom.mode; } else if (preset && preset.accent) { accent = preset.accent; mode = preset.mode; }
    if (accent) {
      root.dataset.theme = mode === 'dark' ? 'noche' : 'lavanda';
      Object.entries(deriveVars(accent, mode)).forEach(([k, v]) => root.style.setProperty(k, v));
    } else root.dataset.theme = preset ? preset.id : 'lavanda';
  }
  function themePicker() {
    const st = S.settings;
    return `<div class="themes" style="margin-top:6px">${THEMES.map((t) => `<button type="button" data-act="theme" data-id="${t.id}" aria-pressed="${st.theme === t.id}"><i style="background:${t.c}"></i>${t.n}</button>`).join('')}<button type="button" data-act="theme" data-id="custom" aria-pressed="${st.theme === 'custom'}"><i style="background:${h(st.custom.accent)}"></i>Mi color</button></div>
    ${st.theme === 'custom' ? `<div class="color-row"><label style="display:inline-flex;gap:8px;align-items:center">Tu color <input type="color" value="${h(st.custom.accent)}" data-change="custom-accent" aria-label="Elegí tu color"></label><div class="choice">${[['light', 'Claro'], ['dark', 'Oscuro']].map(([v, n]) => `<button type="button" data-act="custom-mode" data-v="${v}" aria-pressed="${st.custom.mode === v}">${n}</button>`).join('')}</div></div>` : ''}
    <p class="section-label">Títulos</p><div class="choice" style="margin-top:6px">${[['clasica', 'Clásicos'], ['moderna', 'Modernos'], ['maquina', 'A máquina']].map(([v, n]) => `<button type="button" data-act="font" data-v="${v}" aria-pressed="${st.font === v}">${n}</button>`).join('')}</div>`;
  }

  // ---------- Selectores de perfil
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const CATALOG = window.CursadaCatalog;
  function comboField(title, field, list, value) {
    return `<div class="field combo">${h(title)}<input role="combobox" aria-label="${h(title)}" aria-autocomplete="list" aria-expanded="false" aria-controls="combo-${field}" autocomplete="off" data-combo="${list}" data-change="setting" data-f="${field}" value="${h(value)}" placeholder="Buscá o elegí"><ul class="combo-list" id="combo-${field}" role="listbox" hidden></ul></div>`;
  }
  function yearField(value) {
    const now = today().getFullYear();
    const years = Array.from({ length: now - 1969 }, (_, i) => String(now - i));
    if (value && !years.includes(String(value))) years.push(String(value));
    return `<label class="field">Año de ingreso<select data-change="setting" data-f="entryYear"><option value="">Elegí el año</option>${years.map((y) => `<option${String(value) === y ? ' selected' : ''}>${y}</option>`).join('')}</select></label>`;
  }
  function comboParts(inp) { const list = inp.closest('.combo').querySelector('.combo-list'); return { list }; }
  function comboClose(inp) { const { list } = comboParts(inp); list.hidden = true; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); }
  function comboOpen(inp, showAll) {
    const { list } = comboParts(inp);
    const opts = CATALOG[inp.dataset.combo] || [];
    const q = norm(inp.value).trim();
    const hits = showAll || !q ? opts : opts.filter((o) => norm(o).includes(q));
    const typed = inp.value.trim();
    const exact = opts.some((o) => norm(o) === q);
    const noun = inp.dataset.combo === 'universities' ? 'Mi universidad no está: usar' : 'Mi carrera no está: usar';
    list.innerHTML = hits.map((o) => `<li role="option" data-value="${h(o)}">${h(o)}</li>`).join('')
      + (typed && !exact ? `<li role="option" class="own" data-value="${h(typed)}">${noun} “${h(typed)}”</li>` : '')
      + (!hits.length && !typed ? '<li class="empty-opt">Sin opciones</li>' : '');
    list.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
  }
  function comboPick(inp, value) {
    inp.value = value;
    comboClose(inp);
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  document.addEventListener('focusin', (e) => { if (e.target.dataset && e.target.dataset.combo) comboOpen(e.target, true); });
  document.addEventListener('click', (e) => { const d = e.target.dataset; if (d && d.combo && comboParts(e.target).list.hidden) comboOpen(e.target, true); });
  document.addEventListener('input', (e) => { if (e.target.dataset && e.target.dataset.combo) comboOpen(e.target, false); });
  document.addEventListener('focusout', (e) => { if (e.target.dataset && e.target.dataset.combo) comboClose(e.target); });
  document.addEventListener('mousedown', (e) => {
    const li = e.target.closest && e.target.closest('.combo-list li[data-value]');
    if (!li) return;
    e.preventDefault();
    comboPick(li.closest('.combo').querySelector('input'), li.dataset.value);
  });
  document.addEventListener('keydown', (e) => {
    const inp = e.target;
    if (!inp.dataset || !inp.dataset.combo) return;
    const { list } = comboParts(inp);
    const items = [...list.querySelectorAll('li[data-value]')];
    const cur = items.findIndex((x) => x.classList.contains('active'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) comboOpen(inp, true);
      const all = [...list.querySelectorAll('li[data-value]')];
      if (!all.length) return;
      const next = e.key === 'ArrowDown' ? (cur + 1) % all.length : (cur - 1 + all.length) % all.length;
      all.forEach((x, i) => { x.classList.toggle('active', i === next); x.id = i === next ? 'combo-active' : ''; });
      inp.setAttribute('aria-activedescendant', 'combo-active');
      all[next].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && !list.hidden) {
      e.preventDefault();
      if (cur >= 0) comboPick(inp, items[cur].dataset.value);
      else if (items.length === 1) comboPick(inp, items[0].dataset.value);
      else { comboClose(inp); inp.dispatchEvent(new Event('change', { bubbles: true })); }
    } else if (e.key === 'Escape' && !list.hidden) {
      e.preventDefault(); e.stopPropagation();
      comboClose(inp);
    }
  });

  // ---------- Piezas
  function stitch(value, opts = {}) {
    const n = opts.n || 24;
    const on = Math.round((value || 0) * n);
    const mark = opts.mark != null ? Math.ceil(opts.mark * n) - 1 : -1;
    let out = '';
    for (let i = 0; i < n; i++) out += `<i class="${i < on ? (opts.warn ? 'on warn' : 'on') : ''}${i === mark ? ' mark' : ''}"></i>`;
    return `<div class="stitch" role="img" aria-label="${h(opts.label || L.pct(value))}">${out}</div>`;
  }
  function tileColor(c) {
    const g = c.final ?? 4;
    const m = Math.round(30 + ((Math.max(4, g) - 4) / 6) * 70);
    return `color-mix(in oklab, var(--accent) ${m}%, var(--line))`;
  }
  function careerStrip(intro) {
    const subj = L.subjects(S);
    const yearsList = [...new Set(subj.map((c) => c.year))].sort((a, b) => a - b);
    let i = 0;
    const years = yearsList.map((y) => {
      const list = subj.filter((c) => c.year === y);
      const tiles = list.map((c) => {
        const cur = L.isCurrent(c); const ok = L.isApproved(c);
        const cls = cur ? 'now' : ok ? '' : 'next';
        const tip = `${c.name} · ${statusLabel(c.status)}${c.final != null ? ` · final ${L.fmt(c.final)}` : ''}${c.attempts > 1 ? ` · intento ${c.attempts}` : ''}`;
        return `<button class="tile ${cls}${c.attempts > 1 ? ' retry' : ''}" data-n="${c.attempts}" style="--c:${ok ? tileColor(c) : 'transparent'};--i:${i++}" data-act="course" data-id="${h(c.id)}" data-tip="${h(tip)}" aria-label="${h(tip)}"></button>`;
      }).join('');
      return `<div class="zig-year" style="flex:${list.length} 1 0"><div class="zig-tiles">${tiles}</div><span>${y}° año</span></div>`;
    }).join('');
    const maxc = Math.max(...yearsList.map((y) => subj.filter((c) => c.year === y).length));
    return `<div class="zig${intro ? ' intro' : ''}" style="--cols:${maxc}">${years}</div>`;
  }
  function careerKey() {
    return '<div class="key"><span><i style="background:color-mix(in oklab,var(--accent) 88%,var(--line))"></i>aprobada, más oscuro = mejor nota</span><span><i style="background:var(--hi-strong);box-shadow:inset 0 0 0 1px var(--ink)"></i>cursando</span><span><i style="box-shadow:inset 0 0 0 1px var(--muted)"></i>falta</span></div>';
  }
  const milestoneChips = () => (S.milestones || []).map((m) => `<span class="mile">${h(termShort(m.year, m.sem))}: ${h(m.text)}</span>`).join('');
  function segButtons(key, state) {
    return `<div class="seg" role="group" aria-label="Estado de la clase">${['p', 'a', 'n'].map((s) => `<button data-act="mark" data-key="${key}" data-s="${s}" aria-pressed="${state === s}" aria-label="${STATE_WORD[s]}"><span class="g" aria-hidden="true">${STATE_GLYPH[s]}</span><span class="w">${STATE_WORD[s]}</span></button>`).join('')}</div>`;
  }
  function classRow(c, extra) {
    return `<div class="class-row" style="--mc:${colorOf(c.cls.mat)}"><span class="dot"></span><div><b>${h(c.cls.name)}${c.cls.x2 ? ' <span class="pill">x2</span>' : ''}</b>${extra ? `<small>${h(extra)}</small>` : ''}</div>${segButtons(c.key, c.state)}</div>`;
  }
  function leftPill(m) {
    if (m.left < 0) return `<span class="pill bad">! pasaste el límite por ${-m.left}</span>`;
    if (m.left === 0) return '<span class="pill bad">! no te quedan faltas</span>';
    if (m.left === 1) return '<span class="pill hi">queda 1 falta</span>';
    return `<span class="pill ok">quedan ${m.left} faltas</span>`;
  }
  const KINDS = {
    practica: { n: 'Práctica', many: 'Prácticas', unit: 'ejercicios', one: 'ejercicio', parts: 'Ejercicios' },
    lectura: { n: 'Lectura', many: 'Lecturas', unit: 'partes', one: 'parte', parts: 'Capítulos o partes' },
    video: { n: 'Video', many: 'Videos', unit: 'videos', one: 'video', parts: 'Cantidad de videos' },
    clase: { n: 'Clase grabada', many: 'Clases grabadas', unit: 'clases', one: 'clase', parts: 'Cantidad de clases' },
    cuestionario: { n: 'Cuestionario', many: 'Cuestionarios', unit: 'preguntas', one: 'pregunta', parts: 'Preguntas' },
    tp: { n: 'TP', many: 'TP', unit: 'partes', one: 'parte', parts: 'Partes del TP' },
    otro: { n: 'Otro', many: 'Otros', unit: 'partes', one: 'parte', parts: 'Partes' },
  };
  const kindOf = (p) => KINDS[p.kind] || KINDS.practica;
  const isComplete = (p) => p.known && p.items.length > 0 && p.items.every(Boolean);
  // Cada material pesa lo mismo: un TP no vale menos que una práctica de 30 ejercicios.
  function pracStats(list) {
    const known = list.filter((p) => p.known && p.items.length);
    const done = list.filter((p) => (p.kind || 'practica') === 'practica').reduce((a, p) => a + p.items.filter(Boolean).length, 0);
    const complete = known.filter(isComplete).length;
    // Lo que no tiene total cuenta como sin empezar, para que la barra no exagere.
    const pct = known.length ? known.reduce((a, p) => a + p.items.filter(Boolean).length / p.items.length, 0) / list.length : null;
    return { done, complete, knownCount: known.length, unknown: list.length - known.length, count: list.length, pct };
  }
  function pendingDated() {
    return S.practices.filter((p) => p.date && !isComplete(p));
  }
  const subjOfPractice = (p) => { const c = course(p.course); return c ? c.subj : p.course; };
  function pracSubjects() {
    const out = [];
    S.practices.forEach((p) => { const k = subjOfPractice(p); if (!out.includes(k)) out.push(k); });
    S.courses.filter(L.isCurrent).forEach((c) => { if (!out.includes(c.subj)) out.push(c.subj); });
    return out;
  }

  // ---------- Mensajes que cambian: siempre salen de tus datos.
  function messages() {
    const t = today(); const out = [];
    const cells = L.allCells(S);
    const todays = cells.filter((c) => L.daysBetween(c.date, t) === 0);
    const pendingToday = todays.filter((c) => !c.state).length;
    if (pendingToday) out.push(`Hoy tenés ${pl(todays.length, 'clase', 'clases')}. Te ${pendingToday === 1 ? 'falta cargar 1' : `faltan cargar ${pendingToday}`}.`);
    else if (todays.length) out.push('Ya cargaste todas las clases de hoy.');
    const stats = mats().map((m) => ({ m, s: L.materiaStats(S, m) })).filter((x) => x.s.taken);
    if (stats.length) {
      const tight = [...stats].sort((a, b) => a.s.left - b.s.left)[0];
      if (tight.s.left <= 0) out.push(`Ojo con ${matLabel(tight.m)}: no te quedan faltas.`);
      else out.push(`La materia más justa es ${matLabel(tight.m)}: ${tight.s.left === 1 ? 'te queda 1 falta' : `te quedan ${tight.s.left} faltas`}.`);
      const best = [...stats].sort((a, b) => b.s.pct - a.s.pct)[0];
      out.push(`Tu mejor asistencia es en ${matLabel(best.m)}: ${L.pct(best.s.pct)}.`);
    }
    const st = L.streaks(S);
    if (st.current >= 3) out.push(`Vas ${st.current} clases seguidas sin faltar.`);
    const fin = L.firstWeekOf(S, 'finales');
    if (fin) { const n = L.daysBetween(t, L.weekStart(S, fin)); if (n > 0) out.push(`Faltan ${pl(n, 'día', 'días')} para la semana de finales.`); }
    const dated = [...S.agenda.map((a) => ({ title: a.title, date: a.date })), ...pendingDated().map((p) => ({ title: `${p.name} de ${matLabel(subjOfPractice(p))}`, date: p.date }))];
    const next = dated.filter((a) => L.daysBetween(t, L.parseDate(a.date)) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (next) { const n = L.daysBetween(t, L.parseDate(next.date)); out.push(`${next.title}: ${n === 0 ? 'es hoy' : n === 1 ? 'es mañana' : `en ${n} días`}.`); }
    const cs = L.careerStats(S);
    if (cs.total) out.push(`Llevás ${cs.approved} de ${cs.total} materias aprobadas.`);
    const imp = L.improvements(S);
    if (imp.n >= 3 && imp.delta > 0) out.push(`Tus segundos parciales te salen ${signedPct(imp.pct).replace('+', '')} mejor que los primeros.`);
    const pr = pracStats(S.practices);
    if (pr.done) out.push(`Ya hiciste ${pl(pr.done, 'ejercicio', 'ejercicios')} de práctica.`);
    if (pr.complete) out.push(`Tenés ${pl(pr.complete, 'material terminado', 'materiales terminados')}.`);
    return out.length ? out : ['Cargá tu horario y tu plan para que este panel empiece a trabajar para vos.'];
  }
  function currentMessage() { const m = messages(); return m[ui.msgI % m.length]; }
  setInterval(() => {
    const el = $('#msg');
    if (!el || document.hidden || !S) return;
    ui.msgI++;
    el.textContent = currentMessage();
    el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
  }, 20000);

  // ---------- HOY
  function viewHoy() {
    const t = today();
    const wk = L.weekNumber(S, t);
    const last = L.lastClassWeek(S);
    const finals = L.firstWeekOf(S, 'finales');
    const finalsDate = finals ? L.weekStart(S, finals) : null;
    const week = S.weeks.find((w) => w.n === wk);
    const cs = L.careerStats(S);
    const st = S.settings;
    let line = cap(longDate(t));
    if (S.classes.length) {
      if (wk < 1) line += `. El cuatrimestre empieza en ${pl(L.daysBetween(t, L.parseDate(st.semStart)), 'día', 'días')}`;
      else if (!week) line += '. Terminó el cuatrimestre';
      else if (week.kind !== 'clases') line += `. Semana ${wk}: ${week.kind}`;
      else line += `. Semana ${wk} de ${last}`;
    }
    const weeks = S.classes.length ? `<div class="weeks" role="img" aria-label="Semana ${wk} de ${S.weeks.length} del cuatrimestre">${S.weeks.map((w) => `<i class="${w.n === wk ? 'now' : w.n < wk ? 'done' : w.kind !== 'clases' ? 'exam' : ''}" data-tip="Semana ${w.n} · ${shortDate(L.weekStart(S, w.n))}${w.kind !== 'clases' ? ` · ${w.kind}` : ''}"></i>`).join('')}</div>` : '';

    const cells = L.allCells(S);
    const todays = cells.filter((c) => L.daysBetween(c.date, t) === 0);
    const late = L.pendingPast(S, t);
    let todayHtml;
    if (!S.classes.length) {
      todayHtml = '<div class="card-head"><h2>Hoy</h2></div><div class="empty"><b>Todavía no cargaste tu horario.</b>Con tus clases, acá marcás si fuiste en un toque.</div><div class="actions" style="justify-content:flex-start"><button class="btn" data-act="schedule">Armar horario</button></div>';
    } else if (todays.length) {
      const done = todays.filter((c) => c.state).length;
      todayHtml = `<div class="card-head"><h2>Hoy cursás</h2><span class="sub">${done} de ${todays.length} cargadas</span></div>${todays.map((c) => classRow(c)).join('')}`;
    } else {
      const next = cells.find((c) => L.daysBetween(t, c.date) > 0 && c.state !== 'n');
      const msg = week && week.kind !== 'clases' ? `Esta semana es de ${week.kind}, sin clases en la grilla.` : 'No tenés clases hoy.';
      todayHtml = `<div class="card-head"><h2>Hoy</h2></div><div class="empty"><b>${msg}</b>${next ? `La próxima es ${h(next.cls.name)}, el ${longDate(next.date)}.` : 'No quedan clases cargadas este cuatrimestre.'}</div>`;
    }
    const lateHtml = late.length ? `<div class="card"><div class="card-head"><h2>Quedaron sin cargar</h2><span class="sub">${pl(late.length, 'clase', 'clases')}</span></div>${late.slice(-5).map((c) => classRow(c, cap(longDate(c.date)))).join('')}</div>` : '';

    const matCards = mats().map((m) => {
      const s = L.materiaStats(S, m);
      const co = course(S.classes.find((x) => x.mat === m).course);
      return `<button class="mat" data-act="course" data-id="${h(co.id)}" aria-label="Abrir ${h(label(co))}">
        <h3><span class="dot" style="--mc:${colorOf(m)}"></span>${h(label(co))}</h3>
        ${stitch(s.pct, { mark: st.minAtt, warn: s.left < 0, label: `Asistencia ${L.pct(s.pct)}, mínimo ${L.pct(st.minAtt)}` })}
        <div class="row"><span><b>${L.pct(s.pct)}</b> asistencia</span>${leftPill(s)}</div>
        <div class="grades"><span><b>${L.fmt(co.p1)}</b>Parcial 1</span><span><b>${L.fmt(co.p2)}</b>Parcial 2</span><span><b>${L.fmt(L.estimate(co))}</b>Estimado</span></div>
      </button>`;
    }).join('');

    const upcoming = [...S.agenda].filter((a) => L.daysBetween(t, L.parseDate(a.date)) >= 0).sort((a, b) => a.date.localeCompare(b.date));
    const agendaRows = upcoming.map((a) => {
      const n = L.daysBetween(t, L.parseDate(a.date));
      return `<li><span>${h(a.title)}<br><span class="sub">${cap(longDate(L.parseDate(a.date)))}</span></span><span style="display:flex;align-items:center;gap:4px"><span class="days-to">${n === 0 ? 'hoy' : n === 1 ? 'mañana' : `${n} días`}</span><button class="x" data-act="del-agenda" data-id="${h(a.id)}" aria-label="Borrar ${h(a.title)}">×</button></span></li>`;
    }).join('');
    const dueRows = pendingDated().filter((p) => L.daysBetween(t, L.parseDate(p.date)) >= 0).sort((a, b) => a.date.localeCompare(b.date)).map((p) => {
      const n = L.daysBetween(t, L.parseDate(p.date));
      return `<li><span>${h(p.name)} <span class="pill">${h(kindOf(p).n)}</span><br><span class="sub">${h(matLabel(subjOfPractice(p)))} · ${cap(longDate(L.parseDate(p.date)))}</span></span><a class="days-to" href="#material">${n === 0 ? 'hoy' : n === 1 ? 'mañana' : `${n} días`}</a></li>`;
    }).join('');
    const lateDue = pendingDated().filter((p) => L.daysBetween(t, L.parseDate(p.date)) < 0).map((p) => `<li><span>${h(p.name)} <span class="pill bad">! venció</span><br><span class="sub">${h(matLabel(subjOfPractice(p)))} · ${cap(longDate(L.parseDate(p.date)))}</span></span><a class="days-to" href="#material">ver</a></li>`).join('');
    const finalsRow = finalsDate && L.daysBetween(t, finalsDate) >= 0 ? `<li><span>Semana de finales<br><span class="sub">Desde el ${longDate(finalsDate)}</span></span><span class="days-to">${L.daysBetween(t, finalsDate)} días</span></li>` : '';

    const prRows = pracSubjects().map((k) => {
      const list = S.practices.filter((p) => subjOfPractice(p) === k);
      if (!list.length) return '';
      const p = pracStats(list);
      return `<div style="margin-top:9px"><div style="display:flex;justify-content:space-between;gap:8px;font-size:13.5px"><span>${h(matLabel(k))}</span><span class="pr-count">${p.pct !== null ? L.pct(p.pct) : `${p.done} hechos`}</span></div>${p.pct !== null ? stitch(p.pct, { n: 30 }) : ''}</div>`;
    }).join('');
    const links = S.links.map((l) => `<a href="${h(safeUrl(l.url))}" target="_blank" rel="noopener">${h(l.name)}</a>`).join('');

    return `
    <header class="head">
      <div><h1 class="hello">${h(st.greet)}, <em>${h(st.name)}</em></h1><p class="today-line">${h(line)}</p><p class="msg" id="msg">${h(currentMessage())}</p>${weeks}</div>
      ${cs.total ? `<div class="figs"><div class="fig"><b>${L.fmt(cs.avgAll)}</b><span>promedio general</span></div><div class="fig"><b>${cs.approved}<small> de ${cs.total}</small></b><span>materias aprobadas</span></div></div>` : ''}
    </header>
    <div class="hoy-flow">
    <section class="card career hoy-career" aria-label="Tu carrera, una baldosa por materia">
      <div class="card-head"><h2>${h(st.career || 'Tu carrera')}</h2>${cs.total ? `<span class="sub">${L.pct(ratio(cs.approved, cs.total))} aprobada · ${cs.current} en curso</span>` : ''}</div>
      ${cs.total ? `${careerStrip(!viewHoy.played)}<div class="zig-foot">${careerKey()}${milestoneChips()}</div>` : '<div class="empty"><b>Cargá tu plan de estudios.</b>Cada materia va a ser una baldosa que se llena a medida que aprobás.</div><div class="actions" style="justify-content:flex-start"><button class="btn" data-act="add-plan">Cargar plan de estudios</button></div>'}
    </section>
    <div class="grid g-hoy hoy-main">
      <div class="stack"><section class="card">${todayHtml}</section>${lateHtml}</div>
      ${matCards ? `<section class="card"><div class="card-head"><h2>Este cuatrimestre</h2><a class="linkish" href="#asistencia">Ver asistencia</a></div><div class="mat-grid">${matCards}</div></section>` : ''}
    </div>
    <div class="grid g-3 hoy-rest">
      <section class="card"><div class="card-head"><h2>Se viene</h2><button class="btn ghost small" data-act="add-agenda">Agregar fecha</button></div>
        ${agendaRows || dueRows || lateDue || finalsRow ? `<ul class="list">${lateDue}${agendaRows}${dueRows}${finalsRow}</ul>` : ''}
        ${!agendaRows && !dueRows && !lateDue ? '<p class="sub" style="margin-top:6px">Cargá parciales, entregas o inscripciones y aparecen acá con la cuenta regresiva.</p>' : ''}
      </section>
      <section class="card"><div class="card-head"><h2>Nota rápida</h2><span class="sub">Se guarda sola</span></div><textarea class="scratch" data-change="scratch" aria-label="Nota rápida" placeholder="Lo que no te querés olvidar para la próxima clase">${h(S.scratch)}</textarea></section>
      <section class="stack">
        <div class="card"><div class="card-head"><h2>Material</h2><a class="linkish" href="#material">Abrir</a></div>${prRows || '<p class="sub">Sumá prácticas, lecturas, videos o TP de cada materia y seguí tu avance.</p>'}</div>
        <div class="card"><div class="card-head"><h2>Accesos</h2><button class="btn ghost small" data-act="add-link">Agregar</button></div>${links ? `<div class="links">${links}</div>` : '<p class="sub">El campus, el mail, el Drive: lo que abrís todos los días.</p>'}</div>
      </section>
    </div>
    </div>`;
  }

  // ---------- ASISTENCIA
  function viewAsistencia() {
    if (!S.classes.length) {
      return '<header class="head"><div><h1>Asistencia</h1><p class="lead">Armá tu horario una vez y después solo marcás si fuiste.</p></div></header><section class="card"><div class="empty"><b>Todavía no hay clases cargadas.</b>Agregá las clases de cada materia con su día.</div><div class="actions" style="justify-content:flex-start"><button class="btn" data-act="schedule">Armar horario</button></div></section>';
    }
    const t = today();
    const wk = L.weekNumber(S, t);
    const cells = L.allCells(S);
    const total = L.tally(cells);
    const st = L.streaks(S);
    const days = L.absencesByDay(S).filter((d) => d.a + d.p);
    const worst = days.length ? days.reduce((a, b) => (b.a / (b.a + b.p) > a.a / (a.a + a.p) ? b : a), days[0]) : null;

    const groups = [];
    for (const c of S.classes) { const g = groups[groups.length - 1]; if (g && g.dow === c.dow) g.n++; else groups.push({ dow: c.dow, n: 1 }); }

    const cellBtn = (c, mini) => {
      const note = S.cellNotes[c.key];
      const isToday = L.daysBetween(c.date, t) === 0;
      const word = c.state ? STATE_WORD[c.state] : 'sin cargar';
      const tip = `${c.cls.name} · ${L.DIAS[c.cls.dow]} ${shortDate(c.date)} · ${word}${note ? ` · “${note.t}”` : ''}`;
      return `<button class="cell ${mini ? 'mini ' : ''}${c.state || ''}${isToday ? ' today' : ''}${note ? ' noted' : ''}${note && note.check ? ' check' : ''}" data-act="cell" data-key="${c.key}" ${mini ? '' : `data-tip="${h(tip)}"`} aria-label="${h(tip)}">${STATE_GLYPH[c.state] || ''}</button>`;
    };
    const rows = S.weeks.map((w, idx) => {
      const prev = S.weeks[idx - 1];
      if (w.kind !== 'clases') {
        if (prev && prev.kind === w.kind) return '';
        const span = S.weeks.filter((x) => x.kind === w.kind);
        return `<tr class="span-row"><th class="sticky wk" scope="row">${span[0].n}${span.length > 1 ? `–${span[span.length - 1].n}` : ''}</th><td colspan="${S.classes.length + 1}">${cap(w.kind)}, desde el ${shortDate(L.weekStart(S, w.n))}</td></tr>`;
      }
      const cs = cells.filter((c) => c.week === w.n);
      const tl = L.tally(cs);
      return `<tr class="${w.n === wk ? 'cur' : ''}"><th class="sticky wk" scope="row">Sem ${w.n}<small>${shortDate(L.weekStart(S, w.n))}</small></th>${cs.map((c) => `<td>${cellBtn(c)}</td>`).join('')}<td class="wbar"><div><span class="bar"><i style="width:${(tl.pct || 0) * 100}%"></i></span><span>${tl.taken ? L.pct(tl.pct) : ''}</span></div></td></tr>`;
    }).join('');
    const foot = S.classes.map((c) => `<td>${L.pct(L.tally(cells.filter((x) => x.cls.id === c.id)).pct)}</td>`).join('');

    // Celular: una semana por vez, y el mapa completo chiquito para saltar.
    const cw = L.classWeeks(S);
    let pw = ui.phoneWeek;
    if (!cw.some((w) => w.n === pw)) {
      const candidates = cw.filter((w) => w.n <= wk);
      pw = (candidates.length ? candidates[candidates.length - 1] : cw[0]).n;
    }
    ui.phoneWeek = pw;
    const pwCells = cells.filter((c) => c.week === pw);
    const pwT = L.tally(pwCells);
    const prevW = cw.filter((w) => w.n < pw).pop();
    const nextW = cw.find((w) => w.n > pw);
    const map = cw.map((w) => `<div class="map-row${w.n === pw ? ' sel' : ''}"><button class="map-wk" data-act="pick-week" data-w="${w.n}" aria-label="Ver semana ${w.n}">${w.n}</button>${cells.filter((c) => c.week === w.n).map((c) => cellBtn(c, true)).join('')}</div>`).join('');
    const phone = `<section class="card att-phone mt">
      <div class="week-pager"><button class="icon-btn" data-act="pick-week" data-w="${prevW ? prevW.n : pw}" ${prevW ? '' : 'disabled'} aria-label="Semana anterior">‹</button><div><b>Semana ${pw}${pw === wk ? ' · esta' : ''}</b><span class="sub">Desde el ${shortDate(L.weekStart(S, pw))}${pwT.taken ? ` · ${L.pct(pwT.pct)}` : ''}</span></div><button class="icon-btn" data-act="pick-week" data-w="${nextW ? nextW.n : pw}" ${nextW ? '' : 'disabled'} aria-label="Semana siguiente">›</button></div>
      ${pwCells.map((c) => classRow(c, cap(L.DIAS[c.cls.dow]))).join('')}
      <p class="section-label">Todo el cuatrimestre</p><p class="sub">Tocá un número para ir a esa semana.</p>
      <div class="att-map" style="--cols:${S.classes.length}"><div class="map-row map-head"><span></span>${S.classes.map((c) => `<span style="background:${colorOf(c.mat)}" title="${h(c.name)}"></span>`).join('')}</div>${map}</div>
      <div class="key" style="margin-top:10px">${mats().map((m) => `<span><i style="background:${colorOf(m)}"></i>${h(matLabel(m))}</span>`).join('')}</div>
    </section>`;

    const matCards = mats().map((m) => {
      const s = L.materiaStats(S, m);
      return `<div><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:5px;flex-wrap:wrap"><b style="display:inline-flex;align-items:center;gap:6px"><span class="dot" style="--mc:${colorOf(m)}"></span>${h(matLabel(m))}</b>${leftPill(s)}</div>${stitch(s.pct, { mark: S.settings.minAtt, warn: s.left < 0, n: 30 })}<p class="sub" style="margin-top:4px"><span class="num">${L.pct(s.pct)}</span> · faltaste ${s.a} de ${s.taken} · quedan ${pl(s.pending, 'clase', 'clases')}</p></div>`;
    }).join('');

    const noteItems = Object.entries(S.cellNotes).map(([k, n]) => {
      const c = cells.find((x) => x.key === k);
      if (!c || !n.t) return null;
      return { sort: c.week, html: `<li><span>${n.check ? '<span class="pill bad">! revisar</span> ' : ''}${h(n.t)}<br><span class="sub">Sem ${c.week} · ${h(c.cls.name)} · marcada ${c.state ? `“${STATE_WORD[c.state].toLowerCase()}”` : 'sin cargar'}</span></span><button class="btn ghost small" data-act="cell" data-key="${k}">Abrir</button></li>` };
    }).filter(Boolean);
    Object.entries(S.weekNotes || {}).forEach(([w, t2]) => noteItems.push({ sort: +w, html: `<li><span>${h(t2)}<br><span class="sub">Sem ${w}</span></span></li>` }));
    noteItems.sort((a, b) => a.sort - b.sort);

    return `
    <header class="head"><div><h1>Asistencia</h1><p class="lead">Mínimo ${L.pct(S.settings.minAtt)} por materia. Las clases que todavía no pasaron no cuentan como falta.</p></div>
      <div class="figs"><div class="fig"><b>${L.pct(total.pct)}</b><span>${total.p} de ${total.taken} clases</span></div></div></header>
    <section class="card"><div class="grid g-2" style="gap:16px 28px">${matCards}</div></section>
    ${phone}
    <section class="card mt att-desk"><div class="card-head"><h2>Grilla</h2><button class="btn ghost small" data-act="schedule">Editar horario</button></div><div class="table-wrap"><table class="att">
      <thead><tr class="day"><th class="sticky"></th>${groups.map((g) => `<th colspan="${g.n}" scope="colgroup">${L.DIAS[g.dow]}</th>`).join('')}<th></th></tr>
      <tr class="cl"><th class="sticky"></th>${S.classes.map((c) => `<th scope="col" style="--mc:${colorOf(c.mat)}">${h(c.name)}${c.x2 ? ' x2' : ''}<i></i></th>`).join('')}<th class="sub">Semana</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th class="sticky">Por clase</th>${foot}<td></td></tr></tfoot>
    </table></div>
    <div class="key" style="margin-top:12px"><span>✓ fui</span><span>✕ falté</span><span>– no hubo clase</span><span>vacío: sin cargar</span><span>● tiene nota</span></div></section>
    <div class="grid g-2 mt">
      <section class="card"><div class="card-head"><h2>Tus números</h2></div><div class="mini-stats">
        <div><b>${st.current}</b><span>clases seguidas sin faltar</span></div>
        <div><b>${st.best}</b><span>tu mejor racha</span></div>
        <div><b>${worst && worst.a ? cap(L.DIAS[worst.dow]) : '–'}</b><span>${worst && worst.a ? `el día que más faltás: ${L.pct(worst.a / (worst.a + worst.p))} de las clases` : 'sin faltas todavía'}</span></div>
      </div></section>
      <section class="card"><div class="card-head"><h2>Notas de las clases</h2><span class="sub">${pl(noteItems.length, 'nota', 'notas')}</span></div><ul class="list">${noteItems.map((n) => n.html).join('') || '<li class="sub">Tocá una clase para anotarle algo.</li>'}</ul></section>
    </div>
    <div class="actions att-phone" style="justify-content:flex-start"><button class="btn ghost" data-act="schedule">Editar horario</button></div>`;
  }

  // ---------- NOTAS
  function improvementCard() {
    const imp = L.improvements(S);
    if (!imp.n) return '<section class="card"><div class="card-head"><h2>Del parcial 1 al 2</h2></div><p class="sub">Cuando tengas una materia con los dos parciales, acá ves si mejoraste.</p></section>';
    const headline = imp.delta > 0 ? `Tus notas suben <b>${signedPct(imp.pct).replace('+', '')}</b> del primer al segundo parcial.` : imp.delta < 0 ? `Tus notas bajan <b>${signedPct(imp.pct).replace('−', '')}</b> del primer al segundo parcial.` : 'Tus notas se mantienen del primer al segundo parcial.';
    const rows = imp.rows.map((r) => {
      const up = r.delta > 0; const down = r.delta < 0;
      return `<div class="imp-row" data-tip="${h(r.course.name)} · ${h(termShort(r.course.year, r.course.sem))}"><span class="nm">${h(label(r.course))}</span><span class="fromto">${L.fmt(r.p1)} → ${L.fmt(r.p2)}</span><span class="pill ${up ? 'ok' : down ? 'bad' : ''}">${up ? '▲ subió' : down ? '▼ bajó' : '= igual'} ${up || down ? `${L.fmt(Math.abs(r.delta))}${r.pct !== null ? ` (${Math.round(Math.abs(r.pct) * 100)}%)` : ''}` : ''}</span></div>`;
    }).join('');
    return `<section class="card"><div class="card-head"><h2>Del parcial 1 al 2</h2></div>
      <p class="imp-head">${headline}</p>
      <div class="imp-big">
        <div><b>${imp.up} de ${imp.n}</b><span>materias en las que mejoraste</span></div>
        <div><b>${L.fmt(imp.avgP1)} → ${L.fmt(imp.avgP2)}</b><span>tu promedio, de un parcial al otro</span></div>
      </div>
      ${imp.best ? `<p class="sub" style="margin-bottom:8px">Tu mayor salto: ${h(label(imp.best.course))}, de ${L.fmt(imp.best.p1)} a ${L.fmt(imp.best.p2)}.</p>` : ''}
      ${rows}</section>`;
  }
  // Lo que dice cada materia según las notas que tenga cargadas.
  function partialsHtml(p1, p2) {
    if (p1 == null && p2 == null) return '<span class="sub">Cargá la nota del parcial 1 y te digo cuánto necesitás en el 2.</span>';
    if (p1 == null) return '<span class="sub">Falta la nota del parcial 1.</span>';
    if (p2 == null) {
      const chips = [4, 6, 8].map((t) => {
        const need = 2 * t - p1;
        if (need <= 0) return `<span class="need ok">Para promediar ${t}: <b>ya llegás</b></span>`;
        if (need > 10) return `<span class="need no">Para promediar ${t}: no alcanza</span>`;
        return `<span class="need">Para promediar ${t}: sacá <b>${L.fmt(need, 1)}</b></span>`;
      }).join('');
      return `<span class="sub">En el parcial 2 necesitás:</span><div class="need-list">${chips}</div>`;
    }
    const a = (p1 + p2) / 2;
    const ok = a >= 4;
    return `<span class="avg-line">Promedio de parciales: <b>${L.fmt(a)}</b></span> <span class="pill ${ok ? 'ok' : 'bad'}">${ok ? 'llegás a 4' : `te falta ${L.fmt(4 - a)} para 4`}</span>`;
  }
  // Recalcula mientras escribís, sin esperar a salir del casillero.
  document.addEventListener('input', (e) => {
    const row = e.target.closest && e.target.closest('.cur-row');
    if (!row || e.target.dataset.change !== 'grade') return;
    const val = (f) => { const r = L.parseGrade(row.querySelector(`[data-f="${f}"]`).value); return r.ok ? { v: r.value } : null; };
    const a = val('p1'); const b = val('p2');
    const out = row.querySelector('[data-live]');
    if (!a || !b) { out.innerHTML = '<span class="sub">La nota tiene que ser un número de 0 a 10.</span>'; return; }
    out.innerHTML = partialsHtml(a.v, b.v);
  });
  function viewNotas() {
    const cs = L.careerStats(S);
    const current = S.courses.filter(L.isCurrent);
    const curRows = current.map((c) => `<div class="cur-row" data-row="${h(c.id)}">
      <button class="name-btn cur-name" data-act="course" data-id="${h(c.id)}">${h(label(c))}</button>
      <label class="cur-in">Parcial 1<input class="grade-in" inputmode="decimal" data-change="grade" data-id="${h(c.id)}" data-f="p1" value="${h(c.p1 == null ? '' : L.fmt(c.p1))}" aria-label="Parcial 1 de ${h(label(c))}"></label>
      <label class="cur-in">Parcial 2<input class="grade-in" inputmode="decimal" data-change="grade" data-id="${h(c.id)}" data-f="p2" value="${h(c.p2 == null ? '' : L.fmt(c.p2))}" aria-label="Parcial 2 de ${h(label(c))}"></label>
      <div class="cur-msg" data-live aria-live="polite">${partialsHtml(c.p1, c.p2)}</div>
    </div>`).join('');

    const finals = S.courses.filter((c) => c.final != null);
    const axis = '<div class="axis"><span></span><div><span>0</span><span>5</span><span>10</span></div><span></span></div>';
    const bars = finals.map((c) => `<div class="hbar" data-tip="${h(c.name)} · ${h(termShort(c.year, c.sem))} · final ${L.fmt(c.final)}"><span class="lbl">${h(label(c))}</span><span class="track"><span class="fill${c.final < 4 ? ' low' : ''}" style="width:${c.final * 10}%"></span></span><span class="val">${L.fmt(c.final)}</span></div>`).join('');
    const sem = L.semesterAverages(S);
    const semBars = sem.map((g) => `<div class="hbar" data-tip="${h(termShort(g.year, g.sem))}: ${L.fmt(g.avg)} con ${pl(g.finals.length, 'final', 'finales')}"><span class="lbl">${h(termShort(g.year, g.sem))}</span><span class="track"><span class="fill" style="width:${g.avg * 10}%"></span></span><span class="val">${L.fmt(g.avg)}</span></div>`).join('');

    const retries = L.subjects(S).filter((c) => c.attempts > 1);
    const triesHtml = retries.map((r) => {
      const tries = S.courses.filter((c) => c.subj === r.subj);
      return `<section class="card mt"><div class="card-head"><h2>${h(label(r))}, intento por intento</h2></div><div class="tries">${tries.map((c, i) => `<div class="try${L.isCurrent(c) ? ' live' : ''}"><h3>Intento ${i + 1} · ${h(termShort(c.year, c.sem))}</h3><div class="grades"><span><b>${L.fmt(c.p1)}</b>Parcial 1</span><span><b>${L.fmt(c.p2)}</b>Parcial 2</span><span><b>${L.fmt(c.final)}</b>Final</span></div></div>`).join('')}</div></section>`;
    }).join('');

    return `
    <header class="head"><div><h1>Notas</h1></div>
      ${cs.avgAll !== null ? `<div class="figs"><div class="fig"><b>${L.fmt(cs.avgAll)}</b><span>con desaprobados</span></div><div class="fig"><b>${L.fmt(cs.avgApproved)}</b><span>solo aprobadas</span></div></div>` : ''}</header>
    <section class="card"><div class="card-head"><h2>Tus parciales de este cuatrimestre</h2></div>
      <p class="sub" style="margin:-4px 0 6px">Cargá tus notas y te digo cuánto necesitás. Se calcula como el promedio de los dos parciales; tu materia puede tener otra regla.</p>
      ${current.length ? `${curRows}<p class="err" id="grade-err" role="alert"></p>` : '<p class="sub">Marcá en Carrera qué materias estás cursando y aparecen acá.</p>'}</section>
    ${triesHtml}
    <div class="grid g-2 mt">
      <div class="stack">
        ${improvementCard()}
      </div>
      <div class="stack">
        ${finals.length ? `<section class="card"><div class="card-head"><h2>Finales</h2><span class="sub">${finals.length} rendidos, en orden</span></div>${bars}${axis}</section>` : ''}
        ${sem.length ? `<section class="card"><div class="card-head"><h2>Promedio por ${h((S.settings.termWord || 'semestre').toLowerCase())}</h2></div>${semBars}${axis}</section>` : ''}
      </div>
    </div>`;
  }

  // ---------- CARRERA
  function viewCarrera() {
    const cs = L.careerStats(S);
    const st = S.settings;
    const yrs = [...new Set(S.courses.map((c) => c.year))].sort((a, b) => a - b);
    let body = '';
    yrs.forEach((y) => {
      const yc = S.courses.filter((c) => c.year === y);
      body += `<h2 class="year-h">${y}° año</h2>`;
      [...new Set(yc.map((c) => c.sem))].forEach((sem) => {
        const sc = yc.filter((c) => c.sem === sem);
        const mile = (S.milestones || []).filter((m) => m.year === y && m.sem === sem);
        const a = L.avg(sc.map((c) => c.final));
        body += `<div class="sem-h">${h(termLabel(sem))}${a != null ? ` <span class="num sub">promedio ${L.fmt(a)}</span>` : ''}${mile.map((m) => `<span class="mile">${h(m.text)} <button style="background:none;border:0;cursor:pointer;color:inherit" data-act="del-mile" data-id="${h(m.text)}" aria-label="Borrar hito">×</button></span>`).join('')}</div>
        <div class="table-wrap"><table class="t t-car"><thead><tr><th style="width:48%">Materia</th><th class="hide-sm">Estado</th><th class="n hide-sm">P1</th><th class="n hide-sm">P2</th><th class="n">Final</th></tr></thead><tbody>
        ${sc.map((c) => { const pill = `<span class="pill ${L.isApproved(c) ? 'ok' : c.status === 'desaprobada' ? 'bad' : L.isCurrent(c) ? 'hi' : ''}">${h(statusLabel(c.status))}</span>`; return `<tr class="click" data-act="course" data-id="${h(c.id)}"><td><button class="name-btn" data-act="course" data-id="${h(c.id)}">${h(c.name)}</button>${c.note ? ` <span class="sub" data-tip="${h(c.note)}">●</span>` : ''}<div class="show-sm" style="margin-top:3px">${pill}</div></td><td class="hide-sm">${pill}</td><td class="n hide-sm">${L.fmt(c.p1)}</td><td class="n hide-sm">${L.fmt(c.p2)}</td><td class="n">${L.fmt(c.final)}</td></tr>`; }).join('')}
        </tbody></table></div>`;
      });
    });
    const lead = cs.total ? `${pl(cs.total - cs.approved - cs.current, 'materia', 'materias')} por delante, ${cs.current} en curso, ${pl(cs.approved, 'aprobada', 'aprobadas')}${st.entryYear ? `. Empezaste en ${h(st.entryYear)}` : ''}${st.university ? ` · ${h(st.university)}` : ''}.` : 'Cargá tu plan y mirá cuánto te falta.';
    return `
    <header class="head"><div><h1>${h(st.career || 'Tu carrera')}</h1><p class="lead">${lead}</p></div>
      ${cs.total ? `<div class="figs"><div class="fig"><b>${L.pct(ratio(cs.approved, cs.total))}</b><span>de la carrera</span></div></div>` : ''}</header>
    ${cs.total ? `<section class="card career">${careerStrip(false)}<div class="zig-foot">${careerKey()}</div></section>` : ''}
    <section class="card mt"><div class="card-head"><h2>Plan de estudios</h2><span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn ghost small" data-act="add-plan">Agregar materias</button>${cs.total ? '<button class="btn ghost small" data-act="add-mile">Agregar hito</button>' : ''}</span></div>${body || '<p class="sub">Todavía no hay materias. Pegá la lista de tu plan y se arma sola.</p>'}</section>`;
  }

  // ---------- MATERIAL
  function materialRow(p) {
    const k = kindOf(p);
    const d = p.items.filter(Boolean).length;
    const dateTxt = p.date ? `<span class="sub mat-date${!isComplete(p) && L.daysBetween(today(), L.parseDate(p.date)) < 0 ? ' late' : ''}">${shortDate(L.parseDate(p.date))}</span>` : '';
    const linkTxt = p.link ? `<a class="linkish" href="${h(safeUrl(p.link))}" target="_blank" rel="noopener">Abrir</a>` : '';
    const edit = `<button class="linkish" data-act="edit-prac" data-id="${h(p.id)}" aria-label="Editar ${h(p.name)}">Editar</button>`;
    if (p.single) {
      return `<div class="mat-row"><button class="mat-check" aria-pressed="${!!p.items[0]}" data-act="ex" data-id="${h(p.id)}" data-i="0" aria-label="${p.items[0] ? 'Marcar sin hacer' : 'Marcar como hecho'}: ${h(p.name)}">${p.items[0] ? '✓' : ''}</button><span class="mat-name${p.items[0] ? ' done' : ''}">${h(p.name)}</span><span class="pill">${h(k.n)}</span>${dateTxt}<span class="mat-tools">${linkTxt}${edit}</span></div>`;
    }
    return `<details class="pr" data-id="${h(p.id)}"${ui.openPrac.has(p.id) ? ' open' : ''}><summary><b>${h(p.name)}</b>${p.known ? stitch(ratio(d, p.items.length), { n: 40, label: `${d} de ${p.items.length}` }) : '<span class="sub">Falta el total</span>'}<span class="pr-count">${p.known ? `${d} de ${p.items.length}` : `${d} ${d === 1 ? 'hecho' : 'hechos'}`}</span></summary>
    <div class="pr-body"><div class="pr-meta"><span class="pill">${h(k.n)}</span>${dateTxt}</div><div class="ex-grid">${p.items.map((v, i) => `<button class="ex" aria-pressed="${!!v}" data-act="ex" data-id="${h(p.id)}" data-i="${i}" aria-label="${h(k.one)} ${i + 1}, ${h(p.name)}">${i + 1}</button>`).join('')}${p.known ? '' : `<button class="ex add" data-act="ex-add" data-id="${h(p.id)}" aria-label="Sumar ${h(k.one)} hecho en ${h(p.name)}">+</button>`}</div>
    <div class="pr-tools"><label>Tiene <input class="grade-in" inputmode="numeric" data-change="prac-total" data-id="${h(p.id)}" value="${p.known ? p.items.length : ''}" placeholder="?" aria-label="Cantidad de ${h(k.unit)} de ${h(p.name)}"> ${h(k.unit)}</label><button class="linkish" data-act="prac-all" data-id="${h(p.id)}">Tildar todo</button>${linkTxt}${edit}<button class="linkish danger" data-act="del-prac" data-id="${h(p.id)}">Borrar</button></div></div></details>`;
  }
  function viewMaterial() {
    const subs = pracSubjects();
    const all = pracStats(S.practices);
    const filter = subs.includes(ui.pracFilter) ? ui.pracFilter : null;
    const present = Object.keys(KINDS).filter((k) => S.practices.some((p) => (p.kind || 'practica') === k));
    const kindF = present.includes(ui.kindFilter) ? ui.kindFilter : null;
    const summary = subs.map((k) => {
      const p = pracStats(S.practices.filter((x) => subjOfPractice(x) === k));
      const line = !p.count ? 'Sin material todavía' : p.pct !== null ? `<b>${p.complete} de ${p.count}</b> ${p.count === 1 ? 'terminado' : 'terminados'}${p.unknown ? ` · ${p.unknown} sin total` : ` · ${L.pct(p.pct)}`}` : `<b>${p.done}</b> ejercicios hechos · falta cargar los totales`;
      return `<button class="pr-card" data-act="prac-filter" data-k="${h(k)}" aria-pressed="${filter === k}"><h3><span class="dot" style="--mc:${colorOf(k)}"></span>${h(matLabel(k))}</h3>${stitch(p.pct || 0, { n: 30, label: `Avance de ${matLabel(k)}: ${L.pct(p.pct || 0)}` })}<p>${line}</p></button>`;
    }).join('');
    const chips = present.length > 1 ? `<div class="choice kind-chips" role="group" aria-label="Filtrar por tipo"><button data-act="kind-filter" data-k="" aria-pressed="${!kindF}">Todo</button>${present.map((k) => `<button data-act="kind-filter" data-k="${k}" aria-pressed="${kindF === k}">${h(KINDS[k].many)}</button>`).join('')}</div>` : '';
    const shown = filter ? [filter] : subs;
    const sections = shown.map((k) => {
      const list = S.practices.filter((p) => subjOfPractice(p) === k && (!kindF || (p.kind || 'practica') === kindF));
      if (kindF && !list.length) return '';
      const co = latestOf(k);
      return `<section class="card mt"><div class="card-head"><h2 style="display:flex;align-items:center;gap:8px"><span class="dot" style="--mc:${colorOf(k)}"></span>${h(matLabel(k))}</h2><button class="btn ghost small" data-act="add-prac" data-course="${h(co ? co.id : '')}">Agregar material</button></div>${list.map(materialRow).join('') || '<p class="sub">Sumá lo primero de esta materia: una práctica, una lectura, un video o un TP.</p>'}</section>`;
    }).join('');
    return `
    <header class="head"><div><h1>Material</h1><p class="lead">Todo lo que tenés que hacer de cada materia. Tocá una para ver solo esa.</p></div>
      ${all.count ? `<div class="figs"><div class="fig"><b>${all.complete}<small> de ${all.count}</small></b><span>terminados</span></div></div>` : ''}</header>
    ${subs.length ? `<div class="pr-sum">${summary}</div>` : '<section class="card"><div class="empty"><b>Todavía no hay materias en curso.</b>Marcá qué estás cursando en Carrera, o agregá material a cualquier materia.</div></section>'}
    ${chips}
    ${sections}
    <div class="actions" style="justify-content:flex-start"><button class="btn ghost" data-act="add-prac" data-course="">Agregar material de otra materia</button></div>`;
  }

  // ---------- Entrar
  function viewAuth() {
    const mode = ui.authMode;
    const signup = mode === 'signup';
    const zig = Array.from({ length: 22 }, (_, i) => {
      const m = [70, 45, 88, 55, 96, 40, 76, 62][i % 8];
      return `<i class="${i === 8 || i === 10 ? 'now' : i > 10 ? 'next' : ''}" style="--m:${m}%"></i>`;
    }).join('');
    const hero = `<div><h1>Toda tu carrera, <em>en una pestaña.</em></h1>
      <p class="auth-lead">Asistencia, notas, prácticas y plan de estudios en un panel que armás a tu gusto.</p>
      <div class="auth-zig" aria-hidden="true">${zig}</div></div>`;
    const notice = ui.authNotice ? `<p class="auth-note" role="status">${h(ui.authNotice)}</p>` : '';
    const google = `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.7H9v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5Z"/><path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.3c-.8.6-1.9.9-3.1.9-2.4 0-4.4-1.6-5.1-3.7H.9v2.3A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3Z"/><path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3L15 2.4A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z"/></svg>`;
    let card;
    if (mode === 'forgot') {
      card = `<h2 class="auth-title">Recuperar tu contraseña</h2><p class="sub">Te mandamos un link para elegir una nueva.</p>${notice}
      <form data-form="forgot"><div class="fields"><label class="field">Mail<input name="email" type="email" required autocomplete="email"></label></div><p class="err" id="auth-err" role="alert"></p><div class="actions" style="justify-content:stretch;margin-top:4px"><button class="btn" style="flex:1" type="submit">Enviar link</button></div></form>
      <p class="switch"><button class="linkish" data-act="auth-to" data-to="login">Volver a entrar</button></p>`;
    } else {
      card = `<h2 class="auth-title">${signup ? 'Crear tu cuenta' : 'Entrar'}</h2>${notice}
      ${Backend.can.google ? `<button class="btn ghost google-btn" data-act="google">${google}Seguir con Google</button><p class="auth-or"><span>o con tu mail</span></p>` : ''}
      <form data-form="${signup ? 'signup' : 'login'}"><div class="fields">
        ${signup ? '<label class="field">Nombre<input name="name" required autocomplete="given-name" maxlength="60"></label>' : ''}
        <label class="field">Mail<input name="email" type="email" required autocomplete="email"></label>
        <label class="field">Contraseña<input name="password" type="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}">${signup ? '<span class="sub" style="font-weight:400">Al menos 8 caracteres.</span>' : ''}</label>
      </div><p class="err" id="auth-err" role="alert"></p><div class="actions" style="justify-content:stretch;margin-top:4px"><button class="btn" style="flex:1" type="submit">${signup ? 'Crear cuenta' : 'Entrar'}</button></div></form>
      ${!signup && Backend.can.forgot ? '<p class="switch" style="margin-bottom:0"><button class="linkish" data-act="auth-to" data-to="forgot">Me olvidé la contraseña</button></p>' : ''}
      <p class="switch">${signup ? '¿Ya tenés cuenta?' : '¿Primera vez acá?'} <button class="linkish" data-act="auth-to" data-to="${signup ? 'login' : 'signup'}">${signup ? 'Entrar' : 'Crear cuenta'}</button></p>`;
    }
    return `<div class="auth">${hero}<section class="card">${card}</section></div>`;
  }
  function viewRecovery() {
    return `<div class="auth"><div><h1>Elegí una <em>contraseña nueva.</em></h1><p class="auth-lead">Después entrás directo a tu panel.</p></div>
    <section class="card"><h2 class="auth-title">Contraseña nueva</h2><form data-form="recovery"><div class="fields"><label class="field">Contraseña nueva<input name="password" type="password" required minlength="8" autocomplete="new-password"><span class="sub" style="font-weight:400">Al menos 8 caracteres.</span></label></div><p class="err" id="auth-err" role="alert"></p><div class="actions" style="justify-content:stretch;margin-top:4px"><button class="btn" style="flex:1" type="submit">Guardar contraseña</button></div></form></section></div>`;
  }

  // ---------- Primeros pasos
  const WIZ = ['Vos', 'Plan', 'Materias', 'Horario', 'Colores'];
  function planPreviewHtml(text) {
    const p = L.parsePlan(text);
    if (!p.items.length) return text.trim() ? 'No encontré materias. Revisá que haya una por línea.' : 'Acá vas a ver las materias que detectemos.';
    const years = [...new Set(p.items.map((i) => i.year))];
    const list = years.map((y) => `<li><b>${y}° año</b>${p.items.filter((i) => i.year === y).map((i) => h(i.name)).join(' · ')}</li>`).join('');
    const warn = p.items.length > 80 ? 'Son muchas para un plan de estudios. Fijate que el archivo sea el correcto.' : p.items.length < 5 ? 'Son pocas para un plan completo. Fijate si falta algo.' : '';
    return `Detecté <b>${pl(p.items.length, 'materia', 'materias')}</b> en ${pl(years.length, 'año', 'años')}. Si sobra o falta algo, corregilo en el recuadro.${warn ? `<p class="auth-note">${warn}</p>` : ''}<ul class="plan-list">${list}</ul>`;
  }
  const AI_PROMPT = `Te adjunto el plan de estudios de mi carrera. Armá la lista de todas las materias con este formato exacto:

1er año
Semestre A
Nombre de la materia
Nombre de la materia
Semestre B
Nombre de la materia

2do año
Semestre A
Nombre de la materia

Reglas:
- Una materia por línea, con el nombre tal como figura en el plan.
- Sin códigos, horas, créditos, correlativas ni notas.
- Si mi plan usa cuatrimestres, escribí "Cuatrimestre 1" y "Cuatrimestre 2" en lugar de "Semestre A" y "Semestre B".
- Si una materia dura todo el año, ponela debajo de un título "Anual".
- Si hay optativas sin nombre definido, escribilas como "Optativa 1", "Optativa 2", y así.
- No inventes materias. Si no podés leer una parte del archivo, avisame antes de la lista y no completes lo que falta.
- Respondé con la lista dentro de un solo bloque de código, para copiarla fácil.`;
  function planInputHtml(value, intro) {
    return `<div class="plan-guide">
        <h3>Qué necesitás</h3>
        <p>El <b>plan de estudios oficial</b> de tu carrera, con la lista de materias por año. Suele estar en la web de tu facu. No sirven tu analítico, un certificado ni el programa de una sola materia.</p>
        <div class="plan-ways">
          <section class="plan-way"><h3>Con tu IA <span class="pill ok">la más fácil</span></h3>
            <ol><li>Abrí ChatGPT, Claude, Gemini o la que uses.</li><li>Copiá esta instrucción, pegala ahí y adjuntá tu plan. También sirve una foto o un PDF escaneado.</li><li>Pegá la respuesta en el recuadro de abajo.</li></ol>
            <div class="plan-ai"><button type="button" class="btn" data-act="copy-prompt">Copiar instrucción</button><details><summary>Ver la instrucción</summary><pre class="prompt-box" id="ai-prompt" tabindex="0">${h(AI_PROMPT)}</pre></details></div>
            <p class="sub">Revisá que tu plan no tenga datos personales antes de compartirlo con una IA.</p>
          </section>
          <section class="plan-way"><h3>Con el archivo</h3>
            <p>Funciona con PDF con texto seleccionable, Excel (.xlsx), CSV o texto. Las fotos y los PDF escaneados no se pueden leer acá.</p>
            <div class="plan-up"><label class="btn ghost plan-file">Subir mi plan<input class="vh" type="file" accept=".pdf,.xlsx,.csv,.txt" data-change="plan-file" aria-label="Subir plan de estudios"></label></div>
            <p class="sub" id="plan-status" role="status"></p>
          </section>
        </div>
      </div>
      <div id="plan-sheet-wrap"></div>
      <p class="or-line"><b>Tu lista de materias.</b> Pegala acá o corregí lo que se detectó. Una materia por línea:</p>
      <textarea class="plan-in" id="plan-text" name="plan" aria-label="Plan de estudios" placeholder="${h(PLAN_HINT)}">${h(value)}</textarea>
      <div class="ok-line" id="plan-preview" aria-live="polite">${intro || planPreviewHtml(value)}</div>`;
  }
  function setPlanText(text) {
    const t = $('#plan-text');
    if (!t) return;
    t.value = text;
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }
  async function planFileChosen(el) {
    const file = el.files[0];
    if (!file) return;
    const status = $('#plan-status');
    const wrap = $('#plan-sheet-wrap');
    status.textContent = `Leyendo ${file.name}…`;
    wrap.innerHTML = '';
    try {
      const { sheets } = await window.CursadaImport.read(file);
      const best = window.CursadaImport.bestSheet(sheets, L.parsePlan);
      ui.planSheets = sheets;
      if (sheets.length > 1) wrap.innerHTML = `<label class="field plan-sheet">Hoja del archivo<select data-change="plan-sheet">${sheets.map((x, i) => `<option value="${i}"${i === best ? ' selected' : ''}>${h(x.name)}</option>`).join('')}</select></label>`;
      setPlanText(sheets[best].text);
      const found = L.parsePlan(sheets[best].text).items.length;
      status.textContent = found ? `Leído: ${file.name}. Revisá la lista de abajo.` : `Abrí ${file.name}, pero no encontré materias. Probá con tu IA.`;
    } catch (e) {
      const why = { tipo: 'Ese tipo de archivo no se puede leer acá. Probá con tu IA, que también entiende fotos.', grande: 'El archivo pesa más de 15 MB.', 'sin-texto': 'Ese PDF parece escaneado y no tiene texto para leer. Probá con tu IA.', formato: 'No pude abrir ese archivo. Probá guardarlo de nuevo o pegá la lista a mano.' };
      status.textContent = why[e.message] || 'No pude leer ese archivo. Probá de nuevo o pegá la lista a mano.';
    }
    el.value = '';
  }
  function applyPlan(text) {
    const p = L.parsePlan(text);
    let added = 0;
    p.items.forEach((it) => {
      if (S.courses.some((c) => c.subj === L.slug(it.name))) return;
      S.courses.push(newCourse(it.name, it.year, it.sem)); added++;
    });
    if (p.word) S.settings.termWord = p.word;
    S.courses.sort((a, b) => a.year - b.year || String(a.sem).localeCompare(String(b.sem)));
    return added;
  }
  const PLAN_HINT = '1er año\nSemestre A\nÁlgebra\nEconomía I\nSemestre B\nCálculo\n\n2do año\n...';
  function scheduleHtml() {
    const st = S.settings;
    const nums = (k) => S.weeks.filter((w) => w.kind === k).map((w) => w.n).join(', ');
    const cur = S.courses.filter(L.isCurrent);
    const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    return `<div class="fields c2">
      <label class="field">Primer lunes del cuatrimestre<input type="date" data-change="sem" data-f="semStart" value="${h(st.semStart)}"></label>
      <label class="field">Semanas en total<input inputmode="numeric" data-change="sem" data-f="total" value="${S.weeks.length}"></label>
      <label class="field">Semanas de parciales<input data-change="sem" data-f="parciales" value="${h(nums('parciales'))}" placeholder="9, 10"></label>
      <label class="field">Semanas de finales<input data-change="sem" data-f="finales" value="${h(nums('finales'))}" placeholder="18, 19"></label>
      <label class="field">Asistencia mínima (%)<input inputmode="numeric" data-change="sem" data-f="minAtt" value="${Math.round(st.minAtt * 100)}"></label>
    </div><p class="err" id="sem-err" role="alert"></p>
    <p class="section-label">Tus clases</p>
    <div>${S.classes.map((c) => `<div class="cls-row"><span style="display:inline-flex;align-items:center;gap:7px;flex-wrap:wrap"><span class="dot" style="--mc:${colorOf(c.mat)}"></span>${h(c.name)}${c.x2 ? ' <span class="pill">x2</span>' : ''} <span class="sub">${L.DIAS[c.dow]}</span></span><button class="linkish" data-act="del-class" data-id="${h(c.id)}" aria-label="Borrar ${h(c.name)}">Borrar</button></div>`).join('') || '<p class="sub">Todavía no agregaste clases.</p>'}</div>
    ${cur.length ? `<form data-form="class"><div class="fields c2" style="margin-top:12px">
      <label class="field">Materia<select name="course">${cur.map((c) => `<option value="${h(c.id)}">${h(label(c))}</option>`).join('')}</select></label>
      <label class="field">Tipo de clase<input name="tipo" required value="Teórica" list="tipos"><datalist id="tipos"><option value="Teórica"><option value="Práctica"><option value="Tutorial"><option value="Problemas"><option value="Taller"></datalist></label>
      <label class="field">Día<select name="dow">${days.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select></label>
      <label class="field" style="align-content:end"><span style="display:flex;gap:7px;align-items:center;min-height:38px"><input type="checkbox" name="x2" style="width:auto"> Es doble</span></label>
    </div><div class="actions" style="justify-content:flex-start;margin-top:10px"><button class="btn ghost" type="submit">Agregar clase</button></div></form>` : '<p class="sub" style="margin-top:8px">Marcá qué estás cursando en Carrera para poder agregar sus clases.</p>'}`;
  }
  function viewWizard() {
    const st = S.settings;
    const step = st.wizStep || 0;
    const steps = `<div class="wiz-steps" role="img" aria-label="Paso ${step + 1} de ${WIZ.length}">${WIZ.map((_, i) => `<i class="${i < step ? 'done' : i === step ? 'now' : ''}"></i>`).join('')}</div>`;
    const nav = (nextLabel, skip) => `<div class="wiz-nav">${step ? '<button class="btn ghost" data-act="wiz-back">Volver</button>' : '<span></span>'}<span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${skip ? `<button class="linkish" data-act="wiz-next">${skip}</button>` : ''}<button class="btn" data-act="${step === WIZ.length - 1 ? 'wiz-finish' : 'wiz-next'}">${nextLabel}</button></span></div>`;
    let body = '';
    if (step === 0) {
      body = `<h1>Contanos de vos</h1><p class="lead">Con esto armamos tu panel. Lo podés cambiar cuando quieras.</p>
      <section class="card">
        <label class="field">Cómo te llamamos<input data-change="setting" data-f="name" value="${h(st.name)}" maxlength="40"></label>
        <p class="section-label">Cómo querés que te saludemos</p><div class="choice" style="margin-top:6px">${GREETS.map((g) => `<button data-act="greet" data-v="${g}" aria-pressed="${st.greet === g}">${g}</button>`).join('')}</div>
        <div class="fields c2">${comboField('Universidad', 'university', 'universities', st.university)}${comboField('Carrera', 'career', 'careers', st.career)}${yearField(st.entryYear)}</div>
        <hr class="divider"><p class="sub">Si ya tenés una copia de tus datos, importala y salteás todo esto.</p>
        <div class="actions" style="justify-content:flex-start;margin-top:8px"><label class="btn ghost plan-file">Importar copia<input class="vh" type="file" data-change="import" aria-label="Importar copia de tus datos"></label></div><p class="err" id="set-err" role="alert"></p>
      </section>${nav('Seguir')}`;
    } else if (step === 1) {
      body = `<h1>Tu plan de estudios</h1><p class="lead">Cargá las materias de tu carrera una sola vez. Elegí la forma que te quede más cómoda.</p>
      <section class="card">${planInputHtml(ui.planDraft, S.courses.length && !ui.planDraft ? `Ya tenés ${pl(S.courses.length, 'materia cargada', 'materias cargadas')}. Lo que agregues se suma.` : '')}</section>${nav('Seguir', 'Lo cargo después')}`;
    } else if (step === 2) {
      const yrs = [...new Set(S.courses.map((c) => c.year))].sort((a, b) => a - b);
      const opts = [['proximamente', 'Falta'], ['cursando', 'Cursando'], ['aprobada 1ra instancia', 'Aprobada']];
      const list = yrs.map((y) => `<h2 class="year-h" style="margin-top:12px">${y}° año</h2>${S.courses.filter((c) => c.year === y).map((c) => `<div class="subj-row"><span style="flex:1 1 180px">${h(c.name)}</span><span style="display:flex;gap:8px;align-items:center">${L.isApproved(c) ? `<input class="grade-in" inputmode="decimal" placeholder="Nota" aria-label="Nota final de ${h(c.name)}" data-change="grade" data-id="${h(c.id)}" data-f="final" value="${h(c.final == null ? '' : L.fmt(c.final))}">` : ''}<span class="seg" role="group" aria-label="Estado de ${h(c.name)}">${opts.map(([v, n]) => `<button data-act="wiz-status" data-id="${h(c.id)}" data-s="${v}" aria-pressed="${c.status === v}">${n}</button>`).join('')}</span></span></div>`).join('')}`).join('');
      body = `<h1>¿En qué andás?</h1><p class="lead">Marcá lo que ya aprobaste y lo que estás cursando. La nota es opcional.</p><section class="card">${list || '<p class="sub">Sin plan cargado todavía: podés agregarlo después desde Carrera.</p>'}<p class="err" id="grade-err" role="alert"></p></section>${nav('Seguir', 'Lo hago después')}`;
    } else if (step === 3) {
      body = `<h1>Tu horario</h1><p class="lead">Agregá las clases de cada materia. Después solo marcás si fuiste.</p><section class="card">${scheduleHtml()}</section>${nav('Seguir', 'Lo armo después')}`;
    } else {
      body = `<h1>Hacelo tuyo</h1><p class="lead">Elegí un tema o tu propio color. Se aplica al toque.</p><section class="card">${themePicker()}</section>${nav('Entrar a mi panel')}`;
    }
    return `<div class="wiz">${steps}${body}</div>`;
  }

  // ---------- Diálogos
  const modal = () => $('#modal');
  function openModal(html) { const m = modal(); m.innerHTML = `<button class="icon-btn close" data-act="close" aria-label="Cerrar">×</button>${html}`; if (!m.open) m.showModal(); }
  function closeModal() { const m = modal(); if (m.open) m.close(); }

  function cellDialog(key) {
    const [w, id] = key.split(':');
    const c = S.classes.find((x) => x.id === id);
    if (!c) return;
    const d = L.cellDate(S, +w, c);
    const state = S.att[key] || null;
    const note = S.cellNotes[key];
    openModal(`<h2 id="modal-title">${h(c.name)}</h2><p class="sub">Semana ${w} · ${longDate(d)}</p>
      <div style="margin-top:14px">${segButtons(key, state)} ${state ? `<button class="linkish" style="margin:8px 0 0 2px;display:inline-block" data-act="mark" data-key="${key}" data-s="">Dejar sin cargar</button>` : ''}</div>
      <label class="field" style="margin-top:14px">Nota<textarea rows="2" data-change="cell-note" data-key="${key}" placeholder="Cancelada, consultar, tema de la clase…">${h(note ? note.t : '')}</textarea></label>
      ${note && note.check ? `<div class="actions" style="justify-content:flex-start"><button class="btn ghost small" data-act="resolve" data-key="${key}">Ya lo revisé</button></div>` : ''}`);
  }
  function courseDialog(id) {
    const c = course(id);
    if (!c) return;
    const hasClass = S.classes.find((x) => x.course === id);
    let extra = '';
    if (hasClass) {
      const m = L.materiaStats(S, hasClass.mat);
      extra += `<p class="section-label">Asistencia</p><div style="margin:6px 0">${stitch(m.pct, { mark: S.settings.minAtt, warn: m.left < 0, n: 40 })}</div><p class="sub"><span class="num">${L.pct(m.pct)}</span> · faltaste ${m.a} de ${m.taken} · ${leftPill(m)}</p>`;
    }
    const prs = S.practices.filter((p) => p.course === id);
    if (prs.length) extra += `<p class="section-label">Material</p><p class="sub">${pracStats(prs).complete} de ${pl(prs.length, 'material terminado', 'materiales terminados')}. <a href="#material" data-act="close-go">Abrir material</a></p>`;
    const attempts = S.courses.filter((x) => x.subj === c.subj);
    const active = hasClass || prs.length || L.isCurrent(c);
    openModal(`<h2 id="modal-title">${h(c.name)}</h2><p class="sub">${h(termShort(c.year, c.sem))}${attempts.length > 1 ? ` · intento ${attempts.indexOf(c) + 1} de ${attempts.length}` : ''}</p>
      <div class="fields c2"><label class="field">Estado<select data-change="course" data-id="${h(id)}" data-f="status">${STATUS.map((s) => `<option value="${s}"${s === c.status ? ' selected' : ''}>${statusLabel(s)}</option>`).join('')}</select></label>
      <label class="field">Nombre corto<input data-change="course" data-id="${h(id)}" data-f="short" value="${h(c.short)}" placeholder="Para las tarjetas"></label></div>
      <div class="fields c3">${[['p1', 'Parcial 1'], ['p2', 'Parcial 2'], ['final', 'Final']].map(([f, l]) => `<label class="field">${l}<input inputmode="decimal" data-change="grade" data-id="${h(id)}" data-f="${f}" value="${h(c[f] == null ? '' : L.fmt(c[f]))}"></label>`).join('')}</div>
      <p class="err" id="grade-err" role="alert"></p>
      <p class="sub">Estimado: <span class="num" id="est-val">${L.fmt(L.estimate(c))}</span>, el promedio de los parciales.</p>
      ${extra}
      <div class="fields">
      ${active ? `<label class="field" style="display:flex;align-items:center;gap:10px">Color de la materia<input type="color" style="width:42px;padding:2px;height:32px" data-change="mat-color" data-subj="${h(c.subj)}" value="${h(colorOf(c.subj))}"></label>` : ''}
      <label class="field">Profesores<input data-change="course" data-id="${h(id)}" data-f="profs" value="${h(c.profs)}"></label>
      <label class="field">Notas<textarea rows="3" data-change="course" data-id="${h(id)}" data-f="note" placeholder="Modalidad, qué entra en el parcial, contacto de la cátedra">${h(c.note)}</textarea></label></div>
      <div class="fields c2"><label class="field">Año<input inputmode="numeric" data-change="course" data-id="${h(id)}" data-f="year" value="${c.year}"></label><label class="field">${h(S.settings.termWord)}<select data-change="course" data-id="${h(id)}" data-f="sem">${['A', 'B', 'Anual'].map((v) => `<option value="${v}"${v === c.sem ? ' selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <div class="actions"><button class="btn ghost small" data-act="retry" data-id="${h(id)}">Sumar otro intento</button><button class="btn ghost small danger" data-act="del-course" data-id="${h(id)}">Borrar materia</button></div>`);
  }
  function settingsDialog() {
    const st = S.settings;
    openModal(`<h2 id="modal-title">Ajustes</h2><p class="sub">${h(me.email)}</p>
      <p class="section-label">Tu perfil</p>
      <div class="fields c2" style="margin-top:6px">
        <label class="field">Cómo te llamamos<input data-change="setting" data-f="name" value="${h(st.name)}" maxlength="40"></label>
        <label class="field">Saludo<select data-change="setting" data-f="greet">${GREETS.map((g) => `<option${st.greet === g ? ' selected' : ''}>${g}</option>`).join('')}</select></label>
        ${comboField('Universidad', 'university', 'universities', st.university)}
        ${comboField('Carrera', 'career', 'careers', st.career)}
        ${yearField(st.entryYear)}
      </div>
      <hr class="divider"><p class="section-label" style="margin-top:0">Colores</p>${themePicker()}
      <hr class="divider"><p class="section-label" style="margin-top:0">Cuatrimestre</p><div class="actions" style="justify-content:flex-start;margin-top:8px"><button class="btn ghost" data-act="schedule">Editar horario</button></div>
      <hr class="divider"><p class="section-label" style="margin-top:0">Tus datos</p>
      <div class="actions" style="justify-content:flex-start;margin-top:8px"><button class="btn ghost" data-act="export">Exportar copia</button><label class="btn ghost plan-file">Importar copia<input class="vh" type="file" data-change="import" aria-label="Importar copia de tus datos"></label></div>
      <p class="err" id="set-err" role="alert"></p>
      <hr class="divider">${me.hasPassword !== false ? '<p class="section-label" style="margin-top:0">Tu cuenta</p>' : ''}<div class="actions" style="justify-content:flex-start;margin:8px 0 14px">${me.hasPassword !== false ? '<button class="btn ghost" data-act="change-password">Cambiar contraseña</button>' : ''}${Backend.can.changeEmail && me.hasPassword !== false ? '<button class="btn ghost" data-act="change-email">Cambiar mail</button>' : ''}</div><div class="actions" style="justify-content:space-between;margin-top:0"><button class="btn ghost" data-act="logout">Cerrar sesión</button><button class="linkish danger" data-act="del-account">Borrar mi cuenta</button></div>`);
  }
  function scheduleDialog() {
    const hist = (S.history || []).map((x) => `<li><span>${h(x.label)}</span><span class="num">${x.pct === null ? '–' : L.pct(x.pct)}</span></li>`).join('');
    openModal(`<h2 id="modal-title">Horario</h2>${scheduleHtml()}
      <hr class="divider"><p class="sub">¿Arrancó un cuatrimestre nuevo? Tu asistencia actual se archiva y la grilla queda vacía.</p>
      <div class="actions" style="justify-content:flex-start;margin-top:8px"><button class="btn ghost" data-act="new-sem">Empezar cuatrimestre nuevo</button></div>
      ${hist ? `<p class="section-label">Cuatrimestres anteriores</p><ul class="list">${hist}</ul>` : ''}`);
  }
  function agendaDialog() { openModal(`<h2 id="modal-title">Agregar fecha</h2><form data-form="agenda"><div class="fields"><label class="field">Qué es<input name="title" required maxlength="80" placeholder="2do parcial de Juegos"></label><label class="field">Cuándo<input name="date" type="date" required value="${L.iso(today())}"></label></div><div class="actions"><button class="btn" type="submit">Agregar fecha</button></div></form>`); }
  function linkDialog() { openModal('<h2 id="modal-title">Agregar acceso</h2><form data-form="link"><div class="fields"><label class="field">Nombre<input name="name" required maxlength="30" placeholder="Campus"></label><label class="field">Dirección<input name="url" type="url" required pattern="https?://.*" placeholder="https://"></label></div><div class="actions"><button class="btn" type="submit">Agregar acceso</button></div></form>'); }
  function pracDialog(courseId, editId) {
    const editing = editId ? S.practices.find((x) => x.id === editId) : null;
    const opts = L.subjects(S).sort((a, b) => Number(L.isCurrent(b)) - Number(L.isCurrent(a)));
    if (!opts.length) { openModal('<h2 id="modal-title">Agregar material</h2><p class="sub">Primero cargá tus materias en Carrera.</p>'); return; }
    const kind = editing ? (editing.kind || 'practica') : 'practica';
    const selected = editing ? latestOf(subjOfPractice(editing)).id : courseId;
    const count = S.practices.filter((p) => p.course === selected && (p.kind || 'practica') === kind).length;
    const name = editing ? editing.name : `${KINDS[kind].n} ${count + 1}`;
    const parts = editing ? (editing.single ? '' : editing.known ? editing.items.length : '') : '';
    openModal(`<h2 id="modal-title">${editing ? 'Editar material' : 'Agregar material'}</h2><form data-form="prac" ${editing ? `data-id="${h(editing.id)}"` : ''}><div class="fields c2">
      <label class="field">Materia<select name="course">${opts.map((c) => `<option value="${h(c.id)}"${c.id === selected ? ' selected' : ''}>${h(label(c))}</option>`).join('')}</select></label>
      <label class="field">Tipo<select name="kind" data-change="mat-kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${h(v.n)}</option>`).join('')}</select></label>
      </div><div class="fields c2"><label class="field">Nombre<input name="name" required maxlength="80" value="${h(name)}"></label>
      <label class="field"><span id="parts-label">${h(KINDS[kind].parts)} (opcional)</span><input name="n" inputmode="numeric" pattern="[0-9]*" value="${parts}" placeholder="Sin dividir"></label></div>
      <div class="fields c2"><label class="field">Link (opcional)<input name="link" type="url" pattern="https?://.*" value="${h(editing ? editing.link || '' : '')}" placeholder="https://"></label>
      <label class="field">Para cuándo (opcional)<input name="date" type="date" value="${h(editing ? editing.date || '' : '')}"></label></div>
      <p class="sub" style="margin-top:8px">Si lo dividís, tildás cada parte y ves la barra. Si no, se marca como hecho de una.</p>
      <div class="actions">${editing ? `<button type="button" class="btn ghost danger" data-act="del-prac" data-id="${h(editing.id)}">Borrar</button>` : ''}<button class="btn" type="submit">${editing ? 'Guardar' : 'Agregar material'}</button></div></form>`);
  }
  function planDialog() {
    openModal(`<h2 id="modal-title">Agregar materias</h2><p class="sub" style="margin-bottom:12px">No se duplica lo que ya está.</p><form data-form="plan">${planInputHtml('')}<div class="actions"><button class="btn" type="submit">Agregar materias</button></div></form>`);
  }
  function mileDialog() {
    const yrs = [...new Set(S.courses.map((c) => c.year))];
    openModal(`<h2 id="modal-title">Agregar hito</h2><p class="sub">Algo importante de tu carrera: intercambio, pasantías, título intermedio.</p><form data-form="mile"><div class="fields"><label class="field">Qué pasa<input name="text" required maxlength="70" placeholder="Me puedo postular al intercambio"></label></div><div class="fields c2"><label class="field">Año<select name="year">${yrs.map((y) => `<option>${y}</option>`).join('')}</select></label><label class="field">${h(S.settings.termWord)}<select name="sem"><option>A</option><option>B</option><option>Anual</option></select></label></div><div class="actions"><button class="btn" type="submit">Agregar hito</button></div></form>`);
  }
  function deleteDialog() {
    const proof = me.hasPassword !== false
      ? '<label class="field">Tu contraseña<input name="password" type="password" required autocomplete="current-password"></label>'
      : '<label class="field">Escribí BORRAR para confirmar<input name="confirm" required autocomplete="off"></label>';
    openModal(`<h2 id="modal-title">Borrar tu cuenta</h2><p>Se borran tu cuenta y todos tus datos. No se puede deshacer. Si querés guardarlos, exportá una copia antes.</p><form data-form="delete"><div class="fields">${proof}</div><p class="err" id="del-err" role="alert"></p><div class="actions"><button class="btn" type="submit">Borrar cuenta</button></div></form>`);
  }
  function passwordDialog() {
    openModal('<h2 id="modal-title">Cambiar contraseña</h2><form data-form="change-password"><div class="fields"><label class="field">Contraseña actual<input name="current" type="password" required autocomplete="current-password"></label><label class="field">Contraseña nueva<input name="password" type="password" required minlength="8" autocomplete="new-password"><span class="sub" style="font-weight:400">Al menos 8 caracteres.</span></label></div><p class="err" id="acc-err" role="alert"></p><div class="actions"><button class="btn" type="submit">Cambiar contraseña</button></div></form>');
  }
  function emailDialog() {
    openModal(`<h2 id="modal-title">Cambiar mail</h2><p class="sub">Tu mail actual es ${h(me.email)}. Te mandamos un link al nuevo para confirmarlo.</p><form data-form="change-email"><div class="fields"><label class="field">Mail nuevo<input name="email" type="email" required autocomplete="email"></label></div><p class="err" id="acc-err" role="alert"></p><div class="actions"><button class="btn" type="submit">Cambiar mail</button></div></form>`);
  }

  // ---------- Render
  const VIEWS = { hoy: ['Hoy', viewHoy], asistencia: ['Asistencia', viewAsistencia], notas: ['Notas', viewNotas], carrera: ['Carrera', viewCarrera], material: ['Material', viewMaterial] };
  const route = () => { const r = location.hash.slice(1); if (r === 'practicas') return 'material'; return VIEWS[r] ? r : 'hoy'; };
  const inWizard = () => S && !S.settings.onboarded;
  function render() {
    if (deferring) { setTimeout(render); return; }
    applyTheme();
    document.title = APP_NAME;
    const v = $('#view');
    if (ui.recovery) { document.body.classList.add('bare'); v.innerHTML = viewRecovery(); return; }
    if (!S) { document.body.classList.add('bare'); v.innerHTML = viewAuth(); return; }
    if (inWizard()) { document.body.classList.add('bare'); keepFocus(() => { v.innerHTML = viewWizard(); }); return; }
    document.body.classList.remove('bare');
    const r = route();
    $('#tabs').innerHTML = Object.entries(VIEWS).map(([k, [n]]) => `<a href="#${k}"${k === r ? ' aria-current="page"' : ''}>${n}</a>`).join('');
    const a = document.activeElement;
    if (a && a.dataset && a.dataset.change === 'scratch') return;
    const wrap = $('.table-wrap'); const sx = wrap ? wrap.scrollLeft : 0;
    keepFocus(() => { v.innerHTML = VIEWS[r][1](); });
    if (r === 'hoy') viewHoy.played = true;
    const w2 = $('.table-wrap'); if (w2) w2.scrollLeft = sx;
  }
  // Al redibujar, el foco vuelve al mismo campo (Tab entre notas sigue andando).
  function keepFocus(fn) {
    const a = document.activeElement;
    let sel = null;
    if (a && a.closest && a.closest('#view') && a.dataset) {
      if (a.dataset.change) sel = `[data-change="${a.dataset.change}"]${a.dataset.id ? `[data-id="${CSS.escape(a.dataset.id)}"]` : ''}${a.dataset.f ? `[data-f="${a.dataset.f}"]` : ''}`;
      else if (a.dataset.act) sel = `[data-act="${a.dataset.act}"]${a.dataset.id ? `[data-id="${CSS.escape(a.dataset.id)}"]` : ''}${a.dataset.key ? `[data-key="${a.dataset.key}"]` : ''}${a.dataset.s ? `[data-s="${CSS.escape(a.dataset.s)}"]` : ''}${a.dataset.i ? `[data-i="${a.dataset.i}"]` : ''}`;
    }
    fn();
    if (sel) { const b = $(sel); if (b) b.focus({ preventScroll: true }); }
  }

  let toastTimer;
  function toast(msg, canUndo) {
    const t = $('#toast');
    if (!msg) return;
    t.innerHTML = `<span>${h(msg)}</span>${canUndo ? '<button data-act="undo">Deshacer</button>' : ''}`;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }
  function reopen(fn) { if (modal().open) fn(); }
  const openDialogName = () => (modal().open ? ($('#modal-title') || {}).textContent : null);

  // ---------- Acciones
  const actions = {
    mark(el) {
      const { key, s } = el.dataset;
      const c = S.classes.find((x) => x.id === key.split(':')[1]);
      const next = (S.att[key] || '') === s ? '' : s;
      mutate(() => { if (next) S.att[key] = next; else delete S.att[key]; }, next ? `${c.name}: ${STATE_WORD[next].toLowerCase()}` : `${c.name}: sin cargar`);
      if (modal().open) closeModal();
    },
    cell: (el) => cellDialog(el.dataset.key),
    course: (el) => courseDialog(el.dataset.id),
    settings: settingsDialog,
    schedule: scheduleDialog,
    close: closeModal,
    'close-go': () => { closeModal(); location.hash = 'material'; },
    undo() { if (!undoSnap) return; S = JSON.parse(undoSnap); undoSnap = null; save(); render(); $('#toast').hidden = true; },
    theme(el) { S.settings.theme = el.dataset.id; save(); render(); if (openDialogName() === 'Ajustes') settingsDialog(); },
    font(el) { S.settings.font = el.dataset.v; save(); render(); if (openDialogName() === 'Ajustes') settingsDialog(); },
    'custom-mode'(el) { S.settings.custom.mode = el.dataset.v; save(); render(); if (openDialogName() === 'Ajustes') settingsDialog(); },
    resolve(el) { mutate(() => { delete S.cellNotes[el.dataset.key].check; }, 'Nota marcada como revisada'); closeModal(); },
    'add-agenda': agendaDialog,
    'add-link': linkDialog,
    'add-prac': (el) => pracDialog(el.dataset.course),
    'add-plan': planDialog,
    'add-mile': mileDialog,
    'del-mile': (el) => mutate(() => { S.milestones = S.milestones.filter((m) => m.text !== el.dataset.id); }, 'Hito borrado'),
    'del-agenda': (el) => mutate(() => { S.agenda = S.agenda.filter((a) => a.id !== el.dataset.id); }, 'Fecha borrada'),
    ex(el) { const p = S.practices.find((x) => x.id === el.dataset.id); const i = +el.dataset.i; const next = !p.items[i]; mutate(() => { p.items[i] = next; }, p.single ? `${p.name}: ${next ? 'hecho' : 'sin hacer'}` : `${p.name}, ${kindOf(p).one} ${i + 1}: ${next ? 'tildado' : 'destildado'}`); },
    'ex-add'(el) { const p = S.practices.find((x) => x.id === el.dataset.id); const n = p.items.length + 1; mutate(() => { p.items.push(true); }, `${p.name}: ${kindOf(p).one} ${n} tildado`); },
    'prac-all'(el) { const p = S.practices.find((x) => x.id === el.dataset.id); mutate(() => { p.items = p.items.map(() => true); }, `${p.name}: todo tildado`); },
    'del-prac'(el) { const p = S.practices.find((x) => x.id === el.dataset.id); closeModal(); mutate(() => { S.practices = S.practices.filter((x) => x !== p); }, `${p.name}: borrado`); },
    'kind-filter'(el) { ui.kindFilter = el.dataset.k || null; render(); },
    'edit-prac': (el) => pracDialog('', el.dataset.id),
    'prac-filter'(el) { ui.pracFilter = ui.pracFilter === el.dataset.k ? null : el.dataset.k; render(); },
    'pick-week'(el) { ui.phoneWeek = +el.dataset.w; render(); },
    'del-class'(el) { mutate(() => { S.classes = S.classes.filter((c) => c.id !== el.dataset.id); }, 'Clase borrada'); reopen(scheduleDialog); },
    'new-sem'() {
      const t = L.tally(L.allCells(S));
      closeModal();
      mutate(() => {
        S.history = S.history || [];
        S.history.push({ label: `Hasta ${shortDate(today())}/${today().getFullYear()}`, pct: t.pct, classes: S.classes, weeks: S.weeks, att: S.att, cellNotes: S.cellNotes });
        S.classes = []; S.att = {}; S.cellNotes = {}; S.weekNotes = {}; S.weeks = L.buildWeeks(16, [], []); S.settings.semStart = L.iso(mondayOf(today()));
      }, 'Cuatrimestre archivado');
      scheduleDialog();
    },
    retry(el) {
      const c = course(el.dataset.id);
      const n = newCourse(c.name, c.year, c.sem);
      n.subj = c.subj; n.short = c.short; n.status = 'recursando';
      closeModal();
      mutate(() => { S.courses.splice(S.courses.indexOf(c) + 1, 0, n); }, 'Intento agregado. Ajustá año y semestre.');
      courseDialog(n.id);
    },
    'del-course'(el) {
      const c = course(el.dataset.id);
      closeModal();
      mutate(() => {
        S.courses = S.courses.filter((x) => x !== c);
        S.classes = S.classes.filter((x) => x.course !== c.id);
        S.practices = S.practices.filter((x) => x.course !== c.id);
      }, `${c.name} borrada`);
    },
    export() {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cursada-${L.iso(today())}.json`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    async logout() { clearTimeout(saveTimer); await flush(); await api('POST', '/api/logout', {}); location.href = '/'; },
    'del-account': deleteDialog,
    'auth-to'(el) { ui.authMode = el.dataset.to; ui.authNotice = ''; render(); },
    async google() {
      try { await Backend.google(); } catch (e) { const x = $('#auth-err'); if (x) x.textContent = 'No se pudo abrir Google. Probá de nuevo o entrá con tu mail.'; }
    },
    async 'copy-prompt'(el) {
      try {
        await navigator.clipboard.writeText(AI_PROMPT);
        el.textContent = 'Copiada';
        setTimeout(() => { el.textContent = 'Copiar instrucción'; }, 2000);
      } catch (e) {
        const d = el.parentElement.querySelector('details'); d.open = true;
        const sel = getSelection(); const r = document.createRange();
        r.selectNodeContents($('#ai-prompt')); sel.removeAllRanges(); sel.addRange(r);
        el.textContent = 'Copiala con Cmd o Ctrl + C';
      }
    },
    'change-password': passwordDialog,
    'change-email': emailDialog,
    greet(el) { S.settings.greet = el.dataset.v; save(); render(); },
    'wiz-status'(el) { const c = course(el.dataset.id); c.status = el.dataset.s; if (L.isCurrent(c)) ensureColor(c.subj); save(); render(); },
    'wiz-back'() { S.settings.wizStep--; save(); render(); scrollTo(0, 0); },
    'wiz-next'() {
      if (S.settings.wizStep === 1 && ui.planDraft.trim()) { applyPlan(ui.planDraft); ui.planDraft = ''; }
      S.settings.wizStep++; save(); render(); scrollTo(0, 0);
    },
    'wiz-finish'() { S.settings.onboarded = true; S.courses.filter(L.isCurrent).forEach((c) => ensureColor(c.subj)); save(); location.hash = 'hoy'; render(); scrollTo(0, 0); },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el) {
      if (el.disabled) return;
      const a = actions[el.dataset.act];
      if (a) { if (el.tagName !== 'A' || el.dataset.act === 'close-go') e.preventDefault(); e.stopPropagation(); a(el); }
      return;
    }
    if (e.target === modal()) closeModal();
  });
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.matches && d.matches('details.pr')) { if (d.open) ui.openPrac.add(d.dataset.id); else ui.openPrac.delete(d.dataset.id); }
  }, true);

  function gradeChange(el) {
    const parsed = L.parseGrade(el.value);
    const err = $('#grade-err');
    if (!parsed.ok) { el.setAttribute('aria-invalid', 'true'); if (err) err.textContent = 'La nota tiene que ser un número de 0 a 10.'; return; }
    el.removeAttribute('aria-invalid');
    if (err) err.textContent = '';
    const c = course(el.dataset.id);
    mutate(() => { c[el.dataset.f] = parsed.value; }, inWizard() ? null : `${label(c)}: nota guardada`);
    const est = $('#est-val');
    if (est) est.textContent = L.fmt(L.estimate(c));
  }
  function semChange(el) {
    const f = el.dataset.f; const err = $('#sem-err');
    const fail = (m) => { if (err) err.textContent = m; };
    if (err) err.textContent = '';
    const quiet = inWizard() ? null : 'Horario guardado';
    if (f === 'minAtt') {
      const n = Number(el.value);
      if (!(n >= 0 && n <= 100)) return fail('La asistencia mínima va de 0 a 100.');
      mutate(() => { S.settings.minAtt = n / 100; }, quiet);
    } else if (f === 'semStart') {
      if (!el.value || L.dow(L.parseDate(el.value)) !== 0) return fail('Elegí un día que sea lunes: la grilla arranca por ahí.');
      mutate(() => { S.settings.semStart = el.value; }, quiet);
    } else {
      const form = el.closest('dialog, section');
      const total = f === 'total' ? parseInt(el.value, 10) : S.weeks.length;
      if (!(total >= 1 && total <= 40)) return fail('Poné una cantidad de semanas entre 1 y 40.');
      const val = (k) => $(`[data-change="sem"][data-f="${k}"]`, form).value;
      const par = L.parseWeekList(val('parciales'), total);
      const fin = L.parseWeekList(val('finales'), total);
      if (!par || !fin) return fail(`Las semanas de parciales y finales tienen que ser números del 1 al ${total}, separados por coma.`);
      mutate(() => { S.weeks = L.buildWeeks(total, par, fin); }, quiet);
    }
    return undefined;
  }
  document.addEventListener('change', (e) => {
    const el = e.target; const kind = el.dataset && el.dataset.change;
    if (!kind) return;
    deferring = true;
    try {
      if (kind === 'grade') gradeChange(el);
      if (kind === 'sem') semChange(el);
      if (kind === 'course') {
        const c = course(el.dataset.id); const f = el.dataset.f;
        let v = el.value;
        if (f === 'year') { v = parseInt(v, 10); if (!(v >= 1 && v <= 10)) { $('#grade-err').textContent = 'El año va de 1 a 10.'; return; } }
        mutate(() => { c[f] = v; if (L.isCurrent(c)) ensureColor(c.subj); }, 'Materia guardada');
      }
      if (kind === 'mat-color') { mutate(() => { S.matColors[el.dataset.subj] = el.value; }, 'Color guardado'); }
      if (kind === 'custom-accent') { S.settings.custom.accent = el.value; save(); render(); }
      if (kind === 'cell-note') {
        const k = el.dataset.key; const v = el.value.trim();
        mutate(() => { if (v) S.cellNotes[k] = { ...(S.cellNotes[k] || {}), t: v }; else delete S.cellNotes[k]; }, 'Nota guardada');
      }
      if (kind === 'prac-total') {
        const p = S.practices.find((x) => x.id === el.dataset.id);
        const n = parseInt(el.value, 10);
        const lastDone = Math.max(0, ...p.items.map((v, i) => (v ? i + 1 : 0)));
        if (el.value.trim() === '') { mutate(() => { p.known = false; p.items = p.items.slice(0, lastDone); }, `${p.name}: sin total`); return; }
        if (!(n >= 1) || n > 300) { toast('Poné un número entre 1 y 300.'); return; }
        if (n < lastDone) { toast(`${p.name} tiene tildados hasta el ${lastDone}. Destildalos primero o poné un total mayor.`); el.value = p.known ? p.items.length : ''; return; }
        mutate(() => { p.known = true; p.items = Array.from({ length: n }, (_, i) => !!p.items[i]); }, `${p.name}: ${p.items.filter(Boolean).length} de ${n}`);
      }
      if (kind === 'setting') {
        S.settings[el.dataset.f] = el.value.trim();
        save();
        if (!inWizard()) render();
      }
      if (kind === 'mat-kind') {
        const f = el.form; const k = KINDS[el.value]; const nameIn = f.elements.name;
        $('#parts-label').textContent = `${k.parts} (opcional)`;
        if (Object.values(KINDS).some((v) => new RegExp(`^${v.n} \\d+$`).test(nameIn.value))) {
          const c = S.practices.filter((p) => p.course === f.elements.course.value && (p.kind || 'practica') === el.value).length;
          nameIn.value = `${k.n} ${c + 1}`;
        }
      }
      if (kind === 'plan-file') planFileChosen(el);
      if (kind === 'plan-sheet') setPlanText(ui.planSheets[+el.value].text);
      if (kind === 'import') {
        const file = el.files[0]; if (!file) return;
        const msg = $('#set-err');
        if (msg) msg.textContent = `Leyendo ${file.name}…`;
        file.text().then((txt) => {
          const d = JSON.parse(txt);
          if (!d || !Array.isArray(d.courses) || !d.att || !d.settings) throw new Error('formato');
          closeModal();
          S = migrate(d); S.settings.onboarded = true;
          save(); location.hash = 'hoy'; render(); toast('Copia importada');
        }).catch((err) => {
          console.error('Importar copia:', err);
          const x = $('#set-err');
          if (x) x.textContent = `${file.name} no es una copia de ${APP_NAME}. Elegí el archivo .json que exportaste.`;
          el.value = '';
        });
      }
    } finally { deferring = false; }
  });
  let scratchTimer;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.change === 'scratch') { S.scratch = t.value; clearTimeout(scratchTimer); scratchTimer = setTimeout(save, 300); }
    if (t.id === 'plan-text') {
      if (inWizard()) ui.planDraft = t.value;
      const pv = $('#plan-preview'); if (pv) pv.innerHTML = planPreviewHtml(t.value);
    }
  });
  async function authSubmit(path, data) {
    const err = $('#auth-err');
    err.textContent = '';
    try {
      const r = await api('POST', path, data);
      if (r.status >= 400) { err.textContent = r.data.error || 'No se pudo entrar. Probá de nuevo.'; return; }
      if (r.data.confirm) { ui.authMode = 'login'; ui.authNotice = `Te mandamos un mail a ${r.data.email}. Abrí el link para activar tu cuenta y después entrá.`; render(); return; }
      enter(r.data);
    } catch (e) { err.textContent = 'No hay conexión con el servidor.'; }
  }
  function enter(data) {
    me = data.user;
    S = data.state ? migrate(data.state) : emptyState(me);
    rev = data.rev;
    render();
    scrollTo(0, 0);
  }
  document.addEventListener('submit', async (e) => {
    const f = e.target; const kind = f.dataset.form; if (!kind) return;
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    if (kind === 'login' || kind === 'signup') { authSubmit(`/api/${kind}`, d); return; }
    if (kind === 'forgot') {
      const err = $('#auth-err');
      err.textContent = '';
      try {
        const r = await api('POST', '/api/forgot', d);
        if (r.status >= 400) { err.textContent = r.data.error; return; }
        ui.authNotice = `Si hay una cuenta con ${d.email}, te llega un mail con el link. Revisá también el spam.`;
        render();
      } catch (e2) { err.textContent = 'No hay conexión con el servidor.'; }
      return;
    }
    if (kind === 'recovery') {
      const err = $('#auth-err');
      err.textContent = '';
      try {
        const r = await api('POST', '/api/password', { password: d.password });
        if (r.status >= 400) { err.textContent = r.data.error; return; }
        ui.recovery = false;
        const m = await api('GET', '/api/me');
        if (m.status === 200) { enter(m.data); toast('Contraseña actualizada'); } else { ui.authMode = 'login'; render(); }
      } catch (e2) { err.textContent = 'No hay conexión con el servidor.'; }
      return;
    }
    if (kind === 'change-password' || kind === 'change-email') {
      const err = $('#acc-err');
      err.textContent = '';
      try {
        const r = await api('POST', kind === 'change-password' ? '/api/password' : '/api/email', d);
        if (r.status >= 400) { err.textContent = r.data.error; return; }
        closeModal();
        toast(kind === 'change-password' ? 'Contraseña actualizada' : `Te mandamos un link a ${d.email} para confirmar el cambio.`);
      } catch (e2) { err.textContent = 'No hay conexión con el servidor.'; }
      return;
    }
    if (kind === 'delete') {
      if (d.confirm !== undefined && d.confirm.trim().toUpperCase() !== 'BORRAR') { $('#del-err').textContent = 'Escribí BORRAR para confirmar.'; return; }
      delete d.confirm;
      const r = await api('POST', '/api/account/delete', d);
      if (r.status === 200) { clearTimeout(saveTimer); dirty = false; location.href = '/'; } else $('#del-err').textContent = r.data.error || 'No se pudo borrar la cuenta.';
      return;
    }
    if (kind === 'class') {
      const co = course(d.course);
      mutate(() => {
        ensureColor(co.subj);
        S.classes.push({ id: uid('c'), name: `${d.tipo.trim()} ${label(co)}`, mat: co.subj, course: co.id, dow: +d.dow, x2: !!d.x2 });
        S.classes.sort((a, b) => a.dow - b.dow);
      }, inWizard() ? null : 'Clase agregada');
      reopen(scheduleDialog);
      return;
    }
    if (kind !== 'prac') closeModal();
    const id = uid(kind);
    if (kind === 'agenda') mutate(() => { S.agenda.push({ id, title: d.title.trim(), date: d.date }); }, 'Fecha agregada');
    if (kind === 'link') mutate(() => { S.links.push({ id, name: d.name.trim(), url: d.url.trim() }); }, 'Acceso agregado');
    if (kind === 'prac') {
      const co = course(d.course);
      const n = Math.min(parseInt(d.n, 10) || 0, 300);
      const fields = { course: co.id, kind: d.kind, name: d.name.trim(), link: d.link.trim(), date: d.date };
      if (f.dataset.id) {
        const p = S.practices.find((x) => x.id === f.dataset.id);
        const last = Math.max(0, ...p.items.map((v, i) => (v ? i + 1 : 0)));
        if (n > 1 && n < last) { toast(`${p.name} tiene tildado hasta el ${last}. Poné ${last} o más, o destildá primero.`); return; }
        closeModal();
        mutate(() => {
          ensureColor(co.subj);
          Object.assign(p, fields);
          if (n > 1) { p.single = false; p.known = true; p.items = Array.from({ length: Math.max(n, last) }, (_, i) => !!p.items[i]); } else if (n === 1 || (!p.known && d.kind !== 'practica') || (p.single && !n)) { const was = isComplete(p); p.single = true; p.known = true; p.items = [was]; }
        }, 'Material guardado');
      } else {
        closeModal();
        ui.openPrac.add(id);
        mutate(() => {
          ensureColor(co.subj);
          const single = n <= 1 && d.kind !== 'practica' || n === 1;
          S.practices.push({ id, ...fields, single, items: single ? [false] : Array(n).fill(false), known: single || n > 0 });
        }, 'Material agregado');
      }
    }
    if (kind === 'mile') mutate(() => { S.milestones.push({ year: +d.year, sem: d.sem, text: d.text.trim() }); }, 'Hito agregado');
    if (kind === 'plan') { if (!d.plan.trim()) { toast('Subí un archivo o pegá la lista primero.'); return; } let added = 0; mutate(() => { added = applyPlan(d.plan); }, null); toast(added ? `${pl(added, 'materia agregada', 'materias agregadas')}.` : 'No había materias nuevas en la lista.', !!added); }
  });

  // Teclas 1 a 5 para saltar de sección.
  document.addEventListener('keydown', (e) => {
    if (!S || inWizard() || e.metaKey || e.ctrlKey || e.altKey || modal().open) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    const k = Object.keys(VIEWS)[+e.key - 1];
    if (k) location.hash = k;
  });

  // Tooltip único para gráficos y baldosas.
  const tip = $('#tip');
  function showTip(el, x, y) {
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(x - r.width / 2, innerWidth - r.width - 8))}px`;
    tip.style.top = `${y - r.height - 12 < 4 ? y + 18 : y - r.height - 12}px`;
  }
  document.addEventListener('mousemove', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true;
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el && el.matches(':focus-visible')) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); }
  });
  document.addEventListener('focusout', () => { tip.hidden = true; });

  window.addEventListener('hashchange', () => { render(); scrollTo(0, 0); tip.hidden = true; });
  // Al volver a la pestaña, trae lo último guardado desde otro dispositivo.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !S || dirty || inflight || modal().open) return;
    try {
      const r = await api('GET', '/api/me');
      if (r.status === 200 && r.data.rev !== rev && !dirty) { S = migrate(r.data.state); rev = r.data.rev; render(); }
    } catch (e) { /* sin conexión: seguimos con lo que hay */ }
  });

  (async function boot() {
    render();
    try {
      const r = await api('GET', '/api/me');
      if (Backend.isRecovery() && r.status === 200) { me = r.data.user; ui.recovery = true; render(); return; }
      if (Backend.linkError) ui.authNotice = 'Ese link venció o ya se usó. Pedí uno nuevo.';
      if (r.status === 200) enter(r.data); else render();
    } catch (e) {
      $('#view').innerHTML = '<div class="auth"><div><h1>Sin conexión</h1><p class="auth-lead">No se pudo llegar al servidor. Revisá tu conexión y recargá la página.</p></div></div>';
    }
  })();
})();
