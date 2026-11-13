// SVAVARS VR APP PoC — headset player.
// Plays one 360° video inside WebXR and obeys commands from Supabase.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { supabase, ensureSignedIn, presenceChannelName } from './supabase.js';
import { VIDEO_URL, STALE_AFTER_MS } from './config.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const statusEl = $('status');

let headset = null;          // row from public.headsets
let presence = null;         // realtime presence channel
let state = 'idle';          // idle | loading | playing | paused | error
let lastError = null;
const handled = new Set();   // command ids already processed
let queue = Promise.resolve();

// ---------- 3D scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
renderer.domElement.className = 'gl';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1100);

const geometry = new THREE.SphereGeometry(500, 64, 40);
geometry.scale(-1, 1, 1); // look at the inside of the sphere
const texture = new THREE.VideoTexture(video);
texture.colorSpace = THREE.SRGBColorSpace;
const material = new THREE.MeshBasicMaterial({ map: texture });
const sphere = new THREE.Mesh(geometry, material);
sphere.visible = false;
scene.add(sphere);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));

// ---------- Status reporting ----------
function setState(next, error = null) {
  state = next;
  lastError = error;
  statusEl.textContent = `Status: ${state}${error ? ` (${error})` : ''}`;
  reportPresence();
}

function reportPresence() {
  if (!presence) return;
  presence.track({
    role: 'headset',
    state,
    error: lastError,
    position_s: Math.round(video.currentTime || 0),
    in_vr: renderer.xr.isPresenting,
    at: new Date().toISOString(),
  });
}
setInterval(reportPresence, 5000); // keeps the playback position fresh on the phone

// ---------- Commands ----------
async function mark(id, fields) {
  const { error } = await supabase.from('headset_commands').update(fields).eq('id', id);
  if (error) console.error('Could not update command', id, error);
}

function enqueue(cmd) {
  queue = queue.then(() => handle(cmd)).catch((e) => console.error(e));
}

async function handle(cmd) {
  if (handled.has(cmd.id) || cmd.status !== 'requested') return;
  handled.add(cmd.id);

  if (Date.now() - Date.parse(cmd.created_at) > STALE_AFTER_MS) {
    await mark(cmd.id, { status: 'failed', error: 'stale', done_at: new Date().toISOString() });
    return;
  }
  await mark(cmd.id, { status: 'received', received_at: new Date().toISOString() });

  try {
    await act(cmd);
    await mark(cmd.id, {
      status: 'done',
      position_s: video.currentTime || 0,
      done_at: new Date().toISOString(),
    });
  } catch (e) {
    setState('error', e.message);
    await mark(cmd.id, { status: 'failed', error: String(e.message || e), done_at: new Date().toISOString() });
  }
}

async function act(cmd) {
  switch (cmd.type) {
    case 'play': {
      if (!renderer.xr.isPresenting) throw new Error('not in VR: carer must tap Start');
      setState('loading');
      if (cmd.position_s != null) video.currentTime = Number(cmd.position_s);
      else video.currentTime = 0;
      await video.play();
      sphere.visible = true;
      setState('playing');
      break;
    }
    case 'pause':
      video.pause();
      setState('paused');
      break;
    case 'resume':
      if (!renderer.xr.isPresenting) throw new Error('not in VR: carer must tap Start');
      await video.play();
      sphere.visible = true;
      setState('playing');
      break;
    case 'stop':
      video.pause();
      video.currentTime = 0;
      sphere.visible = false;
      setState('idle');
      break;
    case 'recenter':
      recenter();
      break;
    default:
      throw new Error(`unknown command ${cmd.type}`);
  }
}

// Turn the video so wherever the resident is looking becomes "forward".
function recenter() {
  const xrCam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const dir = new THREE.Vector3();
  xrCam.getWorldDirection(dir);
  const yaw = Math.atan2(-dir.x, -dir.z);
  sphere.rotation.y = yaw;
}

// Pick up anything requested while we were offline (stale ones get marked failed).
async function catchUp() {
  const since = new Date(Date.now() - STALE_AFTER_MS * 2).toISOString();
  const { data, error } = await supabase
    .from('headset_commands')
    .select('*')
    .eq('headset_id', headset.id)
    .eq('status', 'requested')
    .gte('created_at', since)
    .order('created_at');
  if (error) return console.error(error);
  data.forEach(enqueue);
}

function listen() {
  supabase
    .channel(`commands:${headset.id}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'headset_commands', filter: `headset_id=eq.${headset.id}` },
      (payload) => enqueue(payload.new))
    .subscribe((s) => {
      if (s === 'SUBSCRIBED') catchUp();
    });

  presence = supabase.channel(presenceChannelName(headset.id), {
    config: { presence: { key: 'headset' } },
  });
  presence.subscribe((s) => {
    if (s === 'SUBSCRIBED') {
      statusEl.textContent = `Status: ${state} · online`;
      reportPresence();
    } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
      statusEl.textContent = 'Reconnecting…';
    }
  });
}

// ---------- Start (the carer's one tap) ----------
$('start').addEventListener('click', async () => {
  if (!navigator.xr || !(await navigator.xr.isSessionSupported('immersive-vr'))) {
    statusEl.textContent = 'This browser cannot enter VR. Open the page in the Meta Quest Browser.';
    return;
  }
  // Unlock audio + video playback with this tap, so later remote commands may play.
  try {
    video.muted = false;
    await video.play();
    video.pause();
    video.currentTime = 0;
  } catch (e) {
    console.warn('Video unlock failed', e);
  }
  const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
  await renderer.xr.setSession(session);
  reportPresence();
  session.addEventListener('end', () => {
    video.pause();
    sphere.visible = false;
    setState('idle', 'left VR');
  });
});

// Headset taken off / page hidden: report it, then report again on return.
document.addEventListener('visibilitychange', reportPresence);

// ---------- Boot ----------
video.src = VIDEO_URL;
video.addEventListener('error', () => setState('error', 'video could not load'));
video.loop = true; // the sample clip is only a few seconds long
video.addEventListener('ended', () => { sphere.visible = false; setState('idle'); });

ensureSignedIn($('login'), async (session) => {
  const { data, error } = await supabase
    .from('headsets')
    .select('*')
    .eq('device_user_id', session.user.id)
    .is('revoked_at', null)
    .maybeSingle();
  if (error || !data) {
    $('login').hidden = false;
    $('login').querySelector('.msg').textContent = 'This login is not linked to a headset.';
    return;
  }
  headset = data;
  $('headset-name').textContent = headset.display_name;
  $('ready').hidden = false;
  listen();
});
