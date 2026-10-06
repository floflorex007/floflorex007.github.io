/* =========================================================
   BETLAB
   Animations et progression
   (série, coffre, niveaux, récap, fil en direct...)

   Chargé après app.js : utilise supabaseClient,
   currentUser, currentProfile, formatMoney, formatBalance, escapeHtml.
   Les fonctions SQL sont dans animations.sql.
========================================================= */





const FEED_INTERVAL_MS = 20000;

let feedCursor = null;

let streakAlreadyShown = false;



/* =========================================================
   1. OUTILS
========================================================= */

function storageKey(name) {

    return "betlab-" + name + "-" + (currentUser ? currentUser.id : "anon");

}


function readStorage(name) {

    try {
        return JSON.parse(localStorage.getItem(storageKey(name)));
    } catch (error) {
        return null;
    }

}


function writeStorage(name, value) {

    try {
        localStorage.setItem(storageKey(name), JSON.stringify(value));
    } catch (error) {
        // Stockage indisponible (navigation privée...) : on ignore.
    }

}


/*
    Compteur qui défile d'une valeur à l'autre.
*/

function animateNumber(element, from, to, duration = 900, format = formatMoney) {

    if (!element) {
        return;
    }

    // L'admin garde l'affichage ∞ pour son solde et ses points.
    if (
        currentProfile?.is_admin &&
        (element.id === "balance" || element.id === "points-balance")
    ) {
        updateBalance();
        return;
    }

    if (from === to) {
        element.textContent = format(to);
        return;
    }

    const start = performance.now();

    if (element._animFrame) {
        cancelAnimationFrame(element._animFrame);
    }

    const step = now => {

        const progress = Math.min(1, (now - start) / duration);

        const eased = 1 - Math.pow(1 - progress, 3);

        element.textContent = format(from + (to - from) * eased);

        if (progress < 1) {
            element._animFrame = requestAnimationFrame(step);
        }

    };

    element._animFrame = requestAnimationFrame(step);

}


/*
    Petit grossissement ponctuel.
*/

function bump(element) {

    if (!element) {
        return;
    }

    element.classList.remove("anim-bump");

    void element.offsetWidth;

    element.classList.add("anim-bump");

}



/* =========================================================
   2. GAIN POTENTIEL EN DIRECT
========================================================= */

function animatePotentialWin(value) {

    const element =
        document.getElementById("potential-win");

    const previous =
        element._lastValue || 0;

    element._lastValue = value;

    animateNumber(element, previous, value, 300);

    if (value !== previous) {
        bump(element);
    }

}



/* =========================================================
   3. CONFETTIS
========================================================= */

function launchConfetti(count = 120) {


    const colors =
        ["#f5c451", "#6c63ff", "#63d69f", "#ff6b6b", "#3aa0ff"];

    const layer =
        document.createElement("div");

    layer.className = "confetti-layer";

    let lastPieceEnd = 0;

    for (let i = 0; i < count; i++) {

        const piece = document.createElement("div");

        piece.className = "confetti-piece";

        piece.style.left = Math.random() * 100 + "%";
        piece.style.background = colors[i % colors.length];

        const duration = 1.8 + Math.random() * 1.6;
        const delay = Math.random() * 0.5;

        piece.style.animationDuration = duration + "s";
        piece.style.animationDelay = delay + "s";

        lastPieceEnd = Math.max(lastPieceEnd, (duration + delay) * 1000);

        layer.appendChild(piece);

    }

    document.body.appendChild(layer);

    setTimeout(() => layer.remove(), lastPieceEnd + 100);

    // Durée totale (ms) : permet d'enchaîner une animation après.
    return lastPieceEnd;

}



/* =========================================================
   3 BIS. BILLETS ENTRE LE PERROQUET ET LE SOLDE
      Gagné : les billets jaillissent de la liasse du perroquet,
      flottent, puis filent en spirale vers le solde (traînée
      lumineuse) ; le solde monte à chaque billet encaissé.
      Perdu : les billets quittent le solde et tombent en
      virevoltant jusqu'au perroquet, qui tremble à chaque impact.
========================================================= */

const FLY_BILL_IMAGE = "assets/perroquet/win-bill2.png";


