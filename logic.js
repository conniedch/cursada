// Cuentas de Cursada. Sin DOM: se puede probar con node (ver tests.js).
(function (root) {
  const DAY = 86400000;
  const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const daysBetween = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
  const dow = (d) => (d.getDay() + 6) % 7; // 0 = lunes

  const avg = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined && x !== ''); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

  function fmt(n, dec = 2) {
    if (n === null || n === undefined || Number.isNaN(n)) return '–';
    const r = Math.round(n * 10 ** dec) / 10 ** dec;
    return String(r).replace('.', ',');
  }
  const pct = (x) => (x === null ? '–' : `${Math.round(x * 100)}%`);

  // ---------- Calendario del cuatrimestre
  const weekNumber = (s, today) => Math.floor(daysBetween(parseDate(s.settings.semStart), today) / 7) + 1;
  const weekStart = (s, w) => addDays(parseDate(s.settings.semStart), (w - 1) * 7);
  const cellDate = (s, w, cls) => addDays(weekStart(s, w), cls.dow);
  const classWeeks = (s) => s.weeks.filter((w) => w.kind === 'clases');
  const lastClassWeek = (s) => Math.max(0, ...classWeeks(s).map((w) => w.n));
  const firstWeekOf = (s, kind) => { const w = s.weeks.find((x) => x.kind === kind); return w ? w.n : null; };

  // Todas las clases en orden de calendario, con su estado.
  // 'p' fui, 'a' falté, 'n' no hubo, null sin cargar.
  function allCells(s) {
    const out = [];
    for (const w of classWeeks(s)) {
      for (const c of s.classes) {
        out.push({ week: w.n, cls: c, key: `${w.n}:${c.id}`, state: s.att[`${w.n}:${c.id}`] || null, date: cellDate(s, w.n, c) });
      }
    }
    return out;
  }

  function tally(cells) {
    const t = { p: 0, a: 0, n: 0, pending: 0 };
    for (const c of cells) { if (c.state === 'p') t.p++; else if (c.state === 'a') t.a++; else if (c.state === 'n') t.n++; else t.pending++; }
    t.taken = t.p + t.a;
    t.pct = t.taken ? t.p / t.taken : null;
    t.total = t.p + t.a + t.pending;
    return t;
  }

  // Cuántas faltas te quedan antes de bajar del mínimo, contando las clases que faltan.
  function materiaStats(s, mat) {
    const cells = allCells(s).filter((c) => c.cls.mat === mat);
    const t = tally(cells);
    const allowed = Math.floor(t.total * (1 - s.settings.minAtt) + 1e-9);
    return { ...t, allowed, left: allowed - t.a };
  }

  function streaks(s) {
    let cur = 0; let best = 0;
    for (const c of allCells(s)) {
      if (c.state === 'p') { cur++; if (cur > best) best = cur; } else if (c.state === 'a') cur = 0;
    }
    return { current: cur, best };
  }

  function absencesByDay(s) {
    const days = {};
    for (const c of allCells(s)) {
      const d = c.cls.dow;
      days[d] = days[d] || { dow: d, a: 0, p: 0 };
      if (c.state === 'a') days[d].a++;
      if (c.state === 'p') days[d].p++;
    }
    return Object.values(days).sort((x, y) => x.dow - y.dow);
  }

  function pendingPast(s, today) {
    return allCells(s).filter((c) => c.state === null && daysBetween(c.date, today) > 0);
  }

  // ---------- Notas y carrera
  const isApproved = (c) => c.status.startsWith('aprobada');
  const isCurrent = (c) => c.status === 'cursando' || c.status === 'recursando';
  const estimate = (c) => avg([c.p1, c.p2]);

  // Una fila por materia del plan: si la recursaste, vale el último intento.
  function subjects(s) {
    const map = new Map();
    for (const c of s.courses) {
      const prev = map.get(c.subj);
      map.set(c.subj, { ...c, attempts: (prev ? prev.attempts : 0) + 1 });
    }
    return [...map.values()];
  }

  function careerStats(s) {
    const subj = subjects(s);
    const withFinal = s.courses.filter((c) => c.final !== null);
    const approved = s.courses.filter((c) => isApproved(c) && c.final !== null);
    return {
      total: subj.length,
      approved: subj.filter(isApproved).length,
      current: subj.filter(isCurrent).length,
      avgAll: avg(withFinal.map((c) => c.final)),
      avgApproved: avg(approved.map((c) => c.final)),
      avgP1: avg(s.courses.map((c) => c.p1)),
      avgP2: avg(s.courses.map((c) => c.p2)),
    };
  }

  function semesterAverages(s) {
    const groups = new Map();
    for (const c of s.courses) {
      const k = `${c.year}${c.sem}`;
      if (!groups.has(k)) groups.set(k, { key: k, year: c.year, sem: c.sem, finals: [] });
      if (c.final !== null) groups.get(k).finals.push(c.final);
    }
    return [...groups.values()].filter((g) => g.finals.length).map((g) => ({ ...g, avg: avg(g.finals) }));
  }

  // Qué nota necesitás en el parcial 2 para que el promedio de parciales llegue a `target`.
  function needed(c, target) {
    if (c.p1 === null || c.p2 !== null) return null;
    return 2 * target - c.p1;
  }

  // Del parcial 1 al 2, para decirlo en criollo.
  function improvements(s) {
    const rows = s.courses.filter((c) => c.p1 != null && c.p2 != null).map((c) => ({
      course: c, p1: c.p1, p2: c.p2, delta: c.p2 - c.p1, pct: c.p1 > 0 ? (c.p2 - c.p1) / c.p1 : null,
    }));
    rows.sort((a, b) => b.delta - a.delta);
    const a1 = avg(rows.map((r) => r.p1)); const a2 = avg(rows.map((r) => r.p2));
    return {
      rows, n: rows.length,
      up: rows.filter((r) => r.delta > 0).length,
      down: rows.filter((r) => r.delta < 0).length,
      avgP1: a1, avgP2: a2,
      delta: rows.length ? a2 - a1 : null,
      pct: rows.length && a1 > 0 ? (a2 - a1) / a1 : null,
      best: rows.length && rows[0].delta > 0 ? rows[0] : null,
    };
  }

  const slug = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  const YEAR_WORDS = { primer: 1, primero: 1, segundo: 2, tercer: 3, tercero: 3, cuarto: 4, quinto: 5, sexto: 6 };
  function readYear(t) {
    const x = t.trim().toLowerCase();
    let m = /^a[nñ]o\s*(\d)$/.exec(x) || /^(\d)\s*(?:°|º|er|do|ro|to|ero|ndo|mo)?\.?\s*a[nñ]o$/.exec(x);
    if (m) return Number(m[1]);
    m = /^(primer|primero|segundo|tercer|tercero|cuarto|quinto|sexto)\s+a[nñ]o$/.exec(x);
    return m ? YEAR_WORDS[m[1]] : null;
  }
  function readTerm(t) {
    const x = t.trim().toLowerCase();
    if (x === 'anual') return { sem: 'Anual' };
    const m = /^(?:(1|2|1er|2do|1°|2°|primer|segundo)\s+)?(semestre|cuatrimestre|cuatri)(?:\s+(a|b|1|2|i|ii|primero|segundo))?$/.exec(x);
    if (!m || (!m[1] && !m[3])) return null;
    const v = m[1] || m[3];
    return { sem: /^(1|1er|1°|primer|primero|a|i)$/.test(v) ? 'A' : 'B', word: m[2] === 'semestre' ? 'Semestre' : 'Cuatrimestre' };
  }
  const NOT_SUBJECT = /^(a[nñ]o|semestre|cuatrimestre|materias?|asignaturas?|c[oó]digo|nombre|estado|horas?|carga horaria|cr[eé]ditos|correlativas?|plan de estudios?|p[aá]gina \d+|promedio\b.*|total\b.*)$/i;
  // Acepta una lista pegada de un PDF, una web o una planilla (con columnas separadas por tab).
  function parsePlan(text) {
    let year = 1; let sem = 'A'; let word = null;
    const items = []; const seen = new Set();
    for (const original of String(text).split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(original)) continue; // bloque de código de una IA
      const raw = original.replace(/^\s*#{1,6}\s*/, '').replace(/\*\*|__/g, '');
      const cells = raw.split(/\t+| {2,}/).map((c) => c.trim()).filter(Boolean);
      let name = null;
      for (const cell of cells) {
        const parts = cell.split(/\s*[-–—,:|/]\s*/).filter(Boolean);
        if (!name && parts.every((p) => readYear(p) || readTerm(p))) {
          for (const p of parts) {
            const y = readYear(p); if (y) { year = y; sem = 'A'; }
            const tm = readTerm(p); if (tm) { sem = tm.sem; if (tm.word) word = tm.word; }
          }
          continue;
        }
        if (!name) {
          const c = cell.replace(/^(?:[-*•·]|\d+[.)])\s*/, '').trim();
          if (/\p{L}/u.test(c) && !/^[A-Z]{0,4}\d+[A-Z]?$/.test(c)) name = c; // saltea números y códigos de materia
        }
      }
      if (!name || name.length > 140 || NOT_SUBJECT.test(name) || /[▀▄█]/.test(name)) continue;
      if (name.endsWith(':') || name.split(/\s+/).length > 16) continue; // frases sueltas, no materias
      const k = slug(name);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ name, year, sem });
    }
    return { items, word };
  }

  function parseWeekList(t, total) {
    const out = String(t).split(/[\s,;y]+/).filter(Boolean).map(Number);
    if (out.some((n) => !Number.isInteger(n) || n < 1 || n > total)) return null;
    return out;
  }
  function buildWeeks(total, parciales, finales) {
    return Array.from({ length: total }, (_, i) => {
      const n = i + 1;
      return { n, kind: finales.includes(n) ? 'finales' : parciales.includes(n) ? 'parciales' : 'clases' };
    });
  }

  function parseGrade(raw) {
    const t = String(raw).trim().replace(',', '.');
    if (t === '') return { ok: true, value: null };
    const n = Number(t);
    if (Number.isNaN(n) || n < 0 || n > 10) return { ok: false };
    return { ok: true, value: n };
  }

  root.CursadaLogic = { DIAS, MESES, parseDate, iso, addDays, daysBetween, dow, avg, fmt, pct, weekNumber, weekStart, cellDate, classWeeks, lastClassWeek, firstWeekOf, allCells, tally, materiaStats, streaks, absencesByDay, pendingPast, isApproved, isCurrent, estimate, subjects, careerStats, semesterAverages, needed, parseGrade, improvements, slug, parsePlan, parseWeekList, buildWeeks };
})(typeof window !== 'undefined' ? window : globalThis);
