/* =========================================================
   BETLAB — ARBRE DU GROUPE (voir arbre-groupe.sql)

   Chaque groupe gagne de l'XP en jouant. À chaque palier,
   ses membres votent entre 2 cases : le choix est définitif.
   Étape 1 : l'arbre, les votes et l'affichage. Les effets
   des cases arriveront palier par palier.

   L'arbre s'allume groupe par groupe (bouton admin sur la page).
   Deux niveaux de texte : version courte pour les joueurs,
   tout le détail pour l'admin (maquette demo-arbre-groupe.html).
========================================================= */


/* Contenu des cases (même texte que la maquette). */
const TREE_NODES = {
    root: { e: "🏳️", n: "Départ", t: "Tous pareils",
        plus: "Le groupe vient d'être créé : il fonctionne exactement comme tous les autres groupes.",
        how: ["Dès que les membres jouent, le groupe gagne de l'XP (voir « Comment ça marche »).",
              "À 2 000 XP, environ une journée de paris, le premier vote s'ouvre : WTF ou Try hard.",
              "Ce premier choix donne le caractère du groupe pour toujours."] },

    w:  { e: "🤪", n: "WTF", t: "Bonus", titre: "Tribu WTF",
        plus: "1 boost gratuit par semaine pour chaque membre.",
        how: ["Chaque lundi, chaque membre reçoit 1 boost gratuit.",
              "Un boost s'utilise sur une mise (pari simple ou combiné), au moment de miser : si la mise gagne, le gain est augmenté de 20 %.",
              "Un boost pas utilisé dans la semaine disparaît le lundi suivant (on ne peut pas en stocker)."],
        ex: "Inès mise 100 € à cote 3 avec son boost : elle gagne 360 € au lieu de 300 €." },
    t:  { e: "🎯", n: "Try hard", t: "Bonus", titre: "Les Try hard",
        plus: "+50 % d'XP le lundi pour tous les membres.",
        how: ["Chaque lundi (heure de Paris), l'XP des mises placées ce jour-là compte 50 % de plus.",
              "Le bonus « pari gagné » compte aussi 50 % de plus quand le pari est validé un lundi.",
              "Le reste de la semaine, l'XP est normale."],
        ex: "Le lundi, une mise qui rapporte 20 XP en rapporte 30." },

    w1: { e: "🎰", n: "Roulette", t: "Pari spécial", titre: "Les Flambeurs",
        plus: "Une fois par jour, miser en mode roulette : la cote est tirée au hasard entre x1,2 et x8.",
        how: ["Au moment de miser, un bouton « 🎰 Roulette » apparaît à côté de la cote normale.",
              "Si tu l'utilises, la roulette tourne et tire ta cote entre x1,2 et x8. Tu la vois avant de valider, et tu peux encore annuler.",
              "C'est un choix, pas une obligation : sans roulette, tu mises avec la cote normale.",
              "1 roulette par membre et par jour."],
        ex: "Le choix est à cote 2. Lucas tente la roulette, tombe sur x6,5 et valide." },
    w2: { e: "🎭", n: "Pari mystère", t: "Pari spécial", titre: "Les Mystérieux",
        plus: "Chaque semaine, un pari du groupe devient « mystère » en secret : ses gagnants touchent leur gain x1,5.",
        how: ["Chaque lundi, un pari ouvert du groupe est tiré au sort, sans que personne ne sache lequel.",
              "Quand il est résolu, il se révèle avec un badge 🎭 et tous ses gagnants touchent 50 % de gain en plus.",
              "Personne ne peut savoir à l'avance lequel c'est : ça pousse à miser sur plein de paris."],
        ex: "Bertin avait gagné 200 € : le pari était mystère, il touche 300 €." },
    // Remplace l'ancien « Duel » (2026-10-19) : les duels sont maintenant ouverts à tous (duels.js).
    t1: { e: "🏅", n: "Tournoi", t: "Événement", titre: "Les Compétiteurs",
        plus: "Chaque semaine, un tournoi : le meilleur gagnant de la semaine remporte +1 000 € et +200 XP.",
        how: ["Du lundi au dimanche, un classement à part compte seulement les gains de la semaine dans le groupe.",
              "Dimanche à minuit, le 1er gagne +1 000 € et +200 XP, le 2e +500 € et +100 XP, le 3e +250 € et +50 XP.",
              "Le classement repart de zéro chaque lundi : tout le monde a sa chance."],
        ex: "Lucas gagne 3 200 € cette semaine, plus que tous les autres : il remporte le tournoi." },
    t2: { e: "🏆", n: "Rivalité", t: "Rivalité", titre: "Les Rivaux",
        plus: "Défier un autre groupe sur un pari commun et entrer au classement des groupes.",
        how: ["Le groupe propose un pari à un autre groupe : il apparaît chez les deux.",
              "Chaque membre mise comme d'habitude. Le groupe qui gagne le plus d'argent au total sur ce pari remporte la rivalité.",
              "Le groupe gagnant reçoit +2 000 XP de groupe.",
              "Le groupe apparaît dans un classement des groupes (nombre de rivalités gagnées), visible par tous."],
        ex: "Les Potes du Lundi contre Les Fous du BE sur « Qui arrive en retard demain ? »." },

    w1a: { e: "💥", n: "Double ou rien", t: "Bonus", titre: "Les Flambeurs fous",
        plus: "Après un pari gagné, rejouer tout le gain à pile ou face.",
        how: ["Quand un pari gagné est payé, un bouton « 💥 Double ou rien » s'affiche pendant 24 h.",
              "Pile : le gain est doublé. Face : le gain est perdu.",
              "C'est un choix : si tu n'appuies pas, tu gardes ton gain normalement.",
              "Une seule fois par pari gagné."],
        ex: "Max gagne 400 €, tente le double ou rien, tombe sur pile : 800 €." },
    w1b: { e: "🌪️", n: "Lundi fou", t: "Événement", titre: "Les Enfants du chaos",
        plus: "Chaque lundi, toutes les cotes du groupe sont augmentées de 20 %.",
        how: ["De lundi 0 h à lundi 23 h 59, toutes les mises sur les paris du groupe sont prises avec une cote +20 %.",
              "Le bonus s'ajoute après la limite de 10 : une cote de 10 devient 12 le lundi.",
              "Une bannière 🌪️ « Lundi fou » s'affiche sur la page Paris toute la journée."],
        ex: "Le lundi, un choix à cote 2,50 est pris à 3,00." },
    w2a: { e: "🃏", n: "À l'aveugle", t: "Pari spécial", titre: "Les Fantômes",
        plus: "Pouvoir créer des paris à l'aveugle : personne ne voit les mises des autres avant la clôture.",
        how: ["En créant un pari, une case « 🃏 À l'aveugle » est proposée (c'est un choix du créateur).",
              "Pendant que le pari est ouvert, on ne voit ni qui a misé, ni combien, ni sur quel choix.",
              "Tout se dévoile d'un coup à la clôture : personne ne peut copier les autres."],
        ex: "« Qui va gagner le baby-foot ? » à l'aveugle : surprise générale à la clôture." },
    w2b: { e: "🎡", n: "Roue surprise", t: "Événement", titre: "Les Chanceux",
        plus: "De temps en temps, une roue apparaît pour tout le groupe : chaque membre la tourne et gagne quelque chose.",
        how: ["Environ 2 fois par semaine, à un moment tiré au hasard, la roue apparaît pour tout le groupe.",
              "Elle reste 1 h : chaque membre peut la tourner une fois pendant ce temps.",
              "Toutes les cases font gagner : un boost, une mise gratuite de 100 € ou de l'XP (+30 à +100).",
              "Ceux qui ne sont pas connectés pendant l'heure la ratent : il faut être là au bon moment."],
        ex: "Mardi 18 h 12, la roue apparaît : Inès tombe sur une mise gratuite de 100 €." },
    // Remplace l'ancien « Duel à mort » (2026-10-19).
    t1a: { e: "👑", n: "Couronne", t: "Bonus", titre: "Les Rois",
        plus: "Le vainqueur du tournoi porte une couronne toute la semaine suivante, et ses gains sont augmentés de 10 %.",
        how: ["Le gagnant du tournoi de la semaine a une 👑 à côté de son pseudo, partout sur le site, pendant 7 jours.",
              "Pendant ces 7 jours, ses gains de paris sont augmentés de 10 %.",
              "S'il gagne encore le tournoi suivant, il garde sa couronne."],
        ex: "Bertin a gagné le tournoi : toute la semaine, il porte la 👑 et un gain de 500 € lui rapporte 550 €." },
    t1b: { e: "🛡️", n: "Assurance", t: "Bonus", titre: "Les Assureurs",
        plus: "Sur un pari perdu, 25 % de la mise est remboursé.",
        how: ["À chaque pari perdu (simple ou combiné), 25 % de la mise revient automatiquement sur le solde.",
              "Le remboursement arrive au moment où le pari est résolu, avec un petit message 🛡️."],
        ex: "Lucas perd un pari à 400 € : il récupère 100 €." },
    t2a: { e: "🏰", n: "Conquête", t: "Rivalité", titre: "Les Conquérants",
        plus: "Après une rivalité gagnée, notre blason s'affiche chez le groupe battu pendant une semaine, et +3 000 XP de groupe.",
        how: ["Chaque rivalité gagnée rapporte +3 000 XP de groupe (en plus des +2 000 de la Rivalité).",
              "Le blason du groupe s'affiche dans un coin de la page Paris du groupe battu pendant 7 jours, avec « Conquis par … ».",
              "Si on perd, il ne se passe rien chez nous."],
        ex: "On bat Les Fous du BE : notre 🏰 s'affiche chez eux jusqu'au lundi suivant." },
    t2b: { e: "📊", n: "Analystes", t: "Stats", titre: "Les Analystes",
        plus: "Statistiques avancées pour tout le groupe.",
        how: ["Une page « 📊 Stats » s'ajoute au groupe.",
              "Taux de réussite de chaque membre, ses cotes préférées, ses plus gros gains.",
              "Historique de l'évolution des cotes de chaque pari, et le meilleur parieur du mois."],
        ex: "On voit que Max gagne 70 % de ses paris à cote supérieure à 5…" }
};

