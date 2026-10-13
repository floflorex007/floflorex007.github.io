/* =========================================================
   BETLAB — VERSION BÊTA (passe de combat, voir saison.sql)

   Chargé pour tout le monde après app.js, mais ne fait rien
   sans la classe « beta » sur <body> (version classique).
   Choix de la version : carte du Profil (displayVersionCard
   dans app.js), réservé aux bêta-testeurs et à l'admin.
========================================================= */


const SEASON_XP_PER_TIER = 100;

const SEASON_TIERS = 30;

// Bonus de la flamme (mêmes paliers que flame_mult dans saison.sql).
const FLAME_STEPS = [
    { days: 3, mult: 1.2, icon: "🔥" },
    { days: 7, mult: 1.5, icon: "🔥" },
    { days: 15, mult: 1.75, icon: "🔥" },
    { days: 30, mult: 2, icon: "🔥" }
];

// Récompenses des paliers (table season_rewards), chargées une fois.
let seasonRewards = [];

// État du passe du joueur (fonction season_status).
let seasonState = null;

let seasonLoading = null;


function isBetaApp() {

    return document.body.classList.contains("beta");

}


/*
    Données du passe.
*/

async function loadSeason() {

    if (seasonLoading) {
        return seasonLoading;
    }

    seasonLoading = (async () => {

        const [status, rewards] = await Promise.all([
            supabaseClient.rpc("season_status"),
            seasonRewards.length
                ? { data: seasonRewards }
                : supabaseClient.from("season_rewards").select("*").order("tier")
        ]);

        if (status.error || rewards.error) {
            console.error(status.error || rewards.error);
            return;
        }

        seasonState = status.data;

        seasonRewards = rewards.data || [];

    })();

    try {
        await seasonLoading;
    } finally {
        seasonLoading = null;
    }

}


function seasonTier() {

    return Math.min(SEASON_TIERS, Math.floor((seasonState?.xp || 0) / SEASON_XP_PER_TIER));

}

// XP dans le palier en cours (0 à 99), 100 quand le passe est fini.
function seasonTierXp() {

    return seasonTier() >= SEASON_TIERS
        ? SEASON_XP_PER_TIER
        : (seasonState?.xp || 0) % SEASON_XP_PER_TIER;

}

function seasonReward(tier, track) {

    return seasonRewards.find(reward => reward.tier === tier && reward.track === track) || null;

}

function seasonClaimed(tier, track) {

    return (seasonState?.claims || []).some(claim => claim.tier === tier && claim.track === track);

}

// « libre » | « locked » (Gold sans le passe) | « claimable » | « claimed » | « » (pas atteint)
function seasonRewardState(tier, track) {

    if (track === "gold" && !seasonState?.gold) {
        return "locked";
    }

    if (seasonClaimed(tier, track)) {
        return "claimed";
    }

    return tier <= seasonTier() ? "claimable" : "";

}

function seasonClaimableCount() {

    return seasonRewards.filter(
        reward => seasonRewardState(reward.tier, reward.track) === "claimable"
    ).length;

}

// Nom du mois de la saison : « octobre ».
function seasonMonthName() {

    const [year, month] = (seasonState?.season || "").split("-").map(Number);

    if (!year) {
        return "";
    }

    return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" });

}

// « d'octobre », « de mars ».
function ofSeasonMonth() {

    const month = seasonMonthName();

    return (/^[aeiou]/i.test(month) ? "d'" : "de ") + month;

}

function seasonDaysLeft() {

    const end = new Date(seasonState?.ends_at || 0);

    return Math.max(0, Math.ceil((end - Date.now()) / 86400000));

}


/*
    Flamme : série du joueur et bonus d'XP.
*/

function flameStreak() {

    const shown = Number(document.getElementById("streak-count")?.textContent);

    return Number.isFinite(shown) && shown > 0
        ? shown
        : currentProfile?.streak_days || 0;

}

function flameMult(streak = flameStreak()) {

    let mult = 1;

    FLAME_STEPS.forEach(step => {

        if (streak >= step.days) {
            mult = step.mult;
        }

    });

    return mult;

}

function formatMult(mult) {

    return "×" + mult.toLocaleString("fr-FR");

}


/*
    Capsule du niveau (barre du haut) : remplace la jauge d'XP classique.
*/

function setupSeasonMini() {

    const xpMini = document.getElementById("xp-mini");

    if (!xpMini || document.getElementById("season-mini")) {
        return;
    }

    const button = document.createElement("button");

    button.type = "button";

    button.id = "season-mini";

    button.className = "xp-mini";

    button.setAttribute("aria-label", "Ton niveau du passe");

    button.innerHTML = `
        <span class="xp-mini-top">
            <span class="xp-mini-label" id="season-mini-label">Niv. 0</span>
            <span class="xp-mini-xp" id="season-mini-xp">0 / 100 XP</span>
        </span>
        <span class="xp-mini-bar"><span id="season-mini-fill" style="width:0%"></span></span>
    `;

    button.addEventListener("click", openPassPage);

    xpMini.after(button);

}

function renderSeasonMini() {

    if (!seasonState) {
        return;
    }

    const xp = seasonTierXp();

    document.getElementById("season-mini-label").textContent = "Niv. " + seasonTier();

    document.getElementById("season-mini-xp").textContent =
        seasonState.admin ? "XP ∞" : seasonTier() >= SEASON_TIERS ? "Passe fini" : xp + " / " + SEASON_XP_PER_TIER + " XP";

    document.getElementById("season-mini-fill").style.width = xp + "%";

}


/*
    Carte « Ma saison » en tête des paris (version B de demo-refonte-beta.html).
*/

const seasonCard = document.createElement("div");

seasonCard.className = "season-card";

seasonCard.addEventListener("click", openPassPage);

function renderSeasonCard() {

    // Colonne de droite de la page Paris, au-dessus du perroquet
    // (version C de demo-pass-droite.html), à la place de « Ton niveau ».
    const column = document.querySelector("#bets-page .right-column");

    if (!column || !seasonState) {
        return;
    }

    const tier = seasonTier();

    seasonCard.innerHTML = `
        <div class="season-card-level">${tier}</div>

        <div class="season-card-info">
            <b>Saison ${escapeHtml(ofSeasonMonth())}</b>
            <div class="season-bar"><i style="width:${seasonTierXp()}%"></i></div>
            <span>${seasonState.admin ? "XP ∞" : seasonTierXp() + "/" + SEASON_XP_PER_TIER + " XP"}</span>
        </div>
    `;

    // À côté de la carte « Série » (comme « Ton niveau » en classique).
    const place = column.querySelector(".level-streak-row") || column;

    if (place.firstElementChild !== seasonCard) {

        const firstTime = !seasonCard.isConnected;

        place.prepend(seasonCard);

        // La saison arrive après le chargement de la page : elle entre
        // à son tour en cascade, comme les autres colonnes.
        if (firstTime) {

            seasonCard.style.animationDelay = "0.06s";

            seasonCard.classList.add("cascade-in");

        }

    }

}


