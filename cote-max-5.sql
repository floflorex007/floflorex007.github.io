-- =========================================================
-- Cote max 5 à la création d'un pari (2026-10-17)
-- Seulement à l'ajout d'un choix : les cotes qui bougent
-- (cotes-mouvantes.sql) peuvent ensuite monter jusqu'à 10,
-- limite toujours vérifiée par bet_choices_odds_limit
-- (cotes-et-combines.sql). Les paris déjà créés ne changent pas.
-- =========================================================

create or replace function public.bet_choices_create_odds_limit()
returns trigger
language plpgsql
as $$
begin

    if new.odds > 5 then
        raise exception 'À la création, la cote doit être de 5 maximum.';
    end if;

    return new;

end;
$$;

drop trigger if exists bet_choices_create_odds_limit on public.bet_choices;

create trigger bet_choices_create_odds_limit
    before insert on public.bet_choices
    for each row
    execute function public.bet_choices_create_odds_limit();
