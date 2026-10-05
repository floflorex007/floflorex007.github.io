/* =========================================================
   MISSIONS, POINTS ET AVANTAGES
   (chargé avant app.js ; utilise supabaseClient et escapeHtml
   définis dans app.js, appelés uniquement après l'initialisation)
   Les points, prix et conditions sont décidés côté Supabase
   (voir Missions.sql) ; ce fichier ne contient que l'affichage.
========================================================= */

const MISSIONS_TEXTES = {
    connexion_du_jour: {
        titre: "Connexion du jour",
        description: "Passe nous voir chaque jour.",
        difficulte: "Simple"
    },
    touche_a_tout: {
        titre: "Touche-à-tout",
        description: "Mise sur 3 paris différents cette semaine.",
        difficulte: "Simple"
    },
    premier_sur_le_coup: {
        titre: "Premier sur le coup",
        description: "Sois le premier à miser sur le pari d'un autre, dans l'heure qui suit sa création.",
        difficulte: "Moyen"
    },
    assidu: {
        titre: "Assidu",
        description: "Mise sur 5 jours différents cette semaine.",
        difficulte: "Simple"
    },
    gros_joueur: {
        titre: "Gros joueur",
        description: "Mise au total 500 € cette semaine.",
        difficulte: "Simple"
    },
    createur: {
        titre: "Créateur",
        description: "Crée 2 paris cette semaine.",
        difficulte: "Moyen"
    },
    premier_gain: {
        titre: "Premier gain",
        description: "Gagne un pari pour la première fois (mission unique).",
        difficulte: "Simple"
    },
    outsider: {
        titre: "Outsider",
        description: "Gagne un pari sur une cote d'au moins 3 (mise placée cette semaine).",
        difficulte: "Moyen"
    },
    contre_tous: {
        titre: "Contre tous",
        description: "Gagne un pari en ayant misé avec la minorité (25 % des parieurs ou moins, pari à 4 parieurs minimum).",
        difficulte: "Moyen"
    }
};

const MISSIONS_PERIODES = {
    day: "Quotidienne",
    week: "Hebdomadaire",
    once: "Unique"
};

const AVANTAGES_TEXTES = {
    badge_novice: {
        titre: "🎲 Badge Novice",
        description: "Affiche ce titre à côté de ton pseudo au classement."
    },
    badge_flambeur: {
        titre: "🔥 Badge Flambeur",
        description: "Affiche ce titre à côté de ton pseudo au classement."
    },
    badge_stratege: {
        titre: "🧠 Badge Stratège",
        description: "Affiche ce titre à côté de ton pseudo au classement."
    },
    badge_legende: {
        titre: "👑 Badge Légende",
        description: "Affiche ce titre à côté de ton pseudo au classement."
    },
    cadre_dore: {
        titre: "Cadre doré",
        description: "Ta ligne du classement est entourée d'or."
    },
    pseudo_couleur: {
        titre: "Pseudo en couleur",
        description: "Choisis la couleur de ton pseudo au classement."
    }
};

const BADGES_LIBELLES = {
    badge_novice: "🎲 Novice",
    badge_flambeur: "🔥 Flambeur",
    badge_stratege: "🧠 Stratège",
    badge_legende: "👑 Légende"
};


/* =========================================================
   CHARGEMENT ET AFFICHAGE
========================================================= */

function showMissionsMessage(text, isError) {

    const element =
        document.getElementById("missions-message");

    if (!element) {
        return;
    }

    element.textContent = text;
    element.classList.toggle("error", Boolean(isError));
    element.classList.remove("hidden");

}


