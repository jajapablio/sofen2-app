import { getSupabaseAdminClient } from '../../../../lib/supabase/admin';

const usernamePattern = /^[a-zA-Z0-9._-]{3,24}$/;

export async function GET() {
    return Response.json({ enabled: true });
}

export async function POST(request) {
    let userId;

    try {
        const body = await request.json();
        const fullName = String(body.fullName || '').trim();
        const username = String(body.username || '').trim().toLowerCase();
        const storeName = String(body.storeName || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');

        if (!fullName || !storeName || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !usernamePattern.test(username)) {
            return Response.json({ error: 'Enter a name, username (3-24 letters/numbers/._-), store, valid email, and password of at least 8 characters.' }, { status: 400 });
        }

        const supabase = getSupabaseAdminClient();
        const { data: userData, error: userError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName, username, account_type: 'store_owner' },
        });
        if (userError) throw userError;
        userId = userData.user.id;

        const { data: storeId, error: provisionError } = await supabase.rpc('register_store_owner', {
            p_user_id: userId,
            p_full_name: fullName,
            p_username: username,
            p_store_name: storeName,
        });
        if (provisionError) throw provisionError;

        const { error: profileError } = await supabase.from('profiles').upsert({
            id: userId,
            store_id: storeId,
            full_name: fullName,
            username,
            role: 'admin',
            global_access: true,
            is_active: true,
        });
        if (profileError) throw profileError;

        await supabase.from('audit_logs').insert({
            actor_id: userId,
            store_id: storeId,
            action: 'create',
            entity_table: 'stores',
            entity_id: storeId,
            after_data: { name: storeName, owner_username: username },
        });

        return Response.json({ storeId, message: 'Store and administrator account created. You can now sign in.' }, { status: 201 });
    } catch (error) {
        if (userId) {
            try {
                await getSupabaseAdminClient().auth.admin.deleteUser(userId);
            } catch {
                // Keep the original setup error for the response.
            }
        }

        return Response.json({ error: error.message || 'Unable to create the administrator account.' }, { status: 400 });
    }
}
