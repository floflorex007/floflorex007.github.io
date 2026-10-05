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
        .select("username, balance, gold_frame_until, name_color_until")
        .eq("is_admin", false)
        .order("balance", { ascending: false })
        .limit(10);


    if (error) {
        console.error("Erreur getLeaderboard :", error);
        throw error;
    }


    return data || [];

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
                ? `
                    <div class="leaderboard-row leaderboard-row--admin">
                        <span class="leaderboard-rank">—</span>
                        <span class="leaderboard-medal">👑</span>
                        <span class="leaderboard-pseudo">${escapeHtml(currentProfile.username)}</span>
                        <span class="leaderboard-balance">∞</span>
                    </div>
                `
                : "";


        container.innerHTML = adminRow + profiles.map(
            (profile, index) => `
                <div class="leaderboard-row${isRewardActive(profile.gold_frame_until) ? " leaderboard-row--gold" : ""}">
                    <span class="leaderboard-rank">${index + 1}</span>
                    <span class="leaderboard-medal">${medals[index] || ""}</span>
                    <span class="leaderboard-pseudo${isRewardActive(profile.name_color_until) ? " pseudo-color" : ""}">${escapeHtml(profile.username)}</span>
                    <span class="leaderboard-balance">${formatMoney(profile.balance)}</span>
                </div>
            `
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
            profiles!bets_author_id_fkey ( username ),
            target:profiles!bets_target_user_id_fkey ( username ),
            stakes ( id, user_id, choice_id, stake, potential_win, profiles!stakes_user_id_fkey ( username ) )
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

    const author =
        bet.profiles?.username ||
        "Utilisateur";


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
                Créé par ${escapeHtml(author)}
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
                            ? `<span class="bet-target-footer">🎯 ${bet.target_blocked ? "Bloqué pour" : "Concerne"} ${escapeHtml(bet.target?.username || "un parieur")}</span>`
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
    ).textContent =
        `Créé par ${bet.profiles?.username || "Utilisateur"}`;


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


        data.forEach(
            stake => {

                const bet =
                    stake.bets;


                const choice =
                    stake.bet_choices;


                let statusText =
                    "En cours";


                if (
                    bet.status === "resolved"
                ) {

                    if (
                        bet.winner_choice_id ===
                        choice.id
                    ) {

                        statusText =
                            "Gagné";

                    } else {

                        statusText =
                            "Perdu";

                    }

                }


                const item =
                    document.createElement("div");


                item.className =
                    "my-bet-item" +
                    (statusText === "Gagné" ? " my-bet-won" : "") +
                    (statusText === "Perdu" ? " my-bet-lost" : "");


                item.innerHTML = `

                    <div>

                        <h3>
                            ${escapeHtml(
                                bet.question
                            )}
                        </h3>

                        <p>
                            Choix :
                            <strong>
                                ${escapeHtml(
                                    choice.label
                                )}
                            </strong>
                        </p>

                        <p>
                            Mise :
                            ${formatMoney(
                                stake.stake
                            )}
                        </p>

                        <p>
                            Gain potentiel :
                            ${formatMoney(
                                stake.potential_win
                            )}
                        </p>

                    </div>


                    <div>

                        <strong>
                            ${statusText}
                        </strong>

                    </div>

                `;


                container.appendChild(item);

            }
        );


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


                item.className =
                    "my-bet-item";


                const choices =
                    bet.bet_choices || [];


                let resolveButton = "";


                if (
                    bet.status === "open"
                ) {

                    resolveButton = `

                        <button
                            class="primary-button resolve-button"
                            data-bet-id="${bet.id}"
                        >
                            Valider le résultat
                        </button>

                    `;

                }


                item.innerHTML = `

                    <div>

                        <h3>
                            ${escapeHtml(
                                bet.question
                            )}
                        </h3>


                        <p>
                            Statut :
                            <strong>
                                ${escapeHtml(
                                    bet.status
                                )}
                            </strong>
                        </p>


                        <div class="created-bet-choices">

                            ${choices.map(
                                choice => `

                                    <span>
                                        ${escapeHtml(
                                            choice.label
                                        )}
                                        —
                                        ${Number(
                                            choice.odds
                                        ).toFixed(2)}
                                    </span>

                                `
                            ).join("")}

                        </div>

                    </div>


                    <div>

                        ${resolveButton}

                    </div>

                `;


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

