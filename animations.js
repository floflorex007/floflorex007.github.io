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

        // L'heure de l'image peut précéder « start » : jamais en dessous de 0
        // (sinon le chiffre partait brièvement dans le négatif).
        const progress = Math.max(0, Math.min(1, (now - start) / duration));

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

    streakState.shields = row.shields || 0;
    streakState.canRestore = Boolean(row.can_restore);
    streakState.lost = row.lost_streak || 0;


    const widget =
        document.getElementById("streak-widget");

    const count =
        document.getElementById("streak-count");

    widget.classList.remove("hidden");

    count.textContent = row.streak;

    // « 1 jour » / « 4 jours » dans la capsule (ordinateur).
    document.getElementById("streak-unit").textContent =
        row.streak > 1 ? "jours" : "jour";

    if (row.streak > bestStreak()) {

        writeStorage("best-streak", row.streak);

    }

    // Série du jour retenue dans le profil : le pseudo enflammé (15 jours) la suit.
    if (currentProfile) {

        currentProfile.streak_days = row.streak;

        currentProfile.last_checkin = parisDay();

    }

    renderParrotSkins();

    widget.style.setProperty(
        "--flame-size",
        Math.min(26, 16 + row.streak) + "px"
    );

    widget.title =
        "Série de " + row.streak + " jour" + (row.streak > 1 ? "s" : "") +
        " : clique pour en savoir plus";

    // L'administrateur a une série illimitée.
    if (currentProfile?.is_admin) {

        count.textContent = "∞";

        document.getElementById("streak-unit").textContent = "";

        widget.style.setProperty("--flame-size", "26px");

        widget.title = "Série illimitée (admin) : clique pour en savoir plus";

        streakState.canRestore = false;

    }

    if (row.increased && !streakAlreadyShown) {
        streakAlreadyShown = true;
        bump(widget);
        widget.classList.add("streak-up");
    }

    // Série perdue rattrapable : la flamme clignote doucement.
    widget.classList.toggle("streak-restorable", streakState.canRestore);

    if (streakState.canRestore) {
        widget.title = "Tu as perdu ta série de " + streakState.lost + " jours : clique pour la rattraper avant minuit !";
    }

    if (row.shield_used > 0 && typeof parrotClickToast === "function") {

        setTimeout(() => parrotClickToast(
            "🛡️ " + (row.shield_used > 1 ? row.shield_used + " boucliers utilisés" : "Bouclier utilisé") +
            " : ta série est sauvée !"
        ), 1200);

    }

    renderStreakProtect();


    const chest =
        document.getElementById("chest-button");

    placeChest();

    // Le coffre n'apparaît que lorsqu'il peut être ouvert.
    chest.classList.toggle("hidden", !row.chest_available);

    chest.disabled = !row.chest_available;

}


/*
    Ordinateur : le coffre est une capsule dorée dans la barre du haut,
    à gauche de la jauge d'XP (version A de demo-coffre-compact.html).
    Téléphone : il reste une grande carte dans la colonne de droite.
*/

let chestHome = null;

function chestInBar(chest) {

    return chest.classList.contains("chest-capsule");

}

// Textes du coffre fermé, selon sa place.
function chestIdleTexts(chest) {

    const inBar = chestInBar(chest);

    chest.querySelector(".chest-text strong").textContent =
        inBar ? "Coffre" : "Coffre du jour";

    chest.querySelector(".chest-text span").textContent =
        inBar ? "Ouvrir" : "Clique pour l'ouvrir !";

}

