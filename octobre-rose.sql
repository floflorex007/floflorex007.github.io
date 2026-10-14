/*
    Octobre rose (2026-10-13) : le skin Flamant est offert à tous les comptes
    créés avant la fin d'octobre 2026 (règle dans animations.js, PARROT_SKINS).
    Ce script prévient une seule fois les joueurs inscrits avant aujourd'hui
    (fenêtre « J'ai compris » de checkPlayerNotices). Relançable sans doublon.
*/

insert into public.player_notices (user_id, title, content)
select p.id,
       '🦩 Octobre rose',
       'À l''occasion d''Octobre rose, le skin Flamant rose est disponible dès aujourd''hui pour ton perroquet ! Active-le dans la fenêtre XP.'
from public.profiles p
where p.created_at < '2026-10-13 00:00:00+02'
  and not exists (
      select 1
      from public.player_notices n
      where n.user_id = p.id
        and n.title = '🦩 Octobre rose'
  );
