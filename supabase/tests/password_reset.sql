-- Run as the database owner against a test database after the migration.
-- Everything, including the temporary Auth account, is rolled back.
begin;
do $$
declare
    v_user uuid := gen_random_uuid();
    v_id uuid := gen_random_uuid();
    v_email text := 'reset-test-' || gen_random_uuid() || '@example.com';
    v_key text := gen_random_uuid()::text;
    v_ip text := gen_random_uuid()::text;
    v_result jsonb;
    v_count integer;
begin
    insert into auth.users(id,email,email_confirmed_at) values(v_user,v_email,now());
    v_result := public.request_password_reset(v_id,v_email,v_key,v_ip,'code-hash');
    if not (v_result->>'deliver')::boolean then raise exception 'Known confirmed account must be deliverable'; end if;
    if not (public.request_password_reset(gen_random_uuid(),v_email,v_key,v_ip,'code-hash')->>'limited')::boolean then raise exception 'Cooldown must be enforced'; end if;
    if public.verify_password_reset(v_id,'wrong','grant-hash') then raise exception 'Wrong code accepted'; end if;
    if not public.verify_password_reset(v_id,'code-hash','grant-hash') then raise exception 'Valid code rejected'; end if;
    if public.verify_password_reset(v_id,'code-hash','other-grant') then raise exception 'Code replay accepted'; end if;
    if public.consume_password_reset(v_id,'bad-grant') is not null then raise exception 'Wrong grant accepted'; end if;
    if public.consume_password_reset(v_id,'grant-hash') is distinct from v_user then raise exception 'Valid grant rejected'; end if;
    if public.consume_password_reset(v_id,'grant-hash') is not null then raise exception 'Grant replay accepted'; end if;

    -- Cooldown elapsed: issue another challenge, lock it after five failed attempts.
    update password_reset_private.limits set last_sent=now()-interval '2 minutes' where key='email:' || v_key;
    v_id := gen_random_uuid();
    perform public.request_password_reset(v_id,v_email,v_key,v_ip,'code-hash');
    for i in 1..5 loop perform public.verify_password_reset(v_id,'wrong','grant'); end loop;
    if public.verify_password_reset(v_id,'code-hash','grant') then raise exception 'Attempt limit bypassed'; end if;

    -- A resend must invalidate the old challenge.
    update password_reset_private.limits set last_sent=now()-interval '2 minutes' where key='email:' || v_key;
    perform public.request_password_reset(gen_random_uuid(),v_email,v_key,v_ip,'new-code');
    select count(*) into v_count from password_reset_private.challenges where id=v_id;
    if v_count <> 0 then raise exception 'Resend did not invalidate old challenge'; end if;
    select id into v_id from password_reset_private.challenges where email_key=v_key;
    update password_reset_private.challenges set expires_at=now()-interval '1 second' where id=v_id;
    if public.verify_password_reset(v_id,'new-code','grant') then raise exception 'Expired code accepted'; end if;

    v_id := gen_random_uuid();
    v_result := public.request_password_reset(v_id,'unknown-' || v_email,gen_random_uuid()::text,gen_random_uuid()::text,'code-hash');
    if (v_result->>'deliver')::boolean then raise exception 'Unknown account marked deliverable'; end if;
    if public.verify_password_reset(v_id,'code-hash','grant') then raise exception 'Unknown account verified'; end if;

    update password_reset_private.limits set requests=5,last_sent=now()-interval '2 minutes' where key='email:' || v_key;
    if not (public.request_password_reset(gen_random_uuid(),v_email,v_key,v_ip,'code')->>'limited')::boolean then raise exception 'Email hourly limit bypassed'; end if;
    update password_reset_private.limits set requests=20 where key='ip:' || v_ip;
    if not (public.request_password_reset(gen_random_uuid(),v_email,gen_random_uuid()::text,v_ip,'code')->>'limited')::boolean then raise exception 'IP hourly limit bypassed'; end if;

    if has_function_privilege('anon','public.verify_password_reset(uuid,text,text)','EXECUTE')
       or has_function_privilege('authenticated','public.consume_password_reset(uuid,text)','EXECUTE')
       or has_schema_privilege('anon','password_reset_private','USAGE')
       or has_schema_privilege('authenticated','password_reset_private','USAGE') then
       raise exception 'Browser role can access recovery credentials';
    end if;
    if not has_function_privilege('service_role','public.request_password_reset(uuid,text,text,text,text)','EXECUTE') then raise exception 'Server role cannot request resets'; end if;
end;
$$;
rollback;
