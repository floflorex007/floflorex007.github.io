/* =========================================================
   BETLAB — DUELS 1 CONTRE 1 ET SÉRIES DE VICTOIRES (voir duels.sql)

   Maquette demo-duels-classement.html :
   - « ⚔️ Défier » au survol d'un joueur du classement (à la place du solde) ;
   - même mise pour les deux, choisie par celui qui défie : au plus 30 % du
     solde du plus pauvre des deux (duels-meme-mise.sql) ;
   - le défié a 24 h pour accepter (même choix ou un autre), refuser coûte 1 % ;
   - un seul bon choix : il prend les 2 mises ; même choix : pile ou face à
     l'acceptation pour savoir qui les prendra ; aucun : les 2 mises sont perdues ;
   - tête-à-tête en barre vert / rouge dans la fenêtre ;
   - flamme bleue qui grandit à partir de 3 victoires d'affilée
     (bleue pour ne pas la confondre avec la flamme de la série de jours).
========================================================= */


// Séries de victoires du groupe : pseudo → nombre de victoires d'affilée.
let winStreaks = {};

// Mes duels en attente ou en cours (fonction my_duels).
let myDuels = [];

// Défis reçus déjà montrés en fenêtre pendant cette visite.
const duelPopupsShown = new Set();

// Mise max d'un duel : 30 % du solde du plus pauvre des deux (duel_max_stake dans la base).
const DUEL_MAX_SHARE = 0.30;

const DUEL_RULES = "Le gagnant remporte les 2 mises, le perdant perd sa mise. Même cote : pile ou face.";

const DUEL_COLORS = ["#c86bff", "#ff6bd5", "#4fc3ff", "#ff9f43", "#63d69f", "#ffd36b", "#6c63ff", "#ff6b6b"];


function duelColor(name) {

    let hash = 0;

    [...name].forEach(letter => {
        hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
    });

    return DUEL_COLORS[hash % DUEL_COLORS.length];

}


function duelEuros(amount) {

    return Number(amount).toLocaleString("fr-FR") + " €";

}


// Mise max contre ce joueur : 30 % du plus petit des deux soldes.
function duelMaxStake(otherBalance) {

    const poorest = Math.min(Number(currentProfile?.balance || 0), Number(otherBalance || 0));

    return Math.floor(poorest * DUEL_MAX_SHARE);

}


function duelAmountValid(amount, max) {

    return Number.isInteger(amount) && amount >= 10 && amount <= max;

}


// Mises proposées : 10 %, 20 % et 30 % du plus petit solde (la dernière est le max).
function duelStakeOptions(max) {

    return [...new Set([Math.floor(max / 3), Math.floor(max * 2 / 3), max])].filter(amount => amount >= 10);

}


/*
    Séries de victoires.
*/

async function loadWinStreaks() {

    if (!currentGroup) {
        return;
    }

    const { data, error } = await supabaseClient.rpc("group_win_streaks", { p_group: currentGroup.id });

    if (error) {
        console.error("Séries de victoires indisponibles (duels.sql lancé ?)", error);
        return;
    }

    winStreaks = Object.fromEntries((data || []).map(row => [row.username, row.streak]));

}


// Flamme bleue à côté du pseudo : plus grande et plus vive à 5, 8 et 12 victoires.
function winStreakBadgeHtml(username) {

    const streak = winStreaks[username] || 0;

    if (streak < 3) {
        return "";
    }

    const level = streak >= 12 ? 4 : streak >= 8 ? 3 : streak >= 5 ? 2 : 1;

    return `
        <span class="win-streak win-streak--${level}" data-streak="${streak}">
            <span class="win-streak-flame">🔥</span><span class="win-streak-count">${streak}</span>
        </span>`;

}


// Survol d'une flamme bleue : petite fenêtre qui explique le boost de la série.
document.addEventListener("mouseover", event => {

    const flame = event.target.closest(".win-streak[data-streak]");

    // Le classement a pu être redessiné sous la souris : la fenêtre ne reste pas seule.
    if (!flame) {
        document.querySelector(".win-streak-tip")?.remove();
        return;
    }

    if (flame.contains(event.relatedTarget)) {
        return;
    }

    document.querySelector(".win-streak-tip")?.remove();

    const streak = Number(flame.dataset.streak);

    const tip = document.createElement("div");

    tip.className = "win-streak-tip";

    tip.innerHTML = `
        <b>${streak} victoires d'affilée</b>
        <span>Cote boostée de <strong>+${Math.round(winStreakBoost(streak) * 100)} %</strong> sur les mises simples</span>`;

    document.body.appendChild(tip);

    // Au-dessus de la flamme, sans sortir de l'écran.
    const box = flame.getBoundingClientRect();

    const left = Math.min(Math.max(8, box.left + box.width / 2 - tip.offsetWidth / 2), window.innerWidth - tip.offsetWidth - 8);

    const top = box.top - tip.offsetHeight - 8;

    tip.style.left = left + "px";

    tip.style.top = (top < 8 ? box.bottom + 8 : top) + "px";

});


document.addEventListener("mouseout", event => {

    const flame = event.target.closest(".win-streak[data-streak]");

    if (flame && !flame.contains(event.relatedTarget)) {
        document.querySelector(".win-streak-tip")?.remove();
    }

});


// Boost de cote des mises simples selon ma série (même barème que win_streak_boost, boost-serie-victoires.sql).
function winStreakBoost(streak) {

    return streak >= 12 ? 0.20 : streak >= 8 ? 0.15 : streak >= 5 ? 0.10 : streak >= 3 ? 0.05 : 0;

}


function myWinStreak() {

    return winStreaks[currentProfile?.username] || 0;

}


// Bouton « Défier » d'une ligne du classement (pas pour moi, ni avec l'admin).
function duelButtonHtml(profile) {

    if (!profile.user_id || profile.is_admin || currentProfile?.is_admin || profile.user_id === currentUser?.id) {
        return "";
    }

    return `<button type="button" class="lb-duel-btn" data-duel-user="${profile.user_id}" data-duel-name="${escapeHtml(profile.username)}" data-duel-balance="${Number(profile.balance || 0)}">⚔️ Défier</button>`;

}


/*
    Fenêtre de défi.
*/

const duelState = { opponent: null, bets: [], bet: null, choice: null, amount: null, h2h: null, incoming: null, coin: null };


function duelVersusHtml(left, right, leftSub, rightSub) {

    const avatar = name => `<span class="duel-av" style="background: ${duelColor(name)}">${escapeHtml(name.charAt(0).toUpperCase())}</span>`;

    return `
        <div class="duel-versus">
            <div>${avatar(left)}<small>${escapeHtml(leftSub)}</small></div>
            <span class="duel-versus-vs">VS</span>
            <div>${avatar(right)}<small>${escapeHtml(rightSub)}</small></div>
        </div>`;

}


