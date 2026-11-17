-- Recovery credentials are server-only. No browser role can read tables or call RPCs.
create schema if not exists password_reset_private;
revoke all on schema password_reset_private from public, anon, authenticated;

create table password_reset_private.limits (
    key text primary key,
    window_start timestamptz not null,
    last_sent timestamptz not null,
    requests integer not null
);
create table password_reset_private.challenges (
    id uuid primary key,
    email_key text not null unique,
    user_id uuid references auth.users(id) on delete cascade,
    code_hash text not null,
    expires_at timestamptz not null,
    attempts integer not null default 0,
    grant_hash text,
    verified_at timestamptz
);
create index password_reset_expiry on password_reset_private.challenges(expires_at);
create index password_reset_limits_expiry on password_reset_private.limits(window_start);
alter table password_reset_private.limits enable row level security;
alter table password_reset_private.challenges enable row level security;
revoke all on all tables in schema password_reset_private from public, anon, authenticated;

-- Privileged by design: only service_role has EXECUTE. auth.uid() is unavailable
-- during unauthenticated recovery; the account is resolved here from auth.users.
create function public.request_password_reset(p_id uuid, p_email text, p_email_key text, p_ip_key text, p_code_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_key text;
    v_limit password_reset_private.limits%rowtype;
    v_user uuid;
    v_now timestamptz := clock_timestamp();
begin
    -- Stable lock order serializes limits even across concurrent requests/instances.
    perform pg_advisory_xact_lock(hashtextextended('email:' || p_email_key, 0));
    perform pg_advisory_xact_lock(hashtextextended('ip:' || p_ip_key, 1));
    delete from password_reset_private.challenges where expires_at < v_now;
    delete from password_reset_private.limits where window_start < v_now - interval '24 hours';
    foreach v_key in array array['email:' || p_email_key, 'ip:' || p_ip_key] loop
        select * into v_limit from password_reset_private.limits where key = v_key;
        if found and v_limit.window_start > v_now - interval '1 hour' then
            if (v_key = 'email:' || p_email_key and (v_limit.requests >= 5 or v_limit.last_sent > v_now - interval '60 seconds'))
                or (v_key = 'ip:' || p_ip_key and v_limit.requests >= 20) then
                return jsonb_build_object('limited', true);
            end if;
        end if;
    end loop;
    foreach v_key in array array['email:' || p_email_key, 'ip:' || p_ip_key] loop
        insert into password_reset_private.limits as l values (v_key, v_now, v_now, 1)
        on conflict (key) do update set
            requests = case when l.window_start > v_now - interval '1 hour' then l.requests + 1 else 1 end,
            window_start = case when l.window_start > v_now - interval '1 hour' then l.window_start else v_now end,
            last_sent = v_now;
    end loop;
    select id into v_user from auth.users
    where lower(email) = lower(p_email) and deleted_at is null
      and (banned_until is null or banned_until < v_now)
      and email_confirmed_at is not null
    limit 1;
    delete from password_reset_private.challenges where email_key = p_email_key;
    insert into password_reset_private.challenges(id, email_key, user_id, code_hash, expires_at)
    values (p_id, p_email_key, v_user, p_code_hash, v_now + interval '10 minutes');
    return jsonb_build_object('limited', false, 'deliver', v_user is not null);
end;
$$;

create function public.verify_password_reset(p_id uuid, p_code_hash text, p_grant_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_row password_reset_private.challenges%rowtype;
begin
    select * into v_row from password_reset_private.challenges where id = p_id for update;
    if not found or v_row.expires_at <= clock_timestamp() or v_row.attempts >= 5 or v_row.verified_at is not null then return false; end if;
    update password_reset_private.challenges set attempts = attempts + 1 where id = p_id;
    if v_row.user_id is null or v_row.code_hash <> p_code_hash then return false; end if;
    update password_reset_private.challenges
    set grant_hash = p_grant_hash, verified_at = clock_timestamp(),
        expires_at = least(expires_at, clock_timestamp() + interval '5 minutes')
    where id = p_id;
    return true;
end;
$$;

create function public.consume_password_reset(p_id uuid, p_grant_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
    delete from password_reset_private.challenges
    where id = p_id and grant_hash = p_grant_hash and verified_at is not null
        and expires_at > clock_timestamp()
    returning user_id into v_user;
    return v_user;
end;
$$;

create function public.invalidate_password_reset(p_id uuid)
returns void language sql security definer set search_path = '' as $$
    delete from password_reset_private.challenges where id = p_id;
$$;

revoke all on function public.request_password_reset(uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.verify_password_reset(uuid,text,text) from public, anon, authenticated;
revoke all on function public.consume_password_reset(uuid,text) from public, anon, authenticated;
revoke all on function public.invalidate_password_reset(uuid) from public, anon, authenticated;
grant execute on function public.request_password_reset(uuid,text,text,text,text) to service_role;
grant execute on function public.verify_password_reset(uuid,text,text) to service_role;
grant execute on function public.consume_password_reset(uuid,text) to service_role;
grant execute on function public.invalidate_password_reset(uuid) to service_role;