/*
    Page du passe.
*/

function setupPassPage() {

    if (document.getElementById("pass-page")) {
        return;
    }

    const page = document.createElement("section");

    page.id = "pass-page";

    page.className = "app-page hidden";

    document.getElementById("bets-page").after(page);

    setupPassClicks(page);


    // Polices de la maquette du pass (seulement dans la version bêta).
    const fonts = document.createElement("link");

    fonts.rel = "stylesheet";

    fonts.href = "https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700;800&family=DM+Sans:wght@400;500;700&display=swap";

    document.head.appendChild(fonts);


    // Onglet « Passe » juste après « Historique ».
    const historyButton = document.querySelector('.nav-button[data-page="my-bets-page"]');

    const button = document.createElement("button");

    button.className = "nav-button";

    button.dataset.page = "pass-page";

    button.textContent = "Pass";

    button.addEventListener("click", openPassPage);

    historyButton?.after(button);

}

function openPassPage() {

    // La cascade se joue sur la page dessinée (pas sur l'ancienne).
    showPage("pass-page", true);

    renderPassPage({ centerTier: true });

    cascadeIn(document.getElementById("pass-page"));

    // Données à jour : on recentre seulement si la piste n'était pas encore là.
    loadSeason().then(() => {

        refreshSeasonViews();

        loadPassToday();

    });

}

/*
    Admin : choix des récompenses de chaque niveau (admin_set_season_reward).
*/

let passEditMode = false;

// Tous les cosmétiques qu'on peut mettre dans le pass (une entrée par option),
// rangés par catégorie dans la fenêtre de choix.
const SEASON_CHOICES = [
    ...["🔥", "⚡", "🍀", "🦊", "💎", "🎯"].map(emoji => ({ cat: "Emojis", item: "emoji", opt: emoji, label: "Emoji " + emoji, icon: emoji })),
    { cat: "Emojis", item: "emoji_diamant", opt: null, label: "Diamant 💎", icon: "💎" },

    { cat: "Écritures", item: "neon", opt: "rose", label: "Néon rose", icon: "💗" },
    { cat: "Écritures", item: "neon", opt: "bleu", label: "Néon bleu", icon: "💙" },
    { cat: "Écritures", item: "neon", opt: "vert", label: "Néon vert", icon: "💚" },
    { cat: "Écritures", item: "neon", opt: "jaune", label: "Néon jaune", icon: "💛" },
    { cat: "Écritures", item: "scanner", opt: null, label: "Pseudo scanner", icon: "📡" },
    { cat: "Écritures", item: "etincelles", opt: null, label: "Étincelles", icon: "✨" },
    { cat: "Écritures", item: "metal_rose", opt: null, label: "Pseudo rose gold", icon: "🌸" },
    { cat: "Écritures", item: "metal_bronze", opt: null, label: "Pseudo bronze", icon: "🥉" },
    { cat: "Écritures", item: "metal_argent", opt: null, label: "Pseudo argent", icon: "🥈" },
    { cat: "Écritures", item: "metal_or", opt: null, label: "Pseudo or", icon: "🥇" },
    { cat: "Écritures", item: "neon_anime", opt: null, label: "Néon animé", icon: "🌈" },
    { cat: "Écritures", item: "fiole", opt: null, label: "Fiole qui bouillonne", icon: "🧪" },
    { cat: "Écritures", item: "ruban_chantier", opt: null, label: "Ruban chantier", icon: "🚧" },
    { cat: "Écritures", item: "couleur", opt: null, label: "Arc-en-ciel", icon: "🌈" },
    { cat: "Écritures", item: "cristal", opt: null, label: "Pseudo cristal", icon: "💠" },
    { cat: "Écritures", item: "pseudo_flamme", opt: null, label: "Pseudo enflammé", icon: "🔥" },
    { cat: "Écritures", item: "pseudo_terminal", opt: null, label: "Pseudo Terminal", icon: "💻" },
    { cat: "Écritures", item: "pseudo_glitch", opt: null, label: "Pseudo Glitch", icon: "👾" },

    { cat: "Cadres", item: "cadre", opt: null, label: "Cadre doré", icon: "🖼️" },
    { cat: "Cadres", item: "cadre_diamant", opt: null, label: "Cadre diamant", icon: "💠" },
    { cat: "Cadres", item: "aura", opt: null, label: "Aura", icon: "🌀" },

    { cat: "Thèmes de pari", item: "theme", opt: "carbone", label: "Thème Carbone", icon: "🃏" },
    { cat: "Thèmes de pari", item: "theme", opt: "sunset", label: "Thème Sunset", icon: "🌅" },
    { cat: "Thèmes de pari", item: "theme", opt: "galaxie", label: "Thème Galaxie", icon: "🌌" },
    { cat: "Thèmes de pari", item: "theme_diamant", opt: null, label: "Thème Diamant", icon: "💎" },

    ...[
        ["flamant", "Flamant", "🦩"],
        ["nuit", "Bleu nuit", "🌙"],
        ["violet", "Violet royal", "💜"],
        ["arctique", "Arctique", "❄️"],
        ["noir", "Noir et or", "🖤"],
        ["phenix", "Phénix", "🔥"]
    ].map(([id, name, icon]) => ({ cat: "Skins du perroquet", item: "skin_" + id, opt: null, label: "Skin " + name, icon })),
    { cat: "Skins du perroquet", item: "skin_cristal", opt: null, label: "Skin Cristal", icon: "💠" },

    { cat: "Pass", item: "pass_gold", opt: "now", label: "Pass Gold", icon: "★" },
    { cat: "Pass", item: "pass_gold", opt: "next", label: "Pass Gold du mois prochain", icon: "★" }
];

