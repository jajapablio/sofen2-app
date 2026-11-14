-- ============================================================================
-- PredictPOS — Forecast Engine
-- Run this in Supabase SQL Editor as the Project Owner.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sales_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    forecast_date DATE NOT NULL,
    period_type TEXT NOT NULL DEFAULT 'daily' CHECK (period_type IN ('daily', 'weekly', 'monthly')),
    predicted_sales NUMERIC(12, 2) NOT NULL DEFAULT 0,
    confidence_score INTEGER NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),
    actual_sales NUMERIC(12, 2),
    variance_percent NUMERIC(5, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, forecast_date, period_type)
);

CREATE TABLE IF NOT EXISTS public.inventory_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    forecast_date DATE NOT NULL,
    predicted_demand INTEGER NOT NULL DEFAULT 0 CHECK (predicted_demand >= 0),
    confidence_score INTEGER NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),
    is_anomaly BOOLEAN NOT NULL DEFAULT false,
    current_stock INTEGER NOT NULL DEFAULT 0,
    suggested_restock INTEGER NOT NULL DEFAULT 0,
    days_until_shortage INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade the original inventory forecast table without replacing existing rows.
ALTER TABLE public.inventory_forecasts
    ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS current_stock INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS suggested_restock INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS days_until_shortage INTEGER;
UPDATE public.inventory_forecasts inf SET store_id = p.store_id
FROM public.products p WHERE p.id = inf.product_id AND inf.store_id IS NULL;
ALTER TABLE public.inventory_forecasts ALTER COLUMN store_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS sales_forecasts_store_date_idx ON public.sales_forecasts(store_id, forecast_date);
CREATE INDEX IF NOT EXISTS inventory_forecasts_store_date_idx ON public.inventory_forecasts(store_id, forecast_date);
CREATE INDEX IF NOT EXISTS inventory_forecasts_product_idx ON public.inventory_forecasts(product_id);

ALTER TABLE public.sales_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_forecasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view sales forecasts" ON public.sales_forecasts;
CREATE POLICY "Authenticated users can view sales forecasts" ON public.sales_forecasts
    FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = (SELECT auth.uid()) AND p.is_active
          AND p.role IN ('admin', 'manager')
          AND (p.store_id = sales_forecasts.store_id OR (p.role = 'manager' AND p.global_access))
    ));

DROP POLICY IF EXISTS "Authenticated users can view inventory forecasts" ON public.inventory_forecasts;
DROP POLICY IF EXISTS "View Store Forecasts" ON public.inventory_forecasts;
CREATE POLICY "Authenticated users can view inventory forecasts" ON public.inventory_forecasts
    FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = (SELECT auth.uid()) AND p.is_active
          AND p.role IN ('admin', 'manager')
          AND (p.store_id = inventory_forecasts.store_id OR (p.role = 'manager' AND p.global_access))
    ));

GRANT SELECT ON public.sales_forecasts, public.inventory_forecasts TO authenticated;