const TREE_LEVELS = [
    ["w", "t"],
    ["w1", "w2", "t1", "t2"],
    ["w1a", "w1b", "w2a", "w2b", "t1a", "t1b", "t2a", "t2b"]
];

// Mêmes seuils que tree_threshold dans arbre-groupe.sql.
const TREE_SEUILS = [2000, 16000, 65000];


// État de l'arbre du groupe en cours (fonction group_tree_state).
let treeState = null;

let treeSelected = "root";

// 🤪 Boost WTF du joueur dans ce groupe (fonction my_boost).
let treeBoost = { wtf: false, available: false };

// L'admin lit tout le détail, et peut voir la version joueur.
let treeMode = "joueur";


function hasTreeAccess() {

    return Boolean(currentProfile?.is_admin) || Boolean(currentGroup?.tree_enabled);

}


const treeFmt = number => Number(number || 0).toLocaleString("fr-FR");

const treePath = () => treeState?.path || [];

const treeCurrent = () => treePath().length ? treePath()[treePath().length - 1] : "root";


function treeKids(id) {

    if (id === "root") {
        return ["w", "t"];
    }

    if (id.length === 1) {
        return [id + "1", id + "2"];
    }

    if (id.length === 2) {
        return [id + "a", id + "b"];
    }

    return [];

}