function openResolveModal(bet) {

    currentResolveBet = bet;


    document.getElementById(
        "resolve-question"
    ).textContent =
        bet.question;


    const container =
        document.getElementById(
            "resolve-choices"
        );


    container.innerHTML = "";


    bet.bet_choices.forEach(
        choice => {

            const button =
                document.createElement(
                    "button"
                );


            button.className =
                "primary-button";


            button.textContent =
                choice.label;


            button.addEventListener(
                "click",
                () => {

                    resolveBet(
                        bet.id,
                        choice.id
                    );

                }
            );


            container.appendChild(button);

        }
    );


    document.getElementById(
        "resolve-error"
    ).textContent = "";


    document
        .getElementById(
            "resolve-modal"
        )
        .classList.remove("hidden");

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
                    ? `<span class="bet-target-footer">🎯 ${bet.target_blocked ? "Bloqué pour" : "Concerne"} ${escapeHtml(bet.target?.username || "un parieur")}</span>`
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

                const author =
                    stake.profiles?.username ||
                    "Utilisateur";

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
                        <strong>${escapeHtml(author)}</strong>
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


    const deadlineMode =
        document.querySelector(
            ".deadline-mode-toggle.active"
        )?.dataset.mode ||
        "none";


    let deadlineAt = null;


    if (deadlineMode === "datetime") {

        const deadlineDatetimeValue =
            document.getElementById(
                "bet-deadline-datetime"
            ).value;


        if (!deadlineDatetimeValue) {

            return;

        }


        deadlineAt =
            new Date(deadlineDatetimeValue).toISOString();

    } else if (deadlineMode === "time") {

        const deadlineTimeValue =
            document.getElementById(
                "bet-deadline-time"
            ).value;


        if (!deadlineTimeValue) {

            return;

        }


        const [hours, minutes] =
            deadlineTimeValue.split(":").map(Number);


        const todayWithTime =
            new Date();

        todayWithTime.setHours(hours, minutes, 0, 0);


        deadlineAt =
            todayWithTime.toISOString();

    }


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

        document.getElementById(
            "bet-deadline-datetime"
        ).classList.add("hidden");

        document.getElementById(
            "bet-deadline-time"
        ).classList.add("hidden");

        document
            .querySelectorAll(
                ".deadline-mode-toggle"
            )
            .forEach(button =>
                button.classList.remove("active")
            );


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
        description: "Ta ligne du classement passe en doré pendant 7 jours.",
        price: 250,
        field: "gold_frame_until"
    },
    {
        id: "couleur",
        title: "Pseudo en couleur",
        description: "Ton pseudo s'affiche en couleur dans le classement pendant 24 heures.",
        price: 100,
        field: "name_color_until"
    }
];


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


function displayShop() {

    const container =
        document.getElementById("shop-container");

    if (!container || !currentProfile) {
        return;
    }


    const points = currentProfile.points || 0;


    container.innerHTML = REWARDS.map(reward => {

        const until = currentProfile[reward.field];

        const active = isRewardActive(until);

        const canBuy = points >= reward.price;


        const status = active
            ? `<span class="mission-state done">Actif jusqu'au ${formatDeadline(until)}</span>`
            : `<span class="mission-state">${canBuy ? "Disponible" : "Il te manque " + (reward.price - points) + " pts"}</span>`;


        return `
            <div class="mission-card">

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
                        ${canBuy ? "" : "disabled"}
                    >
                        ${active ? "Prolonger" : "Acheter"}
                    </button>
                </div>

            </div>
        `;

    }).join("");


    container
        .querySelectorAll(".reward-buy")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => buyReward(button.dataset.reward, button)
            );

        });

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


        showMissionsMessage("Avantage activé !", false, "shop-message");

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
        Bascule des champs d'échéance
        selon le mode choisi.
    */

    const deadlineDatetimeInput =
        document.getElementById(
            "bet-deadline-datetime"
        );

    const deadlineTimeInput =
        document.getElementById(
            "bet-deadline-time"
        );


    document
        .querySelectorAll(
            ".deadline-mode-toggle"
        )
        .forEach(toggleButton => {

            toggleButton.addEventListener(
                "click",
                () => {

                    if (!deadlineDatetimeInput || !deadlineTimeInput) {

                        return;

                    }


                    const wasActive =
                        toggleButton.classList.contains("active");


                    document
                        .querySelectorAll(
                            ".deadline-mode-toggle"
                        )
                        .forEach(button =>
                            button.classList.remove("active")
                        );

                    deadlineDatetimeInput.classList.add("hidden");

                    deadlineTimeInput.classList.add("hidden");


                    if (wasActive) {

                        return;

                    }


                    toggleButton.classList.add("active");


                    if (toggleButton.dataset.mode === "datetime") {

                        deadlineDatetimeInput.classList.remove("hidden");

                    } else if (toggleButton.dataset.mode === "time") {

                        deadlineTimeInput.classList.remove("hidden");

                    }

                }
            );

        });


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