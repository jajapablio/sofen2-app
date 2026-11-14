import { getSupabaseAdminClient } from '../../../../lib/supabase/admin';

export async function GET(request) {
    try {
        const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
        if (!token) return Response.json({ error: 'Authentication required.' }, { status: 401 });

        const supabase = getSupabaseAdminClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return Response.json({ error: 'Session expired.' }, { status: 401 });
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role, store_id, is_active')
            .eq('id', user.id)
            .maybeSingle();
        if (profileError) throw profileError;
        if (profile?.role !== 'admin' || !profile.is_active || profile.store_id) {
            return Response.json({ error: 'Administrator access required.' }, { status: 403 });
        }

        return Response.json({
            stripe: Boolean(process.env.STRIPE_SECRET_KEY),
            brevo: Boolean(process.env.BREVO_API_KEY),
            twilio: Boolean(process.env.TWILIO_AUTH_TOKEN),
            quickbooks: Boolean(process.env.QUICKBOOKS_CLIENT_SECRET),
        });
    } catch (error) {
        return Response.json({ error: error.message || 'Unable to read integration status.' }, { status: 500 });
    }
}