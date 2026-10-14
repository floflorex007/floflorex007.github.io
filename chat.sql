-- =========================================================
-- BetLab : chat du groupe (version B de demo-chat-groupe.html)
--
-- - Un chat par groupe : seuls les membres lisent et écrivent.
-- - Messages de 1 à 300 caractères.
-- - Tout est effacé chaque lundi à 0 h (heure de Paris) :
--   les messages d'avant ne sont plus lisibles, et ils sont
--   supprimés de la base au premier message de la semaine.
-- - Mis à jour en direct (Supabase Realtime).
--
-- À lancer après groupes.sql.
-- =========================================================


create table if not exists public.chat_messages (
    id bigint generated always as identity primary key,
    group_id uuid not null references public.groups(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    content text not null check (char_length(content) between 1 and 300),
    created_at timestamptz not null default now()
);

create index if not exists chat_messages_group_idx on public.chat_messages (group_id, created_at);


-- Début de la semaine en cours : lundi 0 h, heure de Paris.
create or replace function public.chat_week_start()
returns timestamptz
language sql
stable
as $$
    select date_trunc('week', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris';
$$;


alter table public.chat_messages enable row level security;

drop policy if exists "chat lecture" on public.chat_messages;

create policy "chat lecture"
    on public.chat_messages
    for select
    using (public.is_group_member(group_id) and created_at >= public.chat_week_start());

-- Pas de policy insert/update/delete : on écrit seulement par send_chat_message.


create or replace function public.send_chat_message(p_group uuid, p_content text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_content text := btrim(coalesce(p_content, ''));
    v_id bigint;
begin
    if auth.uid() is null then
        raise exception 'Tu dois être connecté.';
    end if;

    if not is_group_member(p_group) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    if char_length(v_content) = 0 then
        raise exception 'Le message est vide.';
    end if;

    if char_length(v_content) > 300 then
        raise exception 'Le message dépasse 300 caractères.';
    end if;

    -- Ménage de la semaine : on supprime les messages d'avant lundi 0 h (tous les groupes).
    delete from chat_messages where created_at < chat_week_start();

    insert into chat_messages (group_id, user_id, content)
    values (p_group, auth.uid(), v_content)
    returning id into v_id;

    return v_id;
end;
$$;

revoke all on function public.send_chat_message(uuid, text) from public, anon;
grant execute on function public.send_chat_message(uuid, text) to authenticated;


-- Direct : les nouveaux messages arrivent sans recharger.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = 'chat_messages'
    ) then
        alter publication supabase_realtime add table public.chat_messages;
    end if;
end;
$$;