// Tête-à-tête en barre vert (moi) / rouge (l'autre).
function duelH2hHtml(name, h2h) {

    const wins = h2h?.wins || 0;

    const losses = h2h?.losses || 0;

    if (!wins && !losses) {
        return `<div class="duel-h2h">Premier duel contre <b>${escapeHtml(name)}</b> !</div>`;
    }

    const sentence = wins > losses
        ? `Tu mènes <b>${wins} victoire${wins > 1 ? "s" : ""} à ${losses}</b> contre ${escapeHtml(name)}`
        : losses > wins
            ? `${escapeHtml(name)} mène <b>${losses} victoire${losses > 1 ? "s" : ""} à ${wins}</b> contre toi`
            : `Égalité <b>${wins} partout</b> contre ${escapeHtml(name)}`;

    return `
        <div class="duel-h2h">
            ${sentence}
            <div class="duel-h2h-bar">
                <span class="w" style="flex: ${wins}"></span>
                <span class="l" style="flex: ${losses}"></span>
            </div>
            <div class="duel-h2h-legend"><span>Toi · ${wins}</span><span>${losses} · ${escapeHtml(name)}</span></div>
        </div>`;

}


async function openDuelModal(userId, username, balance) {

    duelState.opponent = { id: userId, name: username, max: duelMaxStake(balance) };

    duelState.incoming = null;

    duelState.coin = null;

    duelState.choice = null;

    duelState.amount = duelStakeOptions(duelState.opponent.max)[0] || null;

    const modal = document.getElementById("duel-modal");

    document.getElementById("duel-body").innerHTML = '<p class="duel-muted">Chargement…</p>';

    modal.classList.remove("hidden");

    const [bets, h2h] = await Promise.all([
        supabaseClient
            .from("bets")
            .select("id, question, author_id, target_user_id, target_blocked, deadline_at, bet_choices!bet_choices_bet_id_fkey (id, label, odds, created_at)")
            .eq("group_id", currentGroup.id)
            .eq("status", "open")
            .order("created_at", { ascending: false }),
        supabaseClient.rpc("duel_h2h", { p_group: currentGroup.id, p_other: userId })
    ]);

    const now = Date.now();

    // Paris où le duel est possible : ni créés par l'un de nous, ni « concerne » l'un de nous.
    duelState.bets = (bets.data || []).filter(bet =>
        (!bet.deadline_at || new Date(bet.deadline_at).getTime() > now) &&
        ![currentUser.id, userId].includes(bet.author_id) &&
        !(bet.target_blocked && [currentUser.id, userId].includes(bet.target_user_id)) &&
        (bet.bet_choices || []).length >= 2
    );

    duelState.bets.forEach(bet => bet.bet_choices.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));

    duelState.bet = duelState.bets[0] || null;

    duelState.h2h = h2h.data || null;

    renderDuelModal();

}


