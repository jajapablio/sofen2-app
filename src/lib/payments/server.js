import { getSupabaseAdminClient } from '../supabase/admin';

export async function authenticatePaymentRequest(request, allowedRoles) {
    const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
        return { error: 'Sign in to continue.', status: 401 };
    }

    const supabase = getSupabaseAdminClient();
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
        return { error: 'Your session is invalid. Sign in again.', status: 401 };
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, role, store_id, is_active, permission_overrides')
        .eq('id', authData.user.id)
        .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.is_active || !allowedRoles.includes(profile.role)) {
        return { error: 'You are not authorized to access this payment.', status: 403 };
    }

    return { supabase, user: authData.user, profile, accessToken: token };
}