/* Games room — one table, full screen. */
import { initSetupRush } from './setuprush.js?v=4';

const el = (id) => document.getElementById(id);
const ROOM_KEY = 'sv.room';

/* client-side guard: this build has no server, so the check lives here */
if (sessionStorage.getItem(ROOM_KEY) !== 'games') {
  location.replace('index.html');
}

const toastEl = el('toast');
let toastTimer = null;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2200);
}

const rush = initSetupRush({ toast });
rush.startWith('pro');

el('toast');
el('lock').addEventListener('click', () => sessionStorage.removeItem(ROOM_KEY));
el('toInsta').addEventListener('click', () => {
  if (sessionStorage.getItem('sv.room') === 'insta') location.href = 'insta.html';
  else {
    sessionStorage.removeItem(ROOM_KEY);
    sessionStorage.setItem('sv.next', 'insta');
    location.href = 'index.html';
  }
});

window.addEventListener('pageshow', (ev) => {
  if (ev.persisted) rush.show();
});
