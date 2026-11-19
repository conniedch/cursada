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
        const date = cellDate(s, w.n, c);
        let state = s.att[`${w.n}:${c.id}`] || null;
        const holiday = !!(s.holidays && s.holidays.includes(iso(date)));
        if ((!state || state === 'f') && holiday) state = 'n'; // feriado: no hubo clase, sin que haya que marcarlo
        out.push({ week: w.n, cls: c, key: `${w.n}:${c.id}`, state, date, holiday });
      }
    }
    return out;
  }

  function tally(cells) {
    // f = "no voy": una falta anotada de antemano (un viaje, un turno). Cuenta para las faltas que te quedan.
    const t = { p: 0, a: 0, n: 0, f: 0, pending: 0 };
    for (const c of cells) { if (c.state === 'p') t.p++; else if (c.state === 'a') t.a++; else if (c.state === 'n') t.n++; else if (c.state === 'f') t.f++; else t.pending++; }
    t.taken = t.p + t.a;
    t.pct = t.taken ? t.p / t.taken : null;
    t.total = t.p + t.a + t.f + t.pending;
    return t;
  }

  // Cuántas faltas te quedan antes de bajar del mínimo, contando las clases que faltan.
  function materiaStats(s, mat) {
    const cells = allCells(s).filter((c) => c.cls.mat === mat);
    const t = tally(cells);
    const allowed = Math.floor(t.total * (1 - s.settings.minAtt) + 1e-9);
    return { ...t, allowed, left: allowed - t.a - t.f };
  }

  // Rachas: clases seguidas yendo, y faltas seguidas (las últimas que cargaste).
  function streaks(s) {
    let cur = 0; let best = 0; let absent = 0; let absentIn = [];
    for (const c of allCells(s)) {
      if (c.state === 'p') { cur++; if (cur > best) best = cur; absent = 0; absentIn = []; } else if (c.state === 'a') { cur = 0; absent++; absentIn.push(c.cls.mat); }
    }
    return { current: cur, best, absent, absentIn: [...new Set(absentIn)] };
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

  // Horario pegado (de una IA o escrito a mano): día como título y "Tipo - Materia" por renglón.
  const DAY_RE = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b[\s:.-]*/i;
  const DAY_IDX = { lunes: 0, martes: 1, miercoles: 2, 'miércoles': 2, jueves: 3, viernes: 4, sabado: 5, 'sábado': 5 };
  const plain = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Palabras que aparecen en muchas materias y no sirven para reconocer una.
  const GENERIC = new Set(['general', 'generales', 'introduccion', 'fundamentos', 'taller', 'seminario', 'teoria', 'practica', 'aplicada', 'aplicadas', 'aplicado', 'avanzado', 'avanzada', 'principios', 'elementos', 'nociones', 'para', 'sobre', 'desde', 'entre']);
  function matchScore(text, c) {
    const t = plain(text);
    let best = 0;
    for (const n of [c.name, c.short].filter(Boolean).map(plain)) {
      if (!n) continue;
      if (t === n) best = Math.max(best, 3);
      else if (t.includes(n) || n.includes(t)) best = Math.max(best, 2);
      else {
        const words = n.split(' ').filter((w) => w.length > 3 && !GENERIC.has(w));
        const hit = words.filter((w) => t.split(' ').includes(w)).length;
        if (words.length && hit / words.length >= 0.5) best = Math.max(best, 1 + hit / words.length / 2);
      }
    }
    return best;
  }
  // Lo que sobra del renglón, sacando las palabras de la materia, es el tipo de clase.
  function restOf(text, c) {
    const nameWords = new Set([c.name, c.short].filter(Boolean).flatMap((n) => plain(n).split(' ')));
    return text.split(/\s+/).filter((w) => !nameWords.has(plain(w))).join(' ');
  }
  // Horario de una clase. Se busca SOLO al final del renglón ("… - 14:40 a 16:10") o al principio
  // ("14:40 a 16:10 Teórica …"), nunca en el medio: así "bloque 1" o "Química 2" no se leen como horas.
  // Acepta 24 h ("14:40", "14.40", "14h40", "14 hs") y 12 h ("2:40 p. m.", "2pm").
  const H_PART = String.raw`(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|hs?\.?)?`;
  const H_SEP = String.raw`\s*(?:-|–|—|a|al|hasta)\s*`;
  const RANGE_END = new RegExp(String.raw`(?:^|[\s(\[|,:→>–—-])${H_PART}${H_SEP}${H_PART}\s*[)\].]?\s*$`, 'i');
  const RANGE_START = new RegExp(String.raw`^\s*${H_PART}${H_SEP}${H_PART}(?=\s|$|[|:,–—-])`, 'i');
  const LOOKS_LIKE_TIME = /\b\d{1,2}\s*[:.h]\s*\d{2}\b|\b\d{1,2}\s*(a\.?\s?m|p\.?\s?m|hs)\b/i;
  function timesIn(line) {
    const src = String(line);
    let m = RANGE_END.exec(src); let rest = '';
    if (m) rest = src.slice(0, m.index + (/^[\s(\[|,:→>–—-]/.test(m[0]) ? 1 : 0)).trim();
    else { m = RANGE_START.exec(src); if (m) rest = src.slice(m[0].length).trim(); }
    if (!m) return LOOKS_LIKE_TIME.test(src) ? { rest: src, error: 'No pude leer el horario: escribilo como 14:40 a 16:10.' } : { rest: src };
    const [, h1, m1, s1, h2, m2, s2] = m;
    const kind = (x) => (!x ? '' : /^p/i.test(x) ? 'pm' : /^a/i.test(x) ? 'am' : 'h');
    let k1 = kind(s1); const k2 = kind(s2);
    let H1 = +h1; let H2 = +h2; const M1 = +(m1 || 0); const M2 = +(m2 || 0);
    // "2 a 4 p. m." → las dos son de la tarde; "11 a 1 p. m." → la primera es de la mañana.
    if (!k1 && (k2 === 'am' || k2 === 'pm')) k1 = k2 === 'pm' && H1 > H2 && H1 !== 12 ? 'am' : k2;
    const to24 = (H, k) => (k === 'pm' ? (H % 12) + 12 : k === 'am' ? H % 12 : H);
    if ((k1 === 'am' || k1 === 'pm') && (H1 < 1 || H1 > 12)) return { rest, error: `"${h1}" no es una hora válida con a. m./p. m.` };
    if ((k2 === 'am' || k2 === 'pm') && (H2 < 1 || H2 > 12)) return { rest, error: `"${h2}" no es una hora válida con a. m./p. m.` };
    H1 = to24(H1, k1); H2 = to24(H2, k2);
    if (H1 > 23 || H2 > 23 || M1 > 59 || M2 > 59) return { rest, error: 'Hay una hora que no existe.' };
    // Sin minutos ni "hs"/"a. m." ("8 a 10") solo vale si parece un horario de clase, no "bloque 1 - 2".
    if (!m1 && !m2 && !k1 && !k2 && (H1 < 6 || H2 < 6)) return { rest: src };
    const f = (H, M) => `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`;
    const from = f(H1, M1); const to = f(H2, M2);
    if (to <= from) return { rest, error: `La hora de fin (${to}) tiene que ser después de la de inicio (${from}).` };
    return { from, to, rest };
  }
  function parseSchedule(text, courses) {
    let dow = null;
    const items = []; const unknown = []; const errors = [];
    for (const original of String(text).split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(original)) continue;
      let line = original.replace(/^\s*#{1,6}\s*/, '').replace(/\*\*|__/g, '').replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').trim();
      const d = DAY_RE.exec(line);
      if (d) { dow = DAY_IDX[d[1].toLowerCase()] ?? DAY_IDX[d[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')]; line = line.slice(d[0].length).trim(); }
      const tm = timesIn(line);
      const times = tm.from ? { from: tm.from, to: tm.to } : {};
      line = tm.rest.replace(/\s+/g, ' ').replace(/^[\s:,|→>–—-]+|[\s:,|→>–—=-]+$/g, '');
      // "· bloque 2" se guarda aparte: no es parte del tipo de clase.
      let block = 0;
      line = line.replace(/\s*[·•-]?\s*bloque\s*(\d+)\s*$/i, (_, n) => { block = +n; return ''; }).trim();
      if (!line || dow === null || line.endsWith(':') || line.split(' ').length > 16) continue;
      if (tm.error) { errors.push({ line: original.trim(), msg: tm.error }); }
      const parts = line.split(/\s+[-–—|]\s+|\t+|:\s+/).map((x) => x.trim()).filter(Boolean);
      let found = null; let score = 0; let tipo = '';
      parts.forEach((part, i) => {
        for (const c of courses) {
          const sc = matchScore(part, c);
          if (sc > score) { score = sc; found = c; tipo = parts.filter((_, j) => j !== i).join(' ') || restOf(part, c); }
        }
      });
      if (!found) {
        for (const c of courses) {
          const sc = matchScore(line, c);
          if (sc > score) {
            score = sc; found = c;
            tipo = restOf(line, c);
          }
        }
      }
      if (!found || score < 1.25) { unknown.push(line); continue; }
      items.push({ dow, courseId: found.id, tipo: (tipo || 'Clase').replace(/^\w/, (ch) => ch.toUpperCase()), ...times, ...(block ? { block } : {}), ...(tm.error ? { timeError: tm.error } : {}) });
    }
    return { items, unknown, errors };
  }

  // ---------- Calendario por fechas (en vez de contar semanas)
  function parseDateLoose(t, year) {
    const x = String(t).trim();
    let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(x);
    if (m) return iso(new Date(+m[1], +m[2] - 1, +m[3]));
    m = /(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/.exec(x);
    if (m) {
      let y = m[3] ? +m[3] : year;
      if (!y) return null;
      if (y < 100) y += 2000;
      const d = new Date(y, +m[2] - 1, +m[1]);
      return d.getMonth() === +m[2] - 1 ? iso(d) : null;
    }
    return null;
  }
  const DATE_ANY = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?/g;
  function datesIn(line, year) { return (String(line).match(DATE_ANY) || []).map((d) => parseDateLoose(d, year)).filter(Boolean); }

  function parseCalendar(text) {
    const cal = { start: null, end: null, parciales: null, finales: null, holidays: [] };
    const lines = String(text).split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').replace(/\*\*|__/g, '').trim()).filter(Boolean);
    const firstYear = (() => { for (const l of lines) { const m = /(20\d{2})/.exec(l); if (m) return +m[1]; } return null; })();
    let inHolidays = false;
    for (const l of lines) {
      const low = plain(l);
      const ds = datesIn(l, firstYear);
      if (/^feriado/.test(low)) { inHolidays = true; cal.holidays.push(...ds); continue; }
      if (/^(inicio|comienzo|empiezan|arranca)/.test(low) && ds[0]) { cal.start = ds[0]; inHolidays = false; continue; }
      if (/^(fin|final de clases|terminan|cierre)/.test(low) && !/^finales/.test(low) && ds[0]) { cal.end = ds[ds.length - 1]; inHolidays = false; continue; }
      if (/^parcial/.test(low) && ds[0]) { cal.parciales = [ds[0], ds[ds.length - 1]]; inHolidays = false; continue; }
      if (/^(finales|mesas|examenes finales)/.test(low) && ds[0]) { cal.finales = [ds[0], ds[ds.length - 1]]; inHolidays = false; continue; }
      if (inHolidays && ds.length) cal.holidays.push(...ds);
    }
    cal.holidays = [...new Set(cal.holidays)].sort();
    return cal;
  }
  // Fechas de cada materia: "2026-09-28 - Parcial 1 - Cálculo"
  function parseFechas(text, year) {
    const out = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const l = raw.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').replace(/\*\*|__/g, '').trim();
      const ds = datesIn(l, year);
      if (!ds.length) continue;
      const title = l.replace(DATE_ANY, ' ').replace(/^[\s:,–—-]+|[\s:,–—-]+$/g, '').replace(/\s+[-–—]\s+/g, ' · ').replace(/\s+/g, ' ').trim();
      if (title) out.push({ date: ds[0], title });
    }
    return out;
  }
  // La respuesta completa de la IA: secciones PLAN, HORARIO, CALENDARIO y FECHAS.
  function parseAll(text) {
    const parts = { plan: [], horario: [], calendario: [], fechas: [] };
    let cur = null;
    for (const raw of String(text).split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(raw)) continue;
      const head = plain(raw.replace(/^\s*#{1,6}\s*/, '').replace(/\*\*|__/g, '').replace(/:\s*$/, ''));
      if (/^plan( de estudios?)?$/.test(head)) { cur = 'plan'; continue; }
      if (/^horarios?( semanal(es)?)?$/.test(head)) { cur = 'horario'; continue; }
      if (/^calendario( academico)?$/.test(head)) { cur = 'calendario'; continue; }
      if (/^(fechas|examenes|fechas de examenes|fechas importantes)$/.test(head)) { cur = 'fechas'; continue; }
      if (cur) parts[cur].push(raw);
    }
    const cal = parseCalendar(parts.calendario.join('\n'));
    const year = cal.start ? +cal.start.slice(0, 4) : null;
    return { planText: parts.plan.join('\n'), schedText: parts.horario.join('\n'), calendar: cal, fechas: parseFechas(parts.fechas.join('\n'), year), found: Object.values(parts).some((x) => x.length) };
  }
  // Semanas del cuatrimestre a partir de las fechas.
  function weeksFromDates(start, end, parciales, finales) {
    const first = parseDate(start);
    const monday = addDays(first, -dow(first));
    const last = [end, finales && finales[1], parciales && parciales[1]].filter(Boolean).map(parseDate).reduce((a, b) => (b > a ? b : a), first);
    const total = Math.max(1, Math.min(40, Math.floor(daysBetween(monday, last) / 7) + 1));
    const overlaps = (w, r) => {
      if (!r) return false;
      const a = addDays(monday, (w - 1) * 7); const b = addDays(a, 4);
      return parseDate(r[0]) <= b && parseDate(r[1]) >= a;
    };
    const weeks = Array.from({ length: total }, (_, i) => {
      const n = i + 1;
      return { n, kind: overlaps(n, finales) ? 'finales' : overlaps(n, parciales) ? 'parciales' : 'clases' };
    });
    return { semStart: iso(monday), weeks };
  }

  function parseGrade(raw) {
    const t = String(raw).trim().replace(',', '.');
    if (t === '') return { ok: true, value: null };
    if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false };
    const n = Number(t);
    // Más de 10 (hasta 100) se entiende como nota sobre 100: 85 queda en 8,5.
    if (n > 10 && n <= 100) return { ok: true, value: n / 10, scaled: true, raw: t.replace('.', ',') };
    if (n < 0 || n > 10) return { ok: false };
    return { ok: true, value: n };
  }

  root.CursadaLogic = { DIAS, MESES, parseDate, iso, addDays, daysBetween, dow, avg, fmt, pct, weekNumber, weekStart, cellDate, classWeeks, lastClassWeek, firstWeekOf, allCells, tally, materiaStats, streaks, absencesByDay, pendingPast, isApproved, isCurrent, estimate, subjects, careerStats, semesterAverages, needed, parseGrade, parseSchedule, timesIn, parseDateLoose, parseCalendar, parseFechas, parseAll, weeksFromDates, improvements, slug, parsePlan, parseWeekList, buildWeeks };
})(typeof window !== 'undefined' ? window : globalThis);