-- Only the authorized RPC and the database scheduler may call the implementation.
CREATE SCHEMA IF NOT EXISTS forecast_private;
REVOKE ALL ON SCHEMA forecast_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION forecast_private.generate_store_forecasts(p_store_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET timezone = 'Asia/Manila'
AS $$
DECLARE
    v_store_id UUID := p_store_id;
    v_forecast_date DATE;
    v_day_offset INTEGER;
    v_avg_daily_sales NUMERIC(12, 2);
    v_avg_daily_count INTEGER;
    v_weekly_growth NUMERIC;
    v_history_days INTEGER;
    v_product_id UUID;
    v_product_stock INTEGER;
    v_product_avg_daily_demand NUMERIC;
    v_predicted_demand INTEGER;
    v_suggested_restock INTEGER;
    v_days_until_shortage INTEGER;
    v_confidence INTEGER;
    v_rows_inserted INTEGER := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = v_store_id) THEN
        RAISE EXCEPTION 'Store not found';
    END IF;
    -- Serialize generation for a store to avoid duplicate concurrent inserts.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_store_id::text, 0));
    DELETE FROM public.sales_forecasts WHERE store_id = v_store_id;
    DELETE FROM public.inventory_forecasts WHERE store_id = v_store_id;

    -- Include zero-sale days since the first recorded sale; do not invent demand
    -- for a store that has never completed a sale.
    SELECT CASE WHEN COUNT(*) = 0 THEN NULL
                ELSE LEAST(90, CURRENT_DATE - MIN(created_at::date) + 1) END
    INTO v_history_days FROM public.sales
    WHERE store_id = v_store_id AND status = 'completed';
    IF v_history_days IS NULL THEN
        RETURN jsonb_build_object('store_id', v_store_id, 'status', 'awaiting_sales',
            'sales_forecasts_generated', 0, 'inventory_forecasts_generated', 0);
    END IF;
    SELECT COALESCE(SUM(total_amount), 0) / GREATEST(v_history_days, 1),
           COUNT(*) / GREATEST(v_history_days, 1)
    INTO v_avg_daily_sales, v_avg_daily_count
    FROM public.sales
    WHERE store_id = v_store_id AND status = 'completed'
      AND created_at >= CURRENT_DATE - 89;

    SELECT COALESCE(
        (SELECT AVG(daily_sales) FROM (
            SELECT DATE(created_at) as sale_date, SUM(total_amount) as daily_sales
            FROM public.sales WHERE store_id = v_store_id AND status = 'completed'
              AND created_at >= NOW() - INTERVAL '7 days' GROUP BY DATE(created_at)
        ) recent) /
        NULLIF(
            (SELECT AVG(daily_sales) FROM (
                SELECT DATE(created_at) as sale_date, SUM(total_amount) as daily_sales
                FROM public.sales WHERE store_id = v_store_id AND status = 'completed'
                  AND created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days'
                GROUP BY DATE(created_at)
            ) previous), 0
        ), 1
    ) INTO v_weekly_growth;

    IF v_weekly_growth IS NULL OR v_weekly_growth = 0 THEN
        v_weekly_growth := 1;
    END IF;

    v_weekly_growth := LEAST(2, GREATEST(0.5, v_weekly_growth));

    v_confidence := CASE 
        WHEN v_avg_daily_count > 20 THEN 85
        WHEN v_avg_daily_count > 10 THEN 70
        WHEN v_avg_daily_count > 0 THEN 55
        ELSE 30
    END;

    IF v_history_days < 7 THEN v_confidence := LEAST(v_confidence, 30); END IF;

    FOR v_day_offset IN 1..14 LOOP
        v_forecast_date := CURRENT_DATE + v_day_offset;
        INSERT INTO public.sales_forecasts (store_id, forecast_date, period_type, predicted_sales, confidence_score, created_at)
        VALUES (v_store_id, v_forecast_date, 'daily', ROUND(v_avg_daily_sales * POWER(v_weekly_growth, v_day_offset / 7.0), 2), v_confidence, NOW());
        v_rows_inserted := v_rows_inserted + 1;
    END LOOP;

    FOR v_product_id, v_product_stock IN SELECT id, current_stock FROM public.products WHERE store_id = v_store_id LOOP
        SELECT COALESCE(SUM(si.quantity), 0)::numeric / GREATEST(LEAST(v_history_days, 30), 1)
        INTO v_product_avg_daily_demand
        FROM public.sales s JOIN public.sale_items si ON si.sale_id = s.id
        WHERE s.store_id = v_store_id AND s.status = 'completed'
          AND si.product_id = v_product_id AND s.created_at >= CURRENT_DATE - 29;

        IF v_product_avg_daily_demand IS NULL THEN
            v_product_avg_daily_demand := 0;
        END IF;

        v_predicted_demand := CEIL(v_product_avg_daily_demand * 7 * v_weekly_growth)::INTEGER;
        v_suggested_restock := GREATEST(v_predicted_demand - v_product_stock, 0)::INTEGER;
        v_days_until_shortage := CASE 
            WHEN v_product_avg_daily_demand > 0 THEN FLOOR(v_product_stock / v_product_avg_daily_demand)::INTEGER
            ELSE NULL
        END;

        INSERT INTO public.inventory_forecasts (store_id, product_id, forecast_date, predicted_demand, confidence_score, is_anomaly, current_stock, suggested_restock, days_until_shortage, created_at)
        VALUES (v_store_id, v_product_id, CURRENT_DATE + INTERVAL '7 days', v_predicted_demand, v_confidence, (v_product_stock < v_predicted_demand * 0.3), v_product_stock, v_suggested_restock, v_days_until_shortage, NOW());
    END LOOP;

    RETURN jsonb_build_object(
        'store_id', v_store_id,
        'sales_forecasts_generated', v_rows_inserted,
        'inventory_forecasts_generated', (SELECT COUNT(*) FROM public.products WHERE store_id = v_store_id),
        'avg_daily_sales', v_avg_daily_sales,
        'confidence_score', v_confidence,
        'generated_at', NOW()
    );
END;
$$;

REVOKE ALL ON FUNCTION forecast_private.generate_store_forecasts(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_forecasts(p_store_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active
          AND p.role IN ('admin', 'manager')
          AND (p.store_id = p_store_id OR (p.role = 'manager' AND p.global_access))
    ) THEN
        RAISE EXCEPTION 'Not authorized to generate forecasts for this store' USING ERRCODE = '42501';
    END IF;
    RETURN forecast_private.generate_store_forecasts(p_store_id);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_forecasts(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_forecasts(UUID) TO authenticated;

CREATE OR REPLACE VIEW public.stock_shortage_alerts WITH (security_invoker = true) AS
SELECT 
    p.id AS product_id,
    p.name AS product_name,
    p.sku,
    p.current_stock,
    inf.predicted_demand,
    inf.suggested_restock,
    inf.days_until_shortage,
    inf.confidence_score,
    inf.is_anomaly,
    s.name AS store_name,
    inf.store_id
FROM public.inventory_forecasts inf
JOIN public.products p ON p.id = inf.product_id
JOIN public.stores s ON s.id = inf.store_id
WHERE inf.days_until_shortage IS NOT NULL AND inf.days_until_shortage <= 7
ORDER BY inf.days_until_shortage ASC NULLS LAST;

GRANT SELECT ON public.stock_shortage_alerts TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Runs without an open browser. Only the database owner can invoke this job.
CREATE OR REPLACE FUNCTION forecast_private.refresh_all_forecasts()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_store UUID;
BEGIN
    FOR v_store IN SELECT id FROM public.stores LOOP
        PERFORM forecast_private.generate_store_forecasts(v_store);
    END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION forecast_private.refresh_all_forecasts() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('refresh-store-forecasts', '5 * * * *',
    'SELECT forecast_private.refresh_all_forecasts()');
SELECT forecast_private.refresh_all_forecasts();