function treeLineage(id) {

    return id === "root"
        ? ["root"]
        : ["root", ...[1, 2, 3].filter(k => k <= id.length).map(k => id.slice(0, k))];

}


function treeNodeState(id) {

    const path = treePath();

    if (id === "root" || path.includes(id)) {
        return "chosen";
    }

    const parent = id.length === 1 ? "root" : id.slice(0, id.length - 1);

    if (!(parent === "root" || path.includes(parent))) {

        // Un ancêtre a été écarté : toute la branche est verrouillée.
        return treeLineage(id).slice(1, -1).some(a => !path.includes(a) && path.length >= a.length)
            ? "locked"
            : "future";

    }

    if (path.length >= id.length) {
        return "locked";
    }

    if (path.length === id.length - 1 && treeState?.voting) {
        return "open";
    }

    return "future";

}


/*
    Données.
*/

async function loadTree() {

    if (!currentGroup) {
        return;
    }

    const state = await supabaseClient.rpc("group_tree_state", { p_group: currentGroup.id });

    if (state.error) {

        console.error("Arbre du groupe indisponible (arbre-groupe.sql lancé ?)", state.error);

        return;

    }

    treeState = state.data;

    refreshTreeDot();

    renderGroupXpCard();

}


async function loadTreeBoost() {

    if (!currentGroup) {
        return;
    }

    const { data, error } = await supabaseClient.rpc("my_boost", { p_group: currentGroup.id });

    if (error) {

        console.error("Boost indisponible (arbre-palier1.sql lancé ?)", error);

        return;

    }

    treeBoost = data || { wtf: false, available: false };

    if (!treeBoost.available) {
        ticketBoost = false;
    }

}


// Ligne du boost dans le ticket de mise (version A de demo-palier1.html).
function ticketBoostHtml() {

    if (!treeBoost.wtf) {
        return "";
    }

    if (!treeBoost.available) {

        return `
            <div class="tboost used">
                <div class="tboost-txt">🚀 <b>Boost gratuit déjà utilisé</b><small>Le prochain arrive lundi.</small></div>
            </div>`;

    }

    return `
        <button type="button" class="tboost${ticketBoost ? " on" : ""}" data-ticket-boost>
            <span class="tboost-sw"></span>
            <span class="tboost-txt">🚀 <b>Utiliser mon boost gratuit</b> (+20 % de gain)<small>1 par semaine · revient lundi</small></span>
        </button>`;

}


// Un vote attend le joueur : la section XP du groupe (page Paris) le signale.
function refreshTreeDot() {

    const waiting = Boolean(
        treeState?.enabled &&
        treeState.voting &&
        !treeState.my_vote &&
        !currentProfile?.is_admin
    );

    document.getElementById("group-xp-card")?.classList.toggle("voting", waiting);

    return waiting;

}


async function openTreePage() {

    document.getElementById("tree-modal").classList.remove("hidden");

    const root = document.getElementById("tree-root");

    if (!treeState) {
        root.innerHTML = '<p class="tree-muted">Chargement de l\'arbre…</p>';
    }

    await loadTree();

    renderTreePage();

    // Les traits sont redessinés une fois la fenêtre à sa taille finale (fin du zoom d'ouverture).
    setTimeout(drawTreeLinks, 320);

}


/*
    Affichage.
*/

function treeNodeHtml(id) {

    const node = TREE_NODES[id];

    const state = treeNodeState(id);

    // Case au vote : le joueur (pas l'admin) vote en cliquant dessus.
    const mine = treeState?.my_vote;

    const vote = state !== "open" || currentProfile?.is_admin
        ? ""
        : !mine ? "vote-wait" : mine === id ? "vote-mine" : "vote-other";

    const tag = vote === "vote-wait"
        ? '<span class="tree-tag">🗳️ VOTE</span>'
        : vote === "vote-mine" ? '<span class="tree-tag mine">✓ TON VOTE</span>' : "";

    // Case à venir : cœur « j'aimerais bien » (arbre-coeurs.sql).
    const likers = state === "future" ? treeLikers(id) : [];

    const liked = likers.includes(currentProfile?.username);

    return `
        <button type="button" class="tree-node ${id === "root" ? "root" : ""} ${state} ${vote} ${liked ? "liked" : ""} ${treeSelected === id ? "sel" : ""}" data-node="${id}">
            ${tag}
            ${state === "future" ? treeHeartHtml(id, likers, liked) : ""}
            <span class="e">${node.e}</span>
            <span class="n">${node.n}</span>
            ${state === "open" ? `<span class="tree-node-plus">${node.plus}</span>${treeVotersHtml(id)}` : ""}
            ${state === "future" ? treeLikersHtml(likers) : ""}
        </button>`;

}


