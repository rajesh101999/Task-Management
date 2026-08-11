// reset-password — lets a Manager or Admin set a new password for one of
// their people. This can only happen server-side: Supabase Auth only lets
// an account change its *own* password from browser code (see updateUser
// in js/auth.js) — changing someone else's requires the service_role key,
// which must never be shipped to the browser. This function holds that key
// instead, and is the one place it's allowed to exist.
//
// Deploy via the Supabase dashboard: Edge Functions > Deploy a new function
// > name it exactly "reset-password" > paste this file's contents > Deploy.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are supplied
// automatically by the Edge Functions runtime — nothing to configure.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    if (!token) return json({ error: 'Not authenticated.' }, 401);

    const { userId, newPassword } = await req.json();
    if (!userId || !newPassword || String(newPassword).length < 6) {
      return json({ error: 'A userId and a password of at least 6 characters are required.' }, 400);
    }

    // Acts as the caller (their own access token, so their own RLS applies)
    // — used only to find out who they are and what they're allowed to see.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json({ error: 'Not authenticated.' }, 401);

    const { data: callerProfile } = await callerClient.from('profiles').select('role').eq('id', caller.id).single();
    if (!callerProfile || !['Admin', 'Manager'].includes(callerProfile.role)) {
      return json({ error: 'Only a Manager or Admin can reset a password.' }, 403);
    }

    // Authorization check, piggy-backing on the profiles RLS policy instead
    // of duplicating it: Admin can select any profile, a Manager only their
    // own team's (plus themselves). If this select comes back empty, the
    // caller has no business touching that account.
    const { data: target } = await callerClient.from('profiles').select('id').eq('id', userId).single();
    if (!target) return json({ error: "You don't have access to that account." }, 403);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword });
    if (updateErr) return json({ error: updateErr.message }, 400);

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error.' }, 500);
  }
});