function openRewardPicker(tier, track) {

    const current = seasonReward(tier, track);

    // Articles déjà placés ailleurs dans le pass : grisés, avec leur place.
    // Les choisir ici les déplace (pas de doublon entre les deux pass).
    const usedElsewhere = choice => seasonRewards.find(reward =>
        reward.item === choice.item
        && (reward.opt || null) === choice.opt
        && !(reward.tier === tier && reward.track === track)
    );

    const back = document.createElement("div");

    back.className = "pass-picker-back";

    back.innerHTML = `
        <div class="pass-picker" role="dialog">
            <button type="button" class="pass-picker-close" aria-label="Fermer">×</button>

            <h3>Niveau ${tier} · ${track === "gold" ? "Gold" : "Classique"}</h3>

            <div class="pass-picker-grid">
                <button type="button" class="pass-picker-choice${current ? "" : " selected"}" data-choice="-1">
                    <span class="pass-edit-plus">∅</span>
                    <span class="pass-label">Aucune récompense</span>
                </button>

            </div>

            ${[...new Set(SEASON_CHOICES.map(choice => choice.cat))].map(cat => `
                <h4 class="pass-picker-cat">${escapeHtml(cat)}</h4>

                <div class="pass-picker-grid">
                    ${SEASON_CHOICES.map((choice, index) => {

                        if (choice.cat !== cat) {
                            return "";
                        }

                        const used = usedElsewhere(choice);

                        return `
                            <button
                                type="button"
                                class="pass-picker-choice${current && current.item === choice.item && (current.opt || null) === choice.opt ? " selected" : ""}${used ? " used used-" + used.track : ""}"
                                data-choice="${index}"
                                ${used ? `data-used-tier="${used.tier}" data-used-track="${used.track}"` : ""}
                            >
                                ${used
                                    ? `<span class="pass-used-tag">${used.track === "gold" ? "Gold" : "Classique"} · niv. ${used.tier}</span>`
                                    : ""
                                }
                                <span class="pass-preview">${seasonPreviewHtml(choice)}</span>
                                <span class="pass-label">${escapeHtml(choice.label)}</span>
                            </button>
                        `;

                    }).join("")}
                </div>
            `).join("")}
        </div>
    `;

    const close = () => back.remove();

    back.addEventListener("click", event => {

        if (event.target === back) {
            close();
        }

    });

    back.querySelector(".pass-picker-close").addEventListener("click", close);

    back.querySelectorAll("[data-choice]").forEach(button => {

        button.addEventListener("click", async () => {

            const choice = SEASON_CHOICES[Number(button.dataset.choice)] || null;

            back.querySelectorAll("[data-choice]").forEach(other => other.disabled = true);

            // Article déjà placé ailleurs : on vide son ancienne case (déplacement).
            if (button.dataset.usedTier) {

                const { error: moveError } = await supabaseClient.rpc("admin_set_season_reward", {
                    p_tier: Number(button.dataset.usedTier),
                    p_track: button.dataset.usedTrack,
                    p_item: null,
                    p_opt: null,
                    p_label: null,
                    p_icon: null
                });

                if (moveError) {

                    alertToast(escapeHtml(moveError.message));

                    back.querySelectorAll("[data-choice]").forEach(other => other.disabled = false);

                    return;

                }

            }

            const { error } = await supabaseClient.rpc("admin_set_season_reward", {
                p_tier: tier,
                p_track: track,
                p_item: choice?.item ?? null,
                p_opt: choice?.opt ?? null,
                p_label: choice?.label ?? null,
                p_icon: choice?.icon ?? null
            });

            if (error) {

                alertToast(escapeHtml(error.message));

                back.querySelectorAll("[data-choice]").forEach(other => other.disabled = false);

                return;

            }

            close();

            // Récompenses rechargées depuis la base.
            seasonRewards = [];

            await loadSeason();

            refreshSeasonViews();

        });

    });

    document.body.appendChild(back);

}


/*
    Aperçu du cosmétique dans sa case, sur mon propre pseudo
    (mêmes styles que la boutique, voir openShopPreview dans app.js).
*/

function seasonPreviewHtml(reward) {

    const me = { username: currentProfile?.username || "Toi" };

    const item = reward.item || "";

    const option = reward.opt;

    // Pass Gold : une étiquette dorée, sans icône.
    if (item === "pass_gold") {

        return `<span class="pass-preview-gold">PASS GOLD${option === "next" ? "<small>mois prochain</small>" : ""}</span>`;

    }

    if (item === "theme" || item === "theme_diamant") {

        const theme = item === "theme" ? option : "diamant";

        return `<div class="bet-card bet-card-theme bet-theme-${escapeHtml(theme)} pass-preview-theme">Pari</div>`;

    }

    // Cadres : une petite ligne du classement.
    const frames = {
        aura: "leaderboard-row--aura",
        cadre: "leaderboard-row--gold",
        cadre_diamant: "leaderboard-row--diamond"
    };

    if (frames[item]) {

        return `<div class="leaderboard-row ${frames[item]} pass-preview-aura">${nameHtml(me, {})}</div>`;

    }

    // Skins du perroquet : la vignette du skin.
    if (item.startsWith("skin_")) {

        return `<img class="pass-preview-skin" src="assets/perroquet/skins/${escapeHtml(item.slice(5))}/thumb.png" alt="" loading="lazy">`;

    }

    return `<span class="user-name pass-preview-name">${nameHtml(me, seasonNameEffects(reward))}</span>`;

}

// Effet d'un cosmétique du passe sur le pseudo (pour nameHtml / leaderboardRowHtml).
function seasonNameEffects(reward) {

    const item = reward.item || "";

    const option = reward.opt;

    return {
        metal: item.startsWith("metal_") ? item.slice(6) : null,
        anim: NAME_ANIMATIONS.includes(item) ? item : null,
        neon: item === "neon" ? option : null,
        emoji: item === "emoji" ? option : null,
        sparkle: item === "etincelles",
        rainbow: item === "couleur",
        cristal: item === "cristal",
        diamondEmoji: item === "emoji_diamant",
        flame: item === "pseudo_flamme",
        beta: item === "pseudo_terminal" ? "terminal" : item === "pseudo_glitch" ? "glitch" : null,
        gold: item === "cadre",
        aura: item === "aura",
        diamondFrame: item === "cadre_diamant"
    };

}

