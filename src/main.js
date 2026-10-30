// Harness wiring. Everything here is scaffolding around the two pieces that
// matter — ScaleDirector and Hud — plus the debug affordance that makes them
// workable: a slider that jumps to any scale without playing the film.

import { ScaleDirector, S_MIN, S_MAX } from './scale-director.js';
import { Hud } from './hud.js';
import { Stage } from './stage.js';
import { createRegistry } from './registry.js';
import { createDiagnosticDecade } from './decades.js';
import { starsBand } from './bands/stars.js';
import { galacticFieldBand } from './bands/galactic-field.js';
import { galaxyBand } from './bands/galaxy.js';
import { localGroupBand } from './bands/local-group.js';
import { cosmicWebBand } from './bands/cosmic-web.js';
import { tissueBand } from './bands/tissue.js';
import { cellBand } from './bands/cell.js';
import { moleculeBand } from './bands/molecule.js';
import { atomBand } from './bands/atom.js';
import { nucleusBand } from './bands/nucleus.js';
import { formatClock } from './format.js';
import { AudioDirector } from './audio.js';

// Playback is anchored to a clock rather than to accumulated frame deltas, so
// that it cannot drift over a seven-minute run. Before audio starts there is
// nothing to drift against and rAF time will do; once the audio context exists
// it becomes the reference, and `director.rebase` moves the anchor across
// without the playhead jumping by the difference between the two.
let clock = () => performance.now() / 1000;

const audio = new AudioDirector();

async function startAudio() {
  if (audio.started) return;
  await audio.start();
  clock = () => audio.currentTime;
  director.rebase(clock());
  ui.sound.textContent = audio.muted ? 'Sound off' : 'Sound on';
}

const mount = document.getElementById('stage');
const director = new ScaleDirector();

// Real bands go here; every level they do not claim falls back to diagnostic
// content, so the harness stays usable across all 41 decades while the real
// content is filled in band by band.
const registry = createRegistry([
  nucleusBand(), atomBand(), moleculeBand(), cellBand(), tissueBand(),
  starsBand(), galacticFieldBand(), galaxyBand(), localGroupBand(),
  cosmicWebBand(23), cosmicWebBand(24),
], createDiagnosticDecade);

const stage = new Stage(mount, registry);
const hud = new Hud(mount);

const el = (id) => document.getElementById(id);
const ui = {
  play: el('play'), reset: el('reset'),
  time: el('time-range'), timeOut: el('time-out'),
  scale: el('scale-range'), scaleOut: el('scale-out'),
  decDown: el('dec-down'), decUp: el('dec-up'),
  toggleHud: el('toggle-hud'), liveOut: el('live-out'),
  sound: el('sound'), film: el('film'), controls: el('controls'),
};

ui.time.max = String(director.duration);
ui.scale.min = String(S_MIN);
ui.scale.max = String(S_MAX);

let hudVisible = true;
let dragging = null; // which slider the user currently owns

for (const [key, input] of [['time', ui.time], ['scale', ui.scale]]) {
  input.addEventListener('pointerdown', () => { dragging = key; });
  input.addEventListener('pointerup', () => { dragging = null; });
  input.addEventListener('pointercancel', () => { dragging = null; });
  input.addEventListener('blur', () => { if (dragging === key) dragging = null; });
}

ui.time.addEventListener('input', () => director.setTime(Number(ui.time.value)));
ui.scale.addEventListener('input', () => director.setScale(Number(ui.scale.value)));
// Browsers only allow audio to start from a gesture, so pressing play is it.
ui.play.addEventListener('click', async () => {
  await startAudio();
  director.toggle(clock());
});

ui.sound.addEventListener('click', async () => {
  if (!audio.started) { await startAudio(); return; }
  audio.setMuted(!audio.muted);
  ui.sound.textContent = audio.muted ? 'Sound off' : 'Sound on';
});
ui.reset.addEventListener('click', () => director.reset());
ui.decDown.addEventListener('click', () => director.stepDecade(-1));
ui.decUp.addEventListener('click', () => director.stepDecade(1));
ui.film.addEventListener('click', () => {
  stage.post.setEnabled(!stage.post.enabled);
  ui.film.textContent = stage.post.enabled ? 'Film' : 'Film off';
});

ui.toggleHud.addEventListener('click', () => {
  hudVisible = !hudVisible;
  hud.setVisible(hudVisible);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.key !== 'Escape') return;
  const nudge = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case ' ': e.preventDefault(); startAudio().then(() => director.toggle(clock())); break;
    case 'm':
      if (audio.started) {
        audio.setMuted(!audio.muted);
        ui.sound.textContent = audio.muted ? 'Sound off' : 'Sound on';
      }
      break;
    case 'ArrowRight': e.preventDefault(); director.setTime(director.time + nudge); break;
    case 'ArrowLeft': e.preventDefault(); director.setTime(director.time - nudge); break;
    case '[': director.stepDecade(-1); break;
    case ']': director.stepDecade(1); break;
    case 'r': director.reset(); break;
    case 'h': hudVisible = !hudVisible; hud.setVisible(hudVisible); break;
    case 'f':
      stage.post.setEnabled(!stage.post.enabled);
      ui.film.textContent = stage.post.enabled ? 'Film' : 'Film off';
      break;
    case 'c': ui.controls.classList.toggle('hidden'); break;
    default: return;
  }
});

director.onChange((d) => {
  ui.play.textContent = d.playing ? '❚❚ Pause' : '▶ Play';
});

// Deep-link a position for debugging and screenshots: #s=6.8 or #t=120.
const params = new URLSearchParams(location.hash.slice(1));
if (params.has('s')) director.setScale(Number(params.get('s')));
else if (params.has('t')) director.setTime(Number(params.get('t')));

function frame() {
  director.syncTo(clock());
  stage.sync(director);
  stage.render();
  hud.update(director);
  audio.update(director);

  // Mirror state into the controls, but never fight a slider being dragged.
  if (dragging !== 'time') ui.time.value = String(director.time);
  if (dragging !== 'scale') ui.scale.value = String(director.s);
  ui.timeOut.textContent = director.mode === 'free' ? '—' : formatClock(director.time);
  ui.scaleOut.textContent = director.s.toFixed(2);
  ui.liveOut.textContent = stage.loading ? 'loading…' : `${stage.liveCount} live`;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Handy from the console while tuning.
Object.assign(globalThis, { director, stage, hud, audio });
