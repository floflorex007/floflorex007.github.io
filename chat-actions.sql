-- =========================================================
-- BetLab : actions du chat (version A de demo-chat-actions.html)
--
-- - Répondre à un message précis (chat_messages.reply_to).
-- - Modifier / supprimer SES messages (edited_at, deleted_at).
--   Un message supprimé reste affiché « Message supprimé ».
-- - Réactions 👍 😂 😮 😢 🔥 ❤️ : une par personne et par message,
--   re-cliquer l'enlève (emoji remis à null, pas de delete :
--   le direct ne sait pas filtrer les suppressions par groupe).
-- - Les bulles « … écrit » passent par le direct (broadcast),
--   rien à faire dans la base.
--
-- À lancer après chat.sql.
-- =========================================================


alter table public.chat_messages
    add column if not exists reply_to bigint references public.chat_messages(id) on delete set null,
    add column if not exists edited_at timestamptz,
    add column if not exists deleted_at timestamptz;


create table if not exists public.chat_reactions (
    message_id bigint not null references public.chat_messages(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    group_id uuid not null references public.groups(id) on delete cascade,
    emoji text check (emoji in ('👍', '😂', '😮', '😢', '🔥', '❤️')),
    updated_at timestamptz not null default now(),
    primary key (message_id, user_id)
);

create index if not exists chat_reactions_group_idx on public.chat_reactions (group_id);

alter table public.chat_reactions enable row level security;

drop policy if exists "chat reactions lecture" on public.chat_reactions;

create policy "chat reactions lecture"
    on public.chat_reactions
    for select
    using (public.is_group_member(group_id) and updated_at >= public.chat_week_start());


-- Envoi : nouvelle version avec la réponse (l'ancienne est remplacée).
drop function if exists public.send_chat_message(uuid, text);

create or replace function public.send_chat_message(p_group uuid, p_content text, p_reply_to bigint default null)
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

    if p_reply_to is not null and not exists (
        select 1 from chat_messages
        where id = p_reply_to and group_id = p_group and created_at >= chat_week_start()
    ) then
        raise exception 'Le message auquel tu réponds n''existe plus.';
    end if;

    -- Ménage de la semaine : on supprime les messages d'avant lundi 0 h (tous les groupes).
    delete from chat_messages where created_at < chat_week_start();

    insert into chat_messages (group_id, user_id, content, reply_to)
    values (p_group, auth.uid(), v_content, p_reply_to)
    returning id into v_id;

    return v_id;
end;
$$;

revoke all on function public.send_chat_message(uuid, text, bigint) from public, anon;
grant execute on function public.send_chat_message(uuid, text, bigint) to authenticated;


create or replace function public.edit_chat_message(p_message bigint, p_content text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_content text := btrim(coalesce(p_content, ''));
begin
    if char_length(v_content) = 0 then
        raise exception 'Le message est vide.';
    end if;

    if char_length(v_content) > 300 then
        raise exception 'Le message dépasse 300 caractères.';
    end if;

    update chat_messages
    set content = v_content,
        edited_at = now()
    where id = p_message
      and user_id = auth.uid()
      and deleted_at is null
      and created_at >= chat_week_start();

    if not found then
        raise exception 'Tu ne peux modifier que tes messages de la semaine.';
    end if;
end;
$$;

revoke all on function public.edit_chat_message(bigint, text) from public, anon;
grant execute on function public.edit_chat_message(bigint, text) to authenticated;


create or replace function public.delete_chat_message(p_message bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Le texte est effacé pour de bon ; la ligne reste pour « Message supprimé ».
    update chat_messages
    set content = '-',
        deleted_at = now()
    where id = p_message
      and user_id = auth.uid()
      and deleted_at is null;

    if not found then
        raise exception 'Tu ne peux supprimer que tes messages.';
    end if;

    update chat_reactions
    set emoji = null,
        updated_at = now()
    where message_id = p_message
      and emoji is not null;
end;
$$;

revoke all on function public.delete_chat_message(bigint) from public, anon;
grant execute on function public.delete_chat_message(bigint) to authenticated;


-- Réagir : même emoji = on l'enlève, autre emoji = on le remplace.
create or replace function public.react_chat_message(p_message bigint, p_emoji text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_group uuid;
    v_old text;
    v_new text;
begin
    if p_emoji not in ('👍', '😂', '😮', '😢', '🔥', '❤️') then
        raise exception 'Réaction inconnue.';
    end if;

    select group_id into v_group
    from chat_messages
    where id = p_message
      and deleted_at is null
      and created_at >= chat_week_start();

    if v_group is null or not is_group_member(v_group) then
        raise exception 'Message introuvable.';
    end if;

    select emoji into v_old
    from chat_reactions
    where message_id = p_message and user_id = auth.uid();

    v_new := case when v_old = p_emoji then null else p_emoji end;

    insert into chat_reactions (message_id, user_id, group_id, emoji, updated_at)
    values (p_message, auth.uid(), v_group, v_new, now())
    on conflict (message_id, user_id)
    do update set emoji = excluded.emoji, updated_at = excluded.updated_at;

    return v_new;
end;
$$;

revoke all on function public.react_chat_message(bigint, text) from public, anon;
grant execute on function public.react_chat_message(bigint, text) to authenticated;


-- Direct : réactions en plus des messages.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = 'chat_reactions'
    ) then
        alter publication supabase_realtime add table public.chat_reactions;
    end if;
end;
$$;
