// Coche — interface
// Fonctionne dans l'appli (Tauri) et aussi dans un simple navigateur
// (les données vont alors dans le localStorage) : pratique pour tester le design.
'use strict';

const TAURI = window.__TAURI__ || null;
const invoke = (cmd, args) => (TAURI ? TAURI.core.invoke(cmd, args) : Promise.resolve(null));
const $ = (id) => document.getElementById(id);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DEFAULT_SETTINGS = { notifPerDay: 3, startHour: 9, endHour: 21, sounds: true, autostart: true };

/* =========================================================================
   Données
   ========================================================================= */

let data = null;
let currentDay = todayKey();

function defaultData() {
  const listId = uid();
  const task = (text) => ({ id: uid(), text, listId, done: false, doneAt: null, focus: false, createdAt: todayKey() });
  return {
    version: 1,
    lists: [{ id: listId, name: 'Perso' }],
    currentList: listId,
    tasks: [
      task('Coche-moi pour voir ce que fait le panda'),
      task("Clique sur l'étoile d'une tâche pour en faire ta priorité du jour"),
      task('Ajouter ta première vraie tâche'),
    ],
    settings: { ...DEFAULT_SETTINGS },
    history: {},
  };
}

function normalize() {
  if (!Array.isArray(data.lists) || !data.lists.length) data.lists = [{ id: uid(), name: 'Perso' }];
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  data.history = data.history || {};
  if (!data.lists.some((l) => l.id === data.currentList)) data.currentList = data.lists[0].id;

  // Chaque nouveau jour, la liste repart propre : les tâches terminées les jours
  // précédents disparaissent (elles restent comptées dans l'historique).
  const today = todayKey();
  data.tasks = data.tasks.filter((t) => !t.done || t.doneAt === today);

  const ids = new Set(data.lists.map((l) => l.id));
  data.tasks.forEach((t) => { if (!ids.has(t.listId)) t.listId = data.lists[0].id; });

  const cutoff = todayKey(new Date(Date.now() - 60 * 864e5));
  for (const k of Object.keys(data.history)) if (k < cutoff) delete data.history[k];
}

async function load() {
  let raw = null;
  if (TAURI) raw = await invoke('load_data');
  else {
    try { raw = JSON.parse(localStorage.getItem('coche-data')); } catch { raw = null; }
  }
  data = raw && Array.isArray(raw.tasks) ? raw : defaultData();
  normalize();
  save(true);
}

let saveTimer = null;
function save(now = false) {
  clearTimeout(saveTimer);
  const write = () => {
    if (TAURI) return invoke('save_data', { data }).catch((e) => console.error('Sauvegarde impossible', e));
    try { localStorage.setItem('coche-data', JSON.stringify(data)); } catch { /* stockage indisponible */ }
    return Promise.resolve();
  };
  if (now) return write();
  saveTimer = setTimeout(write, 250);
  return Promise.resolve();
}

const findTask = (id) => data.tasks.find((t) => t.id === id);
const pendingIn = (listId) => data.tasks.filter((t) => !t.done && (!listId || t.listId === listId));
const doneToday = () => data.history[todayKey()] || 0;

/* =========================================================================
   Sons (générés, aucun fichier audio) : petits bruits de bois
   ========================================================================= */