/*
    Aperçu en grand d'une récompense du passe (clic sur une case pas
    récupérable) : animations visibles, débloquée ou non.
*/
function openRewardPreview(tier, track) {

    const reward = seasonReward(tier, track);

    if (!reward) {
        return;
    }

    const me = { username: currentProfile?.username || "Toi" };

    const item = reward.item || "";

    const state = seasonRewardState(tier, track);

    const status =
        state === "claimed" ? "✓ Déjà obtenue"
        : state === "locked" ? "🔒 Pass Gold requis pour la récupérer"
        : "🔒 Débloquée au niveau " + tier;

    let stage;

    if (item.startsWith("skin_")) {

        // Le perroquet en pose « gagné » avec ce skin.
        const folder = "assets/perroquet/skins/" + escapeHtml(item.slice(5)) + "/";

        stage = `<img class="pass-big-skin" src="${folder}win-main.png" alt="" onerror="this.onerror=null;this.src='${folder}thumb.png'">`;

    } else if (item === "theme" || item === "theme_diamant") {

        const theme = item === "theme" ? reward.opt : "diamant";

        stage = `
            <div class="bet-card bet-card-theme bet-theme-${escapeHtml(theme)} shop-preview-bet">
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

    } else if (item === "pass_gold") {

        stage = `<span class="pass-preview pass-big-gold">${seasonPreviewHtml(reward)}</span>`;

    } else {

        // Mon pseudo dans le classement, entre deux joueurs sans effet.
        stage = `
            <div class="shop-preview-board">
                ${leaderboardRowHtml({ username: "Emma" }, { rank: 2, medal: "🥈", balance: formatBalance(1840), effects: {}, extraClass: " shop-preview-dim" })}
                ${leaderboardRowHtml(me, { rank: 3, medal: "🥉", balance: formatBalance(1520), effects: seasonNameEffects(reward) })}
                ${leaderboardRowHtml({ username: "Lucas" }, { rank: 4, medal: "", balance: formatBalance(1310), effects: {}, extraClass: " shop-preview-dim" })}
            </div>
        `;

    }

    const back = document.createElement("div");

    back.className = "pass-picker-back";

    back.innerHTML = `
        <div class="pass-picker pass-reward-preview" role="dialog" aria-label="Aperçu : ${escapeHtml(reward.label)}">
            <button type="button" class="pass-picker-close" aria-label="Fermer">×</button>

            <h3>${escapeHtml(reward.label)}</h3>

            <p class="pass-reward-preview-sub">Niveau ${tier} · ${track === "gold" ? "Gold" : "Classique"}</p>

            <div class="pass-reward-preview-stage">${stage}</div>

            <p class="pass-reward-preview-status${state === "claimed" ? " done" : ""}">${status}</p>
        </div>
    `;

    const close = () => back.remove();

    back.addEventListener("click", event => {

        if (event.target === back) {
            close();
        }

    });

    back.querySelector(".pass-picker-close").addEventListener("click", close);

    document.body.appendChild(back);

}

/*
    Dessin de la page (maquette « Pass de combat » de Claude Design) :
    en-tête, anneau du niveau, piste à deux rangées
    (classique / Gold) reliées par le rail des niveaux, XP du jour.
    Toutes les classes commencent par « bp- » (voir beta.css).
*/

// Largeur d'une colonne de la piste (un niveau), voir .bp-col dans beta.css.
const PASS_COL = 140;

// Périmètre de l'anneau du niveau (rayon 60).
const PASS_RING = 376.99;

// XP affichée la dernière fois : l'anneau, la barre et le rail repartent
// de là et glissent jusqu'à l'XP actuelle (+ bannière si un niveau est passé).
let passShownXp = null;

// Récompense qui vient d'être récupérée (« classique12 ») : petit rebond.
let passPopId = null;

// XP gagnée aujourd'hui (table season_xp), chargée à l'ouverture du pass.
let passTodayXp = null;

// Couleur d'une récompense selon son niveau (bleu, violet, or).
function passRewardColor(reward) {

    if (reward.item === "pass_gold" || reward.tier >= 20) {
        return "#ffb02e";
    }

    return reward.tier >= 10 ? "#b46bff" : "#5aa9ff";

}

// Avancement pour une XP donnée : niveau atteint, XP dans le niveau,
// et position du rail (en colonnes, le nœud du niveau n au milieu de sa colonne).
function passProgress(xp) {

    const tier = Math.min(SEASON_TIERS, Math.floor(xp / SEASON_XP_PER_TIER));

    const done = tier >= SEASON_TIERS;

    const into = done ? SEASON_XP_PER_TIER : xp % SEASON_XP_PER_TIER;

    return {
        tier,
        done,
        into,
        pct: into / SEASON_XP_PER_TIER,
        pos: done ? SEASON_TIERS : xp / SEASON_XP_PER_TIER - 0.5
    };

}

function passRailFill(progress, level) {

    return Math.round(Math.max(0, Math.min(1, progress.pos - (level - 1))) * 100);

}

function passNodeClass(progress, level) {

    return level < progress.tier ? "bp-n-done" : level === progress.tier ? "bp-n-cur" : "bp-n-todo";

}

// Textes qui changent avec l'XP (aussi mis à jour pendant le glissement).
function passXpTexts(progress) {

    if (seasonState.admin) {
        return { xp: "XP ∞", next: "Admin : tous les niveaux sont atteints" };
    }

    if (progress.done) {
        return { xp: "Niveau maximum", next: "Toutes les récompenses sont à toi" };
    }

    return {
        xp: progress.into + " / " + SEASON_XP_PER_TIER + " XP",
        next: "Plus que " + (SEASON_XP_PER_TIER - progress.into) + " XP pour le niveau " + (progress.tier + 1)
    };

}

const PASS_LOCK_SVG = color => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="${color}"/><path d="M8 11V8a4 4 0 118 0v3"/></svg>`;

const PASS_CHECK_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#86efc0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

const PASS_CROWN_SVG = (size, color) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" aria-hidden="true"><path d="M3 18l-1-11 6 5 4-8 4 8 6-5-1 11z"/></svg>`;

// Carte d'une récompense dans la piste.
function passCardHtml(tier, track) {

    const reward = seasonReward(tier, track);

    const isGold = track === "gold";

    // Admin en train de choisir les récompenses : chaque case s'ouvre au clic.
    if (passEditMode) {

        return `
            <button
                type="button"
                class="bp-card editing${reward ? "" : " bp-empty"}"
                style="--rc:${reward ? passRewardColor(reward) : "#6c63ff"}"
                data-edit-tier="${tier}"
                data-edit-track="${track}"
                aria-label="Niveau ${tier} ${isGold ? "Gold" : "classique"} : choisir la récompense"
            >
                ${reward
                    ? `<span class="bp-card-art pass-preview">${seasonPreviewHtml(reward)}</span>
                       <span class="bp-card-label">${escapeHtml(reward.label)}</span>`
                    : `<span class="pass-edit-plus">+</span>`
                }
            </button>
        `;

    }

    // Niveau sans récompense : emplacement vide.
    if (!reward) {
        return `<div class="bp-card bp-empty" aria-hidden="true"></div>`;
    }

    const state = seasonRewardState(tier, track);

    const reached = tier <= passProgress(seasonState.xp || 0).tier;

    let cls = "lock";

    let status = "Niv. " + tier;

    let statCls = "bp-st-lock";

    if (state === "claimed") {

        cls = "done";
        status = "Obtenu";
        statCls = "bp-st-done";

    } else if (state === "claimable") {

        cls = "ready";
        status = "Récupérer";
        statCls = "bp-st-ready";

    } else if (state === "locked") {

        cls = "plock";
        status = reached ? "Gold requis" : "Gold";
        statCls = "bp-st-gold";

    }

    if (tier % 5 === 0) {
        cls += " ms";
    }

    if (passPopId === track + tier) {
        cls += " pop";
    }

    const aria = reward.label + ", niveau " + tier + (isGold ? ", Gold" : "") + " : "
        + (state === "claimed" ? "obtenue" : state === "claimable" ? "prête à récupérer" : state === "locked" ? "verrouillée, Pass Gold requis" : "verrouillée");

    return `
        <button
            type="button"
            class="bp-card ${cls}"
            style="--rc:${passRewardColor(reward)}"
            aria-label="${escapeHtml(aria)}"
            ${state === "claimable" ? `data-claim-tier="${tier}" data-claim-track="${track}"` : ""}
            ${state === "claimable" ? "" : `data-preview-tier="${tier}" data-preview-track="${track}"`}
        >
            <span class="bp-corner">
                ${state === "claimed" ? PASS_CHECK_SVG : state === "claimable" ? "" : PASS_LOCK_SVG(isGold ? "#ffc857" : "#b4b0d4")}
            </span>
            <span class="bp-card-art pass-preview">${seasonPreviewHtml(reward)}</span>
            <span class="bp-card-label">${escapeHtml(reward.label)}</span>
            <span class="bp-stat ${statCls}">${status}</span>
        </button>
    `;

}

// XP du jour (remplace les « missions » de la maquette) : ce qui rapporte
// de l'XP de saison (triggers de saison.sql) et où on en est aujourd'hui.
function passTodayHtml() {

    const mult = flameMult();

    const count = reason => (passTodayXp || []).filter(row => row.reason === reason).length;

    const rows = [
        { title: "Venir sur le site", reason: "connexion", target: 1, base: 10 },
        { title: "Créer un pari", reason: "creation", target: 3, base: 15 },
        { title: "Miser sur un pari", reason: "mise", target: null, base: 20 },
        { title: "Récupérer un pari gagné", reason: "gain", target: null, base: 30 }
    ];

    const total = (passTodayXp || []).reduce((sum, row) => sum + row.amount, 0);

    // Heures avant minuit (heure de Paris), quand les limites du jour repartent.
    const parisHour = Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }));

    const hoursLeft = Math.max(1, 24 - (Number.isFinite(parisHour) ? parisHour : 0));

    return `
        <div class="bp-missions-head">
            <h2 class="bp-disp">XP du jour</h2>
            <span>${passTodayXp ? "+" + total + " XP aujourd'hui · " : ""}renouvelée dans ${hoursLeft} h</span>
            ${mult > 1 ? `<span class="bp-flame">Flamme ${formatMult(mult)} sur l'XP</span>` : ""}
        </div>

        <div class="bp-missions-grid">
            ${rows.map(row => {

                const done = count(row.reason);

                const xpText = "+" + Math.round(row.base * mult) + " XP" + (row.target === 1 ? "" : " chacun");

                return `
                    <div class="bp-mission">
                        <div class="bp-mission-top">
                            <span>${row.title}</span>
                            <span class="bp-disp bp-mission-xp">${xpText}</span>
                        </div>
                        <div class="bp-mission-bottom">
                            ${row.target
                                ? `<div class="bp-bar bp-bar-thin"><div class="bp-barfill" style="width:${Math.round(Math.min(1, done / row.target) * 100)}%"></div></div>
                                   <span class="bp-mission-count">${passTodayXp ? Math.min(done, row.target) : "–"}/${row.target}</span>`
                                : `<span class="bp-mission-free">Sans limite · ${passTodayXp ? done : "–"} aujourd'hui</span>`
                            }
                        </div>
                    </div>
                `;

            }).join("")}
        </div>
    `;

}

async function loadPassToday() {

    if (!seasonState) {
        return;
    }

    // Les 36 dernières heures, puis seulement aujourd'hui (heure de Paris).
    const { data, error } = await supabaseClient
        .from("season_xp")
        .select("reason, amount, created_at")
        .eq("season", seasonState.season)
        .gte("created_at", new Date(Date.now() - 36 * 3600000).toISOString());

    if (error) {

        console.error(error);

        return;

    }

    const parisDay = date => new Date(date).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });

    const today = parisDay(Date.now());

    passTodayXp = (data || []).filter(row => parisDay(row.created_at) === today);

    const box = document.getElementById("bp-missions");

    if (box) {
        box.innerHTML = passTodayHtml();
    }

}

