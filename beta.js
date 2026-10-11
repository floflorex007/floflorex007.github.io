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

    if (column.firstElementChild !== seasonCard) {

        column.prepend(seasonCard);

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

    showPage("pass-page");

    renderPassPage({ centerTier: true });

    // Données à jour : on recentre seulement si la piste n'était pas encore là.
    loadSeason().then(refreshSeasonViews);

}

// Largeur d'une colonne de la piste (un niveau), voir .pass-lane dans beta.css.
const PASS_COL = 100;

// XP affichée la dernière fois : la jauge repart de là et glisse jusqu'à l'XP actuelle.
let passShownXp = null;

// Centre de la colonne d'un niveau, et position de l'XP sur la jauge (en px).
function passLevelX(level) {

    return (level - 0.5) * PASS_COL;

}

function passXpX(xp) {

    const level = Math.min(SEASON_TIERS, xp / SEASON_XP_PER_TIER);

    return Math.max(0, passLevelX(level));

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

    const effects = {
        metal: item.startsWith("metal_") ? item.slice(6) : null,
        anim: NAME_ANIMATIONS.includes(item) ? item : null,
        neon: item === "neon" ? option : null,
        emoji: item === "emoji" ? option : null,
        sparkle: item === "etincelles",
        rainbow: item === "couleur",
        cristal: item === "cristal",
        diamondEmoji: item === "emoji_diamant",
        flame: item === "pseudo_flamme",
        beta: item === "pseudo_terminal" ? "terminal" : item === "pseudo_glitch" ? "glitch" : null
    };

    return `<span class="user-name pass-preview-name">${nameHtml(me, effects)}</span>`;

}

function passRewardHtml(tier, track) {

    const reward = seasonReward(tier, track);

    // Admin en train de choisir les récompenses : chaque case s'ouvre au clic.
    if (passEditMode) {

        return `
            <div class="pass-cell">
                <button
                    type="button"
                    class="pass-reward editing${track === "gold" ? " gold" : ""}${reward ? "" : " empty"}"
                    data-edit-tier="${tier}"
                    data-edit-track="${track}"
                >
                    ${reward
                        ? `<span class="pass-preview">${seasonPreviewHtml(reward)}</span>
                           <span class="pass-label">${escapeHtml(reward.label)}</span>`
                        : `<span class="pass-edit-plus">+</span>`
                    }
                </button>
            </div>
        `;

    }

    if (!reward) {
        return `<div class="pass-cell"><div class="pass-reward empty"></div></div>`;
    }

    const state = seasonRewardState(tier, track);

    const tag = state === "locked" ? "🔒" : state === "claimed" ? "✓" : "";

    return `
        <div class="pass-cell">
            <button
                type="button"
                class="pass-reward${track === "gold" ? " gold" : ""}${state ? " " + state : ""}"
                ${state === "claimable" ? `data-claim-tier="${tier}" data-claim-track="${track}"` : "disabled"}
                title="${escapeHtml(reward.label)}"
            >
                <span class="pass-tag">${tag}</span>
                <span class="pass-preview">${seasonPreviewHtml(reward)}</span>
                <span class="pass-label">${escapeHtml(reward.label)}</span>
            </button>
        </div>
    `;

}

// Jauge fine : un point par niveau, la bulle « Toi » au bout (version A de demo-passe-jauge.html).
function passGaugeHtml(xp) {

    const level = Math.min(SEASON_TIERS, Math.floor(xp / SEASON_XP_PER_TIER));

    let dots = "";

    for (let n = 1; n <= SEASON_TIERS; n++) {

        dots += `
            <span class="pass-dot${n <= level ? " on" : ""}" style="left:${passLevelX(n)}px"></span>
            <span class="pass-num${n <= level ? " on" : ""}" style="left:${passLevelX(n)}px">${n}</span>
        `;

    }

    const bubble = seasonState.admin
        ? "Toi · XP ∞"
        : level >= SEASON_TIERS
        ? "Toi · pass terminé"
        : "Toi · " + (xp % SEASON_XP_PER_TIER) + "/" + SEASON_XP_PER_TIER + " XP";

    return `
        <div class="pass-gauge" style="width:${SEASON_TIERS * PASS_COL}px">
            <div class="pass-rail"></div>
            <div class="pass-fill" style="width:${passXpX(xp)}px"></div>
            ${dots}
            <span class="pass-me" style="left:${passXpX(xp)}px">${bubble}</span>
        </div>
    `;

}

// Animations des écritures : seulement dans les cases visibles de la piste.
let passAnimationObserver = null;

function watchPassAnimations(track) {

    passAnimationObserver?.disconnect();

    if (!("IntersectionObserver" in window)) {

        track.querySelectorAll(".pass-cell").forEach(cell => cell.classList.add("in-view"));

        return;

    }

    passAnimationObserver = new IntersectionObserver(entries => {

        entries.forEach(entry => entry.target.classList.toggle("in-view", entry.isIntersecting));

    }, { root: track, rootMargin: "0px 100px" });

    track.querySelectorAll(".pass-cell").forEach(cell => passAnimationObserver.observe(cell));

}