const sound = (() => {
  let ctx = null;
  const ac = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function tone(freq, start, dur, type = 'sine', gain = 0.1, slide = 1) {
    const c = ac();
    const t0 = c.currentTime + start;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  const play = (fn) => () => {
    if (!data || !data.settings.sounds) return;
    try { fn(); } catch { /* audio indisponible */ }
  };
  return {
    check: play(() => { tone(880, 0, 0.09, 'triangle', 0.09, 0.7); tone(1320, 0.06, 0.16, 'sine', 0.07); }),
    add: play(() => tone(620, 0, 0.07, 'triangle', 0.06, 0.8)),
    undo: play(() => tone(520, 0, 0.1, 'sine', 0.05, 0.75)),
    remove: play(() => tone(300, 0, 0.09, 'triangle', 0.05, 0.8)),
    win: play(() => [587, 740, 880, 1175].forEach((f, i) => tone(f, i * 0.1, 0.32, 'triangle', 0.07))),
  };
})();

/* =========================================================================
   Le panda
   ========================================================================= */

const panda = (() => {
  const scene = $('scene');
  const bubble = $('bubble');
  const timers = {};
  let mood = 'idle';

  function flash(cls, ms) {
    scene.classList.remove(cls);
    void scene.offsetWidth;
    scene.classList.add(cls);
    clearTimeout(timers[cls]);
    timers[cls] = setTimeout(() => scene.classList.remove(cls), ms);
  }
  function smileFor(ms) {
    scene.classList.add('happy');
    clearTimeout(timers.smile);
    timers.smile = setTimeout(() => scene.classList.toggle('happy', mood === 'happy'), ms);
  }
  function loop(fn, min, spread) {
    setTimeout(() => { fn(); loop(fn, min, spread); }, min + Math.random() * spread);
  }
  if (!reducedMotion) {
    loop(() => { if (mood !== 'sleep') flash('blink', 130); }, 2400, 4200);
    loop(() => { if (mood !== 'sleep') flash('twitch', 450); }, 7000, 9000);
  }

  return {
    setMood(m) {
      mood = m;
      scene.classList.toggle('sleeping', m === 'sleep');
      scene.classList.toggle('happy', m === 'happy');
      if (m === 'sleep') scene.classList.remove('look');
    },
    say(text) {
      if (bubble.textContent === text) return;
      bubble.textContent = text;
      bubble.classList.remove('pop');
      void bubble.offsetWidth;
      bubble.classList.add('pop');
    },
    hop() { flash('hop', 560); smileFor(900); },
    cheer() { flash('cheer', 1300); smileFor(1600); },
    look(on) { scene.classList.toggle('look', on && mood !== 'sleep'); },
  };
})();

const LINES = {
  empty: ['Rien sur la liste. Je fais la sieste.', 'Liste vide. Réveille-moi quand tu ajoutes quelque chose.'],
  night: ["Il est tard. On s'y remet demain ?", 'Je dors à moitié, mais je garde un œil sur ta liste.'],
  fresh: ['On commence par laquelle ?', 'Une seule tâche suffit pour démarrer.', 'Prends la plus courte, je regarde.'],
  going: ['{d}. La suivante ?', 'Ça avance bien.', 'Encore une, et je grignote un bambou.'],
  alldone: ['Tout est fait. Bravo !', 'Liste terminée. Sieste bien méritée.', 'Plus rien à faire. Profite !'],
};
const MILESTONES = {
  5: "Cinq aujourd'hui. Tu m'impressionnes.",
  10: "Dix ! Je n'ai jamais vu ça.",
  15: 'Quinze… je vais avoir besoin de plus de branches.',
};

let sceneKey = '';
function updateScene(line) {
  const done = doneToday();
  const pending = pendingIn().length;
  const h = new Date().getHours();
  const night = h >= 23 || h < 6;

  let state = 'going';
  if (pending === 0) state = done ? 'alldone' : 'empty';
  else if (night) state = 'night';
  else if (done === 0) state = 'fresh';

  panda.setMood(state === 'empty' || state === 'night' ? 'sleep' : state === 'alldone' ? 'happy' : 'idle');

  const key = `${state}|${done}|${pending}`;
  if (!line && key === sceneKey) return;
  sceneKey = key;
  const doneText = done === 1 ? 'Une de faite' : `${done} de faites`;
  panda.say(line || pick(LINES[state]).replace('{d}', doneText));
}

/* =========================================================================
   Les feuilles : une par tâche faite aujourd'hui, sur la branche
   ========================================================================= */

const LEAF_SVG = '<svg viewBox="0 0 22 8"><path d="M0 4C6 -1 15 0 22 4 15 8 6 9 0 4z"/></svg>';
const MAX_LEAVES = 16;

function renderLeaves() {
  const box = $('leaves');
  const n = Math.min(doneToday(), MAX_LEAVES);
  while (box.children.length > n) box.lastChild.remove();
  for (let i = box.children.length; i < n; i++) {
    const leaf = document.createElement('span');
    leaf.className = 'leaf new';
    // Réparties le long de la branche, à droite du panda, une vers le haut, une vers le bas
    const x = 40 + ((i * 7) % MAX_LEAVES) * (56 / MAX_LEAVES);
    leaf.style.left = `${x}%`;
    leaf.style.setProperty('--r', i % 2 ? '28deg' : '-34deg');
    leaf.innerHTML = LEAF_SVG;
    leaf.addEventListener('animationend', () => leaf.classList.remove('new'), { once: true });
    box.appendChild(leaf);
  }
}

/* =========================================================================
   Pluie de feuilles quand une liste est terminée
   ========================================================================= */

const leafFall = (() => {
  const canvas = $('leaf-fall');
  const ctx = canvas.getContext('2d');
  const colors = ['#5f8f3e', '#77a653', '#4f7a33', '#9cc06f', '#c4532a'];
  let leaves = [];
  let running = false;

  function resize() {
    const r = window.devicePixelRatio || 1;
    canvas.width = innerWidth * r;
    canvas.height = innerHeight * r;
    ctx.setTransform(r, 0, 0, r, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    leaves = leaves.filter((l) => l.y < innerHeight + 20);
    for (const l of leaves) {
      l.t += 1;
      l.y += l.vy;
      l.x += Math.sin(l.t * l.freq + l.phase) * l.amp;
      l.rot = Math.sin(l.t * l.freq + l.phase) * 0.9 + l.tilt;
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.fillStyle = l.c;
      ctx.beginPath();
      ctx.moveTo(-l.s, 0);
      ctx.quadraticCurveTo(0, -l.s * 0.45, l.s, 0);
      ctx.quadraticCurveTo(0, l.s * 0.45, -l.s, 0);
      ctx.fill();
      ctx.restore();
    }
    if (leaves.length) requestAnimationFrame(tick);
    else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  return {
    shower() {
      if (reducedMotion) return;
      for (let i = 0; i < 34; i++) {
        leaves.push({
          x: Math.random() * innerWidth,
          y: -20 - Math.random() * innerHeight * 0.6,
          vy: 1.4 + Math.random() * 1.6,
          s: 7 + Math.random() * 6,
          t: 0,
          freq: 0.04 + Math.random() * 0.04,
          phase: Math.random() * 6.28,
          amp: 0.8 + Math.random() * 1.2,
          tilt: Math.random() * 6.28,
          rot: 0,
          c: pick(colors),
        });
      }
      if (!running) { running = true; requestAnimationFrame(tick); }
    },
  };
})();

/* =========================================================================
   Toast (annuler une suppression, messages du système)
   ========================================================================= */

let toastTimer = null;
function toast(message, action) {
  const el = $('toast');
  el.textContent = '';
  const span = document.createElement('span');
  span.textContent = message;
  el.appendChild(span);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.addEventListener('click', () => { action.run(); hideToast(); });
    el.appendChild(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 5000 : 2600);
}
function hideToast() { $('toast').classList.remove('show'); }

/* =========================================================================
   Affichage
   ========================================================================= */

const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M5.5 12.5l4 4 9-9.5"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';

let doneOpen = false;
let editingList = null; // id de la liste en cours de renommage, ou 'new'
let enteringId = null;  // tâche qui vient d'être ajoutée (seule à s'animer)

function render() {
  $('date').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  renderLists();
  renderTasks();
  renderFooter();
  renderLeaves();
  updateScene();
}

function renderLists() {
  const nav = $('lists');
  nav.innerHTML = '';
  for (const list of data.lists) {
    const editing = editingList === list.id;
    const tab = document.createElement(editing ? 'span' : 'button');
    tab.className = 'tab' + (list.id === data.currentList ? ' active' : '');
    tab.dataset.list = list.id;
    if (editing) {
      tab.appendChild(listInput(list.name, (name) => { if (name) list.name = name; }));
    } else {
      tab.textContent = list.name;
      const n = pendingIn(list.id).length;
      if (n) {
        const c = document.createElement('span');
        c.className = 'count';
        c.textContent = n;
        tab.appendChild(c);
      }
      tab.title = 'Double-clic pour renommer, clic droit pour supprimer';
    }
    nav.appendChild(tab);
  }
  const add = document.createElement(editingList === 'new' ? 'span' : 'button');
  add.className = 'tab add-list';
  add.dataset.action = 'new-list';
  if (editingList === 'new') {
    add.appendChild(listInput('', (name) => {
      if (!name) return;
      const list = { id: uid(), name };
      data.lists.push(list);
      data.currentList = list.id;
    }));
  } else {
    add.textContent = '+ Nouvelle liste';
  }
  nav.appendChild(add);
  const input = nav.querySelector('input');
  if (input) { input.focus(); input.select(); }
}

function listInput(value, onCommit) {
  const input = document.createElement('input');
  input.value = value;
  input.maxLength = 30;
  input.placeholder = 'Nom de la liste';
  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (commit) onCommit(input.value.trim());
    editingList = null;
    save();
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  return input;
}

function taskElement(t) {
  const li = document.createElement('li');
  li.className = 'task' + (t.done ? ' done' : '') + (t.focus && !t.done ? ' focus' : '');
  if (t.id === enteringId) li.classList.add('entering');
  li.dataset.id = t.id;

  const check = document.createElement('button');
  check.className = 'check';
  check.dataset.action = 'toggle';
  check.setAttribute('aria-label', t.done ? 'Remettre à faire' : 'Marquer comme faite');
  check.innerHTML = ICON_CHECK;

  const body = document.createElement('div');
  body.className = 'text-wrap';
  if (t.focus && !t.done) {
    const label = document.createElement('span');
    label.className = 'focus-label';
    label.textContent = 'Priorité du jour';
    body.appendChild(label);
  }
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = t.text;
  if (!t.done) text.title = 'Double-clic pour modifier';
  body.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'task-actions';
  if (!t.done) {
    const star = document.createElement('button');
    star.className = 'mini star';
    star.dataset.action = 'focus';
    star.title = t.focus ? 'Retirer la priorité du jour' : 'En faire la priorité du jour';
    star.setAttribute('aria-label', star.title);
    star.innerHTML = ICON_STAR;
    actions.appendChild(star);
  }
  const del = document.createElement('button');
  del.className = 'mini del';
  del.dataset.action = 'delete';
  del.title = 'Supprimer';
  del.setAttribute('aria-label', 'Supprimer la tâche');
  del.innerHTML = ICON_TRASH;
  actions.appendChild(del);

  li.append(check, body, actions);
  return li;
}

function renderTasks() {
  const listId = data.currentList;
  const today = todayKey();
  const pending = data.tasks
    .filter((t) => t.listId === listId && !t.done)
    .sort((a, b) => (b.focus ? 1 : 0) - (a.focus ? 1 : 0));
  const done = data.tasks.filter((t) => t.listId === listId && t.done && t.doneAt === today);

  const ul = $('tasks');
  ul.innerHTML = '';
  pending.forEach((t) => ul.appendChild(taskElement(t)));
  enteringId = null;

  const empty = $('empty');
  empty.hidden = pending.length > 0;
  empty.textContent = done.length
    ? 'Tout est fait dans cette liste.'
    : 'Cette liste est vide. Écris une tâche au-dessus et appuie sur Entrée.';

  const section = $('done-section');
  section.hidden = done.length === 0;
  section.open = doneOpen;
  $('done-label').textContent = `Fait aujourd'hui (${done.length})`;
  const dl = $('done-list');
  dl.innerHTML = '';
  done.forEach((t) => dl.appendChild(taskElement(t)));
}

function renderFooter() {
  // Total depuis lundi
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // lundi = 0
  let week = 0;
  for (let i = 0; i <= day; i++) {
    week += data.history[todayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i))] || 0;
  }
  $('week').innerHTML = week
    ? `<strong>${week}</strong> tâche${week > 1 ? 's' : ''} faite${week > 1 ? 's' : ''} cette semaine`
    : 'Nouvelle semaine';
}

/* =========================================================================
   Actions sur les tâches
   ========================================================================= */

function addTask(text) {
  text = text.trim();
  if (!text) return;
  const task = {
    id: uid(), text, listId: data.currentList,
    done: false, doneAt: null, focus: false, createdAt: todayKey(),
  };
  data.tasks.unshift(task);
  enteringId = task.id;
  sound.add();
  save();
  render();
}

function toggleTask(li) {
  const t = findTask(li.dataset.id);
  if (!t || li.classList.contains('completing')) return;
  const today = todayKey();

  if (t.done) {
    t.done = false;
    if (t.doneAt === today) data.history[today] = Math.max(0, (data.history[today] || 1) - 1);
    t.doneAt = null;
    sound.undo();
    save();
    render();
    return;
  }

  li.classList.add('completing');
  sound.check();
  panda.hop();

  setTimeout(() => {
    t.done = true;
    t.doneAt = today;
    t.focus = false;
    data.history[today] = (data.history[today] || 0) + 1;
    save();

    const count = data.history[today];
    const listDone = pendingIn(data.currentList).length === 0;
    if (listDone) {
      render();
      sound.win();
      panda.cheer();
      leafFall.shower();
      if (pendingIn().length > 0) updateScene('Une liste de terminée ! Il en reste dans les autres.');
    } else {
      render();
      if (MILESTONES[count]) updateScene(MILESTONES[count]);
    }
  }, 420);
}

function toggleFocus(li) {
  const t = findTask(li.dataset.id);
  if (!t) return;
  const was = t.focus;
  data.tasks.forEach((x) => { x.focus = false; });
  t.focus = !was;
  save();
  render();
  if (t.focus) updateScene(`Priorité du jour : « ${t.text} ». On s'y met ?`);
}

function deleteTask(li) {
  const index = data.tasks.findIndex((t) => t.id === li.dataset.id);
  if (index < 0) return;
  const [removed] = data.tasks.splice(index, 1);
  sound.remove();
  save();
  render();
  toast('Tâche supprimée', {
    label: 'Annuler',
    run: () => {
      data.tasks.splice(Math.min(index, data.tasks.length), 0, removed);
      save();
      render();
    },
  });
}

function editTask(textEl) {
  const li = textEl.closest('.task');
  const t = findTask(li.dataset.id);
  if (!t || t.done) return;
  const original = t.text;
  textEl.contentEditable = 'true';
  textEl.focus();
  const range = document.createRange();
  range.selectNodeContents(textEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    textEl.contentEditable = 'false';
    const value = textEl.textContent.replace(/\s+/g, ' ').trim();
    if (commit && value && value !== original) { t.text = value; save(); }
    if (commit && !value) { deleteTask(li); return; }
    render();
  };
  textEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { textEl.textContent = original; finish(false); }
    e.stopPropagation();
  });
  textEl.addEventListener('blur', () => finish(true), { once: true });
}

