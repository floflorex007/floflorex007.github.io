/* =========================================================
   BETLAB
   Animations et progression
   (série, coffre, niveaux, récap, fil en direct...)

   Chargé après app.js : utilise supabaseClient,
   currentUser, currentProfile, formatMoney, escapeHtml.
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

    for (let i = 0; i < count; i++) {

        const piece = document.createElement("div");

        piece.className = "confetti-piece";

        piece.style.left = Math.random() * 100 + "%";
        piece.style.background = colors[i % colors.length];
        piece.style.animationDuration = 1.8 + Math.random() * 1.6 + "s";
        piece.style.animationDelay = Math.random() * 0.5 + "s";

        layer.appendChild(piece);

    }

    document.body.appendChild(layer);

    setTimeout(() => layer.remove(), 4500);

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
        .select("id, choice_id, stake, potential_win, bets ( question, status, winner_choice_id )")
        .eq("user_id", currentUser.id);

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
        Les gains ne sont plus versés automatiquement :
        la pop-up annonce les résultats, et l'argent se récupère
        en cliquant sur les cartes de la page principale.
    */

    showResultsPopup(fresh, totalWon);


    if (typeof displayBets === "function") {
        displayBets();
    }

    if (typeof displayMyBets === "function") {
        displayMyBets();
    }

    refreshProgression();

}


function showResultsPopup(results, totalWon) {

    const overlay =
        document.createElement("div");

    overlay.className = "results-overlay";

    const lines =
        results.map((s, index) => {

            const won =
                s.bets.winner_choice_id === s.choice_id;

            return `
                <div
                    class="results-line ${won ? "won" : "lost"}"
                    style="animation-delay: ${0.4 + index * 0.35}s"
                >
                    <span>${won ? "✅" : "❌"} ${escapeHtml(s.bets.question)}</span>
                    <strong>${won ? "+" + formatMoney(s.potential_win) : "-" + formatMoney(s.stake)}</strong>
                </div>
            `;

        }).join("");

    overlay.innerHTML = `
        <div class="results-popup">

            <h2>${totalWon > 0 ? "🎉 Il y a du mouvement !" : "Il y a du mouvement !"}</h2>

            <div class="results-lines">${lines}</div>

            <div
                class="results-total"
                style="animation-delay: ${0.4 + results.length * 0.35}s"
            >
                À récupérer
                <strong>${formatMoney(totalWon)}</strong>
            </div>

            <button class="primary-button results-close">Aller récupérer</button>

        </div>
    `;

    document.body.appendChild(overlay);

    overlay
        .querySelector(".results-close")
        .addEventListener("click", () => {

            overlay.remove();

            // Les cartes à récupérer sont en haut de la page principale.
            if (typeof showPage === "function") {
                showPage("bets-page");
            }

        });

}



/* =========================================================
   5. SÉRIE DE CONNEXIONS ET COFFRE DU JOUR
========================================================= */

async function dailyCheckin() {

    const {
        data,
        error
    } = await supabaseClient.rpc("daily_checkin");

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


    const {
        data,
        error
    } = await supabaseClient.rpc("open_daily_chest");


    setTimeout(async () => {

        chest.classList.remove("opening");

        if (error) {
            console.error(error);
            alertToast(error.message || "Impossible d'ouvrir le coffre.");
            chest.classList.add("hidden");
            return;
        }

        icon.textContent = "📦";

        chest.querySelector(".chest-text span").textContent =
            "+" + data + " points gagnés !";


        const loot =
            document.createElement("div");

        loot.className = "chest-loot";

        loot.textContent = "+" + data + " pts";

        const rect = icon.getBoundingClientRect();

        loot.style.left = rect.left + rect.width / 2 + "px";
        loot.style.top = rect.bottom + "px";

        document.body.appendChild(loot);

        setTimeout(() => loot.remove(), 1800);


        const before =
            currentProfile?.points || 0;

        await loadCurrentProfile();

        animateNumber(
            document.getElementById("points-balance"),
            before,
            currentProfile.points || 0,
            900,
            value => Math.round(value) + " pts"
        );

        if (typeof displayShop === "function") {
            displayShop();
        }


        /*
            Le coffre disparaît une fois ouvert
            (il revient demain).
        */

        setTimeout(() => {
            chest.classList.add("chest-leaving");
            setTimeout(() => {

                // L'admin peut rouvrir le coffre à l'infini.
                if (currentProfile?.is_admin) {
                    icon.textContent = "🎁";
                    chest.querySelector(".chest-text span").textContent = "Clique pour l'ouvrir !";
                    chest.classList.remove("chest-leaving");
                    chest.disabled = false;
                    return;
                }

                chest.classList.add("hidden");

            }, 500);
        }, 2000);

    }, 800);

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

    /*
        Panneau « Ton niveau » à droite de la page principale.
    */

    const sidebarLabel =
        document.getElementById("level-sidebar-label");

    if (sidebarLabel) {

        sidebarLabel.textContent = "Niveau " + info.level;

        document.getElementById("level-sidebar-xp").textContent =
            info.current + " / " + info.needed + " XP";

        document.getElementById("level-sidebar-fill").style.width =
            Math.round(info.current / info.needed * 100) + "%";

    }


    const previousLevel =
        readStorage("level");

    writeStorage("level", info.level);

    if (previousLevel && info.level > previousLevel) {
        showLevelUp(info.level);
    }

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

function updateCountdowns() {

    document
        .querySelectorAll(".bet-card[data-deadline]")
        .forEach(card => {

            const remaining =
                new Date(card.dataset.deadline) - new Date();

            const label =
                card.querySelector(".bet-deadline");

            if (remaining <= 0 || remaining > 3600 * 1000) {
                card.classList.remove("bet-card-urgent");
                return;
            }

            card.classList.add("bet-card-urgent");

            const minutes = Math.floor(remaining / 60000);

            const seconds = Math.floor(remaining / 1000) % 60;

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

    root
        .querySelectorAll(".bet-card, .my-bet-item, .mission-card")
        .forEach((card, index) => {

            card.classList.remove("cascade-in");

            void card.offsetWidth;

            card.style.animationDelay = Math.min(index, 12) * 0.06 + "s";

            card.classList.add("cascade-in");

        });

}



/* =========================================================
   10. CARTES QUI SUIVENT LA SOURIS
       ET ONDE AU CLIC SUR LES CHOIX
========================================================= */

function setupPointerEffects() {


    document.addEventListener("mousemove", event => {

        const card =
            event.target.closest(".bet-card, .mission-card");

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
            .select("created_at, stake, user_id, profiles!stakes_user_id_fkey ( username, is_admin, gold_frame_until, name_color_until, cosmetics ), bets ( question )")
            .gt("created_at", since)
            .neq("user_id", currentUser.id)
            .order("created_at", { ascending: firstPass ? false : true })
            .limit(firstPass ? 3 : 5),

        supabaseClient
            .from("bets")
            .select("created_at, question, author_id, profiles!bets_author_id_fkey ( username, is_admin, gold_frame_until, name_color_until, cosmetics )")
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

    setInterval(updateCountdowns, 1000);

    updateCountdowns();

    cascadeIn(document.getElementById("bets-page"));


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

        await pollActivity();

        await checkNewResults();

        await displayLeaderboard();

    }, FEED_INTERVAL_MS);

}