// Animations des aperçus : seulement dans les colonnes visibles de la piste.
let passAnimationObserver = null;

function watchPassAnimations(track) {

    passAnimationObserver?.disconnect();

    if (!("IntersectionObserver" in window)) {

        track.querySelectorAll(".pass-cell").forEach(cell => cell.classList.add("in-view"));

        return;

    }

    passAnimationObserver = new IntersectionObserver(entries => {

        entries.forEach(entry => entry.target.classList.toggle("in-view", entry.isIntersecting));

    }, { root: track, rootMargin: "0px 140px" });

    track.querySelectorAll(".pass-cell").forEach(cell => passAnimationObserver.observe(cell));

}

// Place la piste sur mon niveau.
function passScrollToTier(behavior = "smooth") {

    const track = document.getElementById("bp-track");

    if (!track || !seasonState) {
        return;
    }

    const tier = Math.max(1, passProgress(seasonState.xp || 0).tier);

    track.scrollTo({ left: Math.max(0, (tier - 0.5) * PASS_COL - track.clientWidth / 2), behavior });

}

// Anneau, barres et rail pour une XP donnée (le CSS les fait glisser).
function applyPassProgress(page, xp) {

    const progress = passProgress(xp);

    const texts = passXpTexts(progress);

    page.querySelector("[data-bp='ring']")?.setAttribute("stroke-dashoffset", (PASS_RING * (1 - (progress.done ? 1 : progress.pct))).toFixed(1));

    page.querySelectorAll("[data-bp='level']").forEach(element => element.textContent = progress.tier);

    page.querySelector("[data-bp='xp']").textContent = texts.xp;

    page.querySelector("[data-bp='next']").textContent = texts.next;

    page.querySelector("[data-bp='bar']").style.width = Math.round((progress.done ? 1 : progress.pct) * 100) + "%";

    page.querySelectorAll(".bp-rail-fill").forEach(fill => {

        fill.style.width = passRailFill(progress, Number(fill.dataset.level)) + "%";

    });

    page.querySelectorAll(".bp-node").forEach(node => {

        node.className = "bp-node " + passNodeClass(progress, Number(node.dataset.level));

    });

}

