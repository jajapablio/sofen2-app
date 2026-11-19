-- Run as database owner on a test database after the signup migration.
-- All test records, including Auth users and stores, are rolled back.
begin;
do $$
declare
    v_id uuid:=gen_random_uuid();
    v_key text:=gen_random_uuid()::text;
    v_ip text:=gen_random_uuid()::text;
    v_user uuid:=gen_random_uuid();
    v_unverified uuid:=gen_random_uuid();
    v_user_two uuid:=gen_random_uuid();
    v_username text:='sv_'||substr(replace(gen_random_uuid()::text,'-',''),1,16);
    v_store uuid;
    v_store_name text:='Signup verification test '||gen_random_uuid();
    v_store_count bigint;
begin
    if (public.request_signup_verification(v_id,v_key,v_ip,'code-hash')->>'limited')::boolean then raise exception 'First send rejected'; end if;
    if not (public.request_signup_verification(gen_random_uuid(),v_key,v_ip,'code-hash')->>'limited')::boolean then raise exception 'Cooldown bypassed'; end if;
    if public.consume_signup_verification(v_id,'other-email','code-hash') then raise exception 'Email binding bypassed'; end if;
    if public.consume_signup_verification(v_id,v_key,'wrong') then raise exception 'Wrong code accepted'; end if;
    if not public.consume_signup_verification(v_id,v_key,'code-hash') then raise exception 'Valid code rejected'; end if;
    if public.consume_signup_verification(v_id,v_key,'code-hash') then raise exception 'Code replay accepted'; end if;

    update signup_private.limits set last_sent=now()-interval '2 minutes' where key='email:'||v_key;
    v_id:=gen_random_uuid();perform public.request_signup_verification(v_id,v_key,v_ip,'code');
    for i in 1..5 loop perform public.consume_signup_verification(v_id,v_key,'wrong'); end loop;
    if public.consume_signup_verification(v_id,v_key,'code') then raise exception 'Attempt lockout bypassed'; end if;
    update signup_private.limits set last_sent=now()-interval '2 minutes' where key='email:'||v_key;
    perform public.request_signup_verification(gen_random_uuid(),v_key,v_ip,'new-code');
    if exists(select 1 from signup_private.challenges where id=v_id) then raise exception 'Old challenge survived resend'; end if;
    select id into v_id from signup_private.challenges where email_key=v_key;
    update signup_private.challenges set expires_at=now()-interval '1 second' where id=v_id;
    if public.consume_signup_verification(v_id,v_key,'new-code') then raise exception 'Expired code accepted'; end if;
    update signup_private.limits set requests=5,last_sent=now()-interval '2 minutes' where key='email:'||v_key;
    if not (public.request_signup_verification(gen_random_uuid(),v_key,v_ip,'code')->>'limited')::boolean then raise exception 'Email hourly limit bypassed'; end if;
    update signup_private.limits set requests=20 where key='ip:'||v_ip;
    if not (public.request_signup_verification(gen_random_uuid(),gen_random_uuid()::text,v_ip,'code')->>'limited')::boolean then raise exception 'IP hourly limit bypassed'; end if;

    insert into auth.users(id,email,email_confirmed_at) values
        (v_user,'signup-test-'||v_user||'@example.com',now()),
        (v_user_two,'signup-test-'||v_user_two||'@example.com',now()),
        (v_unverified,'signup-test-'||v_unverified||'@example.com',null);
    begin
        perform public.provision_verified_store_owner(v_unverified,'Test owner','unverified_'||substr(v_username,4),v_store_name);
        raise exception 'Unverified account was provisioned';
    exception when insufficient_privilege then null; end;
    v_store:=public.provision_verified_store_owner(v_user,'Test owner',v_username,v_store_name);
    if not exists(select 1 from public.profiles where id=v_user and store_id=v_store and role='admin' and is_active) then raise exception 'Owner profile missing'; end if;
    if not exists(select 1 from public.audit_logs where actor_id=v_user and store_id=v_store and entity_table='stores') then raise exception 'Audit missing'; end if;
    begin
        perform public.provision_verified_store_owner(v_user,'Test owner',v_username,v_store_name);
        raise exception 'Duplicate account provisioning succeeded';
    exception when unique_violation then null; end;
    select count(*) into v_store_count from public.stores;
    begin
        perform public.provision_verified_store_owner(v_user_two,'Other owner',v_username,v_store_name||' rollback');
        raise exception 'Duplicate username accepted';
    exception when unique_violation then null; end;
    if (select count(*) from public.stores)<>v_store_count then raise exception 'Failed provisioning left an orphan store'; end if;
    if has_function_privilege('anon','public.request_signup_verification(uuid,text,text,text)','EXECUTE')
       or has_function_privilege('authenticated','public.consume_signup_verification(uuid,text,text)','EXECUTE')
       or has_function_privilege('anon','public.register_store_owner(uuid,text,text,text)','EXECUTE')
       or has_function_privilege('authenticated','public.provision_verified_store_owner(uuid,text,text,text)','EXECUTE')
       or has_schema_privilege('anon','signup_private','USAGE')
       or has_schema_privilege('authenticated','signup_private','USAGE') then raise exception 'Browser role has privileged signup access'; end if;
    if not has_function_privilege('service_role','public.provision_verified_store_owner(uuid,text,text,text)','EXECUTE') then raise exception 'Server cannot provision'; end if;
end;
$$;
rollback;
