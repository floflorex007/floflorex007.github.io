/* =========================================================
   BETLAB
   Version Supabase
========================================================= */


/* =========================================================
   1. CONFIGURATION SUPABASE
========================================================= */

/*
    REMPLACE CES DEUX VALEURS PAR CELLES DE TON PROJET SUPABASE.

    Supabase Dashboard
    → Project Settings
    → API
*/

const SUPABASE_URL = "https://cfufqznzrcvhmpxtohlj.supabase.co";

const SUPABASE_KEY = "sb_publishable_GwBhnTBPzOMsp3Yh2Q3jfg_hAoBMgiv";


const supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);



/* =========================================================
   2. VARIABLES GLOBALES
========================================================= */

let currentUser = null;

let currentProfile = null;

let currentBet = null;

let currentChoice = null;

let currentResolveBet = null;

let currentAnnouncementId = null;



/* =========================================================
   3. UTILITAIRES
========================================================= */

function formatMoney(value) {

    return Number(value).toLocaleString(
        "fr-FR",
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }
    ) + " €";

}



function formatDeadline(value) {

    if (!value) {

        return null;

    }

    const date =
        new Date(value);

    return date.toLocaleDateString(
        "fr-FR",
        {
            day: "2-digit",
            month: "2-digit"
        }
    )
        + " à "
        + date.toLocaleTimeString(
            "fr-FR",
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        );

}



/* =========================================================
   4. AUTHENTIFICATION
========================================================= */

/*
    L'interface demande un "identifiant".

    Supabase Auth fonctionne avec un email.

    Pour garder exactement ton interface actuelle,
    on transforme donc :

        Florian

    en :

        florian@betlab.local

    L'utilisateur ne voit jamais cette adresse.
*/


function usernameToEmail(username) {

    return username
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        + "@betlab.test";

}



/* =========================================================
   INSCRIPTION
========================================================= */

async function registerUser(username, password) {

    username = username.trim();


    if (username.length < 3) {

        throw new Error(
            "L'identifiant doit contenir au moins 3 caractères."
        );

    }


    if (password.length < 4) {

        throw new Error(
            "Le mot de passe doit contenir au moins 4 caractères."
        );

    }


    const email = usernameToEmail(username);


    /*
        Vérification préalable du username.
    */

    const {
        data: existingProfile,
        error: profileError
    } = await supabaseClient
        .from("profiles")
        .select("id")
        .eq("username", username)
        .maybeSingle();


    if (profileError) {

        throw profileError;

    }


    if (existingProfile) {

        throw new Error(
            "Cet identifiant est déjà utilisé."
        );

    }


    /*
        Création du compte Supabase Auth.
    */

    const {
        data,
        error
    } = await supabaseClient.auth.signUp({

        email: email,

        password: password,

        options: {
            data: {
                username: username
            }
        }

    });


    if (error) {

        throw error;

    }


    /*
        Si Supabase demande une confirmation email,
        il n'y aura pas de session immédiatement.
    */

    if (!data.session) {

        throw new Error(
            "Compte créé. Si la confirmation email est activée dans Supabase, désactive-la dans Authentication → Providers → Email pour cette maquette."
        );

    }


    currentUser = data.user;


    await loadCurrentProfile();

}



/* =========================================================
   CONNEXION
========================================================= */

async function loginUser(username, password) {

    username = username.trim();


    const email = usernameToEmail(username);


    const {
        data,
        error
    } = await supabaseClient.auth.signInWithPassword({

        email: email,

        password: password

    });


    if (error) {

        throw new Error(
            "Identifiant ou mot de passe incorrect."
        );

    }


    currentUser = data.user;


    await loadCurrentProfile();

}



/* =========================================================
   CHARGER LE PROFIL
========================================================= */

async function loadCurrentProfile() {

    if (!currentUser) {

        throw new Error(
            "Utilisateur non connecté."
        );

    }


    const {
        data,
        error
    } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", currentUser.id)
        .single();


    if (error) {

        throw error;

    }


    currentProfile = data;


    updateBalance();

}



/* =========================================================
   SOLDE
========================================================= */

function updateBalance() {

    const balanceElement =
        document.getElementById("balance");


    if (!balanceElement) {

        return;

    }


    if (!currentProfile) {

        balanceElement.textContent =
            formatMoney(0);

        return;

    }


    /*
        L'administrateur a un solde et des points illimités
        (voir animations.sql) : on affiche ∞.
    */

    balanceElement.textContent =
        currentProfile.is_admin
            ? "∞ €"
            : formatMoney(currentProfile.balance);


    /*
        L'onglet Profil affiche le pseudo du joueur.
    */

    const profileButton =
        document.getElementById("profile-nav-button");

    if (profileButton) {

        profileButton.textContent =
            "👤 " + currentProfile.username;

    }


    const pointsElement =
        document.getElementById("points-balance");

    if (pointsElement) {

        pointsElement.textContent =
            currentProfile.is_admin
                ? "∞ pts"
                : (currentProfile.points || 0) + " pts";

    }

}



/* =========================================================
   CLASSEMENT DES MEILLEURS PARIEURS
========================================================= */

async function getLeaderboard() {

    const {
        data,
        error
    } = await supabaseClient
        .from("profiles")
        .select("username, balance, gold_frame_until, name_color_until, cosmetics")
        .eq("is_admin", false)
        .order("balance", { ascending: false })
        .limit(10);


    if (error) {
        console.error("Erreur getLeaderboard :", error);
        throw error;
    }


    return data || [];

}


/*
    Pseudo arc-en-ciel (avantage « Pseudo en couleur ») :
    chaque lettre est décalée dans le temps
    pour créer une vague de couleurs et de mouvement.
*/

function rainbowName(username) {

    return Array.from(username).map(
        (letter, index) => `<span class="rainbow-letter" style="animation-delay: ${-index * 0.12}s">${letter === " " ? "&nbsp;" : escapeHtml(letter)}</span>`
    ).join("");

}


/*
    Pseudo avec les avantages de la boutique
    (cadre doré, arc-en-ciel), utilisé dans les cartes,
    les mises et le fil en direct.
    Pour soi-même, on passe par hasMyReward (aperçu admin).
*/

/*
    Tous les effets de boutique actifs d'un joueur.
    Pour soi-même, on passe par l'aperçu admin (hasMyReward / hasMyCosmetic).
*/

function getEffects(profile) {

    const isMe =
        currentProfile && profile.username === currentProfile.username;

    const active = id => isMe
        ? hasMyCosmetic(id)
        : isRewardActive(profile.cosmetics?.[id]?.until) && !profile.cosmetics?.[id]?.off;

    const option = id => {

        const fallback =
            COSMETICS.find(c => c.id === id)?.options?.[0] || null;

        return (isMe ? myCosmeticOption(id) : profile.cosmetics?.[id]?.option) || fallback;

    };

    // Un seul métal affiché : le plus prestigieux.
    const metal =
        ["or", "argent", "bronze", "rose"].find(m => active("metal_" + m)) || null;

    return {
        gold: isMe ? hasMyReward("gold_frame_until") : isRewardActive(profile.gold_frame_until) && !profile.cosmetics?.cadre?.off,
        rainbow: isMe ? hasMyReward("name_color_until") : isRewardActive(profile.name_color_until) && !profile.cosmetics?.couleur?.off,
        metal,
        neon: active("neon") ? option("neon") : null,
        emoji: active("emoji") ? option("emoji") : null,
        title: active("titre") ? option("titre") : null,
        sparkle: active("etincelles"),
        aura: active("aura"),
        theme: active("theme") ? option("theme") : null
    };

}


/*
    Pseudo avec ses effets (couleur, emoji, titre, étincelles).
    Priorité de la couleur : métal > arc-en-ciel > néon.
*/

function nameHtml(profile, effects = getEffects(profile)) {

    let name;

    if (effects.metal) {
        name = `<span class="name-metal metal-${effects.metal}">${escapeHtml(profile.username)}</span>`;
    } else if (effects.rainbow) {
        name = `<span class="pseudo-color">${rainbowName(profile.username)}</span>`;
    } else if (effects.neon) {
        name = `<span class="name-neon neon-${effects.neon}">${escapeHtml(profile.username)}</span>`;
    } else {
        name = escapeHtml(profile.username);
    }


    if (effects.sparkle) {
        name = `<span class="name-sparkle">${name}<i>✦</i><i>✦</i><i>✦</i><i>✦</i></span>`;
    }

    if (effects.emoji) {
        name += ` <span class="name-emoji">${escapeHtml(effects.emoji)}</span>`;
    }

    if (effects.title) {
        name += ` <span class="name-title">${escapeHtml(effects.title)}</span>`;
    }

    return name;

}


function styledName(profile, fallback = "Utilisateur") {

    if (!profile?.username) {
        return escapeHtml(fallback);
    }

    const effects =
        getEffects(profile);

    return `<span class="user-name${effects.gold ? " name-gold" : ""}">${nameHtml(profile, effects)}</span>`;

}


/*
    Ligne du classement (joueur classé ou admin épinglé).
*/

function leaderboardRowHtml(profile, { rank, medal, balance, extraClass = "", effects: forcedEffects = null }) {

    const effects =
        forcedEffects || getEffects(profile);

    const hasEffect =
        effects.metal || effects.rainbow || effects.neon || effects.sparkle || effects.emoji || effects.title;

    return `
        <div class="leaderboard-row${extraClass}${effects.gold ? " leaderboard-row--gold" : ""}${effects.aura ? " leaderboard-row--aura" : ""}">
            <span class="leaderboard-rank">${rank}</span>
            <span class="leaderboard-medal">${medal}</span>
            <span class="leaderboard-pseudo${hasEffect ? " has-effect" : ""}">${nameHtml(profile, effects)}</span>
            <span class="leaderboard-balance">${balance}</span>
        </div>
    `;

}


async function displayLeaderboard() {

    const container =
        document.getElementById("leaderboard-list");


    if (!container) {
        return;
    }


    try {

        const profiles =
            await getLeaderboard();

        const medals =
            ["🥇", "🥈", "🥉"];

        /*
            L'admin n'est jamais classé : seul lui voit
            sa propre ligne, épinglée en haut, sans rang.
        */

        const adminRow =
            currentProfile?.is_admin
                ? leaderboardRowHtml(
                    currentProfile,
                    { rank: "—", medal: "👑", balance: "∞", extraClass: " leaderboard-row--admin" }
                )
                : "";


        container.innerHTML = adminRow + profiles.map(
            (profile, index) => leaderboardRowHtml(
                profile,
                { rank: index + 1, medal: medals[index] || "", balance: formatMoney(profile.balance) }
            )
        ).join("");


        animateLeaderboard(profiles);

    } catch (error) {

        console.error(error);

        container.innerHTML = `<p class="error-message">Impossible de charger le classement.</p>`;

    }

}