// Petit message en bas de l'écran (toast de la maquette).
let passToastTimer = null;

function passSay(message) {

    document.querySelector(".bp-toast-wrap")?.remove();

    clearTimeout(passToastTimer);

    const wrap = document.createElement("div");

    wrap.className = "bp-toast-wrap";

    wrap.innerHTML = `<div class="bp-toast" role="status">${escapeHtml(message)}</div>`;

    document.body.appendChild(wrap);

    passToastTimer = setTimeout(() => wrap.remove(), 2600);

}

// Bannière « Niveau supérieur » avec ses rayons et ses confettis.
let passBannerTimer = null;

function showPassLevelUp(level) {

    document.querySelector(".bp-banner-wrap")?.remove();

    clearTimeout(passBannerTimer);

    const colors = ["#ffc857", "#ff5fa8", "#8b6bff", "#3ee0a0"];

    let parts = "";

    for (let i = 0; i < 18; i++) {

        const angle = (i / 18) * Math.PI * 2;

        const distance = 130 + (i % 3) * 50;

        parts += `<span class="bp-p" aria-hidden="true" style="--dx:${Math.round(Math.cos(angle) * distance)}px;--dy:${Math.round(Math.sin(angle) * distance * 0.7)}px;background:${colors[i % 4]};animation-delay:${((i % 5) * 0.05).toFixed(2)}s"></span>`;

    }

    const wrap = document.createElement("div");

    wrap.className = "bp-banner-wrap";

    wrap.innerHTML = `
        <button type="button" class="bp-banner" aria-label="Niveau ${level} atteint, fermer">
            <span class="bp-rays" aria-hidden="true"></span>
            ${parts}
            <span class="bp-banner-text">
                <span class="bp-banner-kicker">NIVEAU SUPÉRIEUR</span>
                <span class="bp-disp bp-banner-level">Niveau ${level}</span>
                <span class="bp-banner-sub">De nouvelles récompenses t'attendent</span>
            </span>
        </button>
    `;

    const close = () => {

        clearTimeout(passBannerTimer);

        wrap.remove();

    };

    wrap.querySelector(".bp-banner").addEventListener("click", () => {

        close();

        passScrollToTier();

    });

    document.body.appendChild(wrap);

    passBannerTimer = setTimeout(close, 4200);

}

