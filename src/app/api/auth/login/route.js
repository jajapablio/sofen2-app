import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../../../../lib/supabase/admin';

const invalidCredentials = () => Response.json({ error: 'Invalid username/email or password.' }, { status: 401 });

export async function POST(request) {
    try {
        const body = await request.json();
        const identifier = String(body.identifier || '').trim();
        const password = String(body.password || '');
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!identifier || !password || !supabaseUrl || !anonKey) {
            return Response.json({ error: 'Enter your username or email and password.' }, { status: 400 });
        }

        let email = identifier.toLowerCase();
        if (!email.includes('@')) {
            const admin = getSupabaseAdminClient();
            const { data: profile, error: profileError } = await admin
                .from('profiles')
                .select('id')
                .eq('username', identifier.toLowerCase())
                .maybeSingle();
            if (profileError || !profile) return invalidCredentials();

            const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
            if (userError || !userData.user?.email) return invalidCredentials();
            email = userData.user.email;
        }

        const supabase = createClient(supabaseUrl, anonKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error || !data.session) return invalidCredentials();

        const admin = getSupabaseAdminClient();
        const { data: profile, error: profileError } = await admin
            .from('profiles')
            .select('id, username, role, store_id, global_access')
            .eq('id', data.user.id)
            .maybeSingle();
        if (profileError) throw profileError;

        if (profile?.username && profile.role === 'admin') {
            const { data: storeAudits, error: auditError } = await admin
                .from('audit_logs')
                .select('store_id, after_data, changed_at')
                .eq('entity_table', 'stores')
                .eq('action', 'create')
            .eq('after_data->>owner_username', profile.username.toLowerCase())
                .order('changed_at', { ascending: false })
                .limit(20);
            if (auditError) throw auditError;

            const ownerAudit = storeAudits?.find((audit) => (
                String(audit.after_data?.owner_username || '').toLowerCase() === profile.username.toLowerCase()
            ));
            const ownerStoreId = ownerAudit?.store_id || (
                data.user.user_metadata?.account_type === 'store_owner' ? profile.store_id : null
            );
            if (ownerStoreId) {
                const { error: updateError } = await admin
                    .from('profiles')
                    .update({ role: 'admin', store_id: ownerStoreId, global_access: true })
                    .eq('id', data.user.id);
                if (updateError) throw updateError;
            }
        }

        return Response.json({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
        });
    } catch (error) {
        return Response.json({ error: error.message || 'Unable to sign in.' }, { status: 500 });
    }
}