function placeChest() {

    const chest =
        document.getElementById("chest-button");

    const xpMini =
        document.getElementById("xp-mini");

    if (!chest || !xpMini) {
        return;
    }

    // Place d'origine (colonne de droite), pour y revenir sur téléphone.
    if (!chestHome) {
        chestHome = { parent: chest.parentNode, next: chest.nextSibling };
    }

    const toBar =
        !PHONE_LAYOUT.matches;

    if (toBar === chestInBar(chest)) {
        return;
    }

    if (toBar) {
        xpMini.before(chest);
    } else {
        chestHome.parent.insertBefore(chest, chestHome.next);
    }

    chest.classList.toggle("chest-capsule", toBar);

    // Coffre pas encore ouvert : ses textes suivent sa nouvelle place.
    if (!chest.disabled || chest.classList.contains("hidden")) {
        chestIdleTexts(chest);
    }

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
            alertToast(escapeHtml(error.message || "Impossible d'ouvrir le coffre."));
            chest.classList.add("hidden");
            return;
        }

        // Ouverture : l'icône « éclot » et le texte se fond vers le gain.
        icon.textContent = "📦";

        icon.classList.remove("chest-pop");

        void icon.offsetWidth;

        icon.classList.add("chest-pop");

        textElement.textContent = chestInBar(chest)
            ? "+" + data + " 🪙"
            : "+" + data + " points gagnés !";

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

                chestIdleTexts(chest);

                chest.disabled = false;

                return;

            }

            chest.style.overflow = "hidden";

            if (chestInBar(chest)) {

                // Barre du haut : la capsule se replie en largeur, la jauge d'XP glisse à sa place.
                const width = chest.offsetWidth;

                await chest.animate(
                    [
                        { width: width + "px", opacity: 1, transform: "scale(1)", paddingLeft: "12px", paddingRight: "12px", borderWidth: "1px", marginRight: "0px" },
                        { width: "0px", opacity: 0, transform: "scale(0.9)", paddingLeft: "0px", paddingRight: "0px", borderWidth: "0px", marginRight: "-10px" }
                    ],
                    { duration: 550, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
                ).finished.catch(() => {});

            } else {

                // Repli en hauteur : les cartes du dessous remontent sans à-coup.
                const height = chest.offsetHeight;

                await chest.animate(
                    [
                        { height: height + "px", opacity: 1, transform: "scale(1)", paddingTop: "16px", paddingBottom: "16px", marginTop: "0px" },
                        { height: "0px", opacity: 0, transform: "scale(0.94)", paddingTop: "0px", paddingBottom: "0px", marginTop: "-16px" }
                    ],
                    { duration: 650, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
                ).finished.catch(() => {});

            }

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

    // Carte « Ton niveau », ou jauge de la barre du haut quand la carte est cachée.
    const card = [document.querySelector(".level-sidebar"), document.getElementById("xp-mini")]
        .find(element => element && element.getClientRects().length > 0);

    if (!card) {

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

/*
    Skins du perroquet, débloqués selon le niveau (fenêtre XP).
    Le skin choisi est retenu dans le navigateur, comme le niveau débloqué.
*/

const PARROT_SKINS = [
    { id: "classique", name: "Classique", level: 0 },
    { id: "flamant", name: "Flamant", level: 10 },
    { id: "nuit", name: "Bleu nuit", level: 12 },
    { id: "violet", name: "Violet royal", level: 14 },
    { id: "arctique", name: "Arctique", level: 16 },
    { id: "noir", name: "Noir et or", level: 18 },
    { id: "phenix", name: "Phénix", streak: 30 },
    // Exclusivité diamant (diamants.sql) : visible dans la fenêtre XP une fois achetée.
    { id: "cristal", name: "Cristal", diamond: "skin_cristal" }
];


// Meilleure série atteinte (le Phénix reste débloqué même si la série retombe).
function bestStreak() {

    return Number(readStorage("best-streak")) || 0;

}


function skinUnlocked(skin) {

    if (currentProfile?.is_admin) {
        return true;
    }

    if (skin.diamond) {
        return Boolean(currentProfile?.diamond_items?.[skin.diamond]);
    }

    return skin.streak
        ? bestStreak() >= skin.streak
        : (skin.level || 0) <= playerLevel;

}

let playerLevel = 1;


function activeParrotSkin() {

    const saved = readStorage("parrot-skin");

    const skin = PARROT_SKINS.find(s => s.id === saved);

    return skin && skinUnlocked(skin) ? skin.id : "classique";

}


function applyParrotSkin() {

    const id = activeParrotSkin();

    // Skin enregistré dans le profil : les autres le voient dans la fenêtre du joueur.
    if (currentProfile && currentProfile.parrot_skin !== id && typeof supabaseClient !== "undefined") {

        currentProfile.parrot_skin = id;

        supabaseClient.rpc("set_parrot_skin", { p_skin: id }).then(({ error }) => {
            if (error) console.error(error);
        });

    }

    if (typeof Parrot !== "undefined" && Parrot.skin) {

        Parrot.skin(id);

    }

    // Phénix : lueur rouge qui respire (style.css) et braises qui montent.
    document.body.classList.toggle("parrot-phenix", id === "phenix");

    if (id === "phenix") {

        startPhenixEmbers();

    }

}


function skinItemHtml(skin, active) {

    const unlocked = skinUnlocked(skin);

    const isActive = skin.id === active;

    const button = !unlocked
        ? `<button type="button" class="xp-skin-button locked" disabled>🔒 Non disponible</button>`
        : skin.id === "classique"
            ? `<button type="button" class="xp-skin-button${isActive ? " active" : ""}" data-skin="classique" ${isActive ? "disabled" : ""}>${isActive ? "✓ Activé" : "Activer"}</button>`
            : `<button type="button" class="xp-skin-button${isActive ? " active" : ""}" data-skin="${skin.id}">${isActive ? "Désactiver" : "Activer"}</button>`;

    return `
        <li class="xp-skin${unlocked ? "" : " locked"}${isActive ? " active" : ""}">
            ${skin.id === "phenix"
                // Phénix : lueur rouge et braises, comme le vrai perroquet.
                ? `<span class="phenix-thumb"><img src="assets/perroquet/skins/phenix/thumb.png" alt=""><i></i><i></i><i></i><i></i><i></i></span>`
                : `<img src="assets/perroquet/skins/${skin.id}/thumb.png" alt="">`}
            <div class="xp-skin-text">
                <strong>Skin ${escapeHtml(skin.name)}</strong>
                <span>${skin.diamond ? "💎 Exclusivité diamant" : skin.streak ? "🔥 " + skin.streak + " jours de série" : skin.level ? "Niveau " + skin.level : "Dès le départ"}</span>
            </div>
            ${button}
        </li>
    `;

}


// Fenêtre de la série : pseudo enflammé à 15 jours, tant que la série tient.
function flameNameItemHtml() {

    if (!currentProfile) {
        return "";
    }

    const streak =
        Number(currentProfile.streak_days) || 0;

    const unlocked =
        currentProfile.is_admin || streak >= FLAME_NAME_STREAK;

    const on =
        unlocked && !currentProfile.flame_name_off;

    const me = { username: currentProfile.username };

    const name =
        unlocked ? nameHtml(me, { flame: true }) : escapeHtml(currentProfile.username);

    const button = !unlocked
        ? `<button type="button" class="xp-skin-button locked" disabled>🔒 Non disponible</button>`
        : `<button type="button" class="xp-skin-button${on ? " active" : ""}" data-flame-name="${on ? "off" : "on"}">${on ? "Désactiver" : "Activer"}</button>`;

    return `
        <li class="xp-skin${unlocked ? "" : " locked"}${on ? " active" : ""}">
            <span class="flame-name-thumb">${unlocked ? nameHtml({ username: currentProfile.username.charAt(0).toUpperCase() }, { flame: true }) : "🔒"}</span>
            <div class="xp-skin-text">
                <strong>Pseudo enflammé : ${name}</strong>
                <span>🔥 ${FLAME_NAME_STREAK} jours de série · tant que ta série tient</span>
            </div>
            ${button}
        </li>
    `;

}


// Fenêtre XP : skins de niveau. Fenêtre de la série : skins de série (Phénix).
function renderParrotSkins() {

    const active = activeParrotSkin();

    const xpList = document.getElementById("xp-skins");

    if (xpList) {

        xpList.innerHTML = PARROT_SKINS
            .filter(skin => !skin.streak && (!skin.diamond || skinUnlocked(skin)))
            .map(skin => skinItemHtml(skin, active))
            .join("");

    }

    const streakList = document.getElementById("streak-skins");

    if (streakList) {

        streakList.innerHTML = flameNameItemHtml() + PARROT_SKINS
            .filter(skin => skin.streak)
            .map(skin => skinItemHtml(skin, active))
            .join("");

    }

}


function setupParrotSkins() {

    document.addEventListener("click", async event => {

        // Pseudo enflammé : activé ou désactivé pour tout le monde.
        const flame = event.target.closest(".xp-skins [data-flame-name]");

        if (flame && !flame.disabled) {

            flame.disabled = true;

            const on = flame.dataset.flameName === "on";

            const { error } = await supabaseClient.rpc("toggle_flame_name", { p_on: on });

            if (error) {

                console.error(error);

                flame.disabled = false;

                return;

            }

            currentProfile.flame_name_off = !on;

            renderParrotSkins();

            displayLeaderboard?.();

            return;

        }

        const button = event.target.closest(".xp-skins [data-skin]");

        if (!button || button.disabled) {

            return;

        }

        const id = button.dataset.skin;

        // « Désactiver » sur le skin actif : retour au classique.
        writeStorage("parrot-skin", id === activeParrotSkin() ? "classique" : id);

        applyParrotSkin();

        renderParrotSkins();

    });

}

document.addEventListener("DOMContentLoaded", setupParrotSkins);


/*
    Fenêtre de la série : un clic sur la flamme explique le comptage,
    les protections et la récompense de série.
*/

function setupStreakModal() {

    const widget = document.getElementById("streak-widget");

    const modal = document.getElementById("streak-modal");

    if (!widget || !modal) {

        return;

    }

    const days = n => n + " jour" + (n > 1 ? "s" : "");

    const open = () => {

        const current = Number(document.getElementById("streak-count").textContent) || 0;

        const admin = Boolean(currentProfile?.is_admin);

        document.getElementById("streak-modal-current").textContent = admin ? "🔥 ∞" : "🔥 " + days(current);

        document.getElementById("streak-modal-best").textContent = admin ? "🏆 ∞" : "🏆 " + days(Math.max(current, bestStreak()));

        renderParrotSkins();

        renderStreakProtect();

        document.getElementById("streak-message").textContent = "";

        modal.classList.remove("hidden");

    };

    widget.addEventListener("click", open);

    widget.addEventListener("keydown", event => {

        if (event.key === "Enter" || event.key === " ") {

            event.preventDefault();

            open();

        }

    });

    document
        .getElementById("close-streak-modal")
        .addEventListener("click", () => modal.classList.add("hidden"));

}

document.addEventListener("DOMContentLoaded", setupStreakModal);


/*
    Protections de la série : bouclier (boutique, 40 points, 3 maximum)
    et rattrapage 24 h (60 points). Voir serie-protection.sql.
*/

const SHIELD_PRICE = 40;

const SHIELD_MAX = 3;

const RESTORE_PRICE = 60;

const streakState = { shields: 0, canRestore: false, lost: 0 };


function renderStreakProtect() {

    const box = document.getElementById("streak-protect");

    if (!box) {

        return;

    }

    const points = Number(currentProfile?.points || 0);

    const full = streakState.shields >= SHIELD_MAX;

    box.innerHTML = `
        <div class="xp-rule streak-protect">
            <div class="xp-rule-head">
                <span class="xp-rule-icon">🛡️</span>
                <div>
                    <strong>Bouclier de série</strong>
                    <span>Utilisé tout seul si tu rates un jour : ta série continue. Un bouclier par jour manqué.</span>
                </div>
                <em>${streakState.shields} / ${SHIELD_MAX}</em>
            </div>
            <button type="button" class="streak-action shield-buy" ${full || points < SHIELD_PRICE ? "disabled" : ""}>
                ${full ? "Maximum atteint" : points < SHIELD_PRICE ? "Il te manque " + (SHIELD_PRICE - points) + " 🪙" : "Acheter un bouclier · " + SHIELD_PRICE + " 🪙"}
            </button>
        </div>

        <div class="xp-rule streak-protect${streakState.canRestore ? " restorable" : ""}">
            <div class="xp-rule-head">
                <span class="xp-rule-icon">⏪</span>
                <div>
                    <strong>Rattrapage 24 h</strong>
                    <span>${streakState.canRestore
                        ? "Ta série de " + streakState.lost + " jours s'est arrêtée hier. Récupère-la avant minuit !"
                        : "Si tu rates un seul jour sans bouclier, tu pourras récupérer ta série le jour de ton retour, jusqu'à minuit."}</span>
                </div>
                <em>${RESTORE_PRICE} 🪙</em>
            </div>
            ${streakState.canRestore
                ? `<button type="button" class="streak-action restore-streak" ${points < RESTORE_PRICE ? "disabled" : ""}>
                    ${points < RESTORE_PRICE ? "Il te manque " + (RESTORE_PRICE - points) + " 🪙" : "Rattraper ma série · " + RESTORE_PRICE + " 🪙"}
                   </button>`
                : ""}
        </div>
    `;

}


function streakMessage(text, isError, elementId) {

    if (elementId === "shop-message" && typeof showMissionsMessage === "function") {

        showMissionsMessage(text, isError, "shop-message");

        return;

    }

    const el = document.getElementById("streak-message");

    if (el) {

        el.textContent = text;

        el.classList.toggle("error", Boolean(isError));

    }

}


async function buyStreakShield(button, messageId = "streak-message") {

    const rect = button.getBoundingClientRect();

    const pointsBefore = Number(currentProfile?.points || 0);

    button.disabled = true;

    const { data, error } = await supabaseClient.rpc("buy_streak_shield", { p_group: currentGroup.id });

    if (error) {

        streakMessage(error.message || "Impossible d'acheter le bouclier.", true, messageId);

        button.disabled = false;

        return;

    }

    streakState.shields = Number(data) || streakState.shields + 1;

    if (typeof spendCoins === "function") {

        currentProfile.points = pointsBefore - SHIELD_PRICE;

        await spendCoins(rect, SHIELD_PRICE, pointsBefore);

    }

    await loadCurrentProfile();

    renderStreakProtect();

    if (typeof displayShop === "function") {

        displayShop();

    }

    if (messageId === "streak-message") {

        streakMessage("🛡️ Bouclier acheté ! Tu en as " + streakState.shields + " / " + SHIELD_MAX + ".", false, messageId);

    }

}


async function restoreStreak(button, messageId = "streak-message") {

    const rect = button.getBoundingClientRect();

    const pointsBefore = Number(currentProfile?.points || 0);

    button.disabled = true;

    const { data, error } = await supabaseClient.rpc("restore_streak", { p_group: currentGroup.id });

    if (error) {

        streakMessage(error.message || "Impossible de rattraper la série.", true, messageId);

        button.disabled = false;

        return;

    }

    if (typeof spendCoins === "function") {

        currentProfile.points = pointsBefore - RESTORE_PRICE;

        await spendCoins(rect, RESTORE_PRICE, pointsBefore);

    }

    streakState.canRestore = false;

    streakState.lost = 0;

    // Met à jour la flamme, la meilleure série et le coffre.
    await dailyCheckin();

    await loadCurrentProfile();

    const days = Number(data) || 0;

    document.getElementById("streak-modal-current").textContent = "🔥 " + days + " jour" + (days > 1 ? "s" : "");

    document.getElementById("streak-modal-best").textContent = "🏆 " + Math.max(days, bestStreak()) + " jours";

    renderStreakProtect();

    renderParrotSkins();

    if (typeof displayShop === "function") {

        displayShop();

    }

    streakMessage("🔥 Série rattrapée : " + days + " jours !", false, messageId);

}


document.addEventListener("click", event => {

    const shield = event.target.closest("#streak-protect .shield-buy");

    if (shield && !shield.disabled) {

        buyStreakShield(shield);

        return;

    }

    const restore = event.target.closest("#streak-protect .restore-streak");

    if (restore && !restore.disabled) {

        restoreStreak(restore);

    }

});


// Carte du rattrapage dans la boutique (catégorie « Série »).
function restoreCardHtml(points) {

    const can = streakState.canRestore && !currentProfile?.is_admin;

    const enough = points >= RESTORE_PRICE;

    return `
        <div class="mission-card shop-card" data-shop-item="rattrapage">

            <div class="mission-head">
                <h3>Rattrapage 24 h</h3>
                <span class="mission-points">${RESTORE_PRICE} 🪙</span>
            </div>

            <p class="mission-description">${can
                ? "Ta série de " + streakState.lost + " jours s'est arrêtée hier. Récupère-la avant minuit !"
                : "Si tu rates un seul jour sans bouclier, récupère ta série le jour de ton retour, jusqu'à minuit."}</p>

            <div class="mission-footer">
                <span class="mission-state${can ? " done" : ""}">${can ? "🔥 À rattraper" : "Rien à rattraper"}</span>
                <button
                    class="primary-button restore-buy"
                    ${can && enough ? "" : "disabled"}
                >
                    ${can && !enough ? "Il te manque " + (RESTORE_PRICE - points) + " 🪙" : "Rattraper"}
                </button>
            </div>

        </div>
    `;

}


// Carte du bouclier dans la boutique (catégorie « Série »).
function shieldCardHtml(points) {

    const full = streakState.shields >= SHIELD_MAX;

    const canBuy = !full && points >= SHIELD_PRICE;

    return `
        <div class="mission-card shop-card" data-shop-item="bouclier">

            <div class="mission-head">
                <h3>Bouclier de série</h3>
                <span class="mission-points">${SHIELD_PRICE} 🪙</span>
            </div>

            <p class="mission-description">Protège ta série 🔥 : si tu rates un jour, un bouclier est utilisé tout seul et ta série continue. 3 maximum.</p>

            <div class="mission-footer">
                <span class="mission-state${full ? " done" : ""}">🛡️ ${streakState.shields} / ${SHIELD_MAX}</span>
                <button
                    class="primary-button shield-buy"
                    ${canBuy ? "" : "disabled"}
                >
                    ${full ? "Maximum" : "Acheter"}
                </button>
            </div>

        </div>
    `;

}


function xpNeededForLevel(level) {

    return 100 + 50 * (level - 1);

}

function applyProgression(info) {

    lastProgressInfo = info;

    // L'administrateur a un niveau illimité : tous les skins sont débloqués.
    if (currentProfile?.is_admin) {

        playerLevel = Infinity;

        applyParrotSkin();

        renderParrotSkins();

        const label = document.getElementById("level-sidebar-label");

        if (label) {

            label.textContent = "Niveau ∞";

            document.getElementById("level-sidebar-xp").textContent = "XP illimitée";

            document.getElementById("level-sidebar-fill").style.width = "100%";

        }

        document.getElementById("level-up-button")?.classList.add("hidden");

        return;

    }

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


    playerLevel = shown.level;

    applyParrotSkin();

    renderParrotSkins();


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


/*
    Niveau débloqué, façon Call of Duty (réglages de la maquette A) :
    l'écran s'assombrit, une grande barre d'XP se remplit en accélérant,
    explose en éclats (flash + tremblement), puis le nouveau niveau tombe
    au centre avec des rayons, et la récompense éventuelle (skin) arrive.
    Un clic n'importe où ferme l'animation.
*/

const LEVEL_UP = {
    colors: ["#7b61ff", "#d18bff", "#ffffff"],
    start: 0,
    fill: 1200,
    particles: 130,
    shake: 10,
    flash: 0.7,
    hold: 2200
};

let levelUpRun = 0;

function showLevelUp(level) {

    const run = ++levelUpRun;

    document.querySelector(".lu-overlay")?.remove();

    const L = LEVEL_UP;

    const need = xpNeededForLevel(level - 1);

    const skin = typeof PARROT_SKINS !== "undefined"
        ? PARROT_SKINS.find(s => s.level === level)
        : null;

    const overlay = document.createElement("div");

    overlay.className = "lu-overlay";

    overlay.innerHTML = `
        <div class="lu-bg"></div>
        <div class="lu-content">
            <div class="lu-bar-wrap">
                <div class="lu-title">NIVEAU SUPÉRIEUR</div>
                <div class="lu-row">
                    <div class="lu-badge">${level - 1}</div>
                    <div class="lu-bar"><div class="lu-fill"></div><div class="lu-ticks"></div></div>
                    <div class="lu-badge next">${level}</div>
                </div>
                <div class="lu-xp">0 / ${need} XP</div>
            </div>
            <div class="lu-rays"></div>
            <div class="lu-big">
                <div class="lu-big-label">NIVEAU</div>
                <div class="lu-big-num">${level}</div>
                <div class="lu-big-sub">DÉBLOQUÉ !</div>
            </div>
            ${skin ? `
                <div class="lu-reward">
                    <img src="assets/perroquet/skins/${skin.id}/thumb.png" alt="">
                    <div>
                        <strong>Skin ${escapeHtml(skin.name)} débloqué</strong>
                        <span>Active-le dans la fenêtre XP</span>
                    </div>
                </div>` : ""}
        </div>
        <canvas class="lu-fx"></canvas>
        <div class="lu-flash"></div>
    `;

    document.body.appendChild(overlay);

    const $ = selector => overlay.querySelector(selector);

    const anim = (el, frames, ms, opts = {}) =>
        el.animate(frames, { duration: ms, fill: "forwards", easing: "cubic-bezier(.2,.8,.2,1)", ...opts });

    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    const alive = () => run === levelUpRun && overlay.isConnected;


    // ----- Éclats et étincelles -----
    const canvas = $(".lu-fx");

    const ctx = canvas.getContext("2d");

    let parts = [];

    const burst = (x, y, n, o = {}) => {

        for (let i = 0; i < n; i++) {

            const a = o.angle !== undefined ? o.angle + (Math.random() - 0.5) * (o.spread || 6.28) : Math.random() * 6.28;

            const sp = (o.speed || 520) * (0.3 + Math.random() * 0.9);

            parts.push({
                x: x + (o.w ? (Math.random() - 0.5) * o.w : 0),
                y: y + (o.h ? (Math.random() - 0.5) * o.h : 0),
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp - (o.up || 0),
                life: 0.6 + Math.random() * 0.9,
                age: 0,
                rot: Math.random() * 6,
                vr: (Math.random() - 0.5) * 14,
                shard: o.shards && Math.random() < 0.6,
                w: 4 + Math.random() * 10,
                h: 2 + Math.random() * 4,
                col: L.colors[Math.floor(Math.random() * 3)]
            });

        }

    };

    let prev = performance.now();

    const frame = t => {

        if (!overlay.isConnected) {
            return;
        }

        const dt = Math.min(0.05, (t - prev) / 1000);

        prev = t;

        const W = innerWidth, H = innerHeight;

        const ratio = Math.min(2, devicePixelRatio || 1);

        if (canvas.width !== W * ratio) {
            canvas.width = W * ratio;
            canvas.height = H * ratio;
        }

        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = "lighter";

        parts = parts.filter(q => {

            q.age += dt;

            if (q.age > q.life) {
                return false;
            }

            q.vx *= Math.pow(0.18, dt);
            q.vy = q.vy * Math.pow(0.18, dt) + 260 * dt;
            q.x += q.vx * dt;
            q.y += q.vy * dt;
            q.rot += q.vr * dt;

            ctx.globalAlpha = 1 - q.age / q.life;
            ctx.fillStyle = q.col;
            ctx.save();
            ctx.translate(q.x, q.y);
            ctx.rotate(q.rot);

            if (q.shard) {
                ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, 1.5 + q.h * 0.4, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();

            return true;

        });

        ctx.globalAlpha = 1;

        requestAnimationFrame(frame);

    };

    requestAnimationFrame(frame);


    const shake = px => {

        const keys = [];

        for (let i = 0; i < 8; i++) {
            keys.push({ transform: `translate(${(Math.random() - .5) * px * 2}px, ${(Math.random() - .5) * px * 2}px)` });
        }

        keys.push({ transform: "translate(0, 0)" });

        [$(".lu-content"), ...document.querySelectorAll(".navbar, .main-container")].forEach(el => {
            el?.animate(keys, { duration: 420, easing: "linear" });
        });

    };

    const close = () => {

        if (!overlay.isConnected || overlay.classList.contains("closing")) {
            return;
        }

        overlay.classList.add("closing");

        anim(overlay, [{ opacity: 1 }, { opacity: 0 }], 450, { easing: "ease-in" })
            .finished.then(() => overlay.remove());

    };

    overlay.addEventListener("click", close);


    (async () => {

        const wrap = $(".lu-bar-wrap"), fill = $(".lu-fill"), xp = $(".lu-xp");

        fill.style.width = L.start + "%";

        anim(overlay, [{ opacity: 0 }, { opacity: 1 }], 350);

        anim(wrap, [{ opacity: 0, transform: "scale(.7)" }, { opacity: 1, transform: "scale(1)" }], 450, { easing: "cubic-bezier(.3,1.4,.5,1)" });

        await wait(550);

        if (!alive()) return;

        // Remplissage en accélérant, compteur d'XP et étincelles en tête de barre.
        anim(fill, [{ width: L.start + "%" }, { width: "100%" }], L.fill, { easing: "cubic-bezier(.6,0,.9,.6)" });

        const t0 = performance.now();

        const tick = () => {

            if (!alive()) return;

            const p = Math.min(1, (performance.now() - t0) / L.fill);

            xp.textContent = Math.round(need * (L.start / 100 + (1 - L.start / 100) * p * p)) + " / " + need + " XP";

            const bar = $(".lu-bar").getBoundingClientRect(), f = fill.getBoundingClientRect();

            burst(f.right, bar.top + bar.height / 2, 2, { angle: -Math.PI / 2, spread: 2, speed: 220, up: 60 });

            if (p < 1) requestAnimationFrame(tick);

        };

        tick();

        await wait(L.fill);

        if (!alive()) return;

        anim($(".lu-badge.next"), [{ transform: "scale(1)" }, { transform: "scale(1.4)", background: "white" }], 120);

        await wait(140);

        if (!alive()) return;

        // Explosion de la barre.
        const r = $(".lu-bar").getBoundingClientRect();

        anim($(".lu-flash"), [{ opacity: L.flash }, { opacity: 0 }], 420, { easing: "ease-out" });

        shake(L.shake);

        burst(r.left + r.width / 2, r.top + r.height / 2, L.particles, { w: r.width, h: r.height, shards: true, speed: 620, up: 120 });

        anim(wrap, [{ opacity: 1, transform: "scale(1)", filter: "blur(0)" }, { opacity: 0, transform: "scale(1.25)", filter: "blur(6px)" }], 260, { easing: "ease-out" });

        await wait(120);

        if (!alive()) return;

        // Le nouveau niveau tombe au centre, avec les rayons.
        const rays = $(".lu-rays");

        anim(rays, [{ opacity: 0, transform: "scale(.4) rotate(0deg)" }, { opacity: 1, transform: "scale(1) rotate(25deg)" }], 700);

        rays.animate([{ rotate: "0deg" }, { rotate: "360deg" }], { duration: 24000, iterations: Infinity });

        anim($(".lu-big"), [
            { opacity: 0, transform: "scale(2.6)", filter: "blur(8px)" },
            { opacity: 1, transform: "scale(.92)", filter: "blur(0)", offset: .7 },
            { opacity: 1, transform: "scale(1)" }
        ], 520, { easing: "cubic-bezier(.3,1.4,.5,1)" });

        await wait(180);

        shake(L.shake * 0.5);

        const reward = $(".lu-reward");

        if (reward) {

            await wait(500);

            anim(reward, [{ opacity: 0, transform: "translateY(24px) scale(.9)" }, { opacity: 1, transform: "none" }], 500, { easing: "cubic-bezier(.3,1.3,.5,1)" });

        }

        await wait(L.hold);

        close();

    })();

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

            // 1 h, 15 min ou 5 min avant selon la durée du pari (voir betCloseMs).
            const closeMs =
                betCloseMs(card.dataset.created, card.dataset.deadline);

            // Les mises sont closes, la carte se grise.
            if (remaining <= closeMs) {

                card.classList.remove("bet-card-urgent", "bet-card-short", "bet-card-hyper");

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

            // Carte rouge avec le temps qu'il reste pour miser (2 h avant pour un pari classique,
            // tout le temps pour un pari Short ou Hyper short).
            if (remaining > betUrgentMs(closeMs)) {

                card.classList.remove("bet-card-urgent", "bet-card-short", "bet-card-hyper");

                return;

            }

            const urgency =
                betUrgencyStyle(closeMs);

            card.classList.add("bet-card-urgent");

            card.classList.toggle("bet-card-short", urgency.className === "bet-card-short");

            card.classList.toggle("bet-card-hyper", urgency.className === "bet-card-hyper");

            setCardBadge(card, urgency.label);

            const untilClose = remaining - closeMs;

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

    // Titres, filtres (boutique, Historique), contestations, carte « Créer un pari »,
    // nombre de paris disponibles, cartes et messages « rien pour le moment », dans l'ordre de la page.
    root
        .querySelectorAll(".page-header, .shop-filters, .missions-title, .contests-block, .my-bets-summary, .my-bets-filters, .bet-create-card, .bets-count, .bet-card, .my-bet-item, .mission-card, .empty-state")
        .forEach(play);

    // Colonnes latérales (top parieurs, ticket, message, XP, coffre) : elles arrivent
    // tout de suite après le titre, l'une après l'autre.
    root
        .querySelectorAll(".leaderboard-sidebar, .bet-ticket, .admin-message-sidebar, .chest-card")
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

/*
    Réglages choisis dans demo-notifications.html :
    présentation actuelle, entrée « Montée », sortie vers la gauche,
    liste (la plus récente en bas), 9 s d'affichage, 4 visibles.
*/

const TOAST_TYPES = {
    stake:  { icon: "💸", color: "#6c63ff" },
    create: { icon: "🆕", color: "#3fa9f5" },
    error:  { icon: "⚠️", color: "#ff6b81" },
    contest: { icon: "⚖️", color: "#f5c451" },
    join: { icon: "🙋", color: "#6c63ff" },
    joined: { icon: "✅", color: "#63d69f" },
    beta: { icon: "🧪", color: "#63d69f" }
};

const TOAST_LIFE = 9000;
const TOAST_ANIM = 450;
const TOAST_MAX = 4;
const TOAST_GAP = 8;

// Notifications affichées, de la plus récente à la plus ancienne.
let activityToasts = [];


// « à l'instant », « il y a 5 min », « il y a 2 h », « il y a 3 j ».
function toastTimeLabel(at) {

    const minutes = at ? Math.floor((Date.now() - new Date(at)) / 60000) : 0;

    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return `il y a ${minutes} min`;
    if (minutes < 24 * 60) return `il y a ${Math.floor(minutes / 60)} h`;

    return `il y a ${Math.floor(minutes / (24 * 60))} j`;

}


// Place les notifications les unes au-dessus des autres (les autres glissent).
function layoutToasts() {

    let y = 0;

    activityToasts
        .filter(toast => !toast.leaving)
        .forEach(toast => {

            toast.slot.style.transform = `translateY(${-y}px)`;

            y += toast.slot.offsetHeight + TOAST_GAP;

        });

}


function removeToast(toast) {

    if (toast.leaving) {
        return;
    }

    toast.leaving = true;

    clearTimeout(toast.timer);

    toast.element.animate(
        [{ transform: "none", opacity: 1 }, { transform: "translateX(-110%)", opacity: 0 }],
        { duration: TOAST_ANIM * 0.8, easing: "ease-in", fill: "forwards" }
    ).onfinish = () => {

        toast.slot.remove();

        activityToasts = activityToasts.filter(other => other !== toast);

        layoutToasts();

    };

    layoutToasts();

}


/*
    Téléphone : cloche ronde à gauche, au-dessus des onglets (version D de
    demo-notifs-mobile.html). Une notification fait sonner la cloche, monte
    son compteur et montre un aperçu d'une ligne pendant 3 s, sans passer
    sur le perroquet. Toucher la cloche ouvre la liste des dernières.
*/

const PHONE_PEEK_LIFE = 3000;

const PHONE_HISTORY_MAX = 15;

let phoneNotifs = [];

let phoneUnread = 0;

let phonePeekTimer = null;

function ensurePhoneBell() {

    let bell = document.getElementById("phone-bell");

    if (bell) {
        return bell;
    }

    bell = document.createElement("button");

    bell.type = "button";

    bell.id = "phone-bell";

    bell.className = "phone-bell";

    bell.setAttribute("aria-label", "Notifications");

    bell.innerHTML = `🔔<span class="phone-bell-count hidden"></span>`;

    document.body.appendChild(bell);

    const peek = document.createElement("div");

    peek.id = "phone-bell-peek";

    peek.className = "phone-bell-peek hidden";

    document.body.appendChild(peek);

    const panel = document.createElement("div");

    panel.id = "phone-bell-panel";

    panel.className = "phone-bell-panel hidden";

    document.body.appendChild(panel);

    bell.addEventListener("click", event => {

        event.stopPropagation();

        togglePhoneBellPanel(panel.classList.contains("hidden"));

    });

    // Toucher ailleurs referme la liste.
    document.addEventListener("click", event => {

        if (!panel.classList.contains("hidden") && !panel.contains(event.target)) {

            togglePhoneBellPanel(false);

        }

    });

    return bell;

}

function updatePhoneBellCount() {

    const count = document.querySelector("#phone-bell .phone-bell-count");

    if (!count) {
        return;
    }

    count.textContent = phoneUnread > 9 ? "9+" : phoneUnread;

    count.classList.toggle("hidden", phoneUnread === 0);

}

function togglePhoneBellPanel(open) {

    const panel = document.getElementById("phone-bell-panel");

    if (!panel) {
        return;
    }

    if (!open) {

        panel.classList.add("hidden");

        return;

    }

    phoneUnread = 0;

    updatePhoneBellCount();

    document.getElementById("phone-bell-peek")?.classList.add("hidden");

    panel.innerHTML = `
        <div class="phone-bell-head">
            <span>Notifications</span>
            <button type="button" class="phone-bell-close" aria-label="Fermer">✕</button>
        </div>
        ${phoneNotifs.length === 0
            ? `<div class="phone-bell-row">Rien pour le moment.</div>`
            : phoneNotifs.map((notif, index) => `
                <div class="phone-bell-row${notif.onClick ? " clickable" : ""}" data-index="${index}">
                    <span class="phone-bell-icon">${notif.style.icon}</span>
                    <span>
                        ${notif.text}
                        <span class="activity-toast-time">${toastTimeLabel(notif.at)}</span>
                    </span>
                </div>
            `).join("")
        }
    `;

    panel
        .querySelector(".phone-bell-close")
        .addEventListener("click", () => togglePhoneBellPanel(false));

    panel.querySelectorAll(".phone-bell-row.clickable").forEach(row => {

        row.addEventListener("click", () => {

            togglePhoneBellPanel(false);

            phoneNotifs[Number(row.dataset.index)]?.onClick?.();

        });

    });

    panel.classList.remove("hidden");

    panel.animate(
        [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
        { duration: 220, easing: "ease-out" }
    );

}

function phoneNotify(text, { type = "error", at = null, onClick = null } = {}) {

    const style = TOAST_TYPES[type] || TOAST_TYPES.error;

    const bell = ensurePhoneBell();

    phoneNotifs.unshift({ text, style, at: at || new Date().toISOString(), onClick });

    phoneNotifs = phoneNotifs.slice(0, PHONE_HISTORY_MAX);

    // Liste ouverte : elle se met à jour, pas d'aperçu.
    if (!document.getElementById("phone-bell-panel").classList.contains("hidden")) {

        togglePhoneBellPanel(true);

        return;

    }

    phoneUnread++;

    updatePhoneBellCount();

    bell.classList.remove("ring");

    void bell.offsetWidth;

    bell.classList.add("ring");

    // Aperçu d'une ligne (texte sans mise en forme), puis il s'efface.
    const peek = document.getElementById("phone-bell-peek");

    const plain = document.createElement("div");

    plain.innerHTML = text;

    peek.textContent = style.icon + " " + plain.textContent.replace(/\s+/g, " ").trim();

    peek.classList.remove("hidden");

    peek.animate(
        [{ opacity: 0, transform: "translateX(-10px)" }, { opacity: 1, transform: "none" }],
        { duration: 250, easing: "ease-out" }
    );

    clearTimeout(phonePeekTimer);

    phonePeekTimer = setTimeout(() => {

        peek.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250 })
            .finished
            .then(() => peek.classList.add("hidden"))
            .catch(() => peek.classList.add("hidden"));

    }, PHONE_PEEK_LIFE);

}


/*
    type : stake, create, error, contest, join, joined (icône + couleur).
    at : date de l'événement, pour « il y a… ».
    onClick : action au clic (en plus de fermer la notification).
*/

function alertToast(text, { type = "error", at = null, onClick = null } = {}) {

    // Téléphone : la cloche repliée (phoneNotify) au lieu des bulles empilées.
    if (typeof PHONE_LAYOUT !== "undefined" && PHONE_LAYOUT.matches) {

        phoneNotify(text, { type, at, onClick });

        return;

    }

    let stack =
        document.getElementById("activity-feed");

    if (!stack) {
        stack = document.createElement("div");
        stack.id = "activity-feed";
        stack.className = "activity-feed";
        document.body.appendChild(stack);
    }

    const style = TOAST_TYPES[type] || TOAST_TYPES.error;

    const slot =
        document.createElement("div");

    slot.className = "activity-slot";

    slot.innerHTML = `
        <div class="activity-toast" style="--toast-color: ${style.color}">
            <span class="activity-toast-icon">${style.icon}</span>
            <span class="activity-toast-text">
                ${text}
                <span class="activity-toast-time">${toastTimeLabel(at)}</span>
            </span>
            <span class="activity-toast-bar"></span>
        </div>
    `;

    stack.appendChild(slot);

    const toast = {
        slot,
        element: slot.firstElementChild,
        leaving: false,
        timer: null,
        left: TOAST_LIFE,
        start: 0
    };


    // Entrée : monte depuis le bas en apparaissant.
    toast.element.animate(
        [{ transform: "translateY(40px)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: TOAST_ANIM, easing: "cubic-bezier(.2, .8, .2, 1)", fill: "backwards" }
    );

    // Barre du temps restant.
    toast.bar = slot.querySelector(".activity-toast-bar").animate(
        [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
        { duration: TOAST_LIFE, easing: "linear", fill: "forwards" }
    );


    // Pause au survol : le temps restant et la barre s'arrêtent.
    toast.pause = () => {

        if (toast.leaving || !toast.timer) return;

        clearTimeout(toast.timer);
        toast.timer = null;
        toast.left -= performance.now() - toast.start;
        toast.bar.pause();

    };

    toast.resume = () => {

        if (toast.leaving || toast.timer) return;

        toast.start = performance.now();
        toast.timer = setTimeout(() => removeToast(toast), Math.max(toast.left, 300));
        toast.bar.play();

    };

    slot.addEventListener("mouseenter", () => activityToasts.forEach(other => other.pause()));
    slot.addEventListener("mouseleave", () => activityToasts.forEach(other => other.resume()));

    // Un clic ferme la notification (et lance son action, s'il y en a une).
    slot.addEventListener("click", () => {

        removeToast(toast);

        onClick?.();

    });

    if (onClick) {

        slot.style.cursor = "pointer";

    }


    activityToasts.unshift(toast);

    toast.resume();

    activityToasts
        .filter(other => !other.leaving)
        .slice(TOAST_MAX)
        .forEach(removeToast);


    // La nouvelle se place tout de suite, les autres remontent en glissant.
    slot.style.transition = "none";

    layoutToasts();

    void slot.offsetWidth;

    slot.style.transition = "";

}


async function pollActivity() {

    if (!currentUser) {
        return;
    }


    /*
        Arrivée sur le site : pas de rattrapage des mises et des paris créés
        pendant l'absence (sinon une rafale de notifications). Le curseur part
        de la dernière activité du groupe : seul le direct s'affiche ensuite.
        (Les demandes d'adhésion, elles, s'affichent aussi à l'arrivée.)
    */

    if (!feedCursor) {

        const [lastStake, lastBet] = await Promise.all([

            supabaseClient
                .from("stakes")
                .select("created_at, bets!inner ( group_id )")
                .eq("bets.group_id", currentGroup?.id)
                .order("created_at", { ascending: false })
                .limit(1),

            supabaseClient
                .from("bets")
                .select("created_at")
                .eq("group_id", currentGroup?.id)
                .order("created_at", { ascending: false })
                .limit(1)

        ]);

        const latest = [
            ...(lastStake.data || []),
            ...(lastBet.data || [])
        ].map(row => row.created_at).sort();

        feedCursor = latest.length > 0
            ? latest[latest.length - 1]
            : new Date().toISOString();

        return;

    }

    const since = feedCursor;


    const [stakesResult, betsResult] = await Promise.all([

        supabaseClient
            .from("stakes")
            .select("created_at, stake, user_id, profiles!stakes_user_id_fkey ( username, is_admin, gold_frame_until, name_color_until, cosmetics ), bets!inner ( question, group_id )")
            .eq("bets.group_id", currentGroup?.id)
            .gt("created_at", since)
            .neq("user_id", currentUser.id)
            .order("created_at", { ascending: true })
            .limit(5),

        supabaseClient
            .from("bets")
            .select("created_at, question, author_id, profiles!bets_author_id_fkey ( username, is_admin, gold_frame_until, name_color_until, cosmetics )")
            .eq("group_id", currentGroup?.id)
            .gt("created_at", since)
            .neq("author_id", currentUser.id)
            .order("created_at", { ascending: true })
            .limit(3)

    ]);


    if (stakesResult.error || betsResult.error) {
        console.error("Fil en direct :", stakesResult.error || betsResult.error);
    }


    const events = [];

    // Les actions de l'admin ne sont pas montrées aux joueurs.
    (stakesResult.data || []).filter(s => !s.profiles?.is_admin).forEach(s => events.push({
        at: s.created_at,
        type: "stake",
        html: `<strong>${styledName(s.profiles, "Quelqu'un")}</strong> a misé ${formatMoney(s.stake)} sur « ${escapeHtml(s.bets?.question || "un pari")} »`
    }));

    (betsResult.data || []).filter(b => !b.profiles?.is_admin).forEach(b => events.push({
        at: b.created_at,
        type: "create",
        html: `<strong>${styledName(b.profiles, "Quelqu'un")}</strong> a créé « ${escapeHtml(b.question)} »`
    }));

    events.sort((a, b) => new Date(a.at) - new Date(b.at));


    events.forEach((event, index) => {
        setTimeout(() => alertToast(event.html, { type: event.type, at: event.at }), index * 2000);
    });


    // Le curseur avance aussi après des actions masquées (admin).
    const allDates = [
        ...(stakesResult.data || []),
        ...(betsResult.data || [])
    ].map(row => row.created_at).sort();

    feedCursor = allDates.length > 0
        ? allDates[allDates.length - 1]
        : feedCursor;

}



/* =========================================================
   11 BIS. FIN D'UNE CONTESTATION : LA BALANCE DU JURY
      Choisie dans demo-fin-contestation.html (proposition B).
      Chaque joueur voit une fois le verdict : une notification
      s'ouvre en fiche, les voix tombent dans la balance, puis
      le détail de ce qui change pour lui et les billets.
      Le créateur sanctionné reçoit un carton rouge.
========================================================= */

// Verdicts plus vieux que ça : on ne les montre plus.
const VERDICT_MAX_AGE_MS = 3 * 24 * 3600 * 1000;

let verdictQueue = [];

let verdictPlaying = false;


const verdictWait = ms => new Promise(resolve => setTimeout(resolve, ms));

const verdictRnd = (a, b) => a + Math.random() * (b - a);

function verdictSigned(value) {

    return (value > 0 ? "+" : value < 0 ? "−" : "") + formatMoney(Math.abs(value));

}

function verdictCenter(element) {

    const rect = element.getBoundingClientRect();

    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

}


/*
    Appelée par refreshContests : met en file les verdicts
    pas encore vus par ce joueur (mémorisés dans le navigateur).
*/

function checkContestResults(contests) {

    if (!currentUser) {
        return;
    }

    const seen = readStorage("seen-contests") || [];

    const fresh = (contests || []).filter(contest =>
        contest.status !== "open" &&
        contest.settled_at &&
        Date.now() - new Date(contest.settled_at) < VERDICT_MAX_AGE_MS &&
        !seen.includes(contest.bet_id) &&
        !verdictQueue.some(other => other.bet_id === contest.bet_id)
    );

    if (fresh.length === 0) {
        return;
    }

    verdictQueue.push(...fresh);

    playVerdicts();

}

function markVerdictSeen(betId) {

    const seen = readStorage("seen-contests") || [];

    writeStorage("seen-contests", [...seen.filter(id => id !== betId), betId].slice(-100));

}


/*
    Ce que le verdict change pour moi.
    delta : variation du solde ; unlock : gains débloqués à récupérer.
*/

function verdictCase(contest) {

    const annul = contest.status === "annulled";

    const stake = Number(contest.my_stake) || 0;

    const win = Number(contest.my_win) || 0;

    const taken = Number(contest.my_win_taken) || 0;

    const penalty = Number(contest.penalty) || 0;

    const commission = Number(contest.commission) || 0;

    // Commission déjà récupérée (carte jaune) avant la fin du vote ?
    const commissionClaimed = Boolean(contest.commission_claimed);

    const choice = escapeHtml(contest.my_choice_label || "—");

    const result = {
        annul,
        author: contest.my_role === "author",
        lines: [],
        delta: 0,
        unlock: 0,
        who: "",
        expl: ""
    };


    // Ce que devient ma mise (le créateur peut aussi avoir misé sur son pari).
    let stakeText = "";

    if (stake > 0) {

        result.who = `Tu avais misé ${formatMoney(stake)} sur « ${choice} » : ${win > 0 ? "gagné" : "perdu"}.`;

        if (annul) {

            if (taken > 0) {
                stakeText = "le gain que tu avais touché est repris, mais ta mise t'est rendue.";
                result.lines.push({ text: "Gain repris", value: taken, kind: "minus" });
            } else if (win > 0) {
                stakeText = "ton gain bloqué disparaît, mais ta mise t'est rendue.";
                result.lines.push({ text: "Gain bloqué", value: win, kind: "strike" });
            } else {
                stakeText = "ton pari perdu est effacé, tu récupères ta mise.";
            }

            result.lines.push({ text: "Mise rendue", value: stake, kind: "plus" });
            result.delta += stake - taken;

        } else if (win > 0) {

            stakeText = contest.my_claimed
                ? "tes gains sont débloqués."
                : "tes gains sont débloqués, récupère-les sur la carte du pari.";
            result.lines.push({ text: "Gain débloqué", value: win, kind: "unlock" });
            result.unlock = contest.my_claimed ? 0 : win;

        } else {

            stakeText = "ta mise reste perdue.";
            result.lines.push({ text: "Mise perdue", value: stake, kind: "info" });

        }

    }


    if (result.author) {

        result.who = `Tu as créé ce pari et validé « ${escapeHtml(contest.winner_label || "—")} ».` +
            (stake > 0 ? " " + result.who : "");

        if (annul) {
            result.expl = "Le jury estime que tu as mal validé : tu paies une amende de 10 % du total misé" +
                (commission > 0 ? (commissionClaimed ? " et ta commission est reprise. " : " et tu perds ta commission. ") : ". ") +
                (stakeText ? "Pour ta mise, " + stakeText : "Tout le monde est remboursé.");
            result.lines.push({ text: "Total misé sur le pari", value: Number(contest.total_staked) || 0, kind: "info" });
            result.lines.push({ text: "Amende (10 %)", value: penalty, kind: "minus" });
            result.delta -= penalty;

            if (commission > 0 && commissionClaimed) {
                result.lines.push({ text: "Commission reprise", value: commission, kind: "minus" });
                result.delta -= commission;
            } else if (commission > 0) {
                result.lines.push({ text: "Commission annulée", value: commission, kind: "strike" });
            }
        } else {
            result.expl = "Le jury confirme ta validation : tu ne paies pas d'amende" +
                (commission > 0
                    ? (commissionClaimed ? " et tu gardes ta commission." : " et ta commission est débloquée : récupère-la sur la carte jaune.")
                    : ".") +
                (stakeText ? " Pour ta mise, " + stakeText : "");
            if (commission > 0 && commissionClaimed) {
                result.lines.push({ text: "Commission gardée", value: commission, kind: "info" });
            } else if (commission > 0) {
                result.lines.push({ text: "Commission débloquée", value: commission, kind: "unlock" });
                result.unlock += commission;
            } else if (stake === 0) {
                result.lines.push({ text: "Amende", value: 0, kind: "info" });
            }
        }

        return result;

    }


    if (stake > 0) {

        const head = annul
            ? (contest.opened_by_me ? "Ta contestation est acceptée : " : "Le jury a annulé la validation : ")
            : (contest.opened_by_me ? "Ta contestation est rejetée : " : "Le jury a gardé la validation : ");

        result.expl = head + stakeText;

        return result;

    }


    result.who = contest.my_role === "juror"
        ? "Tu faisais partie du jury (tu n'avais pas misé)."
        : "Tu n'avais pas misé sur ce pari.";

    result.expl = (annul
        ? "La validation est annulée et tout le monde est remboursé. Ton solde ne change pas"
        : "La validation est maintenue. Ton solde ne change pas") +
        (contest.my_vote !== null && contest.my_vote !== undefined ? " : merci d'avoir voté !" : ".");

    return result;

}


// Joue les verdicts en attente, l'un après l'autre.
async function playVerdicts() {

    if (verdictPlaying) {
        return;
    }

    verdictPlaying = true;


    // Le solde en base est déjà à jour : on repart d'avant les verdicts.
    const { data } = await supabaseClient
        .from("group_members")
        .select("balance")
        .eq("group_id", currentGroup?.id)
        .eq("user_id", currentUser.id)
        .maybeSingle();

    const realBalance = Number(data?.balance ?? currentProfile?.balance ?? 0);

    let shown = realBalance - verdictQueue.reduce((sum, contest) => sum + verdictCase(contest).delta, 0);


    while (verdictQueue.length > 0) {

        const contest = verdictQueue[0];

        const info = verdictCase(contest);

        try {
            await showVerdict(contest, info, shown);
        } catch (error) {
            console.error("Verdict :", error);
            document.querySelectorAll(".verdict-overlay, .verdict-wrap, .verdict-toast, .verdict-red").forEach(el => el.remove());
        }

        shown += info.delta;

        markVerdictSeen(contest.bet_id);

        verdictQueue.shift();

    }


    if (currentProfile) {
        currentProfile.balance = realBalance;
    }

    updateBalance();

    verdictPlaying = false;

    // Cartes, historique et solde à jour (les gains débloqués apparaissent).
    if (typeof refreshAfterContest === "function") {
        await refreshAfterContest();
    }

}


/* ----- Effets ----- */

function verdictBurst(point, color, count = 14, distance = 70) {

    for (let i = 0; i < count; i++) {

        const dot = document.createElement("div");

        dot.className = "verdict-spark";
        dot.style.background = color;
        document.body.appendChild(dot);

        const angle = verdictRnd(0, Math.PI * 2);
        const radius = verdictRnd(distance * 0.4, distance);

        dot.animate(
            [
                { transform: `translate(${point.x}px, ${point.y}px) scale(1)`, opacity: 1 },
                { transform: `translate(${point.x + Math.cos(angle) * radius}px, ${point.y + Math.sin(angle) * radius}px) scale(.2)`, opacity: 0 }
            ],
            { duration: verdictRnd(450, 750), easing: "cubic-bezier(.2, .8, .3, 1)", fill: "forwards" }
        ).onfinish = () => dot.remove();

    }

    const ring = document.createElement("div");

    ring.className = "verdict-ring";
    ring.style.borderColor = color;
    document.body.appendChild(ring);

    ring.animate(
        [
            { transform: `translate(${point.x}px, ${point.y}px) scale(1)`, opacity: 0.9 },
            { transform: `translate(${point.x}px, ${point.y}px) scale(9)`, opacity: 0 }
        ],
        { duration: 600, easing: "ease-out", fill: "forwards" }
    ).onfinish = () => ring.remove();

}

function verdictPop(point, text, kind) {

    const pop = document.createElement("div");

    pop.className = "verdict-pop verdict-pop--" + kind;
    pop.textContent = text;
    pop.style.left = point.x + "px";
    pop.style.top = point.y + "px";
    document.body.appendChild(pop);

    pop.animate(
        [
            { transform: "translate(-50%, -50%) scale(.4)", opacity: 0 },
            { transform: "translate(-50%, -90%) scale(1.15)", opacity: 1, offset: 0.25 },
            { transform: "translate(-50%, -160%) scale(1)", opacity: 0 }
        ],
        { duration: 1700, easing: "ease-out", fill: "forwards" }
    ).onfinish = () => pop.remove();

}

function verdictShake(element, power = 10, duration = 450) {

    const frames = [];

    for (let i = 0; i <= 8; i++) {
        frames.push({ translate: i === 8 ? "0 0" : `${verdictRnd(-power, power)}px ${verdictRnd(-power, power)}px` });
    }

    element.animate(frames, { duration });

}

// Où arrivent les billets : le solde s'il est visible, sinon le haut de l'écran.
function verdictBalancePoint() {

    const balance = document.getElementById("balance");

    const rect = balance?.getBoundingClientRect();

    if (!rect || rect.width === 0) {
        return { x: window.innerWidth - 60, y: 30 };
    }

    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

}


// Billets : du total vers le solde (gain) ou du solde vers le bas (perte, brûlés pour une amende).
async function verdictMoney(info, from, shown) {

    if (!info.delta) {
        return;
    }

    const balanceEl = document.getElementById("balance");

    const target = verdictBalancePoint();

    const count = Math.min(12, Math.max(5, Math.round(Math.abs(info.delta) / 20)));

    const part = info.delta / count;

    const burn = info.author && info.annul;

    let current = shown;


    if (info.delta > 0) {

        for (let i = 0; i < count; i++) {

            setTimeout(() => {

                const bill = document.createElement("div");

                bill.className = "verdict-bill";
                document.body.appendChild(bill);

                const lift = verdictRnd(-160, -90);
                const spin = verdictRnd(360, 720);
                const side = verdictRnd(-40, 40);
                const frames = [];

                for (let k = 0; k <= 16; k++) {
                    const t = k / 16;
                    frames.push({
                        transform: `translate(${from.x + side * Math.sin(t * Math.PI) + (target.x - from.x) * t}px, ${from.y + (target.y - from.y) * t + lift * 4 * t * (1 - t)}px) rotate(${spin * t}deg) scale(${1 - t * 0.5})`
                    });
                }

                bill.animate(frames, { duration: 950, easing: "ease-in-out", fill: "forwards" }).onfinish = () => {
                    bill.remove();
                    animateNumber(balanceEl, current, current + part, 200, formatBalance);
                    current += part;
                    bump(balanceEl);
                };

            }, i * 90);

        }

        await verdictWait(count * 90 + 1000);

        verdictPop({ x: target.x - 20, y: target.y + 34 }, verdictSigned(info.delta), "plus");

        verdictBurst(target, "#3ddc97", 12, 50);

        return;

    }


    if (burn) {

        const vignette = document.createElement("div");

        vignette.className = "verdict-vignette";
        document.body.appendChild(vignette);

        vignette.animate(
            [{ opacity: 0 }, { opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }, { opacity: 0 }],
            { duration: count * 130 + 1500, fill: "forwards" }
        ).onfinish = () => vignette.remove();

    }

    for (let i = 0; i < count; i++) {

        setTimeout(() => {

            animateNumber(balanceEl, current, current + part, 200, formatBalance);
            current += part;
            bump(balanceEl);

            const bill = document.createElement("div");

            bill.className = "verdict-bill verdict-bill--lost" + (burn ? " verdict-bill--burn" : "");
            document.body.appendChild(bill);

            const end = { x: target.x + verdictRnd(-160, 40), y: window.innerHeight + 40 };
            const sway = verdictRnd(20, 45);
            const phase = verdictRnd(0, Math.PI * 2);
            const frames = [];

            for (let k = 0; k <= 20; k++) {
                const t = k / 20;
                const wave = Math.sin(phase + t * Math.PI * 4);
                frames.push({
                    transform: `translate(${target.x + (end.x - target.x) * t + wave * sway * (1 - t)}px, ${target.y + (end.y - target.y) * (t * t * 0.6 + t * 0.4)}px) rotate(${wave * 40}deg) scale(.9)`,
                    opacity: t > 0.85 ? (1 - t) * 6.6 : 1,
                    filter: burn ? `brightness(${1 - t * 0.8}) sepia(${t})` : "none"
                });
            }

            bill.animate(frames, { duration: 1500, easing: "linear", fill: "forwards" }).onfinish = () => {
                bill.remove();
                if (typeof Parrot !== "undefined") {
                    Parrot.hit();
                }
            };

        }, i * 130);

    }

    await verdictWait(count * 130 + 400);

    verdictPop({ x: target.x - 20, y: target.y + 34 }, verdictSigned(info.delta), "minus");

    await verdictWait(1200);

}


// Validation maintenue pour un gagnant : le cadenas s'ouvre.
async function verdictUnlock(info, from) {

    const lock = document.createElement("div");

    lock.className = "verdict-lock";
    lock.textContent = "🔒";
    lock.style.left = from.x + "px";
    lock.style.top = from.y + "px";
    document.body.appendChild(lock);

    lock.animate(
        [{ transform: "translate(-50%, -50%) scale(0)" }, { transform: "translate(-50%, -50%) scale(1.2)" }, { transform: "translate(-50%, -50%) scale(1)" }],
        { duration: 350, fill: "forwards" }
    );

    await verdictWait(450);

    lock.animate([{ rotate: "0deg" }, { rotate: "-14deg" }, { rotate: "14deg" }, { rotate: "-8deg" }, { rotate: "0deg" }], { duration: 450 });

    await verdictWait(500);

    lock.textContent = "🔓";

    verdictBurst(from, "#f5c451", 18, 80);

    verdictPop({ x: from.x, y: from.y - 30 }, formatMoney(info.unlock) + " à récupérer", "gold");

    await verdictWait(900);

    lock.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" }).onfinish = () => lock.remove();

}


/* ----- La fiche ----- */

function verdictLineAmount(line) {

    if (line.kind === "plus") return "+" + formatMoney(line.value);
    if (line.kind === "minus") return "−" + formatMoney(line.value);
    if (line.kind === "unlock") return "🔓 " + formatMoney(line.value);

    return formatMoney(line.value);

}

function verdictTotalHtml(info) {

    if (info.unlock) {
        return `<span>À récupérer</span><b class="verdict-gold">${formatMoney(info.unlock)}</b>`;
    }

    const kind = info.delta > 0 ? "plus" : info.delta < 0 ? "minus" : "zero";

    return `<span>Ton solde</span><b class="verdict-${kind}">${verdictSigned(info.delta)}</b>`;

}

function verdictCardHtml(contest, info) {

    const showTotal = info.lines.length > 0;

    return `
        <div class="verdict-head">⚖️ VOTE TERMINÉ</div>

        <div class="verdict-scale">
            <div class="verdict-post"></div>
            <div class="verdict-base"></div>
            <div class="verdict-beam">
                <div class="verdict-pan verdict-pan--left">
                    <div class="verdict-pan-in">
                        <div class="verdict-strings"></div>
                        <div class="verdict-coins"></div>
                        <div class="verdict-dish"></div>
                        <div class="verdict-label verdict-label--annul">ANNULER</div>
                    </div>
                </div>
                <div class="verdict-pan verdict-pan--right">
                    <div class="verdict-pan-in">
                        <div class="verdict-strings"></div>
                        <div class="verdict-coins"></div>
                        <div class="verdict-dish"></div>
                        <div class="verdict-label verdict-label--keep">GARDER</div>
                    </div>
                </div>
            </div>
            <div class="verdict-pivot"></div>
        </div>

        <div class="verdict-result">${info.annul ? "Validation annulée" : "Validation maintenue"}${!info.annul && Number(contest.votes_annul) > 0 && contest.votes_annul === contest.votes_keep ? " (égalité)" : ""}</div>

        <div class="verdict-question">« ${escapeHtml(contest.question)} »</div>

        <div class="verdict-who">${info.who}</div>

        <div class="verdict-expl">${info.expl}</div>

        ${info.lines.map(line => `
            <div class="verdict-line verdict-line--${line.kind}">
                <span>${line.text}</span>
                <b>${verdictLineAmount(line)}</b>
            </div>
        `).join("")}

        ${showTotal ? `<div class="verdict-total">${verdictTotalHtml(info)}</div>` : ""}

        <button type="button" class="verdict-ok">Compris</button>
    `;

}


// Un verdict complet ; se termine quand le joueur clique « Compris ».
async function showVerdict(contest, info, shown) {

    const color = info.annul ? (info.lines.length === 0 ? "#f5c451" : "#ff5c7a") : "#3ddc97";

    const balanceEl = document.getElementById("balance");

    if (balanceEl && info.delta && !currentProfile?.is_admin) {
        balanceEl.textContent = formatBalance(shown);
    }


    // 1. La notification arrive en bas.
    const toast = document.createElement("div");

    toast.className = "verdict-toast";
    toast.innerHTML = `
        <span class="verdict-toast-icon">⚖️</span>
        <span>Vote terminé sur « ${escapeHtml(contest.question)} »<small>Voir le résultat →</small></span>
    `;
    document.body.appendChild(toast);

    toast.animate(
        [{ transform: "translateY(40px)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 450, easing: "cubic-bezier(.2, .8, .2, 1)", fill: "forwards" }
    );

    await verdictWait(1400);


    // 2. Elle s'ouvre en fiche au centre.
    const from = toast.getBoundingClientRect();

    const overlay = document.createElement("div");

    overlay.className = "verdict-overlay";
    document.body.appendChild(overlay);

    overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, fill: "forwards" });

    const wrap = document.createElement("div");

    wrap.className = "verdict-wrap";
    wrap.style.setProperty("--verdict-color", color);
    wrap.innerHTML = `<div class="verdict-card">${verdictCardHtml(contest, info)}</div>`;
    document.body.appendChild(wrap);

    const card = wrap.firstElementChild;

    const to = card.getBoundingClientRect();

    card.animate(
        [
            { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, transformOrigin: "0 0", opacity: 0.6 },
            { transform: "none", transformOrigin: "0 0", opacity: 1 }
        ],
        { duration: 550, easing: "cubic-bezier(.2, .8, .2, 1)" }
    );

    toast.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" }).onfinish = () => toast.remove();

    await verdictWait(700);


    // 3. Les voix tombent dans les plateaux, la balance penche.
    const beam = card.querySelector(".verdict-beam");

    const pans = card.querySelectorAll(".verdict-pan-in");

    const votes = [Number(contest.votes_annul) || 0, Number(contest.votes_keep) || 0];

    const order = [];

    for (let i = 0; i < Math.max(votes[0], votes[1]); i++) {
        if (i < votes[0]) order.push("annul");
        if (i < votes[1]) order.push("keep");
    }

    let angle = 0, annul = 0, keep = 0;

    for (const side of order) {

        const coin = document.createElement("div");

        coin.className = "verdict-coin verdict-coin--" + side;
        coin.textContent = "✓";
        pans[side === "annul" ? 0 : 1].querySelector(".verdict-coins").appendChild(coin);

        coin.animate(
            [{ transform: "translateY(-70px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }],
            { duration: 380, easing: "cubic-bezier(.5, 0, .8, .5)" }
        );

        await verdictWait(380);

        side === "annul" ? annul++ : keep++;

        const next = Math.max(-16, Math.min(16, (keep - annul) * 8));

        const timing = { duration: 700, easing: "cubic-bezier(.3, 1.7, .5, 1)", fill: "forwards" };

        beam.animate([{ transform: `rotate(${angle}deg)` }, { transform: `rotate(${next}deg)` }], timing);

        pans.forEach(pan => pan.animate([{ transform: `rotate(${-angle}deg)` }, { transform: `rotate(${-next}deg)` }], timing));

        angle = next;

        await verdictWait(450);

    }

    card.querySelector(".verdict-result").animate(
        [{ opacity: 0, transform: "scale(1.6)" }, { opacity: 1, transform: "none" }],
        { duration: 350, fill: "forwards" }
    );

    await verdictWait(500);


    // 4. Le détail, ligne par ligne.
    for (const line of card.querySelectorAll(".verdict-line")) {

        line.animate([{ opacity: 0, transform: "translateX(-14px)" }, { opacity: 1, transform: "none" }], { duration: 300, fill: "forwards" });

        await verdictWait(380);

    }

    const total = card.querySelector(".verdict-total");

    if (total) {

        total.animate(
            [{ opacity: 0, transform: "scale(.8)" }, { opacity: 1, transform: "scale(1.06)" }, { opacity: 1, transform: "none" }],
            { duration: 420, fill: "forwards" }
        );

        await verdictWait(450);

    }


    // 5. Le créateur sanctionné : carton rouge, puis il se range en coin.
    if (info.author && info.annul && info.delta < 0) {

        const red = document.createElement("div");

        red.className = "verdict-red";
        red.innerHTML = `<small>AMENDE</small><b>${verdictSigned(info.delta)}</b>`;
        document.body.appendChild(red);

        const hit = verdictCenter(total);

        const slam = { x: Math.min(hit.x + 30, window.innerWidth - 110), y: hit.y - 150 };

        red.animate(
            [
                { transform: `translate(${slam.x + 10}px, -180px) rotate(-40deg)` },
                { transform: `translate(${slam.x}px, ${slam.y}px) rotate(12deg)`, offset: 0.8 },
                { transform: `translate(${slam.x}px, ${slam.y}px) rotate(8deg)` }
            ],
            { duration: 650, easing: "cubic-bezier(.5, 0, .7, 1)", fill: "forwards" }
        );

        await verdictWait(520);

        verdictShake(card, 12, 450);

        verdictBurst({ x: slam.x + 48, y: slam.y + 66 }, "#ff5c7a", 22, 110);

        await verdictWait(700);

        const corner = card.getBoundingClientRect();

        red.animate(
            [
                { transform: `translate(${slam.x}px, ${slam.y}px) rotate(8deg) scale(1)` },
                { transform: `translate(${corner.right - 62}px, ${corner.top - 50}px) rotate(14deg) scale(.55)` }
            ],
            { duration: 450, easing: "cubic-bezier(.2, .8, .2, 1)", fill: "forwards" }
        );

        await verdictWait(450);

    }


    // 6. L'argent bouge.
    const amount = total ? verdictCenter(total.querySelector("b")) : verdictCenter(card);

    if (info.unlock) {
        await verdictUnlock(info, amount);
    } else {
        await verdictMoney(info, amount, shown);
    }


    // 7. « Compris » ferme la fiche.
    const ok = card.querySelector(".verdict-ok");

    ok.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: "forwards" });

    await new Promise(resolve => ok.addEventListener("click", resolve, { once: true }));

    const closing = [overlay, wrap, document.querySelector(".verdict-red")].filter(Boolean);

    closing.forEach(el => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" }));

    await verdictWait(300);

    closing.forEach(el => el.remove());

}



/* =========================================================
   12. INITIALISATION
========================================================= */

async function initAnimations() {

    setupPointerEffects();

    // Téléphone : la cloche des notifications est là dès l'arrivée.
    if (typeof PHONE_LAYOUT !== "undefined" && PHONE_LAYOUT.matches) {

        ensurePhoneBell();

    }

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

        // Passage ordinateur ↔ téléphone : le coffre change de place.
        placeChest();

        PHONE_LAYOUT.addEventListener("change", placeChest);

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

        // Termine les votes échus et montre les verdicts arrivés entre-temps.
        await refreshContests();

        // Nouvelles demandes pour rejoindre le groupe (pastille + notification).
        await refreshJoinRequests();

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



/* =========================================================
   CLIC DU PERROQUET
   Pour tout le monde : chaque clic sur le perroquet le fait rebondir
   et lâche un billet qui file vers le solde (+1 €, ou +2 / +3 € avec
   les articles ×2 et ×3 de la boutique), jusqu'au plafond du jour
   (selon le palier de meilleur solde). Les clics sont envoyés par
   paquets à parrot_click (voir perroquet-paliers.sql).
========================================================= */

function parrotTiredMessage() {

    return "🦜 Le perroquet est épuisé !<br>Tu as gagné tes " +
        parrotClick.cap.toLocaleString("fr-FR") + " € du jour, reviens demain.";

}

// Réglages choisis sur la maquette (proposition B).
const PARROT_CLICK = {
    bounce: 28,
    stiff: 11,
    size: 48,
    speed: 12,
    spread: 65,
    gravity: 25,
    spin: 8,
    life: 0.9,
    max: 170
};

const parrotClick = {
    today: 0,
    // Plafond du jour, gain par clic et meilleur solde (donnés par le serveur).
    cap: 500,
    mult: 1,
    best: 0,
    pending: 0,
    // Euros ajoutés à l'affichage pour chaque clic pas encore enregistré.
    gains: [],
    sending: false,
    flushTimer: null,
    spring: { y: 0, vy: 0, sq: 0, vsq: 0 },
    bills: [],
    running: false,
    prev: 0,
    masks: {},
    toastTimer: null
};


// Débloqué pour tout le monde.
function parrotClickEnabled() {

    return Boolean(currentGroup && currentProfile);

}


// État du jour (euros déjà gagnés aujourd'hui dans ce groupe).
async function refreshParrotClick() {

    if (!parrotClickEnabled() || parrotClick.pending || parrotClick.sending) {

        return;

    }

    const { data, error } = await supabaseClient.rpc("parrot_click", {
        p_group: currentGroup.id,
        p_count: 0
    });

    if (!error && data && data[0]) {

        parrotClick.today = data[0].today;

        parrotClick.cap = data[0].cap;

        parrotClick.mult = data[0].mult;

        parrotClick.best = Number(data[0].best) || 0;

    }

}


/*
    Zone cliquable : seulement les pixels visibles du perroquet (pas le cadre
    transparent autour), pour ne pas gêner les cartes situées derrière.
    Si l'image ne peut pas être lue (page ouverte en local), on prend son cadre.
*/

function parrotMask(level) {

    if (parrotClick.masks[level]) {

        return parrotClick.masks[level];

    }

    const levelEl = document.querySelector(`#parrot [data-level="${level}"]`);

    if (!levelEl) {

        return null;

    }

    const bodies = [...levelEl.querySelectorAll(":scope > img")].filter(img => !img.dataset.ref);

    const heads = [...levelEl.querySelectorAll(".parrot-head img")];

    if (!bodies.length || ![...bodies, ...heads].every(img => img.complete && img.naturalWidth)) {

        return null;

    }

    const box = el => ({
        left: parseFloat(el.style.left) || 0,
        top: parseFloat(el.style.top) || 0,
        width: parseFloat(el.style.width),
        height: parseFloat(el.style.height)
    });

    const W = 128, H = 163;

    const canvas = document.createElement("canvas");

    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");

    // Même miroir que la pose d'attente (scaleX(-1) autour de x = 256).
    ctx.setTransform(-W / 512, 0, 0, H / 650, W, 0);

    bodies.forEach(img => {
        const b = box(img);
        ctx.drawImage(img, b.left, b.top, b.width, b.height);
    });

    heads.forEach(img => {
        const b = box(img.parentElement);
        ctx.drawImage(img, b.left, b.top, b.width, b.height);
    });

    let mask;

    try {

        const pixels = ctx.getImageData(0, 0, W, H).data;

        mask = { W, H, alpha: i => pixels[i * 4 + 3] };

    } catch (error) {

        const b = box(bodies[0]);

        mask = {
            rect: {
                left: 512 - (b.left + b.width) + b.width * 0.15,
                right: 512 - b.left - b.width * 0.15,
                top: b.top + b.height * 0.08,
                bottom: b.top + b.height * 0.95
            }
        };

    }

    parrotClick.masks[level] = mask;

    return mask;

}


function parrotHit(clientX, clientY) {

    const root = document.getElementById("parrot");

    if (
        !root ||
        root.classList.contains("parrot-hidden") ||
        root.classList.contains("parrot-squeezed") ||
        document.body.classList.contains("app-loading") ||
        document.querySelector(".modal:not(.hidden)")
    ) {

        return false;

    }

    const waiting = root.querySelector('[data-pose="waiting"]');

    if (!waiting || Number(getComputedStyle(waiting).opacity) < 0.5) {

        return false;

    }

    const rect = root.getBoundingClientRect();

    if (
        clientX < rect.left || clientX > rect.right ||
        clientY < rect.top || clientY > rect.bottom
    ) {

        return false;

    }

    // Niveau affiché : celui dont l'opacité est la plus forte.
    let level = 1, best = -1;

    root.querySelectorAll("[data-level]").forEach(el => {
        const o = el.style.opacity === "" ? 1 : Number(el.style.opacity);
        if (o > best) { best = o; level = Number(el.dataset.level); }
    });

    const mask = parrotMask(level);

    if (!mask) {

        return false;

    }

    const x = (clientX - rect.left) / rect.width * 512;

    const y = (clientY - rect.top) / rect.height * 650;

    if (mask.rect) {

        return x >= mask.rect.left && x <= mask.rect.right && y >= mask.rect.top && y <= mask.rect.bottom;

    }

    // Petite marge autour des pixels visibles pour viser plus facilement.
    const cx = Math.floor(x / 512 * mask.W), cy = Math.floor(y / 650 * mask.H);

    for (let dy = -1; dy <= 1; dy++) {

        for (let dx = -1; dx <= 1; dx++) {

            const px = cx + dx, py = cy + dy;

            if (px >= 0 && py >= 0 && px < mask.W && py < mask.H && mask.alpha(py * mask.W + px) > 40) {

                return true;

            }

        }

    }

    return false;

}


function parrotClickToast(html) {

    let toast = document.getElementById("parrot-click-toast");

    if (!toast) {

        toast = document.createElement("div");

        toast.id = "parrot-click-toast";

        document.body.appendChild(toast);

    }

    toast.innerHTML = html;

    const rect = document.getElementById("parrot").getBoundingClientRect();

    const half = toast.offsetWidth / 2 + 12;

    toast.style.left = Math.min(innerWidth - half, Math.max(half, rect.left + rect.width / 2)) + "px";

    toast.style.top = Math.max(80, rect.top + rect.height * 0.1) + "px";

    toast.classList.add("show");

    clearTimeout(parrotClick.toastTimer);

    parrotClick.toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);

}


function parrotClickLoop(t) {

    const dt = Math.min(0.05, (t - parrotClick.prev) / 1000);

    parrotClick.prev = t;

    const s = PARROT_CLICK;

    const spring = parrotClick.spring;

    // Rebond en ressort : les clics rapides s'additionnent sans à-coups.
    const k = s.stiff * s.stiff, d = 2 * s.stiff * 0.45;

    spring.vy += (-k * spring.y - d * spring.vy) * dt;
    spring.y += spring.vy * dt;
    spring.vsq += (-k * spring.sq - d * spring.vsq) * dt * 1.4;
    spring.sq += spring.vsq * dt * 1.4;

    const settled =
        Math.abs(spring.y) < 0.05 && Math.abs(spring.vy) < 0.5 &&
        Math.abs(spring.sq) < 0.0005 && Math.abs(spring.vsq) < 0.005;

    const root = document.getElementById("parrot");

    if (root) {

        const y = Math.max(-80, Math.min(30, spring.y));

        const sq = Math.max(-0.25, Math.min(0.25, spring.sq));

        root.style.transform = settled
            ? ""
            : `translateY(${y.toFixed(2)}px) scale(${(1 + sq).toFixed(4)}, ${(1 - sq).toFixed(4)})`;

    }

    const balanceEl = document.getElementById("balance");

    const r = balanceEl
        ? balanceEl.getBoundingClientRect()
        : { left: innerWidth - 80, top: 20, width: 0, height: 0 };

    const target = { x: r.left + r.width / 2, y: r.top + r.height / 2 };

    const jump = 0.22;

    for (let i = parrotClick.bills.length - 1; i >= 0; i--) {

        const b = parrotClick.bills[i];

        b.age += dt;

        if (b.age < jump) {

            // Le billet saute d'abord au-dessus du perroquet…
            b.vy += s.gravity * 30 * dt;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.sx = b.x;
            b.sy = b.y;

        } else {

            // … puis file vers le solde.
            const p = Math.min(1, (b.age - jump) / b.life);
            const e = p * p * (3 - 2 * p);
            const cx = (b.sx + target.x) / 2, cy = Math.min(b.sy, target.y) - 80;
            const u = 1 - e;

            b.x = u * u * b.sx + 2 * u * e * cx + e * e * target.x;
            b.y = u * u * b.sy + 2 * u * e * cy + e * e * target.y;

            if (p >= 1) {

                b.el.remove();

                parrotClick.bills.splice(i, 1);

                if (balanceEl) {

                    balanceEl.classList.remove("parrot-click-pop");
                    void balanceEl.offsetWidth;
                    balanceEl.classList.add("parrot-click-pop");

                }

                continue;

            }

        }

        b.rot += b.vr * dt;

        const scale = b.age < jump ? 1 : 1 - 0.5 * Math.min(1, (b.age - jump) / b.life);

        b.el.style.transform =
            `translate(${b.x}px, ${b.y}px) translate(-50%, -50%) rotate(${b.rot}deg) scale(${scale})`;

    }

    if (settled && !parrotClick.bills.length) {

        parrotClick.running = false;

        return;

    }

    requestAnimationFrame(parrotClickLoop);

}


function startParrotClickLoop() {

    if (parrotClick.running) {

        return;

    }

    parrotClick.running = true;

    parrotClick.prev = performance.now();

    requestAnimationFrame(parrotClickLoop);

}


function spawnParrotClickBill() {

    const s = PARROT_CLICK;

    if (parrotClick.bills.length >= s.max) {

        parrotClick.bills.shift().el.remove();

    }

    const from = Parrot.billsPoint();

    const el = document.createElement("img");

    el.src = FLY_BILL_IMAGE;
    el.alt = "";
    el.className = "parrot-click-bill";
    el.style.width = s.size + "px";

    document.body.appendChild(el);

    const angle = (-90 + (Math.random() - 0.5) * s.spread) * Math.PI / 180;

    const speed = s.speed * (0.75 + Math.random() * 0.5) * 60;

    parrotClick.bills.push({
        el,
        x: from.x + (Math.random() - 0.5) * 30,
        y: from.y - 40 + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * 360,
        vr: (Math.random() - 0.5) * s.spin * 60,
        age: 0,
        life: s.life * (0.8 + Math.random() * 0.4)
    });

}


function showParrotBalance() {

    const balanceEl = document.getElementById("balance");

    if (balanceEl) {

        balanceEl.textContent = formatBalance(currentProfile.balance);

    }

}


// Envoie les clics en attente (par paquets, pour ne pas appeler la base à chaque clic).
async function flushParrotClicks() {

    clearTimeout(parrotClick.flushTimer);

    parrotClick.flushTimer = null;

    if (parrotClick.sending || !parrotClick.pending || !currentGroup) {

        return;

    }

    const count = Math.min(40, parrotClick.pending);

    const groupId = currentGroup.id;

    parrotClick.sending = true;

    const { data, error } = await supabaseClient.rpc("parrot_click", {
        p_group: groupId,
        p_count: count
    });

    parrotClick.sending = false;

    parrotClick.pending -= count;

    // Euros affichés pour ce paquet de clics, et ceux des clics encore en attente.
    const sentGains =
        parrotClick.gains.splice(0, count).reduce((sum, gain) => sum + gain, 0);

    const waitingGains =
        parrotClick.gains.reduce((sum, gain) => sum + gain, 0);

    if (!currentGroup || currentGroup.id !== groupId) {

        parrotClick.pending = 0;

        return;

    }

    if (error || !data || !data[0]) {

        // Clics refusés : on retire ce qui avait été ajouté à l'affichage.
        currentProfile.balance = Number(currentProfile.balance) - sentGains;
        currentGroup.balance = currentProfile.balance;
        parrotClick.today = Math.max(0, parrotClick.today - sentGains);

        showParrotBalance();

        parrotClickToast(escapeHtml(error ? error.message : "Le clic n'a pas pu être enregistré."));

    } else {

        // Le solde du serveur fait foi, plus les clics partis entre-temps.
        parrotClick.today = data[0].today + waitingGains;
        parrotClick.cap = data[0].cap;
        parrotClick.mult = data[0].mult;
        parrotClick.best = Number(data[0].best) || 0;
        currentProfile.balance = Number(data[0].balance) + waitingGains;
        currentGroup.balance = currentProfile.balance;

        showParrotBalance();

    }

    if (parrotClick.pending) {

        flushParrotClicks();

    }

}


function onParrotClick() {

    if (parrotClick.today >= parrotClick.cap) {

        // Plus rien aujourd'hui : un tout petit sursaut, sans billet.
        parrotClick.spring.vsq += 0.04;

        startParrotClickLoop();

        parrotClickToast(parrotTiredMessage());

        return;

    }

    parrotClick.spring.vy -= PARROT_CLICK.bounce * 26;
    parrotClick.spring.vsq += PARROT_CLICK.bounce * 0.018;

    spawnParrotClickBill();

    startParrotClickLoop();

    // 1, 2 ou 3 € par clic, sans dépasser le plafond du jour.
    const gain =
        Math.min(parrotClick.mult, parrotClick.cap - parrotClick.today);

    parrotClick.today += gain;
    parrotClick.pending += 1;
    parrotClick.gains.push(gain);

    currentProfile.balance = Number(currentProfile.balance) + gain;
    currentGroup.balance = currentProfile.balance;

    showParrotBalance();

    if (parrotClick.today >= parrotClick.cap) {

        setTimeout(() => parrotClickToast(parrotTiredMessage()), 300);

    }

    if (parrotClick.pending >= 25) {

        flushParrotClicks();

    } else if (!parrotClick.flushTimer) {

        parrotClick.flushTimer = setTimeout(flushParrotClicks, 700);

    }

}


function initParrotClick() {

    const root = document.getElementById("parrot");

    if (!root || typeof Parrot === "undefined") {

        return;

    }

    // Le perroquet ne capte la souris que lorsqu'elle est sur lui (pas sur son cadre transparent).
    window.addEventListener("pointermove", event => {

        root.classList.toggle(
            "parrot-hit",
            parrotClickEnabled() && parrotHit(event.clientX, event.clientY)
        );

    }, { passive: true });

    root.addEventListener("pointerdown", event => {

        if (!parrotClickEnabled() || !parrotHit(event.clientX, event.clientY)) {

            root.classList.remove("parrot-hit");

            return;

        }

        event.preventDefault();

        onParrotClick();

    });

    // On n'oublie aucun clic en quittant la page.
    document.addEventListener("visibilitychange", () => {

        if (document.visibilityState === "hidden") {

            flushParrotClicks();

        }

    });

}


document.addEventListener("DOMContentLoaded", initParrotClick);



/* =========================================================
   COTE ENFLAMMÉE
   Une cote de 10 ou plus : la case rougeoie (style.css) et des
   étincelles s'en échappent et montent (réglages de la maquette B).
========================================================= */

const ODDS_FIRE = {
    colors: ["#ff4d00", "#ffd34d", "#c81e00"],
    rate: 10,
    height: 92,
    size: 2.5,
    wind: -15,
    // Marges du canvas autour de la case (côtés, au-dessus, en dessous).
    side: 40,
    above: 90,
    below: 20
};

const oddsFireState = new WeakMap();

let oddsFirePrev = performance.now();

function oddsFireLoop(t) {

    const dt = Math.min(0.05, (t - oddsFirePrev) / 1000);

    oddsFirePrev = t;

    const f = ODDS_FIRE;

    document.querySelectorAll("canvas.odds-embers").forEach(canvas => {

        const button = canvas.previousElementSibling;

        if (!button || canvas.getClientRects().length === 0) {
            return;
        }

        const w = button.offsetWidth + f.side * 2;

        const h = button.offsetHeight + f.above + f.below;

        const ratio = Math.min(2, window.devicePixelRatio || 1);

        if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {

            canvas.width = Math.round(w * ratio);
            canvas.height = Math.round(h * ratio);
            canvas.style.width = w + "px";
            canvas.style.height = h + "px";
            canvas.style.left = (button.offsetLeft - f.side) + "px";
            canvas.style.top = (button.offsetTop - f.above) + "px";

        }

        let state = oddsFireState.get(canvas);

        if (!state) {
            state = { parts: [], acc: Math.random() };
            oddsFireState.set(canvas, state);
        }

        const ctx = canvas.getContext("2d");

        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // Nouvelles étincelles, surtout sur le haut de la case.
        state.acc += f.rate * dt;

        while (state.acc >= 1) {

            state.acc--;

            const top = Math.random() < 0.7;

            state.parts.push({
                x: f.side + Math.random() * (w - f.side * 2),
                y: top ? f.above + 2 + Math.random() * 6 : f.above + 2 + Math.random() * (h - f.above - f.below - 4),
                vx: (Math.random() - 0.5) * 20,
                vy: -(f.height * (0.7 + Math.random() * 0.6)),
                age: 0,
                life: 0.7 + Math.random() * 0.6,
                r: f.size * (0.6 + Math.random() * 0.8),
                ph: Math.random() * 6.28
            });

        }

        ctx.globalCompositeOperation = "lighter";
        ctx.shadowColor = f.colors[0];
        ctx.shadowBlur = 8;

        state.parts = state.parts.filter(p => {

            p.age += dt;

            if (p.age > p.life) {
                return false;
            }

            p.x += (p.vx + f.wind + Math.sin(p.age * 8 + p.ph) * 12) * dt;
            p.y += p.vy * dt / p.life;

            const k = p.age / p.life;

            ctx.globalAlpha = (1 - k) * 0.95;
            ctx.fillStyle = k < 0.3 ? f.colors[1] : k < 0.7 ? f.colors[0] : f.colors[2];
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * (1 - k * 0.6), 0, Math.PI * 2);
            ctx.fill();

            return true;

        });

        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

    });

    requestAnimationFrame(oddsFireLoop);

}

requestAnimationFrame(oddsFireLoop);



/* =========================================================
   SKIN PHÉNIX : BRAISES
   Des braises montent autour du perroquet (réglages de la maquette A).
========================================================= */

const PHENIX = {
    colors: ["hsl(48, 100%, 70%)", "hsl(20, 100%, 55%)", "hsl(2, 100%, 40%)"],
    rate: 11,
    height: 220,
    size: 2.5,
    wind: -2
};

let phenixCanvas = null;

let phenixRunning = false;

function startPhenixEmbers() {

    if (phenixRunning) {
        return;
    }

    if (!phenixCanvas) {

        phenixCanvas = document.createElement("canvas");

        phenixCanvas.className = "phenix-embers";

        phenixCanvas.setAttribute("aria-hidden", "true");

        document.body.appendChild(phenixCanvas);

    }

    phenixRunning = true;

    let parts = [], acc = 0, prev = performance.now();

    const ctx = phenixCanvas.getContext("2d");

    const frame = t => {

        const dt = Math.min(0.05, (t - prev) / 1000);

        prev = t;

        const root = document.getElementById("parrot");

        const visible =
            document.body.classList.contains("parrot-phenix") &&
            root &&
            !root.classList.contains("parrot-hidden") &&
            !root.classList.contains("parrot-squeezed") &&
            !document.body.classList.contains("app-loading") &&
            root.getClientRects().length > 0;

        if (!visible) {

            parts = [];

            phenixCanvas.style.display = "none";

            if (!document.body.classList.contains("parrot-phenix")) {
                phenixRunning = false;
                return;
            }

            requestAnimationFrame(frame);

            return;

        }

        phenixCanvas.style.display = "";

        // Le canvas couvre le perroquet et la zone au-dessus de lui.
        const r = root.getBoundingClientRect();

        const W = Math.round(r.width + 120);

        const H = Math.round(r.height + PHENIX.height + 40);

        const ratio = Math.min(2, window.devicePixelRatio || 1);

        if (phenixCanvas.width !== W * ratio || phenixCanvas.height !== H * ratio) {
            phenixCanvas.width = W * ratio;
            phenixCanvas.height = H * ratio;
            phenixCanvas.style.width = W + "px";
            phenixCanvas.style.height = H + "px";
        }

        phenixCanvas.style.left = (r.left - 60) + "px";

        phenixCanvas.style.top = (r.top - PHENIX.height - 40) + "px";

        // Zone du corps du perroquet, dans le repère du canvas.
        const box = {
            x: 60 + r.width * 0.18,
            w: r.width * 0.64,
            y: PHENIX.height + 40 + r.height * 0.2,
            h: r.height * 0.7
        };

        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, W, H);

        acc += PHENIX.rate * dt;

        while (acc >= 1) {

            acc--;

            parts.push({
                x: box.x + Math.random() * box.w,
                y: box.y + Math.random() * box.h,
                vx: (Math.random() - 0.5) * 30,
                vy: -PHENIX.height * (0.6 + Math.random() * 0.7),
                age: 0,
                life: 1 + Math.random() * 0.9,
                r: PHENIX.size * (0.6 + Math.random() * 0.8),
                ph: Math.random() * 6.28
            });

        }

        ctx.globalCompositeOperation = "lighter";
        ctx.shadowColor = PHENIX.colors[1];
        ctx.shadowBlur = 8;

        parts = parts.filter(p => {

            p.age += dt;

            if (p.age > p.life) {
                return false;
            }

            p.x += (p.vx + PHENIX.wind + Math.sin(p.age * 6 + p.ph) * 16) * dt;
            p.y += p.vy * dt / p.life;

            const k = p.age / p.life;

            ctx.globalAlpha = (1 - k) * 0.95;
            ctx.fillStyle = k < 0.3 ? PHENIX.colors[0] : k < 0.7 ? PHENIX.colors[1] : PHENIX.colors[2];
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * (1 - k * 0.5), 0, Math.PI * 2);
            ctx.fill();

            return true;

        });

        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        requestAnimationFrame(frame);

    };

    requestAnimationFrame(frame);

}



/* =========================================================
   FENÊTRE DU SOLDE (clic sur le solde)
   Perroquet à 0 €, plafond du jour, paliers et boosts de la
   boutique (version A de demo-popup-solde.html).
========================================================= */

// Meilleur solde atteint dans le groupe → plafond du clic par jour
// (mêmes valeurs que parrot_click_cap dans perroquet-paliers.sql).
const PARROT_TIERS = [
    [0, 500],
    [5000, 750],
    [10000, 1000],
    [25000, 1500],
    [50000, 2500],
    [100000, 5000]
];

// Articles de la boutique qui multiplient le gain d'un clic.
const PARROT_BOOSTS = [
    { id: "clic_perroquet", mult: 2 },
    { id: "clic_perroquet_x3", mult: 3 }
];


function balanceModalHtml() {

    const euros = value => Math.round(Number(value) || 0).toLocaleString("fr-FR");

    const admin = Boolean(currentProfile?.is_admin);

    const balance = Number(currentProfile?.balance) || 0;

    const best = Math.max(parrotClick.best, balance);

    const mult = parrotClick.mult || 1;

    let current = 0;

    PARROT_TIERS.forEach(([need], index) => {
        if (best >= need) current = index;
    });

    const cap = parrotClick.cap || PARROT_TIERS[current][1];

    const next = PARROT_TIERS[current + 1];

    const done = Math.min(parrotClick.today, cap);

    // Avancement vers le palier suivant (0 à 1).
    const progress = next
        ? Math.min(1, Math.max(0, (best - PARROT_TIERS[current][0]) / (next[0] - PARROT_TIERS[current][0])))
        : 0;

    const count = PARROT_TIERS.length;

    const fill = (current + progress) / (count - 1) * 100;

    const tiers = PARROT_TIERS.map(([need, tierCap], index) => {

        const state = index < current ? "done" : index === current ? "current" : index === current + 1 ? "next" : "locked";

        return `
            <li class="bal-tier bal-tier--${state}">
                <span class="bal-tier-icon">${index <= current ? "✓" : "🔒"}</span>
                <span class="bal-tier-need">
                    ${index === 0 ? "Au départ" : `Palier <b>${euros(need)} €</b>`}
                    ${state === "next" ? `<span class="bal-tier-progress"><i style="width: ${progress * 100}%"></i></span>` : ""}
                </span>
                <span class="bal-tier-cap">Clique jusqu'à ${euros(tierCap)} €/j</span>
            </li>
        `;

    }).join("");

    const boosts = PARROT_BOOSTS.map(boost => {

        const item = COSMETICS.find(cosmetic => cosmetic.id === boost.id);

        const owned = mult >= boost.mult;

        return `
            <div class="bal-boost${owned ? " owned" : ""}">
                <span class="bal-boost-mult">×${boost.mult}</span>
                <span class="bal-boost-what">Clic du perroquet ×${boost.mult} : ${boost.mult} € par clic</span>
                <span class="bal-boost-price">${owned ? "✓ Possédé" : (item?.price ?? "?") + " 🪙"}</span>
            </div>
        `;

    }).join("");

    return `
        <h2>💶 Ton solde</h2>

        <div class="bal-now">
            <span>Solde actuel</span>
            <strong>${admin ? "∞" : euros(balance) + " €"}</strong>
        </div>

        <div class="bal-zero">
            <!-- Perroquet entier, avec le skin choisi (wait-body.png n'a pas la tête). -->
            <img src="assets/perroquet/skins/${activeParrotSkin()}/thumb.png" alt="">
            <p>
                <b>${balance <= 0 ? "Tu es à 0 € ?" : "Plus d'argent ?"}</b> Pas de panique !
                Clique sur le perroquet : chaque clic te donne <b>${mult} €</b>, jusqu'à ton plafond du jour.
                ${mult > 1 ? `<br><span class="bal-boost-on">✓ Clic du perroquet ×${mult} activé</span>` : ""}
            </p>
        </div>

        <div class="bal-today">
            <div class="bal-today-label">
                <span>Récupéré aujourd'hui</span>
                <span><b>${euros(done)} €</b> / ${euros(cap)} €</span>
            </div>
            <div class="bal-today-bar"><i style="width: ${done / cap * 100}%"></i></div>
        </div>

        <p class="level-sidebar-title">🦜 Paliers du perroquet</p>

        <p class="bal-hint">
            Atteins un palier de solde une seule fois et tu peux cliquer plus chaque jour, pour toujours (dans ce groupe).
        </p>

        <div class="bal-tiers-wrap">
            <div class="bal-gauge">
                <div class="bal-gauge-track">
                    <div class="bal-gauge-fill" style="height: ${fill}%"></div>
                    ${PARROT_TIERS.map((tier, index) => `
                        <span class="bal-gauge-dot${index <= current ? " done" : ""}${index === current ? " current" : ""}" style="top: ${index / (count - 1) * 100}%"></span>
                    `).join("")}
                </div>
            </div>
            <ul class="bal-tiers">${tiers}</ul>
        </div>

        <p class="level-sidebar-title bal-boost-title">🛍️ Booste tes clics</p>

        <p class="bal-hint">
            Dans la boutique, des objets multiplient ce que te rapporte chaque clic sur le perroquet.
        </p>

        <div class="bal-boosts">${boosts}</div>

        <button type="button" class="bal-shop-link" data-balance-shop>Voir la boutique →</button>
    `;

}


async function openBalanceModal() {

    const modal = document.getElementById("balance-modal");

    const body = document.getElementById("balance-modal-body");

    if (!modal || !body || !currentGroup) {
        return;
    }

    body.innerHTML = balanceModalHtml();

    modal.classList.remove("hidden");

    // Plafond, boost et récupéré du jour à jour, puis on redessine.
    await refreshParrotClick();

    if (!modal.classList.contains("hidden")) {
        body.innerHTML = balanceModalHtml();
    }

}


function setupBalanceModal() {

    const widget = document.getElementById("balance-widget");

    const modal = document.getElementById("balance-modal");

    if (!widget || !modal) {
        return;
    }

    widget.addEventListener("click", openBalanceModal);

    widget.addEventListener("keydown", event => {

        if (event.key === "Enter" || event.key === " ") {

            event.preventDefault();

            openBalanceModal();

        }

    });

    document.getElementById("close-balance-modal")?.addEventListener("click", () => {

        modal.classList.add("hidden");

    });

    // « Voir la boutique » : la fenêtre se ferme et l'onglet Boutique s'ouvre.
    modal.addEventListener("click", event => {

        if (event.target.closest("[data-balance-shop]")) {

            modal.classList.add("hidden");

            document.querySelector('.nav-button[data-page="shop-page"]')?.click();

        }

    });

}

document.addEventListener("DOMContentLoaded", setupBalanceModal);