function flyBills(mode, fromBalance = 0, toBalance = 0) {

    const balanceEl =
        document.getElementById("balance");

    if (!balanceEl || typeof Parrot === "undefined") {
        return;
    }

    const rnd = (a, b) => a + Math.random() * (b - a);

    const balanceRect = balanceEl.getBoundingClientRect();

    const balancePoint = {
        x: balanceRect.left + balanceRect.width / 2,
        y: balanceRect.top + balanceRect.height / 2
    };

    const parrotPoint =
        Parrot.billsPoint();


    // Axe perroquet → solde : direction et perpendiculaire.
    const dx = balancePoint.x - parrotPoint.x;
    const dy = balancePoint.y - parrotPoint.y;
    const len = Math.hypot(dx, dy) || 1;
    const dir = { x: dx / len, y: dy / len };
    const perp = { x: dy / len, y: -dx / len };

    const COUNT = 10;

    // Fin prévue de l'animation : le perroquet grandit jusqu'à ce moment-là.
    window.billsAnimationEnd =
        performance.now() + (mode === "win" ? 400 + (COUNT - 1) * 70 + 1500 : 150 + (COUNT - 1) * 120 + 1700);

    // Premier billet qui touche le perroquet (le cadre « En jeu » commence à compter à ce moment-là).
    window.billsFirstArrival =
        performance.now() + (mode === "win" ? 400 : 150 + 1700);


    const makeBill = () => {
        const el = document.createElement("img");
        el.src = FLY_BILL_IMAGE;
        el.alt = "";
        el.className = "fly-bill";
        document.body.appendChild(el);
        return el;
    };


    if (mode === "win") {

        let shown = fromBalance;

        // Le solde repart de l'ancien montant et monte billet par billet.
        animateNumber(balanceEl, fromBalance, fromBalance, 0, formatBalance);

        for (let i = 0; i < COUNT; i++) {

            const go = rnd(60, 150);
            const side = rnd(-45, 45);

            const burst = {
                x: parrotPoint.x + dir.x * go + perp.x * side,
                y: parrotPoint.y + dir.y * go + perp.y * side
            };

            const swirl = rnd(0, Math.PI * 2);

            const frames = [
                { transform: `translate(${parrotPoint.x}px,${parrotPoint.y}px) rotate(0deg) scale(.3)`, opacity: 0, offset: 0 },
                { transform: `translate(${burst.x}px,${burst.y}px) rotate(${rnd(-60, 60)}deg) scale(.9)`, opacity: 1, offset: 0.25 },
                { transform: `translate(${burst.x + rnd(-15, 15)}px,${burst.y - 18}px) rotate(${rnd(-30, 30)}deg) scale(.9)`, opacity: 1, offset: 0.42 }
            ];

            for (let k = 1; k <= 12; k++) {

                const t = k / 12;
                const radius = (1 - t) * 35;
                const angle = swirl + t * Math.PI * 3;

                frames.push({
                    transform: `translate(${burst.x + (balancePoint.x - burst.x) * t + Math.cos(angle) * radius}px,${burst.y + (balancePoint.y - burst.y) * t + Math.sin(angle) * radius}px) rotate(${t * 540}deg) scale(${0.9 - t * 0.55})`,
                    opacity: 1,
                    offset: 0.42 + t * 0.58
                });

            }

            setTimeout(() => {

                const el = makeBill();

                const anim = el.animate(frames, { duration: 1500, easing: "ease-in-out", fill: "forwards" });

                // Traînée lumineuse.
                const trail = setInterval(() => {

                    const m = new DOMMatrix(getComputedStyle(el).transform);
                    const dot = document.createElement("div");

                    dot.className = "fly-trail";
                    document.body.appendChild(dot);

                    dot.animate(
                        [
                            { opacity: 0.8, transform: `translate(${m.e}px,${m.f}px) scale(1)` },
                            { opacity: 0, transform: `translate(${m.e}px,${m.f}px) scale(.2)` }
                        ],
                        { duration: 400, fill: "forwards" }
                    ).onfinish = () => dot.remove();

                }, 45);

                anim.onfinish = () => {

                    clearInterval(trail);
                    el.remove();

                    const next = fromBalance + (toBalance - fromBalance) * (i + 1) / COUNT;

                    animateNumber(balanceEl, shown, next, 250, formatBalance);
                    shown = next;

                    bump(balanceEl);

                };

            }, 400 + i * 70);

        }

        return;

    }


    // Perdu (ou nouvelle mise, mode « stake ») : du solde vers
    // le perroquet, en feuilles mortes.

    for (let i = 0; i < COUNT; i++) {

        const end = {
            x: parrotPoint.x + rnd(-20, 20),
            y: parrotPoint.y + rnd(-15, 15)
        };

        const sway = rnd(20, 45);
        const phase = rnd(0, Math.PI * 2);
        const frames = [];

        for (let k = 0; k <= 20; k++) {

            const t = k / 20;
            const wave = Math.sin(phase + t * Math.PI * 4);
            const size = 0.5 + t * 0.4;

            frames.push({
                transform: `translate(${balancePoint.x + (end.x - balancePoint.x) * t + wave * sway * (1 - t * 0.6)}px,${balancePoint.y + (end.y - balancePoint.y) * (t * t * 0.6 + t * 0.4)}px) rotate(${wave * 40}deg) scale(${size},${size * (Math.cos(t * 14 + phase) * 0.35 + 0.65)})`,
                opacity: t > 0.9 ? (1 - t) * 10 : 1,
                offset: t
            });

        }

        setTimeout(() => {

            const el = makeBill();

            el.animate(frames, { duration: 1700, easing: "linear", fill: "forwards" }).onfinish = () => {
                el.remove();

                // Pari perdu : le perroquet tremble à chaque billet.
                if (mode === "lose") {
                    Parrot.hit();
                }
            };

        }, 150 + i * 120);

    }

}



/* =========================================================
   4. RÉCAP « PENDANT TON ABSENCE »
      Les paris résolus déjà vus sont mémorisés
      dans le navigateur. Les nouveaux s'affichent
      dans une pop-up (confettis si gain).
========================================================= */

async function checkNewResults() {

    if (!currentUser) {
        return;
    }

    const {
        data,
        error
    } = await supabaseClient
        .from("stakes")
        .select("id, choice_id, stake, potential_win, bets!inner ( question, status, winner_choice_id, group_id )")
        .eq("user_id", currentUser.id)
        .eq("bets.group_id", currentGroup?.id);

    if (error) {
        console.error(error);
        return;
    }


    const resolved =
        (data || []).filter(s => s.bets?.status === "resolved");

    const seen =
        readStorage("seen-results");


    /*
        Première visite : on mémorise sans rien afficher.
    */

    if (!Array.isArray(seen)) {
        writeStorage("seen-results", resolved.map(s => s.id));
        return;
    }


    const fresh =
        resolved.filter(s => !seen.includes(s.id));

    if (fresh.length === 0) {
        return;
    }

    writeStorage("seen-results", resolved.map(s => s.id));


    const wins =
        fresh.filter(s => s.bets.winner_choice_id === s.choice_id);

    const totalWon =
        wins.reduce((sum, s) => sum + Number(s.potential_win), 0);


    /*
        Les gains ne sont plus versés automatiquement : l'argent se récupère
        en cliquant sur les cartes de la page principale (plus de pop-up
        « Il y a du mouvement »).
    */

    // Mise à jour discrète : pas d'écran « Chargement » qui ferait clignoter la liste
    // (ni qui couperait l'arrivée de la carte « pari gagné / perdu »).
    if (typeof displayBets === "function") {
        displayBets({ quiet: true });
    }

    if (typeof displayMyBets === "function") {
        displayMyBets();
    }

    refreshProgression();

}


/* =========================================================
   5. SÉRIE DE CONNEXIONS ET COFFRE DU JOUR
========================================================= */