/* =========================================================
   MESSAGES ADMIN
========================================================= */

async function displayAdminMessage() {

    const sidebar =
        document.getElementById("admin-message-sidebar");

    const content =
        document.getElementById("admin-message-content");


    if (!sidebar || !content) {
        return;
    }


    const {
        data,
        error
    } = await supabaseClient
        .from("admin_messages")
        .select("content")
        .eq("type", "permanent")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();


    if (error) {

        console.error("Erreur displayAdminMessage :", error);

        return;

    }


    const permanentInput =
        document.getElementById("permanent-message-input");


    if (!data) {

        sidebar.classList.add("hidden");

        return;

    }


    content.textContent =
        data.content;

    sidebar.classList.remove("hidden");


    if (permanentInput) {

        permanentInput.value =
            data.content;

    }

}


async function checkAnnouncementPopup() {

    const {
        data: message,
        error
    } = await supabaseClient
        .from("admin_messages")
        .select("id, content")
        .eq("type", "popup")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();


    if (error) {

        console.error("Erreur checkAnnouncementPopup :", error);

        return;

    }


    if (!message) {
        return;
    }


    const {
        data: read,
        error: readError
    } = await supabaseClient
        .from("message_reads")
        .select("message_id")
        .eq("message_id", message.id)
        .eq("user_id", currentUser.id)
        .maybeSingle();


    if (readError) {

        console.error("Erreur checkAnnouncementPopup :", readError);

        return;

    }


    if (read) {
        return;
    }


    currentAnnouncementId =
        message.id;

    document.getElementById(
        "announcement-content"
    ).textContent =
        message.content;

    document
        .getElementById("announcement-modal")
        .classList.remove("hidden");

}


async function markAnnouncementAsSeen(messageId) {

    if (!messageId) {
        return;
    }

    await supabaseClient
        .from("message_reads")
        .insert({
            message_id: messageId,
            user_id: currentUser.id
        });

    currentAnnouncementId = null;

}


async function createPopupMessage() {

    const input =
        document.getElementById("popup-message-input");

    const content =
        input.value.trim();

    const errorElement =
        document.getElementById("popup-message-error");

    errorElement.textContent = "";


    if (!content) {
        return;
    }


    try {

        const { error } = await supabaseClient
            .from("admin_messages")
            .insert({
                type: "popup",
                content: content,
                created_by: currentUser.id
            });


        if (error) {
            throw error;
        }


        input.value = "";

        await displayPopupHistory();

    } catch (error) {

        console.error(error);

        errorElement.textContent =
            error.message || "Impossible d'envoyer le message.";

    }

}


async function displayPopupHistory() {

    const container =
        document.getElementById("popup-history-list");


    if (!container) {
        return;
    }


    try {

        const {
            data,
            error
        } = await supabaseClient
            .from("admin_messages")
            .select("content, created_at")
            .eq("type", "popup")
            .order("created_at", { ascending: false });


        if (error) {
            throw error;
        }


        if (!data || data.length === 0) {

            container.innerHTML = `
                <div class="empty-state">
                    Aucun popup envoyé pour le moment.
                </div>
            `;

            return;

        }


        container.innerHTML = data.map(
            message => `
                <div class="stake-row">
                    <div class="stake-row-header">
                        <span>${formatDeadline(message.created_at)}</span>
                    </div>
                    <p>${escapeHtml(message.content)}</p>
                </div>
            `
        ).join("");

    } catch (error) {

        console.error(error);

        container.innerHTML = `<p class="error-message">Impossible de charger l'historique.</p>`;

    }

}


async function savePermanentMessage() {

    const input =
        document.getElementById("permanent-message-input");

    const content =
        input.value.trim();

    const errorElement =
        document.getElementById("permanent-message-error");

    errorElement.textContent = "";


    if (!content) {
        return;
    }


    try {

        const { error } = await supabaseClient
            .from("admin_messages")
            .insert({
                type: "permanent",
                content: content,
                created_by: currentUser.id
            });


        if (error) {
            throw error;
        }


        await displayAdminMessage();

    } catch (error) {

        console.error(error);

        errorElement.textContent =
            error.message || "Impossible d'enregistrer le message.";

    }

}



/* =========================================================
   5. CHARGER LES PARIS
========================================================= */

async function getBets() {
    const { data, error } = await supabaseClient
        .from("bets")
        .select(`
            *,
            bet_choices!bet_choices_bet_id_fkey (*),
            profiles!bets_author_id_fkey ( username, gold_frame_until, name_color_until, cosmetics ),
            target:profiles!bets_target_user_id_fkey ( username, gold_frame_until, name_color_until, cosmetics ),
            stakes ( id, user_id, choice_id, stake, potential_win, profiles!stakes_user_id_fkey ( username, gold_frame_until, name_color_until, cosmetics ) )
        `)
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Erreur getBets :", error);
        throw error;
    }

    return data || [];
}



/* =========================================================
   AFFICHER LES PARIS
========================================================= */

/*
    Vrai si l'utilisateur connecté est la personne concernée
    par le pari et que le créateur l'a bloquée.
*/

/*
    Vrai si le pari a été créé aujourd'hui (jour calendaire local).
*/

function isCreatedToday(createdAt) {

    if (!createdAt) {

        return false;

    }

    return new Date(createdAt).toDateString() ===
        new Date().toDateString();

}



function isBlockedTarget(bet) {

    return Boolean(
        bet.target_blocked &&
        bet.target_user_id &&
        currentUser &&
        bet.target_user_id === currentUser.id
    );

}



function renderBetSummaryHtml(
    bet,
    {
        interactive = true
    } = {}
) {


    const choices =
        bet.bet_choices || [];


    const totalStaked =
        (bet.stakes || []).reduce(
            (sum, s) => sum + Number(s.stake),
            0
        );


    const isTargetBlocked =
        isBlockedTarget(bet);


    const myChoiceIds =
        (bet.stakes || [])
            .filter(
                s => currentUser && s.user_id === currentUser.id
            )
            .map(s => s.choice_id);


    const isClosed =
        bet.deadline_at &&
        new Date(bet.deadline_at) < new Date();


    const deadlineLabel =
        formatDeadline(bet.deadline_at) ||
        "—";


    const stakesByChoice =
        choices.map(
            choice => {

                const choiceStakes =
                    (bet.stakes || []).filter(
                        s => s.choice_id === choice.id
                    );

                return {
                    choice,
                    count: choiceStakes.length,
                    amount: choiceStakes.reduce(
                        (sum, s) => sum + Number(s.stake),
                        0
                    )
                };

            }
        );


    const maxCount =
        Math.max(
            0,
            ...stakesByChoice.map(s => s.count)
        );


    return `

        <div class="bet-card-header">

            <span>🏆</span>

            <span class="bet-author">
                Créé par ${styledName(bet.profiles)}
            </span>

        </div>


        <div class="bet-question-row">

            <span class="bet-question-icon">🎲</span>

            <h3>
                ${escapeHtml(bet.question)}
            </h3>

            <span class="bet-deadline">
                ${escapeHtml(deadlineLabel)}
            </span>

        </div>




        <div class="bet-choices">

            ${stakesByChoice.map(
                ({ choice, count, amount }) => {

                    const pct =
                        totalStaked > 0
                            ? Math.round((amount / totalStaked) * 100)
                            : 0;

                    const showBadge =
                        maxCount > 0 &&
                        count === maxCount;

                    const tag =
                        interactive
                            ? "button"
                            : "div";

                    return `

                        <div class="bet-choice-wrapper">

                            ${showBadge
                                ? `<span class="choice-badge">${count}</span>`
                                : ""
                            }

                            <${tag}
                                class="bet-choice-button${isClosed || isTargetBlocked ? " bet-choice-closed" : ""}${myChoiceIds.includes(choice.id) ? " bet-choice-picked" : ""}${interactive ? "" : " bet-choice-readonly"}"
                                ${interactive
                                    ? `data-bet-id="${bet.id}" data-choice-id="${choice.id}" ${isClosed || isTargetBlocked ? "disabled" : ""}`
                                    : ""
                                }
                            >

                                <span>
                                    ${escapeHtml(choice.label)}
                                </span>

                                <strong>
                                    ${Number(choice.odds).toFixed(2)}
                                </strong>

                            </${tag}>

                            ${isTargetBlocked
                                ? ""
                                : isClosed
                                ? `<div class="choice-closed-label">Mises closes</div>`
                                : `
                                    <div class="choice-bar-track">
                                        <div class="choice-bar-fill" style="width:${pct}%"></div>
                                    </div>
                                    <div class="choice-pct">${pct}%</div>
                                `
                            }

                        </div>

                    `;

                }
            ).join("")}

        </div>

    `;

}



async function displayBets() {

    const container =
        document.getElementById("bets-container");


    if (!container) {

        return;

    }


    container.innerHTML =
        "<p>Chargement des paris...</p>";


    try {

        const bets = await getBets();


        container.innerHTML = "";


        const openBets =
            bets.filter(
                bet => bet.status === "open"
            );


        if (openBets.length === 0) {

            container.innerHTML = `
                <div class="empty-state">
                    Aucun pari disponible pour le moment.
                </div>
            `;

            return;

        }


        openBets.forEach(
            bet => {

                const card =
                    document.createElement("div");

                card.className =
                    "bet-card" +
                    (isBlockedTarget(bet) ? " bet-card-locked" : "") +
                    (isCreatedToday(bet.created_at) ? " bet-card-new" : "");


                /*
                    Thème de carte acheté par le créateur.
                */

                const authorTheme =
                    bet.profiles?.username
                        ? getEffects(bet.profiles).theme
                        : null;

                if (authorTheme) {

                    card.className +=
                        " bet-card-theme bet-theme-" + authorTheme;

                }

                card.dataset.betId =
                    bet.id;

                if (bet.deadline_at) {

                    card.dataset.deadline =
                        bet.deadline_at;

                }


                const totalStaked =
                    (bet.stakes || []).reduce(
                        (sum, s) => sum + Number(s.stake),
                        0
                    );


                card.innerHTML =
                    (isCreatedToday(bet.created_at)
                        ? `<span class="bet-new-badge">AUJOURD'HUI</span>`
                        : "") +
                    renderBetSummaryHtml(bet) + `

                    <div class="bet-footer">

                        ${bet.target_user_id
                            ? `<span class="bet-target-footer">🎯 ${bet.target_blocked ? "Bloqué pour" : "Concerne"} ${styledName(bet.target, "un parieur")}</span>`
                            : ""
                        }

                        <div class="bet-total-footer">
                            <span>Solde misé</span>
                            <strong>${formatMoney(totalStaked)}</strong>
                        </div>

                    </div>

                `;


                container.appendChild(card);

            }
        );


        /*
            Ajout des événements sur les choix.
        */

        document
            .querySelectorAll(".bet-choice-button")
            .forEach(button => {

                button.addEventListener(
                    "click",
                    () => {

                        const betId =
                            button.dataset.betId;

                        const choiceId =
                            button.dataset.choiceId;


                        const bet =
                            openBets.find(
                                item =>
                                    item.id === betId
                            );


                        const choice =
                            bet.bet_choices.find(
                                item =>
                                    item.id === choiceId
                            );


                        /*
                            Petit délai pour laisser
                            l'onde du clic s'afficher.
                        */

                        setTimeout(
                            () => openBetModal(
                                bet,
                                choice
                            ),
                            220
                        );

                    }
                );

            });


        updateCountdowns();


        /*
            Ajout des événements sur la carte
            (ouvre le détail des parieurs en focus,
            sauf si on clique sur un bouton de choix).
        */

        document
            .querySelectorAll(".bet-card")
            .forEach(card => {

                card.addEventListener(
                    "click",
                    event => {

                        if (
                            event.target.closest(
                                ".bet-choice-button"
                            )
                        ) {

                            return;

                        }


                        const betId =
                            card.dataset.betId;


                        const bet =
                            openBets.find(
                                item =>
                                    item.id === betId
                            );


                        openStakesModal(bet);

                    }
                );

            });


    } catch (error) {

        console.error(error);


        container.innerHTML = `
            <p class="error-message">
                Impossible de charger les paris.
            </p>
        `;

    }

}