function treeHowHtml(node) {

    return `
        <p class="tree-how-t">Comment ça marche</p>
        <ul class="tree-how">${node.how.map(line => `<li>${line}</li>`).join("")}</ul>`;

}


// Explication détaillée : seulement en vue admin (les joueurs n'en ont pas).
function treeGuideHtml() {

    if (treeMode !== "admin") {
        return "";
    }

    return `
        <div class="tree-panel tree-guide">
            <h3>📖 Comment ça marche</h3>
            <ul>
                <li><b>L'XP du groupe</b> monte quand ses membres jouent sur les paris du groupe : l'XP de chaque mise (combinés compris), <b>+25</b> par mise ou combiné gagné, <b>+60</b> par pari résolu avec au moins 2 parieurs, et <b>+100</b> quand tout le groupe a misé sur un pari. Le chat ne rapporte rien, et les mises de l'admin ne comptent pas.</li>
                <li><b>3 paliers</b> : 2 000 XP (≈ une journée), 16 000 XP (≈ une semaine), 65 000 XP (≈ un mois), au rythme d'un groupe très actif comme Les Fous du BE.</li>
                <li><b>À chaque palier, un vote</b> entre 2 cases. Il faut la majorité des membres actifs (absents depuis plus de 7 jours non comptés, admin non compté). Pas de limite de temps, et on peut changer son vote tant que rien n'est adopté.</li>
                <li><b>Le choix est définitif</b> : l'autre case et tout ce qui vient après sont verrouillés pour toujours dans ce groupe. Pour les vivre, il faut rejoindre un autre groupe.</li>
                <li><b>Que des bonus</b> : chaque case ajoute quelque chose au groupe, aucune ne retire quoi que ce soit.</li>
                <li>À la fin, il existe <b>8 identités</b> possibles. Clique sur une case de l'arbre pour lire tout le détail.</li>
            </ul>
        </div>`;

}


function treeAdminHtml() {

    if (!currentProfile?.is_admin) {
        return "";
    }

    const parts = treeState.parts || {};

    return `
        <div class="tree-tabs">
            <button type="button" class="tree-tab${treeMode === "joueur" ? " active" : ""}" data-tree-mode="joueur">👤 Vue joueur <small>version courte</small></button>
            <button type="button" class="tree-tab${treeMode === "admin" ? " active" : ""}" data-tree-mode="admin">🛠️ Vue admin <small>tout le détail</small></button>
        </div>

        <div class="tree-panel tree-admin">
            <h3>🛠️ Admin</h3>
            <p class="tree-muted">
                ${treeState.enabled
                    ? `Arbre <b>allumé</b> dans ce groupe depuis le ${new Date(treeState.started_at).toLocaleDateString("fr-FR")}.`
                    : treeState.started_at
                        ? "Arbre <b>éteint</b> dans ce groupe (l'XP et les cases sont gardées)."
                        : "Arbre <b>pas encore allumé</b> dans ce groupe. L'XP comptera à partir de l'allumage."}
            </p>
            ${treeState.started_at ? `
                <p class="tree-muted">
                    XP : mises ${treeFmt(parts.mises)} · mises gagnées ${treeFmt(parts.gagnes)} ·
                    paris résolus ${treeFmt(parts.resolus)} · tout le groupe a misé ${treeFmt(parts.tous)}
                </p>` : ""}
            <button type="button" class="tree-small" id="tree-toggle">
                ${treeState.enabled ? "Éteindre l'arbre de ce groupe" : "Allumer l'arbre de ce groupe"}
            </button>
        </div>`;

}


// Barre d'XP du groupe (page Paris) : XP gagnée dans le palier en cours.
function treeXpInfo() {

    const level = treePath().length;

    const prev = level ? TREE_SEUILS[level - 1] : 0;

    const next = TREE_SEUILS[level];

    const xp = treeState.xp || 0;

    return {
        xp,
        level,
        prev,
        next,
        percent: level >= 3 ? 100 : Math.max(0, Math.min(100, (xp - prev) / (next - prev) * 100))
    };

}


// XP du groupe en bas de la section « Groupe » (classement, page Paris) ; un clic ouvre l'arbre.
function renderGroupXpCard() {

    const card = document.getElementById("group-xp-card");

    if (!card) {
        return;
    }

    if (!treeState || !hasTreeAccess()) {

        card.classList.add("hidden");

        return;

    }

    // Fine ligne : niveau et XP gagnée dans le palier en cours, bouton « Voter » au palier.
    const { xp, level, prev, next, percent } = treeXpInfo();

    const progress = level >= 3
        ? "arbre terminé"
        : `${treeFmt(Math.min(xp, next) - prev)} / ${treeFmt(next - prev)} XP`;

    refreshTreeDot();

    card.innerHTML = `
        <div class="group-xp-row">
            <span><b>🌳 Niv. ${level}</b> · ${progress}</span>
            ${treeState.voting
                ? '<button type="button" class="group-xp-vote">Voter</button>'
                : '<button type="button" class="group-xp-tree">🌳 Arbre</button>'}
        </div>
        <div class="group-xp-bar"><div style="width: ${percent}%"></div></div>`;

    card.classList.remove("hidden");

    if (!card.dataset.ready) {

        card.dataset.ready = "1";

        // Seuls les boutons « Arbre » et « Voter » ouvrent l'arbre (pas la ligne entière).
        card.addEventListener("click", event => {

            if (event.target.closest(".group-xp-tree, .group-xp-vote")) {
                openTreePage();
            }

        });

    }

}