function renderPassPage({ centerTier = false } = {}) {

    const page = document.getElementById("pass-page");

    if (!page) {
        return;
    }

    // Position de la piste et de la page avant le redessin.
    const previousScroll = page.querySelector(".pass-track")?.scrollLeft || 0;

    const previousPageScroll = window.scrollY;

    const previousAdmin = page.querySelector("#pass-admin .pass-admin-list")
        ? page.querySelector("#pass-admin").innerHTML
        : "";

    // Première fois que la piste s'affiche : on la centre sur l'XP.
    if (!page.querySelector(".pass-track")) {
        centerTier = true;
    }

    if (!seasonState) {

        page.innerHTML = `<p class="empty-state">Chargement du pass...</p>`;

        return;

    }

    const xp = seasonTier() >= SEASON_TIERS
        ? SEASON_TIERS * SEASON_XP_PER_TIER
        : seasonState.xp || 0;

    // XP gagnée depuis le dernier affichage : la jauge part de l'ancienne valeur.
    const fromXp = passShownXp !== null && passShownXp < xp ? passShownXp : xp;

    passShownXp = xp;

    const ready = seasonClaimableCount();

    let classic = "";

    let gold = "";

    for (let n = 1; n <= SEASON_TIERS; n++) {

        classic += passRewardHtml(n, "classique");

        gold += passRewardHtml(n, "gold");

    }

    page.innerHTML = `
        <div class="page-header pass-header">
            <h1>Pass de combat</h1>

            <div class="pass-header-actions">
                ${ready && !passEditMode
                    ? `<span class="pass-ready-count">🎁 ${ready} récompense${ready > 1 ? "s" : ""} à récupérer</span>`
                    : ""
                }

                ${currentProfile?.is_admin
                    ? `<button type="button" class="pass-edit-button${passEditMode ? " on" : ""}" id="pass-edit-button">
                        ${passEditMode ? "✓ Terminer" : "✏️ Choisir les récompenses"}
                      </button>`
                    : ""
                }
            </div>
        </div>

        ${passEditMode
            ? `<p class="pass-edit-hint">Clique une case pour choisir sa récompense (ou la vider). Les joueurs voient le changement tout de suite.</p>`
            : ""
        }

        <div class="pass-box">

            <div class="pass-track">

                <div class="pass-band classic">
                    <div class="pass-row-label">Classique</div>
                    <div class="pass-lane">${classic}</div>
                </div>

                ${passGaugeHtml(fromXp)}

                <div class="pass-band gold">
                    <div class="pass-lane">${gold}</div>
                    <div class="pass-row-label gold">Gold</div>
                </div>

            </div>

        </div>

        ${currentProfile?.is_admin
            ? `<div class="pass-box pass-admin" id="pass-admin"><p class="empty-state">Chargement des joueurs...</p></div>`
            : ""
        }
    `;

    page.querySelector("#pass-edit-button")?.addEventListener("click", () => {

        passEditMode = !passEditMode;

        renderPassPage();

    });

    page.querySelectorAll("[data-edit-tier]").forEach(button => {

        button.addEventListener("click", () => openRewardPicker(
            Number(button.dataset.editTier),
            button.dataset.editTrack
        ));

    });

    page.querySelectorAll("[data-claim-tier]").forEach(button => {

        button.addEventListener("click", () => claimSeasonReward(
            Number(button.dataset.claimTier),
            button.dataset.claimTrack,
            button
        ));

    });

    const track = page.querySelector(".pass-track");

    watchPassAnimations(track);

    if (centerTier) {

        // À l'ouverture : la bulle « Toi » au milieu de la piste.
        track.scrollLeft = passXpX(xp) - track.clientWidth / 2;

    } else {

        // Redessin (récompense récupérée...) : la piste et la page ne bougent pas.
        track.scrollLeft = previousScroll;

        window.scrollTo({ top: previousPageScroll, behavior: "instant" });

    }

    // La jauge glisse jusqu'à l'XP actuelle (après le premier dessin).
    if (fromXp < xp) {

        requestAnimationFrame(() => requestAnimationFrame(() => {

            page.querySelector(".pass-fill").style.width = passXpX(xp) + "px";

            page.querySelector(".pass-me").style.left = passXpX(xp) + "px";

            // Points et numéros des niveaux passés entre-temps.
            setTimeout(() => {

                page.querySelectorAll(".pass-dot, .pass-num").forEach(element => {

                    if (parseFloat(element.style.left) <= passXpX(xp)) {
                        element.classList.add("on");
                    }

                });

            }, 1000);

        }));

    }

    if (currentProfile?.is_admin) {

        // L'ancienne liste reste affichée pendant le rechargement (pas de saut).
        if (previousAdmin) {
            page.querySelector("#pass-admin").innerHTML = previousAdmin;
        }

        renderPassAdmin();

    }

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

        alertToast(escapeHtml(error.message));

        button.disabled = false;

        return;

    }

    alertToast(`🎁 ${escapeHtml(data)} récupéré !`, { type: "beta" });

    // Skin du perroquet gagné : il est mis tout de suite.
    const reward = seasonReward(tier, track);

    if (reward?.item?.startsWith("skin_")) {

        writeStorage("parrot-skin", reward.item.slice(5));

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


    // La flamme ouvre le passe (sa jauge y est) au lieu de la fenêtre de série.
    document.getElementById("streak-widget")?.addEventListener("click", event => {

        if (!isBetaApp()) {
            return;
        }

        event.stopImmediatePropagation();

        openPassPage();

    }, true);


    scheduleSeasonRefresh();

}

initBetaApp();
