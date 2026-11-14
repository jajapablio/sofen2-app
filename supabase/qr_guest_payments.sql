-- Run after payment_simulator.sql. Only the trusted server may confirm guest QR links.
CREATE OR REPLACE FUNCTION public.confirm_qr_demo_payment(p_payment_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_owner UUID;
    v_claims TEXT := current_setting('request.jwt.claims', true);
    v_result JSONB;
BEGIN
    IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
    END IF;
    SELECT user_id INTO v_owner FROM public.simulated_payments
    WHERE id = p_payment_id AND payment_method = 'qrph';
    IF v_owner IS NULL THEN RAISE EXCEPTION 'QR payment not found'; END IF;
    -- Reuse the original atomic confirmation and its cashier, expiry, stock and total checks.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    v_result := public.confirm_simulated_payment(p_payment_id, NULL);
    PERFORM set_config('request.jwt.claims', COALESCE(v_claims, '{}'), true);
    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claims', COALESCE(v_claims, '{}'), true);
    RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_qr_demo_payment(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_qr_demo_payment(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_simulated_payment(UUID, TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
