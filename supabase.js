import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Simple email/password sign-in shared by both pages.
export async function ensureSignedIn(form, onReady) {
  const { data } = await supabase.auth.getSession();
  if (data.session) return onReady(data.session);
  form.hidden = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.querySelector('[name=email]').value.trim();
    const password = form.querySelector('[name=password]').value;
    const msg = form.querySelector('.msg');
    msg.textContent = 'Signing in…';
    const { data: res, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { msg.textContent = error.message; return; }
    form.hidden = true;
    onReady(res.session);
  });
}

export const presenceChannelName = (headsetId) => `headset-presence:${headsetId}`;