function renderDuelModal() {

    const body = document.getElementById("duel-body");

    if (duelState.coin) {
        renderDuelCoin(body);
        return;
    }

    if (duelState.incoming) {
        renderIncomingDuel(body);
        return;
    }

    const name = duelState.opponent.name;

    const bet = duelState.bet;

    const max = duelState.opponent.max;

    body.innerHTML = `
        <h2>⚔️ Défier ${escapeHtml(name)}</h2>
        ${duelVersusHtml(currentProfile.username, name, "Toi", name)}
        ${duelH2hHtml(name, duelState.h2h)}
        ${max < 10
            ? `<p class="duel-muted">Pas de duel possible : la mise max est 30 % du solde du plus pauvre de vous deux, et il faut au moins 10 €.</p>`
            : !bet
            ? `<p class="duel-muted">Aucun pari ouvert pour un duel entre vous deux (les paris créés par l'un de vous ne comptent pas).</p>`
            : `
                <div class="duel-field">
                    <label>Sur quel pari ?</label>
                    <div class="duel-bets">
                        ${duelState.bets.map(item => `
                            <button type="button" class="duel-bet${item.id === bet.id ? " on" : ""}" data-duel-bet="${item.id}">${escapeHtml(item.question)}</button>`).join("")}
                    </div>
                </div>
                <div class="duel-field">
                    <label>Ton choix (${escapeHtml(name)} choisira le sien, le même ou un autre)</label>
                    <div class="duel-choices">
                        ${bet.bet_choices.map(choice => `
                            <button type="button" class="duel-choice${choice.id === duelState.choice ? " on" : ""}" data-duel-choice="${choice.id}">
                                ${escapeHtml(choice.label)}<small>cote ${Number(choice.odds).toLocaleString("fr-FR")}</small>
                            </button>`).join("")}
                    </div>
                </div>
                <div class="duel-field">
                    <label>La mise (${escapeHtml(name)} mise la même) · max ${duelEuros(max)}</label>
                    <div class="duel-amounts">
                        ${duelStakeOptions(max).map(amount => `
                            <button type="button" class="${amount === duelState.amount ? "on" : ""}" data-duel-amount="${amount}">${duelEuros(amount)}<small>${amount === max ? "max" : Math.round(amount / max * 30) + " %"}</small></button>`).join("")}
                    </div>
                </div>
                <p class="duel-rule">${DUEL_RULES}</p>
                <button type="button" class="duel-go" data-duel-send ${duelState.choice ? "" : "disabled"}>
                    ${duelState.choice ? "⚔️ Envoyer le défi" : "Choisis d'abord ton choix"}
                </button>`}
        <p class="error-message" id="duel-error"></p>`;

}


// Défi reçu : accepter (son camp, le même ou un autre, à la même mise) ou refuser (−1 %).
function renderIncomingDuel(body) {

    const duel = duelState.incoming;

    const choices = duel.choices || [];

    const penalty = Math.floor(Number(currentProfile?.balance || 0) * 0.01);

    const hoursLeft = Math.max(1, Math.round((new Date(duel.expires_at) - Date.now()) / 3600000));

    body.innerHTML = `
        <h2>⚔️ ${escapeHtml(duel.challenger)} te défie !</h2>
        ${duelVersusHtml(duel.challenger, currentProfile.username, duel.challenger, "Toi")}
        ${duelH2hHtml(duel.challenger, duelState.h2h)}
        <p class="duel-rule">
            Pari : <b>${escapeHtml(duel.question)}</b><br>
            ${escapeHtml(duel.challenger)} a choisi <b>${escapeHtml(duel.challenger_label)}</b> et mise <b>${duelEuros(duel.amount)}</b><br><br>
            ${DUEL_RULES}
        </p>
        <div class="duel-field">
            <div class="duel-choices">
                ${choices.map(choice => `
                    <button type="button" class="duel-choice${choice.id === duelState.choice ? " on" : ""}" data-duel-choice="${choice.id}">
                        ${escapeHtml(choice.label)}<small>cote ${Number(choice.odds).toLocaleString("fr-FR")}</small>
                    </button>`).join("")}
            </div>
        </div>
        ${duelState.choice && duelState.choice === duel.challenger_choice
            ? `<p class="duel-rule">🪙 Même choix que ${escapeHtml(duel.challenger)} : un pile ou face dira tout de suite qui prendra les ${duelEuros(2 * duel.amount)}.</p>`
            : ""}
        <button type="button" class="duel-go" data-duel-accept ${duelState.choice ? "" : "disabled"}>✅ Accepter · ${duelEuros(duel.amount)}</button>
        <button type="button" class="duel-go duel-go--alt" data-duel-refuse>Refuser (−1 % : ${duelEuros(penalty)})</button>
        <p class="duel-muted duel-center">Il te reste environ ${hoursLeft} h pour répondre.</p>
        <p class="error-message" id="duel-error"></p>`;

}


// Pile ou face (même choix) : la pièce tourne puis montre qui prendra les 2 mises.
function renderDuelCoin(body) {

    const coin = duelState.coin;

    body.innerHTML = `
        <h2>🪙 Pile ou face</h2>
        <p class="duel-muted duel-center">Vous avez choisi tous les deux <b>${escapeHtml(coin.label)}</b>.</p>
        <div class="duel-coin"><span>🪙</span></div>
        <p class="duel-coin-result">
            ${coin.me
                ? `<b class="dh-plus">Tu as gagné le pile ou face !</b><br>Si « ${escapeHtml(coin.label)} » gagne, tu prends les ${duelEuros(coin.total)}.`
                : `<b class="dh-minus">${escapeHtml(coin.other)} a gagné le pile ou face.</b><br>Si « ${escapeHtml(coin.label)} » gagne, il prend les ${duelEuros(coin.total)}.`}
        </p>
        <button type="button" class="duel-go" data-duel-coin-ok>OK</button>`;

}


async function openIncomingDuel(duel) {

    duelPopupsShown.add(duel.id);

    duelState.incoming = duel;

    duelState.coin = null;

    duelState.choice = null;

    document.getElementById("duel-body").innerHTML = '<p class="duel-muted">Chargement…</p>';

    document.getElementById("duel-modal").classList.remove("hidden");

    const { data } = await supabaseClient.rpc("duel_h2h", {
        p_group: currentGroup.id,
        p_other: duel.challenger_id
    });

    duelState.h2h = data || null;

    renderDuelModal();

}


function closeDuelModal() {

    document.getElementById("duel-modal")?.classList.add("hidden");

}


function duelError(message) {

    const error = document.getElementById("duel-error");

    if (error) {
        error.textContent = message;
    }

}


async function afterDuelMoney(message) {

    closeDuelModal();

    alertToast(message, { type: "joined" });

    await loadCurrentProfile();

    await refreshDuels();

    displayLeaderboard();

}


/*
    Mes duels : petite liste sous la ligne d'XP du groupe, et fenêtre
    automatique pour un défi reçu (une fois par visite).
*/

async function refreshDuels() {

    if (!currentGroup || currentProfile?.is_admin) {
        return;
    }

    const { data, error } = await supabaseClient.rpc("my_duels", { p_group: currentGroup.id });

    if (error) {
        console.error("Duels indisponibles (duels.sql lancé ?)", error);
        return;
    }

    myDuels = data || [];

    // Les duels marchent pour ce joueur : le lien de l'historique peut s'afficher.
    document.getElementById("duel-history-link")?.classList.remove("hidden");

    renderDuelStrip();

    markDuelRows();

    // Téléphone : le classement n'est pas à l'écran, le défi reçu s'ouvre en fenêtre.
    const incoming = myDuels.find(duel => duel.incoming && duel.status === "pending" && !duelPopupsShown.has(duel.id));

    if (incoming && typeof PHONE_LAYOUT !== "undefined" && PHONE_LAYOUT.matches
        && document.getElementById("duel-modal")?.classList.contains("hidden")) {
        openIncomingDuel(incoming);
    }

    remindPendingDuel();

}


function renderDuelStrip() {

    const strip = document.getElementById("duel-strip");

    if (!strip) {
        return;
    }

    // Seulement les duels en cours : un défi reçu s'affiche sur la ligne de celui
    // qui défie (markDuelRows), un défi envoyé n'est pas listé.
    const shown = myDuels.filter(duel => duel.status === "active");

    strip.classList.toggle("hidden", !shown.length);

    strip.innerHTML = shown.map(duel => {

        const other = duel.incoming ? duel.challenger : duel.opponent;

        const text = duel.status === "active"
            ? `Duel contre <b>${escapeHtml(other)}</b> · ${duelEuros(duel.amount)}${duel.coin_winner ? ` · 🪙 ${escapeHtml(duel.coin_winner)}` : ""}`
            : duel.incoming
                ? `<b>${escapeHtml(other)}</b> te défie · ${duelEuros(duel.amount)}`
                : `Défi envoyé à <b>${escapeHtml(other)}</b> · en attente`;

        const action = duel.status === "pending" && duel.incoming
            ? `<button type="button" class="duel-strip-btn" data-duel-open="${duel.id}">Répondre</button>`
            : duel.status === "pending"
                ? `<button type="button" class="duel-strip-btn duel-strip-btn--alt" data-duel-cancel="${duel.id}">Retirer</button>`
                : "";

        return `
            <div class="duel-strip-row${duel.status === "pending" && duel.incoming ? " incoming" : ""}" title="${escapeHtml(duel.question)}">
                <span>⚔️ ${text}</span>
                ${action}
            </div>`;

    }).join("");

}


// Défis reçus déjà annoncés (rebond + secousse) : ensuite la mise reste, sans animation.
const duelRowsAnnounced = new Set();


// Défi reçu (maquette demo-defi-recu.html, variante F) : sur la ligne du joueur
// qui me défie, son solde est remplacé par la mise du défi, encadrée de rouge.
// Un clic ouvre la fenêtre du défi.
function markDuelRows() {

    const list = document.getElementById("leaderboard-list");

    if (!list) {
        return;
    }

    list.querySelectorAll(".lb-duel-chip").forEach(chip => chip.remove());

    // Un seul défi à la fois avec un même joueur : son « Défier » est grisé
    // tant qu'un défi entre nous attend une réponse ou est en cours.
    list.querySelectorAll(".lb-duel-btn").forEach(button => {

        const busy = myDuels.some(duel =>
            ["pending", "active"].includes(duel.status) &&
            (duel.incoming ? duel.challenger : duel.opponent) === button.dataset.duelName
        );

        button.disabled = busy;

        button.textContent = busy ? "⚔️ En cours" : "⚔️ Défier";

        button.title = busy ? "Un défi entre vous deux est déjà en cours : attends qu'il soit terminé." : "";

    });

    list.querySelectorAll(".leaderboard-row.duel-challenging").forEach(row => row.classList.remove("duel-challenging"));

    myDuels
        .filter(duel => duel.incoming && duel.status === "pending")
        .forEach(duel => {

            const row = [...list.querySelectorAll(".leaderboard-row[data-player]")]
                .find(item => item.dataset.player === duel.challenger);

            if (!row) {
                return;
            }

            const chip = document.createElement("button");

            chip.type = "button";

            chip.className = "lb-duel-chip";

            chip.dataset.duelOpen = duel.id;

            chip.title = `${duel.challenger} te défie en misant ${duelEuros(duel.amount)} sur « ${duel.question} »`;

            chip.textContent = "⚔️ " + duelEuros(duel.amount);

            row.classList.add("duel-challenging");

            row.querySelector(".leaderboard-balance")?.after(chip);

            // Première fois : la mise arrive avec un petit rebond et la ligne secoue.
            if (!duelRowsAnnounced.has(duel.id)) {

                duelRowsAnnounced.add(duel.id);

                chip.classList.add("lb-duel-chip--new");

                row.animate(
                    [
                        { transform: "translateX(0)" },
                        { transform: "translateX(-3px)", offset: 0.2 },
                        { transform: "translateX(3px)", offset: 0.4 },
                        { transform: "translateX(-3px)", offset: 0.6 },
                        { transform: "translateX(3px)", offset: 0.8 },
                        { transform: "translateX(0)" }
                    ],
                    { duration: 500, iterations: 2, delay: 200 }
                );

            }

        });

}


/*
    Clics : classement, fenêtre, liste.
*/

document.addEventListener("click", async event => {

    const target = event.target;

    const challenge = target.closest(".lb-duel-btn");

    if (challenge?.disabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    if (challenge) {

        event.preventDefault();

        event.stopPropagation();

        // Téléphone : le classement (en fenêtre) se ferme pour laisser place au défi.
        document.body.classList.remove("leaderboard-open");

        // Ordinateur : la section « Groupe » passe en mode défi (téléphone : fenêtre).
        enterDuelMode(challenge.dataset.duelUser, challenge.dataset.duelName, challenge.dataset.duelBalance);

        return;

    }

    const open = target.closest("[data-duel-open]");

    if (open) {

        event.preventDefault();

        event.stopPropagation();

        document.body.classList.remove("leaderboard-open");

        // Depuis l'historique des défis : la fenêtre du défi prend sa place.
        closeDuelHistory();

        let duel = myDuels.find(item => item.id === open.dataset.duelOpen);

        if (!duel) {
            await refreshDuels();
            duel = myDuels.find(item => item.id === open.dataset.duelOpen);
        }

        if (duel?.incoming && duel.status === "pending") {
            openIncomingDuel(duel);
        } else {
            alertToast("Ce défi n'attend plus de réponse.", { type: "error" });
        }

        return;

    }

    const cancel = target.closest("[data-duel-cancel]");

    if (cancel) {

        cancel.disabled = true;

        const { error } = await supabaseClient.rpc("duel_cancel", { p_duel: cancel.dataset.duelCancel });

        if (error) {
            alertToast(escapeHtml(error.message), { type: "error" });
            cancel.disabled = false;
            return;
        }

        await afterDuelMoney("⚔️ Défi retiré : ta mise t'a été rendue.");

        return;

    }

    if (!target.closest("#duel-modal")) {
        return;
    }

    if (target.closest("#close-duel-modal") || target.id === "duel-modal") {
        closeDuelModal();
        return;
    }

    const bet = target.closest("[data-duel-bet]");

    if (bet) {
        duelState.bet = duelState.bets.find(item => item.id === bet.dataset.duelBet);
        duelState.choice = null;
        renderDuelModal();
        return;
    }

    const choice = target.closest("[data-duel-choice]");

    if (choice) {
        duelState.choice = choice.dataset.duelChoice;
        renderDuelModal();
        return;
    }

    const amount = target.closest("[data-duel-amount]");

    if (amount) {
        duelState.amount = Number(amount.dataset.duelAmount);
        renderDuelModal();
        return;
    }

    if (target.closest("[data-duel-coin-ok]")) {
        closeDuelModal();
        return;
    }

    const button = target.closest("[data-duel-send], [data-duel-accept], [data-duel-refuse]");

    if (!button || button.disabled) {
        return;
    }

    button.disabled = true;

    let result;

    if (button.matches("[data-duel-send]")) {

        result = await supabaseClient.rpc("duel_challenge", {
            p_group: currentGroup.id,
            p_opponent: duelState.opponent.id,
            p_choice: duelState.choice,
            p_amount: duelState.amount
        });

        if (!result.error) {
            await afterDuelMoney(`⚔️ Défi envoyé à <strong>${escapeHtml(duelState.opponent.name)}</strong> : il a 24 h pour accepter.`);
            return;
        }

    } else {

        const accept = button.matches("[data-duel-accept]");

        result = await supabaseClient.rpc("duel_answer", {
            p_duel: duelState.incoming.id,
            p_accept: accept,
            p_choice: accept ? duelState.choice : null
        });

        // Même choix : on montre le pile ou face avant de fermer.
        if (!result.error && result.data?.same_choice) {

            duelState.coin = {
                me: result.data.coin_me,
                label: result.data.label,
                total: result.data.total,
                other: duelState.incoming.challenger
            };

            renderDuelModal();

            await loadCurrentProfile();

            await refreshDuels();

            displayLeaderboard();

            return;

        }

        if (!result.error) {
            await afterDuelMoney(accept
                ? `⚔️ Duel accepté contre <strong>${escapeHtml(duelState.incoming.challenger)}</strong> !`
                : "Défi refusé : 1 % de ton solde est perdu.");
            return;
        }

    }

    duelError(result.error.message || "Impossible pour le moment.");

    button.disabled = false;

}, true);


document.addEventListener("keydown", event => {

    if (event.key === "Escape" && !document.getElementById("duel-modal")?.classList.contains("hidden")) {
        closeDuelModal();
    }

});


/*
    Mode défi (maquette demo-mode-defi.html) : sur ordinateur, « ⚔️ Défier »
    retourne la section « Groupe » en rouge (Florian VS Yann + score de vos
    défis), le classement disparaît, et on choisit sa cote directement sur
    les cartes de paris, en mise simple. La mise se fait dans un ticket rouge.
    Les paris impossibles pour ce duel sont grisés avec la raison.
    Sur téléphone, la fenêtre de défi reste utilisée.
*/

const duelMode = { opponent: null, h2h: null, pick: null, amount: "" };


function isDuelMode() {

    return Boolean(duelMode.opponent);

}


// La section « Groupe » se retourne ; son contenu change à mi-tour.
function flipLeaderboard(change) {

    const aside = document.getElementById("leaderboard-sidebar");

    if (!aside) {
        change();
        return;
    }

    const half = { duration: 260, easing: "cubic-bezier(.45,0,.55,1)", fill: "forwards" };

    // La colonne de gauche fait défiler son contenu (overflow) : pendant le tour,
    // le bord de la carte qui avance vers nous dépasserait et serait rogné.
    const column = aside.closest(".left-column");

    if (column) {
        column.style.overflow = "visible";
        column.style.zIndex = "5";
    }

    aside.animate(
        [{ transform: "perspective(1200px) rotateY(0deg)" }, { transform: "perspective(1200px) rotateY(90deg) scale(.96)" }],
        half
    ).finished.then(() => {

        change();

        return aside.animate(
            [{ transform: "perspective(1200px) rotateY(-90deg) scale(.96)" }, { transform: "perspective(1200px) rotateY(0deg)" }],
            { duration: 320, easing: "cubic-bezier(.2,.8,.3,1.1)" }
        ).finished;

    }).catch(() => {}).finally(() => {

        aside.getAnimations().forEach(animation => animation.cancel());

        if (column) {
            column.style.overflow = "";
            column.style.zIndex = "";
        }

    });

}


async function enterDuelMode(userId, username, balance) {

    // Téléphone : pas de section « Groupe » à l'écran, la fenêtre de défi suffit.
    if (typeof PHONE_LAYOUT !== "undefined" && PHONE_LAYOUT.matches) {
        openDuelModal(userId, username, balance);
        return;
    }

    duelMode.opponent = { id: userId, name: username, max: duelMaxStake(balance) };

    duelMode.pick = null;

    duelMode.amount = "";

    duelMode.h2h = null;

    // Le ticket habituel est mis de côté pendant le défi.
    if (typeof ticketLegs !== "undefined" && ticketLegs.length) {

        ticketLegs = [];

        renderTicket();

        syncTicketHighlights();

    }

    flipLeaderboard(() => {

        document.body.classList.add("duel-mode");

        renderDuelPanel();

        renderDuelTicket();

        applyDuelBetStates();

    });

    const { data } = await supabaseClient.rpc("duel_h2h", { p_group: currentGroup.id, p_other: userId });

    if (duelMode.opponent?.id === userId) {

        duelMode.h2h = data || { wins: 0, losses: 0 };

        renderDuelPanel();

    }

}


function exitDuelMode() {

    if (!isDuelMode()) {
        return;
    }

    duelMode.opponent = null;

    duelMode.pick = null;

    flipLeaderboard(() => {

        document.body.classList.remove("duel-mode");

        renderDuelPanel();

        renderDuelTicket();

        applyDuelBetStates();

    });

}


// Contenu rouge de la section « Groupe » : face-à-face, score, consigne.
function renderDuelPanel() {

    const panel = document.getElementById("duel-panel");

    if (!panel) {
        return;
    }

    if (!isDuelMode()) {
        panel.innerHTML = "";
        return;
    }

    const name = duelMode.opponent.name;

    panel.innerHTML = `
        <button type="button" class="duel-panel-close" data-duel-exit title="Quitter le mode défi">✕</button>
        <div class="duel-panel-title">⚔️ Mode défi</div>
        ${duelVersusHtml(currentProfile.username, name, currentProfile.username, name)}
        ${duelMode.h2h ? duelH2hHtml(name, duelMode.h2h) : '<div class="duel-h2h">…</div>'}
        <p class="duel-panel-step">
            ${duelMode.opponent.max < 10
                    ? `Pas de duel possible : la mise max est 30 % du solde du plus pauvre de vous deux, et il faut au moins 10 €.`
                    : `👉 Clique sur une cote dans un pari.`}
        </p>`;

}


// Ticket rouge du défi (à la place du ticket habituel), dès qu'une cote est choisie.
function renderDuelTicket() {

    const ticket = document.getElementById("duel-ticket");

    if (!ticket) {
        return;
    }

    const pick = duelMode.pick;

    if (!isDuelMode() || !pick) {
        hideDuelTicket(ticket);
        return;
    }

    // Un fondu de sortie était en cours : on l'arrête, le ticket reste.
    ticket.getAnimations().forEach(animation => animation.cancel());

    ticket.classList.remove("hidden");

    const name = duelMode.opponent.name;

    const max = duelMode.opponent.max;

    const amount = Number(duelMode.amount);

    const ok = duelAmountValid(amount, max);

    ticket.innerHTML = `
        <div class="leaderboard-header duel-ticket-head">⚔️ Défi</div>
        <div class="duel-ticket-pick">
            <b>${escapeHtml(pick.label)}</b> <span>cote ${Number(pick.odds).toLocaleString("fr-FR")}</span>
            <small title="${escapeHtml(pick.question)}">${escapeHtml(pick.question)}</small>
        </div>
        <input type="number" class="ticket-stake duel-ticket-stake" inputmode="numeric" min="10" max="${max}" step="1"
               placeholder="Mise" value="${escapeHtml(String(duelMode.amount))}" data-duel-stake>
        <div class="ticket-chips duel-ticket-chips">
            ${duelStakeOptions(max).map(value => `<button type="button" data-duel-chip="${value}">${value === max ? "Max " : ""}${duelEuros(value)}</button>`).join("")}
        </div>
        <button type="button" class="duel-go" data-duel-ticket-go ${ok ? "" : "disabled"}>
            ${duelTicketGoText(name, amount, max)}
        </button>
        <p class="duel-ticket-rule">${DUEL_RULES}</p>
        <p class="error-message" data-duel-ticket-error></p>`;

}


// Le ticket rouge s'en va en douceur : fondu, léger rétrécissement, et sa place
// se referme (les éléments en dessous remontent sans à-coup).
function hideDuelTicket(ticket) {

    if (ticket.classList.contains("hidden") || ticket.dataset.leaving) {
        return;
    }

    ticket.dataset.leaving = "1";

    const height = ticket.getBoundingClientRect().height;

    const gap = parseFloat(getComputedStyle(ticket.parentElement).rowGap) || 0;

    ticket.style.overflow = "hidden";

    ticket.animate(
        [
            { opacity: 1, transform: "scale(1)", height: height + "px", marginTop: "0px", paddingTop: "18px", paddingBottom: "18px", borderWidth: "1px" },
            { opacity: 0, transform: "scale(.96)", offset: 0.45 },
            { opacity: 0, transform: "scale(.96)", height: "0px", marginTop: -gap + "px", paddingTop: "0px", paddingBottom: "0px", borderWidth: "0px" }
        ],
        { duration: 420, easing: "cubic-bezier(.4,0,.2,1)" }
    ).finished.then(() => {

        ticket.classList.add("hidden");

        ticket.innerHTML = "";

    }).catch(() => {}).finally(() => {

        ticket.style.overflow = "";

        delete ticket.dataset.leaving;

    });

}


// Raison pour laquelle un pari ne peut pas servir à ce duel (sinon null).
function duelBetBlocker(bet) {

    if (!bet) {
        return "Pari indisponible pour un duel.";
    }

    const me = currentUser.id;

    const other = duelMode.opponent.id;

    if (bet.status !== "open" || (bet.deadline_at && new Date(bet.deadline_at) <= new Date())) {
        return "Pas de duel : ce pari n'est plus ouvert.";
    }

    if (bet.author_id === me) {
        return "Pas de duel : c'est toi qui as créé ce pari.";
    }

    if (bet.author_id === other) {
        return `Pas de duel : ce pari est créé par ${duelMode.opponent.name}.`;
    }

    if (bet.target_blocked && [me, other].includes(bet.target_user_id)) {
        return "Pas de duel : ce pari concerne l'un de vous deux.";
    }

    return null;

}


// Cartes de paris en mode défi : grisées avec la raison quand le duel est impossible.
function applyDuelBetStates() {

    const container = document.getElementById("bets-container");

    if (!container) {
        return;
    }

    container.querySelectorAll(".duel-off-why").forEach(element => element.remove());

    container.querySelectorAll(".bet-card").forEach(card => {

        card.classList.remove("duel-off");

        const betId = card.dataset.betId || card.dataset.draftId;

        if (!isDuelMode() || !betId) {
            return;
        }

        const bet = lastLoadedBets.find(item => item.id === betId);

        const blocker = card.classList.contains("claim-card") || card.classList.contains("bet-card-draft")
            ? "Pas de duel sur ce pari."
            : duelBetBlocker(bet);

        if (blocker) {

            card.classList.add("duel-off");

            const why = document.createElement("p");

            why.className = "duel-off-why";

            why.textContent = blocker;

            card.appendChild(why);

        }

    });

    // Ma cote choisie, entourée de rouge.
    container.querySelectorAll(".bet-choice-button.duel-picked").forEach(button => button.classList.remove("duel-picked"));

    if (isDuelMode() && duelMode.pick) {
        container
            .querySelector(`.bet-choice-button[data-choice-id="${duelMode.pick.choiceId}"]`)
            ?.classList.add("duel-picked");
    }

}


// Les cartes sont redessinées en direct : on remet les grisés du mode défi.
document.addEventListener("DOMContentLoaded", () => {

    const container = document.getElementById("bets-container");

    if (!container) {
        return;
    }

    let pending = false;

    new MutationObserver(() => {

        if (!isDuelMode() || pending) {
            return;
        }

        pending = true;

        requestAnimationFrame(() => {

            pending = false;

            applyDuelBetStates();

        });

    }).observe(container, { childList: true });

});


// « ⚔️ Défier Yann · 120 € chacun »
function duelTicketGoText(name, amount, max) {

    return `⚔️ Défier ${escapeHtml(name)}${duelAmountValid(amount, max) ? ` · ${duelEuros(amount)} chacun` : ""}`;

}


async function sendDuelFromTicket(button) {

    const amount = Number(duelMode.amount);

    const error = document.querySelector("[data-duel-ticket-error]");

    button.disabled = true;

    const { error: rpcError } = await supabaseClient.rpc("duel_challenge", {
        p_group: currentGroup.id,
        p_opponent: duelMode.opponent.id,
        p_choice: duelMode.pick.choiceId,
        p_amount: amount
    });

    if (rpcError) {

        if (error) {
            error.textContent = rpcError.message || "Impossible pour le moment.";
        }

        button.disabled = false;

        return;

    }

    const name = duelMode.opponent.name;

    exitDuelMode();

    alertToast(`⚔️ Défi envoyé à <strong>${escapeHtml(name)}</strong> : ${duelEuros(amount)} chacun, il a 24 h pour répondre.`, { type: "joined" });

    await loadCurrentProfile();

    await refreshDuels();

    displayLeaderboard();

}


// Clics du mode défi : cotes des cartes, ticket rouge, sortie.
document.addEventListener("click", event => {

    if (!isDuelMode()) {
        return;
    }

    const target = event.target;

    if (target.closest("[data-duel-exit]")) {
        exitDuelMode();
        return;
    }

    // Une cote d'une carte de pari : elle devient mon choix pour le duel (mise simple).
    const choice = target.closest("#bets-container .bet-choice-button[data-choice-id]");

    if (choice && !choice.classList.contains("bet-choice-validate")) {

        event.preventDefault();

        event.stopPropagation();

        const card = choice.closest(".bet-card");

        if (card?.classList.contains("duel-off")) {
            return;
        }

        const bet = lastLoadedBets.find(item => item.id === (choice.dataset.betId || card?.dataset.betId));

        const picked = bet?.bet_choices?.find(item => item.id === choice.dataset.choiceId);

        if (!bet || !picked || duelBetBlocker(bet)) {
            return;
        }

        duelMode.pick = duelMode.pick?.choiceId === picked.id
            ? null
            : { betId: bet.id, choiceId: picked.id, label: picked.label, odds: picked.odds, question: bet.question };

        renderDuelPanel();

        renderDuelTicket();

        applyDuelBetStates();

        document.querySelector("[data-duel-stake]")?.focus({ preventScroll: true });

        return;

    }

    // Pendant le défi, un clic sur une carte n'ouvre pas son détail.
    if (target.closest("#bets-container .bet-card") && !target.closest("a, input")) {

        event.preventDefault();

        event.stopPropagation();

        return;

    }

    const chip = target.closest("[data-duel-chip]");

    if (chip) {

        duelMode.amount = chip.dataset.duelChip;

        renderDuelTicket();

        return;

    }

    const go = target.closest("[data-duel-ticket-go]");

    if (go && !go.disabled) {
        sendDuelFromTicket(go);
    }

}, true);


document.addEventListener("input", event => {

    if (!event.target.matches("[data-duel-stake]")) {
        return;
    }

    duelMode.amount = event.target.value;

    const amount = Number(duelMode.amount);

    const go = document.querySelector("[data-duel-ticket-go]");

    if (go) {
        go.disabled = !duelAmountValid(amount, duelMode.opponent.max);
        go.innerHTML = duelTicketGoText(duelMode.opponent.name, amount, duelMode.opponent.max);
    }

});


document.addEventListener("keydown", event => {

    if (!isDuelMode()) {
        return;
    }

    if (event.key === "Enter" && event.target.matches("[data-duel-stake]")) {

        const go = document.querySelector("[data-duel-ticket-go]");

        if (go && !go.disabled) {
            sendDuelFromTicket(go);
        }

        return;

    }

    // Échap : on quitte le défi (sauf si une fenêtre est ouverte par-dessus).
    if (event.key === "Escape" && !document.querySelector(".modal:not(.hidden)")) {
        exitDuelMode();
    }

});


/*
    Historique de mes défis (maquette demo-historique-defis.html) : lien
    « ⚔️ Mes défis » dans la section Groupe, fenêtre avec un petit bilan,
    filtres Tous / Envoyés / Reçus, et les défis regroupés par adversaire
    (score et barre ; un clic déplie la liste). Voir duels-historique.sql.
*/

let duelHistory = [];

let duelHistoryFilter = "all";

const duelHistoryOpen = new Set();

const DUEL_TAGS = {
    pending: ["pending", "⏳ En attente"],
    active: ["active", "⚔️ En cours"],
    won: ["won", "✅ Gagné"],
    lost: ["lost", "❌ Perdu"],
    refused: ["refused", "🚫 Refusé"],
    draw: ["draw", "🤝 Nul"],
    expired: ["draw", "⌛ Sans réponse"],
    cancelled: ["draw", "↩️ Annulé"]
};


// Gagné / perdu de mon point de vue (« won » veut dire que quelqu'un a gagné).
function duelOutcome(duel) {

    if (duel.status === "won") {
        return duel.i_won ? "won" : "lost";
    }

    return duel.status;

}


async function openDuelHistory() {

    const modal = document.getElementById("duel-history-modal");

    document.getElementById("duel-history-body").innerHTML = '<p class="duel-muted">Chargement…</p>';

    modal.classList.remove("hidden");

    const { data, error } = await supabaseClient.rpc("duel_history", { p_group: currentGroup.id });

    if (error) {
        document.getElementById("duel-history-body").innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`;
        return;
    }

    duelHistory = data || [];

    // Un défi reçu attend ma réponse : son adversaire est déplié pour voir « Répondre ».
    duelHistory
        .filter(duel => duel.status === "pending" && !duel.sent)
        .forEach(duel => duelHistoryOpen.add(duel.other));

    renderDuelHistory();

}