function renderPassPage({ centerTier = false } = {}) {

    const page = document.getElementById("pass-page");

    if (!page) {
        return;
    }

    // Position de la piste et de la page avant le redessin.
    const previousScroll = page.querySelector("#bp-track")?.scrollLeft || 0;

    const previousPageScroll = window.scrollY;

    const previousAdmin = page.querySelector("#pass-admin .pass-admin-list")
        ? page.querySelector("#pass-admin").innerHTML
        : "";

    // Première fois que la piste s'affiche : on la centre sur mon niveau.
    if (!page.querySelector("#bp-track")) {
        centerTier = true;
    }

    if (!seasonState) {

        page.innerHTML = `<p class="empty-state">Chargement du pass...</p>`;

        return;

    }

    const xp = seasonState.admin
        ? SEASON_TIERS * SEASON_XP_PER_TIER
        : Math.min(SEASON_TIERS * SEASON_XP_PER_TIER, seasonState.xp || 0);

    // XP gagnée depuis le dernier affichage : tout part de l'ancienne valeur.
    const fromXp = passShownXp !== null && passShownXp < xp ? passShownXp : xp;

    passShownXp = xp;

    const from = passProgress(fromXp);

    const now = passProgress(xp);

    const texts = passXpTexts(from);

    const ready = passEditMode ? 0 : seasonClaimableCount();

    const days = seasonDaysLeft();

    let cols = "";

    for (let level = 1; level <= SEASON_TIERS; level++) {

        cols += `
            <div class="bp-col pass-cell">
                <div class="bp-lane bp-lane-classic">${passCardHtml(level, "classique")}</div>
                <div class="bp-rail">
                    <div class="bp-rail-line"></div>
                    <div class="bp-rail-fill" data-level="${level}" style="width:${passRailFill(from, level)}%"></div>
                    <div class="bp-node ${passNodeClass(from, level)}" data-level="${level}">${level}</div>
                </div>
                <div class="bp-lane bp-lane-gold">${passCardHtml(level, "gold")}</div>
            </div>
        `;

    }

    page.innerHTML = `
        <div class="bp">

            <header class="bp-head bp-cascade">
                <div class="bp-head-title">
                    <span class="bp-kicker">Saison ${escapeHtml(ofSeasonMonth())}</span>
                    <h1 class="bp-disp">Pass de combat</h1>
                </div>

                <div class="bp-head-actions">
                    <span class="bp-chip">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a39fc4" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                        ${days <= 1 ? "Dernier jour de la saison" : "Fin de saison dans " + days + " jours"}
                    </span>

                    ${currentProfile?.is_admin
                        ? `<button type="button" class="bp-ghost${passEditMode ? " bp-ghost-on" : ""}" data-bp-action="edit">
                            ${passEditMode ? "Terminer" : "Choisir les récompenses"}
                          </button>`
                        : ""
                    }

                    ${seasonState.gold
                        ? `<span class="bp-gold-on">${PASS_CROWN_SVG(18, "#ffd36b")} Pass Gold actif</span>`
                        : `<button type="button" class="bp-cta bp-cta-gold" data-bp-action="gold">${PASS_CROWN_SVG(20, "#2a1700")} Passer au Gold</button>`
                    }
                </div>
            </header>

            ${passEditMode
                ? `<p class="pass-edit-hint">Clique une case pour choisir sa récompense (ou la vider). Les joueurs voient le changement tout de suite.</p>`
                : ""
            }

            <section class="bp-hero">

                <div class="bp-level bp-cascade">
                    <div class="bp-ring">
                        <svg width="220" height="220" viewBox="0 0 150 150" aria-hidden="true">
                            <defs><linearGradient id="bp-ring-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b6bff"/><stop offset="1" stop-color="#ff5fa8"/></linearGradient></defs>
                            <circle cx="75" cy="75" r="60" fill="none" stroke="#25214a" stroke-width="12"/>
                            <circle data-bp="ring" cx="75" cy="75" r="60" fill="none" stroke="url(#bp-ring-gradient)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${PASS_RING}" stroke-dashoffset="${(PASS_RING * (1 - (from.done ? 1 : from.pct))).toFixed(1)}" transform="rotate(-90 75 75)"/>
                        </svg>
                        <div class="bp-ring-center">
                            <span class="bp-ring-label">NIVEAU</span>
                            <span class="bp-disp bp-ring-level" data-bp="level">${from.tier}</span>
                        </div>
                    </div>

                    <div class="bp-level-info">
                        <div class="bp-level-texts">
                            <span class="bp-disp bp-level-xp" data-bp="xp">${texts.xp}</span>
                            <span class="bp-level-next" data-bp="next">${texts.next}</span>
                        </div>
                        <div class="bp-bar bp-bar-big"><div class="bp-barfill" data-bp="bar" style="width:${Math.round((from.done ? 1 : from.pct) * 100)}%"></div></div>
                        ${ready
                            ? `<div class="bp-level-actions">
                                <button type="button" class="bp-ghost bp-ghost-ready" data-bp-action="claim-all">Tout récupérer (${ready})</button>
                              </div>`
                            : ""
                        }
                    </div>
                </div>


            </section>

            <section class="bp-section bp-cascade">
                <div class="bp-section-head">
                    <h2 class="bp-disp">Récompenses</h2>
                    <div class="bp-section-buttons">
                        <button type="button" class="bp-ghost" data-bp-action="go-mine">Aller à mon niveau</button>
                        <button type="button" class="bp-ghost bp-ghost-square" data-bp-action="left" aria-label="Défiler vers la gauche"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
                        <button type="button" class="bp-ghost bp-ghost-square" data-bp-action="right" aria-label="Défiler vers la droite"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
                    </div>
                </div>

                <div class="bp-board">
                    <div class="bp-labels">
                        <div class="bp-label-classic">Classique</div>
                        <div class="bp-label-level">Niveau</div>
                        <div class="bp-label-gold">${PASS_CROWN_SVG(22, "#ffd36b")} Gold</div>
                    </div>

                    <div class="bp-track" id="bp-track">
                        <div class="bp-cols">${cols}</div>
                    </div>
                </div>
            </section>

            <section class="bp-missions bp-cascade" id="bp-missions">${passTodayHtml()}</section>

            ${currentProfile?.is_admin
                ? `<div class="pass-box pass-admin bp-cascade" id="pass-admin"><p class="empty-state">Chargement des joueurs...</p></div>`
                : ""
            }

        </div>
    `;

    const track = page.querySelector("#bp-track");

    watchPassAnimations(track);

    if (centerTier) {

        passScrollToTier("instant");

    } else {

        // Redessin (récompense récupérée...) : la piste et la page ne bougent pas.
        track.scrollLeft = previousScroll;

        window.scrollTo({ top: previousPageScroll, behavior: "instant" });

    }

    // XP gagnée depuis la dernière fois : « +N XP », tout glisse jusqu'à l'XP
    // actuelle, et la bannière si un niveau a été passé.
    if (fromXp < xp) {

        const ring = page.querySelector(".bp-ring");

        const gain = document.createElement("span");

        gain.className = "bp-gain";

        gain.textContent = "+" + (xp - fromXp) + " XP";

        ring.appendChild(gain);

        setTimeout(() => gain.remove(), 1100);

        requestAnimationFrame(() => requestAnimationFrame(() => applyPassProgress(page, xp)));

        loadPassToday();

        if (now.tier > from.tier) {

            ring.classList.add("bp-ringpulse");

            showPassLevelUp(now.tier);

        }

    }

    if (currentProfile?.is_admin) {

        // L'ancienne liste reste affichée pendant le rechargement (pas de saut).
        if (previousAdmin) {
            page.querySelector("#pass-admin").innerHTML = previousAdmin;
        }

        renderPassAdmin();

    }

}

// Clics de la page du pass (un seul écouteur, la page est redessinée souvent).
function setupPassClicks(page) {

    page.addEventListener("click", event => {

        const button = event.target.closest("button");

        if (!button || button.disabled || !page.contains(button)) {
            return;
        }

        const track = document.getElementById("bp-track");

        if (button.dataset.editTier) {

            openRewardPicker(Number(button.dataset.editTier), button.dataset.editTrack);

            return;

        }

        if (button.dataset.claimTier) {

            claimSeasonReward(Number(button.dataset.claimTier), button.dataset.claimTrack, button);

            return;

        }

        if (button.dataset.previewTier) {

            openRewardPreview(Number(button.dataset.previewTier), button.dataset.previewTrack);

            return;

        }

        switch (button.dataset.bpAction) {

            case "edit":

                passEditMode = !passEditMode;

                renderPassPage();

                break;

            case "gold":

                passSay("Pendant la bêta, le Gold est offert par l'admin (ou gagné au niveau 30 du classique)");

                break;

            case "claim-all":

                claimAllSeasonRewards(button);

                break;

            case "go-mine":

                passScrollToTier();

                break;

            case "left":

                track?.scrollBy({ left: -PASS_COL * 4, behavior: "smooth" });

                break;

            case "right":

                track?.scrollBy({ left: PASS_COL * 4, behavior: "smooth" });

                break;

        }

    });

}

// Petit rebond de la carte récupérée, puis elle reste « Obtenu ».
function popPassReward(id) {

    passPopId = id;

    setTimeout(() => {

        if (passPopId === id) {
            passPopId = null;
        }

    }, 800);

}