async function dailyCheckin() {

    const {
        data,
        error
    } = await supabaseClient.rpc("daily_checkin", { p_group: currentGroup.id });

    if (error) {
        console.error("Série / coffre indisponibles (animations.sql lancé ?)", error);
        return;
    }

    const row =
        Array.isArray(data) ? data[0] : data;

    if (!row) {
        return;
    }


    const widget =
        document.getElementById("streak-widget");

    const count =
        document.getElementById("streak-count");

    widget.classList.remove("hidden");

    count.textContent = row.streak;

    widget.style.setProperty(
        "--flame-size",
        Math.min(26, 16 + row.streak) + "px"
    );

    widget.title =
        "Série de " + row.streak + " jour" + (row.streak > 1 ? "s" : "") +
        " : reviens demain pour la faire grandir !";

    if (row.increased && !streakAlreadyShown) {
        streakAlreadyShown = true;
        bump(widget);
        widget.classList.add("streak-up");
    }


    const chest =
        document.getElementById("chest-button");

    // Le coffre n'apparaît que lorsqu'il peut être ouvert.
    chest.classList.toggle("hidden", !row.chest_available);

    chest.disabled = !row.chest_available;

}


async function openChest() {

    const chest =
        document.getElementById("chest-button");

    if (chest.disabled) {
        return;
    }

    chest.disabled = true;

    chest.classList.add("opening");

    const icon =
        chest.querySelector(".chest-icon");

    const textElement =
        chest.querySelector(".chest-text span");


    const {
        data,
        error
    } = await supabaseClient.rpc("open_daily_chest", { p_group: currentGroup.id });


    // Le coffre tremble et brille, puis s'ouvre.
    setTimeout(async () => {

        chest.classList.remove("opening");

        // La lueur d'ouverture retombe en douceur au lieu de s'éteindre d'un coup.
        chest.animate(
            [
                { boxShadow: "0 0 46px rgba(245, 196, 81, 0.65)", transform: "scale(1.025)" },
                { boxShadow: "0 0 0 rgba(245, 196, 81, 0)", transform: "scale(1)" }
            ],
            { duration: 800, easing: "ease-out" }
        );

        if (error) {
            console.error(error);
            alertToast(error.message || "Impossible d'ouvrir le coffre.");
            chest.classList.add("hidden");
            return;
        }

        // Ouverture : l'icône « éclot » et le texte se fond vers le gain.
        icon.textContent = "📦";

        icon.classList.remove("chest-pop");

        void icon.offsetWidth;

        icon.classList.add("chest-pop");

        textElement.textContent =
            "+" + data + " points gagnés !";

        textElement.animate(
            [
                { opacity: 0, transform: "translateY(5px)" },
                { opacity: 1, transform: "none" }
            ],
            { duration: 500, easing: "cubic-bezier(.2,.8,.2,1)" }
        );


        const iconRect = icon.getBoundingClientRect();

        const loot =
            document.createElement("div");

        loot.className = "chest-loot";

        loot.textContent = "+" + data + " 🪙";

        loot.style.left = iconRect.left + iconRect.width / 2 + "px";
        loot.style.top = iconRect.bottom + "px";

        document.body.appendChild(loot);

        setTimeout(() => loot.remove(), 1800);


        // Les pièces partent du coffre vers le compteur de points (en haut à droite) ;
        // le compteur monte à chaque pièce qui arrive.
        const before =
            currentProfile?.points || 0;

        await loadCurrentProfile();

        flyCoins(iconRect, Number(data), before);

        if (typeof displayShop === "function") {
            displayShop();
        }


        /*
            Le coffre se referme doucement une fois ouvert
            (il revient demain).
        */

        setTimeout(async () => {

            // L'admin peut rouvrir le coffre à l'infini.
            if (currentProfile?.is_admin) {

                await chest.animate(
                    [{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }],
                    { duration: 600, easing: "ease-in-out" }
                ).finished;

                icon.textContent = "🎁";

                textElement.textContent = "Clique pour l'ouvrir !";

                chest.disabled = false;

                return;

            }

            // Repli en hauteur : les cartes du dessous remontent sans à-coup.
            const height = chest.offsetHeight;

            chest.style.overflow = "hidden";

            await chest.animate(
                [
                    { height: height + "px", opacity: 1, transform: "scale(1)", paddingTop: "16px", paddingBottom: "16px", marginTop: "0px" },
                    { height: "0px", opacity: 0, transform: "scale(0.94)", paddingTop: "0px", paddingBottom: "0px", marginTop: "-16px" }
                ],
                { duration: 650, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
            ).finished.catch(() => {});

            chest.classList.add("hidden");

            chest.getAnimations().forEach(animation => animation.cancel());

            chest.style.overflow = "";

        }, 2600);

    }, 1000);

}



/* =========================================================
   6. NIVEAUX ET XP
      Passer du niveau N au niveau N+1
      demande 100 + 50 × (N - 1) XP.
========================================================= */

function levelFromXp(xp) {

    let level = 1;

    let needed = 100;

    while (xp >= needed) {
        xp -= needed;
        level++;
        needed = 100 + 50 * (level - 1);
    }

    return {
        level,
        current: xp,
        needed
    };

}


let lastXpTotal = null;

function pulseXpCard() {

    const card = document.querySelector(".level-sidebar");

    if (!card || card.getClientRects().length === 0) {

        return;

    }

    card.classList.remove("xp-halo");

    void card.offsetWidth;

    card.classList.add("xp-halo");

    card.addEventListener("animationend", () => card.classList.remove("xp-halo"), { once: true });

}

async function refreshProgression() {

    const {
        data,
        error
    } = await supabaseClient.rpc("player_xp");

    if (error) {
        console.error(error);
        return;
    }


    const info =
        levelFromXp(Number(data) || 0);

    // XP gagnée : la barre monte en même temps que le halo violet, une fois
    // l'animation du perroquet terminée (billets, croissance, pose).
    const xpNow = Number(data) || 0;

    const gained = lastXpTotal !== null && xpNow > lastXpTotal;

    lastXpTotal = xpNow;

    let delay = 0;

    if (gained) {

        const parrotEnd = Math.max(
            window.billsAnimationEnd || 0,
            window.parrotAnimEnd || 0,
            window.leaderboardHoldUntil || 0
        );

        delay = Math.max(0, parrotEnd - performance.now()) + 150;

        progressionHoldUntil = performance.now() + delay;

    } else {

        // Un gain est en attente : une mise à jour qui arrive entre-temps attend aussi.
        delay = Math.max(0, progressionHoldUntil - performance.now());

    }

    const run = () => {

        if (gained) {

            pulseXpCard();

        }

        applyProgression(info);

    };

    if (delay > 0) {

        setTimeout(run, delay);

    } else {

        run();

    }

}


let progressionHoldUntil = 0;

/*
    Panneau « Ton niveau » à droite de la page principale.
    Le niveau supérieur n'est pas débloqué tout seul : quand l'XP suffit, la barre
    est pleine et un bouton violet propose de le débloquer (voir claimNextLevel).
*/

let lastProgressInfo = null;

function xpNeededForLevel(level) {

    return 100 + 50 * (level - 1);

}

function applyProgression(info) {

    lastProgressInfo = info;

    // Niveau déjà débloqué par le joueur (au premier passage : son niveau actuel).
    let claimed = readStorage("claimed-level");

    if (!claimed || claimed > info.level) {

        claimed = info.level;

        writeStorage("claimed-level", claimed);

    }

    const pending = info.level > claimed;

    const shown = pending
        ? { level: claimed, current: xpNeededForLevel(claimed), needed: xpNeededForLevel(claimed) }
        : info;


    const sidebarLabel =
        document.getElementById("level-sidebar-label");

    if (sidebarLabel) {

        sidebarLabel.textContent = "Niveau " + shown.level;

        document.getElementById("level-sidebar-xp").textContent =
            shown.current + " / " + shown.needed + " XP";

        document.getElementById("level-sidebar-fill").style.width =
            Math.round(shown.current / shown.needed * 100) + "%";

    }


    const button = document.getElementById("level-up-button");

    if (button) {

        if (pending) {

            button.textContent = "⭐ Débloquer le niveau " + (claimed + 1);

            button.classList.remove("hidden");

        } else {

            button.classList.add("hidden");

        }

    }

}

function claimNextLevel() {

    const claimed = readStorage("claimed-level");

    if (!lastProgressInfo || !claimed || lastProgressInfo.level <= claimed) {

        return;

    }

    writeStorage("claimed-level", claimed + 1);

    // L'animation du niveau se joue maintenant, puis la barre repart du début.
    showLevelUp(claimed + 1);

    const fill = document.getElementById("level-sidebar-fill");

    if (fill) {

        fill.style.transition = "none";

        fill.style.width = "0%";

        void fill.offsetWidth;

        fill.style.transition = "";

    }

    applyProgression(lastProgressInfo);

    pulseXpCard();

}


function showLevelUp(level) {

    const flash =
        document.createElement("div");

    flash.className = "level-up-flash";

    flash.innerHTML = `<span>Niveau ${level} !</span>`;

    document.body.appendChild(flash);

    setTimeout(() => flash.remove(), 2200);

}



/* =========================================================
   7. REMONTÉE AU CLASSEMENT
      On mémorise le rang de chaque joueur affiché.
      Tout joueur qui gagne des places remonte en glissant.
      Si la page des paris n'est pas visible, on attend
      qu'elle le soit pour ne pas « gâcher » l'animation.
========================================================= */

function animateLeaderboard(profiles) {

    const rows =
        document.querySelectorAll("#leaderboard-list .leaderboard-row:not(.leaderboard-row--admin)");

    profiles.forEach((profile, index) => {

        if (currentProfile && profile.username === currentProfile.username) {
            rows[index]?.classList.add("leaderboard-row--me");
        }

    });


    const betsPage =
        document.getElementById("bets-page");

    if (!betsPage || betsPage.classList.contains("hidden")) {
        return;
    }


    // Animation du perroquet en cours (pari gagné / perdu) :
    // on attend la fin avant de jouer les remontées du classement.
    if (performance.now() < (window.leaderboardHoldUntil || 0)) {
        return;
    }


    const oldRanks =
        readStorage("ranks");

    const newRanks = {};

    profiles.forEach((profile, index) => {
        newRanks[profile.username] = index + 1;
    });

    writeStorage("ranks", newRanks);


    /*
        Première visite : rien à comparer.
    */

    if (!oldRanks || typeof oldRanks !== "object") {
        return;
    }


    profiles.forEach((profile, index) => {

        const row = rows[index];

        const newRank = index + 1;

        // Absent du classement avant : il vient d'en dessous du top.
        const oldRank =
            oldRanks[profile.username] || profiles.length + 1;

        if (!row || newRank === oldRank) {
            return;
        }


        // Places gagnées (+) ou perdues (-).
        const climbed = newRank < oldRank;

        const badge =
            document.createElement("span");

        badge.className = climbed ? "leaderboard-up" : "leaderboard-down";

        badge.textContent = (climbed ? "+" : "-") + Math.abs(oldRank - newRank);

        row.querySelector(".leaderboard-pseudo").appendChild(badge);


        const distance =
            Math.min(oldRank, profiles.length + 1) - newRank;

        const color = climbed
            ? "rgba(99, 214, 159, 0.25)"
            : "rgba(255, 107, 107, 0.2)";

        row.animate(
            [
                { transform: `translateY(${distance * row.offsetHeight}px)`, background: color },
                { transform: "translateY(0)", background: color, offset: 0.6 },
                { transform: "translateY(0)", background: "transparent" }
            ],
            {
                duration: 1600,
                easing: "cubic-bezier(.3, 1.2, .5, 1)"
            }
        );

    });

}




/* =========================================================
   8. COMPTE À REBOURS (dernière heure)
========================================================= */

let closedRefreshPending = false;

function setCardBadge(card, text) {

    let badge = card.querySelector(".bet-new-badge");

    if (!text) {

        if (badge) badge.remove();

        return;

    }

    if (!badge) {

        badge = document.createElement("span");

        badge.className = "bet-new-badge";

        card.prepend(badge);

    }

    if (badge.textContent !== text) badge.textContent = text;

}


function updateCountdowns() {

    document
        .querySelectorAll(".bet-card[data-deadline]")
        .forEach(card => {

            const remaining =
                new Date(card.dataset.deadline) - new Date();

            const label =
                card.querySelector(".bet-deadline");

            // Moins d'une heure avant l'échéance : les mises sont closes, la carte se grise.
            if (remaining <= BET_CLOSE_MS) {

                card.classList.remove("bet-card-urgent");

                setCardBadge(card, "TROP TARD");

                if (
                    !card.classList.contains("bet-card-locked") &&
                    !card.classList.contains("validating") &&
                    !closedRefreshPending
                ) {

                    closedRefreshPending = true;

                    setTimeout(() => {

                        closedRefreshPending = false;

                        if (typeof displayBets === "function") {

                            displayBets({ quiet: true, force: true });

                        }

                    }, 300);

                }

                return;

            }

            // Entre 2 h et 1 h avant l'échéance : carte rouge, avec le temps qu'il reste pour miser.
            if (remaining > BET_URGENT_MS) {

                card.classList.remove("bet-card-urgent");

                return;

            }

            card.classList.add("bet-card-urgent");

            setCardBadge(card, "LAST CHANCE");

            const untilClose = remaining - BET_CLOSE_MS;

            const minutes = Math.floor(untilClose / 60000);

            const seconds = Math.floor(untilClose / 1000) % 60;

            label.textContent =
                "⏳ " + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");

        });

}



/* =========================================================
   9. CARTES EN CASCADE
========================================================= */

function cascadeIn(root) {

    if (!root) {
        return;
    }

    const play = (element, index) => {

        element.classList.remove("cascade-in");

        void element.offsetWidth;

        element.style.animationDelay = Math.min(index, 12) * 0.06 + "s";

        element.classList.add("cascade-in");

    };

    // Titres et cartes, dans l'ordre de la page.
    root
        .querySelectorAll(".page-header, .missions-title, .bet-card, .my-bet-item, .mission-card")
        .forEach(play);

    // Colonnes latérales (top parieurs, message, XP, coffre) : elles arrivent
    // tout de suite après le titre, l'une après l'autre.
    root
        .querySelectorAll(".leaderboard-sidebar, .admin-message-sidebar, .chest-card")
        .forEach((element, index) => play(element, index + 1));

}



/* =========================================================
   10. CARTES QUI SUIVENT LA SOURIS
       ET ONDE AU CLIC SUR LES CHOIX
========================================================= */

function setupPointerEffects() {


    document.addEventListener("mousemove", event => {

        // Une fenêtre est ouverte (aperçu de la boutique, mise...) : la carte sur laquelle
        // on a cliqué garde sa perspective au lieu de se remettre droite.
        if (document.querySelector(".modal:not(.hidden)")) {

            return;

        }

        let card =
            event.target.closest(".bet-card, .mission-card");

        // La carte dépliée (détail des parieurs) reste bien à plat.
        if (card && card.classList.contains("stakes-pop")) {

            card = null;

        }

        document
            .querySelectorAll(".tilting")
            .forEach(other => {
                if (other !== card) {
                    other.classList.remove("tilting");
                    other.style.transform = "";
                }
            });

        if (!card) {
            return;
        }

        const rect = card.getBoundingClientRect();

        const x = (event.clientX - rect.left) / rect.width - 0.5;

        const y = (event.clientY - rect.top) / rect.height - 0.5;

        card.classList.add("tilting");

        card.style.transform =
            `perspective(900px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg) translateY(-3px)`;

    });


    document.addEventListener("click", event => {

        const button =
            event.target.closest(".bet-choice-button:not(:disabled)");

        if (!button) {
            return;
        }

        const rect = button.getBoundingClientRect();

        const size = Math.max(rect.width, rect.height);

        const ripple = document.createElement("span");

        ripple.className = "choice-ripple";

        ripple.style.width = ripple.style.height = size + "px";
        ripple.style.left = event.clientX - rect.left - size / 2 + "px";
        ripple.style.top = event.clientY - rect.top - size / 2 + "px";

        button.appendChild(ripple);

        button.classList.remove("choice-pulse");

        void button.offsetWidth;

        button.classList.add("choice-pulse");

        setTimeout(() => ripple.remove(), 600);

    }, true);

}



/* =========================================================
   11. FIL D'ACTIVITÉ EN DIRECT
========================================================= */

function alertToast(text, className = "") {

    let stack =
        document.getElementById("activity-feed");

    if (!stack) {
        stack = document.createElement("div");
        stack.id = "activity-feed";
        stack.className = "activity-feed";
        document.body.appendChild(stack);
    }

    const toast =
        document.createElement("div");

    toast.className = "activity-toast " + className;

    toast.innerHTML = text;

    stack.prepend(toast);

    while (stack.children.length > 4) {
        stack.lastElementChild.remove();
    }

    setTimeout(() => {
        toast.classList.add("leaving");
        setTimeout(() => toast.remove(), 400);
    }, 6000);

}


async function pollActivity() {

    if (!currentUser) {
        return;
    }


    /*
        Premier passage : on montre les dernières
        activités des 3 derniers jours.
    */

    /*
        Le curseur est gardé dans le navigateur :
        une notification déjà vue ne réapparaît pas au rechargement.
    */

    if (!feedCursor) {
        feedCursor = readStorage("feed-cursor");
    }

    const firstPass = !feedCursor;

    const since = feedCursor ||
        new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();


    const [stakesResult, betsResult] = await Promise.all([

        supabaseClient
            .from("stakes")
            .select("created_at, stake, user_id, profiles!stakes_user_id_fkey ( username, is_admin, gold_frame_until, name_color_until, cosmetics ), bets!inner ( question, group_id )")
            .eq("bets.group_id", currentGroup?.id)
            .gt("created_at", since)
            .neq("user_id", currentUser.id)
            .order("created_at", { ascending: firstPass ? false : true })
            .limit(firstPass ? 3 : 5),

        supabaseClient
            .from("bets")
            .select("created_at, question, author_id, profiles!bets_author_id_fkey ( username, is_admin, gold_frame_until, name_color_until, cosmetics )")
            .eq("group_id", currentGroup?.id)
            .gt("created_at", since)
            .neq("author_id", currentUser.id)
            .order("created_at", { ascending: firstPass ? false : true })
            .limit(firstPass ? 1 : 3)

    ]);


    if (stakesResult.error || betsResult.error) {
        console.error("Fil en direct :", stakesResult.error || betsResult.error);
    }


    const events = [];

    // Les actions de l'admin ne sont pas montrées aux joueurs.
    (stakesResult.data || []).filter(s => !s.profiles?.is_admin).forEach(s => events.push({
        at: s.created_at,
        html: `💸 <strong>${styledName(s.profiles, "Quelqu'un")}</strong> a misé ${formatMoney(s.stake)} sur « ${escapeHtml(s.bets?.question || "un pari")} »`
    }));

    (betsResult.data || []).filter(b => !b.profiles?.is_admin).forEach(b => events.push({
        at: b.created_at,
        html: `🆕 <strong>${styledName(b.profiles, "Quelqu'un")}</strong> a créé « ${escapeHtml(b.question)} »`
    }));

    events.sort((a, b) => new Date(a.at) - new Date(b.at));


    events.forEach((event, index) => {
        setTimeout(() => alertToast(event.html), index * 700);
    });


    // Le curseur avance aussi après des actions masquées (admin).
    const allDates = [
        ...(stakesResult.data || []),
        ...(betsResult.data || [])
    ].map(row => row.created_at).sort();

    feedCursor = allDates.length > 0
        ? allDates[allDates.length - 1]
        : feedCursor || new Date().toISOString();

    writeStorage("feed-cursor", feedCursor);

}



/* =========================================================
   12. INITIALISATION
========================================================= */

async function initAnimations() {

    setupPointerEffects();

    document
        .getElementById("level-up-button")
        ?.addEventListener("click", claimNextLevel);

    setInterval(updateCountdowns, 1000);

    updateCountdowns();

    // (L'arrivée des cartes en cascade est lancée par initAppPage, au moment
    // où la page s'affiche : la relancer ici faisait disparaître puis
    // réapparaître les cartes.)


    const chest =
        document.getElementById("chest-button");

    if (chest) {
        chest.addEventListener("click", openChest);
    }


    await dailyCheckin();

    await refreshProgression();

    await checkNewResults();

    await pollActivity();


    setInterval(async () => {

        await checkGroupRemovals();

        await displayBets({ quiet: true });

        await pollActivity();

        await checkNewResults();

        await displayLeaderboard();

    }, FEED_INTERVAL_MS);

}



/* =========================================================
   ANIMATION DES POP-UP
   - Par défaut : zoom rebond à l'ouverture ; à la fermeture
     une copie visuelle rétrécit et disparaît (la vraie fenêtre
     est déjà masquée par le code existant).
   - Détail des parieurs ouvert depuis une carte : la fenêtre
     part de la carte, glisse au centre en se dévoilant, puis
     y retourne à la fermeture.
========================================================= */

const MODAL_EASE_POP = "cubic-bezier(.2,1.5,.4,1)";

const MODAL_EASE_OUT = "cubic-bezier(.2,.8,.2,1)";

const MODAL_EASE_CLOSE = "cubic-bezier(.4,0,.2,1)";

const MODAL_BACKDROP = "rgba(0, 0, 0, 0.7)";


/*
    Copie d'une carte posée par-dessus la page,
    au rectangle donné (coordonnées de l'écran).
*/

function cardFlyer(card, rect) {

    const flyer = card.cloneNode(true);

    flyer.removeAttribute("id");

    flyer.querySelectorAll("[id]").forEach(
        element => element.removeAttribute("id")
    );

    Object.assign(flyer.style, {
        position: "fixed",
        left: rect.left + "px",
        top: rect.top + "px",
        width: rect.width + "px",
        height: rect.height + "px",
        margin: "0",
        zIndex: "101",
        pointerEvents: "none",
        visibility: "visible",
        boxSizing: "border-box"
    });

    document.body.appendChild(flyer);

    return flyer;

}


/*
    Décalage et découpe pour faire coïncider la fenêtre
    avec le rectangle de la carte.
*/

function cardGeometry(cardRect, contentRect) {

    const right = Math.max(0, contentRect.width - cardRect.width);

    const bottom = Math.max(0, contentRect.height - cardRect.height);

    return {
        dx: cardRect.left - contentRect.left,
        dy: cardRect.top - contentRect.top,
        clip: "inset(0 " + right + "px " + bottom + "px 0 round 18px)"
    };

}


/*
    Carte encore affichée à l'écran pour ce pari
    (la liste a pu être redessinée pendant l'ouverture).
*/

function findSourceCard(modal) {

    let card = modal._sourceCard;

    if ((!card || !card.isConnected) && modal._sourceBetId) {

        card = document.querySelector(
            '.bet-card:not(.claim-card)[data-bet-id="' + modal._sourceBetId + '"]'
        );

    }

    if (!card || card.getClientRects().length === 0) {

        return null;

    }

    return card;

}


function openModalFromCard(modal, content, card) {

    const cardRect = card.getBoundingClientRect();

    const geometry = cardGeometry(cardRect, content.getBoundingClientRect());

    const flyer = cardFlyer(card, cardRect);

    card.style.visibility = "hidden";


    modal.animate(
        [{ backgroundColor: "rgba(0, 0, 0, 0)" }, { backgroundColor: MODAL_BACKDROP }],
        { duration: 300 }
    );

    flyer.animate(
        [
            { transform: "none", opacity: 1 },
            { transform: "translate(" + -geometry.dx + "px, " + -geometry.dy + "px)", opacity: 0 }
        ],
        { duration: 260, easing: MODAL_EASE_OUT, fill: "forwards" }
    ).finished.finally(() => flyer.remove());

    content.animate(
        [
            { transform: "translate(" + geometry.dx + "px, " + geometry.dy + "px)", clipPath: geometry.clip },
            { transform: "none", clipPath: "inset(0 0 0 0 round 18px)" }
        ],
        { duration: 440, easing: MODAL_EASE_OUT }
    );

}


function closeModalToCard(ghost, ghostContent, card) {

    const cardRect = card.getBoundingClientRect();

    const geometry = cardGeometry(cardRect, ghostContent.getBoundingClientRect());

    const flyer = cardFlyer(card, cardRect);

    flyer.style.opacity = "0";


    ghost.animate(
        [{ backgroundColor: MODAL_BACKDROP }, { backgroundColor: "rgba(0, 0, 0, 0)" }],
        { duration: 360, fill: "forwards" }
    );

    // La carte réapparaît pendant que la fenêtre s'efface,
    // pour ne jamais voir deux textes l'un sur l'autre.
    flyer.animate(
        [
            { transform: "translate(" + -geometry.dx + "px, " + -geometry.dy + "px)", opacity: 0 },
            { opacity: 0, offset: 0.3 },
            { opacity: 1, offset: 0.75 },
            { transform: "none", opacity: 1 }
        ],
        { duration: 400, easing: MODAL_EASE_CLOSE, fill: "forwards" }
    );

    return ghostContent.animate(
        [
            { transform: "none", clipPath: "inset(0 0 0 0 round 18px)", opacity: 1 },
            { opacity: 1, offset: 0.3 },
            { opacity: 0, offset: 0.75 },
            { transform: "translate(" + geometry.dx + "px, " + geometry.dy + "px)", clipPath: geometry.clip, opacity: 0 }
        ],
        { duration: 400, easing: MODAL_EASE_CLOSE, fill: "forwards" }
    ).finished.finally(() => {

        card.style.visibility = "";

        flyer.remove();

    });

}


function initModalAnimations() {

    document.querySelectorAll(".modal").forEach(modal => {

        let wasHidden = modal.classList.contains("hidden");

        new MutationObserver(() => {

            const hidden = modal.classList.contains("hidden");

            if (hidden === wasHidden) {

                return;

            }

            wasHidden = hidden;


            const content = modal.querySelector(".modal-content");


            /* ----- Ouverture ----- */

            if (!hidden) {

                const card = findSourceCard(modal);

                if (card && content) {

                    openModalFromCard(modal, content, card);

                    return;

                }

                modal.animate(
                    [{ opacity: 0 }, { opacity: 1 }],
                    { duration: 150 }
                );

                if (content) {

                    content.animate(
                        [
                            { transform: "scale(.6)", opacity: 0 },
                            { transform: "scale(1)", opacity: 1 }
                        ],
                        { duration: 280, easing: MODAL_EASE_POP }
                    );

                }

                return;

            }


            /* ----- Fermeture ----- */

            const card = modal._skipReturn ? null : findSourceCard(modal);

            const hiddenCard = modal._sourceCard;

            modal._skipReturn = false;

            modal._sourceCard = null;

            modal._sourceBetId = null;


            // La copie garde ses identifiants : une grande partie du style de la
            // fenêtre (question, champ de mise...) est écrit avec ces identifiants,
            // sans eux la copie aurait un autre aspect pendant le fondu.
            // La vraie fenêtre est avant dans la page : le code la trouve en premier.
            const ghost = modal.cloneNode(true);

            ghost.classList.remove("hidden");

            ghost.style.pointerEvents = "none";

            document.body.appendChild(ghost);


            const ghostContent = ghost.querySelector(".modal-content");

            if (ghostContent && content) {

                ghostContent.scrollTop = content.scrollTop;

            }


            let done;

            if (card && ghostContent) {

                done = closeModalToCard(ghost, ghostContent, card);

            } else {

                // Carte d'origine masquée mais pas de retour : on la réaffiche.
                if (hiddenCard) {

                    hiddenCard.style.visibility = "";

                }

                // Fermeture douce : fondu du fond et de la fenêtre, avec un très
                // léger rétrécissement (rien de brusque).
                ghost.animate(
                    [{ opacity: 1 }, { opacity: 0 }],
                    { duration: 320, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
                );

                done = ghostContent
                    ? ghostContent.animate(
                        [
                            { transform: "scale(1)", opacity: 1 },
                            { transform: "scale(.95) translateY(6px)", opacity: 0 }
                        ],
                        { duration: 320, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
                    ).finished
                    : Promise.resolve();

            }

            done.then(() => ghost.remove()).catch(() => ghost.remove());

        }).observe(modal, { attributes: true, attributeFilter: ["class"] });

    });

}

initModalAnimations();



/* =========================================================
   PIÈCES : MISSION RÉCUPÉRÉE
   Des pièces partent du bouton « Récupérer » vers le compteur
   de points ; le compteur monte à chaque pièce qui arrive.
========================================================= */

function flyCoins(fromRect, points, pointsBefore) {

    const target = document.getElementById("points-balance");

    if (!target || !fromRect || !(points > 0)) {

        return Promise.resolve();

    }

    const isAdmin = !!currentProfile?.is_admin;

    const toRect = target.getBoundingClientRect();

    const start = {
        x: fromRect.left + fromRect.width / 2,
        y: fromRect.top + fromRect.height / 2
    };

    const end = {
        x: toRect.left + toRect.width / 2,
        y: toRect.top + toRect.height / 2
    };

    const count = Math.max(6, Math.min(14, Math.round(points / 2)));

    const format = value => Math.round(value) + " 🪙";

    let arrived = 0;

    let shown = pointsBefore;

    let lastBump = 0;

    // Le compteur repart de l'ancien total et monte à chaque pièce.
    if (!isAdmin) {

        target.textContent = format(pointsBefore);

    }

    // Les pièces ne sortent jamais de la fenêtre.
    const margin = 14;

    const keep = point => ({
        x: Math.min(Math.max(point.x, margin), window.innerWidth - margin),
        y: Math.min(Math.max(point.y, margin), window.innerHeight - margin)
    });

    // Une pièce mesure 22 px : on centre sa position.
    const at = point => `translate(${point.x - 11}px, ${point.y - 11}px)`;

    // Direction perpendiculaire au trajet, pour courber le vol sans sortir de l'écran.
    const dx = end.x - start.x;

    const dy = end.y - start.y;

    const length = Math.hypot(dx, dy) || 1;

    const normal = { x: -dy / length, y: dx / length };

    const done = [];

    for (let i = 0; i < count; i++) {

        const coin = document.createElement("span");

        coin.className = "mission-coin";

        document.body.appendChild(coin);

        // Départ : le bouton « Récupérer » (à quelques pixels près).
        const from = keep({
            x: start.x + (Math.random() - 0.5) * 16,
            y: start.y + (Math.random() - 0.5) * 10
        });

        const bend = (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 40);

        const middle = keep({
            x: from.x + (end.x - from.x) * 0.5 + normal.x * bend,
            y: from.y + (end.y - from.y) * 0.5 + normal.y * bend
        });

        const arrival = keep(end);

        const animation = coin.animate(
            [
                { transform: `${at(from)} scale(0.5)`, opacity: 0 },
                { transform: `${at(from)} scale(1)`, opacity: 1, offset: 0.08 },
                { transform: `${at(middle)} scale(1)`, opacity: 1, offset: 0.55 },
                { transform: `${at(arrival)} scale(0.6)`, opacity: 1, offset: 0.95 },
                { transform: `${at(arrival)} scale(0.4)`, opacity: 0 }
            ],
            {
                duration: 1000 + Math.random() * 60,
                delay: i * 85,
                easing: "cubic-bezier(.45, 0, .2, 1)",
                fill: "both"
            }
        );

        done.push(animation.finished.then(() => {

            coin.remove();

            arrived++;

            const next = Math.round(pointsBefore + points * arrived / count);

            if (!isAdmin) {

                animateNumber(target, shown, next, 200, format);

            }

            shown = next;

            // Une petite pulsation du compteur de temps en temps, pas à chaque pièce.
            if (performance.now() - lastBump > 280) {

                lastBump = performance.now();

                bump(target);

            }

        }).catch(() => coin.remove()));

    }

    return Promise.all(done).then(() => {

        // Valeur définitive, telle que la base la connaît.
        updateBalance();

    });

}



/* =========================================================
   PIÈCES DÉPENSÉES (boutique)
   Des pièces quittent le compteur de points et filent vers
   le bouton « Acheter » ; le compteur descend à chaque départ.
========================================================= */

function spendCoins(toRect, price, pointsBefore) {

    const source = document.getElementById("points-balance");

    if (!source || !toRect || !(price > 0)) {

        return Promise.resolve();

    }

    const isAdmin = !!currentProfile?.is_admin;

    const fromRect = source.getBoundingClientRect();

    const start = {
        x: fromRect.left + fromRect.width / 2,
        y: fromRect.top + fromRect.height / 2
    };

    const end = {
        x: toRect.left + toRect.width / 2,
        y: toRect.top + toRect.height / 2
    };

    const count = Math.max(6, Math.min(14, Math.round(price / 12)));

    const format = value => Math.round(value) + " 🪙";

    const margin = 14;

    const keep = point => ({
        x: Math.min(Math.max(point.x, margin), window.innerWidth - margin),
        y: Math.min(Math.max(point.y, margin), window.innerHeight - margin)
    });

    const at = point => `translate(${point.x - 11}px, ${point.y - 11}px)`;

    const dx = end.x - start.x;

    const dy = end.y - start.y;

    const length = Math.hypot(dx, dy) || 1;

    const normal = { x: -dy / length, y: dx / length };

    let shown = pointsBefore;

    let lastBump = 0;

    if (!isAdmin) {

        source.textContent = format(pointsBefore);

    }

    const done = [];

    for (let i = 0; i < count; i++) {

        const coin = document.createElement("span");

        coin.className = "mission-coin";

        document.body.appendChild(coin);

        const delay = i * 80;

        const from = keep({
            x: start.x + (Math.random() - 0.5) * 18,
            y: start.y + (Math.random() - 0.5) * 10
        });

        const bend = (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 40);

        const middle = keep({
            x: from.x + (end.x - from.x) * 0.5 + normal.x * bend,
            y: from.y + (end.y - from.y) * 0.5 + normal.y * bend
        });

        const arrival = keep({
            x: end.x + (Math.random() - 0.5) * 24,
            y: end.y + (Math.random() - 0.5) * 8
        });

        // La pièce quitte le compteur : celui-ci descend d'une part du prix.
        setTimeout(() => {

            const next = Math.round(pointsBefore - price * (i + 1) / count);

            if (!isAdmin) {

                animateNumber(source, shown, next, 200, format);

            }

            shown = next;

            if (performance.now() - lastBump > 280) {

                lastBump = performance.now();

                bump(source);

            }

        }, delay);

        const animation = coin.animate(
            [
                { transform: `${at(from)} scale(1)`, opacity: 0 },
                { transform: `${at(from)} scale(1)`, opacity: 1, offset: 0.1 },
                { transform: `${at(middle)} scale(1.05)`, opacity: 1, offset: 0.55 },
                { transform: `${at(arrival)} scale(0.85)`, opacity: 1, offset: 0.92 },
                { transform: `${at(arrival)} scale(0.3)`, opacity: 0 }
            ],
            {
                duration: 950 + Math.random() * 60,
                delay,
                easing: "cubic-bezier(.45, 0, .2, 1)",
                fill: "both"
            }
        );

        done.push(animation.finished.then(() => coin.remove()).catch(() => coin.remove()));

    }

    return Promise.all(done).then(() => {

        updateBalance();

    });

}
