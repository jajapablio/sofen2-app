-- PROPOSED permission hardening: not yet applied to the live database.
-- Store-scoped requests. Managers create pending orders; only store admins approve.
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View Store Purchase Orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Update Store Purchase Orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Authenticated users can view purchase orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Authenticated users can create purchase orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Authenticated users can update purchase orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Store staff read purchase orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Store staff request purchase orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Store admins approve purchase orders" ON public.purchase_orders;
CREATE POLICY "Store staff read purchase orders" ON public.purchase_orders
FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_active
    AND p.role IN ('admin','manager') AND (p.store_id=purchase_orders.store_id OR (p.role='manager' AND p.global_access))
));
CREATE POLICY "Store staff request purchase orders" ON public.purchase_orders
FOR INSERT TO authenticated WITH CHECK (
    status='pending_approval' AND approved_by IS NULL AND suggested_quantity>0 AND generated_by_ml=false
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_active AND p.role IN ('admin','manager') AND p.store_id=purchase_orders.store_id)
    AND EXISTS (SELECT 1 FROM public.products pr WHERE pr.id=purchase_orders.product_id AND pr.store_id=purchase_orders.store_id)
);
CREATE POLICY "Store admins approve purchase orders" ON public.purchase_orders
FOR UPDATE TO authenticated USING (
    status='pending_approval' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_active AND p.role='admin' AND p.store_id=purchase_orders.store_id)
) WITH CHECK (
    status='approved' AND approved_by=(SELECT auth.uid()) AND suggested_quantity>0
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_active AND p.role='admin' AND p.store_id=purchase_orders.store_id)
    AND EXISTS (SELECT 1 FROM public.products pr WHERE pr.id=purchase_orders.product_id AND pr.store_id=purchase_orders.store_id)
);
GRANT SELECT, INSERT, UPDATE ON public.purchase_orders TO authenticated;
NOTIFY pgrst, 'reload schema';