// Après une récupération : pass, pseudos et skin du perroquet à jour.
async function afterSeasonClaim(rewards) {

    // Skin du perroquet gagné : il est mis tout de suite.
    const skin = rewards.reverse().find(reward => reward?.item?.startsWith("skin_"));

    if (skin) {
        writeStorage("parrot-skin", skin.item.slice(5));
    }

    // L'objet gagné arrive équipé : il retire ceux qui ne se cumulent pas avec lui
    // (unequipConflicts dans app.js).
    for (const reward of rewards) {

        const item = reward?.item;

        if (item && typeof unequipConflicts === "function") {

            await unequipConflicts(DIAMOND_ITEMS.some(entry => entry.id === item) ? "diamond:" + item : item);

        }

    }

    await loadSeason();

    refreshSeasonViews();

    // Les cosmétiques changent les pseudos (et le skin du perroquet).
    await loadCurrentProfile();

    if (typeof applyParrotSkin === "function") {
        applyParrotSkin();
    }

    displayBets({ quiet: true });

}

async function claimSeasonReward(tier, track, button) {

    if (!currentGroup) {
        return;
    }

    button.disabled = true;

    const { data, error } = await supabaseClient.rpc("season_claim", {
        p_group: currentGroup.id,
        p_tier: tier,
        p_track: track
    });

    if (error) {

        passSay(error.message);

        button.disabled = false;

        return;

    }

    popPassReward(track + tier);

    passSay("Récompense obtenue : " + data);

    await afterSeasonClaim([seasonReward(tier, track)]);

}

// « Tout récupérer » : chaque récompense prête, l'une après l'autre.
async function claimAllSeasonRewards(button) {

    if (!currentGroup) {
        return;
    }

    button.disabled = true;

    const ready = seasonRewards.filter(reward => seasonRewardState(reward.tier, reward.track) === "claimable");

    const claimed = [];

    let failure = null;

    for (const reward of ready) {

        const { error } = await supabaseClient.rpc("season_claim", {
            p_group: currentGroup.id,
            p_tier: reward.tier,
            p_track: reward.track
        });

        if (error) {
            failure = error.message;
        } else {
            claimed.push(reward);
        }

    }

    if (claimed.length) {

        popPassReward(claimed[0].track + claimed[0].tier);

        passSay(claimed.length + " récompense" + (claimed.length > 1 ? "s récupérées" : " récupérée"));

    } else if (failure) {

        passSay(failure);

    }

    await afterSeasonClaim(claimed);

}


/*
    Admin : activer le Gold pour certains joueurs (saison en cours).
*/

async function renderPassAdmin() {

    const box = document.getElementById("pass-admin");

    if (!box) {
        return;
    }

    const [players, golds] = await Promise.all([
        supabaseClient.from("profiles").select("id, username").eq("is_admin", false).order("username"),
        supabaseClient.from("season_gold").select("user_id").eq("season", seasonState.season)
    ]);

    if (players.error || golds.error) {

        box.innerHTML = `<p class="error-message">Impossible de charger les joueurs.</p>`;

        return;

    }

    const goldIds = new Set((golds.data || []).map(row => row.user_id));

    box.innerHTML = `
        <h3>Admin : pass Gold ${escapeHtml(ofSeasonMonth())}</h3>
        <p class="pass-hint">Clique un pseudo pour lui activer ou retirer le Gold (gratuit pendant la bêta).</p>
        <div class="pass-admin-list">
            ${(players.data || []).map(player => `
                <button type="button" class="${goldIds.has(player.id) ? "on" : ""}" data-gold-user="${player.id}">
                    ${goldIds.has(player.id) ? "✓ " : ""}${escapeHtml(player.username || "?")}
                </button>
            `).join("")}
        </div>
    `;

    box.querySelectorAll("[data-gold-user]").forEach(button => {

        button.addEventListener("click", async () => {

            button.disabled = true;

            const { error } = await supabaseClient.rpc("admin_set_season_gold", {
                p_user: button.dataset.goldUser,
                p_on: !button.classList.contains("on")
            });

            if (error) {
                alertToast(escapeHtml(error.message));
            }

            renderPassAdmin();

        });

    });

}


/*
    Mise à jour de tout ce qui montre le passe.
*/

function refreshSeasonViews() {

    renderSeasonMini();

    renderSeasonCard();

    if (!document.getElementById("pass-page")?.classList.contains("hidden")) {

        renderPassPage();

    }

}

let seasonRefreshTimer = null;

function scheduleSeasonRefresh() {

    clearTimeout(seasonRefreshTimer);

    seasonRefreshTimer = setTimeout(() => {

        loadSeason().then(refreshSeasonViews);

    }, 400);

}


/*
    Cosmétiques du pass qui n'existent pas dans la boutique classique :
    skins du perroquet, pseudo enflammé, pseudos Terminal et Glitch.
    Gardés dans les cosmétiques du groupe (season_claim) ; seule la
    version bêta les affiche.
*/

function passCosmeticOn(profile, id) {

    const isMe =
        currentProfile && profile?.username === currentProfile.username;

    const cosmetics = isMe
        ? currentProfile.cosmetics
        : profile?.cosmetics || groupStyles.get(profile?.username)?.cosmetics;

    return isRewardActive(cosmetics?.[id]?.until) && !cosmetics?.[id]?.off;

}

function setupPassCosmetics() {

    const classicSkinUnlocked = skinUnlocked;

    skinUnlocked = skin => classicSkinUnlocked(skin) || passCosmeticOn(currentProfile, "skin_" + skin.id);

    const classicFlameNameOn = flameNameOn;

    flameNameOn = profile => classicFlameNameOn(profile) || passCosmeticOn(profile, "pseudo_flamme");

    const classicBetaStyleOf = betaStyleOf;

    betaStyleOf = username => {

        const profile = { username };

        if (passCosmeticOn(profile, "pseudo_glitch")) {
            return "glitch";
        }

        return classicBetaStyleOf(username) || (passCosmeticOn(profile, "pseudo_terminal") ? "terminal" : null);

    };

}


/*
    Démarrage : seulement dans la version bêta.
*/

function initBetaApp() {

    if (!isBetaApp() || !document.getElementById("bets-page")) {
        return;
    }

    setupSeasonMini();

    setupPassPage();

    setupPassCosmetics();


    // Chaque dessin des paris (mise, gain récupéré, direct) : la carte saison
    // revient en tête et l'XP est rechargée.
    const classicDisplayBets = displayBets;

    displayBets = async function (...args) {

        const result = await classicDisplayBets.apply(this, args);

        if (isBetaApp()) {

            renderSeasonCard();

            scheduleSeasonRefresh();

        }

        return result;

    };


    // La flamme et la carte « Série » ouvrent la même fenêtre de série que la
    // version classique (setupStreakModal dans animations.js).


    scheduleSeasonRefresh();

}

initBetaApp();