/* =========================================================
   6. MODAL PARI
========================================================= */

function openBetModal(
    bet,
    choice
) {

    currentBet = bet;

    currentChoice = choice;


    document.getElementById(
        "modal-question"
    ).textContent =
        bet.question;


    document.getElementById(
        "modal-author"
    ).innerHTML =
        `Créé par ${styledName(bet.profiles)}`;


    document.getElementById(
        "modal-choice"
    ).textContent =
        `${choice.label} — cote ${Number(choice.odds).toFixed(2)}`;


    document.getElementById(
        "stake-input"
    ).value = "";


    const potentialWinElement =
        document.getElementById("potential-win");

    potentialWinElement.textContent =
        formatMoney(0);

    potentialWinElement._lastValue = 0;


    document.getElementById(
        "modal-error"
    ).textContent = "";


    document
        .getElementById("bet-modal")
        .classList.remove("hidden");

}



/* =========================================================
   CALCUL DU GAIN POTENTIEL
========================================================= */

function updatePotentialWin() {

    const input =
        document.getElementById(
            "stake-input"
        );


    const value =
        Number(input.value);


    if (
        !currentChoice ||
        !value ||
        value <= 0
    ) {

        animatePotentialWin(0);

        return;

    }


    const potentialWin =
        value *
        Number(currentChoice.odds);


    animatePotentialWin(potentialWin);

}



/* =========================================================
   PLACER LE PARI
========================================================= */

async function placeBet() {

    if (!currentChoice) {

        return;

    }


    const input =
        document.getElementById(
            "stake-input"
        );


    const errorElement =
        document.getElementById(
            "modal-error"
        );


    const stake =
        Number(input.value);


    errorElement.textContent = "";


    if (currentBet && isBlockedTarget(currentBet)) {

        errorElement.textContent =
            "Tu es concerné(e) par ce pari, tu ne peux pas parier.";

        return;

    }


    if (!stake || stake <= 0) {

        errorElement.textContent =
            "Entre un montant valide.";

        return;

    }


    try {

        /*
            Le calcul du solde et la création
            de la mise sont réalisés côté PostgreSQL.

            Cela évite de modifier directement
            le solde depuis le navigateur.
        */

        const {
            data,
            error
        } = await supabaseClient.rpc(
            "place_bet",
            {
                p_choice_id:
                    currentChoice.id,

                p_stake:
                    stake
            }
        );


        if (error) {

            throw error;

        }


        console.log(
            "Pari créé :",
            data
        );


        /*
            On recharge le profil.
        */

        await loadCurrentProfile();


        /*
            On ferme la fenêtre.
        */

        document
            .getElementById("bet-modal")
            .classList.add("hidden");


        /*
            On recharge les paris et l'historique.
        */

        await displayBets();

        await displayLeaderboard();

        await displayMyBets();

        await refreshMissions();



    } catch (error) {

        console.error(error);


        errorElement.textContent =
            error.message ||
            "Impossible de placer le pari.";

    }

}



/* =========================================================
   7. MES PARIS
========================================================= */

// Filtre actif de l'onglet « Mes paris » : all, open, win ou lose.
let myBetsFilter = "all";


async function displayMyBets() {

    const container =
        document.getElementById(
            "my-bets-container"
        );


    if (!container || !currentUser) {

        return;

    }


    container.innerHTML =
        "<p>Chargement...</p>";


    try {

        const {
            data,
            error
        } = await supabaseClient
            .from("stakes")
            .select(`
                id,
                bet_id,
                choice_id,
                stake,
                potential_win,
                created_at,
                bets (
                    id,
                    question,
                    status,
                    winner_choice_id
                ),
                bet_choices (
                    id,
                    label,
                    odds
                )
            `)
            .eq(
                "user_id",
                currentUser.id
            )
            .order(
                "created_at",
                {
                    ascending: false
                }
            );


        if (error) {

            throw error;

        }


        container.innerHTML = "";


        if (!data || data.length === 0) {

            container.innerHTML = `
                <div class="empty-state">
                    Tu n'as encore placé aucun pari.
                </div>
            `;

            return;

        }


        /*
            Statut de chaque mise : en cours, gagné ou perdu.
        */

        const stakes =
            data.map(stake => ({
                ...stake,
                result:
                    stake.bets.status !== "resolved" ? "open"
                    : stake.bets.winner_choice_id === stake.bet_choices.id ? "win"
                    : "lose"
            }));

        const countOf = result =>
            stakes.filter(s => result === "all" || s.result === result).length;

        const totalStaked =
            stakes.reduce((sum, s) => sum + Number(s.stake), 0);

        const totalWon =
            stakes
                .filter(s => s.result === "win")
                .reduce((sum, s) => sum + Number(s.potential_win), 0);


        /*
            Mini bilan + filtres.
        */

        container.innerHTML = `

            <div class="my-bets-summary">

                <div>
                    <span>Gagnés</span>
                    <b class="text-win">${countOf("win")} / ${countOf("win") + countOf("lose")}</b>
                </div>

                <div>
                    <span>Total misé</span>
                    <b>${formatMoney(totalStaked)}</b>
                </div>

                <div>
                    <span>Total gagné</span>
                    <b class="text-win">${formatMoney(totalWon)}</b>
                </div>

            </div>


            <div class="my-bets-filters">

                ${[
                    ["all", "Tous"],
                    ["open", "En cours"],
                    ["win", "Gagnés"],
                    ["lose", "Perdus"]
                ].map(([key, label]) => `
                    <button
                        class="my-bets-filter${myBetsFilter === key ? " active" : ""}"
                        data-filter="${key}"
                    >
                        ${label}<span>${countOf(key)}</span>
                    </button>
                `).join("")}

            </div>


            <div class="my-bets-rows"></div>

        `;


        const rows =
            container.querySelector(".my-bets-rows");


        stakes.forEach(
            stake => {

                const bet =
                    stake.bets;

                const choice =
                    stake.bet_choices;


                const item =
                    document.createElement("div");

                item.className =
                    "my-bet-item my-bet-row my-bet-row--" + stake.result +
                    (stake.result === "win" ? " my-bet-won" : "") +
                    (stake.result === "lose" ? " my-bet-lost" : "");

                item.dataset.result =
                    stake.result;


                const icon =
                    stake.result === "win" ? "✓"
                    : stake.result === "lose" ? "✗"
                    : "⏳";

                const amount =
                    stake.result === "win" ? "+" + formatMoney(stake.potential_win)
                    : stake.result === "lose" ? "−" + formatMoney(stake.stake)
                    : formatMoney(stake.potential_win);


                item.innerHTML = `

                    <span class="my-bet-dot">${icon}</span>

                    <div class="my-bet-text">

                        <h3>${escapeHtml(bet.question)}</h3>

                        <p>
                            ${escapeHtml(choice.label)}
                            · ${Number(choice.odds).toFixed(2)}
                            · mise ${formatMoney(stake.stake)}
                        </p>

                    </div>

                    <span class="my-bet-amount">${amount}</span>

                `;


                rows.appendChild(item);

            }
        );


        /*
            Filtres (le choix est gardé entre deux rechargements de la liste).
        */

        const applyFilter = () => {

            container
                .querySelectorAll(".my-bets-filter")
                .forEach(button => button.classList.toggle("active", button.dataset.filter === myBetsFilter));

            rows
                .querySelectorAll(".my-bet-row")
                .forEach(row => row.classList.toggle(
                    "hidden",
                    myBetsFilter !== "all" && row.dataset.result !== myBetsFilter
                ));

        };

        container
            .querySelectorAll(".my-bets-filter")
            .forEach(button => {

                button.addEventListener("click", () => {

                    myBetsFilter = button.dataset.filter;

                    applyFilter();

                });

            });

        applyFilter();



    } catch (error) {

        console.error(error);


        container.innerHTML = `
            <p class="error-message">
                Impossible de charger tes paris.
            </p>
        `;

    }

}



/* =========================================================
   8. MES CRÉATIONS
========================================================= */

