// SVAVARS VR APP PoC — carer control page.
// Sends commands as database rows and shows only what the headset confirmed.
import { supabase, ensureSignedIn, presenceChannelName } from './supabase.js';

const $ = (id) => document.getElementById(id);
let headsetId = null;
let channels = [];
const rows = new Map(); // command id -> row

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function render() {
  const list = [...rows.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 15);
  $('log').innerHTML = list.map((r) => {
    const ms = r.done_at ? Date.parse(r.done_at) - Date.parse(r.created_at) : '';
    const err = r.error ? ` (${r.error})` : '';
    return `<tr class="s-${r.status}"><td>${fmtTime(r.created_at)}</td><td>${r.type}</td><td>${r.status}${err}</td><td>${ms}</td></tr>`;
  }).join('');
}

function setOnline(meta) {
  const on = !!meta;
  $('dot').className = `dot ${on ? 'on' : 'off'}`;
  $('online').textContent = on ? (meta.in_vr ? 'Online, in VR' : 'Online, waiting for Start') : 'Offline';
  $('state').textContent = on ? `${meta.state}${meta.error ? ` (${meta.error})` : ''} · ${meta.position_s}s` : '–';
}

async function watch(id) {
  channels.forEach((c) => supabase.removeChannel(c));
  channels = [];
  rows.clear();
  headsetId = id;
  setOnline(null);

  const { data } = await supabase
    .from('headset_commands').select('*')
    .eq('headset_id', id).order('created_at', { ascending: false }).limit(15);
  (data || []).forEach((r) => rows.set(r.id, r));
  render();

  channels.push(supabase
    .channel(`carer-commands:${id}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'headset_commands', filter: `headset_id=eq.${id}` },
      (p) => { if (p.new?.id) { rows.set(p.new.id, p.new); render(); } })
    .subscribe());

  const presence = supabase.channel(presenceChannelName(id), {
    config: { presence: { key: `carer-${crypto.randomUUID()}` } },
  });
  presence.on('presence', { event: 'sync' }, () => {
    const metas = presence.presenceState().headset;
    setOnline(metas && metas.length ? metas[metas.length - 1] : null);
  });
  presence.subscribe();
  channels.push(presence);
}

async function send(type) {
  if (!headsetId) return;
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('headset_commands')
    .insert({ headset_id: headsetId, type, issued_by: user.id })
    .select().single();
  if (error) { alertRow(type, error.message); return; }
  rows.set(data.id, data);
  render();
}

function alertRow(type, message) {
  const id = `local-${Date.now()}`;
  rows.set(id, { id, type, status: 'failed', error: message, created_at: new Date().toISOString() });
  render();
}

document.querySelectorAll('[data-cmd]').forEach((b) =>
  b.addEventListener('click', () => send(b.dataset.cmd)));
$('headset').addEventListener('change', (e) => watch(e.target.value));
$('signout').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });

ensureSignedIn($('login'), async () => {
  const { data, error } = await supabase.from('headsets').select('id, display_name').is('revoked_at', null).order('display_name');
  if (error || !data?.length) {
    $('login').hidden = false;
    $('login').querySelector('.msg').textContent = 'No headsets for this login.';
    return;
  }
  $('headset').innerHTML = data.map((h) => `<option value="${h.id}">${h.display_name.replace(/</g, '&lt;')}</option>`).join('');
  $('panel').hidden = false;
  watch(data[0].id);
});
