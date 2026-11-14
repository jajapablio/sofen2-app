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

CREATE INDEX IF NOT EXISTS sales_forecasts_store_date_idx ON public.sales_forecasts(store_id, forecast_date);
CREATE INDEX IF NOT EXISTS inventory_forecasts_store_date_idx ON public.inventory_forecasts(store_id, forecast_date);
CREATE INDEX IF NOT EXISTS inventory_forecasts_product_idx ON public.inventory_forecasts(product_id);

ALTER TABLE public.sales_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_forecasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view sales forecasts" ON public.sales_forecasts;
CREATE POLICY "Authenticated users can view sales forecasts" ON public.sales_forecasts
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view inventory forecasts" ON public.inventory_forecasts;
CREATE POLICY "Authenticated users can view inventory forecasts" ON public.inventory_forecasts
    FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.generate_forecasts(p_store_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_store_id UUID := p_store_id;
    v_forecast_date DATE;
    v_day_offset INTEGER;
    v_avg_daily_sales NUMERIC(12, 2);
    v_avg_daily_count INTEGER;
    v_weekly_growth NUMERIC(5, 4);
    v_product_id UUID;
    v_product_stock INTEGER;
    v_product_avg_daily_demand NUMERIC;
    v_predicted_demand INTEGER;
    v_suggested_restock INTEGER;
    v_days_until_shortage INTEGER;
    v_confidence INTEGER;
    v_rows_inserted INTEGER := 0;
BEGIN
    DELETE FROM public.sales_forecasts WHERE store_id = v_store_id;
    DELETE FROM public.inventory_forecasts WHERE store_id = v_store_id;

    SELECT COALESCE(AVG(daily_sales), 0), COALESCE(AVG(daily_count), 0)
    INTO v_avg_daily_sales, v_avg_daily_count
    FROM (
        SELECT DATE(created_at) as sale_date, SUM(total_amount) as daily_sales, COUNT(*) as daily_count
        FROM public.sales
        WHERE store_id = v_store_id AND status = 'completed' AND created_at >= NOW() - INTERVAL '90 days'
        GROUP BY DATE(created_at)
    ) AS daily_stats;

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

    v_confidence := CASE 
        WHEN v_avg_daily_count > 20 THEN 85
        WHEN v_avg_daily_count > 10 THEN 70
        WHEN v_avg_daily_count > 0 THEN 55
        ELSE 30
    END;

    FOR v_day_offset IN 1..14 LOOP
        v_forecast_date := CURRENT_DATE + v_day_offset;
        INSERT INTO public.sales_forecasts (store_id, forecast_date, period_type, predicted_sales, confidence_score, created_at)
        VALUES (v_store_id, v_forecast_date, 'daily', ROUND(v_avg_daily_sales * POWER(v_weekly_growth, v_day_offset / 7.0), 2), v_confidence, NOW());
        v_rows_inserted := v_rows_inserted + 1;
    END LOOP;

    FOR v_product_id, v_product_stock IN SELECT id, current_stock FROM public.products WHERE store_id = v_store_id LOOP
        SELECT COALESCE(AVG(daily_demand), 0)
        INTO v_product_avg_daily_demand
        FROM (
            SELECT DATE(s.created_at) as sale_date, SUM(si.quantity) as daily_demand
            FROM public.sales s JOIN public.sale_items si ON si.sale_id = s.id
            WHERE s.store_id = v_store_id AND s.status = 'completed' AND si.product_id = v_product_id
              AND s.created_at >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(s.created_at)
        ) AS product_daily;

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

REVOKE ALL ON FUNCTION public.generate_forecasts(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_forecasts(UUID) TO authenticated;

CREATE OR REPLACE VIEW public.stock_shortage_alerts AS
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
    s.name AS store_name
FROM public.inventory_forecasts inf
JOIN public.products p ON p.id = inf.product_id
JOIN public.stores s ON s.id = inf.store_id
WHERE inf.days_until_shortage IS NOT NULL AND inf.days_until_shortage <= 7
ORDER BY inf.days_until_shortage ASC NULLS LAST;

GRANT SELECT ON public.stock_shortage_alerts TO authenticated;