async function displayMyCreatedBets() {

    const container =
        document.getElementById(
            "my-created-bets-container"
        );


    if (!container || !currentUser) {

        return;

    }


    container.innerHTML =
        "<p>Chargement...</p>";


    try {

        const {
            data,
            error
        } = await supabaseClient
            .from("bets")
            .select(`
                id,
                question,
                status,
                created_at,
                winner_choice_id,
                deadline_at,
                bet_choices!bet_choices_bet_id_fkey (
                    id,
                    label,
                    odds
                )
            `)
            .eq(
                "author_id",
                currentUser.id
            )
            .order(
                "created_at",
                {
                    ascending: false
                }
            );


        if (error) {

            throw error;

        }


        container.innerHTML = "";


        if (!data || data.length === 0) {

            container.innerHTML = `
                <div class="empty-state">
                    Tu n'as créé aucun pari.
                </div>
            `;

            return;

        }


        data.forEach(
            bet => {

                const item =
                    document.createElement("div");


                const choices =
                    bet.bet_choices || [];

                const isResolved =
                    bet.status === "resolved";


                /*
                    Pari validé : badge, gagnant en vert avec 🏆,
                    perdants barrés et grisés.
                */

                if (isResolved) {

                    item.className =
                        "my-bet-item created-bet created-bet--resolved";

                    item.innerHTML = `

                        <div class="created-bet-head">

                            <div>

                                <h3>${escapeHtml(bet.question)}</h3>

                                ${bet.deadline_at
                                    ? `<p class="created-bet-meta">Terminé le ${formatDeadline(bet.deadline_at)}</p>`
                                    : ""
                                }

                            </div>

                            <span class="created-bet-badge done">✓ Validé</span>

                        </div>


                        <div class="created-bet-results">

                            ${choices.map(choice => {

                                const isWinner =
                                    choice.id === bet.winner_choice_id;

                                return `
                                    <div class="created-bet-result ${isWinner ? "win" : "lose"}">
                                        <span>${isWinner ? "🏆 " : ""}${escapeHtml(choice.label)}</span>
                                        <strong>${Number(choice.odds).toFixed(2)}</strong>
                                    </div>
                                `;

                            }).join("")}

                        </div>

                    `;

                } else {

                    /*
                        Pari en cours : badge, échéance, cotes
                        et bouton de validation.
                    */

                    item.className =
                        "my-bet-item created-bet";

                    item.innerHTML = `

                        <div class="created-bet-open">

                            <span class="created-bet-badge open">⏳ En cours</span>

                            <h3>${escapeHtml(bet.question)}</h3>

                            <p class="created-bet-meta">
                                ${bet.deadline_at ? "Se ferme le " + formatDeadline(bet.deadline_at) + " · " : ""}${choices.map(choice => escapeHtml(choice.label) + " " + Number(choice.odds).toFixed(2)).join(" · ")}
                            </p>

                        </div>


                        ${bet.status === "open"
                            ? `
                                <button
                                    class="primary-button resolve-button"
                                    data-bet-id="${bet.id}"
                                >
                                    Valider le résultat
                                </button>
                            `
                            : ""
                        }

                    `;

                }


                container.appendChild(item);

            }
        );


        /*
            Événements des boutons de résolution.
        */

        document
            .querySelectorAll(".resolve-button")
            .forEach(button => {

                button.addEventListener(
                    "click",
                    async () => {

                        const betId =
                            button.dataset.betId;


                        const bet =
                            data.find(
                                item =>
                                    item.id === betId
                            );


                        openResolveModal(bet);

                    }
                );

            });


    } catch (error) {

        console.error(error);


        container.innerHTML = `
            <p class="error-message">
                Impossible de charger tes créations.
            </p>
        `;

    }

}



/* =========================================================
   9. MODAL RÉSOLUTION
========================================================= */

/*
    Validation en deux étapes :
    1. choisir le choix gagnant ;
    2. voir le bilan joueur par joueur, puis confirmer (ou revenir).
*/

async function openResolveModal(bet) {

    currentResolveBet = bet;

    document.getElementById("resolve-question").textContent =
        bet.question;

    document.getElementById("resolve-error").textContent = "";

    const container =
        document.getElementById("resolve-choices");

    container.innerHTML =
        `<p class="resolve-loading">Chargement des mises...</p>`;

    showResolveStep(1);

    document
        .getElementById("resolve-modal")
        .classList.remove("hidden");


    /*
        Mises du pari, pour le bilan de l'étape 2.
    */

    const { data: stakes, error } =
        await supabaseClient
            .from("stakes")
            .select("choice_id, stake, potential_win, profiles!stakes_user_id_fkey ( username, gold_frame_until, name_color_until, cosmetics )")
            .eq("bet_id", bet.id);

    if (error) {
        console.error(error);
    }

    renderResolveStepOne(bet, stakes || []);

}


function showResolveStep(step) {

    document
        .querySelectorAll("#resolve-steps div")
        .forEach((bar, index) => bar.classList.toggle("active", index < step));

    document.getElementById("resolve-info").textContent = step === 1
        ? "Étape 1 sur 2 : choisis le choix gagnant."
        : "Étape 2 sur 2 : vérifie le bilan, puis confirme.";

}


function renderResolveStepOne(bet, stakes) {

    showResolveStep(1);

    const container =
        document.getElementById("resolve-choices");

    container.innerHTML = `
        <div class="resolve-pick">
            ${bet.bet_choices.map(choice => {

                const count =
                    stakes.filter(s => s.choice_id === choice.id).length;

                return `
                    <button
                        class="resolve-pick-button"
                        data-choice-id="${choice.id}"
                    >
                        <span>
                            <b>${escapeHtml(choice.label)}</b>
                            <small>${count} parieur${count > 1 ? "s" : ""}</small>
                        </span>
                        <span class="resolve-pick-odds">${Number(choice.odds).toFixed(2)} →</span>
                    </button>
                `;

            }).join("")}
        </div>
    `;

    container
        .querySelectorAll(".resolve-pick-button")
        .forEach(button => {

            button.addEventListener("click", () => {

                const choice =
                    bet.bet_choices.find(c => c.id === button.dataset.choiceId);

                renderResolveStepTwo(bet, stakes, choice);

            });

        });

}


function renderResolveStepTwo(bet, stakes, winner) {

    showResolveStep(2);

    const container =
        document.getElementById("resolve-choices");

    const winners =
        stakes.filter(s => s.choice_id === winner.id);

    const paid =
        winners.reduce((sum, s) => sum + Number(s.potential_win), 0);


    const rows = stakes.length === 0
        ? `<p class="resolve-empty">Personne n'a misé sur ce pari.</p>`
        : stakes
            .slice()
            .sort((a, b) => (b.choice_id === winner.id) - (a.choice_id === winner.id))
            .map(s => s.choice_id === winner.id
                ? `<div class="resolve-row win"><span>✓ ${styledName(s.profiles)}</span><b>+${formatMoney(s.potential_win)}</b></div>`
                : `<div class="resolve-row lose"><span>✗ ${styledName(s.profiles)}</span><b>−${formatMoney(s.stake)}</b></div>`
            )
            .join("");


    container.innerHTML = `

        <p class="resolve-if">
            Si « ${escapeHtml(winner.label)} » gagne :
            <span>${winners.length} gagnant${winners.length > 1 ? "s" : ""} · ${formatMoney(paid)} reversés</span>
        </p>

        <div class="resolve-list">${rows}</div>

        <div class="resolve-warning">⚠️ Cette action est définitive.</div>

        <div class="resolve-nav">

            <button class="resolve-back">
                ← Changer
            </button>

            <button class="primary-button resolve-confirm">
                Confirmer
            </button>

        </div>

    `;


    container
        .querySelector(".resolve-back")
        .addEventListener("click", () => renderResolveStepOne(bet, stakes));

    container
        .querySelector(".resolve-confirm")
        .addEventListener("click", event => {

            const button = event.currentTarget;

            button.disabled = true;

            resolveBet(bet.id, winner.id).finally(() => {
                button.disabled = false;
            });

        });

}



/* =========================================================
   MODAL DÉTAIL DES PARIEURS
========================================================= */

function openStakesModal(bet) {

    document.getElementById(
        "stakes-bet-summary"
    ).innerHTML =
        renderBetSummaryHtml(
            bet,
            { interactive: false }
        ) + `

            <div class="bet-footer">

                ${bet.target_user_id
                    ? `<span class="bet-target-footer">🎯 ${bet.target_blocked ? "Bloqué pour" : "Concerne"} ${styledName(bet.target, "un parieur")}</span>`
                    : ""
                }

                <div class="bet-total-footer">
                    <span>Solde misé</span>
                    <strong>${formatMoney((bet.stakes || []).reduce((sum, s) => sum + Number(s.stake), 0))}</strong>
                </div>

            </div>

        `;


    document
        .querySelector(".stakes-modal-content")
        .classList.toggle(
            "bet-card-locked",
            isBlockedTarget(bet)
        );


    const container =
        document.getElementById(
            "stakes-list"
        );


    container.innerHTML = "";


    const stakes =
        bet.stakes || [];


    if (stakes.length === 0) {

        container.innerHTML = `
            <div class="empty-state">
                Aucune mise pour le moment.
            </div>
        `;

    } else {

        stakes.forEach(
            stake => {

                const choice =
                    bet.bet_choices.find(
                        item =>
                            item.id === stake.choice_id
                    );

                const choiceLabel =
                    choice?.label ||
                    "Choix supprimé";

                const odds =
                    Number(choice?.odds || 0);


                const row =
                    document.createElement("div");

                row.className =
                    "stake-row";

                row.innerHTML = `
                    <div class="stake-row-header">
                        <strong>${styledName(stake.profiles)}</strong>
                        <span class="stake-choice-badge">
                            ${escapeHtml(choiceLabel)}
                        </span>
                    </div>

                    <div class="stake-row-details">
                        <span>💰 ${formatMoney(stake.stake)}</span>
                        <span>🎲 ${odds.toFixed(2)}</span>
                        <span>🏆 ${formatMoney(stake.potential_win)}</span>
                    </div>
                `;

                container.appendChild(row);

            }
        );

    }


    document
        .getElementById(
            "stakes-modal"
        )
        .classList.remove("hidden");

}



/* =========================================================
   RÉSOLUTION DU PARI
========================================================= */

async function resolveBet(
    betId,
    winnerChoiceId
) {

    const errorElement =
        document.getElementById(
            "resolve-error"
        );


    errorElement.textContent = "";


    try {

        const {
            data,
            error
        } = await supabaseClient.rpc(
            "resolve_bet",
            {
                p_bet_id:
                    betId,

                p_winner_choice_id:
                    winnerChoiceId
            }
        );


        if (error) {

            throw error;

        }


        console.log(
            "Pari résolu :",
            data
        );


        document
            .getElementById(
                "resolve-modal"
            )
            .classList.add("hidden");


        await loadCurrentProfile();

        await displayBets();

        await displayLeaderboard();

        await displayMyBets();

        await displayMyCreatedBets();

        await refreshMissions();

        await checkNewResults();



    } catch (error) {

        console.error(error);


        errorElement.textContent =
            error.message ||
            "Impossible de valider le pari.";

    }

}



/* =========================================================
   10. CRÉER UN PARI
========================================================= */