/*
    Vote dans l'arbre (maquette demo-vote-dans-arbre.html) : les 2 cases au vote
    brillent, un clic ouvre une bulle « Voter », les pastilles des votants
    s'affichent sur chaque case et la liste des membres sous l'arbre.
*/

const TREE_AVATAR_COLORS = ["#c86bff", "#ff6bd5", "#4fc3ff", "#ff9f43", "#63d69f", "#ffd36b", "#6c63ff", "#ff6b6b"];

function treeAvatarColor(name) {

    let hash = 0;

    [...name].forEach(letter => {
        hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
    });

    return TREE_AVATAR_COLORS[hash % TREE_AVATAR_COLORS.length];

}


// Pastilles des membres qui ont voté pour cette case (voir arbre-vote-pastilles.sql).
function treeVotersHtml(id) {

    const voters = (treeState.members || []).filter(member => member.vote === id);

    return `
        <span class="tree-voters">
            ${voters.map(member => `
                <span class="tree-av${member.username === currentProfile?.username ? " me" : ""}"
                      style="background: ${treeAvatarColor(member.username)}"
                      title="${escapeHtml(member.username)}">${escapeHtml(member.username.charAt(0).toUpperCase())}</span>`).join("")}
        </span>`;

}


// Qui a voté : sous l'arbre, pendant un vote.
function treeMembersHtml() {

    if (!treeState.enabled || !treeState.voting) {
        return "";
    }

    const members = treeState.members || [];

    const active = members.filter(member => member.active).length;

    const voted = members.filter(member => member.voted).length;

    return `
        <div class="tree-members">
            <span class="tree-members-lab">Ont voté :</span>
            ${members.map(member => `
                <span class="tree-mb ${!member.active ? "off" : member.voted ? "done" : ""}">
                    ${escapeHtml(member.username)}${!member.active ? " · absent" : member.voted ? " ✓" : ""}
                </span>`).join("")}
        </div>
        ${treeMode === "admin" ? `
            <p class="tree-votemsg">
                ${voted} / ${active} membres actifs ont voté · il faut <b>${treeState.need}</b> voix pour adopter.
                L'admin ne vote pas. Les membres absents depuis plus de 7 jours ne sont pas comptés.
            </p>` : ""}`;

}


/*
    Cœurs sur les cases à venir (maquette demo-coeurs-arbre.html) :
    « j'aimerais bien débloquer ça ». Ce n'est pas un vote : autant de
    cœurs qu'on veut, et le groupe voit qui a aimé quoi.
*/

function treeLikers(id) {

    return treeState?.likes?.[id] || [];

}


function treeHeartHtml(id, likers, liked) {

    return `
        <span class="tree-heart${liked ? " on" : ""}" data-like="${id}" title="${liked ? "Je n'aime plus" : "J'aime"}">
            ${liked ? "❤️" : "🤍"}${likers.length ? `<span>${likers.length}</span>` : ""}
        </span>`;

}


function treeLikersHtml(likers) {

    if (!likers.length) {
        return "";
    }

    return `
        <span class="tree-likers">
            ${likers.map(name => `
                <span class="tree-av${name === currentProfile?.username ? " me" : ""}"
                      style="background: ${treeAvatarColor(name)}"
                      title="${escapeHtml(name)}">${escapeHtml(name.charAt(0).toUpperCase())}</span>`).join("")}
        </span>`;

}


function treeLikeButtonHtml(id) {

    const likers = treeLikers(id);

    const liked = likers.includes(currentProfile?.username);

    return `
        <button type="button" class="tree-like-btn${liked ? " on" : ""}" data-like="${id}">
            ${liked ? "❤️ J'aime" : "🤍 J'aime"}
        </button>`;

}


// Met ou retire mon cœur : affiché tout de suite, puis confirmé par la base.
async function likeTreeNode(id, from) {

    const me = currentProfile?.username;

    if (!treeState || !me) {
        return;
    }

    const likers = treeLikers(id);

    const adding = !likers.includes(me);

    if (adding) {
        treeFlyHearts(from);
    }

    treeState.likes = {
        ...(treeState.likes || {}),
        [id]: adding ? [...likers, me] : likers.filter(name => name !== me)
    };

    renderTreePage();

    if (adding) {
        document.querySelector(`#tree-root [data-like="${id}"]`)?.classList.add("pop");
    }

    const { data, error } = await supabaseClient.rpc("group_tree_like", {
        p_group: currentGroup.id,
        p_node: id
    });

    if (error) {

        alertToast(escapeHtml(error.message), { type: "error" });

        await loadTree();

    } else {

        treeState = data;

    }

    renderTreePage();

}


function treeFlyHearts(from) {

    const rect = from.getBoundingClientRect();

    for (let i = 0; i < 6; i++) {

        const heart = document.createElement("div");

        heart.className = "tree-flying-heart";

        heart.textContent = "❤️";

        heart.style.left = rect.left + rect.width / 2 - 8 + "px";

        heart.style.top = rect.top + "px";

        document.body.appendChild(heart);

        heart.animate(
            [
                { transform: "translate(0, 0) scale(.6)", opacity: 1 },
                { transform: `translate(${(Math.random() - .5) * 70}px, -${50 + Math.random() * 40}px) scale(1.1)`, opacity: 0 }
            ],
            { duration: 700 + Math.random() * 300, easing: "ease-out" }
        ).onfinish = () => heart.remove();

    }

}