async function displayMissions() {

    const missionsList =
        document.getElementById("missions-list");

    const perksList =
        document.getElementById("perks-list");

    if (!missionsList || !perksList) {
        return;
    }

    const { data, error } =
        await supabaseClient.rpc("get_missions_state");

    if (error) {

        console.error("Erreur get_missions_state :", error);

        showMissionsMessage(
            "Impossible de charger les missions. Le script Missions.sql a-t-il été exécuté ?",
            true
        );

        return;

    }

    document.getElementById("points-balance").textContent =
        data.points;

    missionsList.innerHTML = data.missions.map(mission => {

        const texte = MISSIONS_TEXTES[mission.id] || {
            titre: mission.id,
            description: "",
            difficulte: ""
        };

        const accomplie = mission.progress >= mission.target;

        const pourcentage = Math.min(
            100,
            Math.round(mission.progress / mission.target * 100)
        );

        let bouton;

        if (mission.claimed) {
            bouton = `<button class="mission-button" disabled>Réclamée ✓</button>`;
        } else if (accomplie) {
            bouton = `<button class="mission-button" data-claim="${escapeHtml(mission.id)}">Réclamer +${mission.points} pts</button>`;
        } else {
            bouton = `<button class="mission-button" disabled>${mission.progress} / ${mission.target}</button>`;
        }

        return `
            <div class="mission-card ${mission.claimed ? "done" : ""}">
                <div class="mission-card-top">
                    <h3>${escapeHtml(texte.titre)}</h3>
                    <span class="mission-reward">+${mission.points} pts</span>
                </div>
                <p>${escapeHtml(texte.description)}</p>
                <div class="mission-meta">
                    <span>${escapeHtml(MISSIONS_PERIODES[mission.period] || "")}</span>
                    <span>·</span>
                    <span>${escapeHtml(texte.difficulte)}</span>
                </div>
                <div class="mission-progress"><div style="width: ${pourcentage}%"></div></div>
                ${bouton}
            </div>
        `;

    }).join("");

    perksList.innerHTML = data.perks.map(perk => {

        const texte = AVANTAGES_TEXTES[perk.id] || {
            titre: perk.id,
            description: ""
        };

        let action;

        if (!perk.owned) {

            const assezDePoints = data.points >= perk.cost;

            action = `
                <button
                    class="mission-button"
                    data-buy="${escapeHtml(perk.id)}"
                    ${assezDePoints ? "" : "disabled"}
                >
                    Acheter · ${perk.cost} pts
                </button>
            `;

        } else if (perk.id === "pseudo_couleur") {

            const couleur =
                currentProfile?.username_color || "#6c63ff";

            action = `
                <div class="perk-controls">
                    <input
                        type="color"
                        id="perk-color-input"
                        value="${escapeHtml(couleur)}"
                    >
                    <button class="mission-button" data-equip="pseudo_couleur" data-value="color">Appliquer</button>
                    <button class="mission-button" data-equip="pseudo_couleur" data-value="off">Retirer</button>
                </div>
            `;

        } else if (perk.id === "cadre_dore") {

            const actif = Boolean(currentProfile?.gold_frame);

            action = `
                <button
                    class="mission-button"
                    data-equip="cadre_dore"
                    data-value="${actif ? "off" : "on"}"
                >
                    ${actif ? "Désactiver" : "Activer"}
                </button>
            `;

        } else {

            const actif =
                currentProfile?.equipped_badge === BADGES_LIBELLES[perk.id];

            action = `
                <button
                    class="mission-button"
                    data-equip="${escapeHtml(perk.id)}"
                    data-value="${actif ? "off" : "on"}"
                >
                    ${actif ? "Retirer" : "Équiper"}
                </button>
            `;

        }

        return `
            <div class="mission-card">
                <div class="mission-card-top">
                    <h3>${escapeHtml(texte.titre)}</h3>
                    <span class="mission-reward">${perk.owned ? "Possédé" : perk.cost + " pts"}</span>
                </div>
                <p>${escapeHtml(texte.description)}</p>
                ${action}
            </div>
        `;

    }).join("");

}


/* =========================================================
   ACTIONS
========================================================= */

async function missionsAction(rpcName, params, successText) {

    const { error } =
        await supabaseClient.rpc(rpcName, params);

    if (error) {

        console.error(error);

        showMissionsMessage(error.message || "Une erreur est survenue.", true);

        return;

    }

    // Les avantages équipés vivent dans profiles : on recharge le profil.
    await loadCurrentProfile();

    await displayMissions();

    if (typeof displayLeaderboard === "function") {
        await displayLeaderboard();
    }

    showMissionsMessage(successText, false);

}


function handleMissionsClick(event) {

    const bouton = event.target.closest("button");

    if (!bouton) {
        return;
    }

    if (bouton.dataset.claim) {

        missionsAction(
            "claim_mission",
            { p_mission: bouton.dataset.claim },
            "Points ajoutés !"
        );

    } else if (bouton.dataset.buy) {

        missionsAction(
            "buy_perk",
            { p_perk: bouton.dataset.buy },
            "Avantage acheté !"
        );

    } else if (bouton.dataset.equip) {

        let valeur = bouton.dataset.value;

        if (valeur === "color") {
            valeur = document.getElementById("perk-color-input").value;
        }

        missionsAction(
            "equip_perk",
            { p_perk: bouton.dataset.equip, p_value: valeur },
            "Avantage mis à jour."
        );

    }

}


/* =========================================================
   INITIALISATION (appelée par initAppPage)
========================================================= */

async function initMissions() {

    const page = document.getElementById("missions-page");

    if (!page) {
        return;
    }

    page.addEventListener("click", handleMissionsClick);

    document
        .querySelector('.nav-button[data-page="missions-page"]')
        .addEventListener("click", displayMissions);

    await displayMissions();

}


/* =========================================================
   RENDU D'UN PSEUDO AVEC SES AVANTAGES (classement)
========================================================= */

function renderPseudoHtml(profile) {

    const couleur =
        /^#[0-9a-fA-F]{6}$/.test(profile.username_color || "")
            ? ` style="color: ${profile.username_color}"`
            : "";

    const badge = profile.equipped_badge
        ? `<span class="leaderboard-badge">${escapeHtml(profile.equipped_badge)}</span>`
        : "";

    return `<span${couleur}>${escapeHtml(profile.username)}</span>${badge}`;

}