function renderDuelHistory() {

    const body = document.getElementById("duel-history-body");

    if (!body) {
        return;
    }

    const won = duelHistory.filter(duel => duelOutcome(duel) === "won").length;

    const lost = duelHistory.filter(duel => duelOutcome(duel) === "lost").length;

    const total = duelHistory.reduce((sum, duel) => sum + Number(duel.delta || 0), 0);

    const items = duelHistory.filter(duel =>
        duelHistoryFilter === "all" || (duelHistoryFilter === "sent" ? duel.sent : !duel.sent)
    );

    // Regroupés par adversaire, le plus récent en premier.
    const groups = [];

    items.forEach(duel => {

        let group = groups.find(item => item.name === duel.other);

        if (!group) {
            group = { name: duel.other, duels: [] };
            groups.push(group);
        }

        group.duels.push(duel);

    });

    const signed = value => (value > 0 ? "+" : value < 0 ? "−" : "") + duelEuros(Math.abs(Math.round(value)));

    body.innerHTML = `
        <h2>⚔️ Mes défis</h2>

        <div class="dh-stats">
            <div><b class="dh-plus">${won}</b><small>gagnés</small></div>
            <div><b class="dh-minus">${lost}</b><small>perdus</small></div>
            ${Math.round(total) ? `<div><b class="${total > 0 ? "dh-plus" : "dh-minus"}">${signed(total)}</b><small>bilan</small></div>` : ""}
        </div>

        <div class="dh-filters">
            ${[["all", "Tous"], ["sent", "Envoyés"], ["received", "Reçus"]].map(([key, label]) => `
                <button type="button" class="${duelHistoryFilter === key ? "on" : ""}" data-dh-filter="${key}">${label}</button>`).join("")}
        </div>

        ${!groups.length
            ? '<p class="duel-muted">Aucun défi pour l\'instant. Survole un joueur du classement et clique sur « ⚔️ Défier ».</p>'
            : `<div class="dh-list">
                ${groups.map(group => {

                    const wins = group.duels.filter(duel => duelOutcome(duel) === "won").length;

                    const losses = group.duels.filter(duel => duelOutcome(duel) === "lost").length;

                    const open = duelHistoryOpen.has(group.name);

                    return `
                        <div class="dh-opp${open ? " open" : ""}">
                            <button type="button" class="dh-opp-head" data-dh-opp="${escapeHtml(group.name)}">
                                <span class="duel-av dh-av" style="background: ${duelColor(group.name)}">${escapeHtml(group.name.charAt(0).toUpperCase())}</span>
                                <b>${escapeHtml(group.name)}</b>
                                <small>${group.duels.length} défi${group.duels.length > 1 ? "s" : ""}</small>
                                <span class="dh-score"><span class="dh-plus">${wins}</span> – <span class="dh-minus">${losses}</span></span>
                                <span class="dh-arrow">▾</span>
                            </button>
                            ${wins + losses
                                ? `<div class="dh-bar"><span class="w" style="flex: ${wins}"></span><span class="l" style="flex: ${losses}"></span></div>`
                                : ""}
                            ${open ? `
                                <div class="dh-duels">
                                    ${group.duels.map(duel => {

                                        const [kind, label] = DUEL_TAGS[duelOutcome(duel)] || DUEL_TAGS.draw;

                                        const delta = Number(duel.delta || 0);

                                        return `
                                            <div class="dh-duel">
                                                <span class="dh-dir">${duel.sent ? "→ Envoyé" : "← Reçu"}</span>
                                                <span class="dh-q" title="${escapeHtml(duel.question)}">${escapeHtml(duel.question)}${duel.my_pct ? ` · ${duel.my_pct} %` : duel.my_amount ? ` · ${duelEuros(duel.my_amount)}` : ""}${duel.coin ? ` · 🪙 ${duel.coin_me ? "gagné" : "perdu"}` : ""}</span>
                                                ${duel.status === "pending" && !duel.sent
                                                    ? `<button type="button" class="duel-strip-btn" data-duel-open="${duel.id}">Répondre</button>`
                                                    : `<span class="dh-tag dh-tag--${kind}">${label}</span>`}
                                                ${delta ? `<span class="dh-delta ${delta > 0 ? "dh-plus" : "dh-minus"}">${signed(delta)}</span>` : ""}
                                            </div>`;

                                    }).join("")}
                                </div>` : ""}
                        </div>`;

                }).join("")}
            </div>`}`;

}


