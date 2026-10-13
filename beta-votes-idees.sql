-- =========================================================
-- BetLab : « j'aime / j'aime pas » anonyme sur les idées (2026-10-13)
--
-- À lancer après aide-app.sql.
--
-- beta_idea_likes reçoit une colonne vote (1 = j'aime, -1 = j'aime pas ;
-- les anciens j'aime valent 1). Anonyme : chacun ne lit plus que ses
-- propres votes ; les totaux passent par beta_idea_votes().
--   - beta_vote_idea(p_idea, p_vote) : voter, changer d'avis, ou retirer
--     son vote en recliquant le même bouton. Renvoie le vote (1, -1 ou 0).
--   - beta_idea_votes() : par idée, nombre de j'aime, de j'aime pas,
--     et mon vote.
-- beta_toggle_like n'est plus utilisée par le site.
-- =========================================================


alter table public.beta_idea_likes
    add column if not exists vote smallint not null default 1;

alter table public.beta_idea_likes
    drop constraint if exists beta_idea_likes_vote_check;

alter table public.beta_idea_likes
    add constraint beta_idea_likes_vote_check check (vote in (1, -1));


-- Plus personne ne lit les votes des autres.
drop policy if exists "beta_idea_likes lecture" on public.beta_idea_likes;

create policy "beta_idea_likes lecture"
    on public.beta_idea_likes
    for select
    using (user_id = auth.uid());


create or replace function public.beta_vote_idea(p_idea bigint, p_vote smallint)
returns smallint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_current smallint;
begin

    if not public.beta_has_access() then
        raise exception 'Réservé aux bêta-testeurs.';
    end if;

    if p_vote not in (1, -1) then
        raise exception 'Vote invalide.';
    end if;

    if not exists (select 1 from beta_ideas where id = p_idea) then
        raise exception 'Idée introuvable.';
    end if;

    if exists (select 1 from beta_ideas where id = p_idea and user_id = v_user) then
        raise exception 'C''est ta propre idée.';
    end if;

    select vote into v_current
    from beta_idea_likes
    where idea_id = p_idea
      and user_id = v_user;

    -- Même bouton recliqué : le vote est retiré.
    if v_current = p_vote then

        delete from beta_idea_likes where idea_id = p_idea and user_id = v_user;

        return 0;

    end if;

    insert into beta_idea_likes (idea_id, user_id, vote)
    values (p_idea, v_user, p_vote)
    on conflict (idea_id, user_id) do update set vote = excluded.vote;

    return p_vote;

end;
$$;

grant execute on function public.beta_vote_idea(bigint, smallint) to authenticated;


create or replace function public.beta_idea_votes()
returns table (idea_id bigint, likes integer, dislikes integer, my_vote smallint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin

    if not public.beta_has_access() then
        raise exception 'Réservé aux bêta-testeurs.';
    end if;

    return query
    select
        l.idea_id,
        (count(*) filter (where l.vote = 1))::integer,
        (count(*) filter (where l.vote = -1))::integer,
        (max(l.vote) filter (where l.user_id = auth.uid()))::smallint
    from beta_idea_likes l
    group by l.idea_id;

end;
$$;

grant execute on function public.beta_idea_votes() to authenticated;