async function createBet() {

    const question =
        document.getElementById(
            "bet-question"
        ).value.trim();


    const choiceOne =
        document.getElementById(
            "choice-one"
        ).value.trim();


    const choiceTwo =
        document.getElementById(
            "choice-two"
        ).value.trim();


    const oddsOne =
        Number(
            document.getElementById(
                "odds-one"
            ).value
        );


    /*
        La cote 2 est toujours recalculée à partir de la cote 1
        (pas d'arbitrage possible entre les deux choix).
    */

    const oddsTwo =
        calculerCoteComplementaire(oddsOne);


    const hasTarget =
        document.getElementById(
            "bet-has-target"
        ).checked;


    const targetUserId =
        hasTarget
            ? document.getElementById(
                "bet-target-user"
            ).value
            : "";


    const targetBlocked =
        hasTarget &&
        document.getElementById(
            "bet-target-blocked"
        ).checked;


    if (hasTarget && !targetUserId) {

        return;

    }


    /*
        L'échéance est obligatoire
        (sélecteur jour + heure, voir setupDeadlinePicker).
    */

    const deadlineError =
        document.getElementById("deadline-error");

    const showDeadlineError = text => {

        deadlineError.textContent = text;

        deadlineError.classList.remove("hidden");

        deadlineError.scrollIntoView({ behavior: "smooth", block: "center" });

    };

    deadlineError.classList.add("hidden");


    const deadline =
        getSelectedDeadline();


    if (!deadline) {

        showDeadlineError("Choisis le jour de fin du pari.");

        return;

    }


    if (deadline <= new Date()) {

        showDeadlineError("L'échéance doit être dans le futur.");

        return;

    }


    const deadlineAt =
        deadline.toISOString();


    if (!question) {

        return;

    }


    if (!choiceOne || !choiceTwo) {

        return;

    }


    if (
        !oddsOne ||
        oddsOne <= 0 ||
        !oddsTwo ||
        oddsTwo <= 0
    ) {

        return;

    }


    try {

        /*
            Création du pari.
        */

        const {
            data: bet,
            error: betError
        } = await supabaseClient
            .from("bets")
            .insert({

                question: question,

                author_id:
                    currentUser.id,

                status: "open",

                deadline_at:
                    deadlineAt,

                target_user_id:
                    targetUserId || null,

                target_blocked:
                    targetBlocked

            })
            .select()
            .single();


        if (betError) {

            throw betError;

        }


        /*
            Création des deux choix.
        */

        const {
            error: choicesError
        } = await supabaseClient
            .from("bet_choices")
            .insert([

                {
                    bet_id: bet.id,

                    label: choiceOne,

                    odds: oddsOne

                },

                {
                    bet_id: bet.id,

                    label: choiceTwo,

                    odds: oddsTwo

                }

            ]);


        if (choicesError) {

            /*
                Si les choix échouent,
                on supprime le pari.
            */

            await supabaseClient
                .from("bets")
                .delete()
                .eq(
                    "id",
                    bet.id
                );


            throw choicesError;

        }


        /*
            Réinitialisation du formulaire.
        */

        document.getElementById(
            "create-bet-form"
        ).reset();

        document.getElementById(
            "bet-target-options"
        ).classList.add("hidden");

        resetDeadlinePicker();


        /*
            Retour vers les paris.
        */

        showPage("bets-page");


        await displayBets();

        await displayMyCreatedBets();



    } catch (error) {

        console.error(error);


    }

}



/* =========================================================
   Cote complémentaire (pari à 2 choix)
   ========================================================= */

/*
    Cote du 2e choix telle que 1/cote1 + 1/cote2 = 1 :
    parier sur les deux choix ne peut jamais rapporter d'argent.
*/

/*
    Sélecteur d'échéance : un jour parmi les 7 prochains
    + une heure au curseur (par pas de 15 minutes).
    Aucun jour n'est choisi au départ : l'échéance est obligatoire.
*/

let deadlineDayOffset = null;

const DEFAULT_DEADLINE_STEP = 80; // 80 × 15 min = 20h00


function getSelectedDeadline() {

    if (deadlineDayOffset === null) {
        return null;
    }

    const minutes =
        Number(document.getElementById("deadline-range").value) * 15;

    const date = new Date();

    date.setDate(date.getDate() + deadlineDayOffset);

    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);

    return date;

}


function updateDeadlinePreview() {

    const range =
        document.getElementById("deadline-range");

    const minutes = Number(range.value) * 15;

    document.getElementById("deadline-time").textContent =
        String(Math.floor(minutes / 60)).padStart(2, "0") + ":" +
        String(minutes % 60).padStart(2, "0");


    const result =
        document.getElementById("deadline-result");

    const deadline =
        getSelectedDeadline();

    if (!deadline) {
        result.className = "deadline-result empty";
        result.textContent = "Choisis le jour de fin du pari";
        return;
    }

    const dayLabel =
        deadlineDayOffset === 0 ? "Aujourd'hui"
        : deadlineDayOffset === 1 ? "Demain"
        : deadline.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

    const label =
        dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1) +
        " à " + document.getElementById("deadline-time").textContent.replace(":", "h");

    if (deadline <= new Date()) {
        result.className = "deadline-result empty";
        result.textContent = "⚠️ " + label + " : c'est déjà passé";
        return;
    }

    result.className = "deadline-result";
    result.textContent = "✅ Se ferme : " + label;

}


function setupDeadlinePicker() {

    const daysContainer =
        document.getElementById("deadline-days");

    if (!daysContainer) {
        return;
    }


    for (let i = 0; i < 7; i++) {

        const date = new Date();

        date.setDate(date.getDate() + i);

        const dayButton =
            document.createElement("button");

        dayButton.type = "button";

        dayButton.className = "deadline-day";

        dayButton.dataset.offset = i;

        dayButton.innerHTML = `
            <small>${i === 0 ? "auj." : i === 1 ? "dem." : date.toLocaleDateString("fr-FR", { weekday: "short" })}</small>
            <b>${date.getDate()}</b>
        `;

        dayButton.addEventListener("click", () => {

            deadlineDayOffset = i;

            daysContainer
                .querySelectorAll(".deadline-day")
                .forEach(button => button.classList.toggle("active", button === dayButton));

            document.getElementById("deadline-error").classList.add("hidden");

            updateDeadlinePreview();

        });

        daysContainer.appendChild(dayButton);

    }


    document
        .getElementById("deadline-range")
        .addEventListener("input", updateDeadlinePreview);

    resetDeadlinePicker();

}


function resetDeadlinePicker() {

    deadlineDayOffset = null;

    document
        .querySelectorAll(".deadline-day")
        .forEach(button => button.classList.remove("active"));

    document.getElementById("deadline-range").value =
        DEFAULT_DEADLINE_STEP;

    updateDeadlinePreview();

}



function calculerCoteComplementaire(cote) {

    if (!cote || cote <= 1) {

        return 0;

    }

    return Math.round(
        (cote / (cote - 1)) * 100
    ) / 100;

}



/* =========================================================
   Parieur concerné (création de pari)
   ========================================================= */

async function loadTargetUsers() {

    const select =
        document.getElementById(
            "bet-target-user"
        );


    if (!select) {

        return;

    }


    const {
        data,
        error
    } = await supabaseClient
        .from("profiles")
        .select("id, username")
        .eq("is_admin", false)
        .order("username");


    if (error) {

        console.error("Erreur loadTargetUsers :", error);

        return;

    }


    (data || []).forEach(
        profile => {

            const option =
                document.createElement("option");

            option.value =
                profile.id;

            option.textContent =
                profile.username;

            select.appendChild(option);

        }
    );

}



/* =========================================================
   10 BIS. MISSIONS ET BOUTIQUE
========================================================= */

/*
    Les règles et les points sont vérifiés côté PostgreSQL
    (voir missions.sql). Ici, on ne fait que l'affichage.
*/

const MISSIONS = [
    {
        id: "connexion",
        title: "Connexion du jour",
        description: "Placer au moins une mise dans la journée.",
        points: 5,
        period: "Chaque jour",
        group: "daily"
    },
    {
        id: "touche",
        title: "Touche-à-tout",
        description: "Miser sur 3 paris différents le même jour.",
        points: 5,
        period: "Chaque jour",
        group: "daily"
    },
    {
        id: "premier",
        title: "Premier sur le coup",
        description: "Être le premier à miser sur un pari.",
        points: 5,
        period: "Chaque jour",
        group: "daily"
    },
    {
        id: "gros",
        title: "Gros joueur",
        description: "Miser 700 € au total dans la semaine.",
        points: 20,
        period: "Chaque semaine",
        group: "weekly",
        isMoney: true
    },
    {
        id: "createur",
        title: "Créateur",
        description: "Créer cette semaine un pari qui reçoit des mises de 5 joueurs différents (tu peux en faire partie).",
        points: 25,
        period: "Chaque semaine",
        group: "weekly"
    },
    {
        id: "premier_gain",
        title: "Premier gain",
        description: "Gagner ton premier pari.",
        points: 10,
        period: "Une seule fois",
        group: "oneshot"
    },
    {
        id: "outsider",
        title: "Outsider",
        description: "Gagner un pari avec une cote supérieure à 3.",
        points: 20,
        period: "Une fois par pari",
        group: "oneshot"
    },
    {
        id: "contre",
        title: "Contre tous",
        description: "Miser sur le choix le moins joué d'un pari, et gagner.",
        points: 30,
        period: "Une fois par pari",
        group: "oneshot"
    }
];


const REWARDS = [
    {
        id: "cadre",
        title: "Cadre doré",
        description: "Ta ligne du classement passe en doré, pour toujours.",
        price: 250,
        field: "gold_frame_until"
    },
    {
        id: "couleur",
        title: "Pseudo en couleur",
        description: "Ton pseudo s'affiche en arc-en-ciel animé, pour toujours.",
        price: 100,
        field: "name_color_until"
    }
];


/*
    Cosmétiques (voir cosmetiques.sql : prix, durées et options
    y sont vérifiés, ce tableau ne sert qu'à l'affichage).
*/

const COSMETICS = [
    {
        id: "emoji",
        title: "Emoji à côté du pseudo",
        description: "Un emoji à côté de ton pseudo, partout sur le site.",
        price: 15,
        options: ["🔥", "⚡", "🍀", "🦊", "💎", "🎯"]
    },
    {
        id: "titre",
        title: "Titre à côté du pseudo",
        description: "Un petit titre affiché à côté de ton pseudo.",
        price: 20,
        options: ["Le Prophète", "Chanceux", "Outsider", "Requin", "Débutant"]
    },
    {
        id: "neon",
        title: "Pseudo néon",
        description: "Ton pseudo brille d'une couleur néon.",
        price: 80,
        options: ["rose", "bleu", "vert", "jaune"]
    },
    {
        id: "metal_rose",
        title: "Pseudo rose gold",
        description: "Un reflet rose gold qui brille sur ton pseudo.",
        price: 100,
    },
    {
        id: "etincelles",
        title: "Pseudo étincelant",
        description: "De petites étoiles scintillent autour de ton pseudo.",
        price: 100,
    },
    {
        id: "metal_bronze",
        title: "Pseudo bronze",
        description: "Un reflet bronze qui brille sur ton pseudo.",
        price: 150,
    },
    {
        id: "metal_argent",
        title: "Pseudo argent",
        description: "Un reflet argenté qui brille sur ton pseudo.",
        price: 200,
    },
    {
        id: "metal_or",
        title: "Pseudo or",
        description: "Un reflet doré qui brille sur ton pseudo.",
        price: 250,
    },
    {
        id: "aura",
        title: "Aura animée",
        description: "Un contour lumineux tourne autour de ta ligne du classement.",
        price: 300,
    },
    {
        id: "theme",
        title: "Thème de carte",
        description: "Les paris que tu crées ont un fond spécial, visible par tous.",
        price: 450,
        options: ["galaxie", "carbone", "sunset"]
    }
];