function closeDuelHistory() {

    document.getElementById("duel-history-modal")?.classList.add("hidden");

}


document.addEventListener("click", event => {

    const target = event.target;

    if (target.closest("#duel-history-link")) {

        document.body.classList.remove("leaderboard-open");

        openDuelHistory();

        return;

    }

    if (!target.closest("#duel-history-modal")) {
        return;
    }

    if (target.closest("#close-duel-history") || target.id === "duel-history-modal") {
        closeDuelHistory();
        return;
    }

    const filter = target.closest("[data-dh-filter]");

    if (filter) {
        duelHistoryFilter = filter.dataset.dhFilter;
        renderDuelHistory();
        return;
    }

    const opponent = target.closest("[data-dh-opp]");

    if (opponent) {

        const name = opponent.dataset.dhOpp;

        if (duelHistoryOpen.has(name)) {
            duelHistoryOpen.delete(name);
        } else {
            duelHistoryOpen.add(name);
        }

        renderDuelHistory();

    }

});


document.addEventListener("keydown", event => {

    if (event.key === "Escape" && !document.getElementById("duel-history-modal")?.classList.contains("hidden")) {
        closeDuelHistory();
    }

});



/*
    Notifications de duel en face à face (maquette demo-notifs-duels.html,
    style B) : les deux ronds en VS avec leur choix, le gagnant couronné et
    le perdant grisé, le montant en gros, puis OK. Couleur selon le résultat :
    violet pour un défi ou un duel accepté, vert gagné, rouge perdu, gris
    pour une mise rendue. Confettis à la victoire, secousse à la défaite.
    Les messages arrivent de player_notices (checkPlayerNotices dans app.js,
    données posées par duels-notifications.sql), l'un après l'autre (1 / 3…).
*/

