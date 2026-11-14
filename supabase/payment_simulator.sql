CREATE TABLE IF NOT EXISTS public.simulated_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID,
    sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
    idempotency_key UUID NOT NULL,
    transaction_reference VARCHAR(40) NOT NULL UNIQUE,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'qrph', 'card')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'PHP' CHECK (currency = 'PHP'),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid_simulated', 'failed', 'canceled', 'expired')),
    cart_items JSONB NOT NULL,
    discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
    tender_amount NUMERIC(12, 2),
    test_card_identifier VARCHAR(32),
    failure_reason TEXT,
    receipt_number VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ
);

ALTER TABLE public.simulated_payments ADD COLUMN IF NOT EXISTS idempotency_key UUID;
UPDATE public.simulated_payments SET idempotency_key = gen_random_uuid() WHERE idempotency_key IS NULL;
ALTER TABLE public.simulated_payments ALTER COLUMN idempotency_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS simulated_payments_user_idempotency_idx
    ON public.simulated_payments (user_id, idempotency_key);

CREATE INDEX IF NOT EXISTS simulated_payments_user_created_idx
    ON public.simulated_payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS simulated_payments_store_status_idx
    ON public.simulated_payments (store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS simulated_payments_reference_idx
    ON public.simulated_payments (transaction_reference);

ALTER TABLE public.simulated_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.simulated_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.simulated_payments TO authenticated;

DROP POLICY IF EXISTS "Users view their own simulated payments" ON public.simulated_payments;
CREATE POLICY "Users view their own simulated payments"
    ON public.simulated_payments
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

GRANT ALL ON TABLE public.simulated_payments TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_simulated_payment(
    p_payment_id UUID,
    p_test_card_identifier TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment public.simulated_payments%ROWTYPE;
    v_sale JSONB;
    v_sale_payment_method public.payment_type;
    v_receipt_number VARCHAR(80);
    v_failure_reason TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to confirm this simulated payment.';
    END IF;

    SELECT * INTO v_payment
    FROM public.simulated_payments
    WHERE id = p_payment_id AND user_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The payment was not found or is not available to this account.';
    END IF;

    IF v_payment.status <> 'pending' THEN
        RETURN jsonb_build_object(
            'status', v_payment.status,
            'transaction_reference', v_payment.transaction_reference,
            'amount', v_payment.amount,
            'currency', v_payment.currency,
            'payment_method', v_payment.payment_method,
            'sale_id', v_payment.sale_id,
            'receipt_number', v_payment.receipt_number,
            'failure_reason', v_payment.failure_reason,
            'completed_at', v_payment.completed_at
        );
    END IF;

    IF v_payment.expires_at <= NOW() THEN
        UPDATE public.simulated_payments
        SET status = 'expired', completed_at = NOW(), failure_reason = 'Payment expired.'
        WHERE id = v_payment.id;
        RETURN jsonb_build_object('status', 'expired', 'transaction_reference', v_payment.transaction_reference);
    END IF;

    IF v_payment.payment_method = 'card' THEN
        IF p_test_card_identifier IS NULL OR p_test_card_identifier NOT IN ('TEST-CARD-001', 'TEST-CARD-002', 'TEST-CARD-003') THEN
            UPDATE public.simulated_payments
            SET status = 'failed', completed_at = NOW(), failure_reason = 'Use a valid fictional test card identifier.'
            WHERE id = v_payment.id;
            RETURN jsonb_build_object('status', 'failed', 'failure_reason', 'Use a valid fictional test card identifier.');
        END IF;

        IF p_test_card_identifier = 'TEST-CARD-002' THEN
            v_failure_reason := 'The fictional test card was declined.';
        ELSIF p_test_card_identifier = 'TEST-CARD-003' THEN
            v_failure_reason := 'The fictional test card has insufficient simulated funds.';
        END IF;

        IF v_failure_reason IS NOT NULL THEN
            UPDATE public.simulated_payments
            SET status = 'failed', test_card_identifier = p_test_card_identifier,
                completed_at = NOW(), failure_reason = v_failure_reason
            WHERE id = v_payment.id;
            RETURN jsonb_build_object('status', 'failed', 'failure_reason', v_failure_reason);
        END IF;
    END IF;

    IF v_payment.payment_method = 'cash' AND COALESCE(v_payment.tender_amount, 0) < v_payment.amount THEN
        RAISE EXCEPTION 'Cash tender must cover the payment amount.';
    END IF;

    UPDATE public.simulated_payments
    SET status = 'processing',
        test_card_identifier = CASE WHEN v_payment.payment_method = 'card' THEN p_test_card_identifier ELSE NULL END
    WHERE id = v_payment.id;

    v_receipt_number := 'D-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || UPPER(SUBSTRING(REPLACE(v_payment.id::TEXT, '-', '') FROM 1 FOR 8));
    v_sale_payment_method := CASE
        WHEN v_payment.payment_method = 'qrph' THEN 'mobile_wallet'::public.payment_type
        ELSE v_payment.payment_method::public.payment_type
    END;

    v_sale := public.record_sale_with_discount(
        v_payment.cart_items,
        v_sale_payment_method,
        v_receipt_number,
        v_payment.discount_percent
    );

    IF ROUND((v_sale ->> 'total_amount')::NUMERIC, 2) <> v_payment.amount THEN
        RAISE EXCEPTION 'The validated payment amount no longer matches the sale total.';
    END IF;

    UPDATE public.simulated_payments
    SET status = 'paid_simulated',
        sale_id = NULLIF(v_sale ->> 'id', '')::UUID,
        receipt_number = COALESCE(v_sale ->> 'receipt_number', v_receipt_number),
        completed_at = NOW(),
        failure_reason = NULL
    WHERE id = v_payment.id;

    RETURN jsonb_build_object(
        'status', 'paid_simulated',
        'transaction_reference', v_payment.transaction_reference,
        'amount', v_payment.amount,
        'currency', v_payment.currency,
        'payment_method', v_payment.payment_method,
        'receipt_number', COALESCE(v_sale ->> 'receipt_number', v_receipt_number),
        'sale', v_sale,
        'completed_at', NOW()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_simulated_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_simulated_payment(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_simulated_payment_metrics(p_store_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Only trusted server operations can read simulator metrics.';
    END IF;

    RETURN (
        SELECT jsonb_build_object(
            'simulated_revenue', COALESCE(SUM(amount) FILTER (WHERE status = 'paid_simulated'), 0),
            'successful_count', COUNT(*) FILTER (WHERE status = 'paid_simulated'),
            'pending_count', COUNT(*) FILTER (WHERE status = 'pending'),
            'failed_count', COUNT(*) FILTER (WHERE status = 'failed'),
            'total_count', COUNT(*)
        )
        FROM public.simulated_payments
        WHERE store_id = p_store_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_simulated_payment_metrics(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_simulated_payment_metrics(UUID) TO service_role;