/*
    Catégories de la boutique (ordre d'affichage).
    Mélange les avantages historiques (REWARDS) et les cosmétiques.
*/

const SHOP_CATEGORIES = [
    {
        icon: "✨",
        title: "Additionnels au pseudo",
        items: ["emoji", "titre", "etincelles"]
    },
    {
        icon: "🎨",
        title: "Couleurs et animations du pseudo",
        items: ["couleur", "neon", "metal_rose", "metal_bronze", "metal_argent", "metal_or"]
    },
    {
        icon: "🖼️",
        title: "Cadres",
        items: ["cadre", "aura"]
    },
    {
        icon: "🃏",
        title: "Thèmes de cartes",
        items: ["theme"]
    }
];


// Option choisie dans la boutique pour chaque cosmétique (avant achat).
const shopSelections = {};


function cosmeticOptionLabel(option) {

    return option.charAt(0).toUpperCase() + option.slice(1);

}


function hasMyCosmetic(id) {

    if (!currentProfile) {
        return false;
    }

    const preview =
        getAdminPreview()["cosmetic:" + id];

    if (currentProfile.is_admin && preview !== undefined) {
        return Boolean(preview);
    }

    return isRewardActive(currentProfile.cosmetics?.[id]?.until) && !currentProfile.cosmetics?.[id]?.off;

}


function myCosmeticOption(id) {

    const preview =
        getAdminPreview()["cosmetic:" + id];

    if (currentProfile?.is_admin && typeof preview === "string") {
        return preview;
    }

    return currentProfile?.cosmetics?.[id]?.option || null;

}


function isRewardActive(until) {

    return Boolean(until) && new Date(until) > new Date();

}


function showMissionsMessage(text, isError, elementId = "missions-message") {

    const element =
        document.getElementById(elementId);

    if (!element) {
        return;
    }

    element.textContent = text;

    element.classList.toggle("error", Boolean(isError));

    element.classList.remove("hidden");

}


async function displayMissions() {

    const containers = {
        daily: document.getElementById("missions-daily"),
        weekly: document.getElementById("missions-weekly"),
        oneshot: document.getElementById("missions-oneshot")
    };

    if (!containers.daily || !currentUser) {
        return;
    }


    try {

        const {
            data,
            error
        } = await supabaseClient.rpc("mission_progress");


        if (error) {
            throw error;
        }


        const progressById = {};

        (data || []).forEach(row => {
            progressById[row.mission] = row;
        });


        const cardsByGroup = {
            daily: [],
            weekly: [],
            oneshot: []
        };

        let hasClaimable = false;


        MISSIONS.forEach(mission => {

            const row =
                progressById[mission.id] ||
                { progress: 0, target: 1, claimable: 0, claimed: 0 };

            const progress = Number(row.progress);

            const target = Number(row.target);

            const percent =
                Math.min(100, Math.round(progress / target * 100));

            const progressLabel = mission.isMoney
                ? formatMoney(progress) + " / " + formatMoney(target)
                : progress + " / " + target;


            let action;

            if (row.claimable > 0) {

                hasClaimable = true;

                const total = row.claimable * mission.points;

                action = `
                    <button
                        class="primary-button mission-claim"
                        data-mission="${mission.id}"
                    >
                        Récupérer ${total} pts
                    </button>
                `;

            } else if (row.claimed > 0 && progress >= target) {

                action = `<span class="mission-state done">Récupérée</span>`;

            } else {

                action = `<span class="mission-state">En cours</span>`;

            }


            cardsByGroup[mission.group].push(`
                <div class="mission-card${row.claimable > 0 ? " ready" : ""}">

                    <div class="mission-head">
                        <h3>${escapeHtml(mission.title)}</h3>
                        <span class="mission-points">+${mission.points} pts</span>
                    </div>

                    <p class="mission-description">${escapeHtml(mission.description)}</p>

                    <div class="mission-bar">
                        <div style="width: ${percent}%"></div>
                    </div>

                    <div class="mission-footer">
                        <span class="mission-period">${escapeHtml(mission.period)} · ${progressLabel}</span>
                        ${action}
                    </div>

                </div>
            `);

        });


        Object.keys(containers).forEach(group => {

            containers[group].innerHTML = cardsByGroup[group].join("");

        });


        /*
            Surbrillance de l'onglet Missions
            quand une récompense est à récupérer.
        */

        document
            .querySelector('.nav-button[data-page="missions-page"]')
            ?.classList.toggle("has-reward", hasClaimable);


        document
            .querySelectorAll("#missions-page .mission-claim")
            .forEach(button => {

                button.addEventListener(
                    "click",
                    () => claimMission(button.dataset.mission, button)
                );

            });

    } catch (error) {

        console.error(error);

        containers.weekly.innerHTML = "";

        containers.oneshot.innerHTML = "";

        containers.daily.innerHTML = `
            <p class="error-message">
                Impossible de charger les missions. As-tu lancé le script missions.sql dans Supabase ?
            </p>
        `;

    }

}


async function claimMission(missionId, button) {

    button.disabled = true;


    try {

        const {
            data,
            error
        } = await supabaseClient.rpc(
            "claim_mission",
            {
                p_mission: missionId
            }
        );


        if (error) {
            throw error;
        }


        showMissionsMessage("+" + data + " points récupérés !");

        await loadCurrentProfile();

        await displayMissions();

        displayShop();

    } catch (error) {

        console.error(error);

        showMissionsMessage(
            error.message || "Impossible de récupérer la mission.",
            true
        );

        button.disabled = false;

    }

}


/*
    Aperçu admin des avantages : choix gardé dans le navigateur.
    Pour l'admin, l'aperçu remplace l'état réel de l'avantage.
*/

function getAdminPreview() {

    try {
        return JSON.parse(localStorage.getItem("betlab-admin-preview")) || {};
    } catch (error) {
        return {};
    }

}


function setAdminPreview(field, value) {

    const preview = getAdminPreview();

    preview[field] = value;

    try {
        localStorage.setItem("betlab-admin-preview", JSON.stringify(preview));
    } catch (error) {
        // Stockage indisponible : l'aperçu ne sera pas mémorisé.
    }

}


function hasMyReward(field) {

    if (!currentProfile) {
        return false;
    }

    const preview = getAdminPreview();

    if (currentProfile.is_admin && typeof preview[field] === "boolean") {
        return preview[field];
    }

    const rewardId =
        field === "gold_frame_until" ? "cadre" : "couleur";

    return isRewardActive(currentProfile[field]) && !currentProfile.cosmetics?.[rewardId]?.off;

}


function displayShop() {

    const container =
        document.getElementById("shop-container");

    if (!container || !currentProfile) {
        return;
    }


    const points = currentProfile.points || 0;


    const rewardCards = {};

    REWARDS.forEach(reward => {

        const until = currentProfile[reward.field];

        const active = isRewardActive(until);

        const canBuy = points >= reward.price;


        const status = active
            ? `<span class="mission-state done">✓ Possédé</span>`
            : `<span class="mission-state">${canBuy ? "Disponible" : "Il te manque " + (reward.price - points) + " pts"}</span>`;


        /*
            Admin : interrupteur d'aperçu pour tester l'effet
            sans l'acheter (visible uniquement par l'admin).
        */

        const previewOn =
            hasMyReward(reward.field);

        const adminToggle = currentProfile.is_admin
            ? `
                <button
                    class="reward-preview-toggle${previewOn ? " on" : ""}"
                    data-preview="${reward.field}"
                >
                    👁 Aperçu : ${previewOn ? "activé" : "désactivé"}
                </button>
            `
            : "";


        rewardCards[reward.id] = `
            <div class="mission-card shop-card" data-shop-item="${reward.id}">

                <div class="mission-head">
                    <h3>${escapeHtml(reward.title)}</h3>
                    <span class="mission-points">${reward.price} pts</span>
                </div>

                <p class="mission-description">${escapeHtml(reward.description)}</p>

                <div class="mission-footer">
                    ${status}
                    <button
                        class="primary-button reward-buy"
                        data-reward="${reward.id}"
                        ${canBuy && !active ? "" : "disabled"}
                    >
                        ${active ? "Possédé" : "Acheter"}
                    </button>
                </div>

                ${adminToggle}

                ${equipToggleHtml(reward.id, active)}

            </div>
        `;

    });


    /*
        Boutique rangée par catégories.
    */

    const cardOf = id =>
        rewardCards[id] ||
        cosmeticCardHtml(COSMETICS.find(c => c.id === id));

    container.innerHTML = SHOP_CATEGORIES.map(category => `

        <section class="shop-category">

            <h2 class="missions-title">
                ${category.icon} ${escapeHtml(category.title)}
            </h2>

            <div class="missions-grid">
                ${category.items.map(cardOf).join("")}
            </div>

        </section>

    `).join("");


    container
        .querySelectorAll(".reward-preview-toggle")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const field = button.dataset.preview;

                    setAdminPreview(field, !hasMyReward(field));

                    displayShop();

                    displayLeaderboard();

                }
            );

        });


    container
        .querySelectorAll(".reward-buy")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => buyReward(button.dataset.reward, button)
            );

        });


    /*
        Cosmétiques : choix de l'option, aperçu admin, achat.
    */

    container
        .querySelectorAll(".cosmetic-option")
        .forEach(button => {

            button.addEventListener("click", () => {

                shopSelections[button.dataset.cosmetic] = button.dataset.option;

                // L'aperçu admin suit l'option choisie s'il est activé.
                if (currentProfile.is_admin && hasMyCosmetic(button.dataset.cosmetic)) {
                    setAdminPreview("cosmetic:" + button.dataset.cosmetic, button.dataset.option);
                    displayLeaderboard();
                }

                displayShop();

            });

        });


    container
        .querySelectorAll(".cosmetic-preview-toggle")
        .forEach(button => {

            button.addEventListener("click", () => {

                const id = button.dataset.cosmetic;

                const item = COSMETICS.find(c => c.id === id);

                setAdminPreview(
                    "cosmetic:" + id,
                    hasMyCosmetic(id)
                        ? false
                        : (item.options ? shopSelections[id] || item.options[0] : true)
                );

                displayShop();

                displayLeaderboard();

            });

        });


    container
        .querySelectorAll(".equip-toggle")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => toggleEquip(
                    button.dataset.item,
                    button.dataset.on !== "true",
                    button
                )
            );

        });


    container
        .querySelectorAll(".cosmetic-buy")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => buyCosmetic(button.dataset.cosmetic, button)
            );

        });

}