/* =========================================================================
   Réglages
   ========================================================================= */

function fillHours() {
  const start = $('s-start');
  const end = $('s-end');
  for (let h = 0; h <= 23; h++) start.add(new Option(`${h} h`, h));
  for (let h = 1; h <= 24; h++) end.add(new Option(h === 24 ? 'minuit' : `${h} h`, h));
}

function syncSettingsForm() {
  const s = data.settings;
  $('s-notif').value = s.notifPerDay;
  $('s-notif-out').textContent = s.notifPerDay === 0 ? 'aucun' : s.notifPerDay;
  $('s-start').value = s.startHour;
  $('s-end').value = s.endHour;
  $('s-sounds').checked = s.sounds;
  $('s-autostart').checked = s.autostart;
}

async function openSettings() {
  if (TAURI) {
    const enabled = await invoke('get_autostart').catch(() => null);
    if (typeof enabled === 'boolean') data.settings.autostart = enabled;
  }
  syncSettingsForm();
  $('settings').classList.add('open');
  $('settings').setAttribute('aria-hidden', 'false');
  $('scrim').classList.add('show');
  $('btn-close-settings').focus();
}

function closeSettings() {
  $('settings').classList.remove('open');
  $('settings').setAttribute('aria-hidden', 'true');
  $('scrim').classList.remove('show');
}

