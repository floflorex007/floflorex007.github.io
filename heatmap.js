/* =========================================================
   BETLAB — CARTE DES CLICS (voir heatmap.sql)

   Maquette Exemple-aide CLAUDE/demo-heatmap-admin.html (version B) :
   - la fenêtre d'accord est obligatoire pour jouer : accepter ou se
     déconnecter. Les joueurs qui acceptent envoient leurs clics par
     paquets (toutes les 10 s, dès 30 clics, et à la fermeture de la page) :
     écran, élément cliqué, son rang parmi les éléments identiques, position
     du clic DANS cet élément, largeur d'écran, appareil, niveau du joueur. Jamais le texte
     tapé ni le pseudo (la base ne garde aucun lien avec le compte) ;
   - l'admin et les comptes de click_excluded_users ne sont jamais comptés ;
   - onglet « Heat map » (admin) : calque plein écran, le vrai site dans un
     cadre (app.html?apercu-clics) à la largeur du groupe d'écrans choisi.
     Le cadre est cliquable comme le vrai site (rien ne s'y enregistre) :
     la carte suit l'écran affiché (page, fenêtre ouverte) et replace chaque
     clic sur le même élément chez l'admin, où qu'il soit. La base ne
     renvoie que des totaux.
========================================================= */


// Envoi par paquets.
const CLICK_BATCH = 30;
const CLICK_FLUSH_MS = 10000;

// Groupes d'écrans calés sur le site (voir click_bucket dans heatmap.sql) :
// l'aperçu est affiché à la largeur de référence du groupe.
const HEATMAP_DEVICES = {
    phone: { label: "📱 Téléphone", width: 390, height: 844, note: "écrans jusqu'à 800 px (version téléphone)" },
    laptop: { label: "💻 Portable", width: 1000, height: 700, note: "de 801 à 1100 px (sans colonne de droite)" },
    wide: { label: "🖥️ Grand écran", width: 1366, height: 768, note: "plus de 1100 px" }
};

// Taille des cases de regroupement : 2 % de la largeur et de la hauteur de l'élément cliqué.
const HEATMAP_CELL = 2;

// Couleurs « Classique » (froid → chaud) et intensité « Moyenne ».
const HEATMAP_PALETTE = ["#1d4ed8", "#06b6d4", "#22c55e", "#facc15", "#ef4444"];
const HEATMAP_OPACITY = 0.72;

// Écrans toujours proposés dans le filtre, même sans clic.
const HEATMAP_MAIN_SCREENS = ["bets-page", "my-bets-page", "missions-page", "shop-page", "profile-page", "bet-modal", "stakes-panel", "group-menu"];

const SCREEN_LABELS = {
    "bets-page": "Paris",
    "my-bets-page": "Historique",
    "missions-page": "Missions",
    "shop-page": "Boutique",
    "beta-page": "Aide app",
    "profile-page": "Profil",
    "admin-page": "Message (admin)",
    "create-modal": "Fenêtre : créer un pari",
    "bet-modal": "Fenêtre : mise",
    "resolve-modal": "Fenêtre : valider un pari",
    "duel-modal": "Fenêtre : défi",
    "duel-history-modal": "Fenêtre : historique des défis",
    "tree-modal": "Fenêtre : arbre du groupe",
    "shop-preview-modal": "Fenêtre : aperçu boutique",
    "beta-welcome-modal": "Fenêtre : bienvenue bêta",
    "beta-vote-modal": "Fenêtre : vote bêta",
    "player-modal": "Fenêtre : profil d'un joueur",
    "gift-modal": "Fenêtre : don",
    "gift-received-modal": "Fenêtre : don reçu",
    "points-modal": "Fenêtre : points",
    "diamond-modal": "Fenêtre : diamants",
    "balance-modal": "Fenêtre : solde",
    "streak-modal": "Fenêtre : série",
    "xp-modal": "Fenêtre : niveau et XP",
    "delete-account-modal": "Fenêtre : supprimer le compte",
    "stakes-modal": "Fenêtre : détail des parieurs",
    "contest-modal": "Fenêtre : contestation",
    "announcement-modal": "Fenêtre : annonce",
    "notice-modal": "Fenêtre : message",
    "removed-modal": "Fenêtre : retiré du groupe",
    "group-modal": "Fenêtre : groupe",
    "click-consent-modal": "Fenêtre : accord des clics",
    "stakes-panel": "Carte dépliée (détail des parieurs)",
    "group-menu": "Menu du groupe"
};

// Noms lisibles des éléments (clés enregistrées par clickAnchor).
// Ceux-ci servent aussi à la liste « Jamais cliqués ».
const CLICK_LABELS = {
    'button.nav-button[data-page="bets-page"]': "Onglet Paris",
    'button.nav-button[data-page="my-bets-page"]': "Onglet Historique",
    'button.nav-button[data-page="missions-page"]': "Onglet Missions",
    'button.nav-button[data-page="shop-page"]': "Onglet Boutique",
    "#beta-nav-button": "Onglet Aide app",
    "#nav-create-button": "« + » Créer un pari (téléphone)",
    "#group-switcher-button": "Menu du groupe",
    "#streak-widget": "🔥 Flamme de série",
    "#balance-widget": "Solde",
    "div.leaderboard-row": "Ligne du classement (profil du joueur)",
    "#points-widget": "Points",
    "#diamond-widget": "Diamants",
    "#profile-nav-button": "Profil",
    "#leaderboard-open-button": "🏆 Classement (téléphone)",
    "#chat-fab": "💬 Bulle du chat",
    "#chat-send": "Envoyer un message (chat)",
    "#chat-input": "Champ du chat (texte jamais lu)",
    "button.lb-duel-btn": "⚔️ Défier",
    "button.bet-choice-button": "Cote d'un pari",
    "#confirm-bet": "Miser (placer le pari)",
    "#stake-input": "Champ du montant (valeur jamais lue)",
    "#close-modal": "Fermer la fenêtre de mise",
    'button.bet-quick-allin[data-stake="max"]': "🔥 Max",
    "button.claim-card-button": "Récupérer un gain",
    "button.contest-button": "Contester",
    "button.cosmetic-buy": "Acheter / équiper (boutique)",
    "#level-up-button": "Débloquer le niveau",
    "#tour-replay-button": "Revoir le tuto",
    "#toggle-third-choice": "3e choix (création)",
    "#logout-button": "Déconnexion",
    "button.streak-day-claim": "🔥 Prendre la récompense de série",
    "div.streak-day": "Case du calendrier de série"
};

