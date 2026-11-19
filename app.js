// CursadOK: pantallas y acciones. Los datos de cada usuario viven en el servidor.
(function () {
  const APP_NAME = 'CursadOK'; // el nombre se cambia acá, en index.html y en el título
  const L = window.CursadaLogic;
  const $ = (q, el = document) => el.querySelector(q);
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ratio = (a, b) => (b ? a / b : 0);

  // ---------- Estado y guardado
  let S = null; let me = null; let rev = 0;
  let dirty = false; let inflight = false; let saveTimer = null; let deferring = false;
  // Lo último que sabemos que está guardado en el servidor: sirve para juntar cambios de dos dispositivos.
  let base = null;
  const snap = (x) => JSON.parse(JSON.stringify(x));
  const ui = { allDraft: '', benefitFilter: null, kindFilter: null, openSubj: new Set(), authMode: 'login', authNotice: '', recovery: false, pracFilter: null, openPrac: new Set(), doubtMode: new Set(), phoneWeek: null, msgI: Math.floor(Math.random() * 100), planDraft: '' };

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
      const sent = snap(S);
      const r = await api('PUT', '/api/state', { state: sent, rev });
      if (r.status === 200) { rev = r.data.rev; base = sent; }
      else if (r.status === 409) {
        // Otro dispositivo guardó antes. En vez de tirar lo tuyo, se juntan: lo que cambiaste acá gana,
        // y lo que cambiaste allá (y acá no tocaste) se mantiene.
        const server = migrate(r.data.state);
        const merged = mergeStates(base, S, server);
        S = merged; rev = r.data.rev; base = snap(server);
        dirty = true;
        if (!modal().open) render();
      }
      else if (r.status === 401) { location.reload(); return; }
      else throw new Error('save');
    } catch (e) {
      dirty = true; retry = 5000;
      toast('No se pudo guardar. Reintento en unos segundos.');
    }
    inflight = false;
    if (dirty) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, retry); }
  }
  function mergeStates(b, mine, theirs) {
    if (!b) return mine;
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const out = { ...theirs };
    Object.keys(mine).forEach((k) => {
      if (k === 'settings') {
        out.settings = { ...theirs.settings };
        Object.keys(mine.settings || {}).forEach((sk) => { if (!same(mine.settings[sk], (b.settings || {})[sk])) out.settings[sk] = mine.settings[sk]; });
      } else if (!same(mine[k], b[k])) out[k] = mine[k];
    });
    return out;
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
      settings: { name: (user.name || '').split(' ')[0], greet: 'Hola', university: '', career: '', entryYear: '', theme: 'tinta', font: 'moderna', progress: 'zigzag', pet: '', petDecor: true, appIcon: 'clasico', appIconColors: { g1: '#5B3FD9', g2: '#E2477F', bg: '#FFFFFF', fg: '#22305A' }, pomo: { work: 25, brk: 5, sound: '', vol: 0.5 }, classLen: 120, motivation: false, myPhrases: '', custom: { accent: '#674EA7', second: '', mode: 'light' }, minAtt: 0.75, semStart: L.iso(mondayOf(today())), termWord: 'Cuatrimestre', year: '', semFirst: '', semEnd: '', parcFrom: '', parcTo: '', finFrom: '', finTo: '', onboarded: false, wizStep: 0 },
      classes: [], weeks: L.buildWeeks(16, [], []), holidays: [], todos: [], att: {}, cellNotes: {}, weekNotes: {}, courses: [], practices: [], milestones: [], agenda: [], links: [], scratch: '', stickies: [], studyArchive: {}, pomodoros: [], matColors: {}, history: [],
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
    if (!isHex(out.settings.custom.second)) out.settings.custom.second = '';
    const todayIso = L.iso(today());
    out.todos = (out.todos || []).filter((x) => !x.doneOn || x.doneOn >= todayIso);
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
    out.practices = out.practices.map((p) => ({ kind: 'practica', ...p, doubts: Array.isArray(p.doubts) ? p.doubts.filter((i) => Number.isInteger(i) && i >= 0) : [], doubtNote: typeof p.doubtNote === 'string' ? p.doubtNote : '' }));
    // Una clase "x2" son dos bloques: cada uno con su casilla. Lo ya cargado se copia a los dos.
    if (out.classes.some((c) => c.x2)) {
      const att = { ...out.att };
      out.classes = out.classes.flatMap((c) => {
        if (!c.x2) return [c];
        const b2 = { ...c, id: `${c.id}-b2`, name: `${c.name} · bloque 2`, x2: false };
        Object.keys(out.att).filter((k) => k.endsWith(`:${c.id}`)).forEach((k) => { att[`${k.split(':')[0]}:${b2.id}`] = out.att[k]; });
        return [{ ...c, name: `${c.name} · bloque 1`, x2: false }, b2];
      });
      out.att = att;
    }
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
  const STATE_WORD = { p: 'Fui', a: 'Falté', n: 'No hubo', f: 'No voy' };
  const STATE_GLYPH = { p: '✓', a: '✕', n: '–', f: '⊘' };
  const STATUS = ['cursando', 'recursando', 'aprobada 1ra instancia', 'aprobada 2da instancia', 'desaprobada', 'proximamente'];
  const statusLabel = (s) => (s === 'proximamente' ? 'próximamente' : s);
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const termLabel = (sem) => (sem === 'Anual' ? 'Anual' : `${S.settings.termWord || 'Semestre'} ${sem}`);
  const termShort = (y, sem) => `${y}° año${sem === 'Anual' ? ', anual' : `, ${(S.settings.termWord || 'Semestre').slice(0, 3).toLowerCase()}. ${sem}`}`;
  const signedPct = (x) => (x === null ? '' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.round(Math.abs(x) * 100)}%`);
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
  // Íconos de los accesos: los servicios conocidos traen su dibujito guardado en icons/links/
  // (no se le pide nada a nadie); el resto prueba el favicon del propio sitio y, si no hay, va la inicial.
  const LINK_HOSTS = {
    'calendar.google.com': 'calendar', 'drive.google.com': 'drive', 'mail.google.com': 'gmail', 'classroom.google.com': 'classroom',
    'meet.google.com': 'meet', 'keep.google.com': 'keep', 'scholar.google.com': 'scholar', 'scholar.google.com.ar': 'scholar',
    'translate.google.com': 'translate', 'translate.google.com.ar': 'translate', 'gemini.google.com': 'gemini',
    'youtube.com': 'youtube', 'm.youtube.com': 'youtube', 'youtu.be': 'youtube', 'notion.so': 'notion', 'notion.com': 'notion',
    'chatgpt.com': 'chatgpt', 'chat.openai.com': 'chatgpt', 'claude.ai': 'claude', 'outlook.office.com': 'outlook',
    'outlook.live.com': 'outlook', 'outlook.office365.com': 'outlook', 'teams.microsoft.com': 'teams', 'teams.live.com': 'teams',
    'zoom.us': 'zoom', 'canva.com': 'canva', 'github.com': 'github', 'web.whatsapp.com': 'whatsapp', 'trello.com': 'trello',
    'quizlet.com': 'quizlet', 'linkedin.com': 'linkedin', 'open.spotify.com': 'spotify', 'figma.com': 'figma', 'padlet.com': 'padlet', 'miro.com': 'miro',
  };
  const QUICK_LINKS = [['Calendar', 'https://calendar.google.com/'], ['Drive', 'https://drive.google.com/'], ['Gmail', 'https://mail.google.com/'],
    ['Classroom', 'https://classroom.google.com/'], ['Meet', 'https://meet.google.com/'], ['Docs', 'https://docs.google.com/document/'],
    ['Sheets', 'https://docs.google.com/spreadsheets/'], ['Outlook', 'https://outlook.office.com/'], ['Teams', 'https://teams.microsoft.com/'],
    ['Zoom', 'https://zoom.us/'], ['Notion', 'https://www.notion.so/'], ['YouTube', 'https://www.youtube.com/'], ['WhatsApp', 'https://web.whatsapp.com/']];
  function linkIconName(url) {
    let u; try { u = new URL(url); } catch { return ''; }
    const host = u.hostname.toLowerCase().replace(/^www\./, ''), p = u.pathname;
    if (host === 'docs.google.com') return p.startsWith('/spreadsheets') ? 'gsheets' : p.startsWith('/presentation') ? 'gslides' : p.startsWith('/forms') ? 'gforms' : 'gdocs';
    if (host.endsWith('.zoom.us')) return 'zoom';
    if (/moodle/.test(host + p)) return 'moodle';
    return LINK_HOSTS[host] || '';
  }
  function linkIcon(l) {
    const known = linkIconName(l.url);
    if (known) return `<img class="fav" src="icons/links/${known}.png" alt="" width="16" height="16">`;
    const letter = `<span class="fav fav-letter" aria-hidden="true">${h((l.name || '?').trim().charAt(0).toUpperCase())}</span>`;
    let origin = ''; try { const u = new URL(l.url); if (u.protocol === 'https:') origin = u.origin; } catch { /* sin ícono */ }
    return origin ? `<img class="fav fav-remote" src="${h(origin)}/favicon.ico" alt="" width="16" height="16" referrerpolicy="no-referrer">` : letter;
  }
  // Si el sitio no tiene favicon, se reemplaza por la inicial.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('fav-remote')) return;
    const name = (img.parentElement && img.parentElement.textContent) || '?';
    img.outerHTML = `<span class="fav fav-letter" aria-hidden="true">${h(name.trim().charAt(0).toUpperCase())}</span>`;
  }, true);
  const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  function newCourse(name, year, sem) {
    const subj = L.slug(name);
    let id = `${subj}-${year}${sem}`;
    while (course(id)) id += 'x';
    return { id, subj, name, short: '', year, sem, status: 'proximamente', p1: null, p2: null, final: null, profs: '', note: '' };
  }

  const GREETS = ['Bienvenida', 'Bienvenido', 'Hola'];
  const ICON_PATHS = {
    hoy: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    asistencia: 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 15l2 2 4-4',
    notas: 'M4 20V11M10 20V5M16 20v-6M2 20h20',
    carrera: 'M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 2 9 2 12 0v-5',
    estudio: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
    beneficios: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
    plus: 'M12 5v14M5 12h14',
    copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    upload: 'M12 21V9M7 14l5-5 5 5M4 3h16',
    calendar: 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    guide: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
    settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6',
    check: 'M5 12l5 5 9-10',
    spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8',
    alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z',
    bus: 'M5 17V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v11M5 17h14M5 11h14M8 17v3M16 17v3M8.5 14h.01M15.5 14h.01',
    ticket: 'M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 0 0-4V4H3zM14 4v16',
    cup: 'M4 8h13v5a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 2v3M12 2v3',
    heart: 'M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1zM7 12h3l1.5-2.5L13 14l1.5-2H17',
    bank: 'M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18',
    laptop: 'M4 5h16v11H4zM2 19h20',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
    pin: 'M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    smile: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 14.5s1.5 2.5 4 2.5 4-2.5 4-2.5M9 9.5h.01M15 9.5h.01',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  };
  const icon = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`;
  // Les pone ícono a los botones que más se usan, sin tocar el texto.
  const BUTTON_ICONS = [['[data-act^="add-"]', 'plus'], ['[data-act="copy-prompt"]', 'copy'], ['[data-act="export"]', 'download'], ['label.plan-file', 'upload'], ['[data-act="logout"]', 'logout'], ['[data-act="schedule"]', 'calendar'], ['[data-act="tour"]', 'guide'], ['form[data-form="todo"] button[type="submit"]', 'plus']];
  function decorate(root) {
    BUTTON_ICONS.forEach(([sel, name]) => root.querySelectorAll(`${sel}.btn:not(.has-ico), ${sel}.linkish:not(.has-ico)`).forEach((el) => {
      el.classList.add('has-ico');
      el.insertAdjacentHTML('afterbegin', icon(name));
    }));
  }
  function setBtnText(el, text) { const ico = el.querySelector('.ico'); el.textContent = text; if (ico) el.prepend(ico); }

  // ---------- Temas
  const FONTS = [
    { id: 'moderna', n: 'Moderna', css: null },
    { id: 'clasica', n: 'Clásica', css: 'family=Playfair+Display:ital,wght@0,500;0,700;0,900;1,500;1,700' },
    { id: 'editorial', n: 'Editorial', css: 'family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;0,9..144,900;1,9..144,500' },
    { id: 'redonda', n: 'Redonda', css: 'family=Nunito:ital,wght@0,400;0,500;0,600;0,700;0,900;1,700' },
    { id: 'maquina', n: 'A máquina', css: null },
    { id: 'simple', n: 'Simple', css: null },
  ];
  const PROGRESS = [['zigzag', 'Zigzag'], ['bloques', 'Bloques'], ['barra', 'Barra'], ['puntos', 'Puntos']];
  function progressSample(kind) {
    const n = 10; const on = 6;
    const items = Array.from({ length: n }, (_, i) => {
      const c = i < on ? 'var(--accent)' : 'var(--none)';
      if (kind === 'barra') return `<i style="flex:1;height:8px;background:${c};${i === 0 ? 'border-radius:4px 0 0 4px;' : ''}${i === n - 1 ? 'border-radius:0 4px 4px 0;' : ''}"></i>`;
      if (kind === 'puntos') return `<i style="width:7px;height:7px;border-radius:50%;background:${c}"></i>`;
      return `<i style="flex:1;height:6px;border-radius:1.5px;background:${c};${kind === 'zigzag' && i % 2 ? 'margin-top:7px;' : ''}"></i>`;
    }).join('');
    return `<span class="prog-sample" style="gap:${kind === 'barra' ? 0 : 2}px">${items}</span>`;
  }
  const THEMES = [
    { id: 'tinta', n: 'Tinta', c: '#1C2541' }, { id: 'lavanda', n: 'Lavanda', c: '#D9D2E9' }, { id: 'noche', n: 'Noche', c: '#1D1440' }, { id: 'manteca', n: 'Manteca', c: '#FFF2CC' }, { id: 'menta', n: 'Menta', c: '#CFE8C3' },
    { id: 'cielo', n: 'Cielo', c: '#BBD7F5', accent: '#2F6DB5', mode: 'light' }, { id: 'frambuesa', n: 'Frambuesa', c: '#F4BFD3', accent: '#B0306A', mode: 'light' }, { id: 'grafito', n: 'Grafito', c: '#2B3138', accent: '#8FA3B8', mode: 'dark' },
  ];
  const rgb = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const toHex = (a) => `#${a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => { const A = rgb(a); const B = rgb(b); return toHex(A.map((v, i) => v * t + B[i] * (1 - t))); };
  const lum = (x) => { const [r, g, b] = rgb(x).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function fit(color, against, target, toward) { let c = color; for (let i = 0; i < 24 && contrast(c, against) < target; i++) c = mix(toward, c, 0.08); return c; }
  // El color secundario pinta los resaltados: la semana actual, las notas, los avisos amarillos.
  function secondVars(second, mode) {
    if (!second) return {};
    const strong = fit(second, '#121A2C', 6, '#FFFFFF');
    if (mode === 'dark') {
      const hi = mix(second, '#0B0916', 0.24);
      return { '--hi': hi, '--hi-strong': strong, '--hi-ink': fit(mix(second, '#FFFFFF', 0.45), hi, 6, '#FFFFFF') };
    }
    const hi = fit(mix(second, '#FFFFFF', 0.3), '#121A2C', 9, '#FFFFFF');
    return { '--hi': hi, '--hi-strong': strong, '--hi-ink': fit(mix(second, '#0E0A1E', 0.4), hi, 6.5, '#0E0A1E') };
  }
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
    const st = S ? S.settings : { theme: 'tinta', font: 'moderna', progress: 'zigzag' };
    const font = FONTS.find((f) => f.id === st.font) || FONTS[0];
    root.dataset.font = font.id;
    root.dataset.progress = st.progress || 'zigzag';
    let link = document.getElementById('font-extra');
    if (font.css) {
      const href = `https://fonts.googleapis.com/css2?${font.css}&display=swap`;
      if (!link) { link = document.createElement('link'); link.id = 'font-extra'; link.rel = 'stylesheet'; document.head.append(link); }
      if (link.getAttribute('href') !== href) link.href = href;
    }
    const preset = THEMES.find((t) => t.id === st.theme);
    let accent = null; let mode = null;
    if (st.theme === 'custom') { accent = st.custom.accent; mode = st.custom.mode; } else if (preset && preset.accent) { accent = preset.accent; mode = preset.mode; }
    if (accent) {
      root.dataset.theme = mode === 'dark' ? 'noche' : 'lavanda';
      const vars = { ...deriveVars(accent, mode), ...(st.theme === 'custom' ? secondVars(st.custom.second, mode) : {}) };
      Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    } else root.dataset.theme = preset ? preset.id : 'tinta';
  }
  function themePicker() {
    const st = S.settings;
    return `<div class="themes" style="margin-top:6px">${THEMES.map((t) => `<button type="button" data-act="theme" data-id="${t.id}" aria-pressed="${st.theme === t.id}"><i style="background:${t.c}"></i>${t.n}</button>`).join('')}<button type="button" data-act="theme" data-id="custom" aria-pressed="${st.theme === 'custom'}"><i style="background:${h(st.custom.accent)}"></i>Mi color</button></div>
    ${st.theme === 'custom' ? `<div class="color-row"><label style="display:inline-flex;gap:8px;align-items:center">Principal <input type="color" value="${h(st.custom.accent)}" data-change="custom-accent" aria-label="Elegí tu color principal"></label><label style="display:inline-flex;gap:8px;align-items:center">Secundario <input type="color" value="${h(st.custom.second || getComputedStyle(document.documentElement).getPropertyValue('--hi-strong').trim() || '#FFE14D')}" data-change="custom-second" aria-label="Elegí tu color secundario, el de los resaltados"></label>${st.custom.second ? '<button type="button" class="linkish" data-act="custom-second-auto">Secundario automático</button>' : ''}<div class="choice">${[['light', 'Claro'], ['dark', 'Oscuro']].map(([v, n]) => `<button type="button" data-act="custom-mode" data-v="${v}" aria-pressed="${st.custom.mode === v}">${n}</button>`).join('')}</div></div>` : ''}
    <p class="section-label">Letra</p><div class="choice font-choice" style="margin-top:6px">${FONTS.map((f) => `<button type="button" data-act="font" data-v="${f.id}" data-font-sample="${f.id}" aria-pressed="${(st.font || 'moderna') === f.id}">${h(f.n)}</button>`).join('')}</div>
    <p class="section-label">Cómo se ve el progreso</p><div class="choice prog-choice" style="margin-top:6px">${PROGRESS.map(([v, n]) => `<button type="button" data-act="progress" data-v="${v}" aria-pressed="${(st.progress || 'zigzag') === v}">${progressSample(v)}<span>${n}</span></button>`).join('')}</div>`;
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
    return `<div class="seg" role="group" aria-label="Estado de la clase">${['p', 'a', 'n', 'f'].map((s) => `<button data-act="mark" data-key="${key}" data-s="${s}" aria-pressed="${state === s}" aria-label="${STATE_WORD[s]}"><span class="g" aria-hidden="true">${STATE_GLYPH[s]}</span><span class="w">${STATE_WORD[s]}</span></button>`).join('')}</div>`;
  }
  // Las clases de hoy en orden de hora, con los huecos libres entre una y otra.
  const toMin = (x) => { const [a, b] = x.split(':').map(Number); return a * 60 + b; };
  const durTxt = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`);
  function dayTimeline(todays) {
    const timed = todays.filter((c) => c.cls.from && c.cls.to).sort((a, b) => a.cls.from.localeCompare(b.cls.from));
    const untimed = todays.filter((c) => !(c.cls.from && c.cls.to));
    let out = '';
    timed.forEach((c, i) => {
      out += classRow(c, `${c.cls.from} a ${c.cls.to}`);
      const next = timed[i + 1];
      if (next) {
        const gap = toMin(next.cls.from) - toMin(c.cls.to);
        if (gap >= 30) out += `<div class="gap-row"><span class="gap-line" aria-hidden="true"></span><span><b>Hueco libre</b> de ${c.cls.to} a ${next.cls.from} · ${durTxt(gap)}</span></div>`;
      }
    });
    if (timed.length) out += `<p class="gap-end sub">Terminás a las ${timed[timed.length - 1].cls.to}.</p>`;
    if (timed.length && untimed.length) out += '<p class="section-label" style="margin:12px 0 2px">Sin horario cargado</p>';
    out += untimed.map((c) => classRow(c)).join('');
    if (!timed.length) out += '<p class="sub gap-hint">Cargá a qué hora es cada clase en <button class="linkish" data-act="schedule">tu horario</button> y acá vas a ver tus huecos libres.</p>';
    return out;
  }
  function classRow(c, extra) {
    const note = S.cellNotes[c.key];
    const chip = note && note.t ? ` <button class="note-chip" data-act="cell" data-key="${c.key}" aria-label="Ver nota: ${h(note.t)}">nota</button>` : '';
    return `<div class="class-row" style="--mc:${colorOf(c.cls.mat)}"><span class="dot"></span><div><b>${h(c.cls.name)}${chip}</b>${extra ? `<small>${h(extra)}</small>` : ''}</div>${segButtons(c.key, c.state)}</div>`;
  }
  function leftPill(m) {
    if (m.f) {
      const plan = m.f === 1 ? 'contando la que anotaste' : `contando las ${m.f} que anotaste`;
      if (m.left < 0) return `<span class="pill bad">Te pasarías por ${pl(-m.left, 'falta', 'faltas')}, ${plan}</span>`;
      if (m.left === 0) return `<span class="pill bad">Justo en el límite, ${plan}</span>`;
      return `<span class="pill ${m.left === 1 ? 'hi' : 'ok'}">${m.left === 1 ? 'queda 1 falta' : `quedan ${m.left} faltas`}, ${plan}</span>`;
    }
    if (m.left < 0) return `<span class="pill bad">Pasaste el límite por ${pl(-m.left, 'falta', 'faltas')}</span>`;
    if (m.left === 0) return '<span class="pill bad">No te quedan faltas</span>';
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
  const FEM_UNITS = ['partes', 'preguntas', 'clases'];
  const partsQuestion = (k) => `¿${FEM_UNITS.includes(k.unit) ? 'Cuántas' : 'Cuántos'} ${k.unit} tiene?`;
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

  // ---------- MASCOTA (opcional, se activa en Ajustes): pingüino, gatito, pez o búho. Cambia de cara según lo que te pasa.
  const PETS = { pinguino: 'Pingüino', gatito: 'Gatito', yaguarete: 'Yaguareté', carpincho: 'Carpincho', condor: 'Cóndor', pato: 'Pato', buho: 'Búho', pez: 'Pez', tortuga: 'Tortuga' };
  function petMood() {
    const t = today(); const hr = new Date().getHours();
    if (hr >= 23 || hr < 5) return 'sleepy';
    const ex = S.agenda.map((a) => ({ a, n: L.daysBetween(t, L.parseDate(a.date)) })).filter((x) => x.n >= 0).sort((x, y) => x.n - y.n)[0];
    if (ex && ex.n <= 4) return 'study';
    const ct = currentTerm();
    const over = mats().some((m) => { const st = L.materiaStats(S, m); return st.taken && st.left < 0; });
    const failedNow = ct && S.courses.some((c) => c.status === 'desaprobada' && c.year === ct.year && c.sem === ct.sem);
    if (over || failedNow) return 'sad';
    if (L.streaks(S).current >= 5) return 'happy';
    return 'idle';
  }
  // Al tocarla, la mascota tira chistes de estudiante (y alguno geek).
  const PET_JOKES = [
    '¿Por qué el libro de matemática estaba triste? Tenía demasiados problemas.',
    'Hay 10 tipos de personas: las que entienden binario y las que no.',
    'Un átomo le dice a otro: "Perdí un electrón". "¿Seguro?" "Sí, estoy positivo".',
    '¿Qué le dijo el 0 al 8? Lindo cinturón.',
    'El profe dijo "esto no entra". Spoiler: entró.',
    'Mi método de estudio: abro el apunte, miro el celu, repito.',
    'Ctrl+Z no funciona en los parciales. Lo probé.',
    'El grupo de la materia: 200 mensajes y ninguno responde cuándo es el parcial.',
    'Mi resumen tiene más resaltador que texto. Arte contemporáneo.',
    'El café no es una bebida, es una dependencia funcional.',
    'Dormir 8 horas antes del parcial: leyenda urbana universitaria.',
    'Si la vida te da limones, pedí la fórmula del volumen.',
    'Copiar es fácil. Entender lo que copiaste ya es nivel final.',
    'Fui a la biblioteca a estudiar. Volví con tres fotocopias y un amigo nuevo.',
    '¿Por qué el programador no estudió? Tenía un bug en la motivación.',
    'La entropía del universo aumenta. La de mi escritorio, también.',
  ];
  function petLine(mood) {
    const t = today();
    const ex = S.agenda.map((a) => ({ a, n: L.daysBetween(t, L.parseDate(a.date)) })).filter((x) => x.n >= 0).sort((x, y) => x.n - y.n)[0];
    const lines = {
      sleepy: ['Zzz… vos también deberías dormir.', 'Ya es tarde. Mañana seguimos.'],
      study: ex ? [`${cap(examPhrase(ex.a))} ${ex.n === 0 ? 'es hoy' : ex.n === 1 ? 'es mañana' : `es en ${ex.n} días`}. ¿Repasamos?`, 'Traje los anteojos. A estudiar.'] : ['A estudiar.'],
      sad: ['Ánimo. La próxima sale mejor.', 'Un mal momento no es toda la carrera.'],
      happy: [`¡${L.streaks(S).current} clases seguidas! Qué racha.`, '¡Así da gusto!'],
      idle: ['Acá estoy. Tocame y te cuento un chiste.', 'Un pendiente a la vez.', '¿Qué toca hoy?'],
    }[mood];
    return lines[(ui.petTap || 0) % lines.length];
  }
  // Dibujados a mano. Todos viven en un viewBox de 120×130 con los ojos en (50,52) y (70,52):
  // así las 5 caras (ojos, lágrima, anteojos, libro, zetas, brillitos) sirven para cualquier mascota.
  function petFace(mood) {
    const ink = '#121A2C';
    return {
      idle: `<g class="pet-eyes"><ellipse cx="50" cy="52" rx="4.6" ry="5.6" fill="${ink}"/><ellipse cx="70" cy="52" rx="4.6" ry="5.6" fill="${ink}"/><circle cx="51.6" cy="50" r="1.5" fill="#fff"/><circle cx="71.6" cy="50" r="1.5" fill="#fff"/></g>`,
      happy: `<g fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"><path d="M45 54q5-7 10 0"/><path d="M65 54q5-7 10 0"/></g>`,
      sad: `<g><path d="M43.5 46.5l10-3.5M76.5 46.5l-10-3.5" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="50" cy="54" rx="4" ry="4.6" fill="${ink}"/><ellipse cx="70" cy="54" rx="4" ry="4.6" fill="${ink}"/><path class="pet-tear" d="M45.5 59q-3.4 5 0 7.2q3.4-2.2 0-7.2z" fill="#6EC1FF"/></g>`,
      sleepy: `<g fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"><path d="M45 54q5 4 10 0"/><path d="M65 54q5 4 10 0"/></g>`,
      study: `<g class="pet-eyes"><ellipse cx="50" cy="52" rx="4" ry="4.8" fill="${ink}"/><ellipse cx="70" cy="52" rx="4" ry="4.8" fill="${ink}"/></g><g fill="none" stroke="${ink}" stroke-width="2.2"><circle cx="50" cy="52" r="8.5"/><circle cx="70" cy="52" r="8.5"/><path d="M58.5 52h3"/></g>`,
    }[mood];
  }
  function petExtra(mood) {
    return {
      sleepy: '<g class="pet-z" fill="var(--accent)" font-family="var(--display)" font-weight="800"><text x="88" y="30" font-size="14">z</text><text x="98" y="18" font-size="10">z</text></g>',
      study: '<g><rect x="38" y="88" width="44" height="26" rx="3" fill="var(--accent)"/><rect x="41" y="91" width="17.5" height="20" rx="1.5" fill="#fff"/><rect x="61.5" y="91" width="17.5" height="20" rx="1.5" fill="#fff"/><path d="M44 96h11M44 100h11M44 104h8M64 96h11M64 100h11M64 104h8" stroke="#C9C3DD" stroke-width="1.4"/></g>',
    }[mood] || '';
  }
  const PET_DRAW = {
    pinguino(mood) {
      const sad = mood === 'sad';
      return `<path class="pet-flip-l" d="${sad ? 'M27 74q-8 20 4 34q4-14 2-34z' : 'M26 70q-12 18 2 34q6-14 4-34z'}" fill="#2B3556"/>
        <path class="pet-flip-r${mood === 'happy' ? ' pet-wave' : ''}" d="${sad ? 'M93 74q8 20-4 34q-4-14-2-34z' : 'M94 70q12 18-2 34q-6-14-4-34z'}" fill="#2B3556"/>
        <ellipse cx="60" cy="72" rx="37" ry="46" fill="#2B3556"/>
        <ellipse cx="60" cy="84" rx="25" ry="32" fill="#FAF8FF"/>
        <circle cx="49" cy="53" r="13.5" fill="#FAF8FF"/><circle cx="71" cy="53" r="13.5" fill="#FAF8FF"/>
        <circle cx="41" cy="63" r="4.5" fill="#FF8FA3" opacity=".22"/><circle cx="79" cy="63" r="4.5" fill="#FF8FA3" opacity=".22"/>
        ${petFace(mood)}
        <path d="M54.5 61.5h11l-5.5 7z" fill="#FFA62B" stroke="#FFA62B" stroke-width="2" stroke-linejoin="round"/>
        ${petExtra(mood)}
        <ellipse cx="48" cy="118" rx="9.5" ry="4.6" fill="#FFA62B"/><ellipse cx="72" cy="118" rx="9.5" ry="4.6" fill="#FFA62B"/>`;
    },
    gatito(mood) {
      // Gatito naranja, cabezón y sentado.
      const fur = '#F4A259'; const stripe = '#E0873A'; const cream = '#FFF4E6';
      const tail = mood === 'sad' ? 'M38 112q-22 6-24 18' : 'M38 110q-22-2-20-24q1-9 9-7';
      return `<path class="pet-tail${mood === 'happy' ? ' pet-wave-tail' : ''}" d="${tail}" fill="none" stroke="${fur}" stroke-width="10" stroke-linecap="round"/>
        <ellipse cx="60" cy="103" rx="26" ry="19" fill="${fur}"/>
        <ellipse cx="60" cy="106" rx="15" ry="12" fill="${cream}"/>
        <path d="M30 40L32 17l19 14z" fill="${fur}" stroke="${fur}" stroke-width="5" stroke-linejoin="round"/><path d="M90 40L88 17 69 31z" fill="${fur}" stroke="${fur}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M35 33l1-9 8 6z" fill="#FFC2C7" stroke="#FFC2C7" stroke-width="2" stroke-linejoin="round"/><path d="M85 33l-1-9-8 6z" fill="#FFC2C7" stroke="#FFC2C7" stroke-width="2" stroke-linejoin="round"/>
        <ellipse cx="60" cy="57" rx="36" ry="31" fill="${fur}"/>
        <path d="M54 30q1 5 0 9M60 28v10M66 30q-1 5 0 9" fill="none" stroke="${stripe}" stroke-width="3" stroke-linecap="round"/>
        <path d="M25 52q5 1 8 4M95 52q-5 1-8 4" fill="none" stroke="${stripe}" stroke-width="2.6" stroke-linecap="round"/>
        <ellipse cx="60" cy="68" rx="14" ry="10" fill="${cream}"/>
        <circle cx="40" cy="64" r="5" fill="#FF8FA3" opacity=".22"/><circle cx="80" cy="64" r="5" fill="#FF8FA3" opacity=".22"/>
        ${petFace(mood)}
        <path d="M57.2 63.5h5.6l-2.8 3.2z" fill="#E86B7E" stroke="#E86B7E" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M60 67q-2.2 3.4-5 1.2M60 67q2.2 3.4 5 1.2" fill="none" stroke="#121A2C" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M44 67h-9M44 70.5l-8 2M76 67h9M76 70.5l8 2" stroke="#B5652A" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>
        ${petExtra(mood)}
        <ellipse cx="50" cy="119" rx="8" ry="5.5" fill="${cream}"/><ellipse cx="70" cy="119" rx="8" ry="5.5" fill="${cream}"/>`;
    },
    pez(mood) {
      // Pececito en su pecera: la pecera queda quieta y el pez nada adentro.
      const body = '#FF8A65'; const deep = '#F06A44';
      const fish = `<path class="pet-fin" d="M90 72L114 50l-5 22 5 22z" fill="${deep}"/>
        <path d="M42 46q16-22 34-2z" fill="${deep}"/>
        <ellipse cx="60" cy="70" rx="36" ry="30" fill="${body}"/>
        <ellipse cx="58" cy="82" rx="25" ry="14" fill="#FFD3BE"/>
        <path d="M70 62q4 4 0 8M78 60q4 5 0 10M78 74q4 5 0 10" fill="none" stroke="${deep}" stroke-width="2" stroke-linecap="round"/>
        <path class="pet-side-fin" d="M60 76q16-6 22 6q-14 5-22-6z" fill="${deep}"/>
        <g transform="translate(-8 8)">${petFace(mood)}</g>
        <circle cx="34" cy="64" r="3.4" fill="#FF8FA3" opacity=".22"/>
        <ellipse cx="26" cy="72" rx="3.6" ry="3" fill="#8A2E14"/>
        ${petExtra(mood)}`;
      return `<circle cx="60" cy="80" r="42" fill="#EAF7FF" stroke="#A9D8F5" stroke-width="2.5"/>
        <path d="M20.8 64A42 42 0 1 0 99.2 64Z" fill="#BFE6FF" opacity=".85"/>
        <path d="M20.8 64q39 7 78.4 0" fill="none" stroke="#8CCBF2" stroke-width="1.6"/>
        <path d="M25.5 104Q60 96 94.5 104A42 42 0 0 1 25.5 104Z" fill="#F4DFA6"/>
        <path d="M33 109q-7-15 2-28q4 13-2 28zM40 111q2-17 11-23q-2 15-11 23z" fill="#5CBF7A"/>
        <circle cx="78" cy="108" r="3.4" fill="#E8C98A"/><circle cx="84" cy="110" r="2.4" fill="#D9B676"/>
        <ellipse cx="60" cy="39.5" rx="23" ry="4.5" fill="none" stroke="#A9D8F5" stroke-width="3"/>
        <g transform="translate(30 47) scale(.56)"><g class="pet-swim">${fish}</g></g>
        <g class="pet-bubbles" fill="none" stroke="#fff" stroke-width="1.4"><circle cx="46" cy="70" r="2.6"/><circle cx="42" cy="58" r="1.8"/><circle cx="48" cy="48" r="1.3"/></g>
        <path d="M28 70q3-16 16-24" stroke="#fff" stroke-width="3" fill="none" opacity=".7" stroke-linecap="round"/>`;
    },
    tortuga(mood) {
      // De frente: el caparazón grande atrás y arriba, la cabeza asomando adelante.
      const skin = '#86B97A'; const skinD = '#5E8F55'; const shell = '#6B5A3A'; const scute = '#8C7650'; const rim = '#4C3F28';
      const sad = mood === 'sad';
      return `<path d="M22 92q-10 6-8 16q8 2 16-6zM98 92q10 6 8 16q-8 2-16-6z" fill="${skin}" stroke="${skinD}" stroke-width="1.5"/>
        <path d="M14 78C14 40 36 22 60 22s46 18 46 56c0 8-4 14-12 16H26c-8-2-12-8-12-16z" fill="${shell}" stroke="${rim}" stroke-width="2.5"/>
        <path d="M60 26v24M40 32l8 18M80 32l-8 18M48 50h24M24 60l24-10M96 60L72 50M24 60l6 22M96 60l-6 22M48 50l-6 30M72 50l6 30" fill="none" stroke="${scute}" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M22 88h76" stroke="${rim}" stroke-width="3" stroke-linecap="round"/>
        <ellipse cx="42" cy="118" rx="9" ry="6" fill="${skin}" stroke="${skinD}" stroke-width="1.5"/><ellipse cx="78" cy="118" rx="9" ry="6" fill="${skin}" stroke="${skinD}" stroke-width="1.5"/>
        <g transform="translate(0 ${sad ? 30 : 26})">
          <ellipse cx="60" cy="56" rx="21" ry="19" fill="${skin}" stroke="${skinD}" stroke-width="1.8"/>
          <path d="M48 46q12-6 24 0" fill="none" stroke="${skinD}" stroke-width="1.4" opacity=".6"/>
          ${petFace(mood)}
          <path d="${sad ? 'M55 67q5-3.5 10 0' : 'M54 64q6 4.5 12 0'}" fill="none" stroke="#2E4A28" stroke-width="2" stroke-linecap="round"/>
          <circle cx="57" cy="60" r="1" fill="#2E4A28"/><circle cx="63" cy="60" r="1" fill="#2E4A28"/>
        </g>
        ${mood === 'sleepy' ? petExtra(mood) : ''}
        ${mood === 'study' ? '<g transform="translate(0 6)">' + petExtra(mood) + '</g>' : ''}`;
    },
    yaguarete(mood) {
      // Yaguareté sentado: pelaje dorado con rosetas, orejas redondas y hocico ancho.
      const fur = '#D9A441'; const furD = '#B98326'; const cream = '#F6E7C8'; const spot = '#3A2614';
      const tail = mood === 'sad' ? 'M86 110q22 6 24 18' : 'M86 108q24-2 22-26q-1-8-8-6';
      const rosette = (x, y, r) => `<path d="M${x - r} ${y}a${r} ${r} 0 1 1 ${r * 2} 0" fill="none" stroke="${spot}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="${r * 1.2} ${r * 0.6}"/>`;
      return `<path class="pet-tail${mood === 'happy' ? ' pet-wave-tail pet-tail-r' : ' pet-tail-r'}" d="${tail}" fill="none" stroke="${fur}" stroke-width="10" stroke-linecap="round"/>
        <path d="${mood === 'sad' ? 'M104 122l6 6' : 'M100 76l2 6'}" stroke="${spot}" stroke-width="4" stroke-linecap="round"/>
        <ellipse cx="60" cy="102" rx="28" ry="21" fill="${fur}" stroke="${furD}" stroke-width="1.6"/>
        <ellipse cx="60" cy="106" rx="16" ry="13" fill="${cream}"/>
        ${rosette(40, 98, 4)}${rosette(80, 98, 4)}${rosette(36, 110, 3)}${rosette(84, 110, 3)}
        <circle cx="34" cy="30" r="10" fill="${fur}" stroke="${furD}" stroke-width="1.6"/><circle cx="86" cy="30" r="10" fill="${fur}" stroke="${furD}" stroke-width="1.6"/>
        <circle cx="34" cy="31" r="5" fill="${spot}" opacity=".85"/><circle cx="86" cy="31" r="5" fill="${spot}" opacity=".85"/>
        <ellipse cx="60" cy="56" rx="37" ry="32" fill="${fur}" stroke="${furD}" stroke-width="1.6"/>
        ${rosette(34, 50, 4)}${rosette(86, 50, 4)}<circle cx="52" cy="32" r="2.4" fill="${spot}"/><circle cx="60" cy="29" r="2.4" fill="${spot}"/><circle cx="68" cy="32" r="2.4" fill="${spot}"/>
        <ellipse cx="60" cy="69" rx="17" ry="12" fill="${cream}"/>
        ${petFace(mood)}
        <path d="M55.5 63h9l-4.5 4.6z" fill="#5A3A24" stroke="#5A3A24" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M60 67.6q-2.6 4-6 1.6M60 67.6q2.6 4 6 1.6" fill="none" stroke="#3A2614" stroke-width="1.6" stroke-linecap="round"/>
        <circle cx="49" cy="71" r=".9" fill="${spot}"/><circle cx="52" cy="73" r=".9" fill="${spot}"/><circle cx="71" cy="71" r=".9" fill="${spot}"/><circle cx="68" cy="73" r=".9" fill="${spot}"/>
        ${petExtra(mood)}
        <ellipse cx="49" cy="120" rx="9" ry="5.5" fill="${cream}" stroke="${furD}" stroke-width="1.2"/><ellipse cx="71" cy="120" rx="9" ry="5.5" fill="${cream}" stroke="${furD}" stroke-width="1.2"/>`;
    },
    carpincho(mood) {
      // Carpincho: cuerpo grande y tranquilo, cabeza cuadrada con hocico ancho.
      const fur = '#9A6B45'; const furD = '#7A5233'; const snout = '#6E4A2E';
      return `<ellipse cx="60" cy="100" rx="40" ry="24" fill="${fur}" stroke="${furD}" stroke-width="1.8"/>
        <path d="M34 92q4 6 2 12M86 92q-4 6-2 12" stroke="${furD}" stroke-width="1.6" fill="none" opacity=".6"/>
        <ellipse cx="30" cy="30" rx="6" ry="5" fill="${furD}"/><ellipse cx="90" cy="30" rx="6" ry="5" fill="${furD}"/>
        <rect x="27" y="28" width="66" height="56" rx="24" fill="${fur}" stroke="${furD}" stroke-width="1.8"/>
        <rect x="38" y="58" width="44" height="26" rx="13" fill="${snout}"/>
        <ellipse cx="52" cy="66" rx="3" ry="2" fill="#2B1B10"/><ellipse cx="68" cy="66" rx="3" ry="2" fill="#2B1B10"/>
        <path d="${mood === 'sad' ? 'M54 78q6-3 12 0' : 'M54 75q6 4 12 0'}" fill="none" stroke="#2B1B10" stroke-width="1.8" stroke-linecap="round"/>
        <g transform="translate(0 -4)">${petFace(mood)}</g>
        ${petExtra(mood)}
        <ellipse cx="44" cy="121" rx="9" ry="5" fill="${furD}"/><ellipse cx="76" cy="121" rx="9" ry="5" fill="${furD}"/>`;
    },
    condor(mood) {
      // Cóndor andino: plumaje negro, collar blanco, cabeza pelada y pico ganchudo.
      const black = '#23232B'; const head = '#B9867A'; const headD = '#94655A';
      const sad = mood === 'sad';
      return `<path class="pet-flip-l" d="${sad ? 'M26 70q-14 26 2 46q8-20 4-46z' : 'M28 62q-22 18-14 52q14-8 18-50z'}" fill="${black}"/>
        <path class="pet-flip-r${mood === 'happy' ? ' pet-wave' : ''}" d="${sad ? 'M94 70q14 26-2 46q-8-20-4-46z' : 'M92 62q22 18 14 52q-14-8-18-50z'}" fill="${black}"/>
        <path d="M20 96q4-10 12-14M100 96q-4-10-12-14" stroke="#E9E9EF" stroke-width="5" stroke-linecap="round" opacity=".9"/>
        <ellipse cx="60" cy="88" rx="32" ry="34" fill="${black}"/>
        <path d="M30 70q30 16 60 0q-4 10-30 12q-26-2-30-12z" fill="#F4F4F7"/>
        <path d="M34 72q6 4 4 8M46 76q2 4 0 7M60 78v6M74 76q-2 4 0 7M86 72q-6 4-4 8" stroke="#D5D5DD" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        <ellipse cx="60" cy="50" rx="24" ry="22" fill="${head}" stroke="${headD}" stroke-width="1.6"/>
        <path d="M52 30q4-8 8-2q4-6 8 2q-8 4-16 0z" fill="${headD}"/>
        ${petFace(mood)}
        <path d="M54 58h12q2 8-4 14q-1-6-8-8z" fill="#E8D9B0" stroke="#B9A578" stroke-width="1.4" stroke-linejoin="round"/>
        ${petExtra(mood)}
        <path d="M46 118l-3 6M50 118v6M54 118l3 6M66 118l-3 6M70 118v6M74 118l3 6" stroke="#8A8A8A" stroke-width="2.4" stroke-linecap="round"/>`;
    },
    pato(mood) {
      // Pato amarillo, de costado mirando al frente, con pico ancho.
      const body = '#F2C94C'; const bodyD = '#D9A82E'; const bill = '#F28C28'; const billD = '#C96A14';
      const sad = mood === 'sad';
      return `<path d="M92 92q16-6 18-16q2 14-12 22z" fill="${body}" stroke="${bodyD}" stroke-width="1.6" stroke-linejoin="round"/>
        <ellipse cx="62" cy="96" rx="36" ry="24" fill="${body}" stroke="${bodyD}" stroke-width="1.6"/>
        <path class="pet-flip-r${mood === 'happy' ? ' pet-wave' : ''}" d="${sad ? 'M70 92q18 4 22 18q-16 0-22-18z' : 'M66 88q22-6 28 8q-14 10-28-8z'}" fill="${bodyD}" opacity=".75"/>
        <circle cx="60" cy="52" r="27" fill="${body}" stroke="${bodyD}" stroke-width="1.6"/>
        <path d="M56 26q4-8 10-6q-4 2-4 7" fill="${body}" stroke="${bodyD}" stroke-width="1.4" stroke-linejoin="round"/>
        ${petFace(mood)}
        <path d="M46 62q14-6 28 0q2 8-14 10q-16-2-14-10z" fill="${bill}" stroke="${billD}" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="${sad ? 'M50 67q10 3 20 0' : 'M49 65q11 4 22 0'}" fill="none" stroke="${billD}" stroke-width="1.4" stroke-linecap="round"/>
        <circle cx="55" cy="63" r=".9" fill="${billD}"/><circle cx="65" cy="63" r=".9" fill="${billD}"/>
        ${petExtra(mood)}
        <path d="M44 116q-8 6 0 8h12q2-4-4-8zM68 116q-8 6 0 8h12q2-4-4-8z" fill="${bill}" stroke="${billD}" stroke-width="1.2" stroke-linejoin="round"/>`;
    },
    buho(mood) {
      const feather = '#8C6B52'; const light = '#EBDCC7';
      return `<path class="pet-flip-l" d="${mood === 'sad' ? 'M27 74q-8 22 6 34q2-16 0-34z' : 'M26 66q-14 20 4 40q6-18 2-40z'}" fill="#6F533F"/>
        <path class="pet-flip-r${mood === 'happy' ? ' pet-wave' : ''}" d="${mood === 'sad' ? 'M93 74q8 22-6 34q-2-16 0-34z' : 'M94 66q14 20-4 40q-6-18-2-40z'}" fill="#6F533F"/>
        <path d="M30 40l3-24 17 16z" fill="${feather}"/><path d="M90 40l-3-24-17 16z" fill="${feather}"/>
        <ellipse cx="60" cy="72" rx="36" ry="45" fill="${feather}"/>
        <ellipse cx="60" cy="88" rx="22" ry="27" fill="${light}"/>
        <path d="M52 80l4 4 4-4 4 4 4-4M50 92l4 4 4-4 4 4 4-4 4 4M54 104l4 4 4-4 4 4" fill="none" stroke="#C4AC8E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="50" cy="52" r="14" fill="#F7EEE2"/><circle cx="70" cy="52" r="14" fill="#F7EEE2"/>
        ${petFace(mood)}
        <path d="M56.5 60h7l-3.5 7.5z" fill="#F2A33A"/>
        ${petExtra(mood)}
        <path d="M45 117l3 5 3-5 3 5 3-5M63 117l3 5 3-5 3 5 3-5" fill="none" stroke="#F2A33A" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    },
  };
  // Disfraces según la fecha (se pueden apagar en Ajustes).
  function petSeason(t = today()) {
    const m = t.getMonth() + 1; const d = t.getDate();
    if ((m === 12 && d >= 27) || (m === 1 && d <= 3)) return { kind: 'newyear', year: m === 12 ? t.getFullYear() + 1 : t.getFullYear() };
    if (m === 12 && d <= 26) return { kind: 'xmas' };
    if (m === 10 && d >= 24) return { kind: 'halloween' };
    if (m === 9 && d >= 18 && d <= 23) return { kind: 'spring' };
    if (m === 2 && d >= 12 && d <= 14) return { kind: 'love' };
    return null;
  }
  const HAT_AT = { pato: [60, 28], pinguino: [60, 30], gatito: [60, 30], yaguarete: [60, 26], carpincho: [60, 30], condor: [60, 30], buho: [60, 30], pez: [60, 38], tortuga: [60, 64] };
  function petDecor(kind, season) {
    if (!season) return '';
    const [x, y] = HAT_AT[kind] || [60, 30];
    const at = (inner, sc = 1) => `<g transform="translate(${x} ${y}) scale(${sc})">${inner}</g>`;
    if (season.kind === 'xmas') return at('<path d="M-17 0Q-8-30 15-24L18 0z" fill="#C8102E"/><path d="M-6-14q6-6 14-8" stroke="#E2384F" stroke-width="2" fill="none" opacity=".7"/><rect x="-20" y="-5" width="40" height="9" rx="4.5" fill="#FFF"/><circle cx="16" cy="-25" r="5.5" fill="#FFF"/>');
    if (season.kind === 'newyear') return at(`<path d="M-12 0L0-30 12 0z" fill="var(--accent)"/><path d="M-8.5-7h17M-4.8-17h9.6" stroke="#FFE45E" stroke-width="2.6"/><circle cy="-31" r="3.6" fill="#FFE45E"/>`) + `<g transform="translate(${x + 26} ${y - 8}) rotate(14)"><rect x="-14" y="-8" width="28" height="13" rx="3" fill="#FFE45E"/><text x="0" y="2" text-anchor="middle" font-size="9" font-weight="800" font-family="var(--display)" fill="#3F3300">${season.year}</text></g>`;
    if (season.kind === 'spring') return at(['#FF8FB1', '#FFD24D', '#9AD0FF', '#FF8FB1', '#B6E388'].map((c, i) => { const ang = (-60 + i * 30) * Math.PI / 180; const fx = Math.sin(ang) * 20; const fy = -Math.cos(ang) * 8 + 2; return `<g transform="translate(${fx.toFixed(1)} ${fy.toFixed(1)})"><circle r="4.6" fill="${c}"/><circle r="1.8" fill="#FFF7D6"/></g>`; }).join(''));
    if (season.kind === 'halloween') return '<g transform="translate(103 112)"><ellipse rx="13" ry="10.5" fill="#F28C28" stroke="#C9650F" stroke-width="1.5"/><path d="M-4.5-10v20M4.5-10v20" stroke="#D96F10" stroke-width="1.6"/><path d="M0-10q1-6 5-7" stroke="#4E7A2A" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M-7-2l2.5-3 2.5 3zM2-2l2.5-3 2.5 3z" fill="#3A1D05"/><path d="M-6 3q6 4 12 0q-6 2-12 0z" fill="#3A1D05" stroke="#3A1D05" stroke-width="1.2" stroke-linejoin="round"/></g>';
    if (season.kind === 'love') return '<g transform="translate(102 34)"><path d="M0 8C-10 0-10-8-4-9C-1-9.5 0-7 0-6C0-7 1-9.5 4-9C10-8 10 0 0 8z" fill="#E8466C"/></g>';
    return '';
  }
  function petSvg(kind, mood, opts = {}) {
    const draw = PET_DRAW[kind] || PET_DRAW.pinguino;
    const season = opts.decor === false ? null : (opts.season !== undefined ? opts.season : (S && S.settings.petDecor !== false ? petSeason() : null));
    return `<svg class="pet-svg mood-${mood} pet-${kind}" viewBox="0 0 120 130" aria-hidden="true">
      <ellipse class="pet-shadow" cx="60" cy="124" rx="30" ry="4" fill="rgba(20,12,50,.16)"/>
      <g class="pet-body">${draw(mood)}${petDecor(kind, season)}</g>
    </svg>`;
  }
  // Selector con dibujito: así se ve la mascota antes de elegirla.
  function petPickerHtml(cur) {
    return `<div class="pet-picker" role="group" aria-label="Mascota"><button type="button" data-act="pet-pick" data-v="" aria-pressed="${!cur}"><span class="pp-none" aria-hidden="true">✕</span><span>Sin mascota</span></button>${Object.entries(PETS).map(([k, n]) => `<button type="button" data-act="pet-pick" data-v="${k}" aria-pressed="${cur === k}">${petSvg(k, 'idle', { decor: false })}<span>${n}</span></button>`).join('')}</div>`;
  }
  function petHtml() {
    if (!S.settings.pet) return '';
    const mood = petMood();
    return `<div class="pet" data-mood="${mood}"><p class="pet-bubble" aria-live="polite">${h(petLine(mood))}</p><button class="pet-btn" data-act="pet-tap" aria-label="Tu mascota, ${h(PETS[S.settings.pet] || '')}. Tocala">${petSvg(S.settings.pet, mood)}</button></div>`;
  }

  // ---------- POST-ITS: la nota rápida se pega arriba de Hoy como un papelito. Tocándolo se edita o se despega.
  // Colores de papel bien distintos del fondo de la app (que es lila, celeste, menta… según el tema).
  const STICKY_COLORS = { amarillo: 'Amarillo', rosa: 'Rosa', naranja: 'Naranja', celeste: 'Celeste', verde: 'Verde' };
  function boardHtml() {
    const list = S.stickies || [];
    if (!list.length) return '';
    return `<section class="board" aria-label="Tus post-its">${list.map((n, i) => `<button class="postit c-${h(n.color || 'amarillo')}" style="--r:${n.rot ?? ((i % 2 ? 1 : -1) * (1 + (i % 3)))}deg" data-act="sticky" data-id="${h(n.id)}" aria-label="Post-it: ${h(n.text)}. Tocalo para editarlo o despegarlo"><span class="postit-tape" aria-hidden="true"></span><span class="postit-txt">${h(n.text)}</span></button>`).join('')}</section>`;
  }
  function stickyDialog(id) {
    const n = (S.stickies || []).find((x) => x.id === id);
    if (!n) return;
    openModal(`<h2 id="modal-title">Post-it</h2>
      <div class="postit-edit c-${h(n.color || 'amarillo')}"><textarea data-change="sticky-text" data-id="${h(n.id)}" rows="5" maxlength="400" aria-label="Texto del post-it">${h(n.text)}</textarea></div>
      <div class="choice sticky-colors" role="group" aria-label="Color">${Object.entries(STICKY_COLORS).map(([k, v]) => `<button type="button" class="sw c-${k}" data-act="sticky-color" data-id="${h(n.id)}" data-v="${k}" aria-pressed="${(n.color || 'amarillo') === k}" aria-label="${v}"></button>`).join('')}</div>
      <div class="actions" style="justify-content:space-between"><button type="button" class="btn ghost danger" data-act="unstick" data-id="${h(n.id)}">Despegar</button><button type="button" class="btn" data-act="close">Listo</button></div>`);
  }

  // ---------- Frases motivadoras (solo si las activaste en Ajustes). Una por día, según lo que te pasa.
  const MOTTOS = {
    examToday: ['Hoy es el día. Café, birome de repuesto y a romperla.', 'Lo que no estudiaste no lo vas a aprender en el colectivo. Confiá en lo que sabés.', 'Leé la consigna dos veces. La segunda siempre dice otra cosa.'],
    examSoon: ['Faltan {n} para {exam}. Todavía da para hacerte el héroe, pero no tanto.', '{exam} en {n}: si no es ahora, es la noche anterior con mate y pánico.', 'Resumen hecho hoy es resumen que no hacés a las 3 de la mañana. {exam} en {n}.'],
    beforeExam: ['Estás a {k} de tener {mat} al día para {short}. Se puede.', 'Con {k} más llegás con {mat} al día para {short}. Después, siesta merecida.'],
    almostDone: ['{name} de {mat}: {left} y la cerrás.', 'Te {left} para terminar {name}. Ya casi, no aflojes ahora.'],
    doubts: ['Anotaste {d} para consultar. Llevalas a clase, que el profe cobra igual.', '{d} para la próxima clase. Preguntar es gratis, recursar no.'],
    streak: ['{n} clases seguidas. Ya te saludan los del buffet.', 'Racha de {n} clases: a esta altura el aula te cobra alquiler.'],
    late: ['Pasada la medianoche el cerebro estudia en modo avión. Andá a dormir.', 'Dormir 7 horas también entra en el parcial, aunque no lo tomen.'],
    weekend: ['Es finde. Una hora de estudio hoy y el lunes sos otra persona.', 'Finde: sacá una guía del medio y el resto del día es tuyo.'],
    monday: ['Lunes. El café no se va a tomar solo.', 'Arranca la semana: lo que hagas hoy no lo tenés que hacer el jueves a la noche.'],
    general: ['Hecho es mejor que perfecto. Perfecto es para la tesis.', 'Un ejercicio más hoy es uno menos la noche antes del parcial.', 'Media hora por día le gana a una noche entera de pánico.', 'Si un tema no sale, anotá la duda y seguí. El parcial no espera.', 'Mirá todo lo que ya aprobaste: eso también lo hiciste vos.', 'Silenciar el grupo de la facu cuenta como estudiar. Bueno, casi.', 'Tomá agua. El cerebro es 75% agua y 25% apuntes prestados.'],
  };
  // Una frase por día (cambia también de noche). Junta las que aplican a tu situación y elige una.
  function motto() {
    if (!S.settings.motivation) return '';
    const t = today(); const now = new Date();
    const late = now.getHours() >= 23 || now.getHours() < 5;
    const key = `${L.iso(t)}${late ? 'n' : ''}`;
    const hash = [...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const own = String(S.settings.myPhrases || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const fill = (list, vars) => list.map((x) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), x));
    const exams = S.agenda.map((a) => ({ a, n: L.daysBetween(t, L.parseDate(a.date)) })).filter((x) => x.n >= 0).sort((x, y) => x.n - y.n);
    let pool = [];
    if (exams[0] && exams[0].n === 0) pool = MOTTOS.examToday;
    else {
      if (late) pool.push(...MOTTOS.late);
      const soon = exams[0] && exams[0].n <= 5 ? exams[0] : null;
      if (soon) pool.push(...fill(MOTTOS.examSoon, { exam: examPhrase(soon.a), n: pl(soon.n, 'día', 'días') }));
      // Cuánto material le falta a la materia del próximo examen (dentro de dos semanas).
      const next = exams.find((x) => x.n <= 14 && x.a.course);
      if (next) {
        const co = course(next.a.course);
        const left = co ? S.practices.filter((p) => subjOfPractice(p) === co.subj && !isComplete(p)).length : 0;
        const kd = EXAM_KINDS.find((x) => x[0] === next.a.kind);
        if (left) pool.push(...fill(MOTTOS.beforeExam, { k: pl(left, 'material', 'materiales'), mat: matLabel(co.subj), short: kd && kd[2] ? kd[2] : 'el examen' }));
      }
      const close = S.practices.filter((p) => p.known && !p.single && p.items.length).map((p) => ({ p, left: p.items.filter((v) => !v).length })).filter((x) => x.left >= 1 && x.left <= 3).sort((a, b) => a.left - b.left)[0];
      if (close) {
        const k = kindOf(close.p);
        pool.push(...fill(MOTTOS.almostDone, { name: close.p.name, mat: matLabel(subjOfPractice(close.p)), left: close.left === 1 ? `falta 1 ${k.one}` : `faltan ${close.left} ${k.unit}` }));
      }
      const doubts = S.practices.reduce((a, p) => a + (p.doubts || []).filter((i) => i < p.items.length).length, 0);
      if (doubts) pool.push(...fill(doubts === 1 ? MOTTOS.doubts.map((x) => x.replace('Llevalas', 'Llevala')) : MOTTOS.doubts, { d: pl(doubts, 'duda', 'dudas') }));
      const st = L.streaks(S);
      if (st.current >= 5) pool.push(...fill(MOTTOS.streak, { n: st.current }));
      const dw = L.dow(t);
      if (dw >= 5) pool.push(...MOTTOS.weekend);
      if (dw === 0) pool.push(...MOTTOS.monday);
      pool.push(...MOTTOS.general, ...own, ...own);
    }
    // Mayúscula al principio de cada oración ("el segundo parcial…" puede quedar arrancando una).
    const text = pool[hash % pool.length].replace(/(^|[.!?]\s+)([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase());
    return `<p class="motto">${h(text)}</p>`;
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
    const dated = [...S.agenda.map((a) => ({ title: examPhrase(a), date: a.date })), ...pendingDated().map((p) => ({ title: `${p.name} de ${matLabel(subjOfPractice(p))}`, date: p.date }))];
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
  // Lo que la app nota de tus datos: festejos, alertas y tendencias. Los más importantes primero.
  function insights() {
    const t = today(); const out = [];
    const st = L.streaks(S);
    if (st.absent >= 2) out.push({ tone: 'warn', ic: 'alert', t: `Llevás ${st.absent} faltas seguidas`, d: `Fueron en ${st.absentIn.map(matLabel).join(', ')}. Mirá cuántas faltas te quedan en cada una.` });
    const stats = mats().map((m) => ({ m, s: L.materiaStats(S, m) })).filter((x) => x.s.taken);
    const tight = stats.filter((x) => x.s.left <= 1).sort((a, b) => a.s.left - b.s.left)[0];
    if (tight) out.push({ tone: 'warn', ic: 'alert', t: tight.s.left < 0 ? `En ${matLabel(tight.m)} pasaste el límite de faltas` : tight.s.left === 0 ? `En ${matLabel(tight.m)} no te quedan faltas` : `En ${matLabel(tight.m)} te queda 1 falta`, d: `Llevás ${L.pct(tight.s.pct)} de asistencia, y el mínimo es ${L.pct(S.settings.minAtt)}.` });
    if (st.current >= 3) out.push({ tone: 'win', ic: 'smile', t: `Vas ${st.current} clases seguidas sin faltar`, d: st.current >= st.best ? '¡Bien ahí! Es tu mejor racha.' : `¡Bien ahí! Tu récord es ${st.best}.` });
    const next = [...S.agenda].filter((a) => { const n = L.daysBetween(t, L.parseDate(a.date)); return n >= 0 && n <= 14; }).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (next) { const n = L.daysBetween(t, L.parseDate(next.date)); out.push({ tone: 'info', ic: 'clock', t: countdownText(next, n), d: cap(longDate(L.parseDate(next.date))) }); }
    const days = L.absencesByDay(S).filter((d) => d.a + d.p >= 4);
    const totalA = days.reduce((a, d) => a + d.a, 0); const totalT = days.reduce((a, d) => a + d.a + d.p, 0);
    const worst = days.sort((a, b) => b.a / (b.a + b.p) - a.a / (a.a + a.p))[0];
    if (worst && totalA >= 3) {
      const r = worst.a / (worst.a + worst.p); const rest = ratio(totalA - worst.a, totalT - worst.a - worst.p);
      const day = L.DIAS[worst.dow]; const plural = day.endsWith('s') ? day : `${day}s`;
      if (r >= 0.1 && r >= rest * 1.5) out.push({ tone: 'info', ic: 'bulb', t: `Tendés a faltar los ${plural}`, d: `Faltaste al ${L.pct(r)} de las clases de ese día. El resto de la semana, al ${L.pct(rest)}.` });
    }
    const imp = L.improvements(S);
    if (imp.n >= 3 && imp.up !== imp.down) out.push({ tone: 'info', ic: 'notas', t: `Te suele ir mejor en los ${imp.up > imp.down ? 'segundos' : 'primeros'} parciales`, d: imp.up > imp.down ? `Subiste en ${imp.up} de ${imp.n} materias.` : `En ${imp.down} de ${imp.n} materias bajaste en el segundo.` });
    return out.slice(0, 3);
  }
  function insightsHtml() {
    const list = insights();
    if (!list.length) return '';
    return `<div class="insights">${list.map((x) => `<div class="ins ${x.tone}"><span class="ins-ic">${icon(x.ic)}${x.tone === 'win' ? '<i class="confetti" aria-hidden="true"><b></b><b></b><b></b><b></b><b></b></i>' : ''}</span><div><b>${h(x.t)}</b><span>${h(x.d)}</span></div></div>`).join('')}</div>`;
  }
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
      todayHtml = `<div class="card-head"><h2>Hoy cursás</h2><span class="sub">${done} de ${todays.length} cargadas</span></div>${dayTimeline(todays)}`;
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
      const co = a.course && course(a.course);
      return `<li class="cd${n <= 3 ? ' soon' : ''}"${co ? ` style="--mc:${colorOf(co.subj)}"` : ''}><span class="cd-n"><b>${n === 0 ? 'Hoy' : n}</b>${n ? `<small>${n === 1 ? 'día' : 'días'}</small>` : ''}</span><span class="cd-txt">${h(countdownText(a, n))}<span class="sub">${cap(longDate(L.parseDate(a.date)))}</span></span><button class="x" data-act="del-agenda" data-id="${h(a.id)}" aria-label="Borrar ${h(examPhrase(a))}">×</button></li>`;
    }).join('');
    // Lo que tachás hoy queda tachado hasta mañana: así se ve lo que hiciste.
    const tIso = L.iso(t);
    const pend = [
      ...pendingDated().filter((p) => L.daysBetween(t, L.parseDate(p.date)) >= 0).map((p) => ({ kind: 'mat', id: p.id, text: p.name, meta: `${kindOf(p).n} · ${matLabel(subjOfPractice(p))}`, date: p.date })),
      ...S.practices.filter((p) => p.date && p.doneOn === tIso && isComplete(p)).map((p) => ({ kind: 'mat', id: p.id, text: p.name, meta: `${kindOf(p).n} · ${matLabel(subjOfPractice(p))}`, date: p.date, done: true })),
      ...(S.todos || []).filter((x) => !x.doneOn || x.doneOn === tIso).map((x) => ({ kind: 'todo', id: x.id, text: x.text, meta: '', date: x.date || '', done: !!x.doneOn })),
    ].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')); // lo tachado queda en su lugar
    const openCount = pend.filter((x) => !x.done).length;
    const due = (d) => { if (!d) return ''; const n = L.daysBetween(t, L.parseDate(d)); return n < 0 ? '<span class="days-to late">venció</span>' : `<span class="days-to">${n === 0 ? 'hoy' : n === 1 ? 'mañana' : `${n} días`}</span>`; };
    const pendHtml = `<section class="card"><div class="card-head"><h2>Pendientes</h2>${pend.length ? `<span class="sub">${openCount ? pl(openCount, 'cosa', 'cosas') : '¡Todo hecho por hoy!'}</span>` : ''}</div>
      ${pend.length ? `<ul class="list todo-list">${pend.map((x) => `<li class="${x.done ? 'is-done' : ''}"><button class="todo-check" data-act="${x.kind === 'mat' ? 'mat-done' : 'todo-done'}" data-id="${h(x.id)}" aria-pressed="${!!x.done}" aria-label="${x.done ? 'Desmarcar' : 'Marcar como hecho'}: ${h(x.text)}">${icon('check')}</button><span class="todo-txt">${h(x.text)}${x.meta || x.date ? `<span class="sub">${h(x.meta)}${x.meta && x.date ? ' · ' : ''}${x.date ? `para el ${shortDate(L.parseDate(x.date))}` : ''}</span>` : ''}</span>${x.done ? '<span class="days-to">hecho</span>' : due(x.date)}</li>`).join('')}</ul>` : '<p class="sub">Nada pendiente. Sumá algo, o ponele fecha a un material en Estudio y aparece acá hasta que lo termines.</p>'}
      <form data-form="todo" class="todo-add"><input name="text" required maxlength="120" placeholder="Agregá algo para hacer" aria-label="Nuevo pendiente"><input name="date" type="date" aria-label="Para cuándo (opcional)"><button class="btn small" type="submit">Agregar</button></form>
    </section>`;
    const dueRows = pendingDated().filter((p) => L.daysBetween(t, L.parseDate(p.date)) >= 0).sort((a, b) => a.date.localeCompare(b.date)).map((p) => {
      const n = L.daysBetween(t, L.parseDate(p.date));
      return `<li><span>${h(p.name)} <span class="pill">${h(kindOf(p).n)}</span><br><span class="sub">${h(matLabel(subjOfPractice(p)))} · ${cap(longDate(L.parseDate(p.date)))}</span></span><a class="days-to" href="#estudio">${n === 0 ? 'hoy' : n === 1 ? 'mañana' : `${n} días`}</a></li>`;
    }).join('');
    const lateDue = pendingDated().filter((p) => L.daysBetween(t, L.parseDate(p.date)) < 0).map((p) => `<li><span>${h(p.name)} <span class="pill bad">Venció</span><br><span class="sub">${h(matLabel(subjOfPractice(p)))} · ${cap(longDate(L.parseDate(p.date)))}</span></span><a class="days-to" href="#estudio">ver</a></li>`).join('');
    const finalsRow = finalsDate && L.daysBetween(t, finalsDate) >= 0 ? `<li><span>Semana de finales<br><span class="sub">Desde el ${longDate(finalsDate)}</span></span><span class="days-to">${L.daysBetween(t, finalsDate)} días</span></li>` : '';

    const prRows = pracSubjects().map((k) => {
      const list = S.practices.filter((p) => subjOfPractice(p) === k);
      if (!list.length) return '';
      const p = pracStats(list);
      return `<div style="margin-top:9px"><div style="display:flex;justify-content:space-between;gap:8px;font-size:13.5px"><span>${h(matLabel(k))}</span><span class="pr-count">${p.pct !== null ? L.pct(p.pct) : `${p.done} hechos`}</span></div>${p.pct !== null ? stitch(p.pct, { n: 30 }) : ''}</div>`;
    }).join('');
    const links = S.links.map((l) => `<a href="${h(safeUrl(l.url))}" target="_blank" rel="noopener">${linkIcon(l)}${h(l.name)}</a>`).join('');

    return `
    <header class="head">
      <div><h1 class="hello">${h(st.greet)}, <em>${h(st.name)}</em></h1><p class="today-line">${h(line)}</p>${weeks}</div>
      ${petHtml()}
      ${cs.total ? `<div class="figs"><div class="fig"><b>${L.fmt(cs.avgAll)}</b><span>promedio general</span></div><div class="fig"><b>${cs.approved}<small> de ${cs.total}</small></b><span>materias aprobadas</span></div></div>` : ''}
    </header>
    ${motto()}${insightsHtml()}${boardHtml()}
    <div class="hoy-flow">
    <section class="card career hoy-career hide-on-phone" aria-label="Tu carrera, una baldosa por materia">
      <div class="card-head"><h2>${h(st.career || 'Tu carrera')}</h2>${cs.total ? `<span class="sub">${L.pct(ratio(cs.approved, cs.total))} aprobada · ${cs.current} en curso</span>` : ''}</div>
      ${cs.total ? `${careerStrip(!viewHoy.played)}<div class="zig-foot">${careerKey()}${milestoneChips()}</div>` : '<div class="empty"><b>Cargá tu plan de estudios.</b>Cada materia va a ser una baldosa que se llena a medida que aprobás.</div><div class="actions" style="justify-content:flex-start"><button class="btn" data-act="add-plan">Cargar plan de estudios</button></div>'}
    </section>
    <div class="grid g-hoy hoy-main">
      <div class="stack">
        <section class="card">${todayHtml}</section>${lateHtml}${pendHtml}
        <section class="card"><div class="card-head"><h2>Nota rápida</h2><span class="sub">Se guarda sola</span></div><textarea class="scratch" data-change="scratch" aria-label="Nota rápida" placeholder="Lo que no te querés olvidar para la próxima clase">${h(S.scratch)}</textarea><div class="actions" style="justify-content:flex-start;margin-top:8px"><button class="btn ghost small" data-act="stick">Pegar como post-it</button></div></section>
      </div>
      <div class="stack">
        ${matCards ? `<section class="card"><div class="card-head"><h2>Este cuatrimestre</h2><a class="linkish" href="#asistencia">Ver asistencia</a></div><div class="mat-grid">${matCards}</div></section>` : ''}
        <section class="card"><div class="card-head"><h2>Se viene</h2><button class="btn ghost small" data-act="add-agenda">Agregar examen</button></div>
          ${agendaRows || finalsRow ? `<ul class="list">${agendaRows}${finalsRow}</ul>` : ''}
          ${!agendaRows ? '<p class="sub" style="margin-top:6px">Agregá tus parciales, recuperatorios y finales: acá ves cuántos días faltan para cada uno.</p>' : ''}
        </section>
        <section class="card hide-on-phone"><div class="card-head"><h2>Accesos</h2><button class="btn ghost small" data-act="add-link">${S.links.length ? 'Editar' : 'Agregar'}</button></div>${links ? `<div class="links">${links}</div>` : '<p class="sub">El campus, el mail, el Drive: lo que abrís todos los días.</p>'}</section>
      </div>
    </div>
    </div>`;
  }

  // ---------- ASISTENCIA
  // Una columna por semana: qué porcentaje de las clases fuiste. La línea marca el mínimo.
  function weekChart() {
    const t = today();
    const cells = L.allCells(S);
    const cw = L.classWeeks(S).filter((w) => L.daysBetween(L.weekStart(S, w.n), t) >= 0);
    const data = cw.map((w) => ({ ...L.tally(cells.filter((c) => c.week === w.n)), week: w.n })).filter((d) => d.taken);
    if (data.length < 2) return '';
    const min = S.settings.minAtt;
    const bars = data.map((d) => `<div class="wc-col" data-tip="Semana ${d.week} · ${L.pct(d.pct)} (fuiste a ${d.p} de ${d.taken})"><i class="${d.pct < min ? 'low' : ''}" style="height:${Math.max(d.pct * 100, 2)}%"></i><span>${d.week}</span></div>`).join('');
    return `<section class="card mt"><div class="card-head"><h2>Semana a semana</h2><span class="sub">Cuánto fuiste cada semana</span></div>
      <div class="week-chart" role="img" aria-label="${h(data.map((d) => `Semana ${d.week}: ${L.pct(d.pct)}`).join(', '))}"><div class="wc-min" style="bottom:${min * 100}%"><span>mínimo ${L.pct(min)}</span></div>${bars}</div>
      <div class="key" style="margin-top:8px"><span><i style="background:var(--accent)"></i>llegaste al mínimo</span><span><i style="background:var(--bad-ink)"></i>por debajo</span></div></section>`;
  }
  // Cuatrimestres archivados: horario y asistencia de antes, para consultar (no se editan).
  function oldAttendanceHtml() {
    const hist = (S.history || []).filter((x) => x.classes && x.classes.length);
    const archive = `<p class="sub" style="margin-top:10px">¿Terminó el cuatrimestre? En <button class="linkish" data-act="schedule">Editar horario</button> → "Empezar cuatrimestre nuevo" se guarda todo esto acá y arrancás con la grilla vacía.</p>`;
    if (!hist.length) return `<section class="card mt"><div class="card-head"><h2>Cuatrimestres anteriores</h2></div><p class="sub">Todavía no archivaste ninguno.</p>${archive}</section>`;
    const items = [...hist].reverse().map((x) => {
      const st = { ...S, classes: x.classes, weeks: x.weeks || [], att: x.att || {}, holidays: [] };
      const ms = [...new Set(x.classes.map((c) => c.mat))];
      const tot = L.tally(L.allCells(st));
      const title = x.term ? termShort(x.term.year, x.term.sem) : x.label;
      const rows = ms.map((m) => { const t = L.materiaStats(st, m); const nm = (x.classes.find((c) => c.mat === m) || {}).name || m; return `<li><span><span class="dot" style="--mc:${colorOf(m)}"></span> ${h(matLabel(m) || nm)}</span><span class="num">${t.taken ? `${L.pct(t.pct)} · ${pl(t.a, 'falta', 'faltas')}` : '–'}</span></li>`; }).join('');
      const sched = [...new Set(x.classes.map((c) => c.dow))].sort().map((d) => `<li><b>${cap(L.DIAS[d])}</b>${x.classes.filter((c) => c.dow === d).map((c) => `${h(c.name)}${c.from ? ` <span class="num sub">${c.from}–${c.to}</span>` : ''}`).join(' · ')}</li>`).join('');
      return `<details class="old-sem"><summary><span>${h(title)}</span><span class="sub">${tot.taken ? `${L.pct(tot.pct)} de asistencia` : 'sin asistencia cargada'}</span></summary>
        <p class="section-label">Asistencia por materia</p><ul class="list">${rows}</ul>
        <p class="section-label">Horario</p><ul class="plan-list">${sched}</ul></details>`;
    }).join('');
    return `<section class="card mt"><div class="card-head"><h2>Cuatrimestres anteriores</h2><span class="sub">${pl(hist.length, 'archivado', 'archivados')}</span></div>${items}${archive}</section>`;
  }
  function viewAsistencia() {
    if (!S.classes.length) {
      return '<header class="head"><div><h1>Asistencia</h1><p class="lead">Armá tu horario una vez y después solo marcás si fuiste.</p></div></header><section class="card"><div class="empty"><b>Todavía no hay clases cargadas.</b>Agregá las clases de cada materia con su día.</div><div class="actions" style="justify-content:flex-start"><button class="btn" data-act="schedule">Armar horario</button></div></section>' + oldAttendanceHtml();
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
      const tip = `${c.cls.name} · ${L.DIAS[c.cls.dow]} ${shortDate(c.date)} · ${c.holiday && !S.att[c.key] ? 'feriado' : word}${note ? ` · “${note.t}”` : ''}`;
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
      // Lo que cursás hoy va en un solo bloque con fondo, así ubicás el día de un vistazo.
      const ti = cs.map((c, i) => (L.daysBetween(c.date, t) === 0 ? i : -1)).filter((i) => i >= 0);
      const tdCls = (i) => (ti.includes(i) ? ` class="is-today${i === ti[0] ? ' t-first' : ''}${i === ti[ti.length - 1] ? ' t-last' : ''}"` : '');
      return `<tr class="${w.n === wk ? 'cur' : ''}"><th class="sticky wk" scope="row">Sem ${w.n}<small>${shortDate(L.weekStart(S, w.n))}</small></th>${cs.map((c, i) => `<td${tdCls(i)}>${cellBtn(c)}</td>`).join('')}<td class="wbar"><div><span class="bar"><i style="width:${(tl.pct || 0) * 100}%"></i></span><span>${tl.taken ? L.pct(tl.pct) : ''}</span></div></td></tr>`;
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
      ${(() => {
        const isT = (c) => L.daysBetween(c.date, t) === 0;
        const before = pwCells.filter((c) => !isT(c) && c.cls.dow < L.dow(t));
        const tod = pwCells.filter(isT);
        const after = pwCells.filter((c) => !isT(c) && !before.includes(c));
        const row = (c) => classRow(c, cap(L.DIAS[c.cls.dow]));
        return `${before.map(row).join('')}${tod.length ? `<div class="today-block"><span class="today-tag">Hoy</span>${tod.map((c) => classRow(c, c.cls.from ? `${c.cls.from} a ${c.cls.to}` : 'Hoy')).join('')}</div>` : ''}${after.map(row).join('')}`;
      })()}
      <p class="section-label">Todo el cuatrimestre</p><p class="sub">Tocá un número para ir a esa semana.</p>
      <div class="att-map" style="--cols:${S.classes.length}"><div class="map-row map-head"><span></span>${S.classes.map((c) => `<span style="background:${colorOf(c.mat)}" title="${h(c.name)}"></span>`).join('')}</div>${map}</div>
      <div class="key" style="margin-top:10px">${mats().map((m) => `<span><i style="background:${colorOf(m)}"></i>${h(matLabel(m))}</span>`).join('')}</div>
    </section>`;

    const matCards = mats().map((m) => {
      const s = L.materiaStats(S, m);
      return `<div><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:5px;flex-wrap:wrap"><b style="display:inline-flex;align-items:center;gap:6px"><span class="dot" style="--mc:${colorOf(m)}"></span>${h(matLabel(m))}</b>${leftPill(s)}</div>${stitch(s.pct, { mark: S.settings.minAtt, warn: s.left < 0, n: 30 })}<p class="sub" style="margin-top:4px"><span class="num">${L.pct(s.pct)}</span> · faltaste ${s.a} de ${s.taken}${s.f ? ` · no vas a ${pl(s.f, 'clase', 'clases')}` : ''} · quedan ${pl(s.pending + s.f, 'clase', 'clases')}</p></div>`;
    }).join('');

    return `
    <header class="head"><div><h1>Asistencia</h1><p class="lead">Mínimo ${L.pct(S.settings.minAtt)} por materia. Las clases que todavía no pasaron no cuentan como falta.</p></div>
      <div class="figs"><div class="fig"><b>${L.pct(total.pct)}</b><span>${total.p} de ${total.taken} clases</span></div></div></header>
    <section class="card"><div class="grid g-2" style="gap:16px 28px">${matCards}</div></section>
    ${weekChart()}
    ${phone}
    <section class="card mt att-desk"><div class="card-head"><h2>Grilla</h2><button class="btn ghost small" data-act="schedule">Editar horario</button></div><div class="table-wrap"><table class="att">
      <thead><tr class="day"><th class="sticky"></th>${groups.map((g) => `<th colspan="${g.n}" scope="colgroup"${g.dow === L.dow(t) && S.weeks.some((w) => w.n === wk && w.kind === 'clases') ? ' class="is-today"' : ''}>${L.DIAS[g.dow]}${g.dow === L.dow(t) && S.weeks.some((w) => w.n === wk && w.kind === 'clases') ? ' · hoy' : ''}</th>`).join('')}<th></th></tr>
      <tr class="cl"><th class="sticky"></th>${S.classes.map((c) => `<th scope="col" style="--mc:${colorOf(c.mat)}">${h(c.name)}<i></i></th>`).join('')}<th class="sub">Semana</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th class="sticky">Por clase</th>${foot}<td></td></tr></tfoot>
    </table></div>
    <div class="key" style="margin-top:12px"><span>✓ fui</span><span>✕ falté</span><span>– no hubo clase o feriado</span><span>vacío: sin cargar</span><span><span class="note-dot"></span>tiene nota: tocala para leerla</span></div></section>
    ${oldAttendanceHtml()}
    <div class="mt">
      <section class="card"><div class="card-head"><h2>Tus números</h2></div><div class="mini-stats">
        <div><b>${st.current}</b><span>clases seguidas sin faltar</span></div>
        <div><b>${st.best}</b><span>tu mejor racha</span></div>
        <div><b>${worst && worst.a ? cap(L.DIAS[worst.dow]) : '–'}</b><span>${worst && worst.a ? `el día que más faltás: ${L.pct(worst.a / (worst.a + worst.p))} de las clases` : 'sin faltas todavía'}</span></div>
      </div></section>
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
      <p class="imp-explain">${imp.up > imp.down ? `Te suele ir mejor en los <b>segundos</b> parciales: subiste en ${imp.up} de ${imp.n} materias.` : imp.down > imp.up ? `Te suele ir mejor en los <b>primeros</b> parciales: en ${imp.down} de ${imp.n} materias bajaste en el segundo.` : 'Te va parecido en los dos parciales.'}</p>
      <div class="pair-bars" role="img" aria-label="Promedio del parcial 1: ${L.fmt(imp.avgP1)}. Promedio del parcial 2: ${L.fmt(imp.avgP2)}.">
        <div><span>Parcial 1</span><i style="width:${imp.avgP1 * 10}%" class="p1"></i><b>${L.fmt(imp.avgP1)}</b></div>
        <div><span>Parcial 2</span><i style="width:${imp.avgP2 * 10}%" class="p2"></i><b>${L.fmt(imp.avgP2)}</b></div>
      </div>
      <div class="imp-big">
        <div><b>${imp.up} de ${imp.n}</b><span>materias en las que mejoraste</span></div>
        <div><b>${L.fmt(imp.avgP1)} → ${L.fmt(imp.avgP2)}</b><span>tu promedio, de un parcial al otro</span></div>
      </div>
      ${imp.best ? `<p class="sub" style="margin-bottom:8px">Tu mayor salto: ${h(label(imp.best.course))}, de ${L.fmt(imp.best.p1)} a ${L.fmt(imp.best.p2)}.</p>` : ''}
      ${rows}</section>`;
  }
  // Tabla de parciales: estimado y cuánto falta, según lo que haya cargado.
  const avgOf = (p1, p2) => (p1 == null && p2 == null ? null : p1 == null ? p2 : p2 == null ? p1 : (p1 + p2) / 2);
  function needWord(p1, t) {
    const n = 2 * t - p1;
    if (n <= 0) return { txt: 'ya llegás', cls: 'ok' };
    if (n > 10) return { txt: 'no alcanza', cls: 'bad' };
    return { txt: L.fmt(n, 1), cls: '' };
  }
  function resultPill(p1, p2) {
    const a = (p1 + p2) / 2;
    const best = [8, 6, 4].find((t) => a >= t);
    return best ? `<span class="pill ok">✓ promediás ${L.fmt(a)}: llegás a ${best}</span>` : `<span class="pill bad">promediás ${L.fmt(a)}: te falta ${L.fmt(4 - a)} para 4</span>`;
  }
  function gradeTail(p1, p2) {
    const est = `<td class="n" data-tail>${L.fmt(avgOf(p1, p2))}</td>`;
    if (p1 != null && p2 == null) return est + [4, 6, 8].map((t) => { const w = needWord(p1, t); return `<td class="n hide-sm" data-tail>${w.cls ? `<span class="pill ${w.cls}">${w.txt}</span>` : w.txt}</td>`; }).join('');
    if (p1 != null && p2 != null) return `${est}<td colspan="3" class="hide-sm result-cell" data-tail>${resultPill(p1, p2)}</td>`;
    return `${est}<td colspan="3" class="hide-sm sub result-cell" data-tail>Cargá el parcial 1</td>`;
  }
  function gradeNeedRow(p1, p2) {
    let inner;
    if (p1 != null && p2 == null) inner = `En el parcial 2 necesitás ${[4, 6, 8].map((t) => { const w = needWord(p1, t); return `<span>para ${t}: <b>${w.txt}</b></span>`; }).join('')}`;
    else if (p1 != null && p2 != null) inner = resultPill(p1, p2);
    else inner = 'Cargá el parcial 1 para ver cuánto necesitás en el 2.';
    return `<tr class="need-row" data-tail-row><td colspan="4">${inner}</td></tr>`;
  }
  // Horario de una clase: se guarda mientras lo elegís (en el iPhone, si cerrás el cuadro antes, el "change" no llega).
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset || el.dataset.change !== 'class-time' || !S) return;
    const c = S.classes.find((x) => x.id === el.dataset.id);
    if (!c) return;
    if (el.value) c[el.dataset.f] = el.value; else delete c[el.dataset.f];
    save();
  }, true);
  // Campos de solo números: lo que no es dígito no entra.
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset && 'digits' in el.dataset && /\D/.test(el.value)) el.value = el.value.replace(/\D/g, '');
  }, true);
  // Las notas van con coma: si escribís un punto, se cambia solo.
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset || el.dataset.change !== 'grade' || !el.value.includes('.')) return;
    const pos = el.selectionStart;
    el.value = el.value.replace(/\./g, ',');
    try { el.setSelectionRange(pos, pos); } catch { /* algunos campos no lo permiten */ }
  }, true);
  // Recalcula mientras escribís, sin esperar a salir del casillero.
  document.addEventListener('input', (e) => {
    const row = e.target.closest && e.target.closest('tr[data-row]');
    if (!row || e.target.dataset.change !== 'grade') return;
    const val = (f) => L.parseGrade(row.querySelector(`[data-f="${f}"]`).value);
    const a = val('p1'); const b = val('p2');
    if (!a.ok || !b.ok) return;
    row.querySelectorAll('[data-tail]').forEach((x) => x.remove());
    row.insertAdjacentHTML('beforeend', gradeTail(a.value, b.value));
    const next = row.nextElementSibling;
    if (next && next.hasAttribute('data-tail-row')) next.outerHTML = gradeNeedRow(a.value, b.value);
  });
  function viewNotas() {
    const cs = L.careerStats(S);
    const current = S.courses.filter(L.isCurrent);
    const curRows = current.map((c) => `<tr data-row="${h(c.id)}">
      <td><button class="name-btn" data-act="course" data-id="${h(c.id)}">${h(label(c))}</button></td>
      <td class="n"><input class="grade-in" inputmode="decimal" aria-label="Parcial 1 de ${h(label(c))}" data-change="grade" data-id="${h(c.id)}" data-f="p1" value="${h(c.p1 == null ? '' : L.fmt(c.p1))}"></td>
      <td class="n"><input class="grade-in" inputmode="decimal" aria-label="Parcial 2 de ${h(label(c))}" data-change="grade" data-id="${h(c.id)}" data-f="p2" value="${h(c.p2 == null ? '' : L.fmt(c.p2))}"></td>
      ${gradeTail(c.p1, c.p2)}
    </tr>${gradeNeedRow(c.p1, c.p2)}`).join('');

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
    <section class="card"><div class="card-head"><h2>Este cuatrimestre</h2></div>
      <p class="sub" style="margin:-4px 0 8px">Cuánto necesitás en el parcial 2 para que el promedio de los dos te dé 4, 6 u 8. Tu materia puede tener otra regla.</p>
      ${current.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Materia</th><th class="n">Parcial 1</th><th class="n">Parcial 2</th><th class="n">Estimado</th>${[4, 6, 8].map((t) => `<th class="n hide-sm">Para ${t}</th>`).join('')}</tr></thead><tbody>${curRows}</tbody></table></div><p class="err" id="grade-err" role="alert"></p>` : '<p class="sub">Marcá en Carrera qué materias estás cursando y aparecen acá.</p>'}</section>
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
  function yearChart() {
    const subj = L.subjects(S);
    const yrs = [...new Set(subj.map((c) => c.year))].sort((a, b) => a - b);
    const rows = yrs.map((y) => {
      const list = subj.filter((c) => c.year === y);
      const a = list.filter(L.isApproved).length; const c = list.filter(L.isCurrent).length; const n = list.length;
      return `<div class="yc-row" data-tip="${y}° año: ${a} aprobadas, ${c} cursando, ${n - a - c} por hacer"><span class="yc-lbl">${y}° año</span><span class="yc-bar"><i class="a" style="width:${ratio(a, n) * 100}%"></i><i class="c" style="width:${ratio(c, n) * 100}%"></i></span><span class="yc-val">${a} de ${n}</span></div>`;
    }).join('');
    return `<section class="card mt"><div class="card-head"><h2>Año por año</h2><span class="sub">Materias aprobadas de cada año</span></div>${rows}
      <div class="key" style="margin-top:8px"><span><i style="background:var(--accent)"></i>aprobadas</span><span><i style="background:var(--hi-strong)"></i>cursando</span><span><i style="background:var(--none)"></i>por hacer</span></div></section>`;
  }
  function viewCarrera() {
    const cs = L.careerStats(S);
    const st = S.settings;
    const yrs = [...new Set(S.courses.map((c) => c.year))].sort((a, b) => a - b);
    let body = '';
    const mileChip = (m) => `<span class="mile">${m.sem === 'Anual' ? 'Todo el año: ' : ''}${h(m.text)} <button style="background:none;border:0;cursor:pointer;color:inherit" data-act="del-mile" data-id="${h(m.text)}" aria-label="Borrar hito">×</button></span>`;
    yrs.forEach((y) => {
      const yc = S.courses.filter((c) => c.year === y);
      // Hitos de todo el año (o de un cuatrimestre que todavía no tiene materias): van junto al título del año.
      const sems = new Set(yc.map((c) => c.sem));
      const yearMiles = (S.milestones || []).filter((m) => m.year === y && !sems.has(m.sem));
      body += `<h2 class="year-h">${y}° año${yearMiles.length ? ` <span class="year-miles">${yearMiles.map(mileChip).join('')}</span>` : ''}</h2>`;
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
    const orphan = (S.milestones || []).filter((m) => !yrs.includes(m.year));
    if (orphan.length) body += `<h2 class="year-h">Otros hitos</h2><div class="sem-h">${orphan.sort((a, b) => a.year - b.year).map((m) => `<span class="mile">${h(termShort(m.year, m.sem))}: ${h(m.text)} <button style="background:none;border:0;cursor:pointer;color:inherit" data-act="del-mile" data-id="${h(m.text)}" aria-label="Borrar hito">×</button></span>`).join('')}</div>`;
    const lead = cs.total ? `${pl(cs.total - cs.approved - cs.current, 'materia', 'materias')} por delante, ${cs.current} en curso, ${pl(cs.approved, 'aprobada', 'aprobadas')}${st.entryYear ? `. Empezaste en ${h(st.entryYear)}` : ''}${st.university ? ` · ${h(st.university)}` : ''}.` : 'Cargá tu plan y mirá cuánto te falta.';
    return `
    <header class="head"><div><h1>${h(st.career || 'Tu carrera')}</h1><p class="lead">${lead}</p>${wrappedTerms().length ? '<button class="btn ghost small wrapped-btn" data-act="wrapped">Tu resumen del cuatrimestre</button>' : ''}</div>
      ${cs.total ? `<div class="figs"><div class="fig"><b>${L.pct(ratio(cs.approved, cs.total))}</b><span>de la carrera</span></div></div>` : ''}</header>
    ${cs.total ? `<section class="card career">${careerStrip(false)}<div class="zig-foot">${careerKey()}</div></section>${yearChart()}` : ''}
    <section class="card mt"><div class="card-head"><h2>Plan de estudios</h2><span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn ghost small" data-act="add-plan">Agregar materias</button>${cs.total ? '<button class="btn ghost small" data-act="add-mile">Agregar hito</button>' : ''}</span></div>${body || '<p class="sub">Todavía no hay materias. Pegá la lista de tu plan y se arma sola.</p>'}</section>`;
  }

  // ---------- MATERIAL
  const doubtsOf = (p) => (p.doubts || []).filter((i) => i < p.items.length);
  function materialRow(p) {
    const k = kindOf(p);
    const d = p.items.filter(Boolean).length;
    const dz = doubtsOf(p);
    const dateTxt = p.date ? `<span class="sub mat-date${!isComplete(p) && L.daysBetween(today(), L.parseDate(p.date)) < 0 ? ' late' : ''}">${shortDate(L.parseDate(p.date))}</span>` : '';
    const linkTxt = p.link ? `<a class="linkish" href="${h(safeUrl(p.link))}" target="_blank" rel="noopener">Abrir</a>` : '';
    const edit = `<button class="linkish" data-act="edit-prac" data-id="${h(p.id)}" aria-label="Editar ${h(p.name)}">Editar</button>`;
    const note = `<label class="doubt-note${p.doubtNote || dz.length ? '' : ' is-empty'}"><span>Dudas para consultar</span><textarea rows="2" data-change="prac-doubt-note" data-id="${h(p.id)}" placeholder="Ej.: en el 4 no entiendo de dónde sale el 2">${h(p.doubtNote || '')}</textarea></label>`;
    if (p.single) {
      const has = dz.length > 0;
      return `<details class="pr single" data-id="${h(p.id)}"${ui.openPrac.has(p.id) ? ' open' : ''}><summary><button class="mat-check" aria-pressed="${!!p.items[0]}" data-act="ex" data-id="${h(p.id)}" data-i="0" aria-label="${p.items[0] ? 'Marcar sin hacer' : 'Marcar como hecho'}: ${h(p.name)}">${p.items[0] ? '✓' : ''}</button><span class="mat-name${p.items[0] ? ' done' : ''}">${h(p.name)}</span><span class="pill">${h(k.n)}</span>${has ? '<span class="pill doubt">Con dudas</span>' : ''}${dateTxt}</summary>
      <div class="pr-body">${note}<div class="pr-tools"><button class="linkish" data-act="doubt-single" data-id="${h(p.id)}">${has ? 'Ya no tengo dudas' : 'Me quedaron dudas'}</button>${linkTxt}${edit}<button class="linkish danger" data-act="del-prac" data-id="${h(p.id)}">Borrar</button></div></div></details>`;
    }
    const mode = ui.doubtMode.has(p.id);
    const total = p.known ? p.items.length : null;
    return `<details class="pr" data-id="${h(p.id)}"${ui.openPrac.has(p.id) ? ' open' : ''}><summary><span class="pr-title"><b>${h(p.name)}</b><span class="pr-sub">${h(k.n)}${dz.length ? ` · <span class="doubt-txt">${pl(dz.length, 'duda', 'dudas')}</span>` : ''}</span></span>${total ? `<span class="pr-bar" style="--v:${ratio(d, total)}" aria-hidden="true"></span>` : ''}<span class="pr-count">${total ? `${d}/${total}` : `${d} ${d === 1 ? 'hecho' : 'hechos'}`}</span></summary>
    <div class="pr-body">${dateTxt ? `<div class="pr-meta">${dateTxt}</div>` : ''}
      <div class="pr-actions"><div class="doubt-switch choice" role="group" aria-label="Qué marca un toque"><button data-act="doubt-mode" data-id="${h(p.id)}" data-v="" aria-pressed="${!mode}">✓ Hecho</button><button data-act="doubt-mode" data-id="${h(p.id)}" data-v="1" aria-pressed="${mode}">? Duda</button></div>${p.known && p.items.length ? `<button class="btn ghost small all-btn" data-act="prac-all" data-id="${h(p.id)}">${p.items.every(Boolean) ? 'Destildar todos' : `Tildar los ${p.items.length}`}</button>` : ''}</div>
      <div class="ex-grid${mode ? ' doubt-on' : ''}">${p.items.map((v, i) => `<button class="ex${dz.includes(i) ? ' has-doubt' : ''}" aria-pressed="${!!v}" data-act="ex" data-id="${h(p.id)}" data-i="${i}" aria-label="${h(k.one)} ${i + 1}, ${h(p.name)}${dz.includes(i) ? ', con duda' : ''}">${i + 1}</button>`).join('')}${p.known ? '' : `<button class="ex add" data-act="ex-add" data-id="${h(p.id)}" aria-label="Sumar ${h(k.one)} hecho en ${h(p.name)}">+</button>`}</div>
      ${note}
      <div class="pr-tools"><label>Tiene <input class="grade-in" inputmode="numeric" data-change="prac-total" data-id="${h(p.id)}" value="${p.known ? p.items.length : ''}" placeholder="?" aria-label="Cantidad de ${h(k.unit)} de ${h(p.name)}"> ${h(k.unit)}</label>${linkTxt}${edit}<button class="linkish danger" data-act="del-prac" data-id="${h(p.id)}">Borrar</button></div></div></details>`;
  }
  // Torta de avance de una materia. Sin material queda vacía (no es 0% ni 100%: no hay nada que medir).
  function donut(pct, color, empty, doneCount) {
    const r = 26; const c = 2 * Math.PI * r;
    const v = empty || pct === null ? 0 : Math.max(0, Math.min(1, pct));
    const label = empty ? '' : pct === null ? String(doneCount || 0) : `${Math.round(v * 100)}<small>%</small>`;
    return `<span class="donut${empty ? ' is-empty' : ''}" aria-hidden="true"><svg viewBox="0 0 64 64"><circle class="donut-bg" cx="32" cy="32" r="${r}"/>${v > 0 ? `<circle class="donut-fg" cx="32" cy="32" r="${r}" style="stroke:${color}" stroke-dasharray="${(v * c).toFixed(2)} ${c.toFixed(2)}"/>` : ''}</svg><b>${label}</b></span>`;
  }
  function viewMaterial() {
    const subs = pracSubjects();
    const all = pracStats(S.practices);
    const present = Object.keys(KINDS).filter((k) => S.practices.some((p) => (p.kind || 'practica') === k));
    const kindF = present.includes(ui.kindFilter) ? ui.kindFilter : null;
    const chips = present.length > 1 ? `<div class="choice kind-chips" role="group" aria-label="Filtrar por tipo"><button data-act="kind-filter" data-k="" aria-pressed="${!kindF}">Todo</button>${present.map((k) => `<button data-act="kind-filter" data-k="${k}" aria-pressed="${kindF === k}">${h(KINDS[k].many)}</button>`).join('')}</div>` : '';
    const totalDoubts = S.practices.reduce((a, p) => a + doubtsOf(p).length, 0);
    // Archivadas: las que archivaste a mano, o las que ya no estás cursando. Sus datos quedan guardados abajo.
    const arch = S.studyArchive || {};
    const isArchived = (k) => { if (arch[k] === false) return false; if (arch[k]) return true; const co = latestOf(k); return !!co && !L.isCurrent(co); };
    const activeSubs = subs.filter((k) => !isArchived(k));
    const oldSubs = subs.filter(isArchived);
    const box = (k, archived) => {
      const full = S.practices.filter((p) => subjOfPractice(p) === k);
      const list = full.filter((p) => !kindF || (p.kind || 'practica') === kindF);
      if (kindF && !list.length) return '';
      const st = pracStats(full);
      const co = latestOf(k);
      const dz = full.reduce((a, p) => a + doubtsOf(p).length, 0);
      const doneAll = full.reduce((a, p) => a + p.items.filter(Boolean).length, 0);
      const line = !st.count ? 'Todavía sin material' : st.pct === null ? `${doneAll} ${doneAll === 1 ? 'hecho' : 'hechos'}. Poné cuántos tiene cada material para ver el porcentaje.` : `${st.complete} de ${st.count} ${st.count === 1 ? 'terminado' : 'terminados'}${st.unknown ? ` · ${st.unknown} sin total` : ''}`;
      const aria = !st.count ? 'sin material' : st.pct === null ? 'sin totales cargados' : `${L.pct(st.pct)} hecho`;
      const open = ui.openSubj.has(k) || !!kindF;
      return `<details class="sbox" data-subj="${h(k)}" style="--mc:${colorOf(k)}"${open ? ' open' : ''}>
        <summary class="sbox-head" aria-label="${h(matLabel(k))}, ${aria}">${donut(st.pct, colorOf(k), !st.count, doneAll)}<div class="sbox-info"><h2>${h(matLabel(k))}</h2><p class="sub">${line}</p>${dz ? `<span class="pill doubt">${pl(dz, 'duda', 'dudas')} para consultar</span>` : ''}</div><span class="chev" aria-hidden="true"></span></summary>
        <div class="sbox-body">${list.map(materialRow).join('') || '<p class="sub sbox-empty">Sumá lo primero: una práctica, una lectura, un video o un TP. Si tiene ejercicios, vas a poder tildarlos uno por uno.</p>'}
        <div class="sbox-tools">${archived ? '' : `<button class="btn ghost small sbox-add" data-act="add-prac" data-course="${h(co ? co.id : '')}">Agregar material</button>`}<button class="linkish" data-act="study-archive" data-subj="${h(k)}" data-v="${archived ? '' : '1'}">${archived ? 'Desarchivar' : 'Archivar materia'}</button></div></div>
      </details>`;
    };
    const boxes = activeSubs.map((k) => box(k, false)).join('');
    const oldBoxes = oldSubs.map((k) => box(k, true)).join('');
    return `
    <header class="head"><div><h1>Estudio</h1><p class="lead">Tu avance en cada materia. Tocá una para ver sus prácticas, lecturas y TP, tildar lo que hiciste y marcar con <b>?</b> lo que te quedó en duda.</p></div>
      ${all.count ? `<div class="figs"><div class="fig"><b>${all.complete}<small> de ${all.count}</small></b><span>terminados</span></div>${totalDoubts ? `<div class="fig"><b>${totalDoubts}</b><span>${totalDoubts === 1 ? 'duda' : 'dudas'} para consultar</span></div>` : ''}</div>` : ''}</header>
    ${pomoHtml()}
    ${chips}
    ${activeSubs.length ? `<div class="study-grid mt">${boxes}</div>` : '<section class="card mt"><div class="empty"><b>Todavía no hay materias en curso.</b>Marcá qué estás cursando en Carrera, o agregá material a cualquier materia.</div></section>'}
    ${oldSubs.length ? `<details class="study-old mt"${ui.showOldStudy ? ' open' : ''}><summary><span>Cursadas anteriores y archivadas</span><span class="sub">${pl(oldSubs.length, 'materia', 'materias')} · todo lo que tildaste queda guardado</span></summary><div class="study-grid mt">${oldBoxes}</div></details>` : ''}
    <div class="actions" style="justify-content:flex-start"><button class="btn ghost" data-act="add-prac" data-course="">Agregar material de otra materia</button></div>`;
  }

  // ---------- POMODORO: bloques de concentración y descanso, con sonidos de ambiente hechos acá mismo.
  // El reloj vive aparte de la pantalla: si cambiás de sección, sigue corriendo.
  const POMO_PRESETS = [[25, 5], [50, 10], [15, 3]];
  const POMO_SOUNDS = { '': 'Silencio', lluvia: 'Lluvia', olas: 'Olas', ruido: 'Ruido suave', viento: 'Viento' };
  const pomo = { mode: 'focus', running: false, endAt: 0, left: null, cycle: 0, subj: '' };
  try { Object.assign(pomo, JSON.parse(localStorage.getItem('cursadok-pomo') || '{}')); } catch (e) { /* sin almacenamiento: arranca de cero */ }
  const pomoKeep = () => { try { localStorage.setItem('cursadok-pomo', JSON.stringify(pomo)); } catch (e) { /* no pasa nada */ } };
  const pomoCfg = () => ({ work: 25, brk: 5, sound: '', vol: 0.5, ...((S && S.settings.pomo) || {}) });
  const pomoTotal = (mode = pomo.mode) => (mode === 'focus' ? pomoCfg().work : mode === 'long' ? Math.max(15, pomoCfg().brk * 3) : pomoCfg().brk) * 60000;
  const pomoLeft = () => (pomo.running ? Math.max(0, pomo.endAt - Date.now()) : (pomo.left ?? pomoTotal()));
  const mmss = (ms) => { const t = Math.ceil(ms / 1000); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const POMO_MODE = { focus: 'Concentración', break: 'Descanso', long: 'Descanso largo' };
  function pomoToday() {
    const d = L.iso(today());
    const list = (S.pomodoros || []).filter((p) => p.d === d);
    return { n: list.length, min: list.reduce((a, p) => a + (p.min || 0), 0) };
  }
  function pomoHtml() {
    const cfg = pomoCfg(); const left = pomoLeft(); const total = pomoTotal();
    const subs = S.courses.filter(L.isCurrent);
    const td = pomoToday();
    const r = 52; const c = 2 * Math.PI * r; const done = 1 - left / total;
    const petOn = S.settings.pet && pomo.mode === 'focus' && pomo.running;
    return `<section class="card pomo mt pomo-${pomo.mode}${pomo.running ? ' is-running' : ''}" aria-label="Pomodoro">
      <div class="card-head"><h2>Pomodoro</h2><span class="sub" id="pomo-today">${td.n ? `Hoy: ${pl(td.n, 'pomodoro', 'pomodoros')} · ${td.min} min` : 'Bloques de concentración con descansos cortos'}</span></div>
      <div class="pomo-main">
        <div class="pomo-ring" role="timer" aria-live="off" aria-label="${POMO_MODE[pomo.mode]}">
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="pomo-bg" cx="60" cy="60" r="${r}"/><circle class="pomo-fg" id="pomo-arc" cx="60" cy="60" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - done)).toFixed(1)}"/></svg>
          <div class="pomo-read"><b id="pomo-time">${mmss(left)}</b><span id="pomo-mode">${POMO_MODE[pomo.mode]}</span></div>
          ${petOn ? `<span class="pomo-pet">${petSvg(S.settings.pet, 'study')}</span>` : ''}
        </div>
        <div class="pomo-side">
          <div class="choice pomo-presets" role="group" aria-label="Duración">${POMO_PRESETS.map(([w, b]) => `<button type="button" data-act="pomo-preset" data-w="${w}" data-b="${b}" aria-pressed="${cfg.work === w && cfg.brk === b}">${w} / ${b} min</button>`).join('')}</div>
          <label class="field">Estudiando<select data-change="pomo-subj" aria-label="Materia que estudiás"><option value="">Sin materia en particular</option>${subs.map((co) => `<option value="${h(co.subj)}"${pomo.subj === co.subj ? ' selected' : ''}>${h(label(co))}</option>`).join('')}</select></label>
          <div class="actions pomo-btns">
            <button type="button" class="btn" data-act="pomo-toggle">${pomo.running ? 'Pausar' : left < total ? 'Seguir' : 'Empezar'}</button>
            <button type="button" class="btn ghost" data-act="pomo-reset">Reiniciar</button>
            <button type="button" class="btn ghost" data-act="pomo-skip">${pomo.mode === 'focus' ? 'Ir al descanso' : 'Volver a estudiar'}</button>
          </div>
        </div>
      </div>
      <div class="pomo-sound"><span class="section-label" style="margin:0">Sonido de fondo</span>
        <div class="choice" role="group" aria-label="Sonido de fondo">${Object.entries(POMO_SOUNDS).map(([k, n]) => `<button type="button" data-act="pomo-sound" data-v="${k}" aria-pressed="${cfg.sound === k}">${n}</button>`).join('')}</div>
        ${cfg.sound ? `<label class="pomo-vol">Volumen<input type="range" min="0" max="1" step="0.05" value="${cfg.vol}" data-change="pomo-vol" aria-label="Volumen del sonido"></label>` : ''}
        <span class="sub">Suena mientras te concentrás. Al terminar cada bloque, suena una campanita.</span>
      </div>
    </section>`;
  }
  // Sonidos de ambiente: ruido generado y filtrado (no se descarga nada).
  let actx = null; let amb = null;
  function ambStop() { if (amb) { try { amb.nodes.forEach((n) => { try { n.stop && n.stop(); } catch (e) { /* ya parado */ } n.disconnect && n.disconnect(); }); } catch (e) { /* nada */ } amb = null; } }
  function ambStart() {
    ambStop();
    const { sound, vol } = pomoCfg();
    if (!sound || pomo.mode !== 'focus' || !pomo.running) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const sr = actx.sampleRate; const buf = actx.createBuffer(1, sr * 6, sr); const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (sound === 'lluvia') d[i] = w * 0.5; else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; } }
      const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
      const master = actx.createGain(); master.gain.value = 0;
      const nodes = [src, master];
      let chain = src;
      const filt = (type, f, q = 0.7) => { const b = actx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; chain.connect(b); chain = b; nodes.push(b); return b; };
      if (sound === 'lluvia') { filt('highpass', 900); filt('lowpass', 7000); }
      if (sound === 'ruido') filt('lowpass', 900);
      if (sound === 'olas' || sound === 'viento') {
        const bp = sound === 'viento' ? filt('bandpass', 420, 1.4) : filt('lowpass', 700);
        const swell = actx.createGain(); chain.connect(swell); chain = swell; nodes.push(swell);
        const lfo = actx.createOscillator(); lfo.frequency.value = sound === 'olas' ? 0.09 : 0.17;
        const depth = actx.createGain(); depth.gain.value = sound === 'olas' ? 0.45 : 0.3; swell.gain.value = 0.6;
        lfo.connect(depth); depth.connect(swell.gain); lfo.start(); nodes.push(lfo, depth);
        if (sound === 'viento') { const lfo2 = actx.createOscillator(); lfo2.frequency.value = 0.07; const d2 = actx.createGain(); d2.gain.value = 180; lfo2.connect(d2); d2.connect(bp.frequency); lfo2.start(); nodes.push(lfo2, d2); }
      }
      chain.connect(master); master.connect(actx.destination);
      src.start();
      master.gain.linearRampToValueAtTime(Number(vol) * 0.6, actx.currentTime + 1.2);
      amb = { nodes, master };
    } catch (e) { /* el navegador no deja audio: el timer sigue igual */ }
  }
  function bell() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      [880, 1320, 1760].forEach((f, i) => {
        const o = actx.createOscillator(); const g = actx.createGain(); o.type = 'sine'; o.frequency.value = f;
        const t0 = actx.currentTime + i * 0.12; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25 / (i + 1), t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
        o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + 1.7);
      });
    } catch (e) { /* sin audio */ }
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* sin vibración */ }
  }
  let pomoTimer = null;
  function pomoTick() {
    const left = pomoLeft();
    const t = $('#pomo-time'); if (t) t.textContent = mmss(left);
    const arc = $('#pomo-arc'); if (arc) { const c = 2 * Math.PI * 52; arc.setAttribute('stroke-dashoffset', (c * (left / pomoTotal())).toFixed(1)); }
    pomoChip();
    if (pomo.running) document.title = `${mmss(left)} · ${pomo.mode === 'focus' ? 'Concentración' : 'Descanso'} · ${APP_NAME}`;
    if (pomo.running && left <= 0) pomoFinish(true);
  }
  function pomoRun() { clearInterval(pomoTimer); if (pomo.running) pomoTimer = setInterval(pomoTick, 500); pomoTick(); }
  function pomoFinish(counted) {
    if (pomo.mode === 'focus') {
      if (counted) { const min = pomoCfg().work; mutate(() => { S.pomodoros = S.pomodoros || []; S.pomodoros.push({ d: L.iso(today()), subj: pomo.subj || '', min }); }, null); }
      pomo.cycle += 1; pomo.mode = pomo.cycle % 4 === 0 ? 'long' : 'break';
    } else pomo.mode = 'focus';
    pomo.left = null;
    if (counted) { bell(); toast(pomo.mode === 'focus' ? 'Terminó el descanso. ¡A seguir!' : pomo.mode === 'long' ? '¡Cuatro pomodoros! Te ganaste un descanso largo.' : 'Bloque terminado. Tomate un descanso.'); }
    pomo.endAt = Date.now() + pomoTotal(); pomo.running = counted ? true : pomo.running;
    if (!pomo.running) pomo.endAt = 0;
    pomoKeep(); ambStart(); pomoRun();
    if (route() === 'estudio') render();
  }
  function pomoChip() {
    const top = $('.top'); if (!top || !S) return;
    let chip = $('#pomo-chip');
    const show = pomo.running || (pomo.left != null && pomo.left < pomoTotal());
    if (!show || route() === 'estudio') { if (chip) chip.remove(); if (!pomo.running) document.title = APP_NAME; return; }
    if (!chip) { chip = document.createElement('a'); chip.id = 'pomo-chip'; chip.href = '#estudio'; chip.className = 'pomo-chip'; top.insertBefore(chip, top.querySelector('[data-act="settings"]')); }
    chip.textContent = `${pomo.running ? '' : '❚❚ '}${mmss(pomoLeft())} · ${pomo.mode === 'focus' ? 'estudiando' : 'descanso'}`;
    chip.setAttribute('aria-label', `Pomodoro: ${mmss(pomoLeft())}. Ir a Estudio`);
  }
  if (pomo.running) setTimeout(pomoRun, 0);

  // ---------- WRAPPED: el resumen del cuatrimestre, como historias. Se abre solo cuando termina y desde Carrera.
  const SEM_ORDER = { A: 0, B: 1, Anual: 2 };
  const termKey = (t) => `${t.year}${t.sem}`;
  function currentTerm() {
    const cur = S.courses.filter(L.isCurrent);
    if (!cur.length) return null;
    const count = {};
    cur.forEach((c) => { const k = termKey(c); count[k] = (count[k] || 0) + 1; });
    const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    const c = cur.find((x) => termKey(x) === top);
    return { year: c.year, sem: c.sem };
  }
  // Cuatrimestres con algo para contar: notas cargadas, o el que estás cursando.
  function wrappedTerms() {
    const cur = currentTerm();
    const map = new Map();
    S.courses.forEach((c) => {
      const has = c.p1 != null || c.p2 != null || c.final != null || (cur && termKey(c) === termKey(cur));
      if (has && !map.has(termKey(c))) map.set(termKey(c), { year: c.year, sem: c.sem });
    });
    return [...map.values()].sort((a, b) => a.year - b.year || SEM_ORDER[a.sem] - SEM_ORDER[b.sem]);
  }
  function semesterEnded() {
    if (!S.classes.length) return false;
    const wk = L.weekNumber(S, today());
    return wk >= 1 && !S.weeks.find((w) => w.n === wk);
  }
  function maybeAutoWrapped() {
    const cur = currentTerm();
    if (!cur || !semesterEnded() || S.settings.wrappedSeen === termKey(cur) || modal().open || $('#wrapped')) return;
    S.settings.wrappedSeen = termKey(cur);
    save();
    setTimeout(() => openWrapped(termKey(cur)), 600);
  }
  function wrappedData(term) {
    const k = termKey(term);
    const cur = currentTerm();
    const courses = S.courses.filter((c) => termKey(c) === k);
    const ids = new Set(courses.map((c) => c.id));
    // Asistencia: la del cuatrimestre actual, o la que quedó archivada al empezar uno nuevo.
    let attState = null;
    if (cur && termKey(cur) === k) attState = S;
    else {
      const old = (S.history || []).find((x) => x.term && termKey(x.term) === k);
      if (old) attState = { ...S, classes: old.classes || [], weeks: old.weeks || [], att: old.att || {}, holidays: [] };
    }
    let att = null;
    if (attState && attState.classes.length) {
      const t = L.tally(L.allCells(attState));
      if (t.taken) {
        const st = L.streaks(attState);
        const days = L.absencesByDay(attState).map((d) => ({ ...d, r: d.a + d.p ? d.a / (d.a + d.p) : 0 })).sort((a, b) => b.r - a.r);
        att = { pct: t.pct, p: t.p, a: t.a, best: st.best, worst: days[0] && days[0].r >= 0.1 ? days[0] : null };
      }
    }
    const finals = courses.filter((c) => c.final != null);
    const best = [...finals].sort((a, b) => b.final - a.final)[0] || null;
    const imp = L.improvements({ courses });
    const prs = S.practices.filter((p) => ids.has(p.course));
    const done = prs.reduce((a, p) => a + p.items.filter(Boolean).length, 0);
    const exams = (S.agenda || []).filter((a) => ids.has(a.course)).length;
    return { term, courses, att, finals, avg: L.avg(finals.map((c) => c.final)), approved: courses.filter(L.isApproved).length, best, imp, done, complete: prs.filter(isComplete).length, mats: prs.length, exams };
  }
  function wrappedSlides(d) {
    const minAtt = S.settings.minAtt;
    const termName = termShort(d.term.year, d.term.sem);
    const out = [];
    out.push({ cls: 'w-intro', html: `<p class="w-kicker">Tu resumen</p><h2 class="w-title">${h(termName)}</h2><p class="w-sub">${pl(d.courses.length, 'materia', 'materias')}${d.exams ? `, ${pl(d.exams, 'examen anotado', 'exámenes anotados')}` : ''}. Así te fue.</p><p class="w-hint">Tocá para seguir</p>` });
    if (d.att) {
      const joke = d.att.pct >= 0.95 ? 'Los del buffet ya te saludan por tu nombre.' : d.att.pct >= minAtt + 0.1 ? 'Presente casi siempre. Puntualidad, no te prometemos.' : d.att.pct >= minAtt ? 'Cumpliste. Con lo justo, pero cumpliste.' : 'El mínimo y vos: una relación complicada.';
      out.push({ cls: 'w-att', html: `<p class="w-kicker">Asistencia</p><p class="w-big">${L.pct(d.att.pct)}</p><p class="w-sub">Fuiste a ${pl(d.att.p, 'clase', 'clases')}${d.att.best >= 3 ? ` y tu mejor racha fue de ${d.att.best} seguidas` : ''}.</p><p class="w-joke">${h(joke)}</p>` });
      if (d.att.worst) {
        const day = L.DIAS[d.att.worst.dow];
        const plural = /s$/.test(day) ? day : `${day}s`;
        out.push({ cls: 'w-day', html: `<p class="w-kicker">Tu día más difícil</p><p class="w-big w-word">Los ${h(plural)}</p><p class="w-sub">Faltaste al ${L.pct(d.att.worst.r)} de esas clases.</p><p class="w-joke">No es personal con los ${h(plural)}. O sí.</p>` });
      }
    }
    if (d.finals.length) {
      const joke = d.avg >= 8.5 ? 'Nivel cuadro de honor.' : d.avg >= 7 ? 'Sólido. Nadie te puede decir nada.' : d.avg >= 4 ? 'Aprobado es aprobado, y eso no lo discute nadie.' : 'Cuatrimestre difícil. El próximo arranca de cero.';
      out.push({ cls: 'w-grades', html: `<p class="w-kicker">Notas</p><p class="w-big">${L.fmt(d.avg)}</p><p class="w-sub">de promedio. Aprobaste ${d.approved} de ${d.courses.length}.</p>${d.best ? `<p class="w-pill">Tu mejor nota: <b>${L.fmt(d.best.final)}</b> en ${h(label(d.best))}</p>` : ''}<p class="w-joke">${h(joke)}</p>` });
    }
    if (d.imp.n) {
      const up = d.imp.delta > 0;
      out.push({ cls: 'w-imp', html: `<p class="w-kicker">Del primer al segundo parcial</p><p class="w-big w-mid">${L.fmt(d.imp.avgP1)} → ${L.fmt(d.imp.avgP2)}</p><p class="w-sub">${up ? `Subiste en ${d.imp.up} de ${d.imp.n} materias.` : d.imp.delta < 0 ? `En ${d.imp.down} de ${d.imp.n} materias el segundo costó más.` : 'Pareja de punta a punta.'}</p>${d.imp.best ? `<p class="w-pill">La que más subió: <b>${h(label(d.imp.best.course))}</b>, +${L.fmt(d.imp.best.delta)}</p>` : ''}<p class="w-joke">${up ? 'Arrancar despacio y cerrar fuerte: un clásico.' : 'El segundo parcial siempre viene con más temas, no es tu culpa.'}</p>` });
    }
    if (d.done) {
      out.push({ cls: 'w-study', html: `<p class="w-kicker">Estudio</p><p class="w-big">${d.done}</p><p class="w-sub">${d.done === 1 ? 'cosa tildada' : 'cosas tildadas'} en Estudio${d.complete ? `, y ${pl(d.complete, 'material terminado', 'materiales terminados')} de punta a punta` : ''}.</p><p class="w-joke">${d.done >= 100 ? 'Más de cien. Tu birome pide vacaciones.' : 'Cada tilde fue un ejercicio menos para la noche anterior.'}</p>` });
    }
    out.push({ cls: 'w-end', html: `<p class="w-kicker">${h(termName)}</p><h2 class="w-title">Cerrado.</h2><p class="w-sub">${d.approved ? `${pl(d.approved, 'materia', 'materias')} menos en el plan.` : 'Lo que viene, viene con todo esto aprendido.'}</p><p class="w-joke">Ahora sí: a dormir doce horas.</p>` });
    return out;
  }
  let wrappedState = null;
  function openWrapped(key, pick) {
    const terms = wrappedTerms();
    if (!terms.length) return;
    const cur = currentTerm();
    const term = terms.find((t) => termKey(t) === key) || (cur && terms.find((t) => termKey(t) === termKey(cur))) || terms[terms.length - 1];
    // Desde Carrera: primero elegís qué cuatrimestre ver.
    const picker = pick && terms.length > 1 ? { cls: 'w-pick', html: `<p class="w-kicker">Tu resumen</p><h2 class="w-title">¿Qué cuatrimestre querés ver?</h2><div class="w-pick-list">${[...new Set(terms.map((x) => x.year))].map((y) => `<div class="w-pick-year"><span>${y}° año</span>${terms.filter((x) => x.year === y).map((x) => `<button data-w="term" data-term="${termKey(x)}">${x.sem === 'Anual' ? 'Anual' : `${x.sem === 'A' ? 'Primer' : 'Segundo'} ${(S.settings.termWord || 'cuatrimestre').toLowerCase()}`}${cur && termKey(cur) === termKey(x) ? ' <small>en curso</small>' : ''}</button>`).join('')}</div>`).join('')}</div>` } : null;
    wrappedState = { term, i: 0, slides: picker ? [picker] : wrappedSlides(wrappedData(term)), terms, picking: !!picker };
    let dlg = $('#wrapped');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'wrapped'; dlg.className = 'wrapped'; dlg.setAttribute('aria-label', 'Resumen del cuatrimestre');
      document.body.append(dlg);
      dlg.addEventListener('close', () => { dlg.remove(); wrappedState = null; });
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-w]');
        if (b) { e.stopPropagation(); const w = b.dataset.w; if (w === 'close') dlg.close(); else if (w === 'term') openWrapped(b.dataset.term); return; }
        if (e.target.closest('.w-stage') && !(wrappedState && wrappedState.picking)) { const r = dlg.querySelector('.w-stage').getBoundingClientRect(); wrappedGo(e.clientX < r.left + r.width / 3 ? -1 : 1); }
      });
      dlg.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); wrappedGo(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); wrappedGo(-1); } });
    }
    drawWrapped();
    if (!dlg.open) dlg.showModal();
  }
  function wrappedGo(n) {
    if (!wrappedState) return;
    const i = wrappedState.i + n;
    if (i < 0) return;
    if (i >= wrappedState.slides.length) { $('#wrapped').close(); return; }
    wrappedState.i = i; drawWrapped();
  }
  function drawWrapped() {
    const { slides, i, terms, term, picking } = wrappedState;
    const sl = slides[i];
    if (picking) {
      $('#wrapped').innerHTML = `<button class="w-close" data-w="close" aria-label="Cerrar">×</button><div class="w-stage w-pick" role="group"><div class="w-slide">${sl.html}</div></div>`;
      return;
    }
    $('#wrapped').innerHTML = `<div class="w-bars" aria-hidden="true">${slides.map((_, j) => `<i class="${j < i ? 'done' : j === i ? 'now' : ''}"></i>`).join('')}</div>
      <button class="w-close" data-w="close" aria-label="Cerrar">×</button>
      <div class="w-stage ${sl.cls}" role="group" aria-roledescription="historia" aria-label="${i + 1} de ${slides.length}"><div class="w-slide" aria-live="polite">${sl.html}</div></div>
      ${terms.length > 1 ? `<div class="w-terms" role="group" aria-label="Otros cuatrimestres">${terms.map((t) => `<button data-w="term" data-term="${termKey(t)}" aria-pressed="${termKey(t) === termKey(term)}">${t.year}° ${t.sem === 'Anual' ? 'anual' : t.sem}</button>`).join('')}</div>` : ''}`;
    const st = $('#wrapped .w-stage'); if (st) st.focus && st.setAttribute('tabindex', '-1');
  }

  // ---------- BENEFICIOS
  function viewBeneficios() {
    const B = window.CursadaBenefits || { items: [] };
    const cats = [['', 'Todos', 'grid'], ['transporte', 'Transporte', 'bus'], ['cultura', 'Cultura', 'ticket'], ['comida', 'Comida y compras', 'cup'], ['salud', 'Salud', 'heart'], ['bancos', 'Bancos', 'bank'], ['programas', 'Programas y apps', 'laptop']];
    // Por lugar. "Todo el país" también aparece en CABA y en Provincia.
    const places = [['', 'Todos los lugares', 'pin', () => true], ['online', 'Online', 'globe', (w) => w === 'Online'], ['caba', 'CABA', 'pin', (w) => w === 'CABA' || w === 'Todo el país'], ['pba', 'Provincia', 'pin', (w) => w === 'Provincia de Buenos Aires' || w === 'La Plata' || w === 'Todo el país'], ['pais', 'Todo el país', 'pin', (w) => w === 'Todo el país'], ['facu', 'Tu facu', 'carrera', (w) => w === 'Tu universidad']];
    const f = ui.benefitFilter || '';
    const pf = ui.placeFilter || '';
    const place = places.find((x) => x[0] === pf) || places[0];
    const list = B.items.filter((b) => (!f || b.cat === f) && place[3](b.where));
    const chip = (act, k, n, ic, on) => `<button data-act="${act}" data-k="${k}" aria-pressed="${on}">${icon(ic)}<span>${n}</span></button>`;
    return `
    <header class="head"><div><h1>Beneficios</h1><p class="lead">Descuentos y cosas gratis por ser estudiante. La mayoría se piden con el certificado de alumno regular o con el mail de tu facu.</p></div></header>
    <div class="ben-filters">
      <div class="choice ico-chips" role="group" aria-label="Filtrar por tipo">${cats.map(([k, n, ic]) => chip('benefit-filter', k, n, ic, f === k)).join('')}</div>
      <div class="choice ico-chips place-chips" role="group" aria-label="Filtrar por lugar">${places.map(([k, n, ic]) => chip('place-filter', k, n, ic, pf === k)).join('')}</div>
    </div>
    <p class="sub ben-count">${pl(list.length, 'beneficio', 'beneficios')}</p>
    <div class="ben-grid">${list.map((b) => `<article class="card ben" data-act="benefit" data-i="${B.items.indexOf(b)}">
      <div class="ben-top">${b.logo ? `<img class="ben-logo" src="icons/benefits/${h(b.logo)}.png" alt="" width="40" height="40" loading="lazy">` : `<span class="ben-logo ben-logo-ph" aria-hidden="true">${icon('beneficios')}</span>`}<div class="ben-head"><span class="ben-org">${h([b.org, b.where].filter((x, i, a) => x && a.indexOf(x) === i).join(' · '))}</span><h2>${h(b.title)}</h2></div></div>
      <p class="ben-what">${h(b.what)}</p>
      <button class="linkish ben-more-btn" data-act="benefit" data-i="${B.items.indexOf(b)}">Ver más</button>
    </article>`).join('') || '<p class="sub">No hay beneficios con esos filtros. Probá con otro lugar.</p>'}</div>
    <p class="sub mt">Revisados en ${h(B.checked)}. Los beneficios cambian seguido: confirmá en el link antes de usarlos. Los logos son de sus dueños y están solo para que reconozcas cada lugar: ninguno auspicia ni está asociado a CursadOK.</p>`;
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
  const WIZ = ['Vos', 'Tu facu', 'Materias', 'Cuatrimestre', 'Colores'];
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
  function allPrompt() {
    const term = S.settings.termWord || 'Cuatrimestre';
    const year = today().getFullYear();
    return `Te voy a pasar hasta tres archivos de mi facultad: el plan de estudios de mi carrera, mi horario semanal y el calendario académico. Ordená todo con este formato exacto, en cuatro secciones:

PLAN
1er año
${term} 1
Nombre de la materia
Nombre de la materia
${term} 2
Nombre de la materia
2do año
${term} 1
Nombre de la materia

HORARIO
Lunes
Teórica - Nombre de la materia
Práctica - Nombre de la materia
Jueves
Tutorial - Nombre de la materia

CALENDARIO
Inicio de clases: AAAA-MM-DD
Fin de clases: AAAA-MM-DD
Parciales: AAAA-MM-DD a AAAA-MM-DD
Finales: AAAA-MM-DD a AAAA-MM-DD
Feriados:
AAAA-MM-DD

FECHAS
AAAA-MM-DD - Parcial 1 - Nombre de la materia
AAAA-MM-DD - Entrega TP 1 - Nombre de la materia

Reglas:
- PLAN: todas las materias de la carrera, una por línea, con el nombre tal cual figura. Sin códigos, horas ni correlativas. Las materias que duran todo el año van debajo de un título "Anual".
- HORARIO: solo lo que curso este ${term.toLowerCase()}. Un renglón por clase: tipo, un guion y la materia con el mismo nombre que en el PLAN. Si una materia tiene dos bloques el mismo día, escribí el renglón dos veces. Sin horarios, aulas ni profesores.
- CALENDARIO: las fechas del ${term.toLowerCase()} que estoy cursando ahora. Si no te paso el calendario académico, en Feriados poné los feriados nacionales de Argentina de ${year} que caen en esas fechas, y dejá vacíos Parciales y Finales.
- FECHAS: parciales, recuperatorios, entregas y finales de cada materia que aparezcan en los archivos.
- Si te falta un archivo, dejá su sección vacía. No inventes nada. Si una parte no se lee, avisame antes del bloque.
- Respondé con todo dentro de un solo bloque de código, para copiarlo fácil.`;
  }
  function tempSubjects(planText) {
    // Materias del plan pegado más las que ya están cargadas, para reconocer el horario antes de guardar.
    const known = L.subjects(S);
    const fresh = L.parsePlan(planText).items.filter((it) => !known.some((c) => c.subj === L.slug(it.name))).map((it) => ({ id: `nuevo:${L.slug(it.name)}`, subj: L.slug(it.name), name: it.name, short: '' }));
    return [...known, ...fresh];
  }
  function allPreviewHtml(text) {
    if (!text.trim()) return '';
    const r = L.parseAll(text);
    if (!r.found) return '<p class="auth-note">No encontré las secciones PLAN, HORARIO, CALENDARIO o FECHAS. Copiá la respuesta completa de la IA, con los títulos.</p>';
    const plan = L.parsePlan(r.planText).items;
    const sched = L.parseSchedule(r.schedText, tempSubjects(r.planText));
    const c = r.calendar;
    const d = (x) => (x ? shortDate(L.parseDate(x)) : '–');
    const rows = [
      ['Plan de estudios', plan.length ? pl(plan.length, 'materia', 'materias') : 'vacío'],
      ['Horario', sched.items.length ? pl(sched.items.length, 'clase por semana', 'clases por semana') : 'vacío'],
      ['Cuatrimestre', c.start ? `del ${d(c.start)} al ${d(c.end)}` : 'sin fechas'],
      ['Parciales', c.parciales ? `del ${d(c.parciales[0])} al ${d(c.parciales[1])}` : '–'],
      ['Finales', c.finales ? `del ${d(c.finales[0])} al ${d(c.finales[1])}` : '–'],
      ['Feriados', c.holidays.length ? pl(c.holidays.length, 'día', 'días') : '–'],
      ['Fechas de materias', r.fechas.length ? pl(r.fechas.length, 'fecha', 'fechas') : '–'],
    ];
    return `<div class="all-sum">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>${sched.unknown.length ? `<p class="auth-note">Del horario no reconocí: ${sched.unknown.map(h).join(', ')}. Fijate que esas materias estén en el plan.</p>` : ''}`;
  }
  // Empareja lo que te devolvió la IA con las clases que ya tenés: misma materia y mismo día,
  // y si se puede, el mismo tipo ("Teórica" = "Teoría" = "Teórico"). Las que coinciden solo reciben el horario.
  function matchSchedule(items) {
    const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const stem = (x) => norm(x).replace(/[^a-z]/g, '').slice(0, 4);
    const blockOf = (c) => { const m = /bloque (\d+)$/.exec(c.name); return m ? +m[1] : 0; };
    const touched = new Set();
    const perDay = {};
    items.forEach((it) => { const k = `${it.dow}|${it.courseId}`; perDay[k] = (perDay[k] || 0) + 1; });
    return items.map((it) => {
      const co = course(it.courseId);
      if (!co) return { it, co: null, match: null };
      const pool = S.classes.filter((c) => !touched.has(c.id) && c.course === co.id && c.dow === it.dow).sort((a, b) => blockOf(a) - blockOf(b));
      const name = `${it.tipo} ${label(co)}`;
      let match = pool.find((c) => c.name === name)
        || (it.block ? pool.find((c) => stem(c.name) === stem(it.tipo) && blockOf(c) === it.block) : null)
        || pool.find((c) => stem(c.name) === stem(it.tipo))
        || (perDay[`${it.dow}|${it.courseId}`] === 1 && pool.length === 1 ? pool[0] : null)
        || (pool.length && S.classes.filter((c) => c.course === co.id && c.dow === it.dow).length >= perDay[`${it.dow}|${it.courseId}`] ? pool[0] : null);
      if (match) touched.add(match.id);
      return { it, co, match };
    });
  }
  function addScheduleItems(items) {
    const res = { added: 0, updated: 0 };
    const groups = {}; const seen = {};
    items.forEach((it) => { const k = `${it.dow}|${it.courseId}|${it.tipo}`; groups[k] = (groups[k] || 0) + 1; });
    const matched = matchSchedule(items);
    const usedIds = new Set(matched.filter((x) => x.match).map((x) => x.match.id));
    matched.forEach(({ it, co, match }) => {
      if (!co) return;
      if (!L.isCurrent(co)) co.status = 'cursando';
      ensureColor(co.subj);
      const k = `${it.dow}|${it.courseId}|${it.tipo}`;
      seen[k] = (seen[k] || 0) + 1;
      if (match) {
        // Ya la tenías: solo se le pone el horario. Nombre, día y asistencia quedan como estaban.
        if (it.from) {
          // Una clase de dos bloques con un solo horario ("14 a 18"): se reparte entre los bloques.
          const base = match.name.replace(/ · bloque \d+$/, '');
          const sibs = !it.block && /bloque 1$/.test(match.name) ? S.classes.filter((c) => c !== match && c.course === match.course && c.dow === match.dow && c.name.startsWith(`${base} · bloque`) && !usedIds.has(c.id)) : [];
          const parts = sibs.length + 1;
          const span = toMin(it.to) - toMin(it.from);
          [match, ...sibs].forEach((c, i) => { c.from = addMin(it.from, Math.round((span * i) / parts)); c.to = addMin(it.from, Math.round((span * (i + 1)) / parts)); usedIds.add(c.id); });
        }
        res.updated++;
        return;
      }
      const base = `${it.tipo} ${label(co)}`;
      S.classes.push({ id: uid('c'), name: it.block ? `${base} · bloque ${it.block}` : groups[k] > 1 ? `${base} · bloque ${seen[k]}` : base, mat: co.subj, course: co.id, dow: it.dow, ...(it.from ? { from: it.from, to: it.to } : {}) });
      res.added++;
    });
    sortClasses();
    return res;
  }
  // Suma minutos a "HH:MM" (sin pasar de medianoche).
  const addMin = (hhmm, m) => { const [a, b] = hhmm.split(':').map(Number); const t = Math.min(23 * 60 + 59, a * 60 + b + m); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const LEN_OPTS = [[30, '30 min'], [60, '1 h'], [90, '1 h 30'], [120, '2 h'], [180, '3 h'], [240, '4 h']];
  const lenTxt = (m) => (LEN_OPTS.find((x) => x[0] === m) || [0, m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`])[1];
  const refreshSchedule = () => { if (inWizard()) render(); else reopen(scheduleDialog); };
  const sortClasses = () => S.classes.sort((a, b) => a.dow - b.dow || (a.from || '99').localeCompare(b.from || '99'));
  function recomputeWeeks() {
    const st = S.settings;
    if (!st.semFirst) return;
    const r = L.weeksFromDates(st.semFirst, st.semEnd || st.semFirst, st.parcFrom ? [st.parcFrom, st.parcTo || st.parcFrom] : null, st.finFrom ? [st.finFrom, st.finTo || st.finFrom] : null);
    st.semStart = r.semStart; S.weeks = r.weeks;
  }
  function applyAll(text) {
    const r = L.parseAll(text);
    if (!r.found) return null;
    const added = applyPlan(r.planText);
    const sched = L.parseSchedule(r.schedText, L.subjects(S));
    addScheduleItems(sched.items);
    const c = r.calendar; const st = S.settings;
    if (c.start) {
      st.semFirst = c.start; st.semEnd = c.end || '';
      [st.parcFrom, st.parcTo] = c.parciales || ['', ''];
      [st.finFrom, st.finTo] = c.finales || ['', ''];
      recomputeWeeks();
    }
    if (c.holidays.length) S.holidays = [...new Set([...(S.holidays || []), ...c.holidays])].sort();
    r.fechas.forEach((f) => { if (!S.agenda.some((a) => a.date === f.date && a.title === f.title)) S.agenda.push({ id: uid('agenda'), title: f.title, date: f.date }); });
    return { plan: added, classes: sched.items.length, dates: !!c.start, fechas: r.fechas.length };
  }
  // Fechas del cuatrimestre: las guardadas, o deducidas de las semanas si se cargó antes de este cambio.
  function calValues() {
    const st = S.settings;
    const wk = (k) => S.weeks.filter((w) => w.kind === k).map((w) => w.n);
    const mon = (n) => L.iso(L.weekStart(S, n));
    const fri = (n) => L.iso(L.addDays(L.weekStart(S, n), 4));
    const range = (k) => { const n = wk(k); return n.length ? [mon(n[0]), fri(n[n.length - 1])] : ['', '']; };
    const lastClass = L.lastClassWeek(S);
    const p = range('parciales'); const f = range('finales');
    return {
      semFirst: st.semFirst || st.semStart, semEnd: st.semEnd || (lastClass ? fri(lastClass) : ''),
      parcFrom: st.parcFrom || p[0], parcTo: st.parcTo || p[1], finFrom: st.finFrom || f[0], finTo: st.finTo || f[1],
    };
  }
  function schedPrompt() {
    const names = S.courses.filter(L.isCurrent).map((c) => c.name);
    return `Te paso mi horario de cursada de este cuatrimestre. Armalo con este formato exacto:

Lunes
Teórica - Nombre de la materia - 08:00 a 10:00
Práctica - Nombre de la materia - 10:30 a 12:30
Martes
Tutorial - Nombre de la materia - 18:00 a 20:00

Reglas:
- Un renglón por clase: primero el tipo (Teórica, Práctica, Tutorial, Taller, Problemas…), un guion, la materia, otro guion y el horario con formato 08:00 a 10:00.
- Si una materia tiene dos bloques el mismo día, un renglón por bloque, cada uno con su horario.
- Sin aulas ni profesores. Si no se ve el horario de una clase, dejá el renglón sin horario. Los días sin clases no los pongas.
${names.length ? `- Usá exactamente estos nombres de materia: ${names.join('; ')}.\n` : ''}- No inventes clases. Si algo no se lee, avisame antes de la lista.
- Respondé con la lista dentro de un solo bloque de código.`;
  }
  function schedPreviewHtml(text) {
    if (!text.trim()) return '';
    const r = L.parseSchedule(text, L.subjects(S));
    const m = matchSchedule(r.items);
    const days = [...new Set(r.items.map((i) => i.dow))];
    const len = S.settings.classLen || 120;
    const durNote = (i) => { if (!i.from) return ''; const d = toMin(i.to) - toMin(i.from); return d !== len ? ` <span class="sp-warn">dura ${lenTxt(d)}, no ${lenTxt(len)}</span>` : ''; };
    const list = days.map((d) => `<li><b>${cap(L.DIAS[d])}</b>${m.filter((x) => x.it.dow === d).map(({ it: i, match }) => `<span class="sp-item${match ? ' is-known' : ''}">${match ? '✓ ' : '+ '}${h(match ? match.name : `${i.tipo} ${label(course(i.courseId))}${i.block ? ` · bloque ${i.block}` : ''}`)}${i.from ? ` <span class="num">${i.from}–${i.to}</span>${durNote(i)}` : ''}${i.timeError ? ` <span class="sp-err">⚠ ${h(i.timeError)} (se carga sin horario)</span>` : ''}</span>`).join('')}</li>`).join('');
    const odd = r.items.filter((i) => i.from && toMin(i.to) - toMin(i.from) !== len).length;
    const known = m.filter((x) => x.match).length; const fresh = r.items.length - known;
    return `${r.items.length ? `Encontré <b>${pl(r.items.length, 'clase', 'clases')}</b>.${known ? ` <b>${known}</b> ya las tenías (✓): solo les pongo el horario y su asistencia queda igual.` : ''}${fresh ? ` <b>${fresh}</b> ${fresh === 1 ? 'es nueva' : 'son nuevas'} (+).` : ''}${odd ? `<p class="auth-note">${pl(odd, 'clase dura', 'clases duran')} distinto de tu duración elegida (${lenTxt(len)}). Las cargo con el horario que pegaste; si está mal, corregilo antes.</p>` : ''}${r.errors.length ? `<p class="auth-note sp-errbox">No pude leer el horario de ${pl(r.errors.length, 'renglón', 'renglones')}: ${r.errors.map((e) => `<br>• "${h(e.line)}": ${h(e.msg)}`).join('')}</p>` : ''}` : 'No encontré clases. Revisá que cada día esté como título.'}${r.unknown.length ? `<p class="auth-note">No reconocí estas materias: ${r.unknown.map(h).join(', ')}. Fijate que estén en tu plan, en Carrera.</p>` : ''}<ul class="plan-list">${list}</ul>${r.items.length ? `<div class="actions" style="justify-content:flex-start;margin-top:8px"><button type="button" class="btn" data-act="sched-apply">Cargar ${pl(r.items.length, 'clase', 'clases')}</button></div>` : ''}`;
  }
  function scheduleHtml(opts = {}) {
    const st = S.settings;
    const cur = S.courses.filter(L.isCurrent);
    const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const cv = calValues();
    const hol = (S.holidays || []).map((x) => shortDate(L.parseDate(x)) + '/' + x.slice(0, 4)).join(', ');
    return `<div class="fields c2">
      <label class="field">Empiezan las clases<input type="date" data-change="cal" data-f="semFirst" value="${h(cv.semFirst)}"></label>
      <label class="field">Terminan las clases<input type="date" data-change="cal" data-f="semEnd" value="${h(cv.semEnd)}"></label>
      <label class="field">Parciales desde<input type="date" data-change="cal" data-f="parcFrom" value="${h(cv.parcFrom)}"></label>
      <label class="field">Parciales hasta<input type="date" data-change="cal" data-f="parcTo" value="${h(cv.parcTo)}"></label>
      <label class="field">Finales desde<input type="date" data-change="cal" data-f="finFrom" value="${h(cv.finFrom)}"></label>
      <label class="field">Finales hasta<input type="date" data-change="cal" data-f="finTo" value="${h(cv.finTo)}"></label>
      <label class="field">Asistencia mínima (%)<input inputmode="numeric" data-change="cal" data-f="minAtt" value="${Math.round(st.minAtt * 100)}"></label>
    </div>
    <label class="field" style="margin-top:12px">Feriados y días sin clase<textarea rows="2" data-change="cal" data-f="holidays" placeholder="17/08/2026, 12/10/2026">${h(hol)}</textarea><span class="sub" style="font-weight:400">Esas clases quedan como "no hubo" solas. Separalos con coma.</span></label>
    <p class="err" id="sem-err" role="alert"></p>
    ${opts.ai === false ? '' : `<section class="plan-way sched-ai"><h3>Cargalo con tu IA <span class="pill ok">la más fácil</span></h3>
      <ol><li>Sacale una captura a tu horario del campus o del sistema de tu facu.</li><li>Copiá esta instrucción, pegala en ChatGPT, Claude o Gemini y adjuntá la captura.</li><li>Pegá la respuesta acá abajo y tocá <b>Agregar</b>.</li></ol>
      <div class="plan-ai"><button type="button" class="btn ghost" data-act="copy-prompt" data-prompt="sched">Copiar instrucción</button><details><summary>Ver la instrucción</summary><pre class="prompt-box" id="sched-prompt" tabindex="0">${h(schedPrompt())}</pre></details></div>
      <textarea class="plan-in sched-in" id="sched-text" aria-label="Horario pegado" placeholder="Lunes&#10;Teórica - Cálculo&#10;Tutorial - Cálculo&#10;Martes&#10;..."></textarea>
      <div class="ok-line" id="sched-preview" aria-live="polite"></div>
    </section>`}
    <p class="section-label">¿Cuánto dura cada clase?</p>
    <p class="sub" style="margin:0 0 6px">Ponés solo la hora de inicio y el final se completa solo. Después lo podés cambiar en cada clase.</p>
    <div class="choice len-choice" role="group" aria-label="Duración de las clases">${LEN_OPTS.map(([m, n]) => `<button type="button" data-act="class-len" data-v="${m}" aria-pressed="${(st.classLen || 120) === m}">${n}</button>`).join('')}${LEN_OPTS.some((x) => x[0] === (st.classLen || 120)) ? '<button type="button" data-act="class-len" data-v="other" aria-pressed="false">Otra</button>' : `<button type="button" data-act="class-len" data-v="other" aria-pressed="true">Otra: ${lenTxt(st.classLen)}</button>`}</div>
    <div class="len-other" hidden><label class="field" style="max-width:220px">Minutos<div class="stepper"><button type="button" class="step-btn" data-act="step" data-d="-15" aria-label="15 minutos menos">−</button><input data-digits data-max="600" data-change="class-len-min" inputmode="numeric" maxlength="3" value="${st.classLen || 120}" aria-label="Duración en minutos"><button type="button" class="step-btn" data-act="step" data-d="15" aria-label="15 minutos más">+</button></div></label></div>
    <p class="section-label">Tus clases</p>
    <p class="sub" style="margin:0 0 6px">Podés cambiar el nombre, el día o el horario de cada clase. Su asistencia no se pierde.</p>
    <div>${S.classes.map((c) => `<div class="cls-row cls-edit" style="--mc:${colorOf(c.mat)}"><span class="dot"></span><input class="cls-name" data-change="class-name" data-id="${h(c.id)}" value="${h(c.name)}" data-orig="${h(c.name)}" maxlength="80" aria-label="Nombre de la clase"><select class="cls-dow" data-change="class-dow" data-id="${h(c.id)}" data-orig="${c.dow}" aria-label="Día de ${h(c.name)}">${days.map((d, i) => `<option value="${i}"${c.dow === i ? ' selected' : ''}>${d}</option>`).join('')}</select><span class="cls-time"><input type="time" data-change="class-time" data-id="${h(c.id)}" data-f="from" value="${h(c.from || '')}" data-orig="${h(c.from || '')}" aria-label="Empieza ${h(c.name)}"><span aria-hidden="true">a</span><input type="time" data-change="class-time" data-id="${h(c.id)}" data-f="to" value="${h(c.to || '')}" data-orig="${h(c.to || '')}" aria-label="Termina ${h(c.name)}"></span><button class="linkish" data-act="del-class" data-id="${h(c.id)}" aria-label="Borrar ${h(c.name)}">Borrar</button></div>`).join('') || '<p class="sub">Todavía no agregaste clases.</p>'}</div>
    ${S.classes.length ? '<div class="actions sched-save"><button type="button" class="btn" data-act="save-schedule">Guardar horario</button></div>' : ''}
    ${cur.length ? `<form data-form="class"><div class="fields c2" style="margin-top:12px">
      <label class="field">Materia<select name="course">${cur.map((c) => `<option value="${h(c.id)}">${h(label(c))}</option>`).join('')}</select></label>
      <label class="field">Tipo de clase<input name="tipo" required value="Teórica" list="tipos"><datalist id="tipos"><option value="Teórica"><option value="Práctica"><option value="Tutorial"><option value="Problemas"><option value="Taller"></datalist></label>
      <label class="field">Día<select name="dow">${days.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select></label>
      <label class="field" style="align-content:end"><span style="display:flex;gap:7px;align-items:center;min-height:38px"><input type="checkbox" name="x2" style="width:auto"> Son dos bloques</span></label>
      <label class="field">Empieza (opcional)<input type="time" name="from"></label>
      <label class="field">Termina<input type="time" name="to" placeholder="Se completa sola"><span class="sub" style="font-weight:400">Si lo dejás vacío: ${lenTxt(st.classLen || 120)} después.</span></label>
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
        <div class="fields c2">${comboField('Universidad', 'university', 'universities', st.university)}${comboField('Carrera', 'career', 'careers', st.career)}${yearField(st.entryYear)}
          <label class="field">Año que estás cursando<select data-change="setting" data-f="year"><option value="">Elegí</option>${['1', '2', '3', '4', '5', '6'].map((y) => `<option value="${y}"${String(st.year) === y ? ' selected' : ''}>${y}° año</option>`).join('')}</select></label></div>
        <p class="section-label">¿Cómo se divide el año en tu carrera?</p><div class="choice" style="margin-top:6px">${[['Cuatrimestre', 'Cuatrimestres'], ['Semestre', 'Semestres'], ['Trimestre', 'Trimestres']].map(([v, n]) => `<button data-act="term-word" data-v="${v}" aria-pressed="${st.termWord === v}">${n}</button>`).join('')}</div>
        <p class="sub" style="margin-top:6px">Si tenés materias anuales, igual elegí cómo se divide el resto: las anuales se marcan solas.</p>
        <hr class="divider"><p class="sub">Si ya tenés una copia de tus datos, importala y salteás todo esto.</p>
        <div class="actions" style="justify-content:flex-start;margin-top:8px"><label class="btn ghost plan-file">Importar copia<input class="vh" type="file" data-change="import" aria-label="Importar copia de tus datos"></label></div><p class="err" id="set-err" role="alert"></p>
      </section>${nav('Seguir')}`;
    } else if (step === 1) {
      body = `<h1>Cargá tu facu con IA</h1><p class="lead">Con tres archivos que ya tenés, una IA arma tu plan, tu horario y tu calendario. Te lleva unos minutos.</p>
      <section class="card">
        <h3 class="mini-h">1. Juntá estos archivos</h3>
        <div class="files3">
          <div><b>Plan de estudios</b><span>El de tu carrera. Está en la web de tu facu: PDF o captura.</span></div>
          <div><b>Horario semanal</b><span>Captura de tu horario en el campus o en el sistema de inscripción.</span></div>
          <div><b>Calendario académico</b><span>Si tu facu no publica uno, no pasa nada: la IA usa los feriados nacionales.</span></div>
        </div>
        <h3 class="mini-h">2. Pasáselos a tu IA</h3>
        <ol class="steps-ol"><li>Tocá <b>Copiar instrucción</b>.</li><li>Abrí la IA que uses, pegá la instrucción y subí los archivos en el mismo mensaje.</li><li>Copiá el bloque que te responde.</li></ol>
        <div class="plan-ai"><button type="button" class="btn" data-act="copy-prompt" data-prompt="all">Copiar instrucción</button>
          <span class="ai-links"><a class="linkish" href="https://chatgpt.com/" target="_blank" rel="noopener">ChatGPT</a><a class="linkish" href="https://claude.ai/" target="_blank" rel="noopener">Claude</a><a class="linkish" href="https://gemini.google.com/" target="_blank" rel="noopener">Gemini</a></span>
          <details><summary>Ver la instrucción</summary><pre class="prompt-box" id="all-prompt" tabindex="0">${h(allPrompt())}</pre></details></div>
        <h3 class="mini-h">3. Pegá la respuesta acá</h3>
        <textarea class="plan-in" id="all-text" aria-label="Respuesta de la IA" placeholder="PLAN&#10;1er año&#10;...&#10;&#10;HORARIO&#10;Lunes&#10;...">${h(ui.allDraft || '')}</textarea>
        <div class="ok-line" id="all-preview" aria-live="polite">${allPreviewHtml(ui.allDraft || '')}</div>
        <p class="sub" style="margin-top:10px">Antes de subirlos, fijate que los archivos no tengan datos personales que no quieras compartir.</p>
        <details class="no-ai"><summary>¿Preferís no usar IA?</summary><p class="sub" style="margin:8px 0">Cargá solo el plan de estudios. El horario y las fechas los completás en el paso siguiente.</p>${planInputHtml(ui.planDraft, S.courses.length && !ui.planDraft ? `Ya tenés ${pl(S.courses.length, 'materia cargada', 'materias cargadas')}. Lo que agregues se suma.` : '')}</details>
      </section>${nav('Seguir', 'Lo hago después')}`;
    } else if (step === 2) {
      const yrs = [...new Set(S.courses.map((c) => c.year))].sort((a, b) => a - b);
      const opts = [['proximamente', 'Falta'], ['cursando', 'Cursando'], ['aprobada 1ra instancia', 'Aprobada']];
      const list = yrs.map((y) => `<div class="year-row"><h2 class="year-h" style="margin-top:12px">${y}° año</h2><button class="btn ghost small" data-act="year-approve" data-y="${y}">Marcar todo aprobado</button></div>${S.courses.filter((c) => c.year === y).map((c) => `<div class="subj-row"><span style="flex:1 1 180px">${h(c.name)}</span><span style="display:flex;gap:8px;align-items:center">${L.isApproved(c) ? `<input class="grade-in" inputmode="decimal" placeholder="Nota" aria-label="Nota final de ${h(c.name)}" data-change="grade" data-id="${h(c.id)}" data-f="final" value="${h(c.final == null ? '' : L.fmt(c.final))}">` : ''}<span class="seg" role="group" aria-label="Estado de ${h(c.name)}">${opts.map(([v, n]) => `<button data-act="wiz-status" data-id="${h(c.id)}" data-s="${v}" aria-pressed="${c.status === v}">${n}</button>`).join('')}</span></span></div>`).join('')}`).join('');
      const hint = st.year && +st.year > 1 ? `<p class="auth-note">Estás en ${st.year}° año: marcá lo que ya aprobaste de los años anteriores.</p>` : '';
      body = `<h1>¿Qué ya aprobaste?</h1><p class="lead">Marcá las materias que aprobaste y poné la nota final: con eso calculamos tu promedio. Lo que cursás ahora va como <b>Cursando</b>.</p>${hint}<section class="card">${list || '<p class="sub">Sin plan cargado todavía: podés agregarlo después desde Carrera.</p>'}<p class="err" id="grade-err" role="alert"></p></section>${nav('Seguir', 'Lo hago después')}`;
    } else if (step === 3) {
      body = `<h1>Tu ${h((st.termWord || 'cuatrimestre').toLowerCase())}</h1><p class="lead">Revisá las fechas y tus clases. Si cargaste con IA, ya está casi todo.</p><section class="card">${scheduleHtml({ ai: false })}</section>${nav('Seguir', 'Lo armo después')}`;
    } else {
      const st2 = S.settings;
      body = `<h1>Hacelo tuyo</h1><p class="lead">Elegí un tema o tu propio color. Se aplica al toque.</p><section class="card">${themePicker()}</section>
      <section class="card mt"><h2 class="wiz-h2">¿Querés una mascota?</h2><p class="sub" style="margin:2px 0 10px">Te acompaña en Hoy, cambia de cara según cómo te va y cuenta chistes si la tocás. Se cambia o se saca cuando quieras en Ajustes.</p>${petPickerHtml(st2.pet)}</section>
      <section class="card mt"><h2 class="wiz-h2">¿Frases motivadoras?</h2><p class="sub" style="margin:2px 0 10px">Una frase por día en Hoy, según lo que te pasa: un examen cerca, una racha, si es muy tarde.</p><div class="choice" role="group" aria-label="Frases motivadoras"><button type="button" data-act="motivation" data-v="1" aria-pressed="${!!st2.motivation}">Sí, quiero</button><button type="button" data-act="motivation" data-v="" aria-pressed="${!st2.motivation}">Ahora no</button></div></section>
      ${nav('Entrar a mi panel')}`;
    }
    return `<div class="wiz">${steps}${body}</div>`;
  }

  // ---------- Diálogos
  const modal = () => $('#modal');
  function openModal(html) { const m = modal(); m.innerHTML = `<button class="icon-btn close" data-act="close" aria-label="Cerrar">×</button>${html}`; decorate(m); if (!m.open) m.showModal(); }
  // Toma lo que esté escrito en las clases del horario (aunque el celular no haya avisado el cambio) y lo guarda ya.
  function commitScheduleInputs() {
    const rows = document.querySelectorAll('#modal .cls-edit, #view .cls-edit');
    if (!rows.length) return false;
    let changed = false;
    rows.forEach((row) => {
      const id = (row.querySelector('[data-id]') || {}).dataset?.id;
      const c = S.classes.find((x) => x.id === id);
      if (!c) return;
      // Solo lo que cambiaste en pantalla (distinto de cómo se mostró): nunca pisa lo que se cargó por otro lado.
      const edited = (el) => el && el.value !== (el.dataset.orig ?? el.value);
      const nm = row.querySelector('.cls-name'); const dw = row.querySelector('.cls-dow');
      const fr = row.querySelector('[data-f="from"]'); const to = row.querySelector('[data-f="to"]');
      if (edited(nm) && nm.value.trim() && nm.value.trim() !== c.name) { c.name = nm.value.trim(); changed = true; }
      if (edited(dw) && +dw.value !== c.dow) { c.dow = +dw.value; changed = true; }
      [[fr, 'from'], [to, 'to']].forEach(([el, f]) => { if (!edited(el)) return; const v = el.value; if ((v || undefined) !== c[f]) { if (v) c[f] = v; else delete c[f]; changed = true; } });
      if (edited(fr) && c.from && (!c.to || c.to <= c.from)) { c.to = addMin(c.from, S.settings.classLen || 120); changed = true; }
      // Lo ya guardado pasa a ser el nuevo punto de partida.
      [nm, dw, fr, to].forEach((el) => { if (el) el.dataset.orig = el.value; });
    });
    if (changed) sortClasses();
    if (changed || dirty) { dirty = true; clearTimeout(saveTimer); flush(); }
    return changed;
  }
  function closeModal() { const m = modal(); if (m.open) m.close(); }
  // Al cerrar el cuadro del horario (con la ×, con Esc o tocando afuera) se guarda lo que haya escrito.
  if (modal()) modal().addEventListener('close', () => { if (S && commitScheduleInputs()) render(); });

  function cellDialog(key) {
    const [w, id] = key.split(':');
    const c = S.classes.find((x) => x.id === id);
    if (!c) return;
    const d = L.cellDate(S, +w, c);
    const state = S.att[key] || null;
    const note = S.cellNotes[key];
    const holiday = (S.holidays || []).includes(L.iso(d));
    openModal(`<h2 id="modal-title">${h(c.name)}</h2><p class="sub">Semana ${w} · ${longDate(d)}${holiday ? ' · feriado' : ''}</p>
      ${note && note.t ? `<div class="comment"><span class="comment-tag">${note.check ? 'Para revisar' : 'Tu nota'}</span>${h(note.t)}</div>` : ''}
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
    if (prs.length) extra += `<p class="section-label">Estudio</p><p class="sub">${pracStats(prs).complete} de ${pl(prs.length, 'material terminado', 'materiales terminados')}. <a class="linkish" href="#estudio" data-act="close-go">Abrir estudio</a></p>`;
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
  const TOUR = [
    { i: 'hoy', t: 'Hoy', d: 'Tu día de un vistazo: las clases de hoy para marcar si fuiste, tus pendientes y lo que se viene. Es la pestaña para dejar siempre abierta.' },
    { i: 'asistencia', t: 'Asistencia', d: 'Marcá Fui, Falté o No hubo. Si ya sabés que vas a faltar (un viaje, un turno), marcá No voy de antemano y te descuenta esa falta. Tocá una clase para dejarle una nota.' },
    { i: 'notas', t: 'Notas', d: 'Cargá tus parciales y te dice cuánto necesitás en el segundo. Ves tu promedio y cómo te va de un parcial al otro.' },
    { i: 'carrera', t: 'Carrera', d: 'Tu plan de estudios entero: cada cuadradito es una materia. Tocala para cargar notas o cambiar si la aprobaste.' },
    { i: 'estudio', t: 'Estudio', d: 'Prácticas, lecturas, videos y TP de cada materia. Si les ponés fecha, aparecen en Hoy hasta que los termines o venza el plazo.' },
    { i: 'beneficios', t: 'Beneficios', d: 'Descuentos y cosas gratis por ser estudiante: transporte, cultura y programas.' },
    { i: 'settings', t: 'Ajustes', d: 'Arriba a la derecha: colores, letra, tu horario y cómo instalarla en el celular. Esta guía también está ahí.' },
  ];
  function tourDialog(i) {
    const s2 = TOUR[i]; const last = i === TOUR.length - 1;
    openModal(`<div class="tour"><div class="tour-ico">${icon(s2.i)}</div><p class="tour-step">${i + 1} de ${TOUR.length}</p><h2 id="modal-title">${h(s2.t)}</h2><p>${h(s2.d)}</p>
      <div class="tour-dots" aria-hidden="true">${TOUR.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="actions" style="justify-content:space-between">${i ? `<button class="btn ghost" data-act="tour-go" data-i="${i - 1}">Anterior</button>` : '<button class="linkish" data-act="tour-end">Saltar guía</button>'}<button class="btn" data-act="${last ? 'tour-end' : 'tour-go'}" data-i="${i + 1}">${last ? 'Empezar' : 'Siguiente'}</button></div></div>`);
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
      <hr class="divider"><p class="section-label" style="margin-top:0">Mascota</p>
      <p class="sub" style="margin:2px 0 8px">Te acompaña en Hoy y cambia de cara según lo que te pasa: racha, examen cerca, una mala nota, si es muy tarde.</p>
      ${petPickerHtml(st.pet)}
      ${st.pet ? `<label class="check-line"><input type="checkbox" data-change="pet-decor" ${st.petDecor !== false ? 'checked' : ''}> Disfraces en fechas especiales: gorro en Navidad, calabaza en Halloween, gorrito de fiesta en Año Nuevo, flores el Día del Estudiante</label>` : ''}
      <hr class="divider"><p class="section-label" style="margin-top:0">Frases motivadoras</p>
      <p class="sub" style="margin:2px 0 8px">Una frase por día en Hoy, según lo que te pase: un examen cerca, una racha, faltas justas o dudas anotadas.</p>
      <div class="choice" role="group" aria-label="Frases motivadoras"><button type="button" data-act="motivation" data-v="1" aria-pressed="${!!st.motivation}">Activadas</button><button type="button" data-act="motivation" data-v="" aria-pressed="${!st.motivation}">Desactivadas</button></div>
      ${st.motivation ? `<label class="field" style="margin-top:10px">Tus propias frases (opcional, una por línea)<textarea rows="3" data-change="my-phrases" maxlength="2000" placeholder="Paso a paso se llega\nEl lunes arranco con Cálculo">${h(st.myPhrases || '')}</textarea><span class="sub" style="font-weight:400">Se mezclan con las de la app.</span></label>` : ''}
      <hr class="divider"><p class="section-label" style="margin-top:0">¿Cómo se usa?</p><div class="actions" style="justify-content:flex-start;margin-top:8px"><button class="btn ghost" data-act="tour">Ver guía de uso</button></div>
      <hr class="divider"><p class="section-label" style="margin-top:0">Tenela como app en el celular</p>${installHtml()}
      <p class="section-label">Ícono de la app</p>${appIconPickerHtml()}
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
  const EXAM_KINDS = [['parcial1', 'Primer parcial', 'el primer parcial'], ['parcial2', 'Segundo parcial', 'el segundo parcial'], ['recu', 'Recuperatorio', 'el recuperatorio'], ['final', 'Final', 'el final'], ['coloquio', 'Coloquio', 'el coloquio'], ['entrega', 'Entrega', 'la entrega'], ['otro', 'Otro', '']];
  // Agregar examen: materia y tipo como botones (sin nada elegido de entrada) y un calendario propio.
  let agCal = null;
  function agendaDialog() {
    const cur = S.courses.filter(L.isCurrent);
    const t = today();
    agCal = { y: t.getFullYear(), m: t.getMonth(), sel: '' };
    const subj = [...cur.map((c) => [c.id, label(c)]), ['__none', 'Otra o sin materia']]
      .map(([v, n], i) => `<label class="pick"><input type="radio" name="course" value="${h(v)}"${i === 0 ? ' required' : ''}><span>${h(n)}</span></label>`).join('');
    const kinds = EXAM_KINDS.map(([v, n], i) => `<label class="pick"><input type="radio" name="kind" value="${v}"${i === 0 ? ' required' : ''}><span>${n}</span></label>`).join('');
    openModal(`<h2 id="modal-title">Agregar examen</h2><p class="sub">Aparece en Hoy con la cuenta regresiva.</p><form data-form="agenda" class="ag-form">
      <fieldset class="picks"><legend>Materia</legend><div class="pick-row">${subj}</div></fieldset>
      <fieldset class="picks"><legend>Qué es</legend><div class="pick-row">${kinds}</div></fieldset>
      <fieldset class="picks"><legend>Fecha</legend><input type="hidden" name="date" value=""><div id="ag-cal" class="cal">${calHtml()}</div></fieldset>
      <label class="field">Detalle (opcional)<input name="title" maxlength="80" placeholder="Parcial integrador, aula 3"></label>
      <p class="err" id="ag-err" role="alert"></p>
      <div class="actions"><button class="btn" type="submit">Agregar examen</button></div></form>`);
  }
  function calHtml() {
    const { y, m, sel } = agCal;
    const t = today(), tIso = L.iso(t);
    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7;
    const total = new Date(y, m + 1, 0).getDate();
    const busy = new Set(S.agenda.map((a) => a.date));
    const canBack = y > t.getFullYear() || (y === t.getFullYear() && m > t.getMonth());
    let cells = '<span class="cal-blank"></span>'.repeat(lead);
    for (let d = 1; d <= total; d++) {
      const iso = L.iso(new Date(y, m, d));
      const cls = ['cal-d', iso === tIso ? 'is-today' : '', iso === sel ? 'is-sel' : '', busy.has(iso) ? 'has-exam' : ''].filter(Boolean).join(' ');
      cells += `<button type="button" class="${cls}" data-act="cal-pick" data-d="${iso}"${iso < tIso ? ' disabled' : ''} aria-pressed="${iso === sel}" aria-label="${h(longDate(new Date(y, m, d)))}${busy.has(iso) ? ', ya tenés un examen' : ''}">${d}</button>`;
    }
    const n = sel ? L.daysBetween(t, L.parseDate(sel)) : null;
    const foot = sel ? `<b>${h(longDate(L.parseDate(sel)))}</b> · ${n === 0 ? 'es hoy' : n === 1 ? 'falta 1 día' : `faltan ${n} días`}` : 'Tocá un día';
    return `<div class="cal-head"><button type="button" class="cal-nav" data-act="cal-nav" data-n="-1" aria-label="Mes anterior"${canBack ? '' : ' disabled'}>‹</button><b>${L.MESES[m]} ${y}</b><button type="button" class="cal-nav" data-act="cal-nav" data-n="1" aria-label="Mes siguiente">›</button></div>
      <div class="cal-grid"><span class="cal-dow">L</span><span class="cal-dow">M</span><span class="cal-dow">M</span><span class="cal-dow">J</span><span class="cal-dow">V</span><span class="cal-dow">S</span><span class="cal-dow">D</span>${cells}</div>
      <p class="cal-foot">${foot}</p>`;
  }
  function calRefresh() { const box = $('#ag-cal'); if (box) box.innerHTML = calHtml(); }
  // "el final de Cálculo", "la entrega de Juegos" o el texto que escribiste.
  function examPhrase(a) {
    const k = EXAM_KINDS.find((x) => x[0] === a.kind);
    const co = a.course && course(a.course);
    if (k && k[2]) return `${k[2]}${co ? ` de ${label(co)}` : ''}${a.title ? ` (${a.title})` : ''}`;
    return a.title || (co ? label(co) : 'tu examen');
  }
  function countdownText(a, n) {
    const what = examPhrase(a);
    if (n === 0) return `Hoy es ${what}`;
    if (n === 1) return `Mañana es ${what}`;
    return `Faltan ${n} días para ${what}`;
  }
  function linkDialog() {
    const have = new Set(S.links.map((l) => linkIconName(l.url)));
    const quick = QUICK_LINKS.filter(([, url]) => !have.has(linkIconName(url)))
      .map(([name, url]) => `<button type="button" class="chip quick-link" data-act="quick-link" data-name="${h(name)}" data-url="${h(url)}">${linkIcon({ name, url })}${h(name)}</button>`).join('');
    const mine = S.links.map((l) => `<li>${linkIcon(l)}<span class="ql-name">${h(l.name)}</span><button type="button" class="btn ghost small" data-act="del-link" data-id="${h(l.id)}" aria-label="Quitar ${h(l.name)}">Quitar</button></li>`).join('');
    openModal(`<h2 id="modal-title">Accesos</h2>
      ${mine ? `<ul class="list my-links">${mine}</ul>` : ''}
      ${quick ? `<p class="sub" style="margin:12px 0 6px">Con un toque se agregan:</p><div class="quick-links">${quick}</div>` : ''}
      <p class="sub" style="margin:14px 0 2px">O cualquier otro, como el campus de tu facu:</p>
      <form data-form="link"><div class="fields c2"><label class="field">Nombre<input name="name" required maxlength="30" placeholder="Campus"></label><label class="field">Dirección<input name="url" type="url" required pattern="https?://.*" placeholder="https://"></label></div><div class="actions"><button class="btn" type="submit">Agregar acceso</button></div></form>`);
  }
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
      </div><div class="fields"><label class="field">Nombre<input name="name" required maxlength="80" value="${h(name)}"></label></div>
      <div class="field count-field"><span id="parts-label">${h(partsQuestion(KINDS[kind]))}</span>
        <div class="stepper"><button type="button" class="step-btn" data-act="step" data-d="-1" aria-label="Uno menos">−</button><input name="n" data-digits inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${parts}" placeholder="–" aria-labelledby="parts-label"><button type="button" class="step-btn" data-act="step" data-d="1" aria-label="Uno más">+</button></div>
        <span class="sub" style="font-weight:400">Solo números. Dejalo vacío si es una sola cosa, como una lectura entera.</span></div>
      ${editing ? '' : '<label class="check-line"><input type="checkbox" name="alldone" value="1"> Ya lo hice todo (se carga tildado)</label>'}
      <div class="fields c2"><label class="field">Link (opcional)<input name="link" type="url" pattern="https?://.*" value="${h(editing ? editing.link || '' : '')}" placeholder="https://"></label>
      <label class="field">Para cuándo (opcional)<input name="date" type="date" value="${h(editing ? editing.date || '' : '')}"></label></div>
      <div class="actions">${editing ? `<button type="button" class="btn ghost danger" data-act="del-prac" data-id="${h(editing.id)}">Borrar</button>` : ''}<button class="btn" type="submit">${editing ? 'Guardar' : 'Agregar material'}</button></div></form>`);
  }
  function planDialog() {
    openModal(`<h2 id="modal-title">Agregar materias</h2><p class="sub" style="margin-bottom:12px">No se duplica lo que ya está.</p><form data-form="plan">${planInputHtml('')}<div class="actions"><button class="btn" type="submit">Agregar materias</button></div></form>`);
  }
  const MILE_PRESETS = ['Me puedo postular al intercambio', 'Puedo empezar las pasantías', 'Título intermedio', 'Mitad de la carrera', 'Prácticas profesionales', 'Empiezo la tesis o el trabajo final', 'Termino de cursar'];
  function mileDialog() {
    const yrs = [...new Set(S.courses.map((c) => c.year))].sort((a, b) => a - b);
    const pick = (name, v, n, req) => `<label class="pick"><input type="radio" name="${name}" value="${h(v)}"${req ? ' required' : ''}><span>${h(n)}</span></label>`;
    openModal(`<h2 id="modal-title">Agregar hito</h2><p class="sub">Algo importante de tu carrera. Aparece en el plan de estudios, en el ${h(S.settings.termWord.toLowerCase())} que elijas.</p><form data-form="mile" class="ag-form mile-form">
      <fieldset class="picks"><legend>Qué pasa</legend><div class="pick-row">${MILE_PRESETS.map((t, i) => pick('preset', t, t, i === 0)).join('')}${pick('preset', 'otro', 'Otro')}</div></fieldset>
      <label class="field mile-other">Escribilo<input name="text" maxlength="70" placeholder="Ej.: me recibo de técnico"></label>
      <fieldset class="picks"><legend>Año</legend><div class="pick-row">${(yrs.length ? yrs : [1, 2, 3, 4, 5]).map((y, i) => pick('year', y, `${y}° año`, i === 0)).join('')}</div></fieldset>
      <fieldset class="picks"><legend>${h(S.settings.termWord)}</legend><div class="pick-row">${[['A', 'Primero'], ['B', 'Segundo'], ['Anual', 'Todo el año']].map(([v, n], i) => pick('sem', v, n, i === 0)).join('')}</div></fieldset>
      <p class="err" id="mile-err" role="alert"></p>
      <div class="actions"><button class="btn" type="submit">Agregar hito</button></div></form>`);
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
  const VIEWS = { hoy: ['Hoy', viewHoy], asistencia: ['Asistencia', viewAsistencia], notas: ['Notas', viewNotas], carrera: ['Carrera', viewCarrera], estudio: ['Estudio', viewMaterial], beneficios: ['Beneficios', viewBeneficios] };
  const route = () => { const r = location.hash.slice(1); if (r === 'practicas' || r === 'material') return 'estudio'; return VIEWS[r] ? r : 'hoy'; };
  const inWizard = () => S && !S.settings.onboarded;
  function render() {
    if (deferring) { setTimeout(render); return; }
    applyTheme();
    document.title = APP_NAME;
    document.body.classList.toggle('is-auth', !S || ui.recovery);
    const v = $('#view');
    if (ui.recovery) { document.body.classList.add('bare'); v.innerHTML = viewRecovery(); return; }
    if (!S) { document.body.classList.add('bare'); v.innerHTML = viewAuth(); return; }
    if (inWizard()) { document.body.classList.add('bare'); keepFocus(() => { v.innerHTML = viewWizard(); decorate(v); }); return; }
    document.body.classList.remove('bare');
    const r = route();
    $('#tabs').innerHTML = Object.entries(VIEWS).map(([k, [n]]) => `<a href="#${k}"${k === r ? ' aria-current="page"' : ''}>${icon(k)}<span>${n}</span></a>`).join('');
    const a = document.activeElement;
    if (a && a.dataset && a.dataset.change === 'scratch') return;
    const wrap = $('.table-wrap'); const sx = wrap ? wrap.scrollLeft : 0;
    keepFocus(() => { v.innerHTML = VIEWS[r][1](); decorate(v); });
    if (r === 'hoy') { viewHoy.played = true; maybeAutoWrapped(); }
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
    'close-go': () => { closeModal(); location.hash = 'estudio'; },
    undo() { if (!undoSnap) return; S = JSON.parse(undoSnap); undoSnap = null; save(); render(); $('#toast').hidden = true; },
    theme(el) { S.settings.theme = el.dataset.id; save(); render(); if (openDialogName() === 'Ajustes') settingsDialog(); },
    font(el) { S.settings.font = el.dataset.v; save(); render(); if (openDialogName() === 'Ajustes') settingsDialog(); },
    progress(el) { S.settings.progress = el.dataset.v; save(); render(); if (openDialogName() === 'Ajustes') settingsDialog(); },
    stick() {
      const text = (S.scratch || '').trim();
      if (!text) { toast('Escribí algo en la nota rápida primero.'); return; }
      const colors = Object.keys(STICKY_COLORS);
      mutate(() => { S.stickies = S.stickies || []; S.stickies.unshift({ id: uid('n'), text: text.slice(0, 400), color: colors[S.stickies.length % colors.length], rot: Math.round((Math.random() * 6 - 3) * 10) / 10 }); S.scratch = ''; }, 'Pegado arriba de todo en Hoy');
    },
    sticky: (el) => stickyDialog(el.dataset.id),
    'sticky-color'(el) { const n = S.stickies.find((x) => x.id === el.dataset.id); mutate(() => { n.color = el.dataset.v; }, null); stickyDialog(n.id); },
    unstick(el) { const n = S.stickies.find((x) => x.id === el.dataset.id); closeModal(); mutate(() => { S.stickies = S.stickies.filter((x) => x !== n); }, 'Post-it despegado'); },
    'pet-tap'() {
      ui.petTap = (ui.petTap || 0) + 1;
      const pet = $('.pet'); if (!pet) return;
      if (ui.jokeI == null) ui.jokeI = Math.floor(Math.random() * PET_JOKES.length);
      pet.querySelector('.pet-bubble').textContent = PET_JOKES[ui.jokeI++ % PET_JOKES.length];
      const b = pet.querySelector('.pet-btn'); b.classList.remove('jump'); void b.offsetWidth; b.classList.add('jump');
    },
    'class-len'(el) {
      if (el.dataset.v === 'other') { const box = $('.len-other'); if (box) { box.hidden = false; box.querySelector('input').focus(); } return; }
      S.settings.classLen = +el.dataset.v; save(); refreshSchedule();
    },
    'app-icon'(el) { S.settings.appIcon = el.dataset.v; save(); applyAppIcon(); if (el.dataset.v === 'clasico') { document.querySelector('link[rel="apple-touch-icon"]').href = 'icons/apple-touch-icon.png'; document.querySelector('link[rel="manifest"]').href = 'manifest.webmanifest'; } settingsDialog(); toast('Ícono elegido. Volvé a agregar CursadOK a la pantalla de inicio para verlo.'); },
    'pet-pick'(el) { S.settings.pet = el.dataset.v; save(); render(); if (!inWizard()) settingsDialog(); },
    motivation(el) { S.settings.motivation = !!el.dataset.v; save(); render(); if (!inWizard()) settingsDialog(); },
    'custom-second-auto'() { S.settings.custom.second = ''; save(); render(); if (openDialogName() === 'Ajustes') settingsDialog(); },
    'custom-mode'(el) { S.settings.custom.mode = el.dataset.v; save(); render(); if (openDialogName() === 'Ajustes') settingsDialog(); },
    resolve(el) { mutate(() => { delete S.cellNotes[el.dataset.key].check; }, 'Nota marcada como revisada'); closeModal(); },
    'add-agenda': agendaDialog,
    'cal-nav'(el) { if (!agCal) return; const d = new Date(agCal.y, agCal.m + Number(el.dataset.n), 1); agCal.y = d.getFullYear(); agCal.m = d.getMonth(); calRefresh(); },
    'cal-pick'(el) { if (!agCal) return; agCal.sel = el.dataset.d; const f = el.closest('form'); f.elements.date.value = agCal.sel; const err = $('#ag-err'); if (err) err.textContent = ''; calRefresh(); const again = $(`#ag-cal [data-d="${agCal.sel}"]`); if (again) again.focus(); },
    step(el) {
      const inp = el.parentElement.querySelector('input');
      const n = Math.max(0, Math.min(+(inp.dataset.max || 300), (parseInt(inp.value, 10) || 0) + Number(el.dataset.d)));
      inp.value = n ? String(n) : '';
      if (inp.dataset.change) inp.dispatchEvent(new Event('change', { bubbles: true }));
    },
    'add-link': linkDialog,
    'quick-link'(el) { mutate(() => { S.links.push({ id: uid('link'), name: el.dataset.name, url: el.dataset.url }); }, `${el.dataset.name} agregado`); linkDialog(); },
    'del-link'(el) { mutate(() => { S.links = S.links.filter((l) => l.id !== el.dataset.id); }, 'Acceso quitado'); linkDialog(); },
    'add-prac': (el) => pracDialog(el.dataset.course),
    'add-plan': planDialog,
    'add-mile': mileDialog,
    'del-mile': (el) => mutate(() => { S.milestones = S.milestones.filter((m) => m.text !== el.dataset.id); }, 'Hito borrado'),
    'del-agenda': (el) => mutate(() => { S.agenda = S.agenda.filter((a) => a.id !== el.dataset.id); }, 'Fecha borrada'),
    ex(el) {
      const p = S.practices.find((x) => x.id === el.dataset.id); const i = +el.dataset.i;
      if (!p.single && ui.doubtMode.has(p.id)) {
        const has = (p.doubts || []).includes(i);
        mutate(() => { p.doubts = has ? p.doubts.filter((x) => x !== i) : [...(p.doubts || []), i].sort((a, b) => a - b); }, `${p.name}, ${kindOf(p).one} ${i + 1}: ${has ? 'sin duda' : 'con duda'}`);
        return;
      }
      const next = !p.items[i]; mutate(() => { p.items[i] = next; }, p.single ? `${p.name}: ${next ? 'hecho' : 'sin hacer'}` : `${p.name}, ${kindOf(p).one} ${i + 1}: ${next ? 'tildado' : 'destildado'}`); },
    'doubt-mode'(el) { const id = el.dataset.id; if (el.dataset.v) ui.doubtMode.add(id); else ui.doubtMode.delete(id); ui.openPrac.add(id); render(); },
    'doubt-single'(el) { const p = S.practices.find((x) => x.id === el.dataset.id); const has = doubtsOf(p).length > 0; ui.openPrac.add(p.id); mutate(() => { p.doubts = has ? [] : [0]; }, `${p.name}: ${has ? 'sin dudas' : 'con dudas'}`); },
    'ex-add'(el) { const p = S.practices.find((x) => x.id === el.dataset.id); const n = p.items.length + 1; mutate(() => { p.items.push(true); }, `${p.name}: ${kindOf(p).one} ${n} tildado`); },
    'prac-all'(el) { const p = S.practices.find((x) => x.id === el.dataset.id); const all = p.items.every(Boolean); ui.openPrac.add(p.id); mutate(() => { p.items = p.items.map(() => !all); }, `${p.name}: ${all ? 'todo destildado' : 'todo tildado'}`); },
    'del-prac'(el) { const p = S.practices.find((x) => x.id === el.dataset.id); closeModal(); mutate(() => { S.practices = S.practices.filter((x) => x !== p); }, `${p.name}: borrado`); },
    'benefit-filter'(el) { ui.benefitFilter = el.dataset.k || null; render(); },
    benefit(el) {
      const b = (window.CursadaBenefits || { items: [] }).items[+el.dataset.i];
      if (!b) return;
      openModal(`<div class="ben-top" style="margin-bottom:6px">${b.logo ? `<img class="ben-logo" src="icons/benefits/${h(b.logo)}.png" alt="" width="40" height="40">` : ''}<div class="ben-head"><span class="ben-org">${h([b.org, b.where].filter((x, i, a) => x && a.indexOf(x) === i).join(' · '))}</span></div></div>
        <h2 id="modal-title">${h(b.title)}</h2><p style="margin:6px 0 4px">${h(b.what)}</p>
        <dl class="ben-dl"><dt>Qué necesitás</dt><dd>${h(b.need)}</dd><dt>Cómo se pide</dt><dd>${h(b.how)}</dd></dl>
        ${b.note ? `<p class="sub" style="margin-top:10px">${h(b.note)}</p>` : ''}
        <div class="actions"><a class="btn" href="${h(safeUrl(b.url))}" target="_blank" rel="noopener">Ir a la fuente</a></div>`);
    },
    'save-schedule'() {
      commitScheduleInputs(); dirty = true; clearTimeout(saveTimer); flush();
      closeModal(); render(); toast('Horario guardado');
    },
    'pomo-toggle'() {
      if (pomo.running) { pomo.left = pomoLeft(); pomo.running = false; ambStop(); }
      else { pomo.endAt = Date.now() + pomoLeft(); pomo.left = null; pomo.running = true; ambStart(); }
      pomoKeep(); pomoRun(); render();
    },
    'pomo-reset'() { pomo.running = false; pomo.left = null; pomo.endAt = 0; pomo.mode = 'focus'; pomo.cycle = 0; ambStop(); pomoKeep(); pomoRun(); document.title = APP_NAME; render(); },
    'pomo-skip'() { pomoFinish(false); render(); },
    'pomo-preset'(el) { S.settings.pomo = { ...pomoCfg(), work: +el.dataset.w, brk: +el.dataset.b }; save(); if (!pomo.running) pomo.left = null; pomoKeep(); render(); },
    'pomo-sound'(el) { S.settings.pomo = { ...pomoCfg(), sound: el.dataset.v }; save(); ambStart(); render(); },
    'study-archive'(el) {
      const k = el.dataset.subj; const on = !!el.dataset.v;
      S.studyArchive = S.studyArchive || {};
      ui.showOldStudy = !on ? ui.showOldStudy : true;
      mutate(() => { S.studyArchive[k] = on; }, on ? `${matLabel(k)}: archivada. La encontrás abajo, en Cursadas anteriores.` : `${matLabel(k)}: desarchivada, de vuelta arriba`);
    },
    'place-filter'(el) { ui.placeFilter = el.dataset.k || null; render(); },
    'kind-filter'(el) { ui.kindFilter = el.dataset.k || null; render(); },
    'edit-prac': (el) => pracDialog('', el.dataset.id),
    'pick-week'(el) { ui.phoneWeek = +el.dataset.w; render(); },
    'del-class'(el) { mutate(() => { S.classes = S.classes.filter((c) => c.id !== el.dataset.id); }, 'Clase borrada'); reopen(scheduleDialog); },
    wrapped(el) { openWrapped(el.dataset.term || null, !el.dataset.term); },
    'new-sem'() {
      const t = L.tally(L.allCells(S));
      closeModal();
      mutate(() => {
        S.history = S.history || [];
        S.history.push({ label: `Hasta ${shortDate(today())}/${today().getFullYear()}`, term: currentTerm(), pct: t.pct, classes: S.classes, weeks: S.weeks, att: S.att, cellNotes: S.cellNotes });
        S.classes = []; S.att = {}; S.cellNotes = {}; S.weekNotes = {}; S.weeks = L.buildWeeks(16, [], []); S.settings.semStart = L.iso(mondayOf(today())); Object.assign(S.settings, { semFirst: '', semEnd: '', parcFrom: '', parcTo: '', finFrom: '', finTo: '' }); S.holidays = [];
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
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cursadok-${L.iso(today())}.json`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    async logout() { clearTimeout(saveTimer); await flush(); await api('POST', '/api/logout', {}); location.href = location.pathname; },
    'del-account': deleteDialog,
    'auth-to'(el) { ui.authMode = el.dataset.to; ui.authNotice = ''; render(); },
    async google() {
      try { await Backend.google(); } catch (e) { const x = $('#auth-err'); if (x) x.textContent = 'No se pudo abrir Google. Probá de nuevo o entrá con tu mail.'; }
    },
    async 'copy-prompt'(el) {
      try {
        await navigator.clipboard.writeText(el.dataset.prompt === 'sched' ? schedPrompt() : el.dataset.prompt === 'all' ? allPrompt() : AI_PROMPT);
        setBtnText(el, 'Copiada');
        setTimeout(() => { setBtnText(el, 'Copiar instrucción'); }, 2000);
      } catch (e) {
        const d = el.parentElement.querySelector('details'); d.open = true;
        const sel = getSelection(); const r = document.createRange();
        r.selectNodeContents($(el.dataset.prompt === 'sched' ? '#sched-prompt' : el.dataset.prompt === 'all' ? '#all-prompt' : '#ai-prompt')); sel.removeAllRanges(); sel.addRange(r);
        setBtnText(el, 'Copiala con Cmd o Ctrl + C');
      }
    },
    'sched-apply'() {
      const t = $('#sched-text');
      const r = L.parseSchedule(t.value, L.subjects(S));
      if (!r.items.length) return;
      let res = { added: 0, updated: 0 };
      mutate(() => { res = addScheduleItems(r.items); }, null);
      if (!inWizard()) toast([res.added ? pl(res.added, 'clase nueva', 'clases nuevas') : '', res.updated ? `${pl(res.updated, 'clase actualizada', 'clases actualizadas')} (su asistencia sigue igual)` : ''].filter(Boolean).join(' y ') + '.', true);
      reopen(scheduleDialog);
    },
    async install() { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice; installEvent = null; if (openDialogName() === 'Ajustes') settingsDialog(); },
    'todo-done'(el) {
      const x = (S.todos || []).find((y) => y.id === el.dataset.id);
      if (!x) return;
      const was = !!x.doneOn;
      mutate(() => { if (was) delete x.doneOn; else x.doneOn = L.iso(today()); }, was ? `Sin hacer: ${x.text}` : `Hecho: ${x.text}. Queda tachado hasta mañana.`);
    },
    'mat-done'(el) {
      const p = S.practices.find((y) => y.id === el.dataset.id);
      if (!p) return;
      if (isComplete(p) && p.doneOn) { mutate(() => { p.items = p.items.map(() => false); delete p.doneOn; }, `Sin terminar: ${p.name}`); return; }
      mutate(() => { p.known = true; p.doneOn = L.iso(today()); if (!p.items.length) { p.items = [true]; p.single = true; } else p.items = p.items.map(() => true); }, `Terminado: ${p.name}`);
    },
    tour: () => tourDialog(0),
    'tour-go'(el) { tourDialog(+el.dataset.i); },
    'tour-end'() { S.settings.tourDone = true; save(); closeModal(); },
    'change-password': passwordDialog,
    'change-email': emailDialog,
    greet(el) { S.settings.greet = el.dataset.v; save(); render(); },
    'wiz-status'(el) { const c = course(el.dataset.id); c.status = el.dataset.s; if (L.isCurrent(c)) ensureColor(c.subj); save(); render(); },
    'wiz-back'() { S.settings.wizStep--; save(); render(); scrollTo(0, 0); },
    'term-word'(el) { S.settings.termWord = el.dataset.v; save(); render(); },
    'year-approve'(el) {
      S.courses.filter((c) => c.year === +el.dataset.y && !L.isCurrent(c)).forEach((c) => { c.status = 'aprobada 1ra instancia'; });
      save(); render();
    },
    'wiz-next'() {
      if (S.settings.wizStep === 1 && (ui.allDraft || '').trim()) {
        const r = applyAll(ui.allDraft);
        if (!r) { const pv = $('#all-preview'); if (pv) pv.innerHTML = allPreviewHtml(ui.allDraft); return; }
        ui.allDraft = '';
      }
      if (S.settings.wizStep === 1 && ui.planDraft.trim()) { applyPlan(ui.planDraft); ui.planDraft = ''; }
      S.settings.wizStep++; save(); render(); scrollTo(0, 0);
    },
    'wiz-finish'() { S.settings.onboarded = true; S.courses.filter(L.isCurrent).forEach((c) => ensureColor(c.subj)); save(); location.hash = 'hoy'; render(); scrollTo(0, 0); if (!S.settings.tourDone) tourDialog(0); },
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
    if (d.matches && d.matches('details.study-old')) ui.showOldStudy = d.open;
    if (d.matches && d.matches('details.study, details.sbox') && !ui.kindFilter) { if (d.open) ui.openSubj.add(d.dataset.subj); else ui.openSubj.delete(d.dataset.subj); }
  }, true);

  function gradeChange(el) {
    const parsed = L.parseGrade(el.value);
    const err = $('#grade-err');
    if (!parsed.ok) { el.setAttribute('aria-invalid', 'true'); if (err) err.textContent = 'La nota va de 0 a 10 (o de 0 a 100, y la paso a 10).'; return; }
    el.value = parsed.value === null ? '' : L.fmt(parsed.value);
    el.removeAttribute('aria-invalid');
    if (err) err.textContent = '';
    const c = course(el.dataset.id);
    mutate(() => { c[el.dataset.f] = parsed.value; }, inWizard() ? null : parsed.scaled ? `${label(c)}: ${parsed.raw} sobre 100 quedó en ${L.fmt(parsed.value)}` : `${label(c)}: nota guardada`);
    const est = $('#est-val');
    if (est) est.textContent = L.fmt(L.estimate(c));
  }
  function calChange(el) {
    const f = el.dataset.f; const err = $('#sem-err');
    const fail = (m) => { if (err) err.textContent = m; };
    if (err) err.textContent = '';
    const quiet = inWizard() ? null : 'Fechas guardadas';
    const st = S.settings;
    if (f === 'minAtt') {
      const n = Number(el.value);
      if (!(n >= 0 && n <= 100)) return fail('La asistencia mínima va de 0 a 100.');
      mutate(() => { st.minAtt = n / 100; }, quiet);
      return undefined;
    }
    if (f === 'holidays') {
      const year = +(calValues().semFirst || L.iso(today())).slice(0, 4);
      const list = el.value.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
      const dates = list.map((x) => L.parseDateLoose(x, year));
      if (dates.some((d) => !d)) return fail('Escribí los feriados como fechas: 17/08/2026, 12/10/2026.');
      mutate(() => { S.holidays = [...new Set(dates)].sort(); }, quiet);
      return undefined;
    }
    const cv = calValues();
    const next = { ...cv, [f]: el.value };
    if (!next.semFirst) return fail('Poné cuándo empiezan las clases.');
    if (next.semEnd && next.semEnd < next.semFirst) return fail('El fin de clases tiene que ser después del inicio.');
    if (next.parcFrom && next.parcTo && next.parcTo < next.parcFrom) return fail('Revisá las fechas de parciales: el "hasta" va después del "desde".');
    if (next.finFrom && next.finTo && next.finTo < next.finFrom) return fail('Revisá las fechas de finales: el "hasta" va después del "desde".');
    mutate(() => { Object.assign(st, next); recomputeWeeks(); }, quiet);
    return undefined;
  }
  document.addEventListener('change', (e) => {
    const el = e.target; const kind = el.dataset && el.dataset.change;
    if (!kind) return;
    deferring = true;
    try {
      if (kind === 'grade') gradeChange(el);
      if (kind === 'cal') calChange(el);
      if (kind === 'course') {
        const c = course(el.dataset.id); const f = el.dataset.f;
        let v = el.value;
        if (f === 'year') { v = parseInt(v, 10); if (!(v >= 1 && v <= 10)) { $('#grade-err').textContent = 'El año va de 1 a 10.'; return; } }
        mutate(() => { c[f] = v; if (L.isCurrent(c)) ensureColor(c.subj); }, 'Materia guardada');
      }
      if (kind === 'mat-color') { mutate(() => { S.matColors[el.dataset.subj] = el.value; }, 'Color guardado'); }
      if (kind === 'custom-accent') { S.settings.custom.accent = el.value; save(); render(); }
      if (kind === 'custom-second') { S.settings.custom.second = el.value; save(); render(); if (openDialogName() === 'Ajustes') settingsDialog(); }
      if (kind === 'cell-note') {
        const k = el.dataset.key; const v = el.value.trim();
        mutate(() => { if (v) S.cellNotes[k] = { ...(S.cellNotes[k] || {}), t: v }; else delete S.cellNotes[k]; }, 'Nota guardada');
      }
      if (kind === 'prac-doubt-note') { const p = S.practices.find((x) => x.id === el.dataset.id); mutate(() => { p.doubtNote = el.value.slice(0, 1000); }, null); return; }
      if (kind === 'prac-total') {
        const p = S.practices.find((x) => x.id === el.dataset.id);
        const n = parseInt(el.value, 10);
        const lastDone = Math.max(0, ...p.items.map((v, i) => (v ? i + 1 : 0)));
        if (el.value.trim() === '') { mutate(() => { p.known = false; p.items = p.items.slice(0, lastDone); }, `${p.name}: sin total`); return; }
        if (!(n >= 1) || n > 300) { toast('Poné un número entre 1 y 300.'); return; }
        if (n < lastDone) { toast(`${p.name} tiene tildados hasta el ${lastDone}. Destildalos primero o poné un total mayor.`); el.value = p.known ? p.items.length : ''; return; }
        mutate(() => { p.known = true; p.items = Array.from({ length: n }, (_, i) => !!p.items[i]); }, `${p.name}: ${p.items.filter(Boolean).length} de ${n}`);
      }
      if (kind === 'class-len-min') { const n = parseInt(el.value, 10); if (n >= 10 && n <= 600) { S.settings.classLen = n; save(); refreshSchedule(); } else toast('Poné entre 10 y 600 minutos.'); return; }
      if (kind === 'sticky-text') { const n = S.stickies.find((x) => x.id === el.dataset.id); const v = el.value.trim(); if (!n) return; if (!v) { closeModal(); mutate(() => { S.stickies = S.stickies.filter((x) => x !== n); }, 'Post-it despegado'); return; } mutate(() => { n.text = v.slice(0, 400); }, null); return; }
      if (kind === 'class-name' || kind === 'class-dow') {
        const c = S.classes.find((x) => x.id === el.dataset.id);
        if (!c) return;
        const v = kind === 'class-dow' ? +el.value : el.value.trim();
        if (kind === 'class-name' && !v) { el.value = c.name; return; }
        mutate(() => { c[kind === 'class-dow' ? 'dow' : 'name'] = v; sortClasses(); }, kind === 'class-dow' ? `${c.name}: ahora los ${L.DIAS[v]}` : 'Clase guardada');
        refreshSchedule();
        return;
      }
      if (kind === 'class-time') {
        const c = S.classes.find((x) => x.id === el.dataset.id);
        if (!c) return;
        mutate(() => {
          if (el.value) c[el.dataset.f] = el.value; else delete c[el.dataset.f];
          // Si cargás el inicio y no hay final (o quedó antes), se completa con la duración elegida.
          if (el.dataset.f === 'from' && c.from && (!c.to || c.to <= c.from)) c.to = addMin(c.from, S.settings.classLen || 120);
          sortClasses();
        }, null);
        // No se redibuja el cuadro (en el iPhone cortaría la ruedita de la hora): solo se completa el final.
        const toIn = el.closest('.cls-edit') && el.closest('.cls-edit').querySelector('[data-f="to"]');
        if (toIn && c.to && toIn.value !== c.to) toIn.value = c.to;
        return;
      }
      if (kind === 'icon-color') { S.settings.appIconColors = { ...iconColors(), [el.dataset.f]: el.value }; save(); applyAppIcon(); settingsDialog(); return; }
      if (kind === 'pomo-subj') { pomo.subj = el.value; pomoKeep(); return; }
      if (kind === 'pomo-vol') { S.settings.pomo = { ...pomoCfg(), vol: +el.value }; save(); if (amb && actx) amb.master.gain.linearRampToValueAtTime(+el.value * 0.6, actx.currentTime + 0.2); return; }
      if (kind === 'pet-decor') { S.settings.petDecor = el.checked; save(); render(); return; }
      if (kind === 'my-phrases') { S.settings.myPhrases = el.value.slice(0, 2000); save(); render(); return; }
      if (kind === 'setting') {
        S.settings[el.dataset.f] = el.value.trim();
        save();
        if (!inWizard()) render();
      }
      if (kind === 'mat-kind') {
        const f = el.form; const k = KINDS[el.value]; const nameIn = f.elements.name;
        $('#parts-label').textContent = partsQuestion(k);
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
    if (t.id === 'all-text') { ui.allDraft = t.value; const pv = $('#all-preview'); if (pv) pv.innerHTML = allPreviewHtml(t.value); }
    if (t.id === 'sched-text') { const pv = $('#sched-preview'); if (pv) pv.innerHTML = schedPreviewHtml(t.value); }
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
    base = snap(S);
    render();
    applyAppIcon();
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
      if (r.status === 200) { clearTimeout(saveTimer); dirty = false; location.href = location.pathname; } else $('#del-err').textContent = r.data.error || 'No se pudo borrar la cuenta.';
      return;
    }
    if (kind === 'class') {
      const co = course(d.course);
      mutate(() => {
        ensureColor(co.subj);
        const base = `${d.tipo.trim()} ${label(co)}`;
        const len = S.settings.classLen || 120;
        const end = d.to && d.from && d.to > d.from ? d.to : d.from ? addMin(d.from, len) : '';
        const tm = d.from ? { from: d.from, to: end } : {};
        // Dos bloques seguidos: el segundo arranca cuando termina el primero.
        const tm2 = d.from ? { from: end, to: addMin(end, len) } : {};
        if (d.x2) [1, 2].forEach((b) => S.classes.push({ id: uid('c'), name: `${base} · bloque ${b}`, mat: co.subj, course: co.id, dow: +d.dow, ...(b === 1 ? tm : tm2) }));
        else S.classes.push({ id: uid('c'), name: base, mat: co.subj, course: co.id, dow: +d.dow, ...tm });
        sortClasses();
      }, inWizard() ? null : 'Clase agregada');
      reopen(scheduleDialog);
      return;
    }
    if (kind === 'mile' && d.preset === 'otro' && !(d.text || '').trim()) { const err = $('#mile-err'); if (err) err.textContent = 'Escribí cuál es el hito.'; const t = f.elements.text; if (t) t.focus(); return; }
    if (kind === 'agenda' && !d.date) { const err = $('#ag-err'); if (err) err.textContent = 'Elegí la fecha en el calendario.'; return; }
    if (kind === 'agenda' && d.course === '__none') d.course = '';
    if (kind !== 'prac' && kind !== 'todo') closeModal();
    const id = uid(kind);
    if (kind === 'todo') { mutate(() => { S.todos = S.todos || []; S.todos.push({ id, text: d.text.trim(), date: d.date || '' }); }, 'Pendiente agregado'); return; }
    if (kind === 'agenda') mutate(() => { S.agenda.push({ id, title: (d.title || '').trim(), date: d.date, course: d.course || '', kind: d.kind || 'otro' }); }, 'Examen agregado');
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
        ui.openSubj.add(co.subj);
        mutate(() => {
          ensureColor(co.subj);
          const single = n <= 1 && d.kind !== 'practica' || n === 1;
          const all = d.alldone === '1';
          S.practices.push({ id, ...fields, single, items: single ? [all] : Array(n).fill(all), known: single || n > 0 });
        }, 'Material agregado');
      }
    }
    if (kind === 'mile') mutate(() => { S.milestones.push({ year: +d.year, sem: d.sem, text: d.preset === 'otro' ? d.text.trim() : d.preset }); }, `Hito agregado: lo ves en Carrera, en ${d.year}° año${d.sem === 'Anual' ? ', junto al título del año' : ''}`);
    if (kind === 'plan') { if (!d.plan.trim()) { toast('Subí un archivo o pegá la lista primero.'); return; } let added = 0; mutate(() => { added = applyPlan(d.plan); }, null); toast(added ? `${pl(added, 'materia agregada', 'materias agregadas')}.` : 'No había materias nuevas en la lista.', !!added); }
  });

  // Teclas 1 a 5 para saltar de sección.
  document.addEventListener('keydown', (e) => {
    if (!S || inWizard() || e.metaKey || e.ctrlKey || e.altKey || modal().open || $('#wrapped')) return;
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

  window.addEventListener('hashchange', () => { render(); scrollTo(0, 0); tip.hidden = true; pomoChip(); });
  // Al volver a la pestaña, trae lo último guardado desde otro dispositivo.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !S || dirty || inflight || modal().open) return;
    try {
      const r = await api('GET', '/api/me');
      if (r.status === 200 && r.data.rev !== rev && !dirty && !inflight) { S = migrate(r.data.state); rev = r.data.rev; base = snap(S); render(); }
    } catch (e) { /* sin conexión: seguimos con lo que hay */ }
  });

  // Instalar como app: Android ofrece el botón; en iPhone se explica cómo hacerlo.
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  // ---------- ÍCONO DE LA APP: se dibuja acá mismo (canvas) y se usa para la pantalla de inicio.
  const APP_ICONS = { clasico: 'Clásico', tucolor: 'Tu color', degrade: 'Degradé', byn: 'Blanco y negro', propio: 'Personalizado' };
  const iconColors = () => ({ g1: '#5B3FD9', g2: '#E2477F', bg: '#FFFFFF', fg: '#22305A', ...((S && S.settings.appIconColors) || {}) });
  function drawAppIcon(design, size) {
    const col = iconColors();
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#674EA7';
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); const u = size / 24;
    const check = (color) => { g.strokeStyle = color; g.lineWidth = 3 * u; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(6.5 * u, 12.6 * u); g.lineTo(10.4 * u, 16.4 * u); g.lineTo(17.6 * u, 8.4 * u); g.stroke(); };
    let bg = '#22305A'; let fg = '#FFFFFF';
    if (design === 'tucolor') bg = accent;
    if (design === 'byn') { bg = '#111111'; fg = '#FFFFFF'; }
    if (design === 'propio') { bg = col.bg; fg = col.fg; }
    if (design === 'degrade') { const gr = g.createLinearGradient(0, 0, size, size); gr.addColorStop(0, col.g1); gr.addColorStop(1, col.g2); g.fillStyle = gr; } else g.fillStyle = bg;
    g.fillRect(0, 0, size, size);
    check(fg);
    return c.toDataURL('image/png');
  }
  // Pone el ícono elegido en la pestaña, en "Agregar a inicio" del iPhone y en la instalación de Android.
  let manifestUrl = null;
  function applyAppIcon() {
    if (!S) return;
    const d = S.settings.appIcon || 'clasico';
    if (d === 'clasico') return; // el de siempre, con los archivos originales
    try {
      const i180 = drawAppIcon(d, 180); const i192 = drawAppIcon(d, 192); const i512 = drawAppIcon(d, 512);
      const setLink = (rel, href) => { let l = document.querySelector(`link[rel="${rel}"]`); if (!l) { l = document.createElement('link'); l.rel = rel; document.head.append(l); } l.href = href; };
      setLink('apple-touch-icon', i180); setLink('icon', i192);
      const here = new URL('./', location.href).href;
      const man = { name: 'CursadOK', short_name: 'CursadOK', lang: 'es-AR', start_url: `${here}#hoy`, scope: here, display: 'standalone', background_color: '#ECEEF2', theme_color: '#22305A', icons: [{ src: i192, sizes: '192x192', type: 'image/png' }, { src: i512, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] };
      if (manifestUrl) URL.revokeObjectURL(manifestUrl);
      manifestUrl = URL.createObjectURL(new Blob([JSON.stringify(man)], { type: 'application/manifest+json' }));
      setLink('manifest', manifestUrl);
    } catch (e) { /* si el navegador no deja, queda el ícono de siempre */ }
  }
  function appIconPickerHtml() {
    const cur = APP_ICONS[S.settings.appIcon] ? S.settings.appIcon : 'clasico';
    const col = iconColors();
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const color = (f, lbl) => `<label class="icon-color">${lbl}<input type="color" value="${h(col[f])}" data-change="icon-color" data-f="${f}"></label>`;
    return `<div class="icon-picker" role="group" aria-label="Ícono de la app">${Object.entries(APP_ICONS).map(([k, n]) => `<button type="button" data-act="app-icon" data-v="${k}" aria-pressed="${cur === k}"><img src="${drawAppIcon(k, 112)}" alt="" width="56" height="56"><span>${n}</span></button>`).join('')}</div>
      ${cur === 'degrade' ? `<div class="icon-colors">${color('g1', 'Color 1')}${color('g2', 'Color 2')}</div>` : ''}
      ${cur === 'propio' ? `<div class="icon-colors">${color('bg', 'Fondo')}${color('fg', 'Tilde')}</div>` : ''}
      <p class="sub" style="margin-top:8px">${isStandalone() || ios ? 'Para que cambie en la pantalla de inicio: borrá el acceso de CursadOK y volvé a agregarlo (en Safari: Compartir → Agregar a inicio). En el iPhone el ícono se toma al agregarla.' : 'Se usa al instalarla. Si ya la tenés instalada, desinstalala y volvé a instalarla para ver el ícono nuevo.'}</p>`;
  }
  function installHtml() {
    if (isStandalone()) return '<p class="sub">Ya la estás usando como app.</p>';
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (installEvent) return '<div class="actions" style="justify-content:flex-start;margin-top:8px"><button class="btn" data-act="install">Instalar CursadOK</button></div>';
    if (ios) return '<p class="sub">En iPhone: abrí CursadOK en Safari, tocá <b>Compartir</b> y después <b>Agregar a inicio</b>.</p>';
    return '<p class="sub">En Android: abrí CursadOK en Chrome, tocá el menú de los tres puntos y elegí <b>Instalar app</b> o <b>Agregar a la pantalla principal</b>.</p>';
  }

  (async function boot() {
    // Mientras se fija si ya entraste, queda el loader de index.html (sin mostrar el ingreso de golpe).
    applyTheme();
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
