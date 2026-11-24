/* Gate — client-side, because this build runs on GitHub Pages.
   The key is compared as a SHA-256 hash, never as plain text, but the hash itself
   is in this file: four digits are 10,000 guesses. It is a door, not a vault. */
(() => {
  const KEYS = {
    games: '255afccc8af662895c98741bca9fb9213750b070d1c945061edf6bb6270b6a74',
    insta: '3f46bdea034f311a14efe877f5592d84a7a6c97d9b917be3f55573311e6cdda7'
  };
  const ROOM_KEY = 'sv.room';
  const MAX = 4;

  const dots = [...document.querySelectorAll('#dots i')];
  const dotsBox = document.getElementById('dots');
  const msg = document.getElementById('keymsg');
  const sub = document.getElementById('gateSub');
  const keypad = document.getElementById('keypad');
  const foot = document.getElementById('gateFoot');

  let buf = '';
  let busy = false;

  const goBtn = keypad.querySelector('.fn.go');

  function paint() {
    dots.forEach((d, i) => d.classList.toggle('on', i < buf.length));
    dotsBox.classList.remove('bad');
    goBtn.dataset.ready = buf.length === MAX ? '1' : '0';
  }

  function say(text, ok) {
    msg.textContent = text || '';
    msg.classList.toggle('ok', !!ok);
  }

  function fail(text) {
    dotsBox.classList.add('bad');
    say(text);
    setTimeout(() => { buf = ''; paint(); }, 320);
  }

  async function digest(text) {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function submit() {
    if (busy || buf.length !== MAX) return;
    busy = true;
    say('');
    const h = await digest(buf);
    const room = Object.keys(KEYS).find((k) => KEYS[k] === h);
    if (!room) {
      busy = false;
      fail('That key opens nothing.');
      return;
    }
    sessionStorage.setItem(ROOM_KEY, room);
    if (room === 'games') {
      say('Games room open.', true);
      setTimeout(() => { location.href = 'games.html?v=8'; }, 260);
    } else {
      say('Instagram open.', true);
      setTimeout(() => { location.href = 'insta.html?v=8'; }, 260);
    }
  }

  function press(k) {
    if (busy) return;
    if (k === 'del') { buf = buf.slice(0, -1); paint(); say(''); return; }
    if (k === 'go') { submit(); return; }
    if (!/^\d$/.test(k)) return;
    if (buf.length >= MAX) return;
    buf += k;
    paint();
    say('');
    if (buf.length === MAX) setTimeout(submit, 140);
  }

  keypad.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-k]');
    if (b) press(b.dataset.k);
  });

  document.addEventListener('keydown', (ev) => {
    if (/^\d$/.test(ev.key)) press(ev.key);
    if (ev.key === 'Backspace') press('del');
    if (ev.key === 'Enter') press('go');
  });

  /* a room you already unlocked this session goes straight through */
  const open = sessionStorage.getItem(ROOM_KEY);
  if (open === 'games' || open === 'insta') {
    sub.textContent = `You are already in the ${open === 'games' ? 'games room' : 'Instagram room'}.`;
    foot.innerHTML = `<a href="${open === 'games' ? 'games.html' : 'insta.html'}?v=8">Continue →</a> · or enter the other key`;
  }

  paint();
})();
