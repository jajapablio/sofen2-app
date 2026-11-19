-- Signup is not provisioned until mailbox ownership has been proven.
create schema if not exists signup_private;
revoke all on schema signup_private from public, anon, authenticated;
create table signup_private.limits (
    key text primary key,
    window_start timestamptz not null,
    last_sent timestamptz not null,
    requests integer not null
);
create table signup_private.challenges (
    id uuid primary key,
    email_key text not null unique,
    code_hash text not null,
    expires_at timestamptz not null,
    attempts integer not null default 0
);
create index signup_verification_expiry on signup_private.challenges(expires_at);
create index signup_verification_limits_expiry on signup_private.limits(window_start);
alter table signup_private.limits enable row level security;
alter table signup_private.challenges enable row level security;
revoke all on all tables in schema signup_private from public, anon, authenticated;

-- Privileged only for the server. auth.uid() does not exist before signup.
create function public.request_signup_verification(p_id uuid,p_email_key text,p_ip_key text,p_code_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_key text; v_row signup_private.limits%rowtype; v_now timestamptz:=clock_timestamp();
begin
    perform pg_advisory_xact_lock(hashtextextended('signup-email:'||p_email_key,0));
    perform pg_advisory_xact_lock(hashtextextended('signup-ip:'||p_ip_key,1));
    delete from signup_private.challenges where expires_at<v_now;
    delete from signup_private.limits where window_start<v_now-interval '24 hours';
    foreach v_key in array array['email:'||p_email_key,'ip:'||p_ip_key] loop
        select * into v_row from signup_private.limits where key=v_key;
        if found and v_row.window_start>v_now-interval '1 hour' then
            if (v_key='email:'||p_email_key and (v_row.requests>=5 or v_row.last_sent>v_now-interval '60 seconds'))
                or (v_key='ip:'||p_ip_key and v_row.requests>=20) then
                return jsonb_build_object('limited',true);
            end if;
        end if;
    end loop;
    foreach v_key in array array['email:'||p_email_key,'ip:'||p_ip_key] loop
        insert into signup_private.limits as l values(v_key,v_now,v_now,1)
        on conflict(key) do update set
            requests=case when l.window_start>v_now-interval '1 hour' then l.requests+1 else 1 end,
            window_start=case when l.window_start>v_now-interval '1 hour' then l.window_start else v_now end,
            last_sent=v_now;
    end loop;
    delete from signup_private.challenges where email_key=p_email_key;
    insert into signup_private.challenges(id,email_key,code_hash,expires_at)
    values(p_id,p_email_key,p_code_hash,v_now+interval '10 minutes');
    return jsonb_build_object('limited',false);
end;
$$;

create function public.consume_signup_verification(p_id uuid,p_email_key text,p_code_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_row signup_private.challenges%rowtype;
begin
    select * into v_row from signup_private.challenges where id=p_id for update;
    if not found or v_row.expires_at<=clock_timestamp() or v_row.attempts>=5 then return false; end if;
    update signup_private.challenges set attempts=attempts+1 where id=p_id;
    if v_row.email_key<>p_email_key or v_row.code_hash<>p_code_hash then return false; end if;
    delete from signup_private.challenges where id=p_id;
    return true;
end;
$$;

create function public.invalidate_signup_verification(p_id uuid)
returns void language sql security definer set search_path='' as $$
    delete from signup_private.challenges where id=p_id;
$$;

-- Store, profile, and audit all commit together. This wrapper preserves existing
-- owner privileges, but cannot be called by either browser role.
create function public.provision_verified_store_owner(p_user_id uuid,p_full_name text,p_username text,p_store_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_store uuid;
begin
    if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null and deleted_at is null) then
        raise exception 'Verified account required' using errcode='42501';
    end if;
    -- Also make retries unable to create another store for the same account.
    perform pg_advisory_xact_lock(hashtextextended('signup-owner:'||p_user_id::text,0));
    if exists(select 1 from public.profiles where id=p_user_id and store_id is not null) then
        raise exception 'Account is already provisioned' using errcode='23505';
    end if;
    v_store:=public.register_store_owner(p_user_id,p_full_name,p_username,p_store_name);
    update public.profiles set role='admin',global_access=true,is_active=true where id=p_user_id;
    insert into public.audit_logs(actor_id,store_id,action,entity_table,entity_id,after_data)
    values(p_user_id,v_store,'create','stores',v_store::text,
        jsonb_build_object('name',btrim(p_store_name),'owner_username',lower(btrim(p_username))));
    return v_store;
end;
$$;

revoke all on function public.request_signup_verification(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.consume_signup_verification(uuid,text,text) from public,anon,authenticated;
revoke all on function public.invalidate_signup_verification(uuid) from public,anon,authenticated;
revoke all on function public.provision_verified_store_owner(uuid,text,text,text) from public,anon,authenticated;
-- Keep the legacy provisioning RPC server-only as well, preventing a direct client bypass.
revoke all on function public.register_store_owner(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.request_signup_verification(uuid,text,text,text) to service_role;
grant execute on function public.consume_signup_verification(uuid,text,text) to service_role;
grant execute on function public.invalidate_signup_verification(uuid) to service_role;
grant execute on function public.provision_verified_store_owner(uuid,text,text,text) to service_role;
grant execute on function public.register_store_owner(uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