/*
    Aperçu d'un article de la boutique (clic sur la carte),
    même s'il n'est pas encore achetable : l'effet est appliqué
    à son propre pseudo, avec les vrais styles du site.
*/

function openShopPreview(itemId, option) {

    const reward =
        REWARDS.find(r => r.id === itemId);

    const item =
        reward || COSMETICS.find(c => c.id === itemId);

    if (!item || !currentProfile) {
        return;
    }

    const selected =
        option || shopSelections[itemId] || item.options?.[0] || null;


    // Uniquement l'effet de l'article prévisualisé.
    const effects = {
        gold: itemId === "cadre",
        rainbow: itemId === "couleur",
        metal: itemId.startsWith("metal_") ? itemId.slice(6) : null,
        neon: itemId === "neon" ? selected : null,
        emoji: itemId === "emoji" ? selected : null,
        title: itemId === "titre" ? selected : null,
        sparkle: itemId === "etincelles",
        aura: itemId === "aura",
        theme: itemId === "theme" ? selected : null
    };

    const me = {
        username: currentProfile.username
    };


    const stage =
        document.getElementById("shop-preview-stage");

    if (itemId === "theme") {

        stage.innerHTML = `
            <div class="bet-card bet-card-theme bet-theme-${selected} shop-preview-bet">
                <div class="bet-card-header">
                    <span>🏆</span>
                    <span class="bet-author">Créé par ${escapeHtml(me.username)}</span>
                </div>
                <div class="bet-question-row">
                    <span class="bet-question-icon">🎲</span>
                    <h3>Qui gagne le match ce soir ?</h3>
                </div>
            </div>
        `;

    } else {

        stage.innerHTML = `
            <div class="shop-preview-board">
                ${leaderboardRowHtml({ username: "Emma" }, { rank: 2, medal: "🥈", balance: formatMoney(1840), effects: {} })}
                ${leaderboardRowHtml(me, { rank: 3, medal: "🥉", balance: formatMoney(1520), effects })}
                ${leaderboardRowHtml({ username: "Lucas" }, { rank: 4, medal: "", balance: formatMoney(1310), effects: {} })}
            </div>
            <p class="shop-preview-bet-line">
                Sur une carte de pari : 🏆 Créé par
                <span class="user-name${effects.gold ? " name-gold" : ""}">${nameHtml(me, effects)}</span>
            </p>
        `;

    }


    document.getElementById("shop-preview-title").textContent =
        item.title;

    document.getElementById("shop-preview-description").textContent =
        item.description;

    document.getElementById("shop-preview-price").textContent =
        item.price + " pts · définitif";


    const optionsContainer =
        document.getElementById("shop-preview-options");

    optionsContainer.innerHTML = (item.options || []).map(opt => `
        <button
            class="cosmetic-option cosmetic-option--${item.id}${opt === selected ? " active" : ""}"
            data-option="${escapeHtml(opt)}"
        >${escapeHtml(item.id === "emoji" ? opt : cosmeticOptionLabel(opt))}</button>
    `).join("");

    optionsContainer
        .querySelectorAll(".cosmetic-option")
        .forEach(button => {

            button.addEventListener("click", () => {

                // L'option testée devient celle sélectionnée pour l'achat.
                shopSelections[itemId] = button.dataset.option;

                openShopPreview(itemId, button.dataset.option);

                displayShop();

            });

        });


    document
        .getElementById("shop-preview-modal")
        .classList.remove("hidden");

}


function setupShopPreview() {

    const modal =
        document.getElementById("shop-preview-modal");

    const container =
        document.getElementById("shop-container");

    if (!modal || !container) {
        return;
    }

    document
        .getElementById("close-shop-preview")
        .addEventListener("click", () => modal.classList.add("hidden"));

    modal.addEventListener("click", event => {
        if (event.target === modal) {
            modal.classList.add("hidden");
        }
    });


    // Clic sur une carte (hors boutons) : ouvre l'aperçu.
    container.addEventListener("click", event => {

        if (event.target.closest("button")) {
            return;
        }

        const card =
            event.target.closest("[data-shop-item]");

        if (card) {
            openShopPreview(card.dataset.shopItem);
        }

    });

}


/*
    Interrupteur « Équipé / Retiré » d'un article possédé
    (joueurs ; l'admin garde son interrupteur d'aperçu).
*/

function equipToggleHtml(itemId, owned) {

    if (!owned || currentProfile.is_admin) {
        return "";
    }

    const on =
        !currentProfile.cosmetics?.[itemId]?.off;

    return `
        <button
            class="reward-preview-toggle equip-toggle${on ? " on" : ""}"
            data-item="${itemId}"
            data-on="${on}"
        >
            ${on ? "✓ Équipé · cliquer pour retirer" : "Retiré · cliquer pour équiper"}
        </button>
    `;

}


async function toggleEquip(itemId, turnOn, button) {

    button.disabled = true;

    const { error } =
        await supabaseClient.rpc(
            "toggle_cosmetic",
            {
                p_item: itemId,
                p_on: turnOn
            }
        );

    if (error) {

        console.error(error);

        showMissionsMessage(
            error.message || "Impossible de changer l'équipement.",
            true,
            "shop-message"
        );

        button.disabled = false;

        return;

    }

    await loadCurrentProfile();

    displayShop();

    await displayLeaderboard();

    await displayBets();

}


function cosmeticCardHtml(item) {

    const points =
        currentProfile.points || 0;

    const until =
        currentProfile.cosmetics?.[item.id]?.until;

    const active =
        isRewardActive(until);

    const canBuy =
        points >= item.price;

    const selected =
        shopSelections[item.id] ||
        currentProfile.cosmetics?.[item.id]?.option ||
        item.options?.[0];


    const status = active
        ? `<span class="mission-state done">✓ Possédé</span>`
        : `<span class="mission-state">${canBuy ? "Disponible" : "Il te manque " + (item.price - points) + " pts"}</span>`;


    /*
        Bouton : acheter, ou pour un article possédé à options,
        équiper gratuitement l'option sélectionnée.
    */

    const ownedOption =
        currentProfile.cosmetics?.[item.id]?.option;

    const buttonLabel = !active
        ? "Acheter"
        : item.options && selected !== ownedOption
            ? "Équiper"
            : item.options ? "Équipé" : "Possédé";

    const buttonEnabled = active
        ? buttonLabel === "Équiper"
        : canBuy;


    const options = item.options
        ? `
            <div class="cosmetic-options">
                ${item.options.map(option => `
                    <button
                        class="cosmetic-option cosmetic-option--${item.id}${option === selected ? " active" : ""}"
                        data-cosmetic="${item.id}"
                        data-option="${escapeHtml(option)}"
                    >${escapeHtml(item.id === "emoji" ? option : cosmeticOptionLabel(option))}</button>
                `).join("")}
            </div>
        `
        : "";


    const previewOn =
        hasMyCosmetic(item.id);

    const adminToggle = currentProfile.is_admin
        ? `
            <button
                class="reward-preview-toggle cosmetic-preview-toggle${previewOn ? " on" : ""}"
                data-cosmetic="${item.id}"
            >
                👁 Aperçu : ${previewOn ? "activé" : "désactivé"}
            </button>
        `
        : "";


    return `
        <div class="mission-card shop-card" data-shop-item="${item.id}">

            <div class="mission-head">
                <h3>${escapeHtml(item.title)}</h3>
                <span class="mission-points">${item.price} pts</span>
            </div>

            <p class="mission-description">${escapeHtml(item.description)}</p>

            ${options}

            <div class="mission-footer">
                ${status}
                <button
                    class="primary-button cosmetic-buy"
                    data-cosmetic="${item.id}"
                    ${buttonEnabled ? "" : "disabled"}
                >
                    ${buttonLabel}
                </button>
            </div>

            ${adminToggle}

            ${equipToggleHtml(item.id, active)}

        </div>
    `;

}


async function buyCosmetic(id, button) {

    button.disabled = true;

    const item =
        COSMETICS.find(c => c.id === id);

    const option = item.options
        ? shopSelections[id] || currentProfile.cosmetics?.[id]?.option || item.options[0]
        : null;


    try {

        const { data, error } =
            await supabaseClient.rpc(
                "buy_cosmetic",
                {
                    p_item: id,
                    p_option: option
                }
            );

        if (error) {
            throw error;
        }

        showMissionsMessage(
            data === "option"
                ? item.title + " : nouvelle option équipée !"
                : item.title + " acheté, il est à toi pour toujours !",
            false,
            "shop-message"
        );

        await loadCurrentProfile();

        displayShop();

        await displayLeaderboard();

        await displayBets();

    } catch (error) {

        console.error(error);

        showMissionsMessage(
            error.message || "Impossible d'acheter ce cosmétique.",
            true,
            "shop-message"
        );

        button.disabled = false;

    }

}


async function buyReward(rewardId, button) {

    button.disabled = true;


    try {

        const {
            error
        } = await supabaseClient.rpc(
            "buy_reward",
            {
                p_reward: rewardId
            }
        );


        if (error) {
            throw error;
        }


        showMissionsMessage("Avantage acheté, il est à toi pour toujours !", false, "shop-message");

        await loadCurrentProfile();

        displayShop();

        await displayLeaderboard();

    } catch (error) {

        console.error(error);

        showMissionsMessage(
            error.message || "Impossible d'acheter cet avantage.",
            true,
            "shop-message"
        );

        button.disabled = false;

    }

}


async function refreshMissions() {

    await displayMissions();

    displayShop();

    await refreshProgression();

}



/* =========================================================
   11. NAVIGATION
========================================================= */

function showPage(pageId) {

    document
        .querySelectorAll(".app-page")
        .forEach(page => {

            page.classList.add(
                "hidden"
            );

        });


    const page =
        document.getElementById(pageId);


    if (page) {

        page.classList.remove(
            "hidden"
        );

        cascadeIn(page);


        /*
            Retour sur les paris : on recharge le classement
            pour jouer une éventuelle remontée.
        */

        if (pageId === "bets-page") {

            displayLeaderboard();

        }

    }


    document
        .querySelectorAll(".nav-button")
        .forEach(button => {

            button.classList.remove(
                "active"
            );


            if (
                button.dataset.page ===
                pageId
            ) {

                button.classList.add(
                    "active"
                );

            }

        });

}



/* =========================================================
   12. DÉCONNEXION
========================================================= */

/*
    Changement de pseudo (voir profil.sql).
    Le pseudo est aussi l'identifiant de connexion.
*/