const CLICK_LABEL_PATTERNS = [
    [/data-stake="half"/, "½ Max"],
    [/data-stake="max"/, "🔥 Max"],
    [/data-stake="(\d+)"/, "Mise rapide $1 €"],
    [/^#close-/, "Fermer ✕"],
    [/^#[a-z-]+-modal$/, "Clic à côté de la fenêtre (la ferme)"],
    [/^#[a-z-]+-page$/, "Fond de la page (rien de cliquable)"],
    [/^div\.modal-content/, "Fond de la fenêtre (rien de cliquable)"],
    [/^body$/, "Fond du site (rien de cliquable)"],
    [/^div\.bet-card\b/, "Carte d'un pari (hors boutons)"],
    [/\.bet-choice-button/, "Cote d'un pari"],
    [/\.validate-fab-delete/, "Supprimer le pari (pastille rouge)"],
    [/\.validate-fab-wait/, "Valider (en attente d'un parieur)"],
    [/\.validate-fab\b/, "Valider le pari"],
    [/\.leaderboard-row/, "Ligne du classement"],
    [/\.ticket-go/, "Valider le combiné"],
    [/\.ticket-bar/, "Ouvrir le ticket combiné"]
];

// Clé d'un élément cliqué : jamais son texte (il peut contenir un pseudo ou une question).
// Les capsules du haut (#balance-widget…), la bulle du chat et le perroquet comptent comme des boutons.
const CLICK_INTERACTIVE = "button, a, input, select, textarea, label, summary, [role='button'], [data-page], [id$='-widget'], [id$='-fab'], #parrot";
const CLICK_GENERIC_CLASSES = new Set(["primary-button", "secondary-button", "large-button", "danger", "ghost", "small", "active", "hidden"]);
const CLICK_DATA_KEYS = ["page", "stake", "tab", "filter", "mode", "section", "step", "kind", "action", "view"];

// Fenêtres et volets qui passent par-dessus la page : chacun est un écran à part
// dans la heat map (ses clics s'affichent quand il est ouvert dans l'aperçu).
// #stakes-panel : la carte dépliée (détail des parieurs) ; #group-menu : le menu du groupe.
const CLICK_POPUPS = ".modal, #stakes-panel, #group-menu";

// Fonds sombres qui referment un volet : leurs clics comptent avec ce volet.
const CLICK_POPUP_BACKDROPS = { "stakes-panel-backdrop": "stakes-panel" };

const CLICK_OVERLAYS = [CLICK_POPUPS, ...Object.keys(CLICK_POPUP_BACKDROPS).map(id => "#" + id)].join(", ");

// Rang noté jusqu'à la 100e carte identique (au-delà : pas de rang, le clic n'est pas replacé).
const CLICK_MAX_INDEX = 99;

// Choisir une fenêtre dans le filtre « Écran » : on l'ouvre comme un joueur, avec ce bouton
// (sinon elle est affichée telle quelle, sans contenu).
const HEATMAP_MODAL_OPENERS = {
    "bet-modal": "button.bet-choice-button",
    "stakes-panel": "div.bet-card",
    "group-menu": "#group-switcher-button",
    "player-modal": "div.leaderboard-row",
    "points-modal": "#points-widget",
    "diamond-modal": "#diamond-widget",
    "balance-modal": "#balance-widget",
    "streak-modal": "#streak-widget"
};

// Aperçu cliquable : fonctions qui écrivent mais que le site de l'admin lance déjà
// tout seul à l'ouverture, ou qui ne font que clore ce qui est échu (défis, contestations,
// votes de l'arbre). Les autres fonctions qui écrivent sont bloquées (voir clickPreviewFetch).
const CLICK_PREVIEW_ALLOWED_RPCS = new Set([
    "admin_click_preview_rpcs",
    "daily_checkin",
    "claim_event_skins",
    "beta_settle_votes",
    "duel_history",
    "my_duels",
    "group_contests",
    "group_tree_state",
    "preview_group"
]);

// Une fenêtre qui s'ouvre plus de 4 s après le dernier geste de l'admin
// (annonce, cadeau, défi reçu…) est refermée dans l'aperçu.
const CLICK_PREVIEW_POPUP_MS = 4000;

// Analyses : éléments qu'on clique plusieurs fois de suite exprès (motifs LIKE),
// jamais comptés comme « clics répétés ».
const CLICK_REPEAT_OK = [
    "%data-stake%",
    "#parrot%",
    "%input%",
    "%textarea%",
    "#chat-send%",
    "#stake-input%"
];

// Analyses : parcours suivis (étape après étape, pendant la même visite).
// element : motif LIKE de la clé ; screen : écran où l'étape doit avoir lieu (facultatif).
const HEATMAP_FUNNELS = [
    {
        label: "Placer une mise",
        steps: [
            { label: "Cote touchée", element: "button.bet-choice-button%" },
            { label: "« Miser » cliqué", element: "#confirm-bet%", screen: "bet-modal" }
        ]
    },
    {
        label: "Valider un combiné",
        steps: [
            { label: "Ticket ouvert", element: "button.ticket-bar%" },
            { label: "« Valider le combiné » cliqué", element: "button.ticket-go%" }
        ]
    }
];


// État du comptage pour ce joueur : 'accepted', 'refused', 'unknown' ou 'excluded'.
let clickState = null;

let clickQueue = [];

let clickFlushTimer = null;

let clickToken = null;

let clickVisit = null;

let clickAuthWatched = false;


// Aperçu de la page Heat map : posé tout de suite pour cacher le tuto et les onglets admin.
if (CLICK_PREVIEW) {
    document.body.classList.add("click-preview");
}


async function setupHeatmap() {

    if (CLICK_PREVIEW) {

        setupClickPreview();

        return;

    }

    if (currentProfile?.is_admin) {

        setupHeatmapPage();

        return;

    }

    setupClickConsent();

    const { data: state, error } = await supabaseClient.rpc("my_click_tracking");

    if (error) {

        console.error("Erreur my_click_tracking :", error);

        return;

    }

    applyClickState(state);

    // Obligatoire pour jouer : la fenêtre revient aussi pour ceux qui avaient
    // refusé avec l'ancienne version. Après les fenêtres du démarrage (annonce, cadeaux, tuto…).
    setTimeout(askClickConsent, 5000);

}



/* =========================================================
   ACCORD DU JOUEUR (fenêtre obligatoire : accepter ou se déconnecter)
========================================================= */

function setupClickConsent() {

    const modal = document.getElementById("click-consent-modal");

    const checkbox = document.getElementById("click-consent-checkbox");

    const validate = document.getElementById("click-consent-validate");

    // « Valider » ne marche qu'avec la case cochée.
    checkbox?.addEventListener("change", () => {

        validate.disabled = !checkbox.checked;

    });

    validate?.addEventListener("click", async () => {

        if (!checkbox.checked) {
            return;
        }

        validate.disabled = true;

        const state = await saveClickConsent();

        // En cas d'erreur, la fenêtre reste ouverte pour réessayer.
        if (state === "accepted" || state === "excluded") {
            modal.classList.add("hidden");
        } else {
            validate.disabled = false;
        }

    });

    document.getElementById("click-consent-logout")?.addEventListener("click", logout);

}


// La fenêtre attend qu'aucune autre fenêtre ni le tuto ne soit ouvert.
function askClickConsent() {

    if (clickState !== "unknown" && clickState !== "refused") {
        return;
    }

    const busy =
        document.body.classList.contains("app-loading")
        || document.querySelector(".modal:not(.hidden), .tour-layer");

    if (busy) {

        setTimeout(askClickConsent, 2000);

        return;

    }

    document.getElementById("click-consent-checkbox").checked = false;

    document.getElementById("click-consent-validate").disabled = true;

    document.getElementById("click-consent-modal").classList.remove("hidden");

}


async function saveClickConsent() {

    const { data: state, error } = await supabaseClient.rpc("set_click_consent", {
        p_accepted: true
    });

    if (error) {

        console.error("Erreur set_click_consent :", error);

        return null;

    }

    applyClickState(state);

    return state;

}


function applyClickState(state) {

    clickState = state;

    document
        .getElementById("click-consent-card")
        ?.classList.toggle("hidden", state === "excluded" || !state);

    if (state === "accepted") {
        startClickTracking();
    } else {
        stopClickTracking();
    }

}



/* =========================================================
   COMPTAGE DES CLICS (joueurs qui ont accepté)
========================================================= */

function startClickTracking() {

    if (clickFlushTimer) {
        return;
    }

    clickVisit = clickVisitId();

    supabaseClient.auth.getSession().then(({ data }) => {
        clickToken = data.session?.access_token || null;
    });

    // Le jeton change à chaque renouvellement de session : on garde le dernier
    // pour pouvoir envoyer le dernier paquet à la fermeture sans attendre.
    if (!clickAuthWatched) {

        clickAuthWatched = true;

        supabaseClient.auth.onAuthStateChange((event, session) => {
            clickToken = session?.access_token || null;
        });

    }

    document.addEventListener("click", recordClick, true);

    document.addEventListener("visibilitychange", flushClicksWhenHidden);

    window.addEventListener("pagehide", flushClicks);

    clickFlushTimer = setInterval(flushClicks, CLICK_FLUSH_MS);

}


function stopClickTracking() {

    if (!clickFlushTimer) {
        return;
    }

    document.removeEventListener("click", recordClick, true);

    document.removeEventListener("visibilitychange", flushClicksWhenHidden);

    window.removeEventListener("pagehide", flushClicks);

    clearInterval(clickFlushTimer);

    clickFlushTimer = null;

    clickQueue = [];

}


// Numéro de visite tiré au hasard, gardé seulement le temps de l'onglet.
function clickVisitId() {

    const key = "betlab-visite-clics";

    try {

        const saved = sessionStorage.getItem(key);

        if (saved) {
            return saved;
        }

    } catch (error) {
        // Stockage bloqué : un nouveau numéro à chaque chargement.
    }

    let id;

    if (crypto.randomUUID) {

        id = crypto.randomUUID();

    } else {

        // Adresse en http (test sur téléphone en Wi-Fi) : randomUUID n'existe pas.
        const bytes = crypto.getRandomValues(new Uint8Array(16));

        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;

        const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");

        id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

    }

    try {
        sessionStorage.setItem(key, id);
    } catch (error) {
        // Rien à faire.
    }

    return id;

}


function recordClick(event) {

    // Clic au clavier (Entrée sur un bouton) : pas de position à noter.
    if (!event.isTrusted || (event.detail === 0 && event.clientX === 0 && event.clientY === 0)) {
        return;
    }

    const target =
        event.target instanceof Element ? event.target : event.target?.parentElement;

    if (!target) {
        return;
    }

    const anchor = clickAnchor(target);

    const rect = anchor.element.getBoundingClientRect();

    const vw = document.documentElement.clientWidth || window.innerWidth;

    clickQueue.push({
        session_id: clickVisit,
        screen: clickScreen(target).slice(0, 40),
        element: anchor.key,
        el_index: clickElementIndex(anchor, clickPopup(target)),
        ex_pm: toPerMille((event.clientX - rect.left) / rect.width),
        ey_pm: toPerMille((event.clientY - rect.top) / rect.height),
        vw: Math.max(200, Math.min(8000, Math.round(vw))),
        device: PHONE_LAYOUT.matches ? "mobile" : "desktop",
        level: clickPlayerLevel(),
        dead: clickIsDead(target)
    });

    if (clickQueue.length >= CLICK_BATCH) {
        flushClicks();
    }

}


/*
    Clic dans le vide : ni bouton (ou un bouton grisé), ni curseur « main ».
    Le fond d'une fenêtre ou d'un volet n'en est pas un : il la referme.
*/
function clickIsDead(target) {

    if (target.matches(CLICK_OVERLAYS)) {
        return false;
    }

    const control = target.closest(CLICK_INTERACTIVE);

    if (control) {
        return control.disabled === true || control.getAttribute("aria-disabled") === "true";
    }

    return getComputedStyle(target).cursor !== "pointer";

}


// Niveau affiché au joueur (animations.js), celui qui décide de ce qu'il voit à l'écran.
function clickPlayerLevel() {

    const level = typeof playerLevel === "number" ? playerLevel : NaN;

    return Number.isFinite(level) ? Math.max(1, Math.min(99, Math.round(level))) : null;

}


function toPerMille(value) {

    return Number.isFinite(value)
        ? Math.max(0, Math.min(1000, Math.round(value * 1000)))
        : 0;

}


// Écran : la fenêtre ou le volet où l'on clique, sinon la page affichée.
function clickScreen(target) {

    const popup = clickPopup(target);

    if (popup?.id) {
        return popup.id;
    }

    return document.querySelector(".app-page:not(.hidden)")?.id || "autre";

}


// Fenêtre ou volet qui contient l'élément (son fond sombre compris), sinon null.
function clickPopup(element) {

    const backdrop = element.closest(
        Object.keys(CLICK_POPUP_BACKDROPS).map(id => "#" + id).join(", ")
    );

    if (backdrop) {
        return element.ownerDocument.getElementById(CLICK_POPUP_BACKDROPS[backdrop.id]);
    }

    return element.closest(CLICK_POPUPS);

}


// Le volet et ses fonds sombres : là où l'on cherche les éléments de cet écran.
function clickPopupBoxes(popup) {

    const doc = popup.ownerDocument;

    return [
        popup,
        ...Object.keys(CLICK_POPUP_BACKDROPS)
            .filter(id => CLICK_POPUP_BACKDROPS[id] === popup.id)
            .map(id => doc.getElementById(id))
            .filter(Boolean)
    ];

}


/*
    Élément auquel le clic est accroché, et sa clé : data-track-id, sinon son
    id, sinon un sélecteur court (balise + classe + data-page, data-stake…).
    Les identifiants qui contiennent un numéro (un pari, un joueur) sont
    ignorés pour que toutes les cartes comptent ensemble. Jamais le texte de
    l'élément. Un clic sur rien de reconnaissable (simple paragraphe…)
    s'accroche au fond de la fenêtre ou de la page.
*/
function clickAnchor(target) {

    const tracked = target.closest("[data-track-id]");

    if (tracked) {

        const key = `[data-track-id="${CSS.escape(tracked.dataset.trackId)}"]`;

        if (key.length <= 80) {
            return { element: tracked, key };
        }

    }

    // Un bouton, sinon l'élément touché ou un parent proche qui a une classe
    // (fond d'une carte, ligne du classement…), sinon un parent qui a un id.
    const element =
        target.closest(CLICK_INTERACTIVE)
        || stableIdAncestor(target, 1)
        || classedAncestor(target, 2)
        || stableIdAncestor(target, 3)
        || target;

    const key = clickSelector(element);

    if (/[#.[]/.test(key) && key.length <= 80) {
        return { element, key };
    }

    const box =
        target.closest(".modal-content")
        || target.closest(CLICK_POPUPS)
        || target.closest(".app-page");

    // Les classes de <body> changent d'un joueur à l'autre (version bêta…) : clé fixe.
    return box
        ? { element: box, key: clickSelector(box).slice(0, 80) }
        : { element: document.body, key: "body" };

}


// Élément fixe ou collé à l'écran (lui ou un parent) : il ne défile pas avec la page.
function isFixedElement(element, view = window) {

    for (let node = element; node && node !== node.ownerDocument.body; node = node.parentElement) {

        const position = view.getComputedStyle(node).position;

        if (position === "fixed" || position === "sticky") {
            return true;
        }

    }

    return false;

}


// Rang de l'élément parmi les éléments visibles qui ont la même clé (2e carte…).
function clickElementIndex(anchor, popup) {

    try {

        const index = clickCandidates(document, anchor.key, popup).indexOf(anchor.element);

        return index >= 0 && index <= CLICK_MAX_INDEX ? index : null;

    } catch (error) {
        return null;
    }

}


/*
    Éléments visibles qui portent cette clé, dans l'ordre de la page : dans la
    fenêtre ou le volet ouvert (popup), ou hors des fenêtres et volets pour
    une page. Le même calcul sert chez le joueur (rang noté) et dans l'aperçu
    de l'admin (rang retrouvé). Peut lever une erreur si la clé n'est pas un sélecteur.
*/
function clickCandidates(doc, key, popup) {

    const list = [];

    (popup ? clickPopupBoxes(popup) : [doc]).forEach(box => {

        if (box.matches?.(key)) {
            list.push(box);
        }

        list.push(...box.querySelectorAll(key));

    });

    return list.filter(element =>
        element.getClientRects().length > 0
        && (popup || !element.closest(CLICK_OVERLAYS))
    );

}


function isStableId(id) {

    return id.length <= 40
        && /^[a-z][a-z0-9_-]*$/i.test(id)
        && !/\d{3,}/.test(id);

}


// Parent proche qui a un id parlant (pas une page entière : l'écran est déjà noté).
function stableIdAncestor(element, depth) {

    for (let node = element, level = 0; node && level <= depth; node = node.parentElement, level++) {

        if (node.id && isStableId(node.id) && !node.classList.contains("app-page")) {
            return node;
        }

    }

    return null;

}


function classedAncestor(element, depth) {

    for (let node = element, level = 0; node && level <= depth; node = node.parentElement, level++) {

        if (usableClasses(node).some(name => !CLICK_GENERIC_CLASSES.has(name))) {
            return node;
        }

    }

    return null;

}


function usableClasses(element) {

    return [...element.classList].filter(name =>
        /^[a-z][a-z0-9_-]*$/i.test(name) && !/\d{3,}/.test(name)
    );

}


function clickSelector(element) {

    if (element.id && isStableId(element.id)) {
        return "#" + element.id;
    }

    const classes = usableClasses(element);

    const main = classes.find(name => !CLICK_GENERIC_CLASSES.has(name));

    let selector = element.tagName.toLowerCase();

    if (main) {

        selector += "." + main;

        // Variante du même composant (validate-fab-wait, contest-vote--keep…).
        const variant = classes.find(name => name !== main && name.startsWith(main + "-"));

        if (variant) {
            selector += "." + variant;
        }

    }

    const dataKey = CLICK_DATA_KEYS.find(key => /^[a-z0-9_-]{1,24}$/i.test(element.dataset[key] || ""));

    if (dataKey) {
        selector += `[data-${dataKey}="${element.dataset[dataKey]}"]`;
    }

    // Bouton sans classe parlante : on précise où il se trouve.
    if (!main && element.parentElement) {

        const anchor = stableIdAncestor(element.parentElement, 8);

        const parent = anchor ? null : element.parentElement.closest("[class]");

        const parentClass = parent && usableClasses(parent).find(name => !CLICK_GENERIC_CLASSES.has(name));

        const context =
            anchor ? "#" + anchor.id
            : parentClass ? parent.tagName.toLowerCase() + "." + parentClass
            : "";

        if (context) {
            selector = context + " " + selector;
        }

    }

    return selector;

}


/*
    Envoi d'un paquet. fetch « keepalive » : le dernier paquet part même
    quand la page se ferme. Prefer: return=minimal, car le joueur n'a pas
    le droit de relire ses clics.
*/
function flushClicks() {

    if (clickQueue.length === 0 || !clickToken) {
        return;
    }

    const rows = clickQueue.splice(0, 50);

    fetch(`${SUPABASE_URL}/rest/v1/click_events`, {
        method: "POST",
        keepalive: true,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${clickToken}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
        },
        body: JSON.stringify(rows)
    })
        .then(response => {

            // Refusé par la base (accord effacé, compte exclu…) : on relit l'état,
            // et la fenêtre revient s'il faut de nouveau accepter.
            if (response.status === 403) {

                stopClickTracking();

                supabaseClient.rpc("my_click_tracking").then(({ data: state, error }) => {

                    if (error) {
                        return;
                    }

                    applyClickState(state);

                    askClickConsent();

                });

            }

        })
        .catch(() => {
            // Hors ligne : ce paquet est perdu (ce n'est qu'une statistique).
        });

}


function flushClicksWhenHidden() {

    if (document.visibilityState === "hidden") {
        flushClicks();
    }

}



/* =========================================================
   APERÇU DANS LE CADRE DE LA PAGE HEAT MAP (app.html?apercu-clics)
========================================================= */

let clickPreviewRpcs = null;

let clickPreviewToastTimer = null;


function setupClickPreview() {

    // Geste de l'admin dans le cadre (la page Heat map le note aussi quand elle change d'écran).
    ["pointerdown", "keydown"].forEach(type => {

        window.addEventListener(type, () => {
            window.clickPreviewAction = Date.now();
        }, true);

    });

    // Fenêtres ouvertes par le site sans geste de l'admin (annonce, cadeau, défi reçu…) : refermées.
    document
        .querySelectorAll(".modal:not(.hidden)")
        .forEach(modal => modal.classList.add("hidden"));

    new MutationObserver(records => {

        if (Date.now() - (window.clickPreviewAction || 0) < CLICK_PREVIEW_POPUP_MS) {
            return;
        }

        records.forEach(({ target }) => {

            if (target.classList.contains("modal") && !target.classList.contains("hidden")) {
                target.classList.add("hidden");
            }

        });

    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });

}


/*
    Toutes les requêtes du site de l'aperçu passent ici (voir createClient dans app.js).
    Passent : les lectures (GET), le renouvellement de la session, les fonctions
    « stable » de la base (Postgres leur interdit d'écrire, liste donnée par
    admin_click_preview_rpcs) et CLICK_PREVIEW_ALLOWED_RPCS. Le reste (miser,
    créer, donner, voter…) reçoit un refus, et rien n'est enregistré.
*/
function clickPreviewFetch(input, init = {}) {

    const url = String(input?.url || input);

    const method = (init.method || input?.method || "GET").toUpperCase();

    if (method === "GET" || method === "HEAD" || !url.startsWith(SUPABASE_URL)) {
        return fetch(input, init);
    }

    const path = new URL(url).pathname;

    if (path === "/auth/v1/token") {
        return fetch(input, init);
    }

    const rpc = path.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/i)?.[1];

    if (!rpc) {
        return clickPreviewRefusal();
    }

    if (CLICK_PREVIEW_ALLOWED_RPCS.has(rpc)) {
        return fetch(input, init);
    }

    return clickPreviewReadRpcs().then(names =>
        names.has(rpc) ? fetch(input, init) : clickPreviewRefusal()
    );

}


function clickPreviewReadRpcs() {

    if (!clickPreviewRpcs) {

        clickPreviewRpcs = supabaseClient.rpc("admin_click_preview_rpcs").then(({ data, error }) => {

            if (error) {

                // On réessaiera à la prochaine requête ; en attendant, tout est bloqué.
                console.error("Erreur admin_click_preview_rpcs :", error);

                clickPreviewRpcs = null;

                return new Set();

            }

            return new Set(data || []);

        });

    }

    return clickPreviewRpcs;

}


// Réponse d'erreur ordinaire : le site affiche son message d'erreur habituel.
function clickPreviewRefusal() {

    showClickPreviewBlocked();

    return Promise.resolve(new Response(
        JSON.stringify({ message: "Aperçu de la Heat map : rien n'est enregistré.", code: "PREVIEW" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
    ));

}


function showClickPreviewBlocked() {

    let toast = document.getElementById("click-preview-toast");

    // Posé hors de <body> : la page Heat map ne surveille que <body>.
    if (!toast) {

        toast = document.createElement("div");

        toast.id = "click-preview-toast";

        toast.className = "click-preview-toast";

        toast.textContent = "🔒 Aperçu : rien n'est enregistré";

        document.documentElement.appendChild(toast);

    }

    toast.classList.add("visible");

    clearTimeout(clickPreviewToastTimer);

    clickPreviewToastTimer = setTimeout(() => toast.classList.remove("visible"), 2200);

}



/* =========================================================
   ONGLET HEAT MAP (admin)
========================================================= */

const heatmap = {
    // Écran affiché dans l'aperçu, dont les clics sont chargés (suit le cadre tout seul).
    screen: "bets-page",
    device: "phone",
    period: "7",
    // "" = tous les niveaux, "5" = niveau 5 et plus.
    level: "",
    scope: "screen",
    // "map" : la carte ; "analysis" : l'onglet Analyses.
    view: "map",
    frame: null,
    ready: null,
    loaded: false,
    failed: false,
    // Réponses de la base par écran / appareil / période / portée (vidé à chaque ouverture).
    cache: new Map(),
    cells: [],
    ranking: [],
    summary: null,
    // Écran des clics reçus (null pendant un chargement : rien n'est dessiné).
    dataScreen: null,
    // Éléments de l'aperçu et leurs cases de clics ; clés cliquées absentes de l'écran.
    anchors: [],
    missing: [],
    missingTotal: 0,
    selected: null,
    hovered: null,
    drawerOpen: null,
    token: 0,
    navToken: 0,
    layoutTimer: null,
    settleTimer: null,
    paintPending: false,
    // "fixed" : seuls les éléments fixes sont à redessiner (la page a défilé) ; "all" : tout.
    paintMode: null,
    // Plus forte densité du calque de la page (gardée quand seul le calque fixe est redessiné).
    pagePeak: 0,
    // Dernier dessin de chaque calque, pour ne pas le refaire à l'identique.
    signatures: {},
    // Élément choisi depuis les Analyses : on le fait défiler à l'écran une fois placé.
    scrollToSelected: false,
    analysisToken: 0,
    compareToken: 0
};

let heatmapLut = null;

// Dernier contenu posé dans les encadrés du tiroir (redessinés seulement s'ils changent).
const heatmapRendered = new Map();


function setupHeatmapPage() {

    const navButton = document.getElementById("heatmap-nav-button");

    navButton?.classList.remove("hidden");

    navButton?.addEventListener("click", openHeatmap);

    document.getElementById("heatmap-close").addEventListener("click", () => showPage("bets-page"));

    // Écran : on l'ouvre dans l'aperçu, la carte suit toute seule.
    document.getElementById("heatmap-screen").addEventListener("change", event => {

        navigateHeatmapFrame(event.target.value);

    });

    ["device", "period", "level"].forEach(key => {

        document.getElementById("heatmap-" + key).addEventListener("change", event => {

            heatmap[key] = event.target.value;

            heatmap.selected = null;

            fitHeatmapFrame();

            loadHeatmapData();

            if (heatmap.view === "analysis") {

                loadHeatmapAnalysis();

                if (key !== "period") {
                    loadHeatmapCompare();
                }

            }

        });

    });

    document.querySelectorAll("[data-heatmap-view]").forEach(button => {

        button.addEventListener("click", () => setHeatmapView(button.dataset.heatmapView));

    });

    // Ligne des Analyses : on l'ouvre sur la carte, l'élément entouré.
    document.getElementById("heatmap-analysis").addEventListener("click", event => {

        const row = event.target.closest("[data-goto-screen]");

        if (!row) {
            return;
        }

        heatmap.selected = row.dataset.gotoElement;

        heatmap.scrollToSelected = true;

        setHeatmapView("map");

        navigateHeatmapFrame(row.dataset.gotoScreen);

    });

    // Avant / après : par défaut, le changement d'il y a 7 jours.
    const compareDate = document.getElementById("heatmap-compare-date");

    const weekAgo = new Date(Date.now() - 7 * 86400000);

    compareDate.value = localDateValue(weekAgo);

    compareDate.max = localDateValue(new Date());

    compareDate.addEventListener("change", loadHeatmapCompare);

    document.getElementById("heatmap-compare-span").addEventListener("change", loadHeatmapCompare);

    document.getElementById("heatmap-reload").addEventListener("click", reloadHeatmapFrame);

    document.querySelectorAll("[data-heatmap-scope]").forEach(button => {

        button.addEventListener("click", async () => {

            heatmap.scope = button.dataset.heatmapScope;

            document
                .querySelectorAll("[data-heatmap-scope]")
                .forEach(other => other.classList.toggle("active", other === button));

            const token = heatmap.token;

            const { data, error } = await loadHeatmapRanking();

            if (token !== heatmap.token) {
                return;
            }

            if (error) {
                console.error("Erreur admin_click_ranking :", error);
            }

            heatmap.ranking = data || [];

            renderHeatmapRanking();

            renderHeatmapStats();

        });

    });

    document.getElementById("heatmap-rank-toggle").addEventListener("click", () => {

        setHeatmapDrawer(!heatmap.drawerOpen);

    });

    // Survol d'une ligne du classement : l'élément est entouré dans l'aperçu ; clic : il le reste.
    const drawer = document.getElementById("heatmap-drawer");

    drawer.addEventListener("mouseover", event => {

        const key = event.target.closest("[data-heatmap-key]")?.dataset.heatmapKey || null;

        if (key !== heatmap.hovered) {

            heatmap.hovered = key;

            scheduleHeatmapPaint();

        }

    });

    drawer.addEventListener("mouseleave", () => {

        heatmap.hovered = null;

        scheduleHeatmapPaint();

    });

    drawer.addEventListener("click", event => {

        const row = event.target.closest("[data-heatmap-key]");

        if (row) {
            selectHeatmapElement(row.dataset.heatmapKey);
        }

    });

    let resizeTimer = null;

    window.addEventListener("resize", () => {

        if (!isHeatmapOpen()) {
            return;
        }

        clearTimeout(resizeTimer);

        resizeTimer = setTimeout(fitHeatmapFrame, 150);

    });

    document.querySelector(".heatmap-legend i").style.background =
        `linear-gradient(90deg, ${HEATMAP_PALETTE.join(", ")})`;

}


function isHeatmapOpen() {

    return !document.getElementById("heatmap-page").classList.contains("hidden");

}


async function openHeatmap() {

    // Le clic de l'onglet affiche la page juste après ce code (showPage) : on attend pour mesurer.
    await new Promise(resolve => setTimeout(resolve));

    if (heatmap.drawerOpen === null) {

        // Ordinateur : classement ouvert ; téléphone : fermé pour voir la carte.
        setHeatmapDrawer(!PHONE_LAYOUT.matches);

    }

    // Clics frais à chaque ouverture de l'onglet.
    heatmap.cache.clear();

    if (!heatmap.frame) {
        createHeatmapFrame();
    }

    fitHeatmapFrame();

    await loadHeatmapData();

}


function setHeatmapDrawer(open) {

    heatmap.drawerOpen = open;

    document.getElementById("heatmap-page").classList.toggle("heatmap-drawer-open", open);

    document.getElementById("heatmap-rank-toggle").textContent =
        open ? "✕ Fermer le classement" : "🏆 Classement";

    fitHeatmapFrame();

}


// Le vrai site, connecté avec le compte admin, en mode aperçu (cliquable, rien ne s'enregistre).
function createHeatmapFrame(src = "app.html?apercu-clics") {

    const frame = document.createElement("iframe");

    frame.className = "heatmap-iframe";

    frame.title = "Aperçu du site";

    frame.src = src;

    document.getElementById("heatmap-frame").appendChild(frame);

    heatmap.frame = frame;

    heatmap.ready = new Promise(resolve => {

        const started = Date.now();

        const check = () => {

            // Cadre remplacé entre-temps (bouton « Recharger ») : on abandonne celui-ci.
            if (heatmap.frame !== frame) {

                resolve();

                return;

            }

            const doc = frame.contentDocument;

            const ready =
                doc?.body
                && doc.getElementById("bets-page")
                && !doc.body.classList.contains("app-loading")
                && typeof frame.contentWindow.showPage === "function";

            if (ready) {

                heatmap.loaded = true;

                watchHeatmapFrame();

                resolve();

                return;

            }

            if (Date.now() - started > 25000) {

                heatmap.failed = true;

                fitHeatmapFrame();

                resolve();

                return;

            }

            setTimeout(check, 300);

        };

        frame.addEventListener("load", check, { once: true });

    });

    fitHeatmapFrame();

}


// Remet l'aperçu à zéro (après avoir beaucoup cliqué dedans), avec des clics frais.
function reloadHeatmapFrame() {

    heatmap.frame?.remove();

    heatmap.frame = null;

    heatmap.loaded = false;

    heatmap.failed = false;

    heatmap.anchors = [];

    heatmap.cache.clear();

    createHeatmapFrame();

    loadHeatmapData();

}


/*
    Le site du cadre est surveillé : page qui change, fenêtre qui s'ouvre,
    cartes qui arrivent → les clics sont replacés (et ceux d'un nouvel écran
    chargés) ; défilement → la chaleur est redessinée. Le calque et les
    cadres de surbrillance sont posés hors de <body> pour ne pas se surveiller eux-mêmes.
*/
function watchHeatmapFrame() {

    const doc = heatmapDoc();

    if (!doc) {
        return;
    }

    const win = heatmap.frame.contentWindow;

    new win.MutationObserver(scheduleHeatmapLayout).observe(doc.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "hidden"]
    });

    // La page défile : son calque suit tout seul, seuls les éléments fixes ou collés sont
    // redessinés. Une zone qui défile à l'intérieur (fenêtre, liste) : tout est redessiné.
    doc.addEventListener("scroll", event => {
        scheduleHeatmapPaint(event.target === doc ? "fixed" : "all");
    }, { capture: true, passive: true });

    win.addEventListener("resize", scheduleHeatmapLayout);

    navigateHeatmapFrame(heatmap.screen);

}


function heatmapDoc() {

    return heatmap.loaded ? heatmap.frame?.contentDocument || null : null;

}


// Le cadre garde la vraie largeur de l'écran choisi, réduit pour tenir dans la page.
function fitHeatmapFrame() {

    const device = HEATMAP_DEVICES[heatmap.device];

    const stage = document.getElementById("heatmap-stage");

    const holder = document.getElementById("heatmap-frame");

    const label = document.getElementById("heatmap-device-label");

    label.textContent = heatmap.failed
        ? "Le site n'a pas pu s'afficher dans le cadre : quitte la page Heat map et rouvre-la."
        : `${device.label} · affiché en ${device.width} px de large (${device.note})`
            + (heatmap.frame && !heatmap.loaded ? " · chargement du site…" : "")
            + (heatmap.missingTotal
                ? ` · ${formatCount(heatmap.missingTotal)} clic${heatmap.missingTotal > 1 ? "s" : ""} sur des éléments absents de ton écran`
                : "");

    const availableWidth = stage.clientWidth - 24;

    const availableHeight = stage.clientHeight - label.offsetHeight - 30;

    if (availableWidth <= 0 || availableHeight <= 0) {
        return;
    }

    const scale = Math.min(1, availableWidth / device.width, availableHeight / device.height);

    holder.style.width = Math.floor(device.width * scale) + "px";

    holder.style.height = Math.floor(device.height * scale) + "px";

    holder.classList.toggle("heatmap-frame-phone", heatmap.device === "phone");

    if (heatmap.frame) {

        heatmap.frame.style.width = device.width + "px";

        heatmap.frame.style.height = device.height + "px";

        heatmap.frame.style.transform = `scale(${scale})`;

    }

}


function loadHeatmapRanking() {

    return supabaseClient.rpc("admin_click_ranking", {
        p_screen: heatmap.scope === "all" ? null : heatmap.screen,
        p_bucket: heatmap.device,
        p_days: Number(heatmap.period),
        p_level: heatmapLevel()
    });

}


// Filtre « Niveau » : null = tous (la base compte « 5 » comme 5 et plus).
function heatmapLevel() {

    return heatmap.level === "" ? null : Number(heatmap.level);

}


async function loadHeatmapData() {

    const token = ++heatmap.token;

    const screen = heatmap.screen;

    const cacheKey = [screen, heatmap.device, heatmap.period, heatmap.level, heatmap.scope].join("|");

    heatmap.dataScreen = null;

    renderHeatmapScreens();

    let data = heatmap.cache.get(cacheKey);

    if (!data) {

        const params = {
            p_screen: screen,
            p_bucket: heatmap.device,
            p_days: Number(heatmap.period),
            p_level: heatmapLevel()
        };

        const [summary, cells, ranking] = await Promise.all([
            supabaseClient.rpc("admin_click_summary", params),
            supabaseClient.rpc("admin_click_heatmap", { ...params, p_cell: HEATMAP_CELL }),
            loadHeatmapRanking()
        ]);

        // L'écran ou un filtre a changé pendant le chargement : la réponse suivante s'en occupe.
        if (token !== heatmap.token) {
            return;
        }

        const error = summary.error || cells.error || ranking.error;

        if (error) {
            console.error("Erreur heat map :", error);
        }

        data = {
            summary: summary.data || null,
            cells: cells.data || [],
            ranking: ranking.data || [],
            error
        };

        if (!error) {
            heatmap.cache.set(cacheKey, data);
        }

    }

    heatmap.summary = data.summary;

    heatmap.cells = data.cells;

    heatmap.ranking = data.ranking;

    heatmap.dataScreen = screen;

    renderHeatmapScreens();

    renderHeatmapStats();

    renderHeatmapRanking();

    renderHeatmapStorage();

    const empty = document.getElementById("heatmap-empty");

    empty.textContent = data.error
        ? "Impossible de charger les clics : " + (data.error.message || "erreur inconnue")
        : `Pas encore de clics sur « ${screenLabel(screen)} » pour ces filtres. Les joueurs qui acceptent la fenêtre d'accord rempliront la carte au fil des visites.`;

    empty.classList.toggle("hidden", !data.error && (heatmap.summary?.clicks || 0) > 0);

    layoutHeatmap();

}


// Écran affiché dans l'aperçu : la fenêtre ou le volet ouvert du dessus, sinon la page.
function heatmapFrameScreen(doc) {

    const win = doc.defaultView;

    let top = null;

    let topZ = -Infinity;

    doc.querySelectorAll(CLICK_POPUPS).forEach(popup => {

        if (!popup.id || popup.classList.contains("hidden") || popup.getClientRects().length === 0) {
            return;
        }

        const z = Number(win.getComputedStyle(popup).zIndex) || 0;

        if (z >= topZ) {

            top = popup;

            topZ = z;

        }

    });

    return top?.id || doc.querySelector(".app-page:not(.hidden)")?.id || "autre";

}


// Fenêtre ou volet de l'écran affiché (null pour une page : on cherche dans toute la page).
function heatmapScreenPopup(doc) {

    const element = doc.getElementById(heatmap.screen);

    return element?.matches(CLICK_POPUPS) ? element : null;

}


// Ouvre dans l'aperçu la page ou la fenêtre choisie dans le filtre « Écran ».
function navigateHeatmapFrame(screen) {

    const doc = heatmapDoc();

    if (!doc) {

        // Site pas encore chargé : il s'ouvrira sur cet écran (watchHeatmapFrame).
        heatmap.screen = screen;

        loadHeatmapData();

        return;

    }

    const win = heatmap.frame.contentWindow;

    const nav = ++heatmap.navToken;

    // Geste de l'admin : la fenêtre qu'on ouvre n'est pas prise pour une annonce et refermée.
    win.clickPreviewAction = Date.now();

    doc
        .querySelectorAll(".modal:not(.hidden), #group-menu:not(.hidden)")
        .forEach(popup => popup.classList.add("hidden"));

    // La carte dépliée se replie par le site (sinon elle ne pourrait plus se rouvrir).
    if (win.isStakesPanelOpen?.()) {
        win.closeStakesPanel(true);
    }

    const target = doc.getElementById(screen);

    if (target?.matches(CLICK_POPUPS)) {

        if (doc.querySelector(".app-page:not(.hidden)")?.id !== "bets-page") {
            win.showPage("bets-page", true);
        }

        // Ouverte comme un joueur (une vraie cote, une vraie ligne du classement…).
        let opener = null;

        try {
            opener = HEATMAP_MODAL_OPENERS[screen]
                ? clickCandidates(doc, HEATMAP_MODAL_OPENERS[screen], false)[0]
                : null;
        } catch (error) {
            opener = null;
        }

        opener?.click();

        // Pas de bouton pour l'ouvrir, ou il n'a rien ouvert : la fenêtre telle quelle
        // (pas un volet : la carte dépliée vide n'aurait pas de sens).
        setTimeout(() => {

            if (
                heatmap.navToken === nav
                && heatmap.frame?.contentWindow === win
                && target.classList.contains("modal")
                && target.classList.contains("hidden")
            ) {

                win.clickPreviewAction = Date.now();

                target.classList.remove("hidden");

            }

        }, opener ? 1200 : 0);

    } else if (target?.classList.contains("app-page")) {

        // Le vrai onglet si possible : la boutique et les missions se redessinent à l'ouverture.
        const tab = doc.querySelector(`.nav-button[data-page="${screen}"]`);

        if (tab) {
            tab.click();
        } else {
            win.showPage(screen, true);
        }

    } else {

        win.showPage("bets-page", true);

    }

    win.scrollTo(0, 0);

    scheduleHeatmapLayout();

}


function screenLabel(screen) {

    return SCREEN_LABELS[screen] || screen;

}


function clickLabelHtml(key) {

    if (CLICK_LABELS[key]) {
        return escapeHtml(CLICK_LABELS[key]);
    }

    const pattern = CLICK_LABEL_PATTERNS.find(([regex]) => regex.test(key));

    if (pattern) {
        return escapeHtml(key.replace(new RegExp(".*" + pattern[0].source + ".*"), pattern[1]));
    }

    return `<code>${escapeHtml(key)}</code>`;

}


function formatCount(value) {

    return Number(value || 0).toLocaleString("fr-FR");

}


function renderHeatmapScreens() {

    const counts = new Map(
        (heatmap.summary?.screens || []).map(row => [row.screen, row.clicks])
    );

    const screens = [...new Set([...counts.keys(), ...HEATMAP_MAIN_SCREENS, heatmap.screen])];

    document.getElementById("heatmap-screen").innerHTML = screens
        .map(screen => `
            <option value="${escapeHtml(screen)}" ${screen === heatmap.screen ? "selected" : ""}>
                ${escapeHtml(screenLabel(screen))}${counts.has(screen) ? ` (${formatCount(counts.get(screen))})` : ""}
            </option>
        `)
        .join("");

}


function renderHeatmapStats() {

    const clicks = heatmap.summary?.clicks || 0;

    const visits = heatmap.summary?.visits || 0;

    const top = heatmap.ranking[0];

    document.getElementById("heatmap-stats").innerHTML = `
        <div><b>${formatCount(clicks)}</b><span>clics</span></div>
        <div><b>${formatCount(visits)}</b><span>visites</span></div>
        <div><b>${visits ? Math.round(clicks / visits) : 0}</b><span>clics par visite</span></div>
        <div><b class="heatmap-stat-small">${top ? clickLabelHtml(top.element) : "—"}</b><span>le plus cliqué</span></div>
    `;

}


function renderHeatmapRanking() {

    const list = document.getElementById("heatmap-rank-list");

    const max = heatmap.ranking[0]?.clicks || 1;

    list.innerHTML = heatmap.ranking.length
        ? heatmap.ranking
            .slice(0, 15)
            .map((row, index) => {

                const share = row.clicks / max;

                const where = heatmap.scope === "all"
                    ? `<small>${escapeHtml((row.screens || []).map(screenLabel).join(", "))}</small>`
                    : "";

                return `
                    <li
                        data-heatmap-key="${escapeHtml(row.element)}"
                        class="${row.element === heatmap.selected ? "selected" : ""}"
                    >
                        <span class="heatmap-rank-n">${index + 1}</span>
                        <div class="heatmap-rank-body">
                            <div class="heatmap-rank-line">
                                <span>${clickLabelHtml(row.element)}${where}</span>
                                <b>${formatCount(row.clicks)}</b>
                            </div>
                            <div class="heatmap-rank-bar">
                                <i style="width:${share * 100}%;background:${heatColor(Math.pow(share, 0.55))}"></i>
                            </div>
                        </div>
                    </li>
                `;

            })
            .join("")
        : `<li class="heatmap-rank-empty">Aucun clic pour ces filtres.</li>`;

    renderHeatmapUnused();

}


// Éléments connus, visibles sur l'écran affiché, que personne n'a cliqués.
function renderHeatmapUnused() {

    const box = document.getElementById("heatmap-unused");

    const doc = heatmapDoc();

    const shown =
        doc
        && heatmap.scope === "screen"
        && heatmap.dataScreen === heatmap.screen
        && (heatmap.summary?.clicks || 0) > 0;

    const used = new Set(heatmap.ranking.map(row => row.element));

    const unused = shown
        ? Object.keys(CLICK_LABELS).filter(key => !used.has(key) && heatmapElements(doc, key).length > 0)
        : [];

    setHeatmapHtml(box, unused.length
        ? `<span>😴 Jamais cliqués sur la période</span>`
            + unused.map(key => `<em data-heatmap-key="${escapeHtml(key)}">${escapeHtml(CLICK_LABELS[key])}</em>`).join("")
        : "");

    box.classList.toggle("hidden", unused.length === 0);

}


// Clics sur des éléments que l'admin n'a pas à l'écran (autre niveau, 6e carte quand il y en a 4…).
function renderHeatmapMissing() {

    const box = document.getElementById("heatmap-missing");

    const total = heatmap.missing.reduce((sum, row) => sum + row.clicks, 0);

    setHeatmapHtml(box, total
        ? `<span>👻 Cliqués, mais absents de ton écran (${formatCount(total)} clic${total > 1 ? "s" : ""})</span>`
            + heatmap.missing
                .slice(0, 12)
                .map(row => `<em>${clickLabelHtml(row.element)} · ${formatCount(row.clicks)}</em>`)
                .join("")
        : "");

    box.classList.toggle("hidden", total === 0);

    if (total !== heatmap.missingTotal) {

        heatmap.missingTotal = total;

        fitHeatmapFrame();

    }

}


function setHeatmapHtml(box, html) {

    if (heatmapRendered.get(box.id) !== html) {

        heatmapRendered.set(box.id, html);

        box.innerHTML = html;

    }

}


function renderHeatmapStorage() {

    const summary = heatmap.summary;

    const box = document.getElementById("heatmap-storage");

    if (!summary) {

        box.innerHTML = "";

        return;

    }

    const mb = bytes => (bytes / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " Mo";

    const percent = bytes => Math.min(100, bytes / 5e6) + "%";

    box.innerHTML = `
        <h3>💾 Place utilisée</h3>
        <div class="heatmap-storage-bar">
            <i class="heatmap-storage-base" style="width:${percent(summary.db_bytes - summary.table_bytes)}"></i>
            <i class="heatmap-storage-clicks" style="width:${percent(summary.table_bytes)}"></i>
        </div>
        <p>
            <b>${mb(summary.table_bytes)}</b> de clics (${formatCount(summary.rows_total)} lignes)
            · base entière <b>${mb(summary.db_bytes)} sur 500 Mo</b><br>
            ${formatCount(summary.consents)} joueur${summary.consents > 1 ? "s ont" : " a"} accepté
            · clics de plus de 90 jours effacés chaque nuit.
        </p>
    `;

}


// Clic dans le classement : l'élément reste entouré (et l'aperçu passe sur son écran si besoin).
function selectHeatmapElement(key) {

    heatmap.selected = heatmap.selected === key ? null : key;

    document
        .querySelectorAll("#heatmap-rank-list li")
        .forEach(row => row.classList.toggle("selected", row.dataset.heatmapKey === heatmap.selected));

    const row = heatmap.ranking.find(item => item.element === key);

    if (heatmap.selected && heatmap.scope === "all" && row?.screens?.length && !row.screens.includes(heatmap.screen)) {

        navigateHeatmapFrame(row.screens[0]);

        return;

    }

    const doc = heatmapDoc();

    const first = doc && heatmapElements(doc, heatmap.selected)[0];

    first?.scrollIntoView({ block: "center" });

    scheduleHeatmapPaint();

    // Téléphone : on referme le classement pour voir l'élément.
    if (heatmap.selected && PHONE_LAYOUT.matches) {
        setHeatmapDrawer(false);
    }

}


// Éléments de l'aperçu qui portent cette clé, sur l'écran affiché.
function heatmapElements(doc, key) {

    if (!key) {
        return [];
    }

    try {
        return clickCandidates(doc, key, heatmapScreenPopup(doc));
    } catch (error) {
        // Clé qui n'est pas un sélecteur valable : rien à trouver.
        return [];
    }

}


/* ---------- Dessin de la chaleur ---------- */

function heatLut() {

    if (!heatmapLut) {

        const canvas = document.createElement("canvas");

        canvas.width = 256;

        canvas.height = 1;

        const ctx = canvas.getContext("2d");

        const gradient = ctx.createLinearGradient(0, 0, 256, 0);

        HEATMAP_PALETTE.forEach((color, index) => {
            gradient.addColorStop(index / (HEATMAP_PALETTE.length - 1), color);
        });

        ctx.fillStyle = gradient;

        ctx.fillRect(0, 0, 256, 1);

        heatmapLut = ctx.getImageData(0, 0, 256, 1).data;

    }

    return heatmapLut;

}


function heatColor(t) {

    const lut = heatLut();

    const i = Math.min(255, Math.max(0, Math.round(t * 255))) * 4;

    return `rgb(${lut[i]}, ${lut[i + 1]}, ${lut[i + 2]})`;

}


// Le site du cadre a changé : on replace les clics, puis une seconde fois quand les animations sont finies.
function scheduleHeatmapLayout() {

    clearTimeout(heatmap.layoutTimer);

    heatmap.layoutTimer = setTimeout(layoutHeatmap, 120);

    clearTimeout(heatmap.settleTimer);

    heatmap.settleTimer = setTimeout(layoutHeatmap, 700);

}


// Un dessin par image au plus ; "fixed" : seulement le calque des éléments fixes.
function scheduleHeatmapPaint(mode = "all") {

    heatmap.paintMode = heatmap.paintMode === "all" || mode === "all" ? "all" : "fixed";

    if (heatmap.paintPending) {
        return;
    }

    heatmap.paintPending = true;

    requestAnimationFrame(() => {

        const fixedOnly = heatmap.paintMode === "fixed";

        heatmap.paintPending = false;

        heatmap.paintMode = null;

        paintHeatmap(fixedOnly);

    });

}


/*
    Replace les clics reçus sur les éléments de l'aperçu : pour chaque clé, les
    éléments visibles de l'écran (dans la fenêtre ouverte, ou dans la page hors
    fenêtres), puis le rang noté chez le joueur. Ce qui n'existe pas chez
    l'admin (bouton d'un autre niveau, 6e carte quand il n'y en a que 4…) est
    listé à part. Si l'aperçu a changé d'écran, on charge d'abord ses clics.
*/
function layoutHeatmap() {

    const doc = heatmapDoc();

    if (!doc || !isHeatmapOpen() || heatmap.view !== "map") {
        return;
    }

    const screen = heatmapFrameScreen(doc);

    if (screen !== heatmap.screen) {

        heatmap.screen = screen;

        loadHeatmapData();

        return;

    }

    const anchors = new Map();

    const missing = new Map();

    if (heatmap.dataScreen === screen) {

        const popup = heatmapScreenPopup(doc);

        const candidates = new Map();

        heatmap.cells.forEach(row => {

            if (!candidates.has(row.element)) {

                try {
                    candidates.set(row.element, clickCandidates(doc, row.element, popup));
                } catch (error) {
                    candidates.set(row.element, []);
                }

            }

            const element = row.el_index === null ? null : candidates.get(row.element)[row.el_index];

            if (!element) {

                missing.set(row.element, (missing.get(row.element) || 0) + Number(row.clicks));

                return;

            }

            if (!anchors.has(element)) {
                anchors.set(element, []);
            }

            anchors.get(element).push(row);

        });

    }

    // Élément fixe ou collé (barre du haut, menu du bas, fenêtre…) : dessiné sur l'écran ;
    // les autres sur la page, et leur chaleur défile avec elle.
    const win = heatmap.frame.contentWindow;

    heatmap.anchors = [...anchors].map(([element, rows]) => ({
        element,
        rows,
        fixed: isFixedElement(element, win)
    }));

    heatmap.missing = [...missing]
        .map(([element, clicks]) => ({ element, clicks }))
        .sort((a, b) => b.clicks - a.clicks);

    renderHeatmapMissing();

    renderHeatmapUnused();

    paintHeatmap();

    if (heatmap.scrollToSelected && heatmap.dataScreen === screen) {

        heatmap.scrollToSelected = false;

        heatmapElements(doc, heatmap.selected)[0]?.scrollIntoView({ block: "center" });

    }

}


/*
    Dessin dans l'aperçu, sur deux calques :
    - la page : un calque posé dans le document, de toute sa hauteur. Il défile
      avec le site sans être redessiné : la chaleur reste collée aux cartes ;
    - les éléments fixes ou collés (barre du haut, menu du bas, fenêtres…) :
      un calque fixe de la taille de l'écran du cadre.
    Chaque case de clic est replacée dans son élément, là où il se trouve.
    La densité est calculée à demi-résolution puis colorée (bleu → rouge),
    avec le même maximum pour les deux calques. Un calque identique au
    précédent n'est pas redessiné (le site change souvent : comptes à rebours…).
*/
function paintHeatmap(fixedOnly = false) {

    const doc = heatmapDoc();

    if (!doc) {
        return;
    }

    const win = heatmap.frame.contentWindow;

    const width = doc.documentElement.clientWidth;

    const radius = Math.max(12, width * 0.036);

    const cell = HEATMAP_CELL / 100;

    const page = [];

    const fixed = [];

    heatmap.anchors.forEach(anchor => {

        if ((fixedOnly && !anchor.fixed) || !anchor.element.isConnected) {
            return;
        }

        const rect = anchor.element.getBoundingClientRect();

        if (rect.width === 0 && rect.height === 0) {
            return;
        }

        // Page : position dans le document ; fixe : position sur l'écran.
        const left = rect.left + (anchor.fixed ? 0 : win.scrollX);

        const top = rect.top + (anchor.fixed ? 0 : win.scrollY);

        anchor.rows.forEach(({ cx, cy, clicks }) => {

            (anchor.fixed ? fixed : page).push([
                left + (cx + 0.5) * cell * rect.width,
                top + (cy + 0.5) * cell * rect.height,
                Number(clicks)
            ]);

        });

    });

    if (!fixedOnly) {
        heatmap.pagePeak = heatPeak(page, radius);
    }

    const max = Math.max(heatmap.pagePeak, heatPeak(fixed, radius));

    if (!fixedOnly) {

        // Hauteur de la page sans le calque lui-même (sinon elle ne raccourcirait jamais).
        const pageCanvas = doc.getElementById("click-heat-page");

        if (pageCanvas) {
            pageCanvas.style.height = "0px";
        }

        const height = Math.min(doc.documentElement.scrollHeight, 16000);

        placeHeatLayer(doc, "click-heat-page", { width, height, points: page }, radius, max);

        placeHeatMarks(doc);

    }

    placeHeatLayer(doc, "click-heat-fixed", { width, height: win.innerHeight, points: fixed }, radius, max);

}


// Plus forte densité, calculée sur chaque point (cases voisines regroupées pour aller vite).
function heatPeak(points, radius) {

    const r2 = radius * radius;

    const grid = new Map();

    const cellKey = (x, y) => Math.floor(x / radius) + ":" + Math.floor(y / radius);

    points.forEach(point => {

        const key = cellKey(point[0], point[1]);

        if (!grid.has(key)) {
            grid.set(key, []);
        }

        grid.get(key).push(point);

    });

    let max = 0;

    points.forEach(([x, y]) => {

        const gx = Math.floor(x / radius);

        const gy = Math.floor(y / radius);

        let sum = 0;

        for (let i = -1; i <= 1; i++) {

            for (let j = -1; j <= 1; j++) {

                (grid.get((gx + i) + ":" + (gy + j)) || []).forEach(([qx, qy, clicks]) => {

                    const d2 = (qx - x) ** 2 + (qy - y) ** 2;

                    if (d2 < r2) {

                        const f = 1 - d2 / r2;

                        sum += clicks * f * f;

                    }

                });

            }

        }

        max = Math.max(max, sum);

    });

    return max;

}


// Élément survolé ou choisi dans le classement : entouré dans l'aperçu.
function placeHeatMarks(doc) {

    let box = doc.getElementById("click-heat-marks");

    if (!box) {

        box = doc.createElement("div");

        box.id = "click-heat-marks";

        doc.documentElement.appendChild(box);

    }

    box.innerHTML = "";

    heatmapElements(doc, heatmap.hovered || heatmap.selected)
        .slice(0, 40)
        .forEach(element => {

            const rect = element.getBoundingClientRect();

            const win = doc.defaultView;

            const fixed = isFixedElement(element, win);

            const mark = doc.createElement("div");

            mark.className = "click-heat-mark";

            // Comme la chaleur : collé à la page (défile avec elle) ou fixe sur l'écran.
            mark.style.position = fixed ? "fixed" : "absolute";

            mark.style.left = rect.left + (fixed ? 0 : win.scrollX) - 4 + "px";

            mark.style.top = rect.top + (fixed ? 0 : win.scrollY) - 4 + "px";

            mark.style.width = rect.width + 8 + "px";

            mark.style.height = rect.height + 8 + "px";

            box.appendChild(mark);

        });

}


function heatDensity(layer, radius) {

    const scale = 2;

    const w = Math.max(1, Math.ceil(layer.width / scale));

    const h = Math.max(1, Math.ceil(layer.height / scale));

    const acc = new Float32Array(w * h);

    const r = radius / scale;

    const r2 = r * r;

    layer.points.forEach(([px, py, clicks]) => {

        const x0 = px / scale;

        const y0 = py / scale;

        for (let y = Math.max(0, Math.floor(y0 - r)); y <= Math.min(h - 1, Math.ceil(y0 + r)); y++) {

            for (let x = Math.max(0, Math.floor(x0 - r)); x <= Math.min(w - 1, Math.ceil(x0 + r)); x++) {

                const d2 = (x - x0) ** 2 + (y - y0) ** 2;

                if (d2 < r2) {

                    const f = 1 - d2 / r2;

                    acc[y * w + x] += clicks * f * f;

                }

            }

        }

    });

    let max = 0;

    for (let i = 0; i < acc.length; i++) {
        if (acc[i] > max) {
            max = acc[i];
        }
    }

    return { acc, w, h, max };

}


function placeHeatLayer(doc, id, layer, radius, max) {

    const signature = [
        layer.width,
        layer.height,
        Math.round(max * 1000),
        layer.points.map(([x, y, clicks]) => Math.round(x) + "," + Math.round(y) + "," + clicks).join(";")
    ].join("|");

    let canvas = doc.getElementById(id);

    if (!canvas) {

        canvas = doc.createElement("canvas");

        canvas.id = id;

        canvas.className = "click-heat-layer";

        canvas.style.position = id === "click-heat-fixed" ? "fixed" : "absolute";

        doc.documentElement.appendChild(canvas);

        // Nouveau cadre (bouton « Recharger ») : rien n'y est encore dessiné.
        heatmap.signatures[id] = null;

    }

    canvas.style.width = layer.width + "px";

    canvas.style.height = layer.height + "px";

    if (heatmap.signatures[id] === signature) {
        return;
    }

    heatmap.signatures[id] = signature;

    const { acc, w, h } = heatDensity(layer, radius);

    // Changer la taille efface aussi l'ancien dessin.
    canvas.width = w;

    canvas.height = h;

    if (!max || layer.points.length === 0) {
        return;
    }

    const ctx = canvas.getContext("2d");

    const image = ctx.createImageData(w, h);

    const lut = heatLut();

    for (let j = 0; j < acc.length; j++) {

        if (!acc[j]) {
            continue;
        }

        const t = Math.min(1, Math.sqrt(acc[j] / max));

        if (t < 0.06) {
            continue;
        }

        const i = Math.min(255, Math.round(t * 255)) * 4;

        image.data[j * 4] = lut[i];
        image.data[j * 4 + 1] = lut[i + 1];
        image.data[j * 4 + 2] = lut[i + 2];
        image.data[j * 4 + 3] = Math.round(255 * HEATMAP_OPACITY * Math.min(1, (t - 0.06) * 3));

    }

    ctx.putImageData(image, 0, 0);

}



/* =========================================================
   ONGLET ANALYSES (admin) : ce qui gêne les joueurs, sur tous les écrans
   Clics dans le vide, clics répétés, parcours et abandons, avant / après.
   La base ne renvoie que des totaux (admin_click_analysis, admin_click_funnel).
========================================================= */

function setHeatmapView(view) {

    heatmap.view = view;

    document
        .querySelectorAll("[data-heatmap-view]")
        .forEach(button => button.classList.toggle("active", button.dataset.heatmapView === view));

    document.getElementById("heatmap-page").classList.toggle("heatmap-analysis-open", view === "analysis");

    if (view === "analysis") {

        loadHeatmapAnalysis();

        loadHeatmapCompare();

    } else {

        fitHeatmapFrame();

        scheduleHeatmapLayout();

    }

}


// Date du jour au format du champ date (heure de l'appareil, pas UTC).
function localDateValue(date) {

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");

}


function heatmapAnalysisParams(from = null, to = null) {

    return {
        p_bucket: heatmap.device,
        p_days: Number(heatmap.period),
        p_level: heatmapLevel(),
        p_from: from,
        p_to: to
    };

}


// Chiffres d'une période : analyse générale + chaque parcours.
async function fetchHeatmapAnalysis(from = null, to = null) {

    const params = heatmapAnalysisParams(from, to);

    const [analysis, ...funnels] = await Promise.all([
        supabaseClient.rpc("admin_click_analysis", { ...params, p_repeat_ok: CLICK_REPEAT_OK }),
        ...HEATMAP_FUNNELS.map(funnel => supabaseClient.rpc("admin_click_funnel", {
            ...params,
            p_steps: funnel.steps.map(({ element, screen }) => (screen ? { element, screen } : { element }))
        }))
    ]);

    const error = analysis.error || funnels.find(result => result.error)?.error || null;

    return {
        error,
        analysis: analysis.data || null,
        funnels: funnels.map(result => (result.data || []).map(Number))
    };

}


async function loadHeatmapAnalysis() {

    const token = ++heatmap.analysisToken;

    const status = document.getElementById("heatmap-analysis-status");

    status.textContent = "Chargement…";

    status.classList.remove("hidden");

    const result = await fetchHeatmapAnalysis();

    if (token !== heatmap.analysisToken) {
        return;
    }

    if (result.error) {

        console.error("Erreur analyses heat map :", result.error);

        status.textContent = "Impossible de charger les analyses : " + (result.error.message || "erreur inconnue");

        return;

    }

    const data = result.analysis || {};

    status.classList.toggle("hidden", (data.clicks || 0) > 0);

    status.textContent = "Pas encore de clics pour ces filtres.";

    renderHeatmapAnalysisStats(data);

    renderHeatmapDead(data);

    renderHeatmapRepeat(data);

    renderHeatmapFunnels(result.funnels);

}


// Part en pour cent, « — » si on ne peut pas la calculer.
function heatmapPercent(part, total, digits = 0) {

    if (!total) {
        return "—";
    }

    return (part / total * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits }) + " %";

}


function renderHeatmapAnalysisStats(data) {

    const clicks = data.clicks || 0;

    const visits = data.visits || 0;

    document.getElementById("heatmap-analysis-stats").innerHTML = `
        <div><b>${formatCount(clicks)}</b><span>clics</span></div>
        <div><b>${formatCount(visits)}</b><span>visites</span></div>
        <div><b>${visits ? (clicks / visits).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "—"}</b><span>clics par visite</span></div>
        <div><b>${heatmapPercent(data.dead_clicks || 0, data.dead_known || 0, 1)}</b><span>clics dans le vide</span></div>
    `;

}


// Ligne cliquable : l'élément et son écran, ouverts sur la carte.
function heatmapGotoRow(row, index, max, detail) {

    const share = max ? row.value / max : 0;

    return `
        <li
            data-goto-screen="${escapeHtml(row.screen)}"
            data-goto-element="${escapeHtml(row.element)}"
        >
            <span class="heatmap-rank-n">${index + 1}</span>
            <div class="heatmap-rank-body">
                <div class="heatmap-rank-line">
                    <span>${clickLabelHtml(row.element)}<small>${escapeHtml(screenLabel(row.screen))}</small></span>
                    <b>${detail}</b>
                </div>
                <div class="heatmap-rank-bar">
                    <i style="width:${share * 100}%;background:${heatColor(Math.pow(share, 0.55))}"></i>
                </div>
            </div>
        </li>
    `;

}


function renderHeatmapDead(data) {

    const list = document.getElementById("heatmap-dead-list");

    const rows = (data.dead || []).map(row => ({ ...row, value: row.clicks }));

    const total = data.dead_clicks || 0;

    list.innerHTML = rows.length
        ? rows.map((row, index) => heatmapGotoRow(
            row,
            index,
            rows[0].value,
            `${formatCount(row.clicks)} <small>${heatmapPercent(row.clicks, total)}</small>`
        )).join("")
        : `<li class="heatmap-rank-empty">${(data.dead_known || 0) > 0 ? "Aucun clic dans le vide 👍" : "Pas encore de clics notés « dans le vide » (comptés depuis le 19 octobre)."}</li>`;

}


function renderHeatmapRepeat(data) {

    const list = document.getElementById("heatmap-repeat-list");

    const rows = (data.repeat || []).map(row => ({ ...row, value: row.runs }));

    list.innerHTML = rows.length
        ? rows.map((row, index) => heatmapGotoRow(
            row,
            index,
            rows[0].value,
            `${formatCount(row.runs)}× <small>jusqu'à ${row.longest} de suite · ${formatCount(row.visits)} visite${row.visits > 1 ? "s" : ""}</small>`
        )).join("")
        : `<li class="heatmap-rank-empty">Aucun clic répété 👍</li>`;

}


function renderHeatmapFunnels(counts) {

    document.getElementById("heatmap-funnels").innerHTML = HEATMAP_FUNNELS
        .map((funnel, index) => {

            const steps = counts[index] || [];

            const first = steps[0] || 0;

            return `
                <div class="heatmap-funnel">
                    <h4>${escapeHtml(funnel.label)}</h4>
                    ${funnel.steps.map((step, stepIndex) => {

                        const visits = steps[stepIndex] || 0;

                        const share = first ? visits / first : 0;

                        const lost = stepIndex > 0 ? (steps[stepIndex - 1] || 0) - visits : 0;

                        return `
                            <div class="heatmap-funnel-step">
                                <div class="heatmap-rank-line">
                                    <span>${escapeHtml(step.label)}</span>
                                    <b>${formatCount(visits)} <small>${stepIndex > 0 ? heatmapPercent(visits, first) : "visites"}</small></b>
                                </div>
                                <div class="heatmap-rank-bar">
                                    <i style="width:${share * 100}%"></i>
                                </div>
                                ${lost > 0 ? `<small class="heatmap-funnel-lost">↓ ${formatCount(lost)} visite${lost > 1 ? "s" : ""} s'arrête${lost > 1 ? "nt" : ""} là</small>` : ""}
                            </div>
                        `;

                    }).join("")}
                </div>
            `;

        })
        .join("");

}


/* ---------- Avant / après ---------- */

async function loadHeatmapCompare() {

    const token = ++heatmap.compareToken;

    const box = document.getElementById("heatmap-compare");

    const value = document.getElementById("heatmap-compare-date").value;

    const span = Number(document.getElementById("heatmap-compare-span").value) || 7;

    if (!value) {

        box.innerHTML = `<p class="heatmap-card-hint">Choisis un jour.</p>`;

        return;

    }

    const [year, month, day] = value.split("-").map(Number);

    const change = new Date(year, month - 1, day);

    const start = new Date(year, month - 1, day - span);

    const end = new Date(year, month - 1, day + span);

    box.innerHTML = `<p class="heatmap-card-hint">Chargement…</p>`;

    const [before, after] = await Promise.all([
        fetchHeatmapAnalysis(start.toISOString(), change.toISOString()),
        fetchHeatmapAnalysis(change.toISOString(), end.toISOString())
    ]);

    if (token !== heatmap.compareToken) {
        return;
    }

    const error = before.error || after.error;

    if (error) {

        console.error("Erreur avant / après heat map :", error);

        box.innerHTML = `<p class="heatmap-card-hint">Impossible de comparer : ${escapeHtml(error.message || "erreur inconnue")}</p>`;

        return;

    }

    renderHeatmapCompare(before, after, { start, change, end });

}


/*
    Indicateurs comparés. better : "down" si une baisse est un progrès,
    "up" si c'est une hausse, null si ça dépend (clics par visite).
*/
function heatmapCompareRows(period) {

    const data = period.analysis || {};

    const visits = data.visits || 0;

    return [
        {
            label: "Clics par visite",
            value: visits ? (data.clicks || 0) / visits : null,
            unit: "",
            better: null
        },
        {
            label: "Clics dans le vide",
            value: data.dead_known ? (data.dead_clicks || 0) / data.dead_known * 100 : null,
            unit: " %",
            better: "down"
        },
        {
            label: "Clics répétés (séries pour 100 visites)",
            value: visits ? (data.repeat_runs || 0) / visits * 100 : null,
            unit: "",
            better: "down"
        },
        ...HEATMAP_FUNNELS.map((funnel, index) => {

            const steps = period.funnels[index] || [];

            return {
                label: `${funnel.label} : jusqu'au bout`,
                value: steps[0] ? steps[steps.length - 1] / steps[0] * 100 : null,
                unit: " %",
                better: "up"
            };

        })
    ];

}


function renderHeatmapCompare(before, after, { start, change, end }) {

    const format = value => value === null
        ? "—"
        : value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

    const dateLabel = date => date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

    const lastDay = new Date(end.getTime() - 86400000);

    const beforeRows = heatmapCompareRows(before);

    const afterRows = heatmapCompareRows(after);

    const rows = beforeRows.map((row, index) => {

        const next = afterRows[index];

        let trend = `<td class="heatmap-trend">—</td>`;

        if (row.value !== null && next.value !== null) {

            const diff = next.value - row.value;

            const better = row.better === null || Math.abs(diff) < 0.05
                ? ""
                : (diff < 0) === (row.better === "down") ? "better" : "worse";

            trend = `<td class="heatmap-trend ${better}">${diff > 0 ? "▲" : diff < 0 ? "▼" : "="} ${format(Math.abs(diff))}${row.unit}</td>`;

        }

        return `
            <tr>
                <th>${escapeHtml(row.label)}</th>
                <td>${format(row.value)}${row.value === null ? "" : row.unit}</td>
                <td>${format(next.value)}${next.value === null ? "" : next.unit}</td>
                ${trend}
            </tr>
        `;

    }).join("");

    const unfinished = end > new Date();

    document.getElementById("heatmap-compare").innerHTML = `
        <table class="heatmap-compare">
            <thead>
                <tr>
                    <th></th>
                    <th>Avant</th>
                    <th>Après</th>
                    <th>Évolution</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <p class="heatmap-card-hint">
            Avant : du ${dateLabel(start)} au ${dateLabel(new Date(change.getTime() - 86400000))}
            (${formatCount(before.analysis?.visits || 0)} visites) ·
            après : du ${dateLabel(change)} au ${dateLabel(lastDay)}
            (${formatCount(after.analysis?.visits || 0)} visites)${unfinished ? ", pas encore terminé" : ""}.
            Avec peu de visites, de petits écarts ne veulent rien dire.
        </p>
    `;

}