function bindSettings() {
  fillHours();
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-close-settings').addEventListener('click', closeSettings);
  $('scrim').addEventListener('click', closeSettings);

  $('s-notif').addEventListener('input', (e) => {
    data.settings.notifPerDay = Number(e.target.value);
    $('s-notif-out').textContent = data.settings.notifPerDay === 0 ? 'aucun' : data.settings.notifPerDay;
    save();
  });

  const hoursChanged = (changed) => {
    let start = Number($('s-start').value);
    let end = Number($('s-end').value);
    if (end <= start) {
      if (changed === 'start') end = Math.min(24, start + 1);
      else start = Math.max(0, end - 1);
    }
    data.settings.startHour = start;
    data.settings.endHour = end;
    syncSettingsForm();
    save();
  };
  $('s-start').addEventListener('change', () => hoursChanged('start'));
  $('s-end').addEventListener('change', () => hoursChanged('end'));

  $('s-sounds').addEventListener('change', (e) => {
    data.settings.sounds = e.target.checked;
    save();
    if (e.target.checked) sound.check();
  });

  $('s-autostart').addEventListener('change', async (e) => {
    data.settings.autostart = e.target.checked;
    save();
    if (TAURI) {
      try { await invoke('set_autostart', { enabled: e.target.checked }); }
      catch (err) { toast("Le démarrage automatique n'a pas pu être modifié"); console.error(err); }
    }
  });

  $('btn-test').addEventListener('click', () => {
    if (TAURI) invoke('test_notification');
    else toast("Les rappels marchent dans l'appli installée");
  });

  $('btn-messages').addEventListener('click', () => {
    if (TAURI) invoke('open_messages').catch(() => toast("Le fichier des messages n'a pas pu s'ouvrir"));
    else toast("Disponible dans l'appli installée");
  });

  $('btn-quit').addEventListener('click', async () => {
    await save(true);
    invoke('quit_app');
  });

  $('btn-uninstall').addEventListener('click', async () => {
    if (!TAURI) { toast("Disponible dans l'appli installée"); return; }
    if (!window.confirm('Désinstaller Coche de ce PC ?')) return;
    await save(true);
    invoke('uninstall_app').catch((e) => toast(String(e)));
  });
}