function setupProfilePage() {

    const form =
        document.getElementById("username-form");

    if (!form) {
        return;
    }


    const input =
        document.getElementById("username-input");

    const submit =
        document.getElementById("username-submit");

    const message =
        document.getElementById("username-message");


    input.value =
        currentProfile?.username || "";


    form.addEventListener("submit", async event => {

        event.preventDefault();

        const newName =
            input.value.trim();

        if (newName === currentProfile.username) {
            showMissionsMessage("C'est déjà ton pseudo.", true, "username-message");
            return;
        }

        submit.disabled = true;

        message.classList.add("hidden");


        const { error } =
            await supabaseClient.rpc(
                "change_username",
                {
                    p_username: newName
                }
            );


        submit.disabled = false;

        if (error) {

            console.error(error);

            showMissionsMessage(
                error.message || "Impossible de changer de pseudo.",
                true,
                "username-message"
            );

            return;

        }


        await loadCurrentProfile();

        input.value = currentProfile.username;

        showMissionsMessage(
            "Pseudo changé ! Connecte-toi désormais avec « " + currentProfile.username + " ».",
            false,
            "username-message"
        );

        await displayLeaderboard();

        await displayBets();

    });

}



/*
    Suppression définitive de son compte
    (voir suppression-compte.sql).
*/

function setupDeleteAccount() {

    const modal =
        document.getElementById("delete-account-modal");

    const openButton =
        document.getElementById("delete-account-button");

    if (!modal || !openButton) {
        return;
    }


    const errorElement =
        document.getElementById("delete-account-error");

    const confirmButton =
        document.getElementById("confirm-delete-account");

    const close = () => modal.classList.add("hidden");


    openButton.addEventListener("click", () => {

        errorElement.textContent = "";

        confirmButton.disabled = false;

        modal.classList.remove("hidden");

    });

    document
        .getElementById("close-delete-account-modal")
        .addEventListener("click", close);

    document
        .getElementById("cancel-delete-account")
        .addEventListener("click", close);


    confirmButton.addEventListener("click", async () => {

        confirmButton.disabled = true;

        errorElement.textContent = "";

        const { error } =
            await supabaseClient.rpc("delete_my_account");

        if (error) {

            console.error(error);

            errorElement.textContent =
                error.message || "Impossible de supprimer le compte.";

            confirmButton.disabled = false;

            return;

        }

        await logout();

    });

}



async function logout() {

    await supabaseClient.auth.signOut();

    currentUser = null;

    currentProfile = null;

    window.location.href =
        "index.html";

}



/* =========================================================
   13. SÉCURITÉ AFFICHAGE HTML
========================================================= */

function escapeHtml(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}



/* =========================================================
   14. INITIALISATION PAGE CONNEXION
========================================================= */

async function initAuthPage() {

    const loginForm =
        document.getElementById(
            "login-form"
        );


    const registerForm =
        document.getElementById(
            "register-form"
        );


    const showRegister =
        document.getElementById(
            "show-register"
        );


    const showLogin =
        document.getElementById(
            "show-login"
        );


    /*
        Si on est sur la page de connexion.
    */

    if (
        !loginForm ||
        !registerForm
    ) {

        return;

    }


    /*
        Vérification session existante.
    */

    const {
        data
    } = await supabaseClient.auth.getSession();


    if (data.session) {

        window.location.href =
            "app.html";

        return;

    }


    /*
        Afficher inscription.
    */

    showRegister.addEventListener(
        "click",
        () => {

            document
                .getElementById(
                    "login-section"
                )
                .classList.add(
                    "hidden"
                );


            document
                .getElementById(
                    "register-section"
                )
                .classList.remove(
                    "hidden"
                );

        }
    );


    /*
        Afficher connexion.
    */

    showLogin.addEventListener(
        "click",
        () => {

            document
                .getElementById(
                    "register-section"
                )
                .classList.add(
                    "hidden"
                );


            document
                .getElementById(
                    "login-section"
                )
                .classList.remove(
                    "hidden"
                );

        }
    );


    /*
        LOGIN
    */

    loginForm.addEventListener(
        "submit",
        async event => {

            event.preventDefault();


            const username =
                document.getElementById(
                    "login-username"
                ).value;


            const password =
                document.getElementById(
                    "login-password"
                ).value;


            const errorElement =
                document.getElementById(
                    "login-error"
                );


            errorElement.textContent = "";


            try {

                await loginUser(
                    username,
                    password
                );


                window.location.href =
                    "app.html";


            } catch (error) {

                console.error(error);


                errorElement.textContent =
                    error.message ||
                    "Connexion impossible.";

            }

        }
    );


    /*
        REGISTER
    */

    registerForm.addEventListener(
        "submit",
        async event => {

            event.preventDefault();


            const username =
                document.getElementById(
                    "register-username"
                ).value;


            const password =
                document.getElementById(
                    "register-password"
                ).value;


            const errorElement =
                document.getElementById(
                    "register-error"
                );


            errorElement.textContent = "";


            try {

                await registerUser(
                    username,
                    password
                );


                window.location.href =
                    "app.html";


            } catch (error) {

                console.error(error);


                errorElement.textContent =
                    error.message ||
                    "Impossible de créer le compte.";

            }

        }
    );

}



/* =========================================================
   15. INITIALISATION APPLICATION
========================================================= */

async function initAppPage() {

    const betsPage =
        document.getElementById(
            "bets-page"
        );


    /*
        Si ce n'est pas app.html,
        on arrête.
    */

    if (!betsPage) {

        return;

    }


    /*
        Vérification de la session.
    */

    const {
        data
    } = await supabaseClient.auth.getSession();


    if (!data.session) {

        window.location.href =
            "index.html";

        return;

    }


    currentUser =
        data.session.user;


    try {

        await loadCurrentProfile();

        await displayBets();

        await displayLeaderboard();

        await displayAdminMessage();

        await displayMyBets();

        await displayMyCreatedBets();

        await loadTargetUsers();

        await refreshMissions();


        if (currentProfile?.is_admin) {

            document
                .getElementById("admin-nav-button")
                .classList.remove("hidden");

            await displayPopupHistory();

        }


        await checkAnnouncementPopup();

        setupDeleteAccount();

        setupProfilePage();

        setupShopPreview();

        await initAnimations();

    } catch (error) {

        console.error(error);

    }


    /*
        Navigation.
    */

    document
        .querySelectorAll(".nav-button")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    showPage(
                        button.dataset.page
                    );


                    if (
                        button.dataset.page === "missions-page" ||
                        button.dataset.page === "shop-page"
                    ) {

                        refreshMissions();

                    }

                }
            );

        });


    /*
        Bouton créer un pari
        dans l'en-tête.
    */

    const createHeaderButton =
        document.getElementById(
            "create-bet-header-button"
        );


    if (createHeaderButton) {

        createHeaderButton.addEventListener(
            "click",
            () => {

                showPage(
                    "create-page"
                );

            }
        );

    }


    /*
        Formulaire création.
    */

    const createForm =
        document.getElementById(
            "create-bet-form"
        );


    const oddsOneInput =
        document.getElementById(
            "odds-one"
        );

    const oddsTwoInput =
        document.getElementById(
            "odds-two"
        );


    const hasTargetCheckbox =
        document.getElementById(
            "bet-has-target"
        );

    if (hasTargetCheckbox) {

        hasTargetCheckbox.addEventListener(
            "change",
            () => {

                document
                    .getElementById("bet-target-options")
                    .classList.toggle(
                        "hidden",
                        !hasTargetCheckbox.checked
                    );

            }
        );

    }


    if (oddsOneInput && oddsTwoInput) {

        oddsOneInput.addEventListener(
            "input",
            () => {

                const cote =
                    calculerCoteComplementaire(
                        Number(oddsOneInput.value)
                    );

                oddsTwoInput.value =
                    cote ? cote.toFixed(2) : "";

            }
        );

    }


    if (createForm) {

        createForm.addEventListener(
            "submit",
            async event => {

                event.preventDefault();

                await createBet();

            }
        );

    }


    /*
        Sélecteur d'échéance (jour + heure).
    */

    setupDeadlinePicker();

    /*
        Mise à jour gain potentiel.
    */

    const stakeInput =
        document.getElementById(
            "stake-input"
        );


    if (stakeInput) {

        stakeInput.addEventListener(
            "input",
            updatePotentialWin
        );

    }


    /*
        Confirmation pari.
    */

    const confirmBetButton =
        document.getElementById(
            "confirm-bet"
        );


    if (confirmBetButton) {

        confirmBetButton.addEventListener(
            "click",
            placeBet
        );

    }


    /*
        Fermeture modal pari.
    */

    const closeModal =
        document.getElementById(
            "close-modal"
        );


    if (closeModal) {

        closeModal.addEventListener(
            "click",
            () => {

                document
                    .getElementById(
                        "bet-modal"
                    )
                    .classList.add(
                        "hidden"
                    );

            }
        );

    }


    /*
        Fermeture modal résolution.
    */

    const closeResolveModal =
        document.getElementById(
            "close-resolve-modal"
        );


    if (closeResolveModal) {

        closeResolveModal.addEventListener(
            "click",
            () => {

                document
                    .getElementById(
                        "resolve-modal"
                    )
                    .classList.add(
                        "hidden"
                    );

            }
        );

    }


    /*
        Fermeture modal détail des parieurs.
    */

    const closeStakesModal =
        document.getElementById(
            "close-stakes-modal"
        );


    if (closeStakesModal) {

        closeStakesModal.addEventListener(
            "click",
            () => {

                document
                    .getElementById(
                        "stakes-modal"
                    )
                    .classList.add(
                        "hidden"
                    );

            }
        );

    }


    /*
        Fermeture modal annonce.
    */

    const closeAnnouncementModal =
        document.getElementById(
            "close-announcement-modal"
        );


    if (closeAnnouncementModal) {

        closeAnnouncementModal.addEventListener(
            "click",
            async () => {

                document
                    .getElementById(
                        "announcement-modal"
                    )
                    .classList.add(
                        "hidden"
                    );

                await markAnnouncementAsSeen(
                    currentAnnouncementId
                );

            }
        );

    }


    /*
        Formulaire nouveau popup (admin).
    */

    const popupMessageForm =
        document.getElementById(
            "popup-message-form"
        );


    if (popupMessageForm) {

        popupMessageForm.addEventListener(
            "submit",
            async event => {

                event.preventDefault();

                await createPopupMessage();

            }
        );

    }


    /*
        Formulaire message permanent (admin).
    */

    const permanentMessageForm =
        document.getElementById(
            "permanent-message-form"
        );


    if (permanentMessageForm) {

        permanentMessageForm.addEventListener(
            "submit",
            async event => {

                event.preventDefault();

                await savePermanentMessage();

            }
        );

    }


    /*
        Déconnexion.
    */

    const logoutButton =
        document.getElementById(
            "logout-button"
        );


    if (logoutButton) {

        logoutButton.addEventListener(
            "click",
            logout
        );

    }

}



/* =========================================================
   16. DÉMARRAGE
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        await initAuthPage();

        await initAppPage();

    }
);