// tone : duel / win / lose / info ; winner : me / other / both-lost / none ;
// marks : ✓ ou ✗ sous [mon choix, son choix] ; total : montant des 2 mises.
const DUEL_NOTICE_KINDS = {
    duel_received: {
        tone: "duel", icon: "⚔️", tag: "Défi reçu", label: "chacun", noMine: true,
        title: n => `${n.other} te défie !`,
        text: n => `${n.other} te défie sur « <b class="dn-q">${n.question}</b> ».`,
        detail: () => "Tu as 24 h pour répondre."
    },
    duel_reminder: {
        tone: "duel", icon: "⏰", tag: "Plus que 2 h", label: "chacun", noMine: true,
        title: () => "Plus que 2 h pour répondre",
        text: n => `${n.other} attend ta réponse à son défi sur « <b class="dn-q">${n.question}</b> ».`,
        detail: () => "Sans réponse, le défi s'annule."
    },
    duel_accepted: {
        tone: "duel", icon: "🤝", tag: "Duel accepté", label: "en jeu", total: true,
        title: () => "Duel accepté !",
        text: n => `${n.other} a accepté ton duel sur « <b class="dn-q">${n.question}</b> ».`,
        detail: () => "Le gagnant prend tout."
    },
    duel_coin_win: {
        tone: "win", icon: "🪙", coin: true, tag: "Pile ou face", winner: "me", total: true,
        label: n => `pour toi si ${n.mine} gagne`,
        title: () => "Pile ou face gagné !",
        text: n => `${n.other} a accepté et a pris le même choix que toi (<b class="dn-c">${n.mine}</b>).`,
        detail: n => `Si « ${n.mine} » gagne, tu prends tout.`
    },
    duel_coin_lose: {
        tone: "lose", icon: "🪙", coin: true, tag: "Pile ou face", winner: "other", total: true,
        label: n => `pour ${n.other} si ${n.mine} gagne`,
        title: n => `${n.other} gagne le pile ou face`,
        text: n => `${n.other} a accepté et a pris le même choix que toi (<b class="dn-c">${n.mine}</b>).`,
        detail: n => `Si « ${n.mine} » gagne, il prend tout.`
    },
    duel_refused: {
        tone: "info", icon: "🚫", tag: "Défi refusé", sign: "+", label: "mise rendue", winner: "me",
        title: () => "Défi refusé",
        text: n => `${n.other} a refusé ton défi sur « <b class="dn-q">${n.question}</b> » (il perd 1 % de son solde).`,
        detail: () => "Ta mise t'a été rendue."
    },
    duel_expired: {
        tone: "info", icon: "⌛", tag: "Sans réponse", sign: "+", label: "mise rendue",
        title: () => "Défi expiré",
        text: n => `${n.other} n'a pas répondu à ton défi sur « <b class="dn-q">${n.question}</b> ».`,
        detail: () => "Ta mise t'a été rendue."
    },
    duel_cancelled: {
        tone: "info", icon: "↩️", tag: "Duel annulé", sign: "+", label: "mise rendue",
        title: () => "Duel annulé",
        text: n => `Le pari « <b class="dn-q">${n.question}</b> » a été annulé.`,
        detail: () => "Chacun récupère sa mise."
    },
    duel_won: {
        tone: "win", icon: "🏆", tag: "Victoire", result: "win", sign: "+", label: "gagnés", winner: "me", total: true, marks: ["✓", "✗"],
        title: () => "Duel gagné !",
        text: n => `Tu as battu ${n.other} sur « <b class="dn-q">${n.question}</b> ».`
    },
    duel_won_coin: {
        tone: "win", icon: "🏆", coin: true, tag: "Victoire au pile ou face", result: "win", sign: "+", label: "gagnés", winner: "me", total: true, marks: ["✓", "✓"],
        title: () => "Duel gagné !",
        text: n => `Vous aviez tous les deux raison sur « <b class="dn-q">${n.question}</b> »…`,
        detail: () => "…et tu avais gagné le pile ou face."
    },
    duel_lost: {
        tone: "lose", icon: "💀", tag: "Défaite", result: "lose", sign: "−", label: "perdus", winner: "other", marks: ["✗", "✓"],
        title: () => "Duel perdu",
        text: n => `${n.other} a gagné votre duel sur « <b class="dn-q">${n.question}</b> ».`
    },
    duel_lost_coin: {
        tone: "lose", icon: "🪙", coin: true, tag: "Défaite au pile ou face", result: "lose", sign: "−", label: "perdus", winner: "other", marks: ["✓", "✓"],
        title: () => "Duel perdu",
        text: n => `Vous aviez tous les deux raison sur « <b class="dn-q">${n.question}</b> »…`,
        detail: n => `…mais ${n.other} avait gagné le pile ou face.`
    },
    duel_lost_both: {
        tone: "lose", icon: "💥", tag: "Perdu pour tous les deux", result: "lose", sign: "−", label: "perdus", winner: "both-lost", marks: ["✗", "✗"],
        title: () => "Personne ne gagne",
        text: n => `Aucun de vous deux n'avait le bon choix sur « <b class="dn-q">${n.question}</b> ».`,
        detail: () => "Les 2 mises sont perdues."
    }
};


