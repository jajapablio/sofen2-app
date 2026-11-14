import { createQrToken } from '../../../lib/payments/qr-token';
import { randomUUID } from 'node:crypto';
import { authenticatePaymentRequest } from '../../../lib/payments/server';

const paymentMethods = new Set(['cash', 'qrph', 'card']);
const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export async function POST(request) {
    try {
        const auth = await authenticatePaymentRequest(request, ['cashier']);
        if (auth.error) return Response.json({ error: auth.error }, { status: auth.status });
        if (!auth.profile.store_id) return Response.json({ error: 'Your cashier account is not assigned to a store.' }, { status: 403 });

        let body;
        try {
            body = await request.json();
        } catch {
            return Response.json({ error: 'Provide a valid payment request.' }, { status: 400 });
        }

        const paymentMethod = String(body.paymentMethod || '');
        const discountPercent = roundMoney(Number(body.discountPercent));
        const idempotencyKey = String(body.idempotencyKey || '');
        const items = Array.isArray(body.items) ? body.items : [];
        if (!paymentMethods.has(paymentMethod)) return Response.json({ error: 'Choose Cash, QRPH, or Card.' }, { status: 400 });
        if (!uuidPattern.test(idempotencyKey)) return Response.json({ error: 'A valid payment request key is required.' }, { status: 400 });
        if (!items.length || items.length > 100) return Response.json({ error: 'Add between 1 and 100 cart items.' }, { status: 400 });
        if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
            return Response.json({ error: 'Discount must be between 0 and 100 percent.' }, { status: 400 });
        }
        if (discountPercent > 0 && auth.profile.permission_overrides?.manual_discounts !== true) {
            return Response.json({ error: 'Your account is not authorized to apply a manual discount.' }, { status: 403 });
        }

        const normalizedItems = [];
        const quantities = new Map();
        for (const item of items) {
            const productId = String(item.product_id || '');
            const quantity = Number(item.quantity);
            if (!uuidPattern.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
                return Response.json({ error: 'One or more cart items are invalid.' }, { status: 400 });
            }
            quantities.set(productId, (quantities.get(productId) || 0) + quantity);
        }
        for (const [productId, quantity] of quantities) normalizedItems.push({ product_id: productId, quantity });
        if (normalizedItems.some((item) => item.quantity > 10000)) {
            return Response.json({ error: 'A cart quantity exceeds the allowed limit.' }, { status: 400 });
        }

        const productIds = normalizedItems.map((item) => item.product_id);
        const [{ data: products, error: productsError }, { data: store, error: storeError }] = await Promise.all([
            auth.supabase.from('products')
                .select('id, selling_price, current_stock')
                .eq('store_id', auth.profile.store_id)
                .in('id', productIds),
            auth.supabase.from('stores')
                .select('id, tax_rate')
                .eq('id', auth.profile.store_id)
                .single(),
        ]);
        if (productsError) throw productsError;
        if (storeError) throw storeError;
        if ((products || []).length !== normalizedItems.length) {
            return Response.json({ error: 'A cart item is no longer available in this store.' }, { status: 409 });
        }

        const productById = new Map(products.map((product) => [product.id, product]));
        let discountedSubtotal = 0;
        for (const item of normalizedItems) {
            const product = productById.get(item.product_id);
            if (Number(product.current_stock) < item.quantity) {
                return Response.json({ error: `Insufficient stock for a cart item. Available: ${product.current_stock}.` }, { status: 409 });
            }
            discountedSubtotal += roundMoney(Number(product.selling_price) * item.quantity * (1 - discountPercent / 100));
        }
        const amount = roundMoney(discountedSubtotal + roundMoney(discountedSubtotal * Number(store.tax_rate || 0)));
        if (!Number.isFinite(amount) || amount <= 0) return Response.json({ error: 'The payment amount must be greater than zero.' }, { status: 400 });

        const tenderAmount = paymentMethod === 'cash' ? Number(body.tenderAmount) : null;
        if (paymentMethod === 'cash' && (!Number.isFinite(tenderAmount) || tenderAmount < amount)) {
            return Response.json({ error: 'Cash received must cover the amount due.' }, { status: 400 });
        }

        const transactionReference = `DEMO-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const { data: payment, error: insertError } = await auth.supabase
            .from('simulated_payments')
            .insert({
                user_id: auth.user.id,
                store_id: auth.profile.store_id,
                idempotency_key: idempotencyKey,
                transaction_reference: transactionReference,
                payment_method: paymentMethod,
                amount,
                currency: 'PHP',
                status: 'pending',
                cart_items: normalizedItems,
                discount_percent: discountPercent,
                tender_amount: tenderAmount,
                expires_at: expiresAt,
            })
            .select('id, transaction_reference, payment_method, amount, currency, status, created_at, expires_at')
            .single();
        if (insertError?.code === '23505') {
            const { data: existingPayment, error: existingError } = await auth.supabase
                .from('simulated_payments')
                .select('id, transaction_reference, payment_method, amount, currency, status, created_at, expires_at')
                .eq('user_id', auth.user.id)
                .eq('idempotency_key', idempotencyKey)
                .maybeSingle();
            if (existingError) throw existingError;
            if (existingPayment) return Response.json({ payment: { ...existingPayment, qr_token: existingPayment.payment_method === 'qrph' ? createQrToken(existingPayment) : undefined } });
        }
        if (insertError) throw insertError;

        return Response.json({ payment: { ...payment, qr_token: paymentMethod === 'qrph' ? createQrToken(payment) : undefined } }, { status: 201 });
    } catch (error) {
        return Response.json({ error: error.message || 'Unable to start the simulated payment.' }, { status: 500 });
    }
}