// Fenêtre de l'arbre : croix, clic à côté ou Échap la ferment.
function closeTreeModal() {

    hideTreeTip();

    closeTreeVotePop();

    document.getElementById("tree-modal")?.classList.add("hidden");

}


document.addEventListener("DOMContentLoaded", () => {

    const modal = document.getElementById("tree-modal");

    if (!modal) {
        return;
    }

    document.getElementById("close-tree-modal").addEventListener("click", closeTreeModal);

    modal.addEventListener("click", event => {

        if (event.target === modal) {
            closeTreeModal();
        }

    });

    document.addEventListener("keydown", event => {

        if (event.key === "Escape" && !modal.classList.contains("hidden")) {
            closeTreeModal();
        }

    });

});


// Bulle « Voter » au clic sur une case au vote.
function showTreeVotePop(button) {

    closeTreeVotePop();

    hideTreeTip();

    const id = button.dataset.node;

    const node = TREE_NODES[id];

    const pop = document.createElement("div");

    pop.className = "tree-vote-pop";

    pop.innerHTML = `
        <span class="e">${node.e}</span>
        <h4>${node.n}</h4>
        <div class="tree-plus">${node.plus}</div>
        <button type="button" class="tree-vote-go">🗳️ ${treeState.my_vote ? "Changer pour" : "Voter"} ${node.n}</button>`;

    document.body.appendChild(pop);

    // Sous la case, ou au-dessus s'il n'y a pas la place ; toujours dans l'écran.
    const rect = button.getBoundingClientRect();

    const margin = 10;

    pop.style.left = Math.min(
        Math.max(margin, rect.left + rect.width / 2 - pop.offsetWidth / 2),
        window.innerWidth - pop.offsetWidth - margin
    ) + "px";

    pop.style.top = (rect.bottom + 10 + pop.offsetHeight > window.innerHeight - margin
        ? Math.max(margin, rect.top - pop.offsetHeight - 10)
        : rect.bottom + 10) + "px";

    pop.querySelector(".tree-vote-go").addEventListener("click", () => {

        closeTreeVotePop();

        voteTree(id);

    });

}


function closeTreeVotePop() {

    document.querySelectorAll(".tree-vote-pop").forEach(pop => pop.remove());

}


