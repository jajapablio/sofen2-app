-- Run in the Supabase SQL Editor to enable store-scoped product reads and photo uploads.

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View Products" ON public.products;
DROP POLICY IF EXISTS "Insert Products" ON public.products;
DROP POLICY IF EXISTS "Update Products" ON public.products;
DROP POLICY IF EXISTS "Delete Products" ON public.products;
DROP POLICY IF EXISTS "View Store Products" ON public.products;
DROP POLICY IF EXISTS "Manage Store Products" ON public.products;
DROP POLICY IF EXISTS "Update Store Products" ON public.products;
DROP POLICY IF EXISTS "Delete Store Products" ON public.products;

CREATE POLICY "View Store Products" ON public.products
FOR SELECT TO authenticated
USING (
    (store_id = public.current_user_store_id() AND public.current_user_role() IN ('admin', 'manager', 'cashier'))
    OR (public.current_user_role() = 'manager' AND public.has_global_store_access())
);

CREATE POLICY "Manage Store Products" ON public.products
FOR INSERT TO authenticated
WITH CHECK (
    (store_id = public.current_user_store_id() AND public.current_user_role() IN ('admin', 'manager'))
    OR (public.current_user_role() = 'manager' AND public.has_global_store_access())
);

CREATE POLICY "Update Store Products" ON public.products
FOR UPDATE TO authenticated
USING (
    (store_id = public.current_user_store_id() AND public.current_user_role() IN ('admin', 'manager'))
    OR (public.current_user_role() = 'manager' AND public.has_global_store_access())
)
WITH CHECK (
    (store_id = public.current_user_store_id() AND public.current_user_role() IN ('admin', 'manager'))
    OR (public.current_user_role() = 'manager' AND public.has_global_store_access())
);

CREATE POLICY "Delete Store Products" ON public.products
FOR DELETE TO authenticated
USING (
    (store_id = public.current_user_store_id() AND public.current_user_role() IN ('admin', 'manager'))
    OR (public.current_user_role() = 'manager' AND public.has_global_store_access())
);

CREATE OR REPLACE FUNCTION public.can_manage_product_image(p_product_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.products AS product
        JOIN public.profiles AS profile ON profile.id = auth.uid()
        WHERE product.id::TEXT = p_product_id
          AND profile.is_active
          AND (
              (product.store_id = profile.store_id AND profile.role IN ('admin', 'manager'))
              OR (profile.role = 'manager' AND profile.global_access)
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.set_product_image_url(p_product_id UUID, p_image_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.can_manage_product_image(p_product_id::TEXT) THEN
        RAISE EXCEPTION 'You do not have permission to change this product image.';
    END IF;

    UPDATE public.products
    SET image_url = p_image_url,
        updated_at = NOW()
    WHERE id = p_product_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The product could not be found.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_product_image(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_product_image_url(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_product_image(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_image_url(UUID, TEXT) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', TRUE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public product image reads" ON storage.objects;
DROP POLICY IF EXISTS "Global admins upload product images" ON storage.objects;
DROP POLICY IF EXISTS "Global admins update product images" ON storage.objects;
DROP POLICY IF EXISTS "Global admins delete product images" ON storage.objects;

CREATE POLICY "Public product image reads" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'product-images');

CREATE POLICY "Global admins upload product images" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'product-images'
    AND public.can_manage_product_image((storage.foldername(name))[1])
);

CREATE POLICY "Global admins update product images" ON storage.objects
FOR UPDATE TO authenticated
USING (
    bucket_id = 'product-images'
    AND public.can_manage_product_image((storage.foldername(name))[1])
)
WITH CHECK (
    bucket_id = 'product-images'
    AND public.can_manage_product_image((storage.foldername(name))[1])
);

CREATE POLICY "Global admins delete product images" ON storage.objects
FOR DELETE TO authenticated
USING (
    bucket_id = 'product-images'
    AND public.can_manage_product_image((storage.foldername(name))[1])
);