// Rond d'un joueur dans le face à face, avec son choix en dessous.
function duelNoticePlayerHtml(name, label, choice, state) {

    return `
        <div class="dn-player${state ? " dn-player--" + state : ""}">
            ${state === "won" ? '<span class="dn-crown">👑</span>' : ""}
            <span class="dn-av" style="background: ${duelColor(name)}">${escapeHtml(name.charAt(0).toUpperCase())}</span>
            <b>${escapeHtml(label)}</b>
            <span class="dn-choice">${choice}</span>
        </div>`;

}


// data : { kind, other, question, mine, theirs, amount } ; step : { index, total, last }.
function showDuelNotice(data, step, onOk) {

    const kind = DUEL_NOTICE_KINDS[data.kind];

    const modal = document.getElementById("duel-notice-modal");

    const body = document.getElementById("duel-notice-body");

    if (!kind || !modal || !body) {
        onOk();
        return;
    }

    // Textes déjà échappés pour les gabarits ci-dessus.
    const n = {
        other: escapeHtml(data.other || "?"),
        question: escapeHtml(data.question || ""),
        mine: escapeHtml(data.mine || "?"),
        theirs: escapeHtml(data.theirs || "?")
    };

    const pick = value => (typeof value === "function" ? value(n) : value);

    const marks = kind.marks || ["", ""];

    const mineChoice = kind.noMine ? "?" : data.mine ? `${n.mine} ${marks[0]}` : "—";

    const theirsChoice = data.theirs ? `${n.theirs} ${marks[1]}` : "—";

    const meState = kind.winner === "me" ? "won" : ["other", "both-lost"].includes(kind.winner) ? "lost" : "";

    const otherState = kind.winner === "other" ? "won" : ["me", "both-lost"].includes(kind.winner) ? "lost" : "";

    const amount = Number(data.amount || 0) * (kind.total ? 2 : 1);

    const detail = kind.detail ? kind.detail(n) : "";

    const center = kind.coin ? '<span class="dn-coin">🪙</span>' : "VS";

    body.innerHTML = `
        ${step.total > 1 ? `<span class="dn-counter">${step.index} / ${step.total}</span>` : ""}
        <div class="modal-content dn-card dn--${kind.tone}">
            <span class="dn-tag">${kind.icon} ${kind.tag}</span>
            <h2>${pick(kind.title)}</h2>
            <div class="dn-vs">
                ${duelNoticePlayerHtml(currentProfile?.username || "?", "Toi", mineChoice, meState)}
                <span class="dn-vs-t">${center}</span>
                ${duelNoticePlayerHtml(data.other || "?", data.other || "?", theirsChoice, otherState)}
            </div>
            <p class="dn-text">${kind.text(n)}${detail ? `<br>${detail}` : ""}</p>
            <span class="dn-amount">${kind.sign || ""}${duelEuros(amount)}</span>
            <span class="dn-amount-label">${pick(kind.label)}</span>
            <button type="button" class="dn-ok" data-duel-notice-ok>${step.last ? "OK" : "Suivant →"}</button>
        </div>`;

    modal.classList.remove("hidden");

    const card = body.querySelector(".dn-card");

    if (kind.result === "win") {
        card.classList.add("dn-glow");
        duelConfetti();
    }

    if (kind.result === "lose") {
        card.classList.add("dn-shake");
    }

    const ok = body.querySelector("[data-duel-notice-ok]");

    ok.onclick = async () => {

        ok.disabled = true;

        modal.classList.add("hidden");

        document.querySelectorAll(".dn-confetti").forEach(piece => piece.remove());

        await onOk();

    };

}


