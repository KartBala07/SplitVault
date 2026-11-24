/* Instagram, inside the app. Real embed pages only — instagram.com itself is
   x-frame-options: DENY, and a static host cannot proxy around that. */
(() => {
  const ROOM_KEY = 'sv.room';
  if (sessionStorage.getItem(ROOM_KEY) !== 'insta') { location.replace('index.html?v=7'); return; }

  const HANDLE_KEY = 'sv.ig.handle';
  const LAST_KEY = 'sv.ig.last';
  const BLOCKED = new Set(['explore', 'accounts', 'direct', 'stories', 'reels', 'about', 'legal', 'developer', 'emails']);

  const frame = document.getElementById('igFrame');
  const note = document.getElementById('note');
  const noteTitle = document.getElementById('noteTitle');
  const noteBody = document.getElementById('noteBody');
  const noteAction = document.getElementById('noteAction');
  const handle = document.getElementById('handle');
  const goBtn = document.getElementById('go');
  const dockProfile = document.getElementById('dockProfile');
  const dockPost = document.getElementById('dockPost');
  const dockOpen = document.getElementById('dockOpen');
  const toastEl = document.getElementById('toast');

  let toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2400);
  }

  const clean = (h) => String(h || '').trim().replace(/^@+/, '').replace(/\/+$/, '');
  const savedHandle = () => clean(localStorage.getItem(HANDLE_KEY) || '');
  const last = () => {
    try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; }
  };

  function showNote(title, body, actionUrl, glyph) {
    note.hidden = false;
    note.querySelector('.glyph').textContent = glyph || '◎';
    noteTitle.textContent = title;
    noteBody.textContent = body;
    if (actionUrl) {
      noteAction.hidden = false;
      noteAction.onclick = () => window.open(actionUrl, '_blank', 'noopener');
    } else {
      noteAction.hidden = true;
    }
  }
  const hideNote = () => { note.hidden = true; };

  let loadTimer = null;
  function load(url, actionUrl) {
    hideNote();
    frame.classList.add('loading');
    frame.src = url;
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      frame.classList.remove('loading');
      showNote('Nothing on screen?', 'That page may be private or renamed. Open it on Instagram to check.', actionUrl || url, '⌛');
    }, 8000);
    frame.onload = () => {
      clearTimeout(loadTimer);
      frame.classList.remove('loading');
      hideNote();
    };
  }

  const profileEmbed = (h) => `https://www.instagram.com/${encodeURIComponent(h)}/embed/`;
  const postEmbed = (kind, code) => `https://www.instagram.com/${kind}/${encodeURIComponent(code)}/embed/`;

  function loadProfile(raw) {
    const h = clean(raw);
    if (!h) { showNote('Type a handle', 'Enter @yourhandle to open that profile here.', null, '@'); return false; }
    if (BLOCKED.has(h.toLowerCase())) return blockedNotice(h);
    localStorage.setItem(HANDLE_KEY, h);
    localStorage.setItem(LAST_KEY, JSON.stringify({ type: 'profile', handle: h }));
    handle.value = '@' + h;
    load(profileEmbed(h), `https://www.instagram.com/${h}/`);
    return true;
  }

  function loadPost(kind, code) {
    localStorage.setItem(LAST_KEY, JSON.stringify({ type: 'post', kind, code }));
    load(postEmbed(kind, code), `https://www.instagram.com/${kind}/${code}/`);
    return true;
  }

  function blockedNotice(path) {
    const url = 'https://www.instagram.com' + (path.startsWith('/') ? path : '/' + path);
    showNote('That page needs a login', 'The signed-in feed, Explore, DMs and Stories are sent with x-frame-options: DENY, so no site can show them in place.', url, '🔒');
    return false;
  }

  function parse(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const urlMatch = raw.match(/instagram\.com\/(?:([A-Za-z0-9._]+)\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
    if (urlMatch) {
      const kind = urlMatch[2].toLowerCase();
      if (kind === 'reels') return { blocked: '/reels/' };
      return { kind, code: urlMatch[3] };
    }
    const pathMatch = raw.match(/instagram\.com\/([A-Za-z0-9._\/-]*)/i);
    if (pathMatch) {
      const path = (pathMatch[1] || '').replace(/\/+$/, '');
      if (!path) return { handle: savedHandle() || 'instagram' };
      if (BLOCKED.has(path.toLowerCase()) || BLOCKED.has(path.split('/')[0].toLowerCase())) return { blocked: '/' + path };
      return { handle: path.split('/')[0] };
    }
    if (/^(p|reel|tv)\/[A-Za-z0-9_-]+$/i.test(raw)) {
      const [kind, code] = raw.split('/');
      return { kind, code };
    }
    const h = clean(raw);
    if (!h) return null;
    if (BLOCKED.has(h.toLowerCase())) return { blocked: '/' + h };
    return { handle: h };
  }

  function go(raw) {
    const p = parse(raw);
    if (!p) { showNote('Type a handle', 'Enter @yourhandle to open that profile here.', null, '@'); return; }
    if (p.blocked) { blockedNotice(p.blocked); return; }
    if (p.code) loadPost(p.kind, p.code);
    else loadProfile(p.handle);
  }

  document.getElementById('go').addEventListener('click', () => go(handle.value));
  handle.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); handle.blur(); go(handle.value); }
  });

  dockProfile.addEventListener('click', () => go(savedHandle() || handle.value || 'instagram'));
  dockPost.addEventListener('click', () => {
    const l = last();
    if (l && l.type === 'post') loadPost(l.kind, l.code);
    else showNote('No post loaded', 'Paste a post or reel link in the bar above.', null, '▣');
  });
  dockOpen.addEventListener('click', (ev) => {
    ev.preventDefault();
    const url = frame.src && frame.src !== 'about:blank' && frame.src !== ''
      ? frame.src.replace('/embed/', '/')
      : 'https://www.instagram.com/';
    window.open(url, '_blank', 'noopener');
  });
  document.getElementById('toGames').addEventListener('click', () => {
    sessionStorage.setItem('sv.room', 'games');
  });
  document.getElementById('lock').addEventListener('click', () => sessionStorage.removeItem(ROOM_KEY));

  window.__insta = { go, loadProfile, loadPost, src: () => frame.src, note: () => noteTitle.textContent, visible: () => !note.hidden };

  /* boot: last handle, else the last post, else a prompt */
  handle.value = savedHandle() ? '@' + savedHandle() : '';
  const l = last();
  if (savedHandle()) loadProfile(savedHandle());
  else if (l && l.type === 'post') loadPost(l.kind, l.code);
  else loadProfile('instagram'); /* open with something real on screen */
})();