/* =========================================================================
   Événements
   ========================================================================= */

function bindEvents() {
  const input = $('add-input');

  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addTask(input.value);
    input.value = '';
    input.focus();
  });
  input.addEventListener('focus', () => panda.look(true));
  input.addEventListener('blur', () => panda.look(false));

  $('content').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const li = btn.closest('.task');
    if (!li) return;
    if (btn.dataset.action === 'toggle') toggleTask(li);
    if (btn.dataset.action === 'focus') toggleFocus(li);
    if (btn.dataset.action === 'delete') deleteTask(li);
  });

  $('content').addEventListener('dblclick', (e) => {
    const text = e.target.closest('.text');
    if (text && text.closest('#tasks')) editTask(text);
  });

  $('done-section').addEventListener('toggle', (e) => { doneOpen = e.target.open; });

  const nav = $('lists');
  nav.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab || editingList) return;
    if (tab.dataset.action === 'new-list') { editingList = 'new'; renderLists(); return; }
    if (tab.dataset.list && tab.dataset.list !== data.currentList) {
      data.currentList = tab.dataset.list;
      save();
      render();
    }
  });
  nav.addEventListener('dblclick', (e) => {
    const tab = e.target.closest('.tab');
    if (tab && tab.dataset.list) { editingList = tab.dataset.list; renderLists(); }
  });
  nav.addEventListener('contextmenu', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab || !tab.dataset.list) return;
    e.preventDefault();
    if (data.lists.length < 2) { toast('Il faut garder au moins une liste'); return; }
    const list = data.lists.find((l) => l.id === tab.dataset.list);
    const n = data.tasks.filter((t) => t.listId === list.id).length;
    const msg = n
      ? `Supprimer la liste « ${list.name} » et ses ${n} tâche${n > 1 ? 's' : ''} ?`
      : `Supprimer la liste « ${list.name} » ?`;
    if (!window.confirm(msg)) return;
    data.lists = data.lists.filter((l) => l.id !== list.id);
    data.tasks = data.tasks.filter((t) => t.listId !== list.id);
    if (data.currentList === list.id) data.currentList = data.lists[0].id;
    save();
    render();
  });

  $('btn-hide').addEventListener('click', () => {
    if (TAURI) invoke('hide_window');
    else toast("Dans l'appli, Coche se range près de l'horloge");
  });

  // Taper n'importe où commence une nouvelle tâche ; Échap ferme les réglages
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSettings(); return; }
    const active = document.activeElement;
    const typing = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.isContentEditable);
    if (!typing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if ($('settings').classList.contains('open')) return;
      input.focus();
    }
  });

  // Mises à jour : le côté Rust prévient quand une nouvelle version est publiée
  if (TAURI) {
    const showUpdate = (version) => {
      if (!version) return;
      $('update-text').textContent = `Coche ${version} est disponible.`;
      $('update-bar').hidden = false;
    };
    TAURI.event.listen('update-available', (e) => showUpdate(e.payload));
    invoke('get_pending_update').then(showUpdate).catch(() => {});
    $('btn-update').addEventListener('click', async () => {
      const btn = $('btn-update');
      btn.disabled = true;
      btn.textContent = 'Téléchargement…';
      await save(true);
      try {
        await invoke('install_update');
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.textContent = 'Réessayer';
        toast("La mise à jour n'a pas pu être installée. Vérifie la connexion internet.");
      }
    });
  }

  // Raccourci global Ctrl+Alt+H (envoyé par le côté Rust)
  if (TAURI) {
    TAURI.event.listen('quick-add', () => {
      closeSettings();
      input.focus();
      input.select();
    });
  }

  // Si le PC reste allumé : nouveau jour, et le panda suit l'heure (sieste la nuit)
  setInterval(() => {
    const now = todayKey();
    if (now !== currentDay) {
      currentDay = now;
      normalize();
      sceneKey = '';
      save();
      render();
    } else {
      updateScene();
    }
  }, 60_000);

  // Bloque le menu clic droit du navigateur (sauf dans les champs de texte)
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('input, [contenteditable="true"]')) e.preventDefault();
  });
}

/* =========================================================================
   Démarrage
   ========================================================================= */

(async function start() {
  await load();
  bindSettings();
  bindEvents();
  render();
  setTimeout(() => $('add-input').focus(), 50);
})();
