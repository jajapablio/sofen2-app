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

async function getCashier(request, supabase) {
    const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return { response: Response.json({ error: 'Sign in as a cashier to continue.' }, { status: 401 }) };

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return { response: Response.json({ error: 'Your session is invalid. Sign in again.' }, { status: 401 }) };

    const { data: cashier, error: cashierError } = await supabase
        .from('profiles')
        .select('id, full_name, role, store_id, is_active, pin_code_hash, permission_overrides')
        .eq('id', authData.user.id)
        .maybeSingle();
    if (cashierError) throw cashierError;
    if (cashier?.role !== 'cashier' || !cashier.is_active || !cashier.store_id) {
        return { response: Response.json({ error: 'Only an active cashier can manage refunds.' }, { status: 403 }) };
    }
    return { cashier };
}

async function findApprover(supabase, cashier, pin) {
    const { data: lockedUntil, error: lockError } = await supabase.rpc('track_cashier_void_pin_attempt', {
        p_cashier_id: cashier.id,
        p_succeeded: null,
    });
    if (lockError) throw lockError;
    if (lockedUntil && new Date(lockedUntil) > new Date()) {
        return { response: Response.json({ error: 'Too many incorrect PIN attempts. Try again in 15 minutes.' }, { status: 429 }) };
    }

    if (await pinMatches(cashier.pin_code_hash, pin)) {
        if (cashier.permission_overrides?.refunds_without_pin !== true) {
            return { response: Response.json({ error: 'Your account is not authorized to approve refunds. Enter a manager PIN.' }, { status: 403 }) };
        }
        return { approver: cashier };
    }

    const { data: managers, error: managersError } = await supabase
        .from('profiles')
        .select('id, full_name, role, store_id, is_active, pin_code_hash')
        .eq('store_id', cashier.store_id)
        .eq('role', 'manager')
        .eq('is_active', true);
    if (managersError) throw managersError;

    for (const manager of managers || []) {
        if (await pinMatches(manager.pin_code_hash, pin)) {
            const { error: resetError } = await supabase.rpc('track_cashier_void_pin_attempt', {
                p_cashier_id: cashier.id,
                p_succeeded: true,
            });
            if (resetError) throw resetError;
            return { approver: manager };
        }
    }

    const { error: attemptError } = await supabase.rpc('track_cashier_void_pin_attempt', {
        p_cashier_id: cashier.id,
        p_succeeded: false,
    });
    if (attemptError) throw attemptError;
    return { response: Response.json({ error: 'The PIN was not accepted. Enter your authorized PIN or ask a manager.' }, { status: 403 }) };
}

export async function GET(request) {
    try {
        const supabase = getSupabaseAdminClient();
        const { cashier, response } = await getCashier(request, supabase);
        if (response) return response;

        const saleId = new URL(request.url).searchParams.get('saleId') || '';
        if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(saleId)) {
            return Response.json({ error: 'Select a valid sale to refund.' }, { status: 400 });
        }

        const { data: sale, error: saleError } = await supabase
            .from('sales')
            .select('id, store_id, receipt_number, status')
            .eq('id', saleId)
            .eq('store_id', cashier.store_id)
            .maybeSingle();
        if (saleError) throw saleError;
        if (!sale || !['completed', 'refunded'].includes(sale.status)) return Response.json({ error: 'This sale is not available for item refunds.' }, { status: 404 });

        const [{ data: items, error: itemsError }, { data: refunds, error: refundsError }] = await Promise.all([
            supabase.from('sale_items').select('id, product_name, product_sku, quantity, unit_price, subtotal').eq('sale_id', sale.id).order('created_at'),
            supabase.from('sale_item_refunds').select('sale_item_id, quantity, subtotal_amount, tax_amount').eq('sale_id', sale.id),
        ]);
        if (itemsError) throw itemsError;
        if (refundsError) throw refundsError;

        const refundedByItem = new Map();
        for (const refund of refunds || []) {
            const existing = refundedByItem.get(refund.sale_item_id) || { quantity: 0, subtotal: 0, tax: 0 };
            existing.quantity += refund.quantity;
            existing.subtotal += Number(refund.subtotal_amount);
            existing.tax += Number(refund.tax_amount);
            refundedByItem.set(refund.sale_item_id, existing);
        }

        return Response.json({
            sale,
            items: (items || []).map((item) => {
                const refunded = refundedByItem.get(item.id) || { quantity: 0, subtotal: 0, tax: 0 };
                return {
                    ...item,
                    refunded_quantity: refunded.quantity,
                    remaining_quantity: item.quantity - refunded.quantity,
                    remaining_subtotal: Number(item.subtotal) - refunded.subtotal,
                };
            }),
        });
    } catch (error) {
        return Response.json({ error: error.message || 'Unable to load refund items.' }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const saleItemId = String(body.saleItemId || '');
        const pin = String(body.pin || '');
        const reason = String(body.reason || '').trim();
        const quantity = Number(body.quantity);
        if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(saleItemId)) {
            return Response.json({ error: 'Select a valid sale item to refund.' }, { status: 400 });
        }
        if (!Number.isSafeInteger(quantity) || quantity < 1) return Response.json({ error: 'Enter a valid refund quantity.' }, { status: 400 });
        if (!/^\d{4}$/.test(pin)) return Response.json({ error: 'Enter a four-digit staff PIN.' }, { status: 400 });
        if (reason.length < 3 || reason.length > 250) {
            return Response.json({ error: 'Enter a refund reason between 3 and 250 characters.' }, { status: 400 });
        }

        const supabase = getSupabaseAdminClient();
        const { cashier, response } = await getCashier(request, supabase);
        if (response) return response;

        const { data: item, error: itemError } = await supabase
            .from('sale_items')
            .select('id, sale_id')
            .eq('id', saleItemId)
            .maybeSingle();
        if (itemError) throw itemError;
        if (!item) return Response.json({ error: 'The sale item was not found.' }, { status: 404 });

        const { data: sale, error: saleError } = await supabase
            .from('sales')
            .select('id, store_id, status')
            .eq('id', item.sale_id)
            .eq('store_id', cashier.store_id)
            .maybeSingle();
        if (saleError) throw saleError;
        if (!sale || sale.status !== 'completed') return Response.json({ error: 'This sale is not available for item refunds.' }, { status: 404 });

        const { approver, response: pinResponse } = await findApprover(supabase, cashier, pin);
        if (pinResponse) return pinResponse;

        if (approver.id === cashier.id) {
            const { error: resetError } = await supabase.rpc('track_cashier_void_pin_attempt', {
                p_cashier_id: cashier.id,
                p_succeeded: true,
            });
            if (resetError) throw resetError;
        }

        const { data: refund, error: refundError } = await supabase.rpc('refund_sale_item', {
            p_sale_item_id: saleItemId,
            p_cashier_id: cashier.id,
            p_approver_id: approver.id,
            p_quantity: quantity,
            p_reason: reason,
        });
        if (refundError) throw refundError;

        return Response.json({ success: true, refund });
    } catch (error) {
        return Response.json({ error: error.message || 'Unable to refund this item.' }, { status: 500 });
    }
}