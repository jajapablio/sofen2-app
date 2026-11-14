import { getSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const usernamePattern = /^[a-zA-Z0-9._-]{3,24}$/;
const scrypt = promisify(scryptCallback);

export async function POST(request) {
    try {
        const authorization = request.headers.get('authorization') || '';
        const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!token) return Response.json({ error: 'Sign in as an administrator to continue.' }, { status: 401 });

        const supabase = getSupabaseAdminClient();
        const { data: authData, error: authError } = await supabase.auth.getUser(token);
        if (authError || !authData.user) {
            return Response.json({ error: 'Your session is invalid. Sign in again.' }, { status: 401 });
        }

        const { data: adminProfile, error: profileError } = await supabase
            .from('profiles')
            .select('role, store_id, is_active')
            .eq('id', authData.user.id)
            .maybeSingle();
        if (profileError) throw profileError;
        if (adminProfile?.role !== 'admin' || !adminProfile.is_active || !adminProfile.store_id) {
            return Response.json({ error: 'Only an active administrator can add employees.' }, { status: 403 });
        }

        const body = await request.json();
        const fullName = String(body.fullName || '').trim();
        const username = String(body.username || '').trim().toLowerCase();
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const role = String(body.role || '');
        const storeId = adminProfile.store_id;
        const pin = String(body.pin || '');

        if (!fullName || !usernamePattern.test(username) || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !['cashier', 'manager'].includes(role) || !/^\d{4}$/.test(pin)) {
            return Response.json({ error: 'Enter a name, valid username/email, password of at least 8 characters, a four-digit PIN, and cashier or manager role.' }, { status: 400 });
        }
        const { data: store, error: storeError } = await supabase
            .from('stores')
            .select('id')
            .eq('id', storeId)
            .maybeSingle();
        if (storeError) throw storeError;
        if (!store) return Response.json({ error: 'Your assigned store could not be found.' }, { status: 400 });

        const { data: existingProfile, error: usernameError } = await supabase
            .from('profiles')
            .select('id')
            .eq('username', username)
            .maybeSingle();
        if (usernameError) throw usernameError;
        if (existingProfile) return Response.json({ error: 'That username is already in use.' }, { status: 409 });

        const { data: userData, error: createError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName, username },
        });
        if (createError) throw createError;

        const salt = randomBytes(16).toString('hex');
        const pinHash = `scrypt$${salt}$${(await scrypt(pin, salt, 64)).toString('hex')}`;

        const { error: saveProfileError } = await supabase.from('profiles').upsert({
            id: userData.user.id,
            full_name: fullName,
            username,
            role,
            store_id: storeId,
            global_access: false,
            pin_code_hash: pinHash,
            permission_overrides: {},
            is_active: true,
        });
        if (saveProfileError) {
            await supabase.auth.admin.deleteUser(userData.user.id);
            throw saveProfileError;
        }

        await supabase.from('audit_logs').insert({
            actor_id: authData.user.id,
            store_id: storeId,
            action: 'create',
            entity_table: 'profiles',
            entity_id: userData.user.id,
            after_data: { username, role, global_access: false, full_name: fullName },
        });

        return Response.json({ message: `${role === 'manager' ? 'Manager' : 'Cashier'} account created.` }, { status: 201 });
    } catch (error) {
        return Response.json({ error: error.message || 'Unable to create the employee account.' }, { status: 400 });
    }
}

export async function PATCH(request) {
    try {
        const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
        if (!token) return Response.json({ error: 'Sign in as an administrator to continue.' }, { status: 401 });

        const supabase = getSupabaseAdminClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return Response.json({ error: 'Your session is invalid. Sign in again.' }, { status: 401 });

        const { data: adminProfile, error: adminError } = await supabase
            .from('profiles')
            .select('role, store_id, is_active')
            .eq('id', user.id)
            .maybeSingle();
        if (adminError) throw adminError;
        if (adminProfile?.role !== 'admin' || !adminProfile.is_active || !adminProfile.store_id) {
            return Response.json({ error: 'Only an active administrator can manage accounts.' }, { status: 403 });
        }

        const { id, action, permission, enabled } = await request.json();
        if (!id || id === user.id) return Response.json({ error: 'You cannot modify your own administrator account here.' }, { status: 400 });

        const { data: target, error: targetError } = await supabase
            .from('profiles')
            .select('id, full_name, role, store_id, global_access, is_active, permission_overrides')
            .eq('id', id)
            .maybeSingle();
        if (targetError) throw targetError;
        if (!target || target.role === 'admin' || target.store_id !== adminProfile.store_id) {
            return Response.json({ error: 'This employee account is outside your store or cannot be modified here.' }, { status: 404 });
        }
        if (action === 'delete') {
            const { error: deleteError } = await supabase.auth.admin.deleteUser(id);
            if (deleteError) throw deleteError;
            await supabase.from('audit_logs').insert({
                actor_id: user.id,
                store_id: target.store_id,
                action: 'delete',
                entity_table: 'profiles',
                entity_id: id,
                before_data: { full_name: target.full_name, role: target.role, is_active: target.is_active },
            });
            return Response.json({ success: true });
        }

        let update;
        if (action === 'archive') update = { is_active: false };
        else if (action === 'restore') update = { is_active: true };
        else if (action === 'permission' && ['refunds_without_pin', 'manual_discounts', 'void_sales'].includes(permission)) {
            update = { permission_overrides: { ...target.permission_overrides, [permission]: enabled === true } };
        } else {
            return Response.json({ error: 'Unsupported employee account action.' }, { status: 400 });
        }

        if (action === 'archive' || action === 'restore') {
            const { error: banError } = await supabase.auth.admin.updateUserById(id, {
                ban_duration: action === 'archive' ? '876000h' : 'none',
            });
            if (banError) throw banError;
        }

        const { error: updateError } = await supabase.from('profiles').update(update).eq('id', id);
        if (updateError) throw updateError;
        await supabase.from('audit_logs').insert({
            actor_id: user.id,
            store_id: target.store_id,
            action,
            entity_table: 'profiles',
            entity_id: id,
            before_data: { is_active: target.is_active, permission_overrides: target.permission_overrides },
            after_data: update,
        });

        return Response.json({ success: true });
    } catch (error) {
        return Response.json({ error: error.message || 'Unable to update this employee account.' }, { status: 400 });
    }
}
