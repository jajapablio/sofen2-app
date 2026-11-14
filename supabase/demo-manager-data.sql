-- ============================================================================
-- PredictPOS — Manager Dashboard Demo Data Setup
-- Run this entire block in Supabase SQL Editor as the Project Owner.
-- ============================================================================

-- 0. PREREQUISITE REMINDER
-- If you haven't already, run these first so the cashier payment flow works:
--   supabase/void_sale.sql
--   supabase/payment_simulator.sql
-- This script only handles Purchase Orders + Demand Forecasts demo data.

-- 1. Ensure tables exist (safe to re-run; won't overwrite existing data)
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    suggested_quantity INTEGER NOT NULL CHECK (suggested_quantity > 0),
    status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'rejected', 'completed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.inventory_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    forecast_date DATE NOT NULL,
    predicted_demand INTEGER NOT NULL CHECK (predicted_demand >= 0),
    confidence_score INTEGER CHECK (confidence_score BETWEEN 0 AND 100),
    is_anomaly BOOLEAN NOT NULL DEFAULT false
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS purchase_orders_store_idx ON public.purchase_orders(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON public.purchase_orders(store_id, status);
CREATE INDEX IF NOT EXISTS inventory_forecasts_product_date_idx ON public.inventory_forecasts(product_id, forecast_date);

-- 2. Row Level Security (so your Next.js app can read and write these tables)
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_forecasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view purchase orders" ON public.purchase_orders;
CREATE POLICY "Authenticated users can view purchase orders" ON public.purchase_orders
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can create purchase orders" ON public.purchase_orders;
CREATE POLICY "Authenticated users can create purchase orders" ON public.purchase_orders
    FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update purchase orders" ON public.purchase_orders;
CREATE POLICY "Authenticated users can update purchase orders" ON public.purchase_orders
    FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view inventory forecasts" ON public.inventory_forecasts;
CREATE POLICY "Authenticated users can view inventory forecasts" ON public.inventory_forecasts
    FOR SELECT TO authenticated USING (true);

-- 3. Insert demo data (auto-detects your store + product UUIDs)
DO $$
DECLARE
    v_store_id UUID;
    v_product_id UUID;
    v_admin_id UUID;
BEGIN
    -- Pick the first store
    SELECT id INTO v_store_id FROM public.stores LIMIT 1;

    -- Pick the first product belonging to that store
    SELECT id INTO v_product_id FROM public.products WHERE store_id = v_store_id LIMIT 1;

    -- Pick an admin profile for the approved_by field
    SELECT id INTO v_admin_id FROM public.profiles WHERE role = 'admin' AND is_active LIMIT 1;

    IF v_store_id IS NULL THEN
        RAISE NOTICE 'ERROR: No stores found. Please create a store first.';
    ELSIF v_product_id IS NULL THEN
        RAISE NOTICE 'ERROR: No products found for store %. Please add products first.', v_store_id;
    ELSE
        RAISE NOTICE 'Demo setup using store: %', v_store_id;
        RAISE NOTICE 'Demo setup using product: %', v_product_id;

        -- Clean any previous demo data for this product/store so re-running is clean
        DELETE FROM public.inventory_forecasts WHERE product_id = v_product_id;
        DELETE FROM public.purchase_orders WHERE store_id = v_store_id AND product_id = v_product_id;

        -- Purchase Order 1: Pending -> Manager will see an "Approve" button in the dashboard
        INSERT INTO public.purchase_orders (store_id, product_id, suggested_quantity, status, created_at, approved_by)
        VALUES (v_store_id, v_product_id, 50, 'pending_approval', NOW(), NULL);

        -- Purchase Order 2: Already approved -> Shows status with no button
        INSERT INTO public.purchase_orders (store_id, product_id, suggested_quantity, status, created_at, approved_by)
        VALUES (v_store_id, v_product_id, 30, 'approved', NOW() - INTERVAL '2 days', v_admin_id);

        -- Demand Forecast 1: Tomorrow, high confidence, no anomaly
        INSERT INTO public.inventory_forecasts (product_id, forecast_date, predicted_demand, confidence_score, is_anomaly)
        VALUES (v_product_id, CURRENT_DATE + INTERVAL '1 day', 25, 92, false);

        -- Demand Forecast 2: Day after tomorrow, flagged as anomaly
        INSERT INTO public.inventory_forecasts (product_id, forecast_date, predicted_demand, confidence_score, is_anomaly)
        VALUES (v_product_id, CURRENT_DATE + INTERVAL '2 day', 40, 78, true);

        RAISE NOTICE 'SUCCESS: Demo purchase orders and forecasts inserted.';
    END IF;
END $$;

-- 4. Verify what was inserted
SELECT 'purchase_orders' AS table_name, count(*) AS row_count FROM public.purchase_orders
UNION ALL
SELECT 'inventory_forecasts', count(*) FROM public.inventory_forecasts;

-- Detailed view: Purchase Orders
SELECT 
    po.id,
    po.store_id,
    po.product_id,
    po.suggested_quantity,
    po.status,
    po.created_at,
    po.approved_by
FROM public.purchase_orders po
ORDER BY po.created_at DESC
LIMIT 10;

-- Detailed view: Demand Forecasts
SELECT 
    inf.id,
    inf.product_id,
    inf.forecast_date,
    inf.predicted_demand,
    inf.confidence_score,
    inf.is_anomaly
FROM public.inventory_forecasts inf
ORDER BY inf.forecast_date
LIMIT 10;