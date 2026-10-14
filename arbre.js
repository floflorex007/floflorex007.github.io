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
    t1: { e: "⚔️", n: "Duel", t: "Pari spécial", titre: "Les Duellistes",
        plus: "Défier un membre en 1 contre 1 sur un pari : le gagnant prend les deux mises.",
        how: ["Sur un pari ouvert du groupe, tu choisis un membre et une somme.",
              "Il a 24 h pour accepter. S'il accepte, il mise la même somme sur un autre choix que toi.",
              "À la résolution, celui qui a le bon choix prend les deux mises. S'il refuse ou ne répond pas, rien n'est perdu.",
              "La mise d'un duel va jusqu'à 5 000 €, comme un pari normal."],
        ex: "Toi contre Lucas, 300 € chacun : tu gagnes, tu récupères 600 €." },
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
    t1a: { e: "🩸", n: "Duel à mort", t: "Bonus", titre: "Les Gladiateurs",
        plus: "Mise max des duels multipliée par 3 : jusqu'à 15 000 €.",
        how: ["Les duels marchent comme avant, mais on peut miser jusqu'à 15 000 € au lieu de 5 000 €.",
              "Le gagnant d'un duel gagne aussi +20 XP."],
        ex: "Toi contre Bertin, 8 000 € chacun : le gagnant repart avec 16 000 €." },
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

const TREE_LVL_NAMES = ["Palier 1 · le caractère", "Palier 2 · le bonus", "Palier 3 · la spécialité"];

const TREE_LVL_DELAIS = ["≈ une journée", "≈ une semaine", "≈ un mois"];

// Cases dont l'effet est déjà codé (arbre-palier1.sql) ; les autres arrivent.
const TREE_ACTIVE = ["w", "t"];


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


function treeBranchClass(path) {

    return !path.length ? "" : path[0] === "w" ? "wtf" : "th";

}


function treeTitleOf(path) {

    return path.length ? TREE_NODES[path[path.length - 1]].titre : "Groupe sans voie";

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


// Pastille sur le bouton du groupe : un vote attend le joueur.
function refreshTreeDot() {

    const waiting = Boolean(
        treeState?.enabled &&
        treeState.voting &&
        !treeState.my_vote &&
        !currentProfile?.is_admin
    );

    document.getElementById("group-tree-dot")?.classList.toggle("hidden", !waiting);

    return waiting;

}


async function openTreePage() {

    showPage("tree-page");

    const root = document.getElementById("tree-root");

    if (!treeState) {
        root.innerHTML = '<p class="tree-muted">Chargement de l\'arbre…</p>';
    }

    await loadTree();

    renderTreePage();

}


/*
    Affichage.
*/

function treeNodeHtml(id) {

    const node = TREE_NODES[id];

    const state = treeNodeState(id);

    return `
        <button type="button" class="tree-node ${id === "root" ? "root" : ""} ${state} ${treeSelected === id ? "sel" : ""}" data-node="${id}">
            <span class="e">${node.e}</span>
            <span class="n">${node.n}</span>
            <span class="t">${node.t}</span>
        </button>`;

}


function treeHowHtml(node) {

    return `
        <p class="tree-how-t">Comment ça marche</p>
        <ul class="tree-how">${node.how.map(line => `<li>${line}</li>`).join("")}</ul>
        ${node.ex ? `<p class="tree-ex">💡 <b>Exemple :</b> ${node.ex}</p>` : ""}`;

}


function treeGuideHtml() {

    if (treeMode !== "admin") {

        return `
            <div class="tree-panel tree-guide">
                <h3>📖 Comment ça marche</h3>
                <ul>
                    <li>En jouant, le groupe gagne de l'<b>XP</b>.</li>
                    <li>À chaque palier, on <b>vote</b> entre 2 bonus. Le choix est <b>définitif</b>.</li>
                    <li>Clique sur une case pour voir ce qu'elle débloque.</li>
                </ul>
            </div>`;

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


function treeHeadHtml() {

    const path = treePath();

    const level = path.length;

    const prev = level ? TREE_SEUILS[level - 1] : 0;

    const next = TREE_SEUILS[level];

    const xp = treeState.xp || 0;

    const percent = level >= 3 ? 100 : Math.max(0, Math.min(100, (xp - prev) / (next - prev) * 100));

    const full = level >= 3 || treeState.voting;

    return `
        <div class="tree-panel">
            <div class="tree-ghead">
                <div class="tree-blason ${treeBranchClass(path)}">${TREE_NODES[treeCurrent()].e}</div>
                <div>
                    <div class="tree-gname">${escapeHtml(currentGroup.name)}</div>
                    <div class="tree-gtitle">${treeTitleOf(path)}</div>
                </div>
            </div>
            <div class="tree-xpbar${full ? " full" : ""}"><i style="width: ${percent}%"></i></div>
            <div class="tree-xplegend">
                <span>${treeFmt(xp)} XP · niveau ${level}</span>
                <span>${level >= 3 ? "Arbre terminé 🏁" : treeState.voting ? "Palier atteint, au vote !" : `prochain palier : ${treeFmt(next)} XP`}</span>
            </div>
        </div>`;

}


function treeVoteHtml() {

    if (!treeState.enabled || !treeState.voting) {
        return "";
    }

    const level = treePath().length;

    const votes = treeState.votes || {};

    const isAdmin = Boolean(currentProfile?.is_admin);

    const members = treeState.members || [];

    const active = members.filter(member => member.active).length;

    const voted = members.filter(member => member.voted).length;

    return `
        <div class="tree-panel tree-vote">
            <h3>🗳️ ${TREE_LVL_NAMES[level]} : à vous de choisir !</h3>
            <div class="tree-opts">
                ${treeKids(treeCurrent()).map(id => {
                    const node = TREE_NODES[id];
                    return `
                        <button type="button" class="tree-opt${treeState.my_vote === id ? " mine" : ""}" data-vote="${id}" ${isAdmin ? "disabled" : ""}>
                            <span class="e">${node.e}</span>
                            <h4>${node.n}</h4>
                            <div class="tree-plus">➕ ${node.plus}</div>
                            ${treeMode === "admin" ? `<ul class="tree-how">${node.how.map(line => `<li>${line}</li>`).join("")}</ul>` : ""}
                            <div class="tree-count"><b>${votes[id] || 0}</b> vote(s)${treeState.my_vote === id ? " · ✓ ton vote" : ""}</div>
                        </button>`;
                }).join("")}
            </div>
            <div class="tree-members">
                ${members.map(member => `
                    <span class="tree-mb ${!member.active ? "off" : member.voted ? "done" : ""}">
                        ${escapeHtml(member.username)}${!member.active ? " · absent" : member.voted ? " ✓" : ""}
                    </span>`).join("")}
            </div>
            <p class="tree-votemsg">
                ${isAdmin
                    ? "L'admin ne vote pas : ce sont les membres qui choisissent."
                    : `${voted} / ${active} membres actifs ont voté · il faut <b>${treeState.need}</b> voix pour adopter.`}
            </p>
            <p class="tree-muted">
                ${treeMode === "admin"
                    ? "Il faut la majorité des membres actifs. Les membres absents depuis plus de 7 jours ne sont pas comptés. Pas de limite de temps : chacun peut changer son vote tant que rien n'est adopté."
                    : "La majorité l'emporte. Tu peux changer ton vote tant que rien n'est adopté."}
            </p>
        </div>`;

}


function treeTreeHtml() {

    let html = `<svg></svg><p class="tree-lvl">Création</p><div class="tree-row r0">${treeNodeHtml("root")}</div>`;

    TREE_LEVELS.forEach((level, index) => {

        html += `
            <p class="tree-lvl">${TREE_LVL_NAMES[index]} · ${treeFmt(TREE_SEUILS[index])} XP <span>(${TREE_LVL_DELAIS[index]})</span></p>
            <div class="tree-row r${index + 1}">${level.map(treeNodeHtml).join("")}</div>`;

    });

    return `<div class="tree-panel"><div class="tree-tree" id="tree-tree">${html}</div></div>`;

}


function treeDetailHtml() {

    const node = TREE_NODES[treeSelected];

    const state = treeNodeState(treeSelected);

    const label = {
        chosen: "✅ Débloqué",
        open: "🗳️ Au vote maintenant",
        locked: "🔒 Verrouillé (l'autre branche a gagné)",
        future: "⏳ Plus tard"
    }[state];

    return `
        <div class="tree-panel tree-detail">
            <span class="e">${node.e}</span>
            <h4>${node.n}</h4>
            <span class="tree-pill">${node.t}</span>${treeSelected !== "root" ? `<span class="tree-pill">${label}</span>` : ""}
            ${node.titre && treeMode === "admin" ? `<p class="tree-muted">Titre du groupe : <b>${node.titre}</b></p>` : ""}
            <div class="tree-plus">➕ ${node.plus}</div>
            ${treeMode === "admin" ? treeHowHtml(node) : node.ex ? `<p class="tree-ex">💡 ${node.ex}</p>` : ""}
        </div>`;

}


function treeEffectsHtml() {

    const path = treePath();

    return `
        <div class="tree-panel">
            <h3>⚙️ Bonus débloqués</h3>
            <ul class="tree-actifs">
                ${path.length
                    ? path.map(id => `
                        <li>
                            ${TREE_NODES[id].e} <b>${TREE_NODES[id].n}</b> : ${TREE_NODES[id].plus}
                            ${TREE_ACTIVE.includes(id)
                                ? '<span class="tree-on">✅ Actif</span>'
                                : '<span class="tree-soon">⏳ Bientôt actif</span>'}
                        </li>`).join("")
                    : '<li class="tree-muted">Aucun pour l\'instant : le groupe est comme tous les autres.</li>'}
            </ul>
        </div>`;

}


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
        <div class="tree-layout">
            <div class="tree-col">
                ${treeHeadHtml()}
                ${treeVoteHtml()}
                ${treeTreeHtml()}
            </div>
            <div class="tree-col">
                ${treeDetailHtml()}
                ${treeEffectsHtml()}
            </div>
        </div>`;

    root.querySelectorAll("[data-node]").forEach(button => {

        button.addEventListener("click", () => {

            treeSelected = button.dataset.node;

            renderTreePage();

        });

    });

    root.querySelectorAll("[data-tree-mode]").forEach(button => {

        button.addEventListener("click", () => {

            treeMode = button.dataset.treeMode;

            renderTreePage();

        });

    });

    root.querySelectorAll("[data-vote]").forEach(button => {

        button.addEventListener("click", () => voteTree(button.dataset.vote));

    });

    document.getElementById("tree-toggle")?.addEventListener("click", toggleTree);

    requestAnimationFrame(drawTreeLinks);

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

        if (!document.getElementById("tree-page")?.classList.contains("hidden")) {
            drawTreeLinks();
        }

    });

    // Un vote en attente se signale dès l'arrivée sur le site,
    // et le ticket sait si le joueur a un boost WTF.
    if (currentGroup.tree_enabled) {

        await Promise.all([loadTree(), loadTreeBoost()]);

        if (typeof renderTicket === "function") {
            renderTicket();
        }

    }

}