// Case adoptée : elle s'allume avec des confettis, une fois par joueur et par palier.
function celebrateTreeAdoption() {

    const path = treePath();

    const key = "betlab-tree-seen-" + currentGroup.id;

    let seen;

    try {
        seen = Number(localStorage.getItem(key) || 0);
        localStorage.setItem(key, String(path.length));
    } catch (error) {
        return;
    }

    if (path.length <= seen) {
        return;
    }

    const id = path[path.length - 1];

    const tree = document.getElementById("tree-tree");

    const win = tree?.querySelector(`[data-node="${id}"]`);

    if (!win) {
        return;
    }

    // L'autre case du même vote se grise.
    const sibling = id.slice(0, -1) + { w: "t", t: "w", 1: "2", 2: "1", a: "b", b: "a" }[id.slice(-1)];

    win.classList.add("tree-win");

    tree.querySelector(`[data-node="${sibling}"]`)?.classList.add("tree-lose");

    const rect = win.getBoundingClientRect();

    const colors = ["#63d69f", "#ffd36b", "#ff6bd5", "#4fc3ff", "#c86bff", "#ff9f43"];

    for (let i = 0; i < 46; i++) {

        const piece = document.createElement("div");

        piece.className = "tree-confetti";

        piece.style.background = colors[i % colors.length];

        piece.style.left = rect.left + rect.width / 2 + "px";

        piece.style.top = rect.top + rect.height / 2 + "px";

        document.body.appendChild(piece);

        const angle = Math.random() * Math.PI * 2;

        const distance = 80 + Math.random() * 160;

        piece.animate(
            [
                { transform: "translate(0, 0) rotate(0)", opacity: 1 },
                { transform: `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance + 120}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }
            ],
            { duration: 1100 + Math.random() * 600, easing: "cubic-bezier(.2, .7, .4, 1)" }
        ).onfinish = () => piece.remove();

    }

}


function treeTreeHtml() {

    let html = `<svg></svg><p class="tree-lvl">Création</p><div class="tree-row r0">${treeNodeHtml("root")}</div>`;

    TREE_LEVELS.forEach((level, index) => {

        html += `
            <p class="tree-lvl">Palier ${index + 1}</p>
            <div class="tree-row r${index + 1}">${level.map(treeNodeHtml).join("")}</div>`;

    });

    return `
        <div class="tree-panel">
            <div class="tree-tree" id="tree-tree">${html}<span class="tree-or hidden">OU</span></div>
            ${treeMembersHtml()}
        </div>`;

}


function treeDetailHtml(id) {

    const node = TREE_NODES[id];

    const state = treeNodeState(id);

    return `
            <span class="e">${node.e}</span>
            <h4>${node.n}</h4>
            ${node.titre && treeMode === "admin" ? `<p class="tree-muted">Titre du groupe : <b>${node.titre}</b></p>` : ""}
            <div class="tree-plus">${node.plus}</div>
            ${state === "future" ? treeLikeButtonHtml(id) : ""}
            ${treeMode === "admin" ? treeHowHtml(node) : ""}`;

}


// Détail d'une case : bulle au survol de la case (au toucher sur téléphone).
function showTreeTip(button) {

    const tip = document.getElementById("tree-node-tip");

    if (!tip) {
        return;
    }

    clearTimeout(treeTipTimer);

    treeTipNode = button.dataset.node;

    tip.innerHTML = treeDetailHtml(button.dataset.node);

    // Déjà ouverte : elle glisse vers la nouvelle case ; sinon elle apparaît sur place.
    const already = tip.classList.contains("show");

    // Sous la case, ou au-dessus s'il n'y a pas la place ; toujours dans l'écran.
    const rect = button.getBoundingClientRect();

    const margin = 10;

    const left = Math.min(
        Math.max(margin, rect.left + rect.width / 2 - tip.offsetWidth / 2),
        window.innerWidth - tip.offsetWidth - margin
    );

    const below = rect.bottom + 8;

    const top = below + tip.offsetHeight > window.innerHeight - margin
        ? Math.max(margin, rect.top - tip.offsetHeight - 8)
        : below;

    if (!already) {
        tip.style.transition = "none";
    }

    tip.style.left = left + "px";

    tip.style.top = top + "px";

    tip.classList.toggle("above", top < rect.top);

    if (!already) {

        tip.getBoundingClientRect();

        tip.style.transition = "";

    }

    tip.classList.add("show");

}


function hideTreeTip() {

    clearTimeout(treeTipTimer);

    treeTipNode = null;

    document.getElementById("tree-node-tip")?.classList.remove("show");

}


// La souris quitte la case : la bulle attend un peu (le temps d'y entrer pour cliquer le cœur).
function hideTreeTipSoon() {

    clearTimeout(treeTipTimer);

    treeTipTimer = setTimeout(hideTreeTip, 180);

}


let treeTipNode = null;

let treeTipTimer = null;


document.addEventListener("DOMContentLoaded", () => {

    const tip = document.getElementById("tree-node-tip");

    tip?.addEventListener("mouseenter", () => clearTimeout(treeTipTimer));

    tip?.addEventListener("mouseleave", hideTreeTipSoon);

});


window.addEventListener("scroll", () => {

    hideTreeTip();

    closeTreeVotePop();

}, true);

// Sur téléphone (pas de survol) : un toucher ailleurs referme la bulle.
document.addEventListener("click", event => {

    // Cœur sur une case ou dans la bulle.
    const heart = event.target.closest("[data-like]");

    if (heart) {

        likeTreeNode(heart.dataset.like, heart);

        return;

    }

    if (!event.target.closest(".tree-node, #tree-node-tip")) {
        hideTreeTip();
    }

    if (!event.target.closest(".tree-node, .tree-vote-pop")) {
        closeTreeVotePop();
    }

});


function renderTreePage() {

    const root = document.getElementById("tree-root");

    if (!root || !treeState) {
        return;
    }

    if (!treeState.enabled && !currentProfile?.is_admin) {

        root.innerHTML = '<div class="tree-panel"><p class="tree-muted">L\'arbre n\'est pas encore ouvert dans ce groupe.</p></div>';

        return;

    }

    root.innerHTML = `
        ${treeAdminHtml()}
        ${treeGuideHtml()}
        <div class="tree-col">
            ${treeTreeHtml()}
        </div>`;

    root.querySelectorAll("[data-node]").forEach(button => {

        button.addEventListener("click", event => {

            if (event.target.closest("[data-like]")) {
                return;
            }

            // Case au vote (pas encore la mienne) : bulle « Voter ».
            if (button.matches(".vote-wait, .vote-other")) {

                showTreeVotePop(button);

                return;

            }

            treeSelected = button.dataset.node;

            root.querySelectorAll(".tree-node.sel").forEach(node => node.classList.remove("sel"));

            button.classList.add("sel");

            showTreeTip(button);

        });

        button.addEventListener("mouseenter", () => {

            // Les cases au vote montrent déjà leur bonus : pas de bulle au survol.
            if (!button.matches(".vote-wait, .vote-other, .vote-mine")) {
                showTreeTip(button);
            }

        });

        button.addEventListener("mouseleave", hideTreeTipSoon);

    });

    root.querySelectorAll("[data-tree-mode]").forEach(button => {

        button.addEventListener("click", () => {

            treeMode = button.dataset.treeMode;

            renderTreePage();

        });

    });

    document.getElementById("tree-toggle")?.addEventListener("click", toggleTree);

    requestAnimationFrame(() => {

        drawTreeLinks();

        celebrateTreeAdoption();

        const open = treeTipNode && root.querySelector(`[data-node="${treeTipNode}"]`);

        if (open) {
            showTreeTip(open);
        }

    });

}


// Traits entre les cases (dessinés une fois les cases placées).
function drawTreeLinks() {

    const tree = document.getElementById("tree-tree");

    const svg = tree?.querySelector("svg");

    if (!svg) {
        return;
    }

    const box = tree.getBoundingClientRect();

    if (!box.width) {
        return;
    }

    let lines = "";

    tree.querySelectorAll("[data-node]").forEach(element => {

        treeKids(element.dataset.node).forEach(kid => {

            const child = tree.querySelector(`[data-node="${kid}"]`);

            if (!child) {
                return;
            }

            const a = element.getBoundingClientRect();

            const b = child.getBoundingClientRect();

            const x1 = a.left + a.width / 2 - box.left;

            const y1 = a.bottom - box.top;

            const x2 = b.left + b.width / 2 - box.left;

            const y2 = b.top - box.top;

            const middle = (y1 + y2) / 2;

            const state = treeNodeState(kid);

            const color = state === "chosen" ? "#63d69f" : state === "open" ? "#ff9f43" : "#343a4d";

            lines += `<path d="M${x1},${y1} C${x1},${middle} ${x2},${middle} ${x2},${y2}"
                stroke="${color}" stroke-width="${state === "chosen" ? 3 : 2}" fill="none"
                opacity="${state === "locked" ? 0.25 : 1}" ${state === "future" ? 'stroke-dasharray="4 4"' : ""}/>`;

        });

    });

    // « OU » entre les 2 cases au vote (tant que le joueur n'a pas voté).
    const or = tree.querySelector(".tree-or");

    const pair = tree.querySelectorAll(".tree-node.vote-wait");

    if (or) {

        or.classList.toggle("hidden", pair.length !== 2);

        if (pair.length === 2) {

            const a = pair[0].getBoundingClientRect();

            const b = pair[1].getBoundingClientRect();

            or.style.left = (a.right + b.left) / 2 - box.left + "px";

            or.style.top = (a.top + a.bottom) / 2 - box.top + "px";

        }

    }

    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);

    svg.innerHTML = lines;

}


/*
    Actions.
*/

async function voteTree(node) {

    const before = treePath().length;

    const { data, error } = await supabaseClient.rpc("group_tree_vote", {
        p_group: currentGroup.id,
        p_node: node
    });

    if (error) {

        alertToast(escapeHtml(error.message), { type: "error" });

        await loadTree();

        renderTreePage();

        return;

    }

    treeState = data;

    refreshTreeDot();

    if (treePath().length > before) {

        const adopted = TREE_NODES[treePath()[treePath().length - 1]];

        treeSelected = treePath()[treePath().length - 1];

        alertToast(`🎉 <strong>${adopted.n}</strong> adopté ! L'autre branche est verrouillée pour toujours.`, { type: "joined" });

    } else {

        alertToast(`${TREE_NODES[node].e} Vote enregistré pour <strong>${TREE_NODES[node].n}</strong> !`, { type: "joined" });

    }

    renderTreePage();

}


async function toggleTree() {

    const { error } = await supabaseClient.rpc("admin_set_tree_enabled", {
        p_group: currentGroup.id,
        p_on: !treeState.enabled
    });

    if (error) {

        alertToast(escapeHtml(error.message), { type: "error" });

        return;

    }

    currentGroup.tree_enabled = !treeState.enabled;

    const mine = myGroups.find(group => group.id === currentGroup.id);

    if (mine) {
        mine.tree_enabled = currentGroup.tree_enabled;
    }

    await loadTree();

    renderTreePage();

    renderTreeAdminCard();

    renderGroupSwitcher();

}


/*
    Onglet admin « Message » : carte pour allumer l'arbre groupe par groupe
    (l'admin est membre de tous les groupes, voir admin_join_all_groups).
*/

function renderTreeAdminCard() {

    const card = document.getElementById("tree-admin-card");

    if (!card || !currentProfile?.is_admin) {
        return;
    }

    card.innerHTML = `
        <h3>🌳 Arbre des groupes</h3>

        <p class="resolve-info">
            Allume l'arbre dans un groupe pour que ses membres le voient (menu du groupe → 🌳 Arbre du groupe).
            L'XP du groupe compte à partir du premier allumage. L'éteindre garde l'XP et les cases choisies.
        </p>

        <div class="tree-admin-list">
            ${myGroups.map(group => `
                <div class="tree-admin-row">
                    <span>${escapeHtml(group.name)}</span>
                    <button
                        type="button"
                        class="tree-admin-toggle${group.tree_enabled ? " on" : ""}"
                        data-tree-group="${group.id}"
                    >
                        ${group.tree_enabled ? "✅ Allumé · éteindre" : "Allumer l'arbre"}
                    </button>
                </div>
            `).join("")}
        </div>
    `;

    card.querySelectorAll("[data-tree-group]").forEach(button => {

        button.addEventListener("click", async () => {

            const group = myGroups.find(item => item.id === button.dataset.treeGroup);

            button.disabled = true;

            const { error } = await supabaseClient.rpc("admin_set_tree_enabled", {
                p_group: group.id,
                p_on: !group.tree_enabled
            });

            if (error) {

                alertToast(escapeHtml(error.message), { type: "error" });

                button.disabled = false;

                return;

            }

            group.tree_enabled = !group.tree_enabled;

            // Groupe en cours : la page de l'arbre et le menu suivent.
            if (currentGroup && group.id === currentGroup.id) {

                currentGroup.tree_enabled = group.tree_enabled;

                await loadTree();

                renderTreePage();

                renderGroupSwitcher();

            }

            renderTreeAdminCard();

        });

    });

}


/*
    Mise en place (appelée par initAppPage, une fois le groupe connu).
*/

async function setupTree() {

    if (!currentGroup) {
        return;
    }

    treeMode = currentProfile?.is_admin ? "admin" : "joueur";

    renderTreeAdminCard();

    window.addEventListener("resize", () => {

        if (!document.getElementById("tree-modal")?.classList.contains("hidden")) {
            drawTreeLinks();
        }

    });

    // Un vote en attente se signale dès l'arrivée sur le site,
    // et le ticket sait si le joueur a un boost WTF.
    // L'admin voit l'arbre même éteint (pour l'allumer).
    if (hasTreeAccess()) {

        await Promise.all([loadTree(), loadTreeBoost()]);

        if (typeof renderTicket === "function") {
            renderTicket();
        }

    } else {

        // Arbre éteint dans ce groupe : pas de barre d'XP du groupe.
        document.getElementById("group-xp-card")?.classList.add("hidden");

    }

}