// Pluie de confettis pour un duel gagné.
function duelConfetti() {

    const colors = ["#63d69f", "#ffd36b", "#6c63ff", "#ff6bd5", "#4fc3ff"];

    for (let i = 0; i < 70; i++) {

        const piece = document.createElement("span");

        piece.className = "dn-confetti";

        piece.style.left = Math.random() * 100 + "vw";

        piece.style.background = colors[i % colors.length];

        piece.style.animationDuration = 1.8 + Math.random() * 1.6 + "s";

        piece.style.animationDelay = Math.random() * 0.5 + "s";

        document.body.appendChild(piece);

        setTimeout(() => piece.remove(), 4200);

    }

}


// Rappel « Plus que 2 h pour répondre » d'un défi reçu, une seule fois par défi
// (gardé dans ce navigateur), quand aucune autre fenêtre n'est ouverte.
function remindPendingDuel() {

    const soon = myDuels.find(duel =>
        duel.incoming && duel.status === "pending" &&
        new Date(duel.expires_at) - Date.now() < 2 * 3600000
    );

    if (!soon || document.querySelector(".modal:not(.hidden)")) {
        return;
    }

    const key = "duel-reminder-" + soon.id;

    try {
        if (localStorage.getItem(key)) {
            return;
        }
        localStorage.setItem(key, "1");
    } catch (error) {
        // Stockage indisponible : rappel quand même, sans mémoire.
    }

    showDuelNotice(
        {
            kind: "duel_reminder",
            other: soon.challenger,
            question: soon.question,
            theirs: soon.challenger_label,
            amount: soon.amount
        },
        { index: 1, total: 1, last: true },
        () => {}
    );

}
