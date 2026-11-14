import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getSupabaseAdminClient } from '../../../../lib/supabase/admin';

const scrypt = promisify(scryptCallback);

async function pinMatches(pinHash, pin) {
    const [algorithm, salt, digest] = String(pinHash || '').split('$');
    if (algorithm !== 'scrypt' || !salt || !/^[a-f\d]{128}$/i.test(digest || '')) return false;

    const expected = Buffer.from(digest, 'hex');
    const actual = await scrypt(pin, salt, expected.length);
    return timingSafeEqual(actual, expected);
}

export async function POST(request) {
    try {
        const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
        if (!token) return Response.json({ error: 'Sign in as a cashier to continue.' }, { status: 401 });

        const body = await request.json();
        const saleId = String(body.saleId || '');
        const pin = String(body.pin || '');
        const reason = String(body.reason || '').trim();
        if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(saleId)) {
            return Response.json({ error: 'Select a valid sale to void.' }, { status: 400 });
        }
        if (!/^\d{4}$/.test(pin)) return Response.json({ error: 'Enter a four-digit staff PIN.' }, { status: 400 });
        if (reason.length < 3 || reason.length > 250) {
            return Response.json({ error: 'Enter a void reason between 3 and 250 characters.' }, { status: 400 });
        }

        const supabase = getSupabaseAdminClient();
        const { data: authData, error: authError } = await supabase.auth.getUser(token);
        if (authError || !authData.user) return Response.json({ error: 'Your session is invalid. Sign in again.' }, { status: 401 });

        const { data: cashier, error: cashierError } = await supabase
            .from('profiles')
            .select('id, full_name, role, store_id, is_active, pin_code_hash, permission_overrides')
            .eq('id', authData.user.id)
            .maybeSingle();
        if (cashierError) throw cashierError;
        if (cashier?.role !== 'cashier' || !cashier.is_active || !cashier.store_id) {
            return Response.json({ error: 'Only an active cashier can request a sale void.' }, { status: 403 });
        }

        const { data: lockedUntil, error: lockError } = await supabase.rpc('track_cashier_void_pin_attempt', {
            p_cashier_id: cashier.id,
            p_succeeded: null,
        });
        if (lockError) throw lockError;
        if (lockedUntil && new Date(lockedUntil) > new Date()) {
            return Response.json({ error: 'Too many incorrect PIN attempts. Try again in 15 minutes.' }, { status: 429 });
        }

        const { data: sale, error: saleError } = await supabase
            .from('sales')
            .select('id, store_id, status')
            .eq('id', saleId)
            .eq('store_id', cashier.store_id)
            .maybeSingle();
        if (saleError) throw saleError;
        if (!sale) return Response.json({ error: 'The sale was not found in your store.' }, { status: 404 });
        if (sale.status !== 'completed') return Response.json({ error: 'Only completed sales can be voided.' }, { status: 409 });

        const ownPinMatches = await pinMatches(cashier.pin_code_hash, pin);
        let approver = null;
        if (ownPinMatches) {
            if (cashier.permission_overrides?.void_sales !== true) {
                return Response.json({ error: 'Your account is not authorized to approve voids. Enter a manager PIN.' }, { status: 403 });
            }
            approver = cashier;
        } else {
            const { data: managers, error: managersError } = await supabase
                .from('profiles')
                .select('id, full_name, role, store_id, is_active, pin_code_hash')
                .eq('store_id', cashier.store_id)
                .eq('role', 'manager')
                .eq('is_active', true);
            if (managersError) throw managersError;

            for (const manager of managers || []) {
                if (await pinMatches(manager.pin_code_hash, pin)) {
                    approver = manager;
                    break;
                }
            }
            if (!approver) {
                const { error: attemptError } = await supabase.rpc('track_cashier_void_pin_attempt', {
                    p_cashier_id: cashier.id,
                    p_succeeded: false,
                });
                if (attemptError) throw attemptError;
                return Response.json({ error: 'The PIN was not accepted. Enter your authorized PIN or ask a manager.' }, { status: 403 });
            }
        }

        const { error: resetError } = await supabase.rpc('track_cashier_void_pin_attempt', {
            p_cashier_id: cashier.id,
            p_succeeded: true,
        });
        if (resetError) throw resetError;

        const { data: voidResult, error: voidError } = await supabase.rpc('void_sale', {
            p_sale_id: sale.id,
            p_cashier_id: cashier.id,
            p_approver_id: approver.id,
            p_reason: reason,
        });
        if (voidError) throw voidError;

        return Response.json({ success: true, approverName: voidResult?.approver_name || approver.full_name });
    } catch (error) {
        return Response.json({ error: error.message || 'Unable to void this sale.' }, { status: 500 });
    }
}