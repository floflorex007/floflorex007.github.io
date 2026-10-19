/* =========================================================
   BETLAB — CARTE DES CLICS (voir heatmap.sql)

   Maquette Exemple-aide CLAUDE/demo-heatmap-admin.html (version B) :
   - la fenêtre d'accord est obligatoire pour jouer : accepter ou se
     déconnecter. Les joueurs qui acceptent envoient leurs clics par
     paquets (toutes les 10 s, dès 30 clics, et à la fermeture de la page) :
     écran, élément cliqué, position, taille d'écran, appareil. Jamais le
     texte tapé ni le pseudo (la base ne garde aucun lien avec le compte) ;
   - l'admin et les comptes de click_excluded_users ne sont jamais comptés ;
   - onglet « Heat map » (admin) : calque plein écran, le vrai site dans un
     cadre (app.html?apercu-clics) à la largeur du groupe d'écrans choisi,
     la chaleur par-dessus (froid bleu → chaud rouge) et le classement des
     éléments les plus cliqués. La base ne renvoie que des totaux.
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

// Taille des cases de regroupement : 2 % de la largeur (« Moyenne » dans la maquette).
const HEATMAP_CELL = 2;

// Couleurs « Classique » (froid → chaud) et intensité « Moyenne ».
const HEATMAP_PALETTE = ["#1d4ed8", "#06b6d4", "#22c55e", "#facc15", "#ef4444"];
const HEATMAP_OPACITY = 0.72;

// Écrans toujours proposés dans le filtre, même sans clic.
const HEATMAP_MAIN_SCREENS = ["bets-page", "my-bets-page", "missions-page", "shop-page", "profile-page", "bet-modal"];

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
    "click-consent-modal": "Fenêtre : accord des clics"
};

// Noms lisibles des éléments (clés enregistrées par clickElementKey).
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
    "#logout-button": "Déconnexion"
};

const CLICK_LABEL_PATTERNS = [
    [/data-stake="half"/, "½ Max"],
    [/data-stake="max"/, "🔥 Max"],
    [/data-stake="(\d+)"/, "Mise rapide $1 €"],
    [/^#close-/, "Fermer ✕"],
    [/^#[a-z-]+-modal$/, "Clic à côté de la fenêtre (la ferme)"],
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


// État du comptage pour ce joueur : 'accepted', 'refused', 'unknown' ou 'excluded'.
let clickState = null;

let clickQueue = [];

let clickFlushTimer = null;

let clickToken = null;

let clickVisit = null;

let clickAuthWatched = false;


// Aperçu de la page Heat map : posé tout de suite pour cacher fenêtres et tuto.
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

    const vw = document.documentElement.clientWidth || window.innerWidth;

    const vh = window.innerHeight;

    const spot = clickSpot(event, target, vw, vh);

    clickQueue.push({
        session_id: clickVisit,
        screen: clickScreen(target).slice(0, 40),
        element: clickElementKey(target).slice(0, 80) || null,
        layer: spot.layer,
        x_pm: toPerMille(spot.x),
        y_pm: toPerMille(spot.y),
        y_px: spot.yPx === undefined ? null : Math.max(0, Math.min(200000, Math.round(spot.yPx))),
        vw: Math.max(200, Math.min(8000, Math.round(vw))),
        vh: Math.max(200, Math.min(8000, Math.round(vh))),
        device: PHONE_LAYOUT.matches ? "mobile" : "desktop"
    });

    if (clickQueue.length >= CLICK_BATCH) {
        flushClicks();
    }

}


function toPerMille(value) {

    return Number.isFinite(value)
        ? Math.max(0, Math.min(1000, Math.round(value * 1000)))
        : 0;

}


// Écran : la fenêtre ouverte où l'on clique, sinon la page affichée.
function clickScreen(target) {

    const modal = target.closest(".modal");

    if (modal?.id) {
        return modal.id;
    }

    return document.querySelector(".app-page:not(.hidden)")?.id || "autre";

}


/*
    Position du clic, rapportée à ce qui ne bouge pas d'un écran à l'autre :
    - dans une fenêtre : par rapport à la fenêtre ('modal') ;
    - élément fixe (menu du bas, bulle du chat) ou fond d'une fenêtre : par rapport à l'écran ('fixed') ;
    - dans la zone centrale (1300 px au plus, centrée) : x par rapport à elle ('page') ;
    - ailleurs dans la page (barre du haut) : x par rapport à l'écran ('top').
    Dans la page, y_px = distance au haut de la page.
*/
function clickSpot(event, target, vw, vh) {

    const modal = target.closest(".modal");

    const box = modal?.querySelector(".modal-content");

    if (box && box.contains(target)) {

        const rect = box.getBoundingClientRect();

        return {
            layer: "modal",
            x: (event.clientX - rect.left) / rect.width,
            y: (event.clientY - rect.top) / rect.height
        };

    }

    if (modal || isFixedElement(target)) {

        return { layer: "fixed", x: event.clientX / vw, y: event.clientY / vh };

    }

    const pageY = event.clientY + window.scrollY;

    const y = pageY / Math.max(1, document.documentElement.scrollHeight);

    const main = target.closest(".main-container");

    if (main) {

        const rect = main.getBoundingClientRect();

        return { layer: "page", x: (event.clientX - rect.left) / rect.width, y, yPx: pageY };

    }

    return { layer: "top", x: event.clientX / vw, y, yPx: pageY };

}


function isFixedElement(element, view = window) {

    for (let node = element; node && node !== node.ownerDocument.body; node = node.parentElement) {

        const position = view.getComputedStyle(node).position;

        if (position === "fixed" || position === "sticky") {
            return true;
        }

    }

    return false;

}


/*
    Clé de l'élément cliqué : data-track-id, sinon son id, sinon un sélecteur
    court (balise + classe + data-page, data-stake…). Les identifiants qui
    contiennent un numéro (un pari, un joueur) sont ignorés pour que toutes
    les cartes comptent ensemble. Jamais le texte de l'élément.
*/
function clickElementKey(target) {

    const tracked = target.closest("[data-track-id]");

    if (tracked) {
        return `[data-track-id="${CSS.escape(tracked.dataset.trackId)}"]`;
    }

    // Un bouton, sinon l'élément touché ou un parent proche qui a une classe
    // (fond d'une carte, ligne du classement…), sinon un parent qui a un id.
    const element =
        target.closest(CLICK_INTERACTIVE)
        || stableIdAncestor(target, 1)
        || classedAncestor(target, 2)
        || stableIdAncestor(target, 3)
        || target;

    return clickSelector(element);

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

function setupClickPreview() {

    // Rien n'est cliquable dans l'aperçu (pas de mise par erreur) ; on peut faire défiler.
    // Les clics lancés par la page Heat map (changer d'onglet) passent : ils ne sont pas « isTrusted ».
    ["click", "dblclick", "mousedown", "pointerdown", "submit", "keydown", "contextmenu"].forEach(type => {

        window.addEventListener(type, event => {

            if (event.isTrusted) {

                event.preventDefault();

                event.stopImmediatePropagation();

            }

        }, true);

    });

}



/* =========================================================
   ONGLET HEAT MAP (admin)
========================================================= */

const heatmap = {
    screen: "bets-page",
    device: "phone",
    period: "7",
    scope: "screen",
    frame: null,
    ready: null,
    loaded: false,
    failed: false,
    cells: [],
    ranking: [],
    summary: null,
    selected: null,
    drawerOpen: null,
    token: 0
};

let heatmapLut = null;


function setupHeatmapPage() {

    const navButton = document.getElementById("heatmap-nav-button");

    navButton?.classList.remove("hidden");

    navButton?.addEventListener("click", openHeatmap);

    document.getElementById("heatmap-close").addEventListener("click", () => showPage("bets-page"));

    ["screen", "device", "period"].forEach(key => {

        document.getElementById("heatmap-" + key).addEventListener("change", event => {

            heatmap[key] = event.target.value;

            heatmap.selected = null;

            refreshHeatmap();

        });

    });

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

        const row = event.target.closest("[data-heatmap-key]");

        if (row) {
            highlightHeatmapElement(row.dataset.heatmapKey);
        }

    });

    drawer.addEventListener("mouseleave", () => highlightHeatmapElement(heatmap.selected));

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

    if (!heatmap.frame) {
        createHeatmapFrame();
    }

    await refreshHeatmap();

}


function setHeatmapDrawer(open) {

    heatmap.drawerOpen = open;

    document.getElementById("heatmap-page").classList.toggle("heatmap-drawer-open", open);

    document.getElementById("heatmap-rank-toggle").textContent =
        open ? "✕ Fermer le classement" : "🏆 Classement";

    fitHeatmapFrame();

}


// Le vrai site, connecté avec le compte admin, en mode aperçu.
function createHeatmapFrame(src = "app.html?apercu-clics") {

    const frame = document.createElement("iframe");

    frame.className = "heatmap-iframe";

    frame.title = "Aperçu du site";

    frame.tabIndex = -1;

    frame.src = src;

    document.getElementById("heatmap-frame").appendChild(frame);

    heatmap.frame = frame;

    heatmap.ready = new Promise(resolve => {

        const started = Date.now();

        const check = () => {

            const doc = frame.contentDocument;

            const ready =
                doc?.body
                && doc.getElementById("bets-page")
                && !doc.body.classList.contains("app-loading")
                && typeof frame.contentWindow.showPage === "function";

            if (ready) {

                heatmap.loaded = true;

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
            + (heatmap.frame && !heatmap.loaded ? " · chargement du site…" : "");

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
        p_days: Number(heatmap.period)
    });

}


async function refreshHeatmap() {

    const token = ++heatmap.token;

    const device = HEATMAP_DEVICES[heatmap.device];

    fitHeatmapFrame();

    const params = {
        p_screen: heatmap.screen,
        p_bucket: heatmap.device,
        p_days: Number(heatmap.period)
    };

    const [summary, cells, ranking] = await Promise.all([
        supabaseClient.rpc("admin_click_summary", params),
        supabaseClient.rpc("admin_click_heatmap", {
            ...params,
            p_cell: HEATMAP_CELL,
            p_cell_px: Math.round(device.width * HEATMAP_CELL / 100)
        }),
        loadHeatmapRanking()
    ]);

    // Un filtre a changé pendant le chargement : la réponse suivante s'en occupe.
    if (token !== heatmap.token) {
        return;
    }

    const error = summary.error || cells.error || ranking.error;

    if (error) {
        console.error("Erreur heat map :", error);
    }

    heatmap.summary = summary.data || null;

    heatmap.cells = cells.data || [];

    heatmap.ranking = ranking.data || [];

    renderHeatmapScreens();

    renderHeatmapStats();

    renderHeatmapRanking();

    renderHeatmapStorage();

    const empty = document.getElementById("heatmap-empty");

    empty.textContent = error
        ? "Impossible de charger les clics : " + (error.message || "erreur inconnue")
        : "Pas encore de clics ici pour ces filtres. Les joueurs qui acceptent la fenêtre d'accord rempliront la carte au fil des visites.";

    empty.classList.toggle("hidden", !error && (heatmap.summary?.clicks || 0) > 0);

    await heatmap.ready;

    if (token !== heatmap.token || !heatmap.loaded) {
        return;
    }

    fitHeatmapFrame();

    showHeatmapScreen();

    // Le site du cadre s'installe (cartes qui arrivent, largeur qui change) : on dessine deux fois.
    setTimeout(() => token === heatmap.token && drawHeatmap(), 700);

    setTimeout(() => token === heatmap.token && drawHeatmap(), 2000);

}


// Affiche dans le cadre la page ou la fenêtre choisie.
function showHeatmapScreen() {

    const doc = heatmapDoc();

    if (!doc) {
        return;
    }

    const win = heatmap.frame.contentWindow;

    doc
        .querySelectorAll(".modal.click-preview-show")
        .forEach(modal => modal.classList.remove("click-preview-show"));

    const target = doc.getElementById(heatmap.screen);

    if (target?.classList.contains("modal")) {

        if (doc.querySelector(".app-page:not(.hidden)")?.id !== "bets-page") {
            win.showPage("bets-page", true);
        }

        target.classList.add("click-preview-show");

    } else if (target?.classList.contains("app-page")) {

        // Le vrai onglet si possible : la boutique et les missions se redessinent à l'ouverture.
        const tab = doc.querySelector(`.nav-button[data-page="${heatmap.screen}"]`);

        if (tab) {
            tab.click();
        } else {
            win.showPage(heatmap.screen, true);
        }

    } else {

        win.showPage("bets-page", true);

    }

    win.scrollTo(0, 0);

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


// Éléments connus, visibles sur l'écran choisi, que personne n'a cliqués.
function renderHeatmapUnused() {

    const box = document.getElementById("heatmap-unused");

    const doc = heatmapDoc();

    if (!doc || heatmap.scope !== "screen" || (heatmap.summary?.clicks || 0) === 0) {

        box.classList.add("hidden");

        return;

    }

    const used = new Set(heatmap.ranking.map(row => row.element));

    const shownModal = doc.querySelector(".modal.click-preview-show");

    const unused = Object.keys(CLICK_LABELS).filter(key =>
        !used.has(key)
        && [...(shownModal || doc).querySelectorAll(key)].some(element =>
            element.getClientRects().length > 0
            && !element.closest(".modal.hidden:not(.click-preview-show)")
        )
    );

    box.innerHTML = unused.length
        ? `<span>😴 Jamais cliqués sur la période</span>`
            + unused.map(key => `<em data-heatmap-key="${escapeHtml(key)}">${escapeHtml(CLICK_LABELS[key])}</em>`).join("")
        : "";

    box.classList.toggle("hidden", unused.length === 0);

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

        heatmap.screen = row.screens[0];

        refreshHeatmap();

        return;

    }

    highlightHeatmapElement(heatmap.selected, true);

    // Téléphone : on referme le classement pour voir l'élément.
    if (heatmap.selected && PHONE_LAYOUT.matches) {
        setHeatmapDrawer(false);
    }

}


function highlightHeatmapElement(key, scroll = false) {

    const doc = heatmapDoc();

    if (!doc) {
        return;
    }

    const win = heatmap.frame.contentWindow;

    doc.querySelectorAll(".click-heat-mark").forEach(mark => mark.remove());

    if (!key) {
        return;
    }

    let elements = [];

    try {

        const shownModal = doc.querySelector(".modal.click-preview-show");

        elements = [...(shownModal || doc).querySelectorAll(key)].filter(element =>
            element.getClientRects().length > 0
            && !element.closest(".modal.hidden:not(.click-preview-show)")
        );

    } catch (error) {
        // Clé qui n'est pas un sélecteur valable : rien à entourer.
        return;
    }

    if (scroll && elements[0] && !isFixedElement(elements[0], win)) {
        elements[0].scrollIntoView({ block: "center" });
    }

    elements.slice(0, 40).forEach(element => {

        const rect = element.getBoundingClientRect();

        const fixed = isFixedElement(element, win);

        const mark = doc.createElement("div");

        mark.className = "click-heat-mark";

        mark.style.position = fixed ? "fixed" : "absolute";

        mark.style.left = rect.left + (fixed ? 0 : win.scrollX) - 4 + "px";

        mark.style.top = rect.top + (fixed ? 0 : win.scrollY) - 4 + "px";

        mark.style.width = rect.width + 8 + "px";

        mark.style.height = rect.height + 8 + "px";

        doc.body.appendChild(mark);

    });

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


/*
    Les cases renvoyées par la base sont replacées dans le cadre :
    - 'page' : dans la zone centrale du site affiché, y en pixels ;
    - 'top' : sur toute la largeur, y en pixels ;
    - 'fixed' : sur l'écran du cadre (calque qui ne défile pas) ;
    - 'modal' : sur la fenêtre affichée.
    La densité est calculée à demi-résolution, puis colorée (bleu → rouge)
    avec le même maximum pour tous les calques.
*/
function drawHeatmap() {

    const doc = heatmapDoc();

    if (!doc) {
        return;
    }

    const win = heatmap.frame.contentWindow;

    doc.querySelectorAll(".click-heat-layer").forEach(layer => layer.remove());

    const width = doc.documentElement.clientWidth;

    const height = win.innerHeight;

    const cell = HEATMAP_CELL / 100;

    const cellPx = Math.round(HEATMAP_DEVICES[heatmap.device].width * cell);

    const main = doc.querySelector(".main-container")?.getBoundingClientRect();

    const mainLeft = main ? main.left + win.scrollX : 0;

    const mainWidth = main ? main.width : width;

    const modalBox = doc
        .querySelector(".modal.click-preview-show .modal-content")
        ?.getBoundingClientRect();

    const layers = {
        page: { position: "absolute", left: 0, top: 0, width, height: Math.min(doc.documentElement.scrollHeight, 12000), points: [] },
        fixed: { position: "fixed", left: 0, top: 0, width, height, points: [] },
        modal: modalBox
            ? { position: "fixed", left: modalBox.left, top: modalBox.top, width: modalBox.width, height: modalBox.height, points: [] }
            : null
    };

    heatmap.cells.forEach(({ layer, cx, cy, clicks }) => {

        if (layer === "page") {
            layers.page.points.push([mainLeft + (cx + 0.5) * cell * mainWidth, (cy + 0.5) * cellPx, clicks]);
        } else if (layer === "top") {
            layers.page.points.push([(cx + 0.5) * cell * width, (cy + 0.5) * cellPx, clicks]);
        } else if (layer === "fixed") {
            layers.fixed.points.push([(cx + 0.5) * cell * width, (cy + 0.5) * cell * height, clicks]);
        } else if (layer === "modal" && layers.modal) {
            layers.modal.points.push([(cx + 0.5) * cell * layers.modal.width, (cy + 0.5) * cell * layers.modal.height, clicks]);
        }

    });

    const radius = Math.max(cellPx * 1.5, width * 0.036);

    const grids = Object.values(layers)
        .filter(layer => layer && layer.points.length > 0)
        .map(layer => ({ layer, ...heatDensity(layer, radius) }));

    const max = Math.max(0, ...grids.map(grid => grid.max));

    if (max > 0) {
        grids.forEach(grid => placeHeatLayer(doc, grid, max));
    }

    highlightHeatmapElement(heatmap.selected);

    renderHeatmapUnused();

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


function placeHeatLayer(doc, { layer, acc, w, h }, max) {

    const canvas = doc.createElement("canvas");

    canvas.className = "click-heat-layer";

    canvas.width = w;

    canvas.height = h;

    Object.assign(canvas.style, {
        position: layer.position,
        left: layer.left + "px",
        top: layer.top + "px",
        width: layer.width + "px",
        height: layer.height + "px"
    });

    const ctx = canvas.getContext("2d");

    const image = ctx.createImageData(w, h);

    const lut = heatLut();

    for (let j = 0; j < acc.length; j++) {

        if (!acc[j]) {
            continue;
        }

        const t = Math.sqrt(acc[j] / max);

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

    doc.body.appendChild(canvas);

}
