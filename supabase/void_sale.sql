CREATE TABLE IF NOT EXISTS public.cashier_void_pin_attempts (
    cashier_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ
);

ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.sale_item_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES public.sales(id),
    sale_item_id UUID NOT NULL REFERENCES public.sale_items(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    subtotal_amount NUMERIC NOT NULL CHECK (subtotal_amount >= 0),
    tax_amount NUMERIC NOT NULL CHECK (tax_amount >= 0),
    reason TEXT NOT NULL,
    refunded_by UUID NOT NULL REFERENCES public.profiles(id),
    approved_by UUID NOT NULL REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sale_item_refunds_sale_item_idx ON public.sale_item_refunds (sale_item_id);
CREATE INDEX IF NOT EXISTS sale_item_refunds_sale_idx ON public.sale_item_refunds (sale_id);

ALTER TABLE public.sale_item_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sale_item_refunds FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sale_item_refunds TO service_role;

CREATE OR REPLACE FUNCTION public.track_cashier_void_pin_attempt(
    p_cashier_id UUID,
    p_succeeded BOOLEAN DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_locked_until TIMESTAMPTZ;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_cashier_id AND role = 'cashier' AND is_active
    ) THEN
        RAISE EXCEPTION 'The cashier is not active.';
    END IF;

    IF p_succeeded IS NULL THEN
        SELECT locked_until INTO v_locked_until
        FROM public.cashier_void_pin_attempts
        WHERE cashier_id = p_cashier_id;
        RETURN v_locked_until;
    END IF;

    IF p_succeeded THEN
        DELETE FROM public.cashier_void_pin_attempts WHERE cashier_id = p_cashier_id;
        RETURN NULL;
    END IF;

    INSERT INTO public.cashier_void_pin_attempts AS attempts (cashier_id, failed_attempts)
    VALUES (p_cashier_id, 1)
    ON CONFLICT (cashier_id) DO UPDATE
    SET failed_attempts = CASE
            WHEN attempts.locked_until IS NOT NULL AND attempts.locked_until <= NOW() THEN 1
            ELSE attempts.failed_attempts + 1
        END,
        locked_until = CASE
            WHEN attempts.locked_until IS NOT NULL AND attempts.locked_until <= NOW() THEN NULL
            WHEN attempts.failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
            ELSE attempts.locked_until
        END
    RETURNING locked_until INTO v_locked_until;

    RETURN v_locked_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_sale(
    p_sale_id UUID,
    p_cashier_id UUID,
    p_approver_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sale public.sales%ROWTYPE;
    v_cashier public.profiles%ROWTYPE;
    v_approver public.profiles%ROWTYPE;
BEGIN
    IF p_reason IS NULL OR length(trim(p_reason)) < 3 OR length(trim(p_reason)) > 250 THEN
        RAISE EXCEPTION 'Enter a void reason between 3 and 250 characters.';
    END IF;

    SELECT * INTO v_sale
    FROM public.sales
    WHERE id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND OR v_sale.status <> 'completed' THEN
        RAISE EXCEPTION 'This sale is no longer available to void.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.sale_item_refunds WHERE sale_id = p_sale_id) THEN
        RAISE EXCEPTION 'A sale with refunded items cannot be voided.';
    END IF;

    SELECT * INTO v_cashier
    FROM public.profiles
    WHERE id = p_cashier_id
      AND role = 'cashier'
      AND is_active
      AND store_id = v_sale.store_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The cashier is not active in this store.';
    END IF;

    IF p_approver_id = p_cashier_id THEN
        IF COALESCE(v_cashier.permission_overrides ->> 'void_sales', 'false') <> 'true' THEN
            RAISE EXCEPTION 'This cashier is not authorized to approve voids.';
        END IF;
        v_approver := v_cashier;
    ELSE
        SELECT * INTO v_approver
        FROM public.profiles
        WHERE id = p_approver_id
          AND role = 'manager'
          AND is_active
          AND store_id = v_sale.store_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'The approving manager is not active in this store.';
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.sale_items WHERE sale_id = p_sale_id) THEN
        RAISE EXCEPTION 'Sale items are unavailable; inventory was not changed.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.sale_items AS item
        LEFT JOIN public.products AS product ON product.id = item.product_id
        WHERE item.sale_id = p_sale_id
          AND (product.id IS NULL OR product.store_id <> v_sale.store_id)
    ) THEN
        RAISE EXCEPTION 'Sale inventory could not be verified; inventory was not changed.';
    END IF;

    PERFORM item.id
    FROM public.sale_items AS item
    WHERE item.sale_id = p_sale_id
    ORDER BY item.id
    FOR UPDATE;

    PERFORM product.id
    FROM public.products AS product
    JOIN (
        SELECT DISTINCT product_id
        FROM public.sale_items
        WHERE sale_id = p_sale_id
    ) AS item ON item.product_id = product.id
    ORDER BY product.id
    FOR UPDATE OF product;

    UPDATE public.products AS product
    SET current_stock = product.current_stock + item.quantity
    FROM (
        SELECT product_id, SUM(quantity)::INTEGER AS quantity
        FROM public.sale_items
        WHERE sale_id = p_sale_id
        GROUP BY product_id
    ) AS item
    WHERE product.id = item.product_id
      AND product.store_id = v_sale.store_id;

    UPDATE public.sales
    SET status = 'voided'
    WHERE id = p_sale_id;

    INSERT INTO public.audit_logs (
        actor_id,
        store_id,
        action,
        entity_table,
        entity_id,
        before_data,
        after_data
    ) VALUES (
        p_cashier_id,
        v_sale.store_id,
        'void_sale',
        'sales',
        p_sale_id::TEXT,
        jsonb_build_object('status', v_sale.status, 'receipt_number', v_sale.receipt_number),
        jsonb_build_object(
            'status', 'voided',
            'reason', trim(p_reason),
            'approved_by', v_approver.id,
            'approver_name', v_approver.full_name
        )
    );

    RETURN jsonb_build_object(
        'sale_id', p_sale_id,
        'status', 'voided',
        'approver_name', v_approver.full_name
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_sale_with_discount(
    p_items JSONB,
    p_payment_method public.payment_type,
    p_receipt_number VARCHAR,
    p_discount_percent NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cashier public.profiles%ROWTYPE;
    v_sale public.sales%ROWTYPE;
    v_gross_subtotal NUMERIC;
    v_discounted_subtotal NUMERIC;
    v_discount_amount NUMERIC;
    v_discount_rate NUMERIC;
    v_tax_amount NUMERIC;
    v_tax_rate NUMERIC;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in as a cashier to record a sale.';
    END IF;

    IF p_discount_percent IS NULL OR p_discount_percent < 0 OR p_discount_percent > 100 THEN
        RAISE EXCEPTION 'Discount must be between 0 and 100 percent.';
    END IF;
    v_discount_rate := ROUND(p_discount_percent, 2);

    SELECT * INTO v_cashier
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'cashier' AND is_active AND store_id IS NOT NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Only an active cashier can record a sale.';
    END IF;

    IF v_discount_rate > 0
       AND COALESCE(v_cashier.permission_overrides ->> 'manual_discounts', 'false') <> 'true' THEN
        RAISE EXCEPTION 'Your account is not authorized to apply a manual discount.';
    END IF;

    PERFORM public.record_sale(p_items, p_payment_method, p_receipt_number);

    SELECT * INTO v_sale
    FROM public.sales
    WHERE receipt_number = p_receipt_number
      AND cashier_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The completed sale could not be found.';
    END IF;

    SELECT COALESCE(SUM(subtotal), 0) INTO v_gross_subtotal
    FROM public.sale_items
    WHERE sale_id = v_sale.id;

    UPDATE public.sale_items
    SET subtotal = ROUND(unit_price * quantity * (1 - v_discount_rate / 100), 2)
    WHERE sale_id = v_sale.id;

    SELECT COALESCE(SUM(subtotal), 0) INTO v_discounted_subtotal
    FROM public.sale_items
    WHERE sale_id = v_sale.id;

    SELECT tax_rate INTO v_tax_rate
    FROM public.stores
    WHERE id = v_sale.store_id;

    v_discount_amount := v_gross_subtotal - v_discounted_subtotal;
    v_tax_amount := ROUND(v_discounted_subtotal * COALESCE(v_tax_rate, 0), 2);

    UPDATE public.sales
    SET discount_percent = v_discount_rate,
        discount_amount = v_discount_amount,
        tax_amount = v_tax_amount,
        total_amount = v_discounted_subtotal + v_tax_amount
    WHERE id = v_sale.id
    RETURNING * INTO v_sale;

    IF v_discount_rate > 0 THEN
        INSERT INTO public.audit_logs (
            actor_id, store_id, action, entity_table, entity_id, before_data, after_data
        ) VALUES (
            auth.uid(), v_sale.store_id, 'manual_discount', 'sales', v_sale.id::TEXT,
            jsonb_build_object('total_amount', v_gross_subtotal),
            jsonb_build_object(
                'discount_percent', v_discount_rate,
                'discount_amount', v_discount_amount,
                'total_amount', v_sale.total_amount
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'id', v_sale.id,
        'receipt_number', v_sale.receipt_number,
        'total_amount', v_sale.total_amount,
        'discount_percent', v_sale.discount_percent,
        'discount_amount', v_sale.discount_amount
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_sale_item(
    p_sale_item_id UUID,
    p_cashier_id UUID,
    p_approver_id UUID,
    p_quantity INTEGER,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sale public.sales%ROWTYPE;
    v_item public.sale_items%ROWTYPE;
    v_cashier public.profiles%ROWTYPE;
    v_approver public.profiles%ROWTYPE;
    v_sale_subtotal NUMERIC;
    v_refunded_quantity INTEGER;
    v_remaining_quantity INTEGER;
    v_refunded_subtotal NUMERIC;
    v_refunded_tax NUMERIC;
    v_line_tax NUMERIC;
    v_subtotal_amount NUMERIC;
    v_tax_amount NUMERIC;
BEGIN
    IF p_quantity IS NULL OR p_quantity < 1 THEN
        RAISE EXCEPTION 'Refund quantity must be at least one.';
    END IF;
    IF p_reason IS NULL OR length(trim(p_reason)) < 3 OR length(trim(p_reason)) > 250 THEN
        RAISE EXCEPTION 'Enter a refund reason between 3 and 250 characters.';
    END IF;

    SELECT sale.* INTO v_sale
    FROM public.sales AS sale
    JOIN public.sale_items AS item ON item.sale_id = sale.id
    WHERE item.id = p_sale_item_id
    FOR UPDATE OF sale;

    IF NOT FOUND OR v_sale.status <> 'completed' THEN
        RAISE EXCEPTION 'This sale is no longer available for an item refund.';
    END IF;

    SELECT * INTO v_item
    FROM public.sale_items
    WHERE id = p_sale_item_id AND sale_id = v_sale.id
    FOR UPDATE;

    SELECT * INTO v_cashier
    FROM public.profiles
    WHERE id = p_cashier_id
      AND role = 'cashier'
      AND is_active
      AND store_id = v_sale.store_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The cashier is not active in this store.';
    END IF;

    IF p_approver_id = p_cashier_id THEN
        IF COALESCE(v_cashier.permission_overrides ->> 'refunds_without_pin', 'false') <> 'true' THEN
            RAISE EXCEPTION 'This cashier is not authorized to approve refunds.';
        END IF;
        v_approver := v_cashier;
    ELSE
        SELECT * INTO v_approver
        FROM public.profiles
        WHERE id = p_approver_id
          AND role = 'manager'
          AND is_active
          AND store_id = v_sale.store_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'The approving manager is not active in this store.';
        END IF;
    END IF;

    SELECT COALESCE(SUM(subtotal), 0) INTO v_sale_subtotal
    FROM public.sale_items
    WHERE sale_id = v_sale.id;

    SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(subtotal_amount), 0), COALESCE(SUM(tax_amount), 0)
    INTO v_refunded_quantity, v_refunded_subtotal, v_refunded_tax
    FROM public.sale_item_refunds
    WHERE sale_item_id = v_item.id;

    v_remaining_quantity := v_item.quantity - v_refunded_quantity;
    IF p_quantity > v_remaining_quantity THEN
        RAISE EXCEPTION 'Only % item(s) remain eligible for refund.', v_remaining_quantity;
    END IF;

    v_line_tax := CASE
        WHEN v_sale_subtotal <= 0 THEN 0
        ELSE ROUND(v_sale.tax_amount * v_item.subtotal / v_sale_subtotal, 2)
    END;
    IF p_quantity = v_remaining_quantity THEN
        v_subtotal_amount := v_item.subtotal - v_refunded_subtotal;
        v_tax_amount := v_line_tax - v_refunded_tax;
    ELSE
        v_subtotal_amount := ROUND(v_item.subtotal * p_quantity / v_item.quantity, 2);
        v_tax_amount := ROUND(v_line_tax * p_quantity / v_item.quantity, 2);
    END IF;

    PERFORM product.id
    FROM public.products AS product
    WHERE product.id = v_item.product_id AND product.store_id = v_sale.store_id
    FOR UPDATE;

    UPDATE public.products
    SET current_stock = current_stock + p_quantity
    WHERE id = v_item.product_id AND store_id = v_sale.store_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The product could not be verified; no refund was recorded.';
    END IF;

    INSERT INTO public.sale_item_refunds (
        sale_id, sale_item_id, quantity, subtotal_amount, tax_amount, reason, refunded_by, approved_by
    ) VALUES (
        v_sale.id, v_item.id, p_quantity, v_subtotal_amount, v_tax_amount,
        trim(p_reason), p_cashier_id, v_approver.id
    );

    IF NOT EXISTS (
        SELECT 1
        FROM public.sale_items AS item
        WHERE item.sale_id = v_sale.id
          AND item.quantity > (
              SELECT COALESCE(SUM(refund.quantity), 0)
              FROM public.sale_item_refunds AS refund
              WHERE refund.sale_item_id = item.id
          )
    ) THEN
        UPDATE public.sales SET status = 'refunded' WHERE id = v_sale.id;
    END IF;

    INSERT INTO public.audit_logs (
        actor_id, store_id, action, entity_table, entity_id, before_data, after_data
    ) VALUES (
        p_cashier_id, v_sale.store_id, 'refund_item', 'sale_items', v_item.id::TEXT,
        jsonb_build_object('refunded_quantity', v_refunded_quantity),
        jsonb_build_object(
            'quantity', p_quantity,
            'subtotal_amount', v_subtotal_amount,
            'tax_amount', v_tax_amount,
            'reason', trim(p_reason),
            'approved_by', v_approver.id,
            'approver_name', v_approver.full_name
        )
    );

    RETURN jsonb_build_object(
        'sale_id', v_sale.id,
        'sale_item_id', v_item.id,
        'quantity', p_quantity,
        'subtotal_amount', v_subtotal_amount,
        'tax_amount', v_tax_amount,
        'total_amount', v_subtotal_amount + v_tax_amount,
        'approver_name', v_approver.full_name
    );
END;
$$;

REVOKE ALL ON FUNCTION public.void_sale(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_sale(UUID, UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.record_sale_with_discount(JSONB, public.payment_type, VARCHAR, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sale_with_discount(JSONB, public.payment_type, VARCHAR, NUMERIC) TO authenticated;
REVOKE ALL ON FUNCTION public.refund_sale_item(UUID, UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_sale_item(UUID, UUID, UUID, INTEGER, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.track_cashier_void_pin_attempt(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_cashier_void_pin_attempt(UUID, BOOLEAN) TO service_role;