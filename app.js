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


// app.html?apercu-clics : le site affiché dans le cadre de la page Heat map (admin).
// Pas de tuto, pas de fenêtres, aucun clic compté (voir heatmap.js).
const CLICK_PREVIEW =
    new URLSearchParams(window.location.search).has("apercu-clics");



/* =========================================================
   2. VARIABLES GLOBALES
========================================================= */

let currentUser = null;

let currentProfile = null;

let currentBet = null;

let currentChoice = null;

let currentResolveBet = null;

let currentAnnouncementId = null;

let currentGroup = null;

let myGroups = [];



/* =========================================================
   3. UTILITAIRES
========================================================= */

function formatMoney(value) {

    return Number(value).toLocaleString(
        "fr-FR",
        {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }
    ) + " €";

}



/*
    Tous les montants en euros (soldes, mises, gains, « en jeu ») sont
    affichés sans virgule. Seul l'affichage est arrondi : les calculs
    et la base gardent les décimales. Les cotes restent à 2 décimales.
*/

function formatBalance(value) {

    return Math.round(Number(value)).toLocaleString("fr-FR") + " €";

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



/*
    Échéance affichée sur les cartes : le temps restant.
    Les jours (« 3 j »), les heures le jour même (« 5 h »),
    les minutes la dernière heure (« 42 min »),
    les secondes la dernière minute (« 37 s »).
    Mis à jour chaque seconde par refreshCardDeadlines().
*/

function formatCardDeadline(value) {

    if (!value) {

        return null;

    }

    const date =
        new Date(value);

    const ms =
        date - Date.now();

    if (ms <= 0) {

        return "Terminé";

    }

    if (date.toDateString() !== new Date().toDateString()) {

        // Jours de calendrier : demain = 1 j, même à moins de 24 h.
        const today = new Date();

        today.setHours(0, 0, 0, 0);

        const day = new Date(date);

        day.setHours(0, 0, 0, 0);

        return Math.round((day - today) / 86400000) + " j";

    }

    if (ms >= 3600000) {

        return Math.floor(ms / 3600000) + " h";

    }

    if (ms >= 60000) {

        return Math.floor(ms / 60000) + " min";

    }

    return Math.ceil(ms / 1000) + " s";

}


function refreshCardDeadlines() {

    document.querySelectorAll(".bet-deadline[data-deadline]").forEach(element => {

        // Carte rouge : « ⏳ mm:ss » avant la fin des mises (updateCountdowns, animations.js).
        if (element.closest(".bet-card-urgent")) {

            return;

        }

        const label = formatCardDeadline(element.dataset.deadline);

        if (label && element.textContent.trim() !== label) {

            element.textContent = label;

        }

    });

}



/*
    Chaque fenêtre (.modal) s'ouvre toujours en haut : on remet son
    défilement à zéro dès qu'elle perd la classe « hidden ».
*/

function setupModalScrollReset() {

    const observer = new MutationObserver(mutations => {

        mutations.forEach(({ target, oldValue }) => {

            const opened =
                (oldValue || "").split(" ").includes("hidden") &&
                !target.classList.contains("hidden");

            if (!opened) {
                return;
            }

            target.scrollTop = 0;

            target.querySelectorAll(".modal-content, .modal-content *").forEach(element => {

                if (element.scrollTop) {
                    element.scrollTop = 0;
                }

            });

        });

    });

    document.querySelectorAll(".modal").forEach(modal => {

        observer.observe(modal, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });

    });

}

document.addEventListener("DOMContentLoaded", setupModalScrollReset);


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


// Pseudo sans espaces, sans accents, en minuscules : « Hélène » et « Helene »
// sont le même compte (même transformation que pseudo_cle dans pseudo-accents.sql).
function usernameKey(username) {

    return username
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, "");

}


function usernameToEmail(username) {

    return usernameKey(username) + "@betlab.test";

}


// Supabase Auth exige 6 caractères minimum (réglage impossible à baisser) :
// un mot de passe plus court reçoit en coulisse un complément fixe.
const PASSWORD_AUTH_MIN = 6;

function passwordForAuth(password) {

    return password.length < PASSWORD_AUTH_MIN
        ? password + "#betlab"
        : password;

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

        password: passwordForAuth(password),

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


    let {
        data,
        error
    } = await supabaseClient.auth.signInWithPassword({

        email: email,

        password: passwordForAuth(password)

    });


    // Mot de passe court posé tel quel par l'admin (admin_set_password) : sans le complément.
    if (error && password.length < PASSWORD_AUTH_MIN) {

        ({ data, error } = await supabaseClient.auth.signInWithPassword({

            email: email,

            password: password

        }));

    }


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


    // Admin : il entre (caché) dans tous les groupes, y compris les nouveaux.
    if (currentProfile.is_admin) {

        const { error: joinError } = await supabaseClient.rpc("admin_join_all_groups");

        if (joinError) {
            console.error("Admin : groupes indisponibles (admin-comptes.sql lancé ?)", joinError);
        }

    }


    // Le solde affiché est celui du groupe en cours.
    await loadMyGroups();

    if (currentGroup) {

        currentProfile.balance = currentGroup.balance;

        currentProfile.points = currentGroup.points;

        currentProfile.cosmetics = currentGroup.cosmetics;

        currentProfile.gold_frame_until = currentGroup.gold_frame_until;

        currentProfile.name_color_until = currentGroup.name_color_until;

        await loadGroupStyles();

    }


    updateBalance();

    if (typeof refreshParrotClick === "function") {

        refreshParrotClick();

    }

    // On attend l'argent en jeu : la taille du perroquet est ainsi connue
    // avant que la page ne s'affiche.
    await refreshInPlay();

}



/* =========================================================
   GROUPES PRIVÉS
   Chaque groupe a ses paris, son classement et un solde
   propre à chaque membre (group_members.balance).
   Le groupe en cours est retenu dans le navigateur.
========================================================= */

const GROUP_STORAGE_KEY = "betlab-group";


function readSavedGroupId() {

    try {
        return localStorage.getItem(GROUP_STORAGE_KEY);
    } catch (error) {
        return null;
    }

}


function saveGroupId(groupId) {

    try {
        localStorage.setItem(GROUP_STORAGE_KEY, groupId);
    } catch (error) {
        // Stockage indisponible (navigation privée) : on garde le premier groupe.
    }

}


async function loadMyGroups() {

    const { data, error } = await supabaseClient
        .from("group_members")
        .select("balance, points, cosmetics, gold_frame_until, name_color_until, is_manager, joined_at, groups ( id, name, code, created_by, tree_enabled )")
        .eq("user_id", currentUser.id)
        .order("joined_at", { ascending: true });

    if (error) {
        throw error;
    }

    myGroups = (data || [])
        .filter(member => member.groups)
        .map(member => ({
            ...member.groups,
            balance: member.balance,
            points: member.points,
            cosmetics: member.cosmetics || {},
            gold_frame_until: member.gold_frame_until,
            name_color_until: member.name_color_until,
            isCreator: member.groups.created_by === currentUser.id,
            // L'admin a les pouvoirs dans tous les groupes (voir admin-comptes.sql).
            isManager: member.is_manager || member.groups.created_by === currentUser.id || Boolean(currentProfile?.is_admin)
        }));

    const savedId = readSavedGroupId();

    currentGroup =
        myGroups.find(group => group.id === savedId) ||
        myGroups[0] ||
        null;

    if (currentGroup) {
        saveGroupId(currentGroup.id);
    }

    renderGroupSwitcher();

}


/*
    Cosmétiques des membres du groupe en cours, par pseudo :
    les pseudos affichés partout (paris, classement, fil)
    prennent les effets achetés dans ce groupe.
*/

let groupStyles = new Map();

async function loadGroupStyles() {

    const { data, error } = await supabaseClient
        .from("group_members")
        .select("cosmetics, gold_frame_until, name_color_until, profiles ( username, is_admin, streak_days, last_checkin, flame_name_off, diamond_items )")
        .eq("group_id", currentGroup.id);

    if (error) {
        console.error(error);
        return;
    }

    groupStyles = new Map(
        (data || [])
            .filter(member => member.profiles)
            .map(member => [
                member.profiles.username,
                {
                    cosmetics: member.cosmetics || {},
                    gold_frame_until: member.gold_frame_until,
                    name_color_until: member.name_color_until,
                    // Série (pseudo enflammé à 15 jours).
                    streak_days: member.profiles.streak_days,
                    last_checkin: member.profiles.last_checkin,
                    flame_name_off: member.profiles.flame_name_off,
                    // L'admin a une série illimitée : pseudo enflammé d'office.
                    is_admin: member.profiles.is_admin,
                    // Objets exclusifs achetés en diamants (communs à tous les groupes).
                    diamond_items: member.profiles.diamond_items || {}
                }
            ])
    );

}


function withGroupStyle(profile) {

    if (!profile || !currentGroup) {
        return profile;
    }

    // Hors du groupe (ancien membre) : aucun effet.
    const style = groupStyles.get(profile.username) || {
        cosmetics: {},
        gold_frame_until: null,
        name_color_until: null
    };

    return { ...profile, ...style };

}


/*
    Changer de groupe : on recharge la page pour repartir
    proprement (paris, classement, solde, fil en direct).
*/

function switchGroup(groupId) {

    saveGroupId(groupId);

    window.location.reload();

}


/* ----- Sélecteur de groupe (barre du haut) ----- */

function renderGroupSwitcher() {

    const nameElement = document.getElementById("group-switcher-name");

    const menu = document.getElementById("group-menu");

    if (!nameElement || !menu) {
        return;
    }

    nameElement.textContent = currentGroup ? currentGroup.name : "Aucun groupe";

    menu.innerHTML = `
        ${myGroups.map(group => `
            <button
                type="button"
                class="group-menu-item${currentGroup && group.id === currentGroup.id ? " active" : ""}"
                data-group-id="${group.id}"
            >
                <span>${escapeHtml(group.name)}</span>
                <small>${formatBalance(group.balance)}</small>
            </button>
        `).join("")}

        <div class="group-menu-separator"></div>

        <button type="button" class="group-menu-item" data-group-action="manage">
            ${currentGroup && currentGroup.isManager ? "⚙️ Gérer le groupe" : "ℹ️ Infos du groupe"}
        </button>

        <button type="button" class="group-menu-item" data-group-action="join">
            ＋ Rejoindre ou créer un groupe
        </button>
    `;

    menu.querySelectorAll("[data-group-id]").forEach(button => {

        button.addEventListener("click", () => {

            if (currentGroup && button.dataset.groupId === currentGroup.id) {
                menu.classList.add("hidden");
                return;
            }

            switchGroup(button.dataset.groupId);

        });

    });

    menu.querySelector('[data-group-action="manage"]').addEventListener("click", () => {
        menu.classList.add("hidden");
        openGroupModal();
    });

    menu.querySelector('[data-group-action="join"]').addEventListener("click", () => {
        menu.classList.add("hidden");
        showWelcome(true);
    });

}


function setupGroupSwitcher() {

    const button = document.getElementById("group-switcher-button");

    const menu = document.getElementById("group-menu");

    if (!button || !menu) {
        return;
    }

    button.addEventListener("click", event => {
        event.stopPropagation();
        menu.classList.toggle("hidden");
    });

    document.addEventListener("click", event => {
        if (!event.target.closest(".group-switcher")) {
            menu.classList.add("hidden");
        }
    });

}


/* ----- Page de bienvenue (aucun groupe, ou rejoindre/créer) ----- */

function showWelcome(canGoBack) {

    document.body.classList.add("no-group");

    document.getElementById("welcome-page").classList.remove("hidden");

    document.getElementById("welcome-name").textContent =
        currentProfile?.username || "";

    document.getElementById("welcome-back").classList.toggle("hidden", !canGoBack);

    document.getElementById("welcome-intro").textContent = canGoBack
        ? "Rejoins un autre groupe avec son code, ou crée le tien."
        : "Tu n'es encore dans aucun groupe. Rejoins celui de tes amis avec leur code, ou crée le tien.";

    showWelcomeStep("choice");

    // Sans groupe : une demande déjà envoyée reprend son écran d'attente.
    if (!canGoBack) {

        showJoinRequestScreen();

    }

}


function hideWelcome() {

    document.body.classList.remove("no-group");

    document.getElementById("welcome-page").classList.add("hidden");

}


function showWelcomeStep(step) {

    document
        .querySelectorAll("#welcome-page [data-welcome-step]")
        .forEach(element => {
            element.classList.toggle("hidden", element.dataset.welcomeStep !== step);
        });

    const message = document.getElementById("welcome-join-message");

    message.textContent = "";

    message.className = "welcome-message";

    // L'écran d'attente a son propre texte.
    document.getElementById("welcome-intro").classList.toggle("hidden", step === "pending");

    if (step !== "pending") {

        stopJoinRequestWatch();

    }

    if (step === "join") {

        document.querySelectorAll("#welcome-code input").forEach(input => {
            input.value = "";
        });

        setTimeout(() => document.querySelector("#welcome-code input")?.focus(), 50);

    }

    if (step === "create") {

        document.getElementById("welcome-group-name").value = "";

        document.getElementById("welcome-create-error").textContent = "";

        document.getElementById("welcome-created").classList.add("hidden");

        document.getElementById("welcome-create-button").classList.remove("hidden");

    }

}


function readWelcomeCode() {

    return [...document.querySelectorAll("#welcome-code input")]
        .map(input => input.value)
        .join("");

}


/*
    Dès que le code est complet : on affiche le nom du groupe trouvé,
    mais on ne rejoint qu'en appuyant sur le bouton « Rejoindre ».
*/

function setWelcomeMessage(kind, icon, title, subtitle) {

    const message = document.getElementById("welcome-join-message");

    message.className = "welcome-message " + kind;

    message.innerHTML = `
        <span class="welcome-message-icon">${icon}</span>
        <span class="welcome-message-text">
            <b>${title}</b>
            ${subtitle ? `<small>${subtitle}</small>` : ""}
        </span>
    `;

}


async function previewWelcomeCode() {

    const box = document.getElementById("welcome-code");

    const message = document.getElementById("welcome-join-message");

    const code = readWelcomeCode();

    box.classList.remove("error", "success");

    message.className = "welcome-message";

    message.textContent = "";

    if (code.length < 6) {

        return;

    }

    const { data, error } =
        await supabaseClient.rpc("preview_group", { p_code: code });

    // Le code a changé pendant la recherche : on ignore ce résultat.
    if (readWelcomeCode() !== code) {

        return;

    }

    if (error || !data || data.length === 0) {

        void box.offsetWidth;

        box.classList.add("error");

        setWelcomeMessage(
            "error",
            "❌",
            "Code inconnu",
            "Vérifie le code auprès de tes amis."
        );

        return;

    }

    const group = data[0];

    box.classList.add("success");

    setWelcomeMessage(
        "success",
        "👥",
        escapeHtml(group.name),
        `${group.members} membre${group.members > 1 ? "s" : ""} · Appuie sur « Rejoindre » pour entrer`
    );

}


let welcomeJoining = false;

async function submitWelcomeCode() {

    if (welcomeJoining) {

        return;

    }

    const box = document.getElementById("welcome-code");

    const code = readWelcomeCode();

    if (code.length < 6) {

        box.classList.remove("success");

        setWelcomeMessage(
            "error",
            "⚠️",
            "Le code fait 6 caractères",
            ""
        );

        return;

    }

    // La carte « groupe trouvé » reste telle quelle pendant la demande
    // (on ne touche ni à ses classes ni à son texte).
    welcomeJoining = true;

    const { data, error } =
        await supabaseClient.rpc("join_group", { p_code: code });

    if (error) {

        welcomeJoining = false;

        box.classList.remove("success");

        void box.offsetWidth;

        box.classList.add("error");

        setWelcomeMessage(
            "error",
            "❌",
            escapeHtml(error.message || "Impossible de rejoindre ce groupe."),
            ""
        );

        return;

    }

    // Le code envoie une demande : écran d'attente jusqu'à la validation.
    welcomeJoining = false;

    await showJoinRequestScreen(data.id);

}


async function createGroupFromWelcome() {

    const errorElement = document.getElementById("welcome-create-error");

    const name = document.getElementById("welcome-group-name").value.trim();

    errorElement.textContent = "";

    if (name.length < 3) {

        errorElement.textContent = "Donne un nom d'au moins 3 caractères.";

        return;

    }

    const { data, error } =
        await supabaseClient.rpc("create_group", { p_name: name });

    if (error) {

        errorElement.textContent = error.message || "Impossible de créer le groupe.";

        return;

    }

    document.getElementById("welcome-create-button").classList.add("hidden");

    document.getElementById("welcome-new-code").textContent = data.code;

    document.getElementById("welcome-created").classList.remove("hidden");

    document.getElementById("welcome-enter-group").onclick = () => switchGroup(data.id);

}


async function copyText(text, button) {

    try {

        await navigator.clipboard.writeText(text);

        const label = button.textContent;

        button.textContent = "Copié ✓";

        setTimeout(() => {
            button.textContent = label;
        }, 1500);

    } catch (error) {

        window.prompt("Copie ce code :", text);

    }

}


function setupWelcome() {

    const page = document.getElementById("welcome-page");

    if (!page) {
        return;
    }

    page.querySelectorAll("[data-welcome-go]").forEach(button => {
        button.addEventListener("click", () => showWelcomeStep(button.dataset.welcomeGo));
    });


    // Six cases pour le code : lettres et chiffres, passage automatique.
    const box = document.getElementById("welcome-code");

    box.innerHTML = "";

    for (let i = 0; i < 6; i++) {

        const input = document.createElement("input");

        input.maxLength = 1;

        input.autocomplete = "off";

        input.addEventListener("input", () => {

            input.value = input.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 1);

            box.classList.remove("error");

            if (input.value && input.nextElementSibling) {
                input.nextElementSibling.focus();
            }

            previewWelcomeCode();

        });

        input.addEventListener("keydown", event => {

            if (event.key === "Backspace" && !input.value && input.previousElementSibling) {
                input.previousElementSibling.focus();
            }

            if (event.key === "Enter") {
                submitWelcomeCode();
            }

        });

        input.addEventListener("paste", event => {

            event.preventDefault();

            const text = (event.clipboardData.getData("text") || "")
                .replace(/[^a-z0-9]/gi, "")
                .toUpperCase()
                .slice(0, 6);

            [...box.children].forEach((element, index) => {
                element.value = text[index] || "";
            });

            // On ne rejoint qu'en appuyant sur le bouton « Rejoindre ».
            previewWelcomeCode();

            if (text.length === 6) {
                document.getElementById("welcome-join-button").focus();
            }

        });

        box.appendChild(input);

    }


    document.getElementById("welcome-join-button").addEventListener("click", submitWelcomeCode);

    document.getElementById("welcome-create-button").addEventListener("click", createGroupFromWelcome);

    document.getElementById("welcome-group-name").addEventListener("keydown", event => {
        if (event.key === "Enter") {
            createGroupFromWelcome();
        }
    });

    document.getElementById("welcome-copy-code").addEventListener("click", event => {
        copyText(document.getElementById("welcome-new-code").textContent, event.currentTarget);
    });

    document.getElementById("welcome-back").addEventListener("click", hideWelcome);

    document.getElementById("welcome-logout").addEventListener("click", logout);

}


/* ----- Paris en direct (Supabase Realtime) ----- */

let betsChannel = null;

let betsRefreshTimer = null;

function scheduleBetsRefresh() {

    // Regroupe les événements rapprochés (un pari = pari + choix + mises).
    clearTimeout(betsRefreshTimer);

    betsRefreshTimer = setTimeout(() => {

        displayBets({ quiet: true });

    }, 600);

}

function setupBetsRealtime() {

    if (!currentGroup || betsChannel) {

        return;

    }

    betsChannel = supabaseClient
        .channel("group-" + currentGroup.id)
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "bets", filter: "group_id=eq." + currentGroup.id },
            scheduleBetsRefresh
        )
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "bet_choices" },
            scheduleBetsRefresh
        )
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "stakes" },
            scheduleBetsRefresh
        )
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "combo_legs" },
            scheduleBetsRefresh
        )
        .subscribe();

}


/* ----- Quitter un groupe ----- */

let groupHeirs = [];

function setupGroupLeave() {

    const button = document.getElementById("group-leave-button");

    if (!button) {
        return;
    }

    const panel = document.getElementById("group-leave-panel");

    button.addEventListener("click", () => {

        const group = currentGroup;

        const ownerBox = document.getElementById("group-leave-owner");

        const select = document.getElementById("group-leave-owner-select");

        let text = `Tu vas quitter « ${group.name} ». Tu perdras ton solde, tes points et ta boutique dans ce groupe.`;

        ownerBox.classList.add("hidden");

        if (group.isCreator) {

            if (groupHeirs.length === 0) {

                text += " Tu es le dernier membre : le groupe sera supprimé avec tous ses paris.";

            } else {

                text += " Tu es le créateur : choisis qui reprend le groupe.";

                select.innerHTML = groupHeirs.map(
                    member => `<option value="${member.user_id}">${escapeHtml(member.profiles.username)}</option>`
                ).join("");

                ownerBox.classList.remove("hidden");

            }

        }

        document.getElementById("group-leave-text").textContent = text;

        document.getElementById("group-modal-error").textContent = "";

        panel.classList.remove("hidden");

        button.classList.add("hidden");

    });

    document.getElementById("group-leave-cancel").addEventListener("click", () => {

        panel.classList.add("hidden");

        button.classList.remove("hidden");

    });

    document.getElementById("group-leave-confirm").addEventListener("click", async () => {

        const errorElement = document.getElementById("group-modal-error");

        const ownerBox = document.getElementById("group-leave-owner");

        const newOwner = ownerBox.classList.contains("hidden")
            ? null
            : document.getElementById("group-leave-owner-select").value;

        errorElement.textContent = "";

        const { error } = await supabaseClient.rpc(
            "leave_group",
            { p_group: currentGroup.id, p_new_owner: newOwner }
        );

        if (error) {

            errorElement.textContent = error.message || "Impossible de quitter le groupe.";

            return;

        }

        // On repart d'un autre groupe, ou de la page d'accueil s'il n'en reste aucun.
        window.location.reload();

    });

}


/* ----- Retrait d'un groupe : pop-up au retour ou en direct ----- */

let removalPopupOpen = false;

async function checkGroupRemovals() {

    const modal = document.getElementById("removed-modal");

    if (!modal || removalPopupOpen || !currentUser) {
        return;
    }

    const { data, error } = await supabaseClient
        .from("group_removals")
        .select("id, group_id, group_name")
        .eq("user_id", currentUser.id)
        .is("seen_at", null)
        .order("removed_at", { ascending: true });

    if (error || !data || data.length === 0) {
        return;
    }

    removalPopupOpen = true;

    const names = data.map(row => `« ${escapeHtml(row.group_name)} »`);

    document.getElementById("removed-message").innerHTML = data.length === 1
        ? `Tu viens d'être retiré(e) du groupe <strong>${names[0]}</strong>.`
        : `Tu viens d'être retiré(e) des groupes <strong>${names.join(", ")}</strong>.`;

    // Le groupe en cours est-il concerné ?
    const currentRemoved = !!currentGroup &&
        data.some(row => row.group_id === currentGroup.id);

    document.getElementById("removed-hint").textContent = currentRemoved
        ? "Tu vas être redirigé(e) vers un autre groupe ou vers l'accueil."
        : "";

    modal.classList.remove("hidden");

    document.getElementById("removed-ok").onclick = async () => {

        await supabaseClient.rpc("ack_group_removals");

        modal.classList.add("hidden");

        removalPopupOpen = false;

        if (currentRemoved) {

            window.location.reload();

            return;

        }

        await loadMyGroups();

    };

}


/* ----- Gestion du groupe (fenêtre) ----- */

async function openGroupModal() {

    if (!currentGroup) {
        return;
    }

    document.getElementById("group-modal-error").textContent = "";

    document.getElementById("group-modal").classList.remove("hidden");

    await renderGroupModal();

}


async function renderGroupModal() {

    const group = currentGroup;

    const manager = group.isManager;


    document.getElementById("group-modal-title").textContent = group.name;

    // Demandes d'adhésion en attente (section au-dessus des membres).
    renderJoinRequestsSection();

    refreshJoinRequests();

    document.getElementById("group-manage-section").classList.toggle("hidden", !manager);

    document.getElementById("group-member-note").classList.toggle("hidden", manager);

    // Le code est visible par tous ; seuls le créateur et les ⭐ peuvent le changer.
    document.getElementById("group-code").textContent = group.code;

    document.getElementById("group-regenerate-code").classList.toggle("hidden", !manager);

    if (manager) {

        document.getElementById("group-rename-input").value = group.name;

    }


    const list = document.getElementById("group-members-list");

    list.innerHTML = "<p class=\"group-member-note\">Chargement...</p>";

    const { data, error } = await supabaseClient
        .from("group_members")
        .select("user_id, balance, is_manager, profiles ( username, is_admin, gold_frame_until, name_color_until, cosmetics )")
        .eq("group_id", group.id)
        .order("balance", { ascending: false });

    if (error) {

        list.innerHTML = "<p class=\"error-message\">Impossible de charger les membres.</p>";

        return;

    }

    // L'admin n'apparaît pas dans la liste (sauf pour lui-même).
    const members = data.filter(
        member => !member.profiles?.is_admin || member.user_id === currentUser.id
    );

    // Ceux qui peuvent reprendre le groupe si le créateur le quitte.
    groupHeirs = members.filter(member => member.user_id !== currentUser.id);

    // À chaque réaffichage, on referme le panneau « Quitter ».
    document.getElementById("group-leave-panel").classList.add("hidden");

    document.getElementById("group-leave-button").classList.remove("hidden");

    document.getElementById("group-members-count").textContent =
        `${members.length} membre${members.length > 1 ? "s" : ""}`;

    list.innerHTML = members.map(member => {

        const isCreator = member.user_id === group.created_by;

        const isMe = member.user_id === currentUser.id;

        const badge = isCreator
            ? `<span class="group-badge">👑 Créateur</span>`
            : member.is_manager
            ? `<span class="group-badge">⭐ Pouvoirs</span>`
            : "";

        const actions = manager && !isCreator && !isMe
            ? `
                <div class="group-member-actions">
                    <button type="button" class="${member.is_manager ? "power-on" : "power-off"}" data-member-power="${member.user_id}" data-on="${member.is_manager ? "0" : "1"}">
                        ${member.is_manager ? "⭐ Retirer les pouvoirs" : "Donner les pouvoirs"}
                    </button>
                    <button type="button" class="danger" data-member-remove="${member.user_id}">
                        Retirer
                    </button>
                </div>
            `
            : "";

        return `
            <div class="group-member-row">
                <div class="group-member-main">
                    <span>${styledName(member.profiles)}${isMe ? " <small>(toi)</small>" : ""}</span>
                    ${badge}
                </div>
                <span class="group-member-balance">${member.profiles?.is_admin ? "∞" : formatBalance(member.balance)}</span>
                ${actions}
            </div>
        `;

    }).join("");


    list.querySelectorAll("[data-member-power]").forEach(button => {

        button.addEventListener("click", () => groupAction(
            "set_group_manager",
            { p_group: group.id, p_user: button.dataset.memberPower, p_on: button.dataset.on === "1" }
        ));

    });

    list.querySelectorAll("[data-member-remove]").forEach(button => {

        button.addEventListener("click", () => {

            if (!window.confirm("Retirer ce membre du groupe ? Il perdra son solde dans ce groupe.")) {
                return;
            }

            groupAction(
                "remove_group_member",
                { p_group: group.id, p_user: button.dataset.memberRemove }
            );

        });

    });

}


async function groupAction(rpcName, params) {

    const errorElement = document.getElementById("group-modal-error");

    errorElement.textContent = "";

    const { data, error } = await supabaseClient.rpc(rpcName, params);

    if (error) {

        errorElement.textContent = error.message || "Action impossible.";

        return null;

    }

    await loadMyGroups();

    await renderGroupModal();

    return data;

}


/* =========================================================
   DEMANDES D'ADHÉSION (voir demandes-adhesion.sql)
   Le code d'un groupe envoie une demande ; le créateur, ceux qui
   ont les pouvoirs et l'admin l'acceptent ou la refusent dans la
   fenêtre du groupe (pastille rouge sur le bouton 👥).
   Maquette : demo-validation-membres.html (proposition A).
========================================================= */

const JOIN_REQUEST_POLL_MS = 20000;

// Demandes en attente du groupe affiché (pour ceux qui peuvent répondre).
let groupJoinRequests = [];

// Demande suivie sur l'écran d'attente : { id, name, members }.
let watchedJoinRequest = null;

let joinRequestState = null;

let joinRequestTimer = null;


/* ----- Côté nouveau joueur : écran d'attente ----- */

function startJoinRequestWatch() {

    if (joinRequestTimer) {
        return;
    }

    joinRequestTimer = setInterval(() => {

        if (watchedJoinRequest) {
            showJoinRequestScreen(watchedJoinRequest.id);
        }

    }, JOIN_REQUEST_POLL_MS);

}

function stopJoinRequestWatch() {

    clearInterval(joinRequestTimer);

    joinRequestTimer = null;

}

/*
    Affiche l'état de ma demande (en attente, acceptée, refusée).
    Sans groupId : ma demande la plus récente, s'il y en a une.
*/

async function showJoinRequestScreen(groupId = null) {

    const { data, error } = await supabaseClient.rpc("my_join_requests");

    if (error) {

        console.error("Demandes d'adhésion indisponibles (demandes-adhesion.sql lancé ?)", error);

        return;

    }

    const requests = data || [];

    const request = groupId
        ? requests.find(item => item.group_id === groupId)
        : requests[0];

    if (request) {

        watchedJoinRequest = {
            id: request.group_id,
            name: request.group_name,
            members: request.members
        };

    }

    if (!watchedJoinRequest) {
        return;
    }

    let state = request?.status;

    // Plus de demande : acceptée si je suis membre, sinon annulée ailleurs.
    if (!request) {

        const { data: member } = await supabaseClient
            .from("group_members")
            .select("group_id")
            .eq("group_id", watchedJoinRequest.id)
            .eq("user_id", currentUser.id)
            .maybeSingle();

        if (!member) {

            watchedJoinRequest = null;

            joinRequestState = null;

            showWelcomeStep("choice");

            return;

        }

        state = "accepted";

    }

    // On ne redessine que si l'état change (les points d'attente continuent).
    const panelHidden =
        document.querySelector('[data-welcome-step="pending"]').classList.contains("hidden");

    if (state !== joinRequestState || panelHidden) {

        joinRequestState = state;

        renderJoinRequest(state);

        showWelcomeStep("pending");

    }

    if (state === "pending") {

        startJoinRequestWatch();

    } else {

        stopJoinRequestWatch();

    }

}

function renderJoinRequest(state) {

    const box = document.getElementById("welcome-request");

    const group = watchedJoinRequest;

    const groupBox = `
        <div class="welcome-request-group">
            👥 ${escapeHtml(group.name)}
            <small>${group.members} membre${group.members > 1 ? "s" : ""}</small>
        </div>
    `;

    if (state === "accepted") {

        box.innerHTML = `
            <h3>Bienvenue dans le groupe ! 🎉</h3>
            <p>Ta demande a été acceptée. Tu reçois <b>1 000 €</b> pour commencer.</p>
            ${groupBox}
            <span class="welcome-request-state accepted">✅ Demande acceptée</span>
            <button type="button" class="welcome-green-button" data-request-enter>Entrer →</button>
        `;

    } else if (state === "refused") {

        box.innerHTML = `
            <h3>Demande refusée</h3>
            <p>Le créateur de <b>${escapeHtml(group.name)}</b> n'a pas accepté ta demande. Vérifie avec lui, ou rejoins un autre groupe.</p>
            <span class="welcome-request-state refused">❌ Demande refusée</span>
            <button type="button" class="welcome-green-button" data-request-retry>🔑 Entrer un autre code</button>
        `;

    } else {

        box.innerHTML = `
            <h3>Demande envoyée 📨</h3>
            <p>Le créateur du groupe doit accepter ta demande. Cette page s'ouvrira toute seule dès que c'est bon.</p>
            ${groupBox}
            <div class="welcome-request-dots"><span></span><span></span><span></span></div>
            <span class="welcome-request-state pending">⏳ En attente de validation</span>
            <button type="button" class="welcome-link" data-request-cancel>Annuler la demande</button>
        `;

    }

    box.querySelector("[data-request-enter]")?.addEventListener("click", () => switchGroup(group.id));

    // Refusée ou annulée : la demande est effacée, on revient au code / au choix.
    const clear = async step => {

        await supabaseClient.rpc("cancel_join_request", { p_group: group.id });

        watchedJoinRequest = null;

        joinRequestState = null;

        showWelcomeStep(step);

    };

    box.querySelector("[data-request-retry]")?.addEventListener("click", () => clear("join"));

    box.querySelector("[data-request-cancel]")?.addEventListener("click", () => clear("choice"));

}


/* ----- Côté créateur : pastille, notification, fenêtre du groupe ----- */

function canAnswerJoinRequests() {

    return Boolean(
        currentGroup &&
        (currentGroup.isManager || currentProfile?.is_admin)
    );

}

async function refreshJoinRequests() {

    const dot = document.getElementById("group-requests-dot");

    if (!canAnswerJoinRequests()) {

        groupJoinRequests = [];

        dot?.classList.add("hidden");

        return groupJoinRequests;

    }

    const { data, error } = await supabaseClient.rpc("group_join_requests_for", {
        p_group: currentGroup.id
    });

    if (error) {

        console.error("Demandes d'adhésion indisponibles (demandes-adhesion.sql lancé ?)", error);

        return groupJoinRequests;

    }

    groupJoinRequests = data || [];

    // Quelqu'un qui est déjà dans le groupe (accepté entre-temps) n'est plus une demande.
    if (groupJoinRequests.length > 0) {

        const { data: members } = await supabaseClient
            .from("group_members")
            .select("user_id")
            .eq("group_id", currentGroup.id)
            .in("user_id", groupJoinRequests.map(request => request.user_id));

        const memberIds = new Set((members || []).map(member => member.user_id));

        groupJoinRequests = groupJoinRequests.filter(request => !memberIds.has(request.user_id));

    }

    if (dot) {

        dot.textContent = groupJoinRequests.length;

        dot.classList.toggle("hidden", groupJoinRequests.length === 0);

    }


    // Nouvelle demande : une notification (une seule fois par demande).
    const key = request => currentGroup.id + "|" + request.user_id + "|" + request.created_at;

    const seen = readStorage("seen-join-requests") || [];

    const fresh = groupJoinRequests.filter(request => !seen.includes(key(request)));

    if (fresh.length > 0) {

        writeStorage("seen-join-requests", [...seen, ...fresh.map(key)].slice(-100));

        // Les notifications arrivent l'une après l'autre : on revérifie au moment
        // de l'afficher que la demande attend toujours (pas acceptée entre-temps).
        fresh.forEach((request, index) => setTimeout(() => {

            if (!groupJoinRequests.some(other => key(other) === key(request))) {
                return;
            }

            alertToast(
                `<strong>${escapeHtml(request.username)}</strong> demande à rejoindre le groupe · <u>voir</u>`,
                { type: "join", at: request.created_at, onClick: openGroupModal }
            );

        }, index * 1500));

    }


    // Fenêtre du groupe ouverte : la section suit.
    if (!document.getElementById("group-modal").classList.contains("hidden")) {

        renderJoinRequestsSection();

    }

    return groupJoinRequests;

}

function renderJoinRequestsSection() {

    const section = document.getElementById("group-requests");

    if (!section) {
        return;
    }

    if (!canAnswerJoinRequests() || groupJoinRequests.length === 0) {

        section.classList.add("hidden");

        section.innerHTML = "";

        return;

    }

    section.classList.remove("hidden");

    section.innerHTML = `
        <div class="group-requests-header">
            <span>Demandes en attente</span>
            <span class="group-requests-count">${groupJoinRequests.length}</span>
        </div>

        ${groupJoinRequests.map(request => `
            <div class="group-request-row" data-request-user="${request.user_id}">
                <div class="group-request-who">
                    <b>🙋 ${escapeHtml(request.username)}</b>
                    <small>a demandé ${typeof toastTimeLabel === "function" ? toastTimeLabel(request.created_at) : ""}</small>
                </div>
                <button type="button" class="group-request-accept" data-request-answer="1">✓ Accepter</button>
                <button type="button" class="group-request-refuse" data-request-answer="0" aria-label="Refuser" title="Refuser">✕</button>
            </div>
        `).join("")}
    `;

    section.querySelectorAll("[data-request-answer]").forEach(button => {

        button.addEventListener("click", () => {

            const row = button.closest("[data-request-user]");

            const request = groupJoinRequests.find(item => item.user_id === row.dataset.requestUser);

            answerJoinRequest(request, button.dataset.requestAnswer === "1", row);

        });

    });

}

async function answerJoinRequest(request, accept, row) {

    if (!request) {
        return;
    }

    row.querySelectorAll("button").forEach(button => button.disabled = true);

    const { error } = await supabaseClient.rpc("answer_join_request", {
        p_group: currentGroup.id,
        p_user: request.user_id,
        p_accept: accept
    });

    if (error) {

        document.getElementById("group-modal-error").textContent = error.message || "Action impossible.";

        row.querySelectorAll("button").forEach(button => button.disabled = false);

        return;

    }

    // La ligne glisse hors de la liste, puis tout se met à jour.
    await row.animate(
        [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: accept ? "translateX(40px)" : "translateX(-40px)" }
        ],
        { duration: 300, easing: "ease-in", fill: "forwards" }
    ).finished.catch(() => {});

    alertToast(
        accept
            ? `<strong>${escapeHtml(request.username)}</strong> a rejoint le groupe`
            : `Demande de <strong>${escapeHtml(request.username)}</strong> refusée`,
        { type: accept ? "joined" : "error" }
    );

    await refreshJoinRequests();

    renderJoinRequestsSection();

    if (accept) {

        await renderGroupModal();

        displayLeaderboard();

    }

}


function setupGroupModal() {

    const modal = document.getElementById("group-modal");

    if (!modal) {
        return;
    }

    document.getElementById("close-group-modal").addEventListener("click", () => {
        modal.classList.add("hidden");
    });

    document.getElementById("group-rename-button").addEventListener("click", async () => {

        const name = document.getElementById("group-rename-input").value.trim();

        await groupAction("rename_group", { p_group: currentGroup.id, p_name: name });

    });

    document.getElementById("group-copy-code").addEventListener("click", event => {
        copyText(currentGroup.code, event.currentTarget);
    });

    document.getElementById("group-regenerate-code").addEventListener("click", async () => {

        if (!window.confirm("Créer un nouveau code ? L'ancien ne fonctionnera plus.")) {
            return;
        }

        await groupAction("regenerate_group_code", { p_group: currentGroup.id });

    });

}



/* =========================================================
   SOLDE
========================================================= */

/*
    Argent en jeu : total de mes mises pas encore récupérées
    (paris en cours + paris validés à récupérer).
    Affiché en petit sous le solde.
*/

async function refreshInPlay() {

    if (!currentUser || !currentGroup) {
        return;
    }

    const { data, error } =
        await supabaseClient
            .from("stakes")
            .select("stake, bets!inner ( group_id )")
            .eq("user_id", currentUser.id)
            .eq("bets.group_id", currentGroup?.id)
            .is("claimed_at", null);

    if (error) {
        console.error(error);
        return;
    }

    // Combinés pas encore soldés (gagnés, perdus ou en attente).
    const combos = await loadMyCombos();

    const total =
        (data || []).reduce((sum, s) => sum + Number(s.stake), 0) +
        combos
            .filter(combo => !combo.claimed_at)
            .reduce((sum, combo) => sum + Number(combo.stake), 0);

    updateParrotSize(total);

}


/*
    Le perroquet grandit (ou rapetisse) lentement avec l'argent en jeu,
    de 350 px (0 €) à 450 px (1 500 € et plus).
    Si des billets sont en train de voler, la croissance dure jusqu'à
    la fin de leur animation, et la pile change à ce moment-là.
*/

const PARROT_GROW_SECONDS = 2.5;


/*
    Cadre « En jeu » : posé dans la pose d'attente du perroquet (repère 512 × 650),
    il grandit, change de pile et respire avec lui. Positions réglées pour chaque pile
    (ancrage sur les pattes, puis décalage propre à l'état).
*/

const ENJEU_POSITIONS = {
    1: { x: 246, y: 426 },
    2: { x: 223.5, y: 537 },
    3: { x: 236, y: 509 },
    4: { x: 252, y: 469 }
};

let enjeuPlate = null;

let enjeuShown = 0;

let enjeuCount = null;

function ensureEnjeuPlate() {

    if (enjeuPlate && enjeuPlate.isConnected) {

        return enjeuPlate;

    }

    const pose = document.querySelector('#parrot [data-pose="waiting"]');

    if (!pose) {

        return null;

    }

    enjeuPlate = document.createElement("div");

    enjeuPlate.className = "enjeu-cadre vide";

    enjeuPlate.setAttribute("title", "Argent misé sur des paris pas encore récupérés");

    enjeuPlate.innerHTML = `
        <div class="enjeu-fl">
            <div class="enjeu-frame">
                <div class="enjeu-inner">
                    <span class="enjeu-label">En jeu</span>
                    <span class="enjeu-amount">0 €</span>
                </div>
            </div>
        </div>
    `;

    pose.appendChild(enjeuPlate);

    return enjeuPlate;

}

/*
    Position du cadre selon la pile (au moment où le perroquet change de pile).
*/

function placeEnjeuPlate(total, instant) {

    const plate = ensureEnjeuPlate();

    if (!plate) {

        return;

    }

    const position = ENJEU_POSITIONS[parrotLevelFor(total)];

    // Au premier affichage, le cadre se pose sans glisser.
    if (instant) {

        plate.style.transition = "none";

    }

    plate.style.left = position.x + "px";

    plate.style.top = position.y + "px";

    if (instant) {

        void plate.offsetWidth;

        plate.style.transition = "";

    }

}

/*
    Montant du cadre : il se met à compter dès que les premiers billets touchent
    le perroquet, et finit en même temps que le dernier billet.
    Masqué quand il n'y a rien en jeu.
*/

let enjeuTimer = null;

function countEnjeuAmount(total, startDelay, duration, instant) {

    const plate = ensureEnjeuPlate();

    if (!plate) {

        return;

    }

    const amount = plate.querySelector(".enjeu-amount");

    const from = enjeuShown;

    enjeuShown = total;

    clearTimeout(enjeuTimer);

    cancelAnimationFrame(enjeuCount);

    if (instant || from === total) {

        amount.textContent = formatMoney(total);

        plate.classList.toggle("vide", total <= 0);

        return;

    }

    enjeuTimer = setTimeout(() => {

        // De 0 à quelque chose : le cadre apparaît quand le premier billet arrive.
        if (total > 0) {

            plate.classList.remove("vide");

        }

        const start = performance.now();

        const step = now => {

            const t = Math.min(1, (now - start) / duration);

            amount.textContent = formatMoney(from + (total - from) * t);

            if (t < 1) {

                enjeuCount = requestAnimationFrame(step);

            } else if (total <= 0) {

                plate.classList.add("vide");

            }

        };

        enjeuCount = requestAnimationFrame(step);

    }, startDelay);

}

let parrotLastTotal = 0;

let parrotFirstSizing = true;

let parrotSettleUntil = 0;

// Réajustement de la taille du perroquet (posé par setupParrotFit).
let parrotRefit = null;


/*
    Taille adaptée à l'écran : le perroquet reste en bas à droite et ne
    descend jamais sur le coffre ni sur la carte d'expérience (colonne de
    droite). S'il n'y a vraiment pas la place, il se cache.
*/

const PARROT_BOTTOM_OFFSET = 42;   // le perroquet dépasse de 42 px sous l'écran (bottom: -42px)

const PARROT_GAP = 12;             // marge sous la colonne de droite

const PARROT_MIN_WIDTH = 130;

/*
    Version téléphone : écran de 800 px ou moins (même seuil que style.css),
    OU ordinateur dont la fenêtre est trop étroite pour la version ordinateur
    (il faudrait défiler de côté). Dans ce 2e cas, on « force » le mode
    téléphone : les blocs @media (max-width: 800px) des feuilles de style
    s'appliquent, ceux des grands écrans (min-width: 801px / 1101px) non.
    PHONE_LAYOUT.matches / addEventListener("change") comme un matchMedia.
*/

const PHONE_MEDIA = window.matchMedia("(max-width: 800px)");

let phoneForced = false;

// Largeur de fenêtre qu'il faut pour revenir en version ordinateur.
let phoneForcedWidth = 0;

const phoneLayoutListeners = [];

const PHONE_LAYOUT = {

    get matches() {
        return phoneForced || PHONE_MEDIA.matches;
    },

    addEventListener(type, listener) {

        if (type === "change") {
            phoneLayoutListeners.push(listener);
        }

    }

};

PHONE_MEDIA.addEventListener?.("change", () => {

    phoneLayoutListeners.forEach(listener => listener({ matches: PHONE_LAYOUT.matches }));

    checkHorizontalOverflow();

});

const PHONE_MEDIA_TEXT = "(max-width: 800px)";

const DESKTOP_MEDIA_TEXTS = ["(min-width: 801px)", "(min-width: 1101px)"];

// « jamais » ajouté à une requête ordinateur (et retiré pour la rétablir).
const MEDIA_NEVER = " and (max-width: 0px)";

function forcePhoneMedia(rules, on) {

    for (const rule of rules) {

        if (!(rule instanceof CSSMediaRule)) {
            continue;
        }

        const text = rule.media.mediaText;

        if (text === PHONE_MEDIA_TEXT || text === "all, " + PHONE_MEDIA_TEXT) {

            // « all, … » = toujours vrai ; on retire « all, » pour revenir au seuil normal.
            rule.media.mediaText = on ? "all, " + PHONE_MEDIA_TEXT : PHONE_MEDIA_TEXT;

        } else {

            const base = text.replace(MEDIA_NEVER, "");

            if (DESKTOP_MEDIA_TEXTS.includes(base)) {
                rule.media.mediaText = on ? base + MEDIA_NEVER : base;
            }

        }

        forcePhoneMedia(rule.cssRules, on);

    }

}

function setPhoneForced(on) {

    if (on === phoneForced) {
        return;
    }

    phoneForced = on;

    document.documentElement.classList.toggle("force-phone", on);

    for (const sheet of document.styleSheets) {

        let rules;

        // Feuilles d'un autre site (polices Google) : illisibles, et sans seuil à changer.
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }

        forcePhoneMedia(rules, on);

    }

    phoneLayoutListeners.forEach(listener => listener({ matches: PHONE_LAYOUT.matches }));

}

function pageOverflowsSideways() {

    const doc = document.documentElement;

    return doc.scrollWidth > doc.clientWidth + 2;

}

let overflowConfirmTimer = null;

function checkHorizontalOverflow() {

    // Vrai téléphone (ou petite fenêtre) : le mode téléphone s'applique déjà tout seul.
    if (PHONE_MEDIA.matches) {
        setPhoneForced(false);
        return;
    }

    if (phoneForced) {

        if (window.innerWidth < phoneForcedWidth) {
            return;
        }

        // Fenêtre élargie : on réessaie la version ordinateur (mesure immédiate, sans affichage entre-temps).
        setPhoneForced(false);

        if (!pageOverflowsSideways()) {
            return;
        }

    } else if (!pageOverflowsSideways()) {
        return;
    }

    const force = () => {

        const doc = document.documentElement;

        phoneForcedWidth = window.innerWidth + (doc.scrollWidth - doc.clientWidth);

        setPhoneForced(true);

    };

    if (phoneForced === false && overflowConfirmTimer === null && document.readyState === "complete") {

        // Débordement passager (animation) : on confirme 400 ms plus tard avant de basculer.
        overflowConfirmTimer = setTimeout(() => {

            overflowConfirmTimer = null;

            if (!PHONE_MEDIA.matches && !phoneForced && pageOverflowsSideways()) {
                force();
            }

        }, 400);

        return;

    }

    force();

}

/*
    Téléphone : la flamme de série quitte la barre du haut pour l'en-tête
    de la page des paris (à gauche de « 🏆 Classement »), et
    l'onglet « Aide app » quitte le menu du bas pour la barre du haut.
    Ordinateur : chacun reprend sa place d'origine (repérée par un commentaire).
*/

const phoneMoves = [];

function placePhoneHeaderWidgets() {

    const widgets = document.getElementById("phone-header-widgets");

    const userArea = document.querySelector(".user-area");

    if (!widgets || !userArea) {
        return;
    }

    if (phoneMoves.length === 0) {

        // La jauge d'XP reste dans la barre du haut (2026-10-16).
        [
            [document.getElementById("streak-widget"), widgets],
            [document.getElementById("beta-nav-button"), userArea, true]
        ].forEach(([element, target, first]) => {

            if (!element) {
                return;
            }

            const home = document.createComment("place de " + element.id);

            element.before(home);

            phoneMoves.push({ element, home, target, first });

        });

    }

    const phone = PHONE_LAYOUT.matches;

    phoneMoves.forEach(({ element, home, target, first }) => {

        if (phone) {
            if (first) {
                target.prepend(element);
            } else {
                target.append(element);
            }
        } else {
            home.after(element);
        }

    });

    document.body.classList.toggle("phone-widgets-moved", phone);

}

PHONE_LAYOUT.addEventListener("change", placePhoneHeaderWidgets);

document.addEventListener("DOMContentLoaded", placePhoneHeaderWidgets);


let overflowCheckFrame = null;

function scheduleOverflowCheck() {

    cancelAnimationFrame(overflowCheckFrame);

    overflowCheckFrame = requestAnimationFrame(checkHorizontalOverflow);

}

window.addEventListener("resize", scheduleOverflowCheck);

document.addEventListener("DOMContentLoaded", () => {

    checkHorizontalOverflow();

    // La barre du haut grandit (solde, onglets admin…) : on revérifie.
    const watched = [document.querySelector(".navbar"), document.querySelector(".user-area"), document.querySelector(".main-container")];

    if (typeof ResizeObserver !== "undefined") {

        const observer = new ResizeObserver(scheduleOverflowCheck);

        watched.filter(Boolean).forEach(element => observer.observe(element));

    }

});

const PHONE_PARROT_SCALE = 0.34;   // 350 → 119 px, 450 → 153 px

function parrotWidthLimit(wanted) {

    const parrotElement = document.getElementById("parrot");

    const column = document.querySelector(".right-column");

    if (!parrotElement || !column || column.getClientRects().length === 0) {

        return Infinity;

    }

    const columnRect = column.getBoundingClientRect();

    const rightOffset = parseFloat(getComputedStyle(parrotElement).right) || 0;

    const parrotRight = document.documentElement.clientWidth - rightOffset;

    const parrotLeft = parrotRight - wanted;

    // Pas au-dessus de la colonne ? Aucune contrainte de hauteur.
    if (columnRect.left >= parrotRight || columnRect.right <= parrotLeft) {

        return Infinity;

    }

    // Le haut du perroquet doit rester sous le bas de la colonne, mesuré page
    // tout en haut : la colonne (collante) remonte quand on fait défiler,
    // mais le perroquet ne doit pas grandir pour autant.
    const columnBottom =
        column.parentElement.getBoundingClientRect().top + window.scrollY + column.offsetHeight;

    const room = window.innerHeight + PARROT_BOTTOM_OFFSET - columnBottom - PARROT_GAP;

    return room * 512 / 650;

}

/*
    Largeur max à l'horizontale : le perroquet (ancré à droite) ne doit pas
    déborder à gauche sur les cartes de la page affichée.
    Paris : bord droit des cartes ; autres pages : bord droit du contenu.
*/

function parrotHorizontalLimit() {

    const parrotElement = document.getElementById("parrot");

    const page = [...document.querySelectorAll(".app-page")]
        .find(element => !element.classList.contains("hidden"));

    if (!parrotElement || !page) {

        return Infinity;

    }

    let contentRight = 0;

    if (page.id === "bets-page") {

        page.querySelectorAll(".bets-list > *").forEach(element => {

            const rect = element.getBoundingClientRect();

            if (rect.width > 0) {

                contentRight = Math.max(contentRight, rect.right);

            }

        });

    } else {

        const rect = page.getBoundingClientRect();

        contentRight = rect.right - (parseFloat(getComputedStyle(page).paddingRight) || 0);

    }

    // Bord droit réel du perroquet (ancré à droite : ne dépend pas de sa largeur).
    const parrotRight = parrotElement.getBoundingClientRect().right;

    if (contentRight <= 0 || parrotRight <= 0) {

        return Infinity;

    }

    return parrotRight - contentRight - PARROT_GAP;

}

function applyParrotWidth(seconds) {

    const parrotElement = document.getElementById("parrot");

    if (!parrotElement) {
        return;
    }

    // Téléphone : petit perroquet (il grandit quand même avec l'argent en jeu),
    // posé au-dessus des onglets, sans contrainte de colonne.
    if (PHONE_LAYOUT.matches) {

        parrotElement.style.transitionDuration = seconds + "s";

        parrotElement.style.width = Math.round(parrotWidthFor(parrotLastTotal) * PHONE_PARROT_SCALE) + "px";

        parrotElement.classList.remove("parrot-squeezed");

        return;

    }

    const wanted = Math.min(
        parrotWidthFor(parrotLastTotal),
        window.innerWidth * 0.42
    );

    const limit = Math.min(
        parrotWidthLimit(wanted),
        parrotHorizontalLimit()
    );

    const width = Math.min(wanted, limit);

    parrotElement.style.transitionDuration = seconds + "s";

    parrotElement.style.width = Math.max(0, Math.round(width)) + "px";

    parrotElement.classList.toggle("parrot-squeezed", width < PARROT_MIN_WIDTH);

}

function setupParrotFit() {

    parrotSettleUntil = performance.now() + 2500;

    let waiting = false;

    const refit = () => {

        if (waiting) {
            return;
        }

        waiting = true;

        requestAnimationFrame(() => {

            waiting = false;

            // Juste après le chargement, la mise en page se termine : on
            // ajuste sans animation pour que le perroquet ne bouge pas.
            applyParrotWidth(performance.now() < parrotSettleUntil ? 0 : 0.25);

        });

    };

    window.addEventListener("resize", refit);

    const column = document.querySelector(".right-column");

    if (column && typeof ResizeObserver !== "undefined") {

        new ResizeObserver(refit).observe(column);

        // Les cartes changent de largeur (ou arrivent) : place à droite recalculée.
        const cards = document.getElementById("bets-container");

        if (cards) {

            new ResizeObserver(refit).observe(cards);

        }

    }

    // Changement d'onglet : le contenu n'a pas la même largeur selon la page.
    parrotRefit = refit;

    refit();

}

let parrotLevelTimer = null;

function updateParrotSize(total) {

    const parrotElement =
        document.getElementById("parrot");

    if (!parrotElement || typeof Parrot === "undefined") {
        return;
    }

    const billsLeft =
        Math.max(0, (window.billsAnimationEnd || 0) - performance.now()) / 1000;

    const seconds =
        Math.max(PARROT_GROW_SECONDS, billsLeft);

    parrotLastTotal = total;

    // Première fois (arrivée ou rafraîchissement de la page) : taille et pile
    // posées directement, rien ne bouge.
    const first = parrotFirstSizing;

    parrotFirstSizing = false;

    applyParrotWidth(first ? 0 : seconds);

    // Fin de l'animation du perroquet (il grandit), pour lancer la suite après elle.
    window.parrotAnimEnd = first ? 0 : performance.now() + seconds * 1000;


    // Le montant du cadre compte dès que les premiers billets touchent le perroquet,
    // et termine avec le dernier.
    const arrival = window.billsFirstArrival || 0;

    const startAt = Math.max(arrival, performance.now());

    countEnjeuAmount(
        total,
        first ? 0 : Math.max(0, arrival - performance.now()),
        Math.max(600, (window.billsAnimationEnd || 0) - startAt),
        first
    );

    window.billsFirstArrival = 0;


    // Changement de pile une fois les billets arrivés.
    clearTimeout(parrotLevelTimer);

    parrotLevelTimer = setTimeout(
        () => {

            Parrot.level(parrotLevelFor(total), first);

            // Le cadre « En jeu » change de place en même temps que le perroquet change de pile.
            placeEnjeuPlate(total, first);

        },
        billsLeft * 1000
    );

}


/*
    Largeur du perroquet selon l'argent en jeu, proportionnelle
    dans chaque palier (de plus en plus vite d'un palier à l'autre) :
    0 € → 350 px, 300 € → 375 px, 800 € → 410 px, 1 500 € → 450 px (max).
*/

const PARROT_SIZE_STEPS = [
    { amount: 0, width: 350 },
    { amount: 299, width: 375 },
    { amount: 300, width: 375 },
    { amount: 799, width: 410 },
    { amount: 800, width: 410 },
    { amount: 1500, width: 450 }
];

function parrotWidthFor(amount) {

    const steps = PARROT_SIZE_STEPS;

    if (amount >= steps[steps.length - 1].amount) {
        return steps[steps.length - 1].width;
    }

    for (let i = 1; i < steps.length; i++) {

        const a = steps[i - 1];
        const b = steps[i];

        if (amount <= b.amount) {

            const t = b.amount > a.amount
                ? (amount - a.amount) / (b.amount - a.amount)
                : 1;

            return Math.round(a.width + (b.width - a.width) * Math.max(0, t));

        }

    }

    return steps[0].width;

}


/*
    Niveau d'attente du perroquet selon l'argent en jeu :
    1 = classique (0 €), 2 = petite pile (1 à 299 €),
    3 = pile moyenne (300 à 799 €), 4 = énorme pile (800 € et plus).
*/

const PARROT_LEVEL_THRESHOLDS = [1, 300, 800];

function parrotLevelFor(amount) {

    return 1 + PARROT_LEVEL_THRESHOLDS.filter(min => amount >= min).length;

}


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
            : formatBalance(currentProfile.balance);


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
                ? "∞ 🪙"
                : (currentProfile.points || 0) + " 🪙";

    }

    updateDiamondDisplay();

}



/* =========================================================
   CLASSEMENT DES MEILLEURS PARIEURS
========================================================= */

async function getLeaderboard() {

    const {
        data,
        error
    } = await supabaseClient
        .from("group_members")
        .select("balance, user_id, profiles!inner ( username, is_admin, gold_frame_until, name_color_until, cosmetics )")
        .eq("group_id", currentGroup?.id)
        .eq("profiles.is_admin", false)
        .order("balance", { ascending: false })
        .limit(10);


    if (error) {
        console.error("Erreur getLeaderboard :", error);
        throw error;
    }


    // Même forme qu'avant : un profil avec le solde du groupe.
    return (data || []).map(
        member => ({ ...member.profiles, balance: member.balance, user_id: member.user_id })
    );

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

    profile = withGroupStyle(profile);

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

    // Pseudos animés de la boutique : un seul affiché, le plus cher.
    const anim =
        NAME_ANIMATIONS.find(id => active(id)) || null;

    return {
        gold: isMe ? hasMyReward("gold_frame_until") : isRewardActive(profile.gold_frame_until) && !profile.cosmetics?.cadre?.off,
        rainbow: isMe ? hasMyReward("name_color_until") : isRewardActive(profile.name_color_until) && !profile.cosmetics?.couleur?.off,
        metal,
        anim,
        // Objets exclusifs achetés en diamants.
        cristal: diamondItemOn(isMe ? currentProfile : profile, "cristal"),
        diamondFrame: diamondItemOn(isMe ? currentProfile : profile, "cadre_diamant"),
        diamondEmoji: diamondItemOn(isMe ? currentProfile : profile, "emoji_diamant"),
        flame: flameNameOn(profile),
        beta: betaStyleOf(profile.username),
        neon: active("neon") ? option("neon") : null,
        emoji: active("emoji") ? option("emoji") : null,
        sparkle: active("etincelles"),
        aura: active("aura"),
        theme: diamondItemOn(isMe ? currentProfile : profile, "theme_diamant")
            ? "diamant"
            : active("theme") ? option("theme") : null
    };

}


/*
    Pseudo avec ses effets (couleur, emoji, étincelles).
    Priorité de la couleur : métal > arc-en-ciel > cristal (diamant) > pseudo animé
    de la boutique > pseudo enflammé > pseudo bêta-testeur > néon.
*/

/*
    Pseudo enflammé : récompense de série, seulement tant que la série
    tient (15 jours ou plus, dernière connexion aujourd'hui ou hier).
    Voir pseudo-enflamme.sql.
*/

const FLAME_NAME_STREAK = 15;

function flameNameOn(profile) {

    const isMe =
        currentProfile && profile.username === currentProfile.username;

    const player =
        isMe ? currentProfile : profile;

    if (!player || player.flame_name_off) {
        return false;
    }

    // Série illimitée de l'admin (affichée ∞) : le pseudo est enflammé d'office.
    if (player.is_admin) {
        return true;
    }

    if (!player.last_checkin) {
        return false;
    }

    if ((player.streak_days || 0) < FLAME_NAME_STREAK) {
        return false;
    }

    const yesterday =
        parisDay(new Date(Date.now() - 86400000));

    return String(player.last_checkin).slice(0, 10) >= yesterday;

}


function nameHtml(profile, effects = getEffects(profile)) {

    let name;

    if (effects.metal) {
        name = `<span class="name-metal metal-${effects.metal}">${escapeHtml(profile.username)}</span>`;
    } else if (effects.rainbow) {
        name = `<span class="pseudo-color">${rainbowName(profile.username)}</span>`;
    } else if (effects.cristal) {
        name = `<span class="name-cristal">${escapeHtml(profile.username)}</span>`;
    } else if (effects.anim) {
        // La fiole a ses bulles qui montent.
        const bubbles = effects.anim === "fiole" ? "<i></i><i></i><i></i>" : "";
        name = `<span class="name-anim anim-${effects.anim}">${escapeHtml(profile.username)}${bubbles}</span>`;
    } else if (effects.flame) {
        // Braises qui vacillent, avec deux petites flammes discrètes.
        name = `<span class="name-flame">${escapeHtml(profile.username)}<i>🔥</i><i>🔥</i></span>`;
    } else if (effects.beta) {
        name = `<span class="name-beta beta-${effects.beta}">${escapeHtml(profile.username)}</span>`;
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

    if (effects.diamondEmoji) {
        name += ` <span class="name-emoji name-diamond">💎</span>`;
    }

    return name;

}


function styledName(profile, fallback = "Utilisateur") {

    if (!profile?.username) {
        return escapeHtml(fallback);
    }

    const effects =
        getEffects(profile);

    // data-player : un clic ouvre la fenêtre du joueur (setupPlayerProfile).
    return `<span class="user-name${effects.gold ? " name-gold" : ""}" data-player="${escapeHtml(profile.username)}">${nameHtml(profile, effects)}</span>`;

}


/*
    Ligne du classement (joueur classé ou admin épinglé).
*/

/*
    Joueur AFK : pas venu sur le site pendant 2 jours ouvrés de suite
    (samedi et dimanche ne comptent pas, ni la journée en cours).
    Même règle que is_afk dans afk.sql.
*/

function isAfk(lastCheckin) {

    if (!lastCheckin) {
        return true;
    }

    const today = parisDay();

    const day = new Date(String(lastCheckin).slice(0, 10) + "T12:00:00Z");

    let missed = 0;

    day.setUTCDate(day.getUTCDate() + 1);

    while (day.toISOString().slice(0, 10) < today) {

        const weekday = day.getUTCDay();

        if (weekday !== 0 && weekday !== 6) {
            missed += 1;
        }

        day.setUTCDate(day.getUTCDate() + 1);

    }

    return missed >= 2;

}

// Membre du groupe en cours absent (jamais soi-même : on vient d'ouvrir le site).
function isAfkPlayer(profile) {

    const style =
        groupStyles.get(profile?.username);

    return Boolean(style)
        && profile.username !== currentProfile?.username
        && isAfk(style.last_checkin);

}


function leaderboardRowHtml(profile, { rank, medal, balance, extraClass = "", effects: forcedEffects = null }) {

    const effects =
        forcedEffects || getEffects(profile);

    // AFK : pseudo grisé (pas dans les aperçus de la boutique).
    const afk =
        !forcedEffects && isAfkPlayer(profile);

    const hasEffect =
        effects.metal || effects.rainbow || effects.cristal || effects.diamondEmoji || effects.anim || effects.flame || effects.beta || effects.neon || effects.sparkle || effects.emoji;

    return `
        <div class="leaderboard-row${extraClass}${effects.gold ? " leaderboard-row--gold" : ""}${effects.aura ? " leaderboard-row--aura" : ""}${effects.diamondFrame ? " leaderboard-row--diamond" : ""}${afk ? " leaderboard-row--afk" : ""}"${afk ? ' title="Absent depuis au moins 2 jours ouvrés"' : ""}${forcedEffects ? "" : ` data-player="${escapeHtml(profile.username)}"`}>
            <span class="leaderboard-rank">${rank}</span>
            <span class="leaderboard-medal">${medal}</span>
            <span class="leaderboard-pseudo${hasEffect ? " has-effect" : ""}">${afk ? `<span class="afk-name">${nameHtml(profile, effects)}</span><span class="afk-tag">AFK</span>` : nameHtml(profile, effects)}</span>
            <span class="leaderboard-balance">${balance}</span>
            ${!forcedEffects && typeof duelButtonHtml === "function" ? duelButtonHtml(profile) : ""}
        </div>
    `;

}

/*
    Survol du classement : un seul surligneur glisse d'un joueur à l'autre
    (au lieu d'un fond qui saute de ligne en ligne). Un peu plus large que
    la ligne, pour ne pas coller au pseudo ni au solde.
*/

function setupLeaderboardHover(container) {

    // Premier enfant : la règle « dernière ligne sans trait » reste juste.
    const glow = document.createElement("div");

    glow.className = "leaderboard-hover";

    container.prepend(glow);

    if (container.dataset.hoverReady) {
        return;
    }

    container.dataset.hoverReady = "1";

    container.addEventListener("mouseover", event => {

        const row = event.target.closest(".leaderboard-row[data-player]");

        const indicator = container.querySelector(".leaderboard-hover");

        if (!row || !indicator) {
            return;
        }

        const visible = indicator.classList.contains("on");

        // Il apparaît sur place la première fois, puis glisse d'une ligne à l'autre.
        indicator.style.transition = visible ? "" : "none";

        indicator.style.transform = `translateY(${row.offsetTop}px)`;

        indicator.style.height = row.offsetHeight + "px";

        if (!visible) {

            void indicator.offsetWidth;

            indicator.style.transition = "";

        }

        indicator.classList.add("on");

    });

    container.addEventListener("mouseleave", () => {

        container.querySelector(".leaderboard-hover")?.classList.remove("on");

    });

}


async function displayLeaderboard() {

    const container =
        document.getElementById("leaderboard-list");


    if (!container) {
        return;
    }


    try {

        const [profiles] = await Promise.all([
            getLeaderboard(),
            typeof loadWinStreaks === "function" ? loadWinStreaks() : null
        ]);

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
                {
                    rank: index + 1,
                    // Plus de médailles : la place sert à la flamme bleue des victoires d'affilée (duels.js).
                    medal: typeof winStreakBadgeHtml === "function" ? winStreakBadgeHtml(profile.username) : "",
                    balance: formatBalance(profile.balance)
                }
            )
        ).join("");


        setupLeaderboardHover(container);

        animateLeaderboard(profiles);

        // Duels : défis reçus remis tout de suite sur les lignes, puis mis à jour.
        if (typeof refreshDuels === "function") {
            markDuelRows();
            refreshDuels();
        }

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


    const hasMessage = Boolean(data?.content?.trim());

    content.textContent = hasMessage ? data.content : "";

    content.classList.toggle("hidden", !hasMessage);

    if (permanentInput) {

        permanentInput.value = hasMessage ? data.content : "";

    }

    // Sondage de l'admin sous le message : la fenêtre reste affichée s'il y en a un.
    const hasPoll = await renderPoll();

    // Ni message ni sondage : la fenêtre disparaît.
    sidebar.classList.toggle("hidden", !hasMessage && !hasPoll);

}


/*
    Sondage Oui / Non de l'admin (sondage-admin.sql) : sous le message permanent,
    barre des résultats et boutons de vote, comme pour une contestation.
*/

let currentPoll = null;

let pollRefreshTimer = null;

async function renderPoll() {

    const box = document.getElementById("admin-poll");

    if (!box) {
        return false;
    }

    // Sondage de ce groupe, ou sondage « tous les groupes ».
    const { data, error } = await supabaseClient.rpc("current_poll", { p_group: currentGroup?.id || null });

    if (error) {
        console.error(error);
        box.classList.add("hidden");
        return false;
    }

    currentPoll = Array.isArray(data) ? data[0] || null : data;

    renderPollAdmin();

    if (!currentPoll) {

        box.classList.add("hidden");

        box.innerHTML = "";

        return false;

    }

    const poll = currentPoll;

    const open = !poll.closed_at;

    const total = poll.votes_yes + poll.votes_no;

    const yesPct = total ? poll.votes_yes / total * 100 : 0;

    const noPct = total ? poll.votes_no / total * 100 : 0;

    const canVote = open && poll.my_vote === null;

    const result = !open
        ? (poll.votes_yes > poll.votes_no ? "✅ Le Oui l'emporte"
            : poll.votes_no > poll.votes_yes ? "❌ Le Non l'emporte"
            : total ? "⚖️ Égalité" : "Aucun vote")
        : "";

    box.classList.remove("hidden");

    box.innerHTML = `

        <h4>📊 Sondage${open ? "" : " terminé"}</h4>

        <p class="admin-poll-question">${escapeHtml(poll.question)}</p>

        ${result ? `<p class="admin-poll-result">${result}</p>` : ""}

        <div class="contest-votes">

            <div class="contest-votes-bar">
                <span class="contest-votes-keep" style="width:${yesPct}%"></span>
                <span class="contest-votes-annul" style="width:${noPct}%"></span>
            </div>

            <div class="contest-votes-legend">
                <span>✅ Oui : <b>${poll.votes_yes}</b></span>
                <span>${total} vote${total > 1 ? "s" : ""}</span>
                <span>❌ Non : <b>${poll.votes_no}</b></span>
            </div>

        </div>

        ${poll.my_vote !== null
            ? `<p class="admin-poll-hint">Tu as voté : <b>${poll.my_vote ? "Oui" : "Non"}</b>.</p>`
            : ""}

        ${canVote
            ? `
                <div class="contest-vote-buttons">
                    <button type="button" class="contest-vote contest-vote--keep" data-poll-yes="true">✅ Oui</button>
                    <button type="button" class="contest-vote contest-vote--annul" data-poll-yes="false">❌ Non</button>
                </div>
            `
            : ""}

        <p class="admin-poll-hint">🔒 Vote anonyme${poll.voters?.length
            // Seul l'admin reçoit les pseudos des votants (jamais leur choix).
            ? ` · ont voté : ${poll.voters.map(name => escapeHtml(name)).join(", ")}`
            : ""}</p>

        <p class="error-message admin-poll-error"></p>

    `;

    box.querySelectorAll("[data-poll-yes]").forEach(button => {

        button.addEventListener("click", async () => {

            box.querySelectorAll("[data-poll-yes]").forEach(other => other.disabled = true);

            const { error: voteError } = await supabaseClient.rpc("vote_poll", {
                p_poll: poll.id,
                p_yes: button.dataset.pollYes === "true"
            });

            if (voteError) {

                box.querySelector(".admin-poll-error").textContent = voteError.message;

                box.querySelectorAll("[data-poll-yes]").forEach(other => other.disabled = false);

                return;

            }

            await renderPoll();

        });

    });

    // Les votes des autres arrivent toutes les 30 s tant que le sondage est ouvert.
    clearTimeout(pollRefreshTimer);

    if (open) {
        pollRefreshTimer = setTimeout(renderPoll, 30000);
    }

    return true;

}


// Page admin : liste des groupes du sondage (même liste que les stats des joueurs).
function fillPollGroups(groups) {

    const select = document.getElementById("poll-group");

    if (!select) {
        return;
    }

    const previous = select.value;

    select.innerHTML = `<option value="">Tous les groupes</option>` + groups.map(([id, name]) =>
        `<option value="${id}">${escapeHtml(name)}</option>`
    ).join("");

    select.value = groups.some(([id]) => id === previous) ? previous : "";

    renderPollAdmin();

}


// Page admin : sondage du groupe choisi, boutons Terminer / Effacer, lancement.
async function renderPollAdmin() {

    const status = document.getElementById("poll-admin-status");

    const start = document.getElementById("poll-start");

    const select = document.getElementById("poll-group");

    if (!status || !start || !select || !currentProfile?.is_admin) {
        return;
    }

    const groupName = select.options[select.selectedIndex]?.textContent || "Tous les groupes";

    const { data } = await supabaseClient.rpc("current_poll", { p_group: select.value || null });

    let poll = Array.isArray(data) ? data[0] || null : data;

    // « Tous les groupes » choisi : seulement les sondages pour tous ; un groupe : seulement les siens.
    if (poll && (poll.group_id || null) !== (select.value || null)) {
        poll = null;
    }

    status.innerHTML = poll
        ? `
            <p class="resolve-info">
                ${poll.closed_at ? "Dernier sondage (terminé)" : "Sondage en cours"} · ${escapeHtml(groupName)} : <b>${escapeHtml(poll.question)}</b>
                · ✅ ${poll.votes_yes} / ❌ ${poll.votes_no}
            </p>
            <div class="admin-account-actions">
                ${poll.closed_at ? "" : `<button type="button" class="secondary-button" data-poll-admin="close">Terminer le sondage</button>`}
                <button type="button" class="admin-account-delete" data-poll-admin="delete">Effacer</button>
            </div>
        `
        : `<p class="resolve-info">Aucun sondage pour « ${escapeHtml(groupName)} ».</p>`;

    status.querySelectorAll("[data-poll-admin]").forEach(button => {

        button.addEventListener("click", async () => {

            const { error } = await supabaseClient.rpc(
                button.dataset.pollAdmin === "close" ? "admin_close_poll" : "admin_delete_poll",
                { p_poll: poll.id }
            );

            const message = document.getElementById("poll-admin-message");

            message.className = "admin-balance-message" + (error ? " error" : " success");

            message.textContent = error
                ? error.message
                : button.dataset.pollAdmin === "close" ? "Sondage terminé." : "Sondage effacé.";

            await displayAdminMessage();

        });

    });

    if (start.dataset.ready) {
        return;
    }

    start.dataset.ready = "1";

    select.addEventListener("change", renderPollAdmin);

    start.addEventListener("click", async () => {

        const input = document.getElementById("poll-question");

        const message = document.getElementById("poll-admin-message");

        const name = select.options[select.selectedIndex]?.textContent || "";

        start.disabled = true;

        const { error } = await supabaseClient.rpc("admin_start_poll", {
            p_question: input.value,
            p_group: select.value || null
        });

        start.disabled = false;

        message.className = "admin-balance-message" + (error ? " error" : " success");

        message.textContent = error ? error.message : `Sondage lancé pour « ${name} » : il s'affiche sous le message.`;

        if (!error) {
            input.value = "";
        }

        await displayAdminMessage();

    });

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


// Messages qui offrent un skin (repérés par leur titre) : skin montré et bouton.
const NOTICE_SKINS = {
    "🦩 Octobre rose": { id: "flamant", button: "🦩 Équiper le skin rose" },
    "🎃 Halloween": { id: "corbeau", button: "🎃 Équiper le skin Corbeau" }
};


/*
    Skins d'événement (halloween.sql) : donnés à la connexion pendant
    l'événement, avec un message unique déposé dans player_notices.
*/

async function claimEventSkins() {

    const { data, error } = await supabaseClient.rpc("claim_event_skins");

    if (error) {

        console.error("Erreur claimEventSkins :", error);

        return;

    }

    if (!data?.length || !currentProfile) {
        return;
    }

    currentProfile.event_skins = [...(currentProfile.event_skins || []), ...data];

    if (typeof renderParrotSkins === "function") {
        renderParrotSkins();
    }

}


/*
    Messages exceptionnels pour un joueur (table player_notices),
    par exemple une correction de solde. Affichés l'un après l'autre
    à la connexion, marqués lus par « J'ai compris ».
*/

async function checkPlayerNotices() {

    const {
        data,
        error
    } = await supabaseClient
        .from("player_notices")
        .select("id, title, content")
        .eq("user_id", currentUser.id)
        .is("seen_at", null)
        .order("created_at", { ascending: true });


    if (error) {

        console.error("Erreur checkPlayerNotices :", error);

        return;

    }


    const modal =
        document.getElementById("notice-modal");

    const okButton =
        document.getElementById("notice-ok");


    if (!modal || !okButton) {
        return;
    }


    const notices =
        data || [];

    const showNext = () => {

        const notice =
            notices.shift();

        if (!notice) {

            modal.classList.add("hidden");

            return;

        }

        document.getElementById("notice-title").textContent =
            notice.title;

        document.getElementById("notice-content").textContent =
            notice.content;

        // Message d'un skin offert (octobre-rose.sql, halloween.sql) : aperçu
        // du skin et bouton qui ouvre la fenêtre XP, là où on l'équipe.
        const giftSkin =
            NOTICE_SKINS[notice.title];

        const preview =
            document.getElementById("notice-preview");

        const actionButton =
            document.getElementById("notice-action");

        preview.src = giftSkin
            ? "assets/perroquet/skins/" + giftSkin.id + "/win-main.png"
            : "";

        preview.dataset.skin = giftSkin?.id || "";

        preview.classList.toggle("hidden", !giftSkin);

        actionButton.textContent = giftSkin?.button || "";

        actionButton.dataset.skin = giftSkin?.id || "";

        actionButton.classList.toggle("hidden", !giftSkin);

        okButton.classList.toggle("secondary-button", Boolean(giftSkin));

        okButton.classList.toggle("primary-button", !giftSkin);

        modal.classList.remove("hidden");

        const markSeen = async () => {

            okButton.disabled = true;

            actionButton.disabled = true;

            await supabaseClient.rpc("mark_notice_seen", { p_notice: notice.id });

            okButton.disabled = false;

            actionButton.disabled = false;

        };

        okButton.onclick = async () => {

            await markSeen();

            showNext();

        };

        actionButton.onclick = async () => {

            await markSeen();

            modal.classList.add("hidden");

            openXpModalOnSkin(giftSkin.id);

            // Les autres messages éventuels passeront à la prochaine connexion.

        };

    };

    showNext();

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


/*
    Admin : tous les comptes créés, avec suppression directe
    (voir admin-comptes.sql). Le compte admin ne peut pas être supprimé.
*/

let adminAccounts = [];

async function displayAdminAccounts() {

    const list = document.getElementById("admin-accounts-list");

    if (!list) {
        return;
    }

    const { data, error } = await supabaseClient.rpc("admin_list_accounts");

    if (error) {

        console.error(error);

        list.innerHTML = `<p class="error-message">Impossible de charger les comptes (admin-comptes.sql lancé ?).</p>`;

        return;

    }

    adminAccounts = data || [];

    document.getElementById("admin-accounts-count").textContent = `(${adminAccounts.length})`;

    renderAdminAccounts();

}

function renderAdminAccounts() {

    const list = document.getElementById("admin-accounts-list");

    const search = (document.getElementById("admin-accounts-search")?.value || "").trim().toLowerCase();

    const accounts = adminAccounts.filter(
        account => !search || (account.username || "").toLowerCase().includes(search)
    );

    if (accounts.length === 0) {

        list.innerHTML = `<p class="resolve-info">Aucun compte trouvé.</p>`;

        return;

    }

    list.innerHTML = accounts.map(account => {

        const created = account.created_at
            ? new Date(account.created_at).toLocaleDateString("fr-FR")
            : "—";

        const seen = account.last_sign_in_at
            ? "connecté " + (typeof toastTimeLabel === "function" ? toastTimeLabel(account.last_sign_in_at) : "")
            : "jamais connecté";

        return `
            <div class="admin-balance-row admin-account-row" data-account-id="${account.user_id}">
                <div class="admin-account-main">
                    <span class="admin-balance-name">
                        ${escapeHtml(account.username || "—")}
                        ${account.is_admin ? `<span class="admin-account-badge">Admin</span>` : ""}
                    </span>
                    <small>Créé le ${created} · ${seen}</small>
                    <small>${account.group_names ? "👥 " + escapeHtml(account.group_names) : "Aucun groupe"}</small>
                </div>
                <div class="admin-account-actions">
                    <button type="button" class="admin-account-password" data-account-password="${account.user_id}">Mot de passe</button>
                    ${account.is_admin
                        ? ""
                        : `<button type="button" class="admin-account-delete" data-account-delete="${account.user_id}">Supprimer</button>`
                    }
                </div>
            </div>
        `;

    }).join("");

    list.querySelectorAll("[data-account-delete]").forEach(button => {

        button.addEventListener("click", () => adminDeleteAccount(button.dataset.accountDelete, button));

    });

    list.querySelectorAll("[data-account-password]").forEach(button => {

        const account = adminAccounts.find(item => item.user_id === button.dataset.accountPassword);

        button.addEventListener("click", () => adminSetPassword(account?.user_id, account?.username, button));

    });

}


/*
    Admin : demandes « mot de passe oublié » (voir mot-de-passe-oublie.sql).
    Pas de vrai e-mail : l'admin choisit un nouveau mot de passe
    et le donne lui-même au joueur.
*/

async function displayAdminPasswordRequests() {

    const box = document.getElementById("admin-password-requests");

    if (!box) {
        return;
    }

    const { data, error } = await supabaseClient.rpc("admin_list_password_resets");

    if (error) {

        console.error("Demandes de mot de passe indisponibles (mot-de-passe-oublie.sql lancé ?)", error);

        box.classList.add("hidden");

        return;

    }

    const requests = data || [];

    box.classList.toggle("hidden", requests.length === 0);

    box.innerHTML = `
        <strong>🔑 Mot de passe oublié (${requests.length})</strong>
        ${requests.map(request => `
            <div class="admin-balance-row admin-account-row">
                <div class="admin-account-main">
                    <span class="admin-balance-name">${escapeHtml(request.username || "—")}</span>
                    <small>Demandé ${typeof toastTimeLabel === "function" ? toastTimeLabel(request.created_at) : ""}</small>
                </div>
                <div class="admin-account-actions">
                    <button type="button" class="admin-account-password" data-reset-user="${request.user_id}">Nouveau mot de passe</button>
                    <button type="button" class="admin-account-delete" data-reset-dismiss="${request.user_id}">Ignorer</button>
                </div>
            </div>
        `).join("")}
    `;

    box.querySelectorAll("[data-reset-user]").forEach(button => {

        const request = requests.find(item => item.user_id === button.dataset.resetUser);

        button.addEventListener("click", () => adminSetPassword(request.user_id, request.username, button));

    });

    box.querySelectorAll("[data-reset-dismiss]").forEach(button => {

        button.addEventListener("click", async () => {

            button.disabled = true;

            const { error: dismissError } = await supabaseClient.rpc("admin_dismiss_password_reset", {
                p_user: button.dataset.resetDismiss
            });

            if (dismissError) {

                console.error(dismissError);

                button.disabled = false;

                return;

            }

            await displayAdminPasswordRequests();

        });

    });

}

async function adminSetPassword(userId, username, button) {

    const message = document.getElementById("admin-accounts-message");

    if (!userId) {
        return;
    }

    const password = window.prompt(
        `Nouveau mot de passe pour « ${username} » (4 caractères minimum).\n\n` +
        "Donne-le ensuite au joueur."
    );

    if (password === null) {
        return;
    }

    button.disabled = true;

    message.textContent = "";

    const { error } = await supabaseClient.rpc("admin_set_password", {
        p_user: userId,
        p_password: password
    });

    button.disabled = false;

    if (error) {

        message.className = "admin-balance-message error";

        message.textContent = error.message || "Changement impossible.";

        return;

    }

    message.className = "admin-balance-message success";

    message.textContent = `Mot de passe de « ${username} » changé : « ${password} ».`;

    await displayAdminPasswordRequests();

}

async function adminDeleteAccount(userId, button) {

    const account = adminAccounts.find(item => item.user_id === userId);

    const message = document.getElementById("admin-accounts-message");

    if (!account) {
        return;
    }

    if (!window.confirm(
        `Supprimer définitivement le compte « ${account.username} » ?\n\n` +
        "Il ne pourra plus se connecter et ses mises seront effacées. " +
        "S'il a créé un groupe, un autre membre le reprend."
    )) {
        return;
    }

    button.disabled = true;

    message.textContent = "";

    const { error } = await supabaseClient.rpc("admin_delete_account", { p_user: userId });

    if (error) {

        button.disabled = false;

        message.className = "admin-balance-message error";

        message.textContent = error.message || "Suppression impossible.";

        return;

    }

    message.className = "admin-balance-message success";

    message.textContent = `Compte « ${account.username} » supprimé.`;

    await displayAdminAccounts();

    await displayAdminBalances();

    displayLeaderboard();

}

function setupAdminAccounts() {

    document
        .getElementById("admin-accounts-search")
        ?.addEventListener("input", renderAdminAccounts);

}


/*
    Admin : supprimer des paris terminés de l'historique
    (voir admin-suppression-historique.sql). Soldes et XP inchangés.
    1er clic « Confirmer ? » (4 s), 2e clic supprime.
*/

let adminHistory = [];

async function displayAdminHistory() {

    const select = document.getElementById("admin-history-group");

    const list = document.getElementById("admin-history-list");

    if (!select || !list) {
        return;
    }

    const { data, error } = await supabaseClient.rpc("admin_list_finished_bets");

    if (error) {

        console.error(error);

        list.innerHTML = `<p class="error-message">Impossible de charger l'historique (admin-suppression-historique.sql lancé ?).</p>`;

        return;

    }

    adminHistory = data || [];

    const groups = [...new Map(adminHistory.map(row => [row.group_id, row.group_name])).entries()];

    const previous = select.value;

    select.innerHTML = groups.map(([id, name]) =>
        `<option value="${id}">${escapeHtml(name)}</option>`
    ).join("");

    select.value = groups.some(([id]) => id === previous)
        ? previous
        : currentGroup && groups.some(([id]) => id === currentGroup.id) ? currentGroup.id : groups[0]?.[0] || "";

    if (!select.dataset.ready) {

        select.dataset.ready = "1";

        select.addEventListener("change", renderAdminHistory);

        document.getElementById("admin-history-search").addEventListener("input", renderAdminHistory);

    }

    renderAdminHistory();

}

function renderAdminHistory() {

    const list = document.getElementById("admin-history-list");

    const groupId = document.getElementById("admin-history-group").value;

    const search = document.getElementById("admin-history-search").value.trim().toLowerCase();

    const bets = adminHistory.filter(bet =>
        bet.group_id === groupId &&
        (!search || (bet.question || "").toLowerCase().includes(search))
    );

    document.getElementById("admin-history-count").textContent = `(${bets.length})`;

    if (bets.length === 0) {

        list.innerHTML = `<p class="resolve-info">Aucun pari terminé trouvé.</p>`;

        return;

    }

    list.innerHTML = bets.map(bet => {

        const date = bet.finished_at
            ? new Date(bet.finished_at).toLocaleDateString("fr-FR")
            : "—";

        const state = bet.status === "cancelled" ? "🚫 Annulé" : "✅ Validé";

        const players = `${bet.players} joueur${bet.players > 1 ? "s" : ""} · ${formatMoney(bet.total_staked)} misés`;

        const combos = bet.combos > 0 ? ` · dans ${bet.combos} combiné${bet.combos > 1 ? "s" : ""}` : "";

        return `
            <div class="admin-balance-row admin-account-row">
                <div class="admin-account-main">
                    <span class="admin-history-question">${escapeHtml(bet.question || "—")}</span>
                    <small>${state} le ${date} · créé par ${escapeHtml(bet.author_name || "—")}</small>
                    <small>${players}${combos}</small>
                    ${bet.blocker ? `<small class="admin-history-blocker">⚠️ ${escapeHtml(bet.blocker)}</small>` : ""}
                </div>
                <div class="admin-account-actions">
                    ${bet.blocker
                        ? ""
                        : `<button type="button" class="admin-account-delete" data-history-delete="${bet.bet_id}">Supprimer</button>`
                    }
                </div>
            </div>
        `;

    }).join("");

    list.querySelectorAll("[data-history-delete]").forEach(button => {

        button.addEventListener("click", () => adminDeleteBet(button.dataset.historyDelete, button));

    });

}

async function adminDeleteBet(betId, button) {

    const message = document.getElementById("admin-history-message");

    if (!button.classList.contains("confirm")) {

        button.classList.add("confirm");

        button.textContent = "Confirmer ?";

        setTimeout(() => {

            if (button.isConnected && !button.disabled) {

                button.classList.remove("confirm");

                button.textContent = "Supprimer";

            }

        }, 4000);

        return;

    }

    button.disabled = true;

    message.textContent = "";

    const bet = adminHistory.find(item => item.bet_id === betId);

    const { error } = await supabaseClient.rpc("admin_delete_bet", { p_bet_id: betId });

    if (error) {

        button.disabled = false;

        message.className = "admin-balance-message error";

        message.textContent = error.message || "Suppression impossible.";

        return;

    }

    message.className = "admin-balance-message success";

    message.textContent = `Pari « ${bet?.question || ""} » supprimé de l'historique.`;

    await displayAdminHistory();

    displayMyBets();

}


/*
    Admin : stats de tous les joueurs, groupe par groupe (voir admin-stats.sql) :
    XP et flammes (communes à tous les groupes), solde et points (du groupe).
*/

let adminBalances = [];


/*
    Admin : retirer le même montant à tous les joueurs d'un groupe
    (admin-soustraction-groupe.sql). 1er clic « Confirmer ? », 2e clic retire.
*/

function setupAdminSubtract(groups) {

    const select = document.getElementById("admin-subtract-group");

    const button = document.getElementById("admin-subtract-button");

    if (!select || !button) {
        return;
    }

    const previous = select.value;

    select.innerHTML = groups.map(([id, name]) =>
        `<option value="${id}">${escapeHtml(name)}</option>`
    ).join("");

    select.value = groups.some(([id]) => id === previous)
        ? previous
        : currentGroup && groups.some(([id]) => id === currentGroup.id) ? currentGroup.id : groups[0]?.[0] || "";

    if (button.dataset.ready) {
        return;
    }

    button.dataset.ready = "1";

    const resetButton = () => {
        button.classList.remove("confirm");
        button.textContent = "Retirer à tous";
    };

    // Changer de groupe ou de montant annule la confirmation en cours.
    select.addEventListener("change", resetButton);

    document.getElementById("admin-subtract-amount").addEventListener("input", resetButton);

    button.addEventListener("click", async () => {

        const message = document.getElementById("admin-subtract-message");

        const amount = Number(document.getElementById("admin-subtract-amount").value);

        const groupName = select.options[select.selectedIndex]?.textContent || "";

        message.textContent = "";

        if (!Number.isInteger(amount) || amount <= 0) {
            message.className = "admin-balance-message error";
            message.textContent = "Entre un montant entier positif.";
            return;
        }

        if (!button.classList.contains("confirm")) {

            button.classList.add("confirm");

            button.textContent = `Confirmer −${formatMoney(amount)} pour « ${groupName} » ?`;

            setTimeout(() => {
                if (button.classList.contains("confirm") && !button.disabled) {
                    resetButton();
                }
            }, 5000);

            return;

        }

        button.disabled = true;

        const { data, error } = await supabaseClient.rpc("admin_subtract_group", {
            p_group: select.value,
            p_amount: amount
        });

        button.disabled = false;

        resetButton();

        if (error) {
            message.className = "admin-balance-message error";
            message.textContent = error.message || "Retrait impossible.";
            return;
        }

        const result = Array.isArray(data) ? data[0] : data;

        message.className = "admin-balance-message success";

        message.textContent = `${result?.players || 0} joueur(s) touché(s) dans « ${groupName} », ${formatMoney(Number(result?.total || 0))} retirés au total.`;

        await displayAdminBalances();

        displayLeaderboard();

    });

}

async function displayAdminBalances() {

    const select = document.getElementById("admin-balance-group");

    const list = document.getElementById("admin-balance-list");

    if (!select || !list) {
        return;
    }

    const { data, error } = await supabaseClient.rpc("admin_list_stats");

    if (error) {

        console.error(error);

        list.innerHTML = `<p class="error-message">Impossible de charger les stats (admin-stats.sql lancé ?).</p>`;

        return;

    }

    adminBalances = data || [];

    const groups = [...new Map(adminBalances.map(row => [row.group_id, row.group_name])).entries()];

    setupAdminSubtract(groups);

    fillPollGroups(groups);

    const previous = select.value;

    select.innerHTML = groups.map(([id, name]) =>
        `<option value="${id}">${escapeHtml(name)}</option>`
    ).join("");

    select.value = groups.some(([id]) => id === previous)
        ? previous
        : currentGroup && groups.some(([id]) => id === currentGroup.id) ? currentGroup.id : groups[0]?.[0] || "";

    if (!select.dataset.ready) {

        select.dataset.ready = "1";

        select.addEventListener("change", renderAdminBalances);

        list.addEventListener("click", event => {

            const button = event.target.closest("[data-save-balance]");

            if (button) {
                saveAdminBalance(button);
            }

        });

        list.addEventListener("keydown", event => {

            if (event.key === "Enter" && event.target.matches(".admin-balance-input")) {
                event.target.closest(".admin-balance-row").querySelector("[data-save-balance]").click();
            }

        });

        // Le niveau suit l'XP tapée, avant même d'enregistrer.
        list.addEventListener("input", event => {

            if (event.target.matches("[data-stat='xp']")) {

                const level = event.target.closest(".admin-stat").querySelector(".admin-stat-level");

                level.textContent = "Niv. " + adminLevelOf(event.target.value);

            }

        });

    }

    renderAdminBalances();

}


function adminLevelOf(xp) {

    return typeof levelFromXp === "function"
        ? levelFromXp(Math.max(0, Number(xp) || 0)).level
        : "?";

}


function renderAdminBalances() {

    const groupId = document.getElementById("admin-balance-group").value;

    const rows = adminBalances.filter(row => row.group_id === groupId);

    const field = (stat, label, value, unit, extra = "") => `
        <label class="admin-stat">
            <span class="admin-stat-label">${label}${extra}</span>
            <span class="admin-stat-field">
                <input
                    type="number"
                    class="admin-balance-input"
                    data-stat="${stat}"
                    min="0"
                    step="1"
                    value="${value}"
                >
                <span class="admin-balance-unit">${unit}</span>
            </span>
        </label>
    `;

    document.getElementById("admin-balance-list").innerHTML = rows.length
        ? rows.map(row => `
            <div class="admin-balance-row admin-stats-row">
                <span class="admin-balance-name" title="${escapeHtml(row.username)}">👤 ${escapeHtml(row.username)}</span>
                <div class="admin-stats-fields">
                    ${field("xp", "XP", row.xp, "XP", ` · <span class="admin-stat-level">Niv. ${adminLevelOf(row.xp)}</span>`)}
                    ${field("streak", "Flammes", row.streak_days, "🔥")}
                    ${field("balance", "Solde", Math.round(Number(row.balance)), "€")}
                    ${field("points", "Points", row.points, "🪙")}
                    ${field("diamonds", "Diamants", row.diamonds ?? 0, "💎")}
                </div>
                <button
                    type="button"
                    class="primary-button"
                    data-save-balance="${row.user_id}"
                >
                    Enregistrer
                </button>
            </div>
        `).join("")
        : `<div class="empty-state">Aucun joueur dans ce groupe.</div>`;

}


async function saveAdminBalance(button) {

    const groupId = document.getElementById("admin-balance-group").value;

    const userId = button.dataset.saveBalance;

    const line = button.closest(".admin-balance-row");

    const message = document.getElementById("admin-balance-message");

    const value = stat => Number(line.querySelector(`[data-stat="${stat}"]`).value);

    const stats = {
        xp: value("xp"),
        streak: value("streak"),
        balance: value("balance"),
        points: value("points"),
        diamonds: value("diamonds")
    };

    const row = adminBalances.find(r => r.group_id === groupId && r.user_id === userId);

    if (Object.values(stats).some(number => !Number.isFinite(number) || number < 0)) {

        message.textContent = "Entre des nombres positifs.";

        message.classList.add("error");

        return;

    }

    button.disabled = true;

    const { error } = await supabaseClient.rpc("admin_set_stats", {
        p_group: groupId,
        p_user: userId,
        p_balance: Math.round(stats.balance),
        p_points: Math.round(stats.points),
        p_streak: Math.round(stats.streak),
        p_xp: Math.round(stats.xp)
    });

    // Diamants (communs à tous les groupes) : seulement s'ils ont changé.
    let diamondError = null;

    if (!error && row && Math.round(stats.diamonds) !== Number(row.diamonds ?? 0)) {

        ({ error: diamondError } = await supabaseClient.rpc("admin_set_diamonds", {
            p_user: userId,
            p_diamonds: Math.round(stats.diamonds)
        }));

    }

    button.disabled = false;

    if (error || diamondError) {

        message.textContent = (error || diamondError).message || "Impossible de modifier ces stats.";

        message.classList.add("error");

        return;

    }

    message.classList.remove("error");

    message.textContent = "✓ Stats de " + (row ? row.username : "ce joueur") + " enregistrées.";

    // XP et flammes sont communes à tous ses groupes : la liste est rechargée.
    await displayAdminBalances();

    // Le classement du groupe en cours suit.
    if (currentGroup && currentGroup.id === groupId && typeof displayLeaderboard === "function") {
        displayLeaderboard();
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


    // Champ vide : on enregistre un message vide, ce qui retire la fenêtre
    // du message permanent pour tout le monde (l'historique est gardé).
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
            stakes ( id, user_id, choice_id, stake, potential_win, claimed_at, created_at, profiles!stakes_user_id_fkey ( username, gold_frame_until, name_color_until, cosmetics ) ),
            bet_contests ( status, ends_at ),
            bet_commissions ( user_id, amount, claimed_at, reversed_at ),
            combo_legs ( choice_id, combos ( user_id, stake, odds, potential_win, created_at, profiles ( username, gold_frame_until, name_color_until, cosmetics ), combo_legs ( bet_id, choice_id, odds, bets ( status, winner_choice_id ) ) ) )
        `)
        .eq("group_id", currentGroup?.id)
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



/*
    Échéance d'un pari : les mises ferment avant la date d'échéance
    (la carte se grise), selon la durée totale du pari (création → échéance) :
    - plus de 1 h 30 : 1 h avant ;
    - de 30 min à 1 h 30 : 15 min avant (ex. publié à 8 h pour 9 h → fermé à 8 h 45) ;
    - 30 min ou moins (pari express) : 5 min avant.
    Carte rouge : 2 h avant l'échéance pour un pari classique (« Last Chance ») ;
    dès la publication pour un pari Short ou Hyper short.
    Même règle côté base : bet_close_interval() dans cloture-courte.sql.
*/

function betCloseMs(createdAt, deadlineAt) {

    const duration =
        createdAt && deadlineAt
            ? new Date(deadlineAt) - new Date(createdAt)
            : Infinity;

    if (duration > 90 * 60000) return 60 * 60000;

    if (duration > 30 * 60000) return 15 * 60000;

    return 5 * 60000;

}

// Temps avant l'échéance à partir duquel la carte devient rouge.
function betUrgentMs(closeMs) {

    return closeMs < 60 * 60000 ? Infinity : 2 * closeMs;

}


/*
    Apparence de la carte rouge selon le type de pari (voir demo-halo-urgence.html) :
    Last Chance (fermé 1 h avant), Short (15 min avant) ou Hyper short (5 min avant).
*/

function betUrgencyStyle(closeMs) {

    if (closeMs <= 5 * 60000) return { label: "HYPER SHORT", className: "bet-card-hyper" };

    if (closeMs <= 15 * 60000) return { label: "SHORT", className: "bet-card-short" };

    return { label: "LAST CHANCE", className: "" };

}


// Étiquette en haut de la carte : « Trop tard » (mises closes), « Last Chance » / « Short » / « Hyper short » (carte rouge) ou « New » (créé aujourd'hui).
function betBadgeLabel(bet) {

    if (isBetClosed(bet)) {

        return "TROP TARD";

    }

    const closeMs =
        betCloseMs(bet.created_at, bet.deadline_at);

    if (bet.deadline_at && new Date(bet.deadline_at) - Date.now() <= betUrgentMs(closeMs)) {

        return betUrgencyStyle(closeMs).label;

    }

    return isCreatedToday(bet.created_at) ? "NEW" : "";

}


function isBetClosed(bet) {

    return Boolean(
        bet.deadline_at &&
        new Date(bet.deadline_at) - Date.now() <= betCloseMs(bet.created_at, bet.deadline_at)
    );

}


function renderBetSummaryHtml(
    bet,
    {
        interactive = true,
        validating = false,
        headerExtra = "",
        beforeChoices = ""
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
        isBetClosed(bet);


    const deadlineLabel =
        formatCardDeadline(bet.deadline_at) ||
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




    return `

        <div class="bet-card-header">

            <span>🏆</span>

            <span class="bet-author">
                Créé par ${styledName(bet.profiles)}
            </span>

            ${headerExtra}

        </div>


        <div class="bet-question-row">

            <span class="bet-question-icon">🎲</span>

            <h3>
                ${escapeHtml(bet.question)}
            </h3>

            <span class="bet-deadline"${bet.deadline_at ? ` data-deadline="${escapeHtml(bet.deadline_at)}"` : ""}>
                ${escapeHtml(deadlineLabel)}
            </span>

        </div>




        ${beforeChoices}

        <div class="bet-choices">

            ${stakesByChoice.map(
                ({ choice, amount }) => {

                    const pct =
                        totalStaked > 0
                            ? Math.round((amount / totalStaked) * 100)
                            : 0;

                    const tag =
                        interactive
                            ? "button"
                            : "div";

                    // Cote de 8 ou plus : la case rougeoie et lâche des étincelles (animations.js).
                    const onFire =
                        Number(choice.odds) >= ODDS_FIRE_FROM &&
                        !validating &&
                        !isClosed &&
                        !isTargetBlocked;

                    return `

                        <div class="bet-choice-wrapper">

                            <${tag}
                                data-odds="${Number(choice.odds)}"
                                class="bet-choice-button${onFire ? " odds-fire" : ""}${!validating && (isClosed || isTargetBlocked) ? " bet-choice-closed" : ""}${myChoiceIds.includes(choice.id) ? " bet-choice-picked" : ""}${interactive ? "" : " bet-choice-readonly"}${validating ? " bet-choice-validate" : ""}${validating && cardValidation?.pick === choice.id ? " validate-selected" : ""}"
                                ${interactive
                                    ? `data-bet-id="${bet.id}" data-choice-id="${choice.id}" ${!validating && (isClosed || isTargetBlocked) ? "disabled" : ""}`
                                    : ""
                                }
                            >

                                <span>
                                    ${escapeHtml(choice.label)}
                                </span>

                                <strong>
                                    ${oddsText(choice.odds)}
                                </strong>

                                ${oddsMoveHtml(choice)}

                            </${tag}>

                            ${onFire
                                ? `<canvas class="odds-embers" aria-hidden="true"></canvas>`
                                : ""
                            }

                            ${isTargetBlocked
                                ? ""
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



/*
    Carte d'un pari validé à récupérer (page principale).
    Un clic solde mes mises : gain ajouté au solde, ou mise perdue.
*/

function renderClaimCard(bet) {

    const myStakes =
        bet.stakes.filter(
            s => s.user_id === currentUser.id && !s.claimed_at
        );

    const won =
        myStakes.some(s => s.choice_id === bet.winner_choice_id);

    const amount = won
        ? myStakes
            .filter(s => s.choice_id === bet.winner_choice_id)
            .reduce((sum, s) => sum + Number(s.potential_win), 0)
        : myStakes.reduce((sum, s) => sum + Number(s.stake), 0);

    const winner =
        (bet.bet_choices || []).find(c => c.id === bet.winner_choice_id);


    const card =
        document.createElement("div");


    // Contestation en cours : gains bloqués, la carte ouvre le vote.
    if (betContest(bet)?.status === "open") {

        card.className = "bet-card claim-card claim-card--frozen";

        card.dataset.betId = bet.id;

        card.innerHTML = `

            <div class="claim-card-top">
                <span class="claim-card-badge">⚖️ Contestation en cours</span>
                <span class="claim-card-result">Résultat validé : <b>${escapeHtml(winner?.label || "—")}</b></span>
            </div>

            <h3>${escapeHtml(bet.question)}</h3>

            <button class="claim-card-button">
                🔒 Gains bloqués pendant le vote · fin ${timeLeftLabel(betContest(bet).ends_at)}
            </button>

        `;

        card.addEventListener("click", async () => {

            await refreshContests();

            openContestView(bet.id);

        });

        return card;

    }


    card.className =
        "bet-card claim-card " + (won ? "claim-card--win" : "claim-card--lose");

    card.dataset.betId = bet.id;

    card.innerHTML = `

        <div class="claim-card-top">
            <span class="claim-card-badge">${won ? "🏆 Pari gagné" : "Pari perdu"}</span>
            <span class="claim-card-result">Résultat : <b>${escapeHtml(winner?.label || "—")}</b></span>
        </div>

        <h3>${escapeHtml(bet.question)}</h3>

        <button class="claim-card-button">
            ${won ? "💰 Récupérer " + formatMoney(amount) : "Perdre la mise (" + formatMoney(amount) + ")"}
        </button>

    `;

    card.addEventListener("click", () => claimBet(bet.id, won, card));

    return card;

}


/*
    Commission du créateur encore à récupérer sur ce pari
    (0 s'il n'y en a pas). Voir commission-createur.sql.
*/

function myCommission(bet) {

    const row = Array.isArray(bet.bet_commissions)
        ? bet.bet_commissions[0]
        : bet.bet_commissions;

    return row &&
        row.user_id === currentUser?.id &&
        !row.claimed_at &&
        !row.reversed_at
        ? Number(row.amount)
        : 0;

}


/*
    Carte jaune « Ta commission » : le créateur récupère ses 10 %
    des mises perdues, comme un gain. Bloquée pendant une contestation.
*/

function renderCommissionCard(bet) {

    const amount =
        myCommission(bet);

    const winner =
        (bet.bet_choices || []).find(c => c.id === bet.winner_choice_id);

    const card =
        document.createElement("div");

    // Clé distincte de la carte « gagné / perdu » du même pari.
    card.dataset.betId = "commission-" + bet.id;


    if (betContest(bet)?.status === "open") {

        card.className = "bet-card claim-card claim-card--commission claim-card--frozen";

        card.innerHTML = `

            <div class="claim-card-top">
                <span class="claim-card-badge">💼 Commission bloquée</span>
                <span class="claim-card-result">Résultat validé : <b>${escapeHtml(winner?.label || "—")}</b></span>
            </div>

            <h3>${escapeHtml(bet.question)}</h3>

            <button class="claim-card-button">
                🔒 Contestation en cours · fin ${timeLeftLabel(betContest(bet).ends_at)}
            </button>

        `;

        card.addEventListener("click", async () => {

            await refreshContests();

            openContestView(bet.id);

        });

        return card;

    }


    card.className = "bet-card claim-card claim-card--commission";

    card.innerHTML = `

        <div class="claim-card-top">
            <span class="claim-card-badge">💼 Ta commission</span>
            <span class="claim-card-result">Résultat : <b>${escapeHtml(winner?.label || "—")}</b></span>
        </div>

        <h3>${escapeHtml(bet.question)}</h3>

        <p class="claim-card-note">10 % des mises perdues sur ton pari</p>

        <button class="claim-card-button">
            💰 Récupérer ${formatMoney(amount)}
        </button>

    `;

    card.addEventListener("click", () => claimBet(bet.id, true, card, "claim_commission"));

    return card;

}


/*
    rpcName : claim_bet (mes mises) ou claim_commission (ma commission
    de créateur, jouée comme un gain).
*/

async function claimBet(betId, won, card, rpcName = "claim_bet") {

    if (card.classList.contains("claiming")) {
        return;
    }

    card.classList.add("claiming");


    const oldBalance =
        Number(currentProfile?.balance || 0);

    const { data, error } =
        await supabaseClient.rpc(
            rpcName,
            rpcName === "claim_combo"
                ? { p_combo: betId }
                : { p_bet_id: betId }
        );

    if (error) {

        console.error(error);

        card.classList.remove("claiming");

        alertToast(escapeHtml(error.message || "Impossible de récupérer ce pari."));

        return;

    }


    await loadCurrentProfile();

    // Durée des confettis (0 si perdu), pour enchaîner la suite.
    let confettiMs = 0;

    if (won) {

        // 1. Confettis. Le solde affiche encore l'ancien montant.
        animateNumber(document.getElementById("balance"), oldBalance, oldBalance, 0, formatBalance);

        const newBalance = Number(currentProfile.balance);

        confettiMs = launchConfetti();

        // 2. Une fois les confettis tombés : le perroquet passe en
        // « gagné » et les billets volent vers le solde, qui monte
        // à chaque billet encaissé.
        setTimeout(() => {

            Parrot.win();

            flyBills("win", oldBalance, newBalance);

        }, confettiMs);

        card.classList.add("claim-card--done-win");

    } else {

        card.classList.add("claim-card--done-lose");

        Parrot.lose();

        // Les billets quittent le solde et tombent sur le perroquet.
        flyBills("lose");

    }


    // Le classement ne s'anime qu'après la pose « gagné » / « perdu »
    // du perroquet (confettis éventuels + durée de la pose).
    const parrotPoseEnd =
        confettiMs + Parrot.HOLD_SECONDS * 1000;

    window.leaderboardHoldUntil =
        performance.now() + parrotPoseEnd;

    setTimeout(() => displayLeaderboard(), parrotPoseEnd + 200);


    // Laisse l'animation se jouer avant de recharger les listes.
    setTimeout(async () => {

        // Mise à jour discrète : la carte récupérée a déjà disparu, les autres remontent en douceur.
        await displayBets({ quiet: true });

        await displayMyBets();

        await refreshMissions();

    }, won ? confettiMs + 2800 : 2400);

}


/* =========================================================
   BROUILLON : LE CRÉATEUR MISE POUR PUBLIER
   Un pari créé reste un brouillon visible par son créateur seul
   (voir brouillon-createur.sql). Il clique sa cote, la fenêtre
   de mise habituelle s'ouvre, et sa mise publie le pari.
========================================================= */

function isMyDraft(bet) {

    return Boolean(
        currentUser &&
        bet.author_id === currentUser.id &&
        bet.status === "draft"
    );

}

function renderDraftCard(bet) {

    const card =
        document.createElement("div");

    card.className =
        "bet-card bet-card-draft";

    card.dataset.draftId =
        bet.id;

    card.innerHTML =
        renderBetSummaryHtml(bet, {
            headerExtra: `<span class="draft-tag">Brouillon · visible par toi seul</span>`
        }) + `

        ${isBetClosed(bet)
            ? `<div class="draft-banner draft-banner--closed">⏳ Échéance trop proche : ce brouillon ne peut plus être publié.</div>`
            : `<div class="draft-banner">👆 Mise sur une réponse pour publier le pari</div>`
        }

        <div class="bet-footer">

            <button type="button" class="draft-delete">🗑 Supprimer le brouillon</button>

        </div>
    `;

    card
        .querySelector(".draft-delete")
        .addEventListener("click", () => deleteDraft(bet, card));

    return card;

}

// Brouillons en train de partir : la liste ne se redessine pas pendant leur animation.
let leavingDrafts = 0;

/*
    Suppression directe, sans fenêtre de confirmation du navigateur.
    La carte glisse vers la gauche en s'effaçant, puis sa place se referme :
    les cartes du dessous remontent en douceur.
*/

async function deleteDraft(bet, card) {

    if (card.classList.contains("deleting")) {
        return;
    }

    card.classList.add("deleting");

    leavingDrafts++;

    const slide = card.animate(
        [
            { opacity: 1, transform: card.style.transform || "none" },
            { opacity: 0, transform: "translateX(-70px) rotate(-2deg)" }
        ],
        { duration: 340, easing: "cubic-bezier(.4,0,.7,.2)", fill: "forwards" }
    );

    const [{ error }] = await Promise.all([
        supabaseClient.rpc("delete_draft_bet", { p_bet_id: bet.id }),
        slide.finished.catch(() => {})
    ]);

    if (error) {

        console.error(error);

        // Échec : la carte revient à sa place.
        slide.reverse();

        await slide.finished.catch(() => {});

        slide.cancel();

        card.classList.remove("deleting");

        leavingDrafts--;

        alertToast(escapeHtml(error.message || "Impossible de supprimer le brouillon."));

        return;

    }


    // La place de la carte (et l'espace sous elle) se referme.
    const gap = parseFloat(getComputedStyle(card.parentElement).rowGap) || 0;

    card.style.overflow = "hidden";

    await card.animate(
        [
            { height: card.offsetHeight + "px", marginBottom: "0px", paddingTop: getComputedStyle(card).paddingTop, paddingBottom: getComputedStyle(card).paddingBottom },
            { height: "0px", marginBottom: -gap + "px", paddingTop: "0px", paddingBottom: "0px" }
        ],
        { duration: 300, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
    ).finished.catch(() => {});

    card.remove();

    leavingDrafts--;

    await displayBets({ quiet: true, force: true });

    await displayMyBets();

}



/* =========================================================
   VALIDER UN PARI DIRECTEMENT SUR LA CARTE
   Le créateur voit un petit bouton « ✓ Valider » sur sa carte.
   Il met la carte en mode validation : on clique la cote gagnante,
   le bilan (gagnants / perdants) s'affiche, puis on valide.
========================================================= */

// Carte en cours de validation : { betId, pick (id du choix gagnant ou null) }
let cardValidation = null;

// Changement de mode en cours, pour faire fondre la couleur de la carte :
// { betId, to: true (entrée) | false (sortie) }
let validationFade = null;

// Éléments du mode validation déjà affichés (évite de rejouer leur apparition
// quand la carte est redessinée après le choix d'une cote).
let validationRevealed = { betId: null, hint: false, bilan: false };

/*
    Le bouton se déplie seulement quand la souris est à proximité
    (et pas dès qu'elle survole la carte).
*/

const VALIDATE_FAB_REACH = 22;

let validatePointer = null;

/*
    Marque « near » les boutons dont la souris est proche. Appelée aussi juste
    après chaque rafraîchissement de la liste : le bouton redessiné garde ainsi
    son état déplié (ou replié) sans animation parasite.
*/

function updateValidateFabs() {

    document.querySelectorAll(".validate-fab").forEach(fab => {

        if (!validatePointer) {

            fab.classList.remove("near");

            return;

        }

        // Zone mesurée autour du centre du bouton, indépendante de sa largeur du
        // moment : étroite pour le déplier, large pour le garder déplié. Sans ça le
        // bouton se replie puis se redéplie quand la souris est sur sa partie dépliée.
        const rect = fab.getBoundingClientRect();

        const centerX = rect.left + rect.width / 2;

        const centerY = rect.top + rect.height / 2;

        const halfWidth = fab.classList.contains("near") ? 75 : 15;

        const dx = Math.max(Math.abs(validatePointer.x - centerX) - halfWidth, 0);

        const dy = Math.max(Math.abs(validatePointer.y - centerY) - 15, 0);

        fab.classList.toggle("near", Math.hypot(dx, dy) <= VALIDATE_FAB_REACH);

    });

}

function setupValidateFabProximity() {

    let waiting = false;

    // Seule une vraie souris déplie la pastille : au doigt (téléphone), le toucher
    // passe directement la carte en validation, sans étape « Valider » dépliée.
    document.addEventListener("pointermove", event => {

        if (event.pointerType !== "mouse") {
            return;
        }

        validatePointer = { x: event.clientX, y: event.clientY };

        if (!waiting) {

            waiting = true;

            requestAnimationFrame(() => {

                waiting = false;

                updateValidateFabs();

            });

        }

    });

    document.addEventListener("mouseleave", () => {

        validatePointer = null;

        updateValidateFabs();

    });


    // Téléphone : pas de souris, le dernier toucher reste la « position » du
    // pointeur et la pastille restait dépliée sur « Valider ». Elle redevient
    // ronde dès qu'on touche ailleurs que sur sa carte ou qu'on fait défiler.
    const releaseOnPhone = event => {

        if (!PHONE_LAYOUT.matches || !validatePointer) {
            return;
        }

        if (event.type === "touchstart" && event.target.closest?.(".bet-card")?.querySelector(".validate-fab.near")) {
            return;
        }

        validatePointer = null;

        updateValidateFabs();

    };

    document.addEventListener("touchstart", releaseOnPhone, { passive: true });

    window.addEventListener("scroll", releaseOnPhone, { passive: true });

}


// Pari ouvert que je peux valider : le mien, ou n'importe lequel pour l'admin.
function isMyOpenBet(bet) {

    return Boolean(
        currentUser &&
        (bet.author_id === currentUser.id || currentProfile?.is_admin) &&
        bet.status === "open"
    );

}

/*
    Pastille rouge « Supprimer » (carte ou carte dépliée) : un premier clic
    demande confirmation, le second supprime. Renvoie true si le pari est supprimé.
*/

async function deleteBetFromFab(button) {

    if (!button.classList.contains("confirm")) {

        button.classList.add("confirm");

        button.querySelector("span").textContent = "Confirmer ?";

        // Sans second clic, la pastille revient à « Supprimer ».
        setTimeout(() => {

            button.classList.remove("confirm");

            button.querySelector("span").textContent = "Supprimer";

        }, 4000);

        return false;

    }

    button.disabled = true;

    const { data, error } = await supabaseClient.rpc("delete_expired_bet", {
        p_bet_id: button.dataset.deleteBet
    });

    if (error) {

        alertToast(escapeHtml(error.message || "Impossible de supprimer ce pari."));

        button.disabled = false;

        return false;

    }

    alertToast(
        Number(data) > 0
            ? `🗑 Pari supprimé, ta mise de ${formatMoney(Number(data))} t'est remboursée.`
            : "🗑 Pari supprimé.",
        { type: "create" }
    );

    await loadCurrentProfile();

    displayBets({ quiet: true });

    return true;

}


/*
    Pari publié sans autre parieur que son créateur, avant ou après la fin
    des mises : son créateur (ou l'admin) peut le supprimer, sa mise lui est
    remboursée (voir suppression-pari-sans-parieur.sql).
*/

function canDeleteExpiredBet(bet) {

    return Boolean(
        currentUser &&
        bet.status === "open" &&
        // Plus besoin d'attendre la fin des mises (suppression-pari-sans-parieur.sql).
        (bet.author_id === currentUser.id || currentProfile?.is_admin) &&
        !hasOtherStake(bet) &&
        !(bet.combo_legs || []).length
    );

}

/*
    Un autre joueur que le créateur a misé : le pari devient validable
    (sinon le créateur pourrait miser puis valider aussitôt).
    Même règle côté base : resolve_bet dans validation-autre-joueur.sql.
*/

function hasOtherStake(bet) {

    return (bet.stakes || []).some(
        stake => stake.user_id !== bet.author_id
    ) || (bet.combo_legs || []).some(
        // Une mise en combiné compte aussi (combines.sql).
        leg => leg.combos && leg.combos.user_id !== bet.author_id
    );

}

/*
    Commission du créateur si ce choix gagne : 10 % des mises perdues,
    arrondi à l'euro (ses propres mises ne comptent pas).
    Même calcul côté base : resolve_bet dans commission-createur.sql.
*/

const CREATOR_COMMISSION_RATE = 0.10;

function creatorCommission(bet, winnerChoiceId, stakes = bet.stakes || []) {

    const lost = stakes
        .filter(stake => stake.choice_id !== winnerChoiceId && stake.user_id !== bet.author_id)
        .reduce((total, stake) => total + Number(stake.stake), 0);

    return Math.round(lost * CREATOR_COMMISSION_RATE);

}

function commissionLineHtml(amount, mine = true) {

    return `
        <div class="validate-commission">
            <span>💼 ${mine ? "Ta commission" : "Commission du créateur"} <small>10 % des mises perdues</small></span>
            <b>+${formatMoney(amount)}</b>
        </div>
    `;

}

/*
    Bilan si ce choix gagne : une ligne par joueur et par choix,
    gagnants avec leur gain, perdants avec leur mise perdue,
    puis la commission du créateur.
*/

function validationBilanHtml(bet, winnerChoiceId) {

    const groups = groupStakesByPlayer(bet.stakes || []);

    const winners = groups.filter(group => group.choiceId === winnerChoiceId);

    const losers = groups.filter(group => group.choiceId !== winnerChoiceId);

    const sum = (group, field) =>
        group.stakes.reduce((total, stake) => total + Number(stake[field]), 0);

    const winnerLines = winners.map(group => `
        <div class="validate-line">
            <span>${styledName(group.profiles)}</span>
            <span class="validate-win">+${formatMoney(sum(group, "potential_win"))}</span>
        </div>
    `).join("");

    const loserLines = losers.map(group => `
        <div class="validate-line">
            <span>${styledName(group.profiles)}</span>
            <span class="validate-lose">−${formatMoney(sum(group, "stake"))}</span>
        </div>
    `).join("");


    /*
        Combinés qui contiennent ce pari : état du combiné si ce choix gagne
        (gagné, toujours en course, ou perdu). Ceux déjà perdus sur un autre
        pari ne changent pas et ne sont pas listés.
    */
    const comboWins = [];

    const comboLoses = [];

    (bet.combo_legs || []).filter(leg => leg.combos).forEach(leg => {

        const combo = leg.combos;

        const otherLegs = (combo.combo_legs || []).filter(item => item.bet_id !== bet.id);

        if (comboState({ stake: combo.stake, combo_legs: otherLegs }).status === "lost") {
            return;
        }

        const after = comboState({
            stake: combo.stake,
            combo_legs: [
                ...otherLegs,
                {
                    choice_id: leg.choice_id,
                    odds: (combo.combo_legs || []).find(item => item.bet_id === bet.id)?.odds || 1,
                    bets: { status: "resolved", winner_choice_id: winnerChoiceId }
                }
            ]
        });

        // Une seule ligne, comme les mises simples : 🔗 devant le pseudo (légende sous les colonnes).
        const name = `<span class="validate-combo-tag" title="En combiné">🔗</span>${styledName(combo.profiles)}`;

        if (after.status === "lost") {

            comboLoses.push(`
                <div class="validate-line validate-line--combo">
                    <span>${name}</span>
                    <span class="validate-lose">−${formatMoney(combo.stake)}</span>
                </div>
            `);

        } else {

            comboWins.push(`
                <div class="validate-line validate-line--combo">
                    <span>${name}</span>
                    ${after.status === "open"
                        ? `<span class="validate-combo-next" title="Ce pari passe, le combiné continue">✓ suite</span>`
                        : `<span class="validate-win">+${formatMoney(after.payout)}</span>`}
                </div>
            `);

        }

    });

    return `
        <div class="validate-bilan">

            <div class="validate-cols">

                <div class="validate-col validate-col-win">
                    <h4>🏆 Gagnants (${winners.length + comboWins.length})</h4>
                    ${winnerLines + comboWins.join("") || `<small>Personne</small>`}
                </div>

                <div class="validate-col validate-col-lose">
                    <h4>✗ Perdants (${losers.length + comboLoses.length})</h4>
                    ${loserLines + comboLoses.join("") || `<small>Personne</small>`}
                </div>

            </div>

            ${comboWins.length + comboLoses.length
                ? `<p class="validate-combo-legend">🔗 en combiné · « ✓ suite » : ce pari passe, le combiné attend ses autres paris</p>`
                : ""}

            ${commissionLineHtml(creatorCommission(bet, winnerChoiceId), bet.author_id === currentUser.id)}

            <p class="validate-error"></p>

            <button type="button" class="validate-confirm" data-validate-confirm="${bet.id}">
                ✓ Valider le pari
            </button>

        </div>
    `;

}

/*
    Admin : annuler un pari (admin_cancel_bet dans admin-annulation.sql).
    Premier clic « Confirmer ? » (4 s), second clic annule : mises rendues,
    combinés qui le contiennent perdus, joueurs et créateur prévenus.
*/

async function adminCancelBet(betId, button) {

    const errorElement = button.parentElement.querySelector(".validate-admin-error");

    errorElement.textContent = "";

    if (!button.classList.contains("confirm")) {

        button.classList.add("confirm");

        button.textContent = "⚠️ Confirmer l'annulation ?";

        setTimeout(() => {

            if (button.isConnected && !button.disabled) {

                button.classList.remove("confirm");

                button.textContent = "🚫 Annuler le pari (admin)";

            }

        }, 4000);

        return;

    }

    button.disabled = true;

    const { error } = await supabaseClient.rpc("admin_cancel_bet", { p_bet_id: betId });

    if (error) {

        console.error(error);

        errorElement.textContent = error.message || "Impossible d'annuler le pari.";

        button.disabled = false;

        return;

    }

    cardValidation = null;

    await loadCurrentProfile();

    await displayBets({ quiet: true });

    await displayLeaderboard();

    await displayMyBets();

    await displayMyCreatedBets();

}


async function confirmCardValidation(betId, button) {

    if (!cardValidation || cardValidation.betId !== betId || !cardValidation.pick) {

        return;

    }

    const errorElement = button.parentElement.querySelector(".validate-error");

    errorElement.textContent = "";

    button.disabled = true;

    const { error } = await supabaseClient.rpc(
        "resolve_bet",
        {
            p_bet_id: betId,
            p_winner_choice_id: cardValidation.pick
        }
    );

    if (error) {

        console.error(error);

        errorElement.textContent = error.message || "Impossible de valider le pari.";

        button.disabled = false;

        return;

    }

    cardValidation = null;

    await loadCurrentProfile();

    await displayBets({ quiet: true });

    await displayLeaderboard();

    await displayMyBets();

    await displayMyCreatedBets();

    await refreshMissions();

    await checkNewResults();

}


/*
    Empreinte de ce qui est affiché : ne change que si un pari apparaît,
    change de statut ou reçoit une mise. Sert au rafraîchissement en direct.
*/

let betsSignature = null;


let betsRefreshPending = false;

let renderedBetIds = new Set();

let renderedClaimIds = new Set();

function computeBetsSignature(bets) {

    return bets
        .map(bet => [
            bet.id,
            bet.status,
            (bet.bet_choices || []).length,
            (bet.stakes || []).length,
            (bet.stakes || []).reduce((sum, s) => sum + Number(s.stake), 0),
            (bet.stakes || []).filter(s => s.claimed_at).length,
            (bet.combo_legs || []).length,
            myCommission(bet)
        ].join(":"))
        .join("|") + "#" + combosSignature();

}


/*
    Arrivée d'une carte en direct : elle se dévoile de gauche à droite
    pendant qu'un reflet la traverse, et les autres cartes descendent
    en douceur pour lui faire de la place.
    Le dévoilement dépasse un peu de la carte (marges négatives) pour ne
    pas couper la pastille « NEW » ni la lueur autour de la carte.
*/

const LIVE_SPEED = 2;

function animateLiveCards(container, previousTops) {

    const T = ms => ms * LIVE_SPEED;

    const EASE = "cubic-bezier(.2,.8,.2,1)";

    const M = 40;


    // Les cartes déjà présentes glissent vers leur nouvelle place.
    container.querySelectorAll(".bet-card[data-bet-id]").forEach(card => {

        const before = previousTops.get(card.dataset.betId);

        if (before === undefined) {

            return;

        }

        const shift = before - card.getBoundingClientRect().top;

        if (Math.abs(shift) < 2) {

            return;

        }

        card.animate(
            [{ transform: `translateY(${shift}px)` }, { transform: "none" }],
            { duration: T(380), easing: EASE }
        );

    });


    // Carte « pari gagné / perdu » qui arrive : elle descend en fondu, en grossissant à peine.
    container.querySelectorAll(".claim-card-enter").forEach(card => {

        card.classList.remove("claim-card-enter");

        card.animate(
            [
                { opacity: 0, transform: "translateY(-22px) scale(0.95)" },
                { opacity: 1, transform: "translateY(3px) scale(1.01)", offset: 0.65 },
                { opacity: 1, transform: "none" }
            ],
            { duration: T(300), delay: T(80), easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }
        );

    });


    // Les nouvelles cartes se dévoilent.
    container.querySelectorAll(".bet-card-live-in").forEach(card => {

        card.animate(
            [
                { opacity: 0, clipPath: `inset(-${M}px calc(100% + ${M}px) -${M}px -${M}px)` },
                { opacity: 1, clipPath: `inset(-${M}px -${M}px -${M}px -${M}px)` }
            ],
            { duration: T(700), delay: T(120), easing: EASE, fill: "backwards" }
        );

        const shine = document.createElement("div");

        shine.className = "bet-live-shine";

        shine.innerHTML = "<i></i>";

        card.appendChild(shine);

        shine.firstElementChild.animate(
            [{ left: "-45%" }, { left: "115%" }],
            { duration: T(900), delay: T(370), easing: "ease-in-out", fill: "both" }
        ).finished.finally(() => shine.remove());

    });

}


/*
    Brouillon publié : la carte jaune se retourne comme une carte à jouer,
    le pari publié est au verso. Puis la barre de ma cote se remplit
    et les pastilles apparaissent.
*/

function playDraftFlips(container, draftFlips) {

    draftFlips.forEach(({ front, height: draftHeight }, betId) => {

        const card =
            container.querySelector(`.bet-card[data-bet-id="${betId}"]`);

        if (!card) {

            return;

        }

        const rect = card.getBoundingClientRect();

        front.removeAttribute("data-draft-id");

        Object.assign(front.style, {
            position: "fixed",
            left: rect.left + "px",
            top: rect.top + "px",
            width: rect.width + "px",
            height: draftHeight + "px",
            // Seul le bas est coupé pendant l'ajustement de hauteur : les pastilles
            // posées à cheval sur le bord haut restent entières.
            clipPath: "inset(-30px -30px 0 -30px)",
            margin: "0",
            zIndex: "5",
            pointerEvents: "none",
            transform: "",
            backfaceVisibility: "hidden",
            webkitBackfaceVisibility: "hidden"
        });

        document.body.appendChild(front);

        const timing = { duration: 1100, delay: 150, easing: "cubic-bezier(.45,0,.25,1)", fill: "both" };

        // Hauteur : brouillon → carte publiée, pendant le retournement, pour les deux faces.
        // La liste en dessous suit le mouvement au lieu de sauter d'un coup.
        if (Math.abs(rect.height - draftHeight) > 1) {

            const resize = {
                duration: 900,
                delay: 250,
                easing: "cubic-bezier(.4,0,.2,1)"
            };

            front.animate(
                [{ height: draftHeight + "px" }, { height: rect.height + "px" }],
                { ...resize, fill: "forwards" }
            );

            card.style.clipPath = "inset(-30px -30px 0 -30px)";

            card.animate(
                [{ height: draftHeight + "px" }, { height: rect.height + "px" }],
                { ...resize, fill: "backwards" }
            ).finished.finally(() => {

                card.style.clipPath = "";

            });

        }

        // Recto : le brouillon part de face et passe de dos.
        front.animate(
            [
                { transform: "perspective(1400px) rotateY(0deg) scale(1)" },
                { transform: "perspective(1400px) rotateY(90deg) scale(.94)", offset: 0.45 },
                { transform: "perspective(1400px) rotateY(185deg) scale(1.02)", offset: 0.8 },
                { transform: "perspective(1400px) rotateY(180deg) scale(1)" }
            ],
            timing
        ).finished.then(() => front.remove()).catch(() => front.remove());

        // Verso : le pari publié arrive de dos et finit de face, avec un petit rebond.
        card.style.backfaceVisibility = "hidden";

        card.animate(
            [
                { transform: "perspective(1400px) rotateY(-180deg) scale(1)" },
                { transform: "perspective(1400px) rotateY(-90deg) scale(.94)", offset: 0.45 },
                { transform: "perspective(1400px) rotateY(5deg) scale(1.02)", offset: 0.8 },
                { transform: "perspective(1400px) rotateY(0deg) scale(1)" }
            ],
            { ...timing, fill: "backwards" }
        ).finished.finally(() => {

            card.style.backfaceVisibility = "";

        });

        // Ma cote : la barre se remplit, puis les pastilles sautent.
        const picked =
            card.querySelector(".bet-choice-picked")?.closest(".bet-choice-wrapper");

        const fill =
            picked?.querySelector(".choice-bar-fill");

        if (fill) {

            fill.animate(
                [{ width: "0%" }, { width: fill.style.width || "100%" }],
                { duration: 700, delay: 1250, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }
            );

        }

        [picked?.querySelector(".choice-badge"), card.querySelector(".bet-new-badge")]
            .filter(Boolean)
            .forEach((badge, index) => {

                badge.animate(
                    [
                        { transform: "scale(0)", opacity: 0 },
                        { transform: "scale(1.25)", opacity: 1, offset: 0.7 },
                        { transform: "scale(1)", opacity: 1 }
                    ],
                    { duration: 450, delay: 1350 + index * 100, fill: "backwards" }
                );

            });

    });

}


/*
    Carte « Créer un pari » en pointillés, en tête de la liste des paris
    (version B de demo-bouton-creer.html). Ouvre la fenêtre de création.
*/

function renderCreateBetCard() {

    const card =
        document.createElement("div");

    card.className =
        "bet-create-card";

    card.setAttribute("role", "button");

    card.tabIndex = 0;

    card.innerHTML = `

        <span class="bet-create-plus" aria-hidden="true"></span>

        <div>
            <b>Créer un pari</b>
            <small>Propose un sujet, choisis les cotes, mise pour le publier.</small>
        </div>

    `;

    card.addEventListener("click", openCreateModal);

    card.addEventListener("keydown", event => {

        if (event.key === "Enter" || event.key === " ") {

            event.preventDefault();

            openCreateModal();

        }

    });

    return card;

}


async function displayBets({ quiet = false, force = false } = {}) {

    const container =
        document.getElementById("bets-container");


    if (!container) {

        return;

    }


    if (!quiet) {

        container.innerHTML =
            "<p>Chargement des paris...</p>";

    }


    try {

        const [bets] = await Promise.all([getBets(), loadMyCombos()]);

        // Les paris plus jouables sortent du ticket.
        pruneTicket(bets);


        // Un brouillon supprimé est en train de partir : on redessine après son animation.
        if (quiet && leavingDrafts > 0) {

            return;

        }


        // Panneau des parieurs ouvert : on ne remplace pas la carte soulevée.
        if (quiet && isStakesPanelOpen()) {

            betsRefreshPending = true;

            return;

        }


        // Rafraîchissement en direct : rien de nouveau, on ne touche à rien.
        const signature = computeBetsSignature(bets);

        if (quiet && !force && signature === betsSignature) {

            return;

        }

        betsSignature = signature;


        // Rafraîchissement en direct : on retient où étaient les cartes.
        const previousTops = new Map();

        // Brouillons qui viennent d'être publiés : copie de la carte jaune,
        // qui se retourne pour laisser place au pari publié (playDraftFlips).
        const draftFlips = new Map();

        // Inclinaison « la carte suit la souris » : on la retient pour la remettre
        // sur la carte redessinée (sinon elle se remet à plat d'un coup).
        const previousTilts = new Map();

        // Boutons « Valider » dépliés (souris proche) : ils le restent après le redessin.
        const nearBets = new Set();

        if (quiet) {

            container.querySelectorAll(".validate-fab.near").forEach(fab => {

                const id = fab.closest(".bet-card")?.dataset.betId;

                if (id) {

                    nearBets.add(id);

                }

            });

            container
                .querySelectorAll(".bet-card[data-bet-id]")
                .forEach(card => {

                    previousTops.set(card.dataset.betId, card.getBoundingClientRect().top);

                    if (card.classList.contains("tilting") && card.style.transform) {

                        previousTilts.set(card.dataset.betId, card.style.transform);

                    }

                });

        }


        // Cartes de pari ouvertes qui disparaissent (pari validé) : une copie reste en place
        // et s'efface en douceur, pendant que les autres cartes remontent.
        if (quiet) {

            const stillOpen = new Set(
                bets.filter(bet => bet.status === "open").map(bet => bet.id)
            );

            container
                .querySelectorAll(".bet-card:not(.claim-card)[data-bet-id]")
                .forEach(card => {

                    if (stillOpen.has(card.dataset.betId)) {

                        return;

                    }

                    const rect = card.getBoundingClientRect();

                    const ghost = card.cloneNode(true);

                    ghost.classList.remove("bet-card-live-in", "cascade-in");

                    ghost.removeAttribute("data-bet-id");

                    Object.assign(ghost.style, {
                        position: "fixed",
                        left: rect.left + "px",
                        top: rect.top + "px",
                        width: rect.width + "px",
                        height: rect.height + "px",
                        margin: "0",
                        zIndex: "5",
                        pointerEvents: "none",
                        transform: ""
                    });

                    document.body.appendChild(ghost);

                    ghost.animate(
                        [
                            { opacity: 1, transform: "none" },
                            { opacity: 0, transform: "translateY(-10px) scale(0.95)" }
                        ],
                        { duration: 550, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
                    ).finished.then(() => ghost.remove()).catch(() => ghost.remove());

                });

            container
                .querySelectorAll(".bet-card-draft[data-draft-id]")
                .forEach(card => {

                    const id = card.dataset.draftId;

                    if (bets.some(bet => bet.id === id && bet.status === "open")) {

                        // Hauteur du brouillon : la carte publiée part de là et s'ajuste en douceur.
                        draftFlips.set(id, {
                            front: card.cloneNode(true),
                            height: card.getBoundingClientRect().height
                        });

                    }

                });

        }


        container.innerHTML = "";


        // Carte « Créer un pari » en tête de liste (ordinateur ; sur téléphone, le « + » du menu).
        container.appendChild(renderCreateBetCard());


        // Paris bloqués pour moi ou « Trop tard » (mises closes) : à la fin,
        // les autres gardent leur ordre. Une carte qui ferme en direct relance
        // displayBets (updateCountdowns) et descend donc toute seule.
        const isLockedForMe = bet =>
            isBlockedTarget(bet) || isBetClosed(bet);

        const openBets =
            bets
                .filter(
                    bet => bet.status === "open"
                )
                .sort((a, b) => isLockedForMe(a) - isLockedForMe(b));


        // Nombre de paris disponibles, juste sous la carte « Créer un pari ».
        const betCount =
            document.createElement("div");

        betCount.className =
            "bets-count";

        betCount.textContent =
            openBets.length + (openBets.length === 1 ? " pari disponible" : " paris disponibles");

        // Sans pari, le message « Aucun pari disponible » s'affiche déjà plus bas.
        if (openBets.length > 0) {

            container.appendChild(betCount);

        }

        // Téléphone : le même nombre dans l'en-tête, à gauche du bouton « Classement ».
        const phoneCount =
            document.getElementById("bets-page-count");

        if (phoneCount) {

            phoneCount.textContent =
                openBets.length > 0 ? betCount.textContent : "";

        }


        /*
            Paris validés où j'ai encore des mises à récupérer :
            affichés en premier, avec « Récupérer » ou « Perdre la mise ».
        */

        const claimableBets =
            bets.filter(
                bet =>
                    bet.status === "resolved" &&
                    (bet.stakes || []).some(
                        s => s.user_id === currentUser?.id && !s.claimed_at
                    )
            );

        // Mes brouillons : en haut, je dois miser pour les publier.
        const draftBets =
            bets.filter(isMyDraft);

        // Paris validés où ma commission de créateur attend (cartes jaunes).
        const commissionBets =
            bets.filter(
                bet =>
                    bet.status === "resolved" &&
                    myCommission(bet) > 0
            );

        // Combinés gagnés (ou remboursés) à récupérer.
        const comboClaims = claimableCombos();

        const previousClaimIds = renderedClaimIds;

        renderedClaimIds = new Set([
            ...claimableBets.map(bet => bet.id),
            ...commissionBets.map(bet => "commission-" + bet.id),
            ...comboClaims.map(item => "combo-" + item.combo.id)
        ]);

        draftBets.forEach(bet => {

            container.appendChild(renderDraftCard(bet));

        });

        commissionBets.forEach(bet => {

            const commissionCard = renderCommissionCard(bet);

            if (quiet && !previousClaimIds.has("commission-" + bet.id)) {

                commissionCard.classList.add("claim-card-enter");

            }

            container.appendChild(commissionCard);

        });

        claimableBets.forEach(bet => {

            const claimCard = renderClaimCard(bet);

            // Nouvelle carte à récupérer (pari qui vient d'être validé) : elle arrive en douceur.
            if (quiet && !previousClaimIds.has(bet.id)) {

                claimCard.classList.add("claim-card-enter");

            }

            container.appendChild(claimCard);

        });

        comboClaims.forEach(item => {

            const comboCard = renderComboClaimCard(item);

            if (quiet && !previousClaimIds.has("combo-" + item.combo.id)) {

                comboCard.classList.add("claim-card-enter");

            }

            container.appendChild(comboCard);

        });


        if (openBets.length === 0 && draftBets.length === 0 && claimableBets.length === 0 && commissionBets.length === 0 && comboClaims.length === 0) {

            // Aucun pari : fausses cartes floutées en fond, message au centre
            // (version B de demo-aucun-pari.html).
            const ghostCard = choices => `
                <div class="bets-empty-ghost">
                    <i></i>
                    <i></i>
                    <div class="bets-empty-odds">${"<span></span>".repeat(choices)}</div>
                </div>
            `;

            container.insertAdjacentHTML("beforeend", `
                <div class="bets-empty">
                    <div class="bets-empty-ghosts" aria-hidden="true">
                        ${[2, 3, 2, 2, 3, 2].map(ghostCard).join("")}
                    </div>
                    <div class="bets-empty-center">
                        <div class="bets-empty-icon">👻</div>
                        <h2>Personne n'a encore parié</h2>
                        <p>Les cartes attendent leur question. Sois le premier : celui qui crée le pari fixe les cotes.</p>
                        <button type="button" class="primary-button bets-empty-button">
                            ＋ Créer le premier pari
                        </button>
                    </div>
                </div>
            `);

            container
                .querySelector(".bets-empty-button")
                .addEventListener("click", openCreateModal);

            return;

        }


        if (cardValidation && !openBets.some(bet => bet.id === cardValidation.betId && isMyOpenBet(bet) && hasOtherStake(bet))) {

            cardValidation = null;

        }


        const fadingCards = [];


        // Cartes qui viennent d'arriver (rafraîchissement en direct seulement).
        const previousIds = renderedBetIds;

        renderedBetIds = new Set(openBets.map(bet => bet.id));


        openBets.forEach(
            bet => {

                const card =
                    document.createElement("div");

                card.className =
                    "bet-card" +
                    (isLockedForMe(bet) ? " bet-card-locked" : "") +
                    (isCreatedToday(bet.created_at) ? " bet-card-new" : "") +
                    (quiet && !previousIds.has(bet.id) && !draftFlips.has(bet.id) ? " bet-card-live-in" : "");


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

                if (previousTilts.has(bet.id)) {

                    card.classList.add("tilting");

                    card.style.transform = previousTilts.get(bet.id);

                }

                if (bet.deadline_at) {

                    card.dataset.deadline =
                        bet.deadline_at;

                    // Sert à calculer la fermeture des mises (1 h, 15 min ou 5 min avant).
                    card.dataset.created =
                        bet.created_at;

                }


                const totalStaked =
                    (bet.stakes || []).reduce(
                        (sum, s) => sum + Number(s.stake),
                        0
                    );


                // Mode validation (créateur du pari seulement, dès qu'un autre joueur a misé).
                const mine = isMyOpenBet(bet) && hasOtherStake(bet);

                const waitingOther = isMyOpenBet(bet) && !hasOtherStake(bet);

                const validating = mine && cardValidation?.betId === bet.id;

                // Passage en mode validation (ou sortie) : la carte est redessinée,
                // on la fait donc partir de l'ancienne couleur puis fondre vers la nouvelle.
                const fade = validationFade && validationFade.betId === bet.id
                    ? validationFade
                    : null;

                if (fade) {

                    fadingCards.push({ card, to: fade.to });

                }

                const showGreen = fade ? !fade.to : validating;

                if (showGreen) {

                    card.classList.add("validating");

                }

                if (validating && cardValidation.pick) {

                    card.classList.add("validating-chosen");

                }

                // Nouveaux éléments du mode validation : ils apparaissent en douceur
                // la première fois seulement.
                if (validating && validationRevealed.betId !== bet.id) {

                    validationRevealed = { betId: bet.id, hint: false, bilan: false };

                }

                const animateHint = validating && !validationRevealed.hint;

                const animateBilan = validating && Boolean(cardValidation.pick) && !validationRevealed.bilan;

                if (validating) {

                    validationRevealed.hint = true;

                    if (cardValidation.pick) {

                        validationRevealed.bilan = true;

                    }

                }

                card.innerHTML =
                    // Thème Diamant : couche d'étoiles qui scintillent (style.css).
                    (authorTheme === "diamant" ? `<span class="dia-stars" aria-hidden="true"></span>` : "") +
                    (canDeleteExpiredBet(bet) && waitingOther && !isBetClosed(bet)
                        // Mises encore ouvertes, personne d'autre n'a misé : la pastille verte
                        // en pointillé et, à côté, la pastille rouge « Supprimer ».
                        ? `<div class="validate-fab-pair"><button type="button" class="validate-fab validate-fab-wait" data-validate-wait>✓<span>En attente d'un parieur</span></button><button type="button" class="validate-fab validate-fab-delete" data-delete-bet="${bet.id}">✕<span>Supprimer</span></button></div>`
                        : canDeleteExpiredBet(bet)
                        // Mises closes sans autre parieur (ou admin) : pastille rouge seule.
                        ? `<button type="button" class="validate-fab validate-fab-delete" data-delete-bet="${bet.id}">✕<span>Supprimer</span></button>`
                        : mine
                        ? `<button type="button" class="validate-fab${validating ? " open" : ""}${animateHint ? " validate-enter" : ""}" data-validate-toggle="${bet.id}">${validating ? "✕<span>Annuler</span>" : "✓<span>Valider</span>"}</button>`
                        : waitingOther
                        // Pas encore validable : pastille vide, elle fait « non » au clic.
                        ? `<button type="button" class="validate-fab validate-fab-wait" data-validate-wait>✓<span>En attente d'un parieur</span></button>`
                        : "") +
                    (betBadgeLabel(bet)
                        ? `<span class="bet-new-badge">${betBadgeLabel(bet)}</span>`
                        : "") +
                    renderBetSummaryHtml(bet, validating ? {
                        validating: true,
                        headerExtra: `<span class="validate-tag${animateHint ? " validate-enter" : ""}">Mode validation</span>`,
                        beforeChoices: `<div class="validate-reveal${animateHint ? "" : " show"}"><div class="validate-reveal-inner"><div class="validate-hint">👆 Clique la cote qui a gagné</div>${currentProfile?.is_admin
                            // Admin : annuler le pari au lieu de le valider (admin-annulation.sql).
                            ? `<button type="button" class="validate-admin-cancel" data-admin-cancel="${bet.id}">🚫 Annuler le pari (admin)</button><p class="validate-error validate-admin-error"></p>`
                            : ""}</div></div>`
                    } : {}) + `

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

                ` + (validating && cardValidation.pick
                    ? `<div class="validate-reveal${animateBilan ? "" : " show"}"><div class="validate-reveal-inner">${validationBilanHtml(bet, cardValidation.pick)}</div></div>`
                    : "");


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
                            ) ||
                            draftBets.find(
                                item =>
                                    item.id === betId
                            );


                        const choice =
                            bet.bet_choices.find(
                                item =>
                                    item.id === choiceId
                            );


                        // Mode validation : la cote cliquée est le gagnant.
                        if (cardValidation && cardValidation.betId === betId) {

                            cardValidation.pick = choiceId;

                            displayBets({ quiet: true, force: true });

                            return;

                        }


                        // La cote rejoint le ticket (mise simple ou combiné ;
                        // un brouillon est publié par la mise).
                        toggleTicketLeg(bet, choice);

                    }
                );

            });


        updateCountdowns();

        syncTicketHighlights();

        // Le bouton « Valider » redessiné retrouve tout de suite son état :
        // d'abord celui d'avant le redessin, puis la position réelle de la souris.
        container.querySelectorAll(".bet-card[data-bet-id]").forEach(card => {

            if (nearBets.has(card.dataset.betId)) {

                card.querySelector(".validate-fab")?.classList.add("near");

            }

        });

        updateValidateFabs();


        const reveals = container.querySelectorAll(".validate-reveal:not(.show)");

        if (reveals.length > 0) {

            requestAnimationFrame(() => requestAnimationFrame(() => {

                reveals.forEach(element => element.classList.add("show"));

            }));

        }


        // La couleur fond sur deux images : on laisse d'abord s'afficher l'état de départ.
        if (fadingCards.length > 0) {

            const pending = [...fadingCards];

            validationFade = null;

            requestAnimationFrame(() => requestAnimationFrame(() => {

                pending.forEach(item => item.card.classList.toggle("validating", item.to));

            }));

        }


        container.querySelectorAll("[data-validate-toggle]").forEach(button => {

            button.addEventListener("click", event => {

                event.stopPropagation();

                const betId = button.dataset.validateToggle;

                const entering = !(cardValidation && cardValidation.betId === betId);

                validationRevealed = { betId: null, hint: false, bilan: false };

                // Annulation : on joue la sortie sur la carte actuelle (couleur, message,
                // bilan et étiquette s'effacent en douceur), puis on la redessine.
                if (!entering) {

                    const card = button.closest(".bet-card");

                    cardValidation = null;

                    validationFade = null;

                    if (card) {

                        card.classList.remove("validating", "validating-chosen");

                        card.querySelectorAll(".validate-reveal").forEach(
                            element => element.classList.remove("show")
                        );

                        card.querySelector(".validate-tag")?.classList.add("validate-leave");

                        button.classList.remove("open");

                        button.innerHTML = "✓<span>Valider</span>";

                        // Une fois tout refermé, on retire simplement les éléments du mode
                        // validation : la carte a déjà son aspect normal, inutile de redessiner
                        // toute la liste (c'est ce qui faisait saccader les cartes du dessous).
                        setTimeout(() => {

                            if (!card.isConnected) {

                                return;

                            }

                            card.querySelectorAll(".validate-reveal, .validate-tag").forEach(
                                element => element.remove()
                            );

                            const deadline = card.dataset.deadline;

                            const closed = (deadline && new Date(deadline) - Date.now() <= betCloseMs(card.dataset.created, deadline)) ||
                                card.classList.contains("bet-card-locked");

                            card.querySelectorAll(".bet-choice-validate").forEach(choiceButton => {

                                choiceButton.classList.remove("bet-choice-validate", "validate-selected");

                                if (closed) {

                                    choiceButton.classList.add("bet-choice-closed");

                                    choiceButton.disabled = true;

                                }

                                // La cote enflammée (8 ou plus), coupée pendant la validation, revient.
                                const odds = Number(choiceButton.dataset.odds);

                                if (!closed && !choiceButton.disabled && odds >= ODDS_FIRE_FROM && !choiceButton.classList.contains("odds-fire")) {

                                    choiceButton.classList.add("odds-fire");

                                    const embers = document.createElement("canvas");

                                    embers.className = "odds-embers";

                                    embers.setAttribute("aria-hidden", "true");

                                    choiceButton.after(embers);

                                }

                            });

                            button.classList.remove("validate-enter");

                        }, 520);

                        return;

                    }

                }

                cardValidation = entering
                    ? { betId, pick: null }
                    : null;

                validationFade = { betId, to: entering };

                displayBets({ quiet: true, force: true });

            });

        });

        container.querySelectorAll("[data-validate-wait]").forEach(button => {

            button.addEventListener("click", event => {

                event.stopPropagation();

                button.classList.remove("validate-fab-no");

                void button.offsetWidth;

                button.classList.add("validate-fab-no");

                // Vibration finie : la classe part, pour ne pas rejouer en dépliant la carte.
                button.addEventListener("animationend", () => button.classList.remove("validate-fab-no"), { once: true });

            });

        });

        container.querySelectorAll("[data-admin-cancel]").forEach(button => {

            button.addEventListener("click", event => {

                event.stopPropagation();

                adminCancelBet(button.dataset.adminCancel, button);

            });

        });

        container.querySelectorAll("[data-validate-confirm]").forEach(button => {

            button.addEventListener("click", event => {

                event.stopPropagation();

                confirmCardValidation(button.dataset.validateConfirm, button);

            });

        });


        if (quiet) {

            // Avant animateLiveCards : la carte publiée reprend d'abord la hauteur
            // du brouillon, les cartes du dessous ne sautent donc pas.
            playDraftFlips(container, draftFlips);

            animateLiveCards(container, previousTops);

        }


        /*
            Supprimer un pari terminé sans parieur :
            un premier clic demande confirmation, le second supprime.
        */

        container
            .querySelectorAll("[data-delete-bet]")
            .forEach(button => {

                button.addEventListener("click", event => {

                    event.stopPropagation();

                    deleteBetFromFab(button);

                });

            });


        /*
            Ajout des événements sur la carte
            (ouvre le détail des parieurs en focus,
            sauf si on clique sur un bouton de choix).
        */

        document
            .querySelectorAll(".bet-card:not(.claim-card):not(.bet-card-draft)")
            .forEach(card => {

                card.addEventListener(
                    "click",
                    event => {

                        if (
                            event.target.closest(
                                ".bet-choice-button, .validate-fab, .validate-bilan"
                            )
                        ) {

                            return;

                        }

                        // Pendant la validation, un clic sur la carte n'ouvre pas le détail.
                        if (card.classList.contains("validating")) {

                            return;

                        }


                        const betId =
                            card.dataset.betId;


                        const bet =
                            openBets.find(
                                item =>
                                    item.id === betId
                            );


                        openStakesModal(bet, card);

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

    closeStakesPanel(true);

    currentBet = bet;

    currentChoice = choice;


    const modalQuestion =
        document.getElementById("modal-question");

    modalQuestion.textContent =
        bet.question;

    // Question coupée par « … » : le texte complet s'affiche au survol.
    modalQuestion.title =
        bet.question;


    document.getElementById(
        "modal-author"
    ).innerHTML =
        `Créé par ${styledName(bet.profiles)}`;


    document.getElementById(
        "modal-choice"
    ).textContent =
        choice.label;

    document.getElementById(
        "modal-odds"
    ).textContent =
        oddsText(choice.odds, { times: true });


    document.getElementById(
        "stake-input"
    ).value = "";


    const potentialWinElement =
        document.getElementById("potential-win");

    potentialWinElement.textContent =
        formatMoney(0);

    potentialWinElement._lastValue = 0;

    updateBetGauge(0, 0);


    // Pari déjà misé : on le dit tout de suite.
    document.getElementById(
        "modal-error"
    ).textContent =
        myStakesOn(bet) >= STAKES_PER_BET
            ? "Tu as déjà misé sur ce pari (1 seule mise par pari)."
            : "";


    document
        .getElementById("bet-modal")
        .classList.remove("hidden");

    // La mise max baisse avec le temps : affichage mis à jour chaque seconde.
    refreshBetMax();

    clearInterval(betMaxTimer);

    betMaxTimer = setInterval(refreshBetMax, 1000);

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

        updateBetGauge(0, 0);

        return;

    }


    const potentialWin =
        value *
        Number(currentChoice.odds);


    animatePotentialWin(potentialWin);

    updateBetGauge(value, potentialWin);

}


/*
    Jauge de la fenêtre de mise : elle se remplit avec la mise, et elle est
    pleine à la mise la plus haute possible en ce moment (celle du bouton
    « Max » : mise max du moment, ou le solde s'il est plus petit).
    Un message motive vers le palier de gain suivant,
    et le bouton affiche le montant misé.
*/

// Mise minimum et maximum par mise (aussi vérifiées côté base, voir mise-min-max.sql).
const STAKE_MIN = 10;

const STAKE_MAX = 5000;

// Nombre de mises par pari et par joueur (aussi vérifié côté base, voir limite-une-mise.sql).
const STAKES_PER_BET = 1;


/*
    Mise max qui baisse avec le temps (aussi vérifiée côté base : bet_max_stake(),
    voir mise-max-decroissante.sql) :
    5 000 € pendant la 1re minute du pari, puis baisse linéaire jusqu'à 10 €
    pendant la dernière minute avant la fermeture des mises.
*/

function myStakesOn(bet) {

    return (bet?.stakes || []).filter(
        s => s.user_id === currentUser?.id
    ).length;

}

function betMaxStake(bet, now = Date.now()) {

    if (!bet?.created_at || !bet?.deadline_at) {
        return STAKE_MAX;
    }

    const created = new Date(bet.created_at).getTime();

    const closeAt = new Date(bet.deadline_at).getTime() - betCloseMs(bet.created_at, bet.deadline_at);

    const start = created + 60000;

    const end = closeAt - 60000;

    if (now <= start) {
        return STAKE_MAX;
    }

    if (now >= end) {
        return STAKE_MIN;
    }

    const ratio = (now - start) / (end - start);

    return Math.max(STAKE_MIN, Math.floor(STAKE_MAX - (STAKE_MAX - STAKE_MIN) * ratio));

}

let betMaxTimer = null;

// Bouton « Max » et règle de la fenêtre de mise : mis à jour chaque seconde.
function refreshBetMax() {

    const modal = document.getElementById("bet-modal");

    if (!currentBet || modal.classList.contains("hidden")) {

        clearInterval(betMaxTimer);

        betMaxTimer = null;

        return;

    }

    const max = formatMoney(betMaxStake(currentBet));

    document.getElementById("bet-max-value").textContent = max;

    document.getElementById("bet-rules-max").textContent = max;

    // La mise max baisse : la jauge (pleine à la mise max) suit.
    const stake = Number(document.getElementById("stake-input").value) || 0;

    updateBetGauge(stake, stake * Number(currentChoice?.odds || 0));

}

const BET_GAIN_GOALS = [50, 100, 200, 500, 1000];

// Mise la plus haute possible maintenant (= ce que met le bouton « Max »).
function maxPossibleStake() {

    const maxNow = betMaxStake(currentBet);

    const balance = Math.floor(Number(currentProfile?.balance) || 0);

    return balance > 0 ? Math.min(maxNow, balance) : maxNow;

}

function updateBetGauge(stake, gain) {

    const maxPossible = maxPossibleStake();

    const percent =
        Math.min(100, stake / maxPossible * 100);

    document.getElementById("bet-gauge-fill").style.height =
        percent + "%";

    document.getElementById("bet-gauge-coin").style.bottom =
        `calc(${percent}% - 4px)`;


    const tip =
        document.getElementById("bet-tip");

    const nextGoal =
        BET_GAIN_GOALS.find(goal => goal > gain);

    if (!stake) {

        tip.textContent = "💡 Choisis une mise pour voir ton gain.";

    } else if (stake >= maxPossible) {

        tip.textContent = "🔥 Mise max ! Gros coup en vue !";

    } else if (nextGoal && currentChoice) {

        const missing =
            Math.ceil((nextGoal - gain) / Number(currentChoice.odds));

        tip.textContent =
            `🔥 Encore ${formatMoney(missing)} pour viser ${formatMoney(nextGoal)} !`;

    } else {

        tip.textContent = "🤑 Gros coup en vue !";

    }


    const button =
        document.getElementById("confirm-bet");

    button.disabled = !stake;

    // Brouillon : la mise publie le pari.
    const publishing =
        currentBet?.status === "draft";

    button.textContent = stake
        ? "🎟️ Miser " + formatMoney(stake) + (publishing ? " et publier" : "")
        : publishing ? "Miser pour publier" : "Placer le pari";

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


    if (currentBet && isBetClosed(currentBet)) {

        errorElement.textContent =
            "Les mises sont closes (échéance trop proche).";

        return;

    }


    if (!stake || stake <= 0) {

        errorElement.textContent =
            "Entre un montant valide.";

        return;

    }


    if (!Number.isInteger(stake)) {

        errorElement.textContent =
            "La mise doit être un montant rond (sans centimes).";

        return;

    }


    if (stake < STAKE_MIN || stake > STAKE_MAX) {

        errorElement.textContent =
            "La mise doit être comprise entre " + formatMoney(STAKE_MIN) + " et " + formatMoney(STAKE_MAX) + ".";

        return;

    }


    // Mise max du moment (elle baisse avec le temps).
    const maxNow = betMaxStake(currentBet);

    if (stake > maxNow) {

        errorElement.textContent =
            "Mise max en ce moment : " + formatMoney(maxNow) + " (elle baisse avec le temps).";

        return;

    }


    // Limite : 1 seule mise par pari et par joueur (aussi vérifiée côté base).
    if (myStakesOn(currentBet) >= STAKES_PER_BET) {

        errorElement.textContent =
            "Tu as déjà misé sur ce pari (1 seule mise par pari).";

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
            On ferme la fenêtre.
        */

        document
            .getElementById("bet-modal")
            .classList.add("hidden");


        /*
            La mise part du solde vers le perroquet
            (l'argent en jeu grossit). Lancée avant le rechargement
            du profil pour que le perroquet grandisse au rythme des billets.
        */

        flyBills("stake");


        /*
            On recharge le profil.
        */

        await loadCurrentProfile();


        /*
            On recharge les paris et l'historique.
        */

        // Rafraîchissement discret : pas de « Chargement » qui fait clignoter la liste.
        await displayBets({ quiet: true });

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
   6 bis. TICKET : MISE SIMPLE OU COMBINÉ (voir combines.sql)
   Une cote touchée rejoint le ticket sous le classement :
   1 cote = mise simple, 2 à 4 cotes de paris différents = combiné.
   Les cotes se multiplient, boost de +5 % par pari au-delà de 2,
   cote totale plafonnée à 100. Tout ou rien.
========================================================= */

const COMBO_MAX_LEGS = 4;

// Plafond de cote d'un combiné (100 avant le 2026-10-14, voir cotes-et-combines.sql).
const COMBO_MAX_ODDS = 30;

// Mise max d'un combiné (aussi vérifiée côté base, voir cotes-et-combines.sql).
// Gain max d'un combiné : 2 500 € × 30 = 75 000 €.
const COMBO_STAKE_MAX = 2500;

const COMBO_BOOST_PER_LEG = 0.05;

// Sélections du ticket : [{ betId, choiceId }]
let ticketLegs = [];

let ticketStake = 0;

// 🤪 Boost WTF activé dans le ticket (arbre.js, arbre-palier1.sql).
let ticketBoost = false;

let ticketTimer = null;

// Téléphone : ticket déplié (sinon une simple barre en bas).
let ticketOpen = false;

let ticketBusy = false;

// Derniers paris chargés (pour retrouver ceux du ticket).
let lastLoadedBets = [];

// Mes combinés dans le groupe (loadMyCombos).
let myCombos = [];


// Même calcul côté base : combo_odds().
function comboBoost(legCount) {

    return COMBO_BOOST_PER_LEG * Math.max(legCount - 2, 0);

}

// Produit des cotes + boost (+5 % par pari au-delà de 2), plafonné à 30.
function comboOdds(product, legCount) {

    return Math.round(Math.min(COMBO_MAX_ODDS, product * (1 + comboBoost(legCount))) * 100) / 100;

}


// Mon brouillon démarre au moment où je mise : sa mise max et sa fermeture se calculent depuis maintenant.
function ticketBet(bet) {

    return bet && bet.status === "draft"
        ? { ...bet, created_at: new Date().toISOString() }
        : bet;

}

function ticketEntries() {

    return ticketLegs
        .map(leg => {

            const bet = ticketBet(lastLoadedBets.find(item => item.id === leg.betId));

            const choice = bet?.bet_choices?.find(item => item.id === leg.choiceId);

            return bet && choice ? { bet, choice } : null;

        })
        .filter(Boolean);

}

function ticketOdds(entries = ticketEntries()) {

    if (entries.length === 0) {
        return 0;
    }

    const product = entries.reduce((total, entry) => total * Number(entry.choice.odds), 1);

    // Mise simple : la flamme bleue (victoires d'affilée) booste la cote (duels.js).
    const streakBoost =
        typeof winStreakBoost === "function" ? winStreakBoost(myWinStreak()) : 0;

    return entries.length === 1
        ? Math.round(product * (1 + streakBoost) * 100) / 100
        : comboOdds(product, entries.length);

}

// Mise max du ticket : la plus petite mise max du moment parmi ses paris
// (et 1 000 € au plus pour un combiné).
function ticketMaxStake(entries = ticketEntries()) {

    return entries.reduce(
        (max, entry) => Math.min(max, betMaxStake(entry.bet)),
        entries.length > 1 ? COMBO_STAKE_MAX : STAKE_MAX
    );

}

// Mise simple impossible : j'ai déjà misé sur ce pari (1 mise par pari).
function ticketSingleBlocked(entries = ticketEntries()) {

    return entries.length === 1 && myStakesOn(entries[0].bet) >= STAKES_PER_BET;

}


// Combiné identique déjà placé (mêmes paris, mêmes choix) : refusé, comme côté base.
function ticketDuplicate(entries = ticketEntries()) {

    if (entries.length < 2) {
        return false;
    }

    const key = entries.map(entry => entry.choice.id).sort().join(",");

    return myCombos.some(combo =>
        (combo.combo_legs || []).map(leg => leg.choice_id).sort().join(",") === key
    );

}


// Combinés débloqués au niveau 5 (body.level-lock-5, voir applyLevelLocks).
function combosLocked() {

    return document.body.classList.contains("level-lock-5");

}

function toggleTicketLeg(bet, choice) {

    bet = ticketBet(bet);

    if (isBlockedTarget(bet)) {

        ticketAlert("Tu es concerné(e) par ce pari, tu ne peux pas parier.");

        return;

    }

    if (isBetClosed(bet)) {

        ticketAlert("Les mises sont closes sur ce pari (échéance trop proche).");

        return;

    }

    const index = ticketLegs.findIndex(leg => leg.betId === bet.id);

    if (index >= 0 && ticketLegs[index].choiceId === choice.id) {

        ticketLegs.splice(index, 1);

    } else if (index >= 0) {

        // Un seul choix par pari : l'autre cote remplace la première.
        ticketLegs[index].choiceId = choice.id;

    } else if (combosLocked()) {

        // Avant le niveau 5 : pas de combiné, la nouvelle cote remplace l'ancienne.
        ticketLegs = [{ betId: bet.id, choiceId: choice.id }];

        ticketOpen = true;

    } else if (ticketLegs.length < COMBO_MAX_LEGS) {

        ticketLegs.push({ betId: bet.id, choiceId: choice.id });

        // Téléphone : le ticket s'ouvre directement (plus de barre repliée à toucher).
        ticketOpen = true;

    } else {

        ticketAlert("⚠️ " + COMBO_MAX_LEGS + " paris maximum dans un combiné");

        return;

    }

    renderTicket({ bump: true });

    syncTicketHighlights();

    // Cote choisie : le champ de mise est prêt, on peut taper le montant tout de suite
    // (ordinateur ; sur téléphone le clavier ne s'ouvre pas tout seul).
    const chosen = ticketLegs.some(leg => leg.betId === bet.id);

    const input = document.querySelector("#bet-ticket [data-ticket-stake]");

    if (chosen && input && !PHONE_LAYOUT.matches && !isStakesPanelOpen()) {

        input.focus({ preventScroll: true });

        input.select();

    }

}


/*
    Message du ticket, bien visible dans le ticket lui-même (même replié
    sur téléphone, où il cache la cloche des notifications) : bandeau
    orange et petite secousse. Ticket vide : notification habituelle.
*/

let ticketAlertTimer = null;

function ticketAlert(text) {

    const ticket = document.getElementById("bet-ticket");

    if (!ticket || ticketLegs.length === 0) {

        alertToast(text);

        return;

    }

    ticket.querySelector(".ticket-alert")?.remove();

    const alert = document.createElement("div");

    alert.className = "ticket-alert";

    alert.textContent = text;

    ticket.prepend(alert);

    ticket.classList.remove("shake");

    void ticket.offsetWidth;

    ticket.classList.add("shake");

    clearTimeout(ticketAlertTimer);

    ticketAlertTimer = setTimeout(() => {

        alert.classList.add("leaving");

        setTimeout(() => alert.remove(), 300);

    }, 2800);

}


// Cotes du ticket entourées sur les cartes (et dans le panneau des parieurs).
function syncTicketHighlights() {

    document.body.classList.toggle("ticket-combo", ticketLegs.length > 1);

    document
        .querySelectorAll(".bet-choice-button[data-choice-id]")
        .forEach(button => button.classList.toggle(
            "in-ticket",
            ticketLegs.some(leg => leg.choiceId === button.dataset.choiceId)
        ));

}


// Paris rechargés : ceux qui ne sont plus jouables sortent du ticket.
function pruneTicket(bets) {

    const oddsBefore = ticketOdds();

    lastLoadedBets = bets;

    const before = ticketLegs.length;

    ticketLegs = ticketLegs.filter(leg => {

        const bet = ticketBet(bets.find(item => item.id === leg.betId));

        return bet &&
            (bet.status === "open" || isMyDraft(bet)) &&
            !isBetClosed(bet) &&
            !isBlockedTarget(bet) &&
            bet.bet_choices?.some(choice => choice.id === leg.choiceId);

    });

    const ticket = document.getElementById("bet-ticket");

    if (ticketLegs.length !== before || (ticket && !ticket.firstElementChild)) {

        renderTicket();

    } else if (ticketLegs.length > 0 && ticketOdds() !== oddsBefore) {

        // Cotes qui bougent : la cote du ticket a changé.
        renderTicket({ bump: true });

    }

}


function renderTicket({ bump = false } = {}) {

    const ticket =
        document.getElementById("bet-ticket");

    if (!ticket) {
        return;
    }

    // Taille et positions avant de redessiner : le ticket grandit ensuite en douceur.
    const previousLayout =
        ticketLayout(ticket);

    // Place du journal des nouveautés, juste sous le ticket.
    const journalTop =
        newsJournalTop();

    const entries = ticketEntries();

    const count = entries.length;

    const combo = count > 1;

    if (count === 0) {

        ticketOpen = false;

    }

    // Ticket qui se vide : il disparaît en fondu au lieu de s'effacer d'un coup.
    if (count === 0 && document.body.classList.contains("ticket-has-legs")) {

        fadeOutTicket(ticket);

    }

    document.body.classList.toggle("ticket-has-legs", count > 0);

    ticket.classList.toggle("live", count > 0);

    ticket.classList.toggle("open", ticketOpen);

    clearInterval(ticketTimer);

    ticketTimer = null;


    // Passage mise simple ↔ combiné : l'étiquette fait une petite animation.
    const previousKind =
        ticket.querySelector(".t-kind");

    const kindSwitch =
        previousKind && count > 0 && previousKind.classList.contains("combo") !== combo
            ? " t-kind-switch"
            : "";

    const kind = count === 0
        ? ""
        : combo
            ? `<span class="t-kind combo${kindSwitch}">Combiné · ${count}</span>`
            : `<span class="t-kind${kindSwitch}">Mise simple</span>`;

    const odds = ticketOdds(entries);

    const boost = combo ? comboBoost(count) : 0;

    // Boost qui change (+5 % → +10 %…) : le pourcentage rebondit et brille.
    const previousBoost =
        Number(ticket.querySelector("[data-ticket-boost-pct]")?.dataset.ticketBoostPct) || 0;

    const boostPct = Math.round(boost * 100);

    const boostChanged = previousBoost > 0 && boostPct > 0 && boostPct !== previousBoost;

    const boostUp = boostChanged && boostPct > previousBoost;


    ticket.innerHTML = `

        <button type="button" class="ticket-bar" data-ticket-toggle>
            ${kind}
            <b class="ticket-bar-odds${bump ? " bump" : ""}">${oddsText(odds, { comma: true, times: true })}</b>
            <span class="ticket-bar-arrow">▲</span>
        </button>

        <div class="ticket-body">

            <div class="leaderboard-header ticket-header">
                ${kind}
                ${count ? `<button type="button" class="ticket-clear" data-ticket-clear>Vider</button>` : ""}
                <button type="button" class="ticket-close" data-ticket-toggle aria-label="Replier">▼</button>
            </div>

            ${count === 0
                ? `<p class="ticket-empty">Clique sur une cote pour parier. Ajoutes-en d'autres (paris différents) pour faire un combiné.</p>`
                : `
                <div class="ticket-legs">
                    ${entries.map(entry => `
                        <div class="ticket-leg${previousLayout.tops.has("leg-" + entry.bet.id) ? "" : " ticket-leg-new"}">
                            <span class="ticket-leg-text">
                                <b>${escapeHtml(entry.choice.label)}</b>
                                <span class="ticket-leg-question" title="${escapeHtml(entry.bet.question)}">${escapeHtml(entry.bet.question)}</span>
                            </span>
                            <span class="ticket-leg-odds">${oddsText(entry.choice.odds, { comma: true })}</span>
                            <button type="button" class="ticket-leg-remove" data-ticket-remove="${entry.bet.id}" aria-label="Retirer">✕</button>
                        </div>
                    `).join("")}
                </div>

                <div class="ticket-sum">
                    <b class="ticket-odds${bump ? " bump" : ""}">${oddsText(odds, { comma: true, times: true })}</b>
                </div>

                ${boost || (combo && odds >= COMBO_MAX_ODDS)
                    ? `<p class="ticket-boost">${boost ? `<span class="ticket-boost-pct${boostChanged ? (boostUp ? " up" : " down") : ""}" data-ticket-boost-pct="${boostPct}">⚡ Boost +${boostPct} %</span> inclus` : "⚡"}${odds >= COMBO_MAX_ODDS ? (boost ? " · " : " ") + "cote max " + COMBO_MAX_ODDS : ""}</p>`
                    : ""}

                ${!combo && typeof winStreakBoost === "function" && winStreakBoost(myWinStreak())
                    ? `<p class="ticket-boost ticket-streak-boost"><span class="win-streak-flame">🔥</span> Série de ${myWinStreak()} victoires : boost +${Math.round(winStreakBoost(myWinStreak()) * 100)} % inclus</p>`
                    : ""}

                ${ticketDuplicate(entries)
                    ? `<p class="ticket-note ticket-note-duplicate">Tu as déjà fait ce combiné (mêmes paris, mêmes choix). Change un choix ou un pari.</p>`
                    : ""}

                <input
                    type="number"
                    class="ticket-stake"
                    inputmode="numeric"
                    min="${STAKE_MIN}"
                    step="1"
                    placeholder="Ta mise (€)"
                    value="${ticketStake || ""}"
                    data-ticket-stake
                >

                <div class="ticket-chips">
                    ${[50, 100, 200].map(amount => `<button type="button" data-ticket-amount="${amount}">${amount} €</button>`).join("")}
                    <button type="button" class="ticket-chip-max" data-ticket-amount="max">🔥 Max <b data-ticket-max></b></button>
                </div>

                ${typeof ticketBoostHtml === "function" ? ticketBoostHtml() : ""}

                <button type="button" class="primary-button ticket-go" data-ticket-go disabled></button>

                <p class="ticket-rules">
                    Mise de ${formatMoney(STAKE_MIN)} à <b data-ticket-max></b>
                </p>

                <p class="error-message" data-ticket-error></p>
                `}

        </div>

    `;


    ticket.querySelectorAll("[data-ticket-toggle]").forEach(button => {

        button.addEventListener("click", () => {

            ticketOpen = !ticketOpen;

            ticket.classList.toggle("open", ticketOpen);

        });

    });

    ticket.querySelector("[data-ticket-clear]")?.addEventListener("click", () => {

        ticketLegs = [];

        ticketStake = 0;

        renderTicket();

        syncTicketHighlights();

    });

    ticket.querySelectorAll("[data-ticket-remove]").forEach(button => {

        button.addEventListener("click", () => {

            ticketLegs = ticketLegs.filter(leg => leg.betId !== button.dataset.ticketRemove);

            renderTicket({ bump: true });

            syncTicketHighlights();

        });

    });

    const input = ticket.querySelector("[data-ticket-stake]");

    input?.addEventListener("input", () => {

        ticketStake = Number(input.value) || 0;

        updateTicketLive();

    });

    input?.addEventListener("keydown", event => {

        if (event.key === "Enter") {
            placeTicket();
        }

    });

    ticket.querySelectorAll("[data-ticket-amount]").forEach(button => {

        button.addEventListener("click", () => {

            const balance = Math.floor(Number(currentProfile?.balance) || 0);

            ticketStake = button.dataset.ticketAmount === "max"
                ? Math.min(ticketMaxStake(), balance > 0 ? balance : STAKE_MAX)
                : Number(button.dataset.ticketAmount);

            input.value = ticketStake;

            updateTicketLive();

        });

    });

    ticket.querySelector("[data-ticket-go]")?.addEventListener("click", placeTicket);

    ticket.querySelector("[data-ticket-boost]")?.addEventListener("click", event => {

        ticketBoost = !ticketBoost;

        event.currentTarget.classList.toggle("on", ticketBoost);

        updateTicketLive();

    });


    if (count > 0) {

        updateTicketLive();

        // La mise max baisse avec le temps : affichage mis à jour chaque seconde.
        ticketTimer = setInterval(updateTicketLive, 1000);

    }

    animateTicketHeight(ticket, previousLayout);

    // Ticket qui apparaît ou disparaît : le journal glisse vers le bas (ou remonte).
    // Quand le ticket change seulement de taille, le journal suit déjà son animation.
    if (!previousLayout.height !== !ticket.getBoundingClientRect().height) {

        slideNewsJournal(journalTop);

    }

}


/*
    Ticket vidé : une copie reste à sa place et s'efface en douceur
    (le vrai ticket, lui, est caché tout de suite).
*/

function fadeOutTicket(ticket) {

    const rect = ticket.getBoundingClientRect();

    if (!rect.width || !rect.height) {
        return;
    }

    // Sur téléphone, son style dépend de body.ticket-has-legs, retiré juste après : on le recopie.
    const look = getComputedStyle(ticket);

    const ghost = ticket.cloneNode(true);

    ghost.removeAttribute("id");

    ghost.classList.add("bet-ticket-ghost");

    Object.assign(ghost.style, {
        display: "block",
        position: "fixed",
        left: rect.left + "px",
        top: rect.top + "px",
        right: "auto",
        bottom: "auto",
        width: rect.width + "px",
        height: rect.height + "px",
        margin: "0",
        padding: look.padding,
        background: look.background,
        border: look.border,
        borderRadius: look.borderRadius,
        boxShadow: look.boxShadow,
        overflow: "hidden",
        zIndex: "95",
        pointerEvents: "none",
        animation: "none"
    });

    document.body.appendChild(ghost);

    ghost.animate(
        [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: "scale(0.9)" }
        ],
        { duration: 300, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
    ).finished.then(() => ghost.remove()).catch(() => ghost.remove());

}


/*
    Passage en combiné (ou retour en mise simple) : le cadre change de
    taille progressivement et chaque élément glisse de son ancienne place
    à la nouvelle en même temps (rien n'est coupé ni superposé au contour).
    Les éléments nouveaux (cote ajoutée…) apparaissent en fondu.
*/

const TICKET_MOVE = { duration: 350, easing: "cubic-bezier(.4,0,.2,1)" };

const TICKET_BLOCKS =
    ".ticket-header, .ticket-leg, .ticket-sum, .ticket-note, .ticket-boost, " +
    ".ticket-stake, .ticket-chips, .ticket-go, .ticket-rules";

// Repère d'un élément du ticket d'un dessin à l'autre (une cote : son pari).
function ticketBlockKey(element) {

    const remove = element.querySelector("[data-ticket-remove]");

    return remove
        ? "leg-" + remove.dataset.ticketRemove
        : element.classList[0];

}

// Hauteur du ticket et position de ses éléments (par rapport au haut du ticket).
function ticketLayout(ticket) {

    const box = ticket.getBoundingClientRect();

    const tops = new Map();

    ticket.querySelectorAll(TICKET_BLOCKS).forEach(element => {

        const rect = element.getBoundingClientRect();

        if (rect.height) {
            tops.set(ticketBlockKey(element), rect.top - box.top);
        }

    });

    return { height: box.height, tops };

}

function animateTicketHeight(ticket, previous) {

    ticket.getAnimations()
        .filter(animation => animation.id === "ticket-height")
        .forEach(animation => animation.cancel());

    const current = ticketLayout(ticket);

    // Ticket qui apparaît, disparaît, replié ou sans changement de taille : rien à animer.
    if (!previous.height || !current.height || Math.abs(current.height - previous.height) < 2) {
        return;
    }

    ticket.animate(
        [
            { height: previous.height + "px" },
            { height: current.height + "px" }
        ],
        { ...TICKET_MOVE, id: "ticket-height" }
    );

    ticket.querySelectorAll(TICKET_BLOCKS).forEach(element => {

        const key = ticketBlockKey(element);

        if (!current.tops.has(key)) {
            return;
        }

        // Nouvel élément : apparaît sur place.
        if (!previous.tops.has(key)) {

            element.animate(
                [
                    { opacity: 0, transform: "scale(0.96)" },
                    { opacity: 1, transform: "none" }
                ],
                TICKET_MOVE
            );

            return;

        }

        // Élément déjà là : part de son ancienne place et glisse jusqu'à la nouvelle.
        const shift = previous.tops.get(key) - current.tops.get(key);

        if (Math.abs(shift) > 1) {

            element.animate(
                [
                    { transform: `translateY(${shift}px)` },
                    { transform: "none" }
                ],
                TICKET_MOVE
            );

        }

    });

}


// Mise max, gain possible et bouton, sans redessiner le ticket (le champ garde le focus).
function updateTicketLive() {

    const ticket = document.getElementById("bet-ticket");

    const entries = ticketEntries();

    if (!ticket || entries.length === 0) {
        return;
    }

    const odds = ticketOdds(entries);

    const max = formatMoney(ticketMaxStake(entries));

    ticket.querySelectorAll("[data-ticket-max]").forEach(element => {

        element.textContent = max;

    });

    // Gain possible : affiché directement sur le bouton (« Gain potentiel : … »).
    const boosted = ticketBoost && typeof treeBoost !== "undefined" && treeBoost.available;

    const winValue =
        ticketStake * odds * (boosted ? 1.2 : 1);

    const go = ticket.querySelector("[data-ticket-go]");

    if (go) {

        const duplicate = ticketDuplicate(entries);

        const blocked = ticketSingleBlocked(entries) || duplicate;

        const publishing = entries.some(entry => entry.bet.status === "draft");

        go.disabled = !ticketStake || blocked || ticketBusy;

        // Pas encore de mise : bouton éteint et champ de la mise mis en avant.
        ticket.classList.toggle("ticket-awaiting-stake", !ticketStake && !blocked);

        // Mise impossible (pari simple déjà misé, combiné déjà joué) :
        // le bouton change de couleur pour le faire comprendre.
        go.classList.toggle("ticket-go--blocked", blocked);

        if (blocked || !ticketStake) {

            stopTicketWinCount();

            // Pas de mise : le prochain montant tapé part de 0 €.
            ticketWinShown = blocked ? null : 0;

            go.textContent = duplicate
                ? "⛔ Combiné déjà joué"
                : blocked
                ? "⛔ Déjà misé sur ce pari"
                : "Choisis ta mise";

            return;

        }

        const suffix = (boosted ? " 🚀" : "") + (publishing ? " et publier" : "");

        // Gain qui change (mise tapée, cote ajoutée…) : le montant défile jusqu'au
        // nouveau et le bouton pulse (vert s'il monte, rouge s'il baisse).
        if (ticketWinShown !== null && Math.round(winValue) !== Math.round(ticketWinShown)) {

            countTicketWin(go, winValue, suffix);

        } else if (!ticketWinCount) {

            go.textContent = "Gain potentiel : " + formatMoney(winValue) + suffix;

        }

        ticketWinShown = winValue;

    }

}


// Gain affiché sur le bouton du ticket, et défilement en cours vers le nouveau montant.
let ticketWinShown = null;

let ticketWinCount = null;

function stopTicketWinCount() {

    if (ticketWinCount) {
        cancelAnimationFrame(ticketWinCount.frame);
    }

    ticketWinCount = null;

}

function countTicketWin(button, target, suffix) {

    // Un défilement déjà en cours repart du montant affiché à cet instant.
    const from = ticketWinCount ? ticketWinCount.current : ticketWinShown;

    stopTicketWinCount();

    button.classList.remove("gain-up", "gain-down");

    void button.offsetWidth;

    button.classList.add(target > from ? "gain-up" : "gain-down");

    const start = performance.now();

    const count = { current: from, frame: 0 };

    ticketWinCount = count;

    const step = now => {

        const t = Math.min(1, (now - start) / 450);

        const eased = 1 - Math.pow(1 - t, 3);

        count.current = from + (target - from) * eased;

        // Le ticket peut avoir été redessiné entre-temps : on reprend son bouton actuel.
        const go = document.querySelector("#bet-ticket [data-ticket-go]");

        if (go) {
            go.textContent = "Gain potentiel : " + formatMoney(count.current) + suffix;
        }

        if (t < 1) {
            count.frame = requestAnimationFrame(step);
        } else if (ticketWinCount === count) {
            ticketWinCount = null;
        }

    };

    count.frame = requestAnimationFrame(step);

}


async function placeTicket() {

    const ticket = document.getElementById("bet-ticket");

    const entries = ticketEntries();

    const errorElement = ticket?.querySelector("[data-ticket-error]");

    if (!ticket || entries.length === 0 || ticketBusy) {
        return;
    }

    const showError = text => {

        if (errorElement) {
            errorElement.textContent = text;
        }

    };

    showError("");

    const stake = ticketStake;

    const combo = entries.length > 1;


    if (!stake || stake <= 0) {

        showError("Entre un montant valide.");

        return;

    }

    if (!Number.isInteger(stake)) {

        showError("La mise doit être un montant rond (sans centimes).");

        return;

    }

    if (stake < STAKE_MIN || stake > STAKE_MAX) {

        showError("La mise doit être comprise entre " + formatMoney(STAKE_MIN) + " et " + formatMoney(STAKE_MAX) + ".");

        return;

    }

    const maxNow = ticketMaxStake(entries);

    if (stake > maxNow) {

        showError(combo && maxNow >= COMBO_STAKE_MAX
            ? "Mise max d'un combiné : " + formatMoney(COMBO_STAKE_MAX) + "."
            : "Mise max en ce moment" + (combo ? " pour ce combiné" : "") + " : " + formatMoney(maxNow) + " (elle baisse avec le temps).");

        return;

    }

    if (ticketSingleBlocked(entries)) {

        showError("Tu as déjà misé sur ce pari (1 seule mise par pari).");

        return;

    }

    if (ticketDuplicate(entries)) {

        showError("Tu as déjà fait ce combiné (mêmes paris, mêmes choix).");

        return;

    }

    const closed = entries.find(entry => isBetClosed(entry.bet) || isBlockedTarget(entry.bet));

    if (closed) {

        showError("Tu ne peux plus miser sur « " + closed.bet.question + " ».");

        return;

    }


    ticketBusy = true;

    updateTicketLive();

    try {

        // Solde et mise (ou combiné) calculés côté PostgreSQL.
        // p_odds : la cote affichée. Cotes qui bougent (cotes-mouvantes.sql) :
        // si elle a changé entre-temps, la base refuse la mise.
        // p_boost : boost WTF de la semaine (arbre-palier1.sql).
        const boost = ticketBoost && typeof treeBoost !== "undefined" && treeBoost.available;

        const { error } = combo
            ? await supabaseClient.rpc("place_combo", {
                p_choice_ids: entries.map(entry => entry.choice.id),
                p_stake: stake,
                p_odds: ticketOdds(entries),
                p_boost: boost
            })
            : await supabaseClient.rpc("place_bet", {
                p_choice_id: entries[0].choice.id,
                p_stake: stake,
                p_odds: Number(entries[0].choice.odds),
                p_boost: boost
            });

        if (error) {

            // Cote changée : on recharge les paris pour montrer la nouvelle cote.
            if ((error.message || "").includes("a changé")) {
                await displayBets({ quiet: true });
            }

            throw error;

        }

        ticketLegs = [];

        ticketStake = 0;

        ticketOpen = false;

        ticketBusy = false;

        ticketBoost = false;

        if (typeof loadTreeBoost === "function") {
            await loadTreeBoost();
        }

        renderTicket();

        syncTicketHighlights();


        // La mise part du solde vers le perroquet (comme une mise simple).
        flyBills("stake");

        await loadCurrentProfile();

        await displayBets({ quiet: true });

        await displayLeaderboard();

        await displayMyBets();

        await refreshMissions();

    } catch (error) {

        console.error(error);

        ticketBusy = false;

        updateTicketLive();

        showError(error.message || "Impossible de placer la mise.");

    }

}


/* ----- Mes combinés ----- */

async function loadMyCombos() {

    if (!currentUser || !currentGroup) {

        myCombos = [];

        return myCombos;

    }

    const { data, error } = await supabaseClient
        .from("combos")
        .select(`
            id,
            stake,
            odds,
            potential_win,
            created_at,
            claimed_at,
            claimed_amount,
            combo_legs (
                bet_id,
                choice_id,
                odds,
                bets (
                    id,
                    question,
                    status,
                    winner_choice_id,
                    author_id,
                    resolved_at,
                    bet_contests ( status, ends_at ),
                    bet_choices!bet_choices_bet_id_fkey ( id, label )
                )
            )
        `)
        .eq("user_id", currentUser.id)
        .eq("group_id", currentGroup.id)
        .order("created_at", { ascending: false });

    if (error) {

        console.error("Combinés indisponibles (combines.sql lancé ?)", error);

        myCombos = [];

        return myCombos;

    }

    myCombos = data || [];

    return myCombos;

}


/*
    État d'un combiné : open (en attente), lost, won.
    Un pari annulé après contestation fait perdre le combiné.
    Même calcul côté base : combo_state().
*/

function comboState(combo) {

    let lost = 0;

    let pending = 0;

    let won = 0;

    let product = 1;

    (combo.combo_legs || []).forEach(leg => {

        const status = leg.bets?.status;

        if (status === "resolved") {

            if (leg.bets.winner_choice_id === leg.choice_id) {

                won++;

                product *= Number(leg.odds);

            } else {

                lost++;

            }

        } else if (status === "cancelled") {

            lost++;

        } else {

            pending++;

        }

    });

    if (lost > 0) {
        return { status: "lost", payout: 0 };
    }

    if (pending > 0) {
        return { status: "open", payout: 0 };
    }

    if (won === 0) {
        return { status: "refunded", payout: Number(combo.stake) };
    }

    // Gagné : la cote du ticket (plafond du moment où il a été pris, 100 avant le 2026-10-14).
    const odds = Number(combo.odds) || comboOdds(product, won);

    return {
        status: "won",
        payout: Math.round(Number(combo.stake) * odds * 100) / 100
    };

}

// Pari du combiné en cours de contestation (le gain est bloqué), ou null.
function comboContestedBet(combo) {

    return (combo.combo_legs || [])
        .map(leg => leg.bets)
        .find(bet => betContest(bet)?.status === "open") || null;

}

function comboLegLabel(leg) {

    return (leg.bets?.bet_choices || []).find(choice => choice.id === leg.choice_id)?.label || "—";

}

// Combinés terminés pas encore soldés : gain à récupérer ou mise à perdre.
function claimableCombos() {

    return myCombos
        .filter(combo => !combo.claimed_at)
        .map(combo => ({ combo, state: comboState(combo) }))
        .filter(item => item.state.status !== "open");

}

function combosSignature() {

    return myCombos
        .map(combo => combo.id + ":" + (combo.claimed_at ? 1 : 0) + ":" + comboState(combo).status)
        .join(",");

}


// Carte « Combiné gagné » à récupérer (page principale).
function renderComboClaimCard({ combo, state }) {

    const card =
        document.createElement("div");

    card.dataset.betId = "combo-" + combo.id;

    const legs = combo.combo_legs || [];

    const legsHtml = `
        <p class="claim-card-note combo-claim-legs">
            ${legs.map(leg => `${leg.bets?.status === "cancelled" ? "↺" : "✓"} ${escapeHtml(comboLegLabel(leg))}`).join(" · ")}
        </p>
    `;

    const contested = comboContestedBet(combo);

    if (contested) {

        card.className = "bet-card claim-card claim-card--combo claim-card--frozen";

        card.innerHTML = `

            <div class="claim-card-top">
                <span class="claim-card-badge">⚖️ Contestation en cours</span>
                <span class="claim-card-result">🔗 Combiné · ${legs.length} paris</span>
            </div>

            <h3>${escapeHtml(contested.question)}</h3>

            ${legsHtml}

            <button class="claim-card-button">
                🔒 Gain bloqué pendant le vote · fin ${timeLeftLabel(betContest(contested).ends_at)}
            </button>

        `;

        card.addEventListener("click", async () => {

            await refreshContests();

            openContestView(contested.id);

        });

        return card;

    }

    // Combiné perdu : on donne sa mise d'un clic, comme pour un pari perdu.
    if (state.status === "lost") {

        const lostLeg = legs.find(leg =>
            leg.bets?.status === "cancelled" ||
            (leg.bets?.status === "resolved" && leg.bets.winner_choice_id !== leg.choice_id)
        );

        card.className = "bet-card claim-card claim-card--combo claim-card--lose";

        card.innerHTML = `

            <div class="claim-card-top">
                <span class="claim-card-badge">🔗 Combiné perdu</span>
                <span class="claim-card-result">Cote <b>${oddsText(combo.odds, { comma: true, times: true })}</b></span>
            </div>

            <h3>Combiné · ${legs.length} paris</h3>

            <p class="claim-card-note combo-claim-legs">
                ${legs.map(leg => {

                    const bet = leg.bets || {};

                    const mark =
                        bet.status === "cancelled" ? "✗"
                        : bet.status !== "resolved" ? "⏳"
                        : bet.winner_choice_id === leg.choice_id ? "✓"
                        : "✗";

                    return `${mark} ${escapeHtml(comboLegLabel(leg))}`;

                }).join(" · ")}
            </p>

            ${lostLeg ? `<p class="claim-card-note">Perdu sur « ${escapeHtml(lostLeg.bets.question)} »${lostLeg.bets.status === "cancelled" ? " (annulé après contestation)" : ""}</p>` : ""}

            <button class="claim-card-button">
                Perdre la mise (${formatMoney(combo.stake)})
            </button>

        `;

        card.addEventListener("click", () => claimBet(combo.id, false, card, "claim_combo"));

        return card;

    }

    const refunded = state.status === "refunded";

    card.className = "bet-card claim-card claim-card--combo claim-card--win";

    card.innerHTML = `

        <div class="claim-card-top">
            <span class="claim-card-badge">${refunded ? "↺ Combiné remboursé" : "🔗 Combiné gagné"}</span>
            <span class="claim-card-result">Cote <b>${oddsText(refunded ? 1 : state.payout / Number(combo.stake), { comma: true, times: true })}</b></span>
        </div>

        <h3>Combiné · ${legs.length} paris</h3>

        ${legsHtml}

        <button class="claim-card-button">
            💰 Récupérer ${formatMoney(state.payout)}
        </button>

    `;

    card.addEventListener("click", () => claimBet(combo.id, true, card, "claim_combo"));

    return card;

}


// Combinés dépliés dans l'Historique (ils le restent quand la liste se recharge).
const openComboRows = new Set();

function comboLegResult(leg) {

    const bet = leg.bets || {};

    // Un pari annulé fait perdre le combiné : il s'affiche comme perdu.
    return bet.status === "cancelled" ? "lose"
        : bet.status !== "resolved" ? "open"
        : bet.winner_choice_id === leg.choice_id ? "win"
        : "lose";

}

/*
    Ligne d'un combiné dans l'Historique : un parcours de pastilles reliées
    jusqu'au 🏆 (✓ gagné, ✗ perdu, ↺ annulé, pastille qui pulse = en attente).
    Un clic déplie la liste des paris.
*/

function renderComboRow(row, contestButtonShown) {

    const { combo, state, result } = row;

    // Paris terminés d'abord, puis ceux en attente : le parcours avance de gauche à droite.
    const legs = [...(combo.combo_legs || [])].sort((x, y) =>
        (comboLegResult(x) === "open") - (comboLegResult(y) === "open") ||
        String(x.bet_id).localeCompare(String(y.bet_id))
    );

    const results = legs.map(comboLegResult);

    const counted = results.filter(item => item !== "cancelled").length;

    const wonCount = results.filter(item => item === "win").length;

    const item = document.createElement("div");

    item.className =
        "my-bet-item my-bet-row my-bet-row--combo my-bet-row--" + result +
        (result === "win" ? " my-bet-won" : "") +
        (result === "lose" ? " my-bet-lost" : "") +
        (openComboRows.has(combo.id) ? " open" : "");

    item.dataset.result = result;

    item.dataset.combo = "1";

    const icon =
        result === "win" ? "✓"
        : result === "lose" ? "✗"
        : result === "cancelled" ? "↺"
        : "🔗";

    const won = combo.claimed_at ? Number(combo.claimed_amount) : state.payout;

    const amount =
        result === "win" ? "+" + formatMoney(won)
        : result === "lose" ? "−" + formatMoney(combo.stake)
        : result === "cancelled" ? formatMoney(combo.stake) + " rendus"
        : formatMoney(combo.potential_win);

    const mark = legResult =>
        legResult === "win" ? "✓"
        : legResult === "lose" ? "✗"
        : legResult === "cancelled" ? "↺"
        : "";


    // Parcours : pastille, trait, pastille… jusqu'au 🏆 (💥 si perdu).
    const steps = legs.map((leg, index) => {

        const legResult = results[index];

        const previous = results[index - 1];

        const line = index === 0
            ? ""
            : `<span class="combo-step-line${previous === "win" ? " done" : previous === "lose" ? " lose" : ""}"></span>`;

        return line + `
            <span
                class="combo-step combo-step--${legResult}"
                data-tip="${escapeHtml(comboLegLabel(leg) + " · " + (leg.bets?.question || ""))}"
            >${mark(legResult)}</span>
        `;

    }).join("");

    const lastResult = results[results.length - 1];


    // Détail des paris (déplié au clic), avec « Contester » si possible.
    let contestable = false;

    const detail = legs.map((leg, index) => {

        const bet = leg.bets || {};

        const legResult = results[index];

        const contest = betContest(bet);

        let contestHtml =
            contest?.status === "open" ? `<span class="contest-tag">⚖️ Vote en cours</span>`
            : contest?.status === "upheld" ? `<span class="contest-tag">⚖️ Contestation rejetée</span>`
            : contest?.status === "annulled" ? `<span class="contest-tag">⚖️ Annulé après vote</span>`
            : "";

        if (!contestHtml && canContest(bet) && !contestButtonShown.has(bet.id)) {

            contestButtonShown.add(bet.id);

            contestable = true;

            contestHtml = `<button type="button" class="contest-button" data-contest-bet="${bet.id}">⚖️ Contester</button>`;

        }

        return `
            <li class="combo-leg combo-leg--${legResult}">
                <span class="combo-leg-dot">${mark(legResult) || "⏳"}</span>
                <span class="combo-leg-text"><b>${escapeHtml(comboLegLabel(leg))}</b> · ${escapeHtml(bet.question || "")}</span>
                <span class="combo-leg-odds">${oddsText(leg.odds, { comma: true })}</span>
                ${contestHtml}
            </li>
        `;

    }).join("");


    item.innerHTML = `

        <span class="my-bet-dot">${icon}</span>

        <div class="my-bet-text">

            <h3>🔗 Combiné · ${legs.length} paris <span class="combo-chevron">▼</span></h3>

            <p>
                <b class="combo-progress">${wonCount}/${counted}</b> gagnés
                · cote ${oddsText(combo.odds, { comma: true, times: true })}
                · mise ${formatMoney(combo.stake)}
                ${contestable ? " · <span class=\"combo-contest-hint\">⚖️ contestable</span>" : ""}
            </p>

            <div class="combo-steps">
                ${steps}
                <span class="combo-step-line${result === "win" ? " done" : lastResult === "lose" ? " lose" : ""}"></span>
                <span class="combo-step-goal">${result === "lose" ? "💥" : "🏆"}</span>
            </div>

        </div>

        <span class="my-bet-amount">${amount}</span>

        <div class="combo-detail">
            <div>
                <ul class="combo-legs">${detail}</ul>
            </div>
        </div>

    `;

    item.addEventListener("click", () => {

        item.classList.toggle("open");

        if (item.classList.contains("open")) {
            openComboRows.add(combo.id);
        } else {
            openComboRows.delete(combo.id);
        }

    });

    item.querySelectorAll(".contest-button").forEach(button => {

        button.addEventListener("click", event => {

            // Le clic ne replie pas la ligne.
            event.stopPropagation();

            const bet = legs.find(leg => leg.bet_id === button.dataset.contestBet)?.bets;

            const winner = (bet?.bet_choices || []).find(choice => choice.id === bet.winner_choice_id);

            openContestForm(bet, winner?.label);

        });

    });

    return item;

}



/* =========================================================
   7. MES PARIS
========================================================= */

// Filtre actif de l'onglet « Historique » : all, open, win ou lose.
let myBetsFilter = "all";


// Dernière version affichée de l'Historique (pour ne pas le redessiner pour rien).
let myBetsHtml = null;

async function displayMyBets({ cascade = false } = {}) {

    const shown =
        document.getElementById(
            "my-bets-container"
        );


    if (!shown || !currentUser) {

        return;

    }


    if (!shown.firstElementChild) {

        shown.innerHTML =
            "<p>Chargement...</p>";

    }


    /*
        La liste est préparée hors de la page puis échangée d'un coup,
        seulement si elle a changé : plus de « Chargement... » qui coupait
        l'arrivée en cascade des lignes à l'ouverture de l'onglet.
    */

    const container =
        document.createElement("div");

    container.className =
        "my-bets-content";


    try {

        // Contestations du groupe (et fin des votes arrivés à leur terme).
        await refreshContests();

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
                boosted,
                created_at,
                bets!inner (
                    id,
                    question,
                    status,
                    winner_choice_id,
                    group_id,
                    author_id,
                    resolved_at,
                    bet_contests ( status ),
                    bet_choices!bet_choices_bet_id_fkey ( id, label )
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
            .eq(
                "bets.group_id",
                currentGroup?.id
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


        // Paris que j'ai créés (filtre « Mes créations »).
        const { data: createdData, error: createdError } = await supabaseClient
            .from("bets")
            .select(`
                id,
                question,
                status,
                created_at,
                winner_choice_id,
                bet_choices!bet_choices_bet_id_fkey ( id, label, odds ),
                stakes ( stake ),
                bet_contests ( status, penalty )
            `)
            .eq("author_id", currentUser.id)
            .eq("group_id", currentGroup?.id)
            .order("created_at", { ascending: false });

        if (createdError) {

            throw createdError;

        }

        const created = createdData || [];


        // Paris des autres sur lesquels je n'ai pas misé, validés depuis moins de 24 h :
        // on peut quand même les contester (filtre « Autres paris », contestation-sans-mise.sql).
        const { data: othersData, error: othersError } = await supabaseClient
            .from("bets")
            .select(`
                id,
                question,
                status,
                author_id,
                resolved_at,
                winner_choice_id,
                bet_choices!bet_choices_bet_id_fkey ( id, label, odds ),
                stakes ( user_id, stake, choice_id, potential_win ),
                combo_legs ( combos ( user_id ) ),
                bet_contests ( status, penalty )
            `)
            .eq("group_id", currentGroup?.id)
            .eq("status", "resolved")
            .neq("author_id", currentUser.id)
            .gte("resolved_at", new Date(Date.now() - CONTEST_WINDOW_MS).toISOString())
            .order("resolved_at", { ascending: false });

        if (othersError) {

            throw othersError;

        }

        const others = (othersData || []).filter(bet =>
            !(bet.stakes || []).some(stake => stake.user_id === currentUser.id) &&
            !(bet.combo_legs || []).some(leg => leg.combos?.user_id === currentUser.id)
        );


        // Mes combinés (filtre « Combinés », et avec les mises dans les autres filtres).
        const comboRows =
            (await loadMyCombos()).map(combo => {

                const state = comboState(combo);

                return {
                    combo,
                    state,
                    created_at: combo.created_at,
                    result:
                        state.status === "won" ? "win"
                        : state.status === "lost" ? "lose"
                        : state.status === "refunded" ? "cancelled"
                        : "open"
                };

            });


        container.innerHTML = "";


        if ((!data || data.length === 0) && created.length === 0 && comboRows.length === 0 && groupContests.length === 0) {

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
            (data || []).map(stake => ({
                ...stake,
                result:
                    stake.bets.status === "cancelled" ? "cancelled"
                    : stake.bets.status !== "resolved" ? "open"
                    : stake.bets.winner_choice_id === stake.bet_choices.id ? "win"
                    : "lose"
            }));

        const countOf = result =>
            result === "creation"
                ? created.length
                : result === "others"
                ? others.length
                : result === "combo"
                    ? comboRows.length
                    : stakes.filter(s => result === "all" || s.result === result).length +
                      comboRows.filter(row => result === "all" || row.result === result).length;

        /*
            Filtres (le mini bilan gagnés / total misé / total gagné a été retiré le 2026-10-14).
        */

        container.innerHTML = `

            ${renderContestsBlock()}


            <div class="my-bets-filters">

                ${[
                    ["all", "Tous"],
                    ["open", "En cours"],
                    ["win", "Gagnés"],
                    ["lose", "Perdus"],
                    ["combo", "Combinés"],
                    ["creation", "Mes créations"],
                    ["others", "Autres paris"]
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

        // Un seul bouton « Contester » par pari (même avec plusieurs mises).
        const contestButtonShown = new Set();

        container.querySelectorAll("[data-contest-id]").forEach(row => {

            row.addEventListener("click", () => openContestView(row.dataset.contestId));

        });


        // Mises et combinés mêlés, du plus récent au plus ancien.
        [...stakes, ...comboRows]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .forEach(
            stake => {

                if (stake.combo) {

                    rows.appendChild(renderComboRow(stake, contestButtonShown));

                    return;

                }

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
                    : stake.result === "cancelled" ? "↺"
                    : "⏳";

                const amount =
                    stake.result === "win" ? "+" + formatMoney(stake.potential_win)
                    : stake.result === "lose" ? "−" + formatMoney(stake.stake)
                    : stake.result === "cancelled" ? formatMoney(stake.stake) + " rendus"
                    : formatMoney(stake.potential_win);


                // Contester (une seule fois par pari, pendant 24 h après la validation).
                const contest = betContest(bet);

                const contestHtml =
                    contest?.status === "open" ? `<span class="contest-tag">⚖️ Vote en cours</span>`
                    : contest?.status === "upheld" ? `<span class="contest-tag">⚖️ Contestation rejetée</span>`
                    : contest?.status === "annulled" ? `<span class="contest-tag">⚖️ Annulé après vote</span>`
                    : canContest(bet) && !contestButtonShown.has(bet.id)
                        ? `<button type="button" class="contest-button" data-contest-bet="${bet.id}">⚖️ Contester</button>`
                    : "";

                if (contestHtml.includes("contest-button")) {
                    contestButtonShown.add(bet.id);
                }


                item.innerHTML = `

                    <span class="my-bet-dot">${icon}</span>

                    <div class="my-bet-text">

                        <h3>${escapeHtml(bet.question)}</h3>

                        <p>
                            ${escapeHtml(choice.label)}
                            · ${oddsText(Number(stake.potential_win) / Number(stake.stake) / (stake.boosted ? 1.2 : 1) || Number(choice.odds))}
                            · mise ${formatMoney(stake.stake)}${stake.boosted ? " · 🚀 boost +20 %" : ""}
                        </p>

                        ${contestHtml}

                    </div>

                    <span class="my-bet-amount">${amount}</span>

                `;


                item.querySelector(".contest-button")?.addEventListener("click", () => {

                    const winner = (bet.bet_choices || [])
                        .find(other => other.id === bet.winner_choice_id);

                    openContestForm(bet, winner?.label);

                });


                rows.appendChild(item);

            }
        );


        created.forEach(bet => {

            const choices = bet.bet_choices || [];

            const done = bet.status === "resolved";

            const cancelled = bet.status === "cancelled";

            // Brouillon : pas encore publié, il faut miser dessus.
            const draft = bet.status === "draft";

            const contest = betContest(bet);

            const winner = choices.find(choice => choice.id === bet.winner_choice_id);

            const totalOnBet = (bet.stakes || []).reduce(
                (sum, s) => sum + Number(s.stake),
                0
            );

            const item = document.createElement("div");

            item.className =
                "my-bet-item my-bet-row my-bet-row--creation" +
                (done ? "" : " my-bet-row--open");

            item.dataset.result = "creation";

            item.innerHTML = `

                <span class="my-bet-dot">${cancelled ? "↺" : done ? "✓" : draft ? "📝" : "⏳"}</span>

                <div class="my-bet-text">

                    <h3>${escapeHtml(bet.question)}</h3>

                    <p>
                        ${choices.map(choice => escapeHtml(choice.label) + " " + oddsText(choice.odds)).join(" · ")}
                        ${cancelled ? "" : done && winner ? " · 🏆 " + escapeHtml(winner.label) : done ? "" : draft ? " · brouillon, mise dessus pour le publier" : " · en cours"}
                    </p>

                    ${cancelled
                        ? `<span class="contest-tag">⚖️ Validation annulée après vote${contest?.penalty > 0 ? " · amende −" + formatMoney(contest.penalty) : ""}</span>`
                        : contest?.status === "open" ? `<span class="contest-tag">⚖️ Contesté · vote en cours</span>`
                        : contest?.status === "upheld" ? `<span class="contest-tag">⚖️ Contestation rejetée</span>`
                        : ""
                    }

                </div>

                <span class="my-bet-amount">${formatMoney(totalOnBet)} misés</span>

            `;

            rows.appendChild(item);

        });


        // Autres paris (sans mise de ma part) : contestables pendant 24 h.
        others.forEach(bet => {

            const contest = betContest(bet);

            const winner = (bet.bet_choices || []).find(choice => choice.id === bet.winner_choice_id);

            // Argent gagné (gains des gagnants) et perdu (mises des perdants), mises simples.
            const winning = (bet.stakes || []).filter(stake => stake.choice_id === bet.winner_choice_id);

            const won = winning.reduce((sum, stake) => sum + Number(stake.potential_win), 0);

            const lost = (bet.stakes || [])
                .filter(stake => stake.choice_id !== bet.winner_choice_id)
                .reduce((sum, stake) => sum + Number(stake.stake), 0);

            const item = document.createElement("div");

            item.className = "my-bet-item my-bet-row my-bet-row--others";

            item.dataset.result = "others";

            item.innerHTML = `

                <span class="my-bet-dot">👀</span>

                <div class="my-bet-text">

                    <h3>${escapeHtml(bet.question)}</h3>

                    <p>
                        ${winner ? "🏆 " + escapeHtml(winner.label) + " · " : ""}validé ${typeof toastTimeLabel === "function" ? toastTimeLabel(bet.resolved_at) : ""} · contestable encore ${timeLeftLabel(new Date(bet.resolved_at).getTime() + CONTEST_WINDOW_MS).replace("dans ", "")}
                    </p>

                    ${contest?.status === "open" ? `<span class="contest-tag">⚖️ Vote en cours</span>`
                        : contest?.status === "upheld" ? `<span class="contest-tag">⚖️ Contestation rejetée</span>`
                        : contest?.status === "annulled" ? `<span class="contest-tag">⚖️ Annulé après vote</span>`
                        : canContest(bet) ? `<button type="button" class="contest-button" data-contest-bet="${bet.id}">⚖️ Contester</button>`
                        : ""}

                </div>

                <span class="my-bet-amount others-money">
                    <span class="text-win">+${formatMoney(won)}</span>
                    <span class="others-lost">−${formatMoney(lost)}</span>
                </span>

            `;

            item.querySelector(".contest-button")?.addEventListener("click", () => {

                openContestForm(bet, winner?.label);

            });

            rows.appendChild(item);

        });


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
                    // « Tous » montre les mises ; créations et autres paris n'apparaissent qu'avec leur filtre.
                    myBetsFilter === "combo"
                        ? row.dataset.combo !== "1"
                        : myBetsFilter === "all"
                        ? row.dataset.result === "creation" || row.dataset.result === "others"
                        : row.dataset.result !== myBetsFilter
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

    } finally {

        // Rien n'a changé : on garde les lignes affichées (et leur animation en cours).
        const unchanged =
            container.innerHTML === myBetsHtml &&
            shown.firstElementChild?.classList.contains("my-bets-content");

        if (!unchanged) {

            myBetsHtml =
                container.innerHTML;

            shown.replaceChildren(container);

            if (cascade && typeof cascadeIn === "function") {

                cascadeIn(container);

            }

        }

    }

}



/* =========================================================
   CONTESTATIONS (voir contestations.sql)
   Un joueur qui a misé peut contester un pari validé pendant 24 h.
   Le jury (membres qui n'ont pas misé, sans le créateur) vote 24 h :
   validation annulée = tout le monde remboursé, amende de 10 % pour le créateur.
========================================================= */

const CONTEST_WINDOW_MS = 24 * 3600 * 1000;

let groupContests = [];

// Contestation d'un pari (objet ou tableau selon la jointure Supabase).
function betContest(bet) {

    const contest = bet?.bet_contests;

    return Array.isArray(contest) ? contest[0] || null : contest || null;

}

function canContest(bet) {

    return Boolean(
        bet &&
        bet.status === "resolved" &&
        bet.author_id !== currentUser?.id &&
        bet.resolved_at &&
        Date.now() - new Date(bet.resolved_at) < CONTEST_WINDOW_MS &&
        !betContest(bet)
    );

}

// « dans 13 h » / « dans 25 min »
function timeLeftLabel(date) {

    const ms = new Date(date) - Date.now();

    if (ms <= 0) {
        return "terminé";
    }

    const minutes = Math.ceil(ms / 60000);

    return minutes >= 60
        ? "dans " + Math.floor(minutes / 60) + " h"
        : "dans " + minutes + " min";

}

// Charge les contestations du groupe (termine au passage les votes échus)
// et met une pastille sur l'onglet Historique s'il y a un vote qui m'attend.
async function refreshContests() {

    if (!currentGroup) {
        return [];
    }

    const { data, error } = await supabaseClient.rpc("group_contests", {
        p_group: currentGroup.id
    });

    if (error) {

        console.error("Contestations indisponibles (contestations.sql lancé ?)", error);

        groupContests = [];

        return groupContests;

    }

    groupContests = data || [];

    const waitingVote = groupContests.some(
        contest => contest.status === "open" && contest.my_role === "juror" && contest.my_vote === null
    );

    document
        .querySelector('.nav-button[data-page="my-bets-page"]')
        ?.classList.toggle("has-reward", waitingVote);

    // Votes terminés pas encore vus : animation de la balance (animations.js).
    if (typeof checkContestResults === "function") {
        checkContestResults(groupContests);
    }

    return groupContests;

}

function contestStatusLabel(contest) {

    if (contest.status === "annulled") {
        return "❌ Validation annulée · tout le monde remboursé";
    }

    if (contest.status === "upheld") {
        return "✅ Validation maintenue";
    }

    return "⚖️ Vote en cours · " + (contest.votes_annul + contest.votes_keep) + " / " + contest.jury_size +
        " votes · fin " + timeLeftLabel(contest.ends_at);

}

// Bloc « Contestations » en haut de l'Historique.
function renderContestsBlock() {

    if (groupContests.length === 0) {
        return "";
    }

    return `
        <div class="contests-block">

            <h2 class="contests-title">⚖️ Contestations</h2>

            ${groupContests.map(contest => {

                const mustVote =
                    contest.status === "open" && contest.my_role === "juror" && contest.my_vote === null;

                return `
                    <button
                        type="button"
                        class="contest-row contest-row--${contest.status}${mustVote ? " contest-row--vote" : ""}"
                        data-contest-id="${contest.bet_id}"
                    >
                        <span class="contest-row-text">
                            <b>${escapeHtml(contest.question)}</b>
                            <small>${contestStatusLabel(contest)}</small>
                        </span>
                        <span class="contest-row-action">${mustVote ? "Voter" : "Voir"}</span>
                    </button>
                `;

            }).join("")}

        </div>
    `;

}


/* ----- Fenêtre de contestation ----- */

function contestModalBody() {

    return document.getElementById("contest-modal-body");

}

function showContestModal() {

    document.getElementById("contest-modal").classList.remove("hidden");

}

// Contester : petite explication + raison facultative.
function openContestForm(bet, winnerLabel) {

    contestModalBody().innerHTML = `

        <h2>⚖️ Contester ce pari</h2>

        <p class="contest-question">${escapeHtml(bet.question)}</p>

        <p class="contest-line">Résultat validé : <b>${escapeHtml(winnerLabel || "—")}</b></p>

        <ul class="contest-rules">
            <li>Les membres qui <b>n'ont pas misé</b> sur ce pari votent pendant 24 h.</li>
            <li>Pendant le vote, les gains de ce pari sont bloqués.</li>
            <li>Validation annulée : tout le monde récupère sa mise, et le créateur paie une amende de 10 % du total misé.</li>
            <li>Un pari ne peut être contesté qu'une seule fois.</li>
        </ul>

        <label for="contest-reason">Pourquoi ? (facultatif)</label>

        <textarea
            id="contest-reason"
            maxlength="200"
            rows="2"
            placeholder="Ex : le match s'est fini 2-1, pas 1-1."
        ></textarea>

        <p id="contest-error" class="error-message"></p>

        <button type="button" id="contest-confirm" class="primary-button contest-confirm">
            ⚖️ Contester et lancer le vote
        </button>

    `;

    document.getElementById("contest-confirm").addEventListener("click", async event => {

        const button = event.currentTarget;

        button.disabled = true;

        const { error } = await supabaseClient.rpc("open_contest", {
            p_bet_id: bet.id,
            p_reason: document.getElementById("contest-reason").value
        });

        if (error) {

            document.getElementById("contest-error").textContent = error.message;

            button.disabled = false;

            return;

        }

        await refreshAfterContest();

        openContestView(bet.id);

    });

    showContestModal();

}

// Voir une contestation (et voter si je fais partie du jury).
function openContestView(betId) {

    const contest = groupContests.find(item => item.bet_id === betId);

    if (!contest) {
        return;
    }

    const votes = contest.votes_annul + contest.votes_keep;

    const annulPct = contest.jury_size ? contest.votes_annul / contest.jury_size * 100 : 0;

    const keepPct = contest.jury_size ? contest.votes_keep / contest.jury_size * 100 : 0;

    const canVote =
        contest.status === "open" && contest.my_role === "juror" && contest.my_vote === null;

    const roleNote =
        contest.status !== "open" ? ""
        : contest.my_role === "juror" && contest.my_vote !== null
            ? `Tu as voté : <b>${contest.my_vote ? "annuler la validation" : "garder la validation"}</b>.`
        : contest.my_role === "author" ? "C'est ton pari : tu ne votes pas."
        : contest.my_role === "bettor" ? "Tu as misé sur ce pari : tu ne votes pas (jury neutre)."
        : "";

    const result =
        contest.status === "annulled"
            ? `<p class="contest-result contest-result--annulled">❌ Validation annulée : tout le monde a récupéré sa mise.
               ${contest.penalty > 0 ? `Amende de <b>${formatMoney(contest.penalty)}</b> pour ${escapeHtml(contest.author_name || "le créateur")}.` : ""}</p>`
        : contest.status === "upheld"
            ? `<p class="contest-result contest-result--upheld">✅ Validation maintenue : les gains sont débloqués.</p>`
        : "";

    contestModalBody().innerHTML = `

        <h2>⚖️ Contestation</h2>

        <p class="contest-question">${escapeHtml(contest.question)}</p>

        <p class="contest-line">Résultat validé par ${escapeHtml(contest.author_name || "—")} : <b>${escapeHtml(contest.winner_label || "—")}</b></p>

        <p class="contest-line">Contesté par <b>${escapeHtml(contest.opened_by_name || "—")}</b>${contest.reason ? ` : « ${escapeHtml(contest.reason)} »` : ""}</p>

        ${result}

        <div class="contest-votes">

            <div class="contest-votes-bar">
                <span class="contest-votes-annul" style="width:${annulPct}%"></span>
                <span class="contest-votes-keep" style="width:${keepPct}%"></span>
            </div>

            <div class="contest-votes-legend">
                <span>❌ Annuler : <b>${contest.votes_annul}</b></span>
                <span>${votes} / ${contest.jury_size} votes</span>
                <span>✅ Garder : <b>${contest.votes_keep}</b></span>
            </div>

            ${contest.status === "open"
                ? `<p class="contest-hint">Fin du vote ${timeLeftLabel(contest.ends_at)}, ou dès qu'une majorité du jury (${Math.floor(contest.jury_size / 2) + 1} votes) est atteinte.</p>`
                : ""
            }

        </div>

        <div class="contest-jury" id="contest-jury">
            <h4>👥 ${contest.status === "open" ? "Qui peut voter" : "Qui a voté"}</h4>
            <p class="contest-hint">Chargement…</p>
        </div>

        ${roleNote ? `<p class="contest-hint">${roleNote}</p>` : ""}

        ${canVote
            ? `
                <div class="contest-vote-buttons">
                    <button type="button" class="contest-vote contest-vote--annul" data-annul="true">❌ Annuler la validation</button>
                    <button type="button" class="contest-vote contest-vote--keep" data-annul="false">✅ Garder la validation</button>
                </div>
            `
            : ""
        }

        <p id="contest-error" class="error-message"></p>

    `;

    contestModalBody().querySelectorAll(".contest-vote").forEach(button => {

        button.addEventListener("click", async () => {

            contestModalBody().querySelectorAll(".contest-vote").forEach(other => other.disabled = true);

            const { data, error } = await supabaseClient.rpc("vote_contest", {
                p_bet_id: betId,
                p_annul: button.dataset.annul === "true"
            });

            if (error) {

                document.getElementById("contest-error").textContent = error.message;

                contestModalBody().querySelectorAll(".contest-vote").forEach(other => other.disabled = false);

                return;

            }

            // Mon vote a terminé le vote : la fenêtre se ferme et le verdict
            // s'affiche avec la balance (lancé par refreshContests).
            if (data === "annulled" || data === "upheld") {

                document.getElementById("contest-modal").classList.add("hidden");

                await refreshAfterContest();

                return;

            }

            await refreshAfterContest();

            openContestView(betId);

        });

    });

    showContestModal();

    loadContestJury(contest);

}

/*
    Liste du jury dans la fenêtre de contestation (contest_jury_names,
    contest-jury-noms.sql) : qui peut voter et qui l'a déjà fait.
    Le sens de chaque vote reste secret.
*/
async function loadContestJury(contest) {

    const { data, error } = await supabaseClient.rpc("contest_jury_names", {
        p_bet_id: contest.bet_id
    });

    const box = document.getElementById("contest-jury");

    if (!box) {
        return;
    }

    const list = box.querySelector(".contest-hint");

    if (error) {

        console.error(error);

        list.textContent = "Impossible de charger le jury.";

        return;

    }

    const jury = data || [];

    if (!jury.length) {

        list.textContent = contest.status === "open" ? "Personne pour l'instant." : "Personne n'a voté.";

        return;

    }

    list.outerHTML = `
        <div class="contest-jury-list">
            ${jury.map(member => `
                <span class="contest-jury-member${member.voted ? " voted" : ""}">
                    ${member.voted ? "✓" : "⏳"} ${escapeHtml(member.username)}
                </span>
            `).join("")}
        </div>
    `;

}

// Après une contestation ou un vote : contestations, soldes, paris et historique à jour.
async function refreshAfterContest() {

    await refreshContests();

    await loadCurrentProfile();

    await displayBets({ quiet: true, force: true });

    await displayMyBets();

}

function setupContestModal() {

    const modal = document.getElementById("contest-modal");

    document
        .getElementById("close-contest-modal")
        ?.addEventListener("click", () => modal.classList.add("hidden"));

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
            .eq(
                "group_id",
                currentGroup?.id
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
                                        <strong>${oddsText(choice.odds)}</strong>
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
                                ${bet.deadline_at ? "Se ferme le " + formatDeadline(bet.deadline_at) + " · " : ""}${choices.map(choice => escapeHtml(choice.label) + " " + oddsText(choice.odds)).join(" · ")}
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
            .select("user_id, choice_id, stake, potential_win, profiles!stakes_user_id_fkey ( username, gold_frame_until, name_color_until, cosmetics )")
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
                        <span class="resolve-pick-odds">${oddsText(choice.odds)} →</span>
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

        ${commissionLineHtml(creatorCommission(bet, winner.id, stakes))}

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

/*
    Détail des parieurs : la carte se déplie sur place.
    Une copie exacte de la carte (même taille, mêmes marges, même contenu)
    prend sa place, puis s'allonge vers le bas pour révéler la liste des
    parieurs. Rien dans la carte ne bouge ni ne change de taille.
    Les cotes de la carte restent cliquables.
*/

const PANEL_SPEED = 1;

const PANEL_EASE = "cubic-bezier(.2,.8,.2,1)";

let stakesPanel = null;

function isStakesPanelOpen() {

    return stakesPanel !== null;

}


/*
    La copie de la carte garde sa vraie boîte (bordure, coins arrondis, ombre) :
    c'est sa hauteur qui s'allonge, et la liste des parieurs se dévoile au
    même rythme. Le bas de la carte reste donc toujours propre, au départ
    comme à l'arrivée.
*/

function stakesMoreClosed(popHeight, cardHeight) {

    return `inset(0 0 ${Math.max(0, popHeight - cardHeight)}px 0)`;

}

/*
    Répartition des mises (barre + pourcentage) : cachée sur la carte,
    visible sur la copie dépliée. Sa hauteur suit le dépliage pour que la
    copie colle toujours à la carte (sinon les cotes sautent au départ
    et au retour).
*/

function animateChoicePct(pop, open, options) {

    pop.querySelectorAll(".choice-bar-track, .choice-pct").forEach(element => {

        const style = getComputedStyle(element);

        if (style.display === "none") {
            return;
        }

        const shown = {
            height: element.getBoundingClientRect().height + "px",
            marginTop: style.marginTop,
            opacity: 1
        };

        const hidden = { height: "0px", marginTop: "0px", opacity: 0 };

        element.animate(open ? [hidden, shown] : [shown, hidden], options);

    });

}

/*
    Regroupe les mises d'un même joueur sur un même choix en une seule
    ligne, dans l'ordre où elles ont été placées.
*/

function groupStakesByPlayer(stakes) {

    const sorted = [...stakes].sort(
        (x, y) => new Date(x.created_at || 0) - new Date(y.created_at || 0)
    );

    const groups = new Map();

    sorted.forEach(stake => {

        const key = stake.user_id + "|" + stake.choice_id;

        if (!groups.has(key)) {

            groups.set(key, {
                profiles: stake.profiles,
                choiceId: stake.choice_id,
                stakes: []
            });

        }

        groups.get(key).stakes.push(stake);

    });

    return [...groups.values()];

}


async function openStakesModal(bet, card) {

    if (stakesPanel || !card) {
        return;
    }

    const T = ms => ms * PANEL_SPEED;

    const pop = document.getElementById("stakes-panel");

    const backdrop = document.getElementById("stakes-panel-backdrop");

    // Position réelle de la carte : sans son éventuelle inclinaison (suivi de la souris).
    const tiltedTransform = card.style.transform;

    card.style.transition = "none";

    card.style.transform = "";

    const cardRect = card.getBoundingClientRect();


    // Copie de la carte : mêmes classes, même contenu (sans reflet en cours).
    // Sans les classes d'animation d'entrée, qui feraient clignoter la copie
    // (elle repartirait de « invisible »).
    pop.className = "stakes-pop " + card.className
        .replace("bet-card-live-in", "")
        .replace("cascade-in", "")
        .replace("tilting", "")
        .trim();

    pop.innerHTML = card.innerHTML;

    pop.querySelectorAll(".bet-live-shine").forEach(element => element.remove());

    // Le bouton de validation reste dans la copie dépliée (voir plus bas) ;
    // le reste du mode validation n'en fait pas partie.
    pop.querySelectorAll(".validate-bilan, .validate-hint, .validate-tag")
        .forEach(element => element.remove());

    // La pastille de validation ne rejoue pas, à l'ouverture, une animation
    // déjà jouée sur la carte (le « non » qui vibre, l'arrivée).
    pop.querySelectorAll(".validate-fab")
        .forEach(fab => fab.classList.remove("validate-fab-no", "validate-enter"));


    // Liste des parieurs sous le contenu de la carte.
    const stakes = bet.stakes || [];

    // Mises en combiné sur ce pari (voir combines.sql).
    const comboLegs = (bet.combo_legs || [])
        .filter(leg => leg.combos)
        .sort((x, y) => new Date(x.combos.created_at || 0) - new Date(y.combos.created_at || 0));

    const more = document.createElement("div");

    more.className = "stakes-pop-more";

    more.innerHTML = `
        <h3 class="stakes-pop-title">Détail des parieurs</h3>

        <div class="stakes-pop-list">
            ${stakes.length === 0 && comboLegs.length === 0
                ? `<div class="empty-state">Aucune mise pour le moment.</div>`
                : groupStakesByPlayer(stakes).map(group => {

                    const choice = bet.bet_choices.find(item => item.id === group.choiceId);

                    // Mises du même joueur sur le même choix : 800+50+50 €
                    const amounts = group.stakes
                        .map(stake => Number(stake.stake).toLocaleString("fr-FR"))
                        .join("+");

                    const totalWin = group.stakes
                        .reduce((sum, stake) => sum + Number(stake.potential_win), 0);

                    return `
                        <div class="stake-row">
                            <div class="stake-row-header">
                                <strong>${styledName(group.profiles)}</strong>
                                <span class="stake-choice-badge">${escapeHtml(choice?.label || "Choix supprimé")}</span>
                            </div>
                            <div class="stake-row-details">
                                <span>💰 ${amounts} €</span>
                                <span>🎲 ${oddsText(totalWin / group.stakes.reduce((sum, stake) => sum + Number(stake.stake), 0) || Number(choice?.odds || 0))}</span>
                                <span>🏆 ${formatMoney(totalWin)}</span>
                            </div>
                        </div>
                    `;

                }).join("") + comboLegs.map(leg => {

                    const combo = leg.combos;

                    const choice = bet.bet_choices.find(item => item.id === leg.choice_id);

                    const count = (combo.combo_legs || []).length;

                    return `
                        <div class="stake-row stake-row--combo">
                            <div class="stake-row-header">
                                <strong>${styledName(combo.profiles)}</strong>
                                <span class="stake-choice-badge">${escapeHtml(choice?.label || "Choix supprimé")}</span>
                                <span class="stake-combo-badge">🔗 Combiné · ${count} paris</span>
                            </div>
                            <div class="stake-row-details">
                                <span>💰 ${Number(combo.stake).toLocaleString("fr-FR")} €</span>
                                <span>🎲 ${oddsText(choice?.odds || 0)} · combiné ${oddsText(combo.odds, { times: true })}</span>
                                <span>🏆 ${formatMoney(combo.potential_win)}</span>
                            </div>
                        </div>
                    `;

                }).join("")
            }
        </div>

        <div class="stakes-pop-close-row">
            <button type="button" class="stakes-pop-close">Réduire ▲</button>
        </div>
    `;

    pop.appendChild(more);


    // Même place et même largeur que la carte.
    pop.style.left = cardRect.left + "px";

    pop.style.width = cardRect.width + "px";

    pop.style.top = "0px";

    pop.classList.remove("hidden");

    pop.style.visibility = "hidden";

    // Même couleur de bordure que la carte à cet instant (survol, urgence...).
    pop.style.borderColor = getComputedStyle(card).borderColor;


    // Si la liste est trop longue pour l'écran, elle défile à l'intérieur.
    const list = pop.querySelector(".stakes-pop-list");

    const room = window.innerHeight - 40;

    const overflow = pop.getBoundingClientRect().height - room;

    if (overflow > 0) {

        list.style.maxHeight = Math.max(120, list.getBoundingClientRect().height - overflow) + "px";

        list.style.overflowY = "auto";

    }

    const popHeight = pop.getBoundingClientRect().height;

    const top = Math.max(20, Math.min(cardRect.top, window.innerHeight - popHeight - 20));

    pop.style.top = top + "px";

    pop.style.visibility = "";


    // Les animations en boucle (compte à rebours urgent) continuent là où
    // elles en étaient sur la carte, sans repartir de zéro.
    card.getAnimations().forEach(source => {

        if (!source.animationName) {
            return;
        }

        const twin = pop.getAnimations().find(
            other => other.animationName === source.animationName
        );

        if (twin) {

            twin.currentTime = source.currentTime;

        }

    });


    // Clic sur une cote : ouvre la fenêtre de mise (comme sur la carte).
    pop.querySelectorAll(".bet-choice-button[data-choice-id]").forEach(button => {

        button.addEventListener("click", () => {

            const choice = bet.bet_choices.find(item => item.id === button.dataset.choiceId);

            if (choice) {

                // La cote rejoint le ticket (le panneau reste ouvert).
                toggleTicketLeg(bet, choice);

            }

        });

    });

    pop.querySelector(".stakes-pop-close").addEventListener("click", closeStakesPanel);

    // Pastille rouge « Supprimer » : même chose que sur la carte ; le panneau se ferme après.
    pop.querySelector("[data-delete-bet]")?.addEventListener("click", async event => {

        event.stopPropagation();

        if (await deleteBetFromFab(event.currentTarget)) {
            closeStakesPanel();
        }

    });

    // Pastille « En attente d'un parieur » : pas encore validable, elle fait « non ».
    pop.querySelector("[data-validate-wait]")?.addEventListener("click", event => {

        event.stopPropagation();

        const fab = event.currentTarget;

        fab.classList.remove("validate-fab-no");

        void fab.offsetWidth;

        fab.classList.add("validate-fab-no");

        fab.addEventListener("animationend", () => fab.classList.remove("validate-fab-no"), { once: true });

    });

    // Pastille « Valider » : la carte se replie et passe en mode validation.
    pop.querySelector("[data-validate-toggle]")?.addEventListener("click", event => {

        event.stopPropagation();

        cardValidation = { betId: bet.id, pick: null };

        validationRevealed = { betId: null, hint: false, bilan: false };

        validationFade = { betId: bet.id, to: true };

        betsRefreshPending = true;

        closeStakesPanel();

    });

    // Un clic ailleurs sur la copie de la carte ne fait rien (le détail est déjà ouvert).


    stakesPanel = { card, bet, busy: true, top, popHeight, cardHeight: cardRect.height };

    card.style.visibility = "hidden";

    backdrop.classList.remove("hidden");

    backdrop.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: T(300), fill: "backwards" }
    );

    more.animate(
        [
            { clipPath: stakesMoreClosed(popHeight, cardRect.height) },
            { clipPath: "inset(0 0 0 0)" }
        ],
        { duration: T(520), easing: PANEL_EASE }
    );

    animateChoicePct(pop, true, { duration: T(520), easing: PANEL_EASE });

    // La carte était peut-être légèrement inclinée (suivi de la souris) :
    // la copie démarre avec la même inclinaison puis se remet à plat.
    const tilt = tiltedTransform || "";

    await pop.animate(
        [
            { transform: `translateY(${cardRect.top - top}px) ${tilt}`.trim(), height: cardRect.height + "px" },
            { transform: "none", height: popHeight + "px" }
        ],
        { duration: T(520), easing: PANEL_EASE }
    ).finished.catch(() => {});

    if (stakesPanel) {

        stakesPanel.busy = false;

    }

}

/*
    Fermeture : la fenêtre se replie dans la carte, qui réapparaît.
    En mode « instant » (clic sur une cote, autre fenêtre) pas d'animation.
*/

async function closeStakesPanel(instant = false) {

    if (!stakesPanel || stakesPanel.closing) {
        return;
    }

    const { card, top, popHeight } = stakesPanel;

    stakesPanel.closing = true;

    const pop = document.getElementById("stakes-panel");

    const backdrop = document.getElementById("stakes-panel-backdrop");

    const T = ms => ms * PANEL_SPEED;


    if (instant !== true) {

        const cardRect = card.getBoundingClientRect();

        backdrop.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: T(360), fill: "forwards" }
        );

        const more = pop.querySelector(".stakes-pop-more");

        more.animate(
            [
                { clipPath: "inset(0 0 0 0)" },
                { clipPath: stakesMoreClosed(popHeight, cardRect.height) }
            ],
            { duration: T(440), easing: PANEL_EASE, fill: "forwards" }
        );

        animateChoicePct(pop, false, { duration: T(440), easing: PANEL_EASE, fill: "forwards" });

        await pop.animate(
            [
                { transform: "none", height: popHeight + "px" },
                { transform: `translateY(${cardRect.top - top}px)`, height: cardRect.height + "px" }
            ],
            { duration: T(440), easing: PANEL_EASE, fill: "forwards" }
        ).finished.catch(() => {});

    }

    card.style.visibility = "";

    card.style.transition = "";

    pop.getAnimations().forEach(animation => animation.cancel());

    backdrop.getAnimations().forEach(animation => animation.cancel());

    pop.className = "stakes-panel hidden";

    pop.style.cssText = "";

    pop.innerHTML = "";

    backdrop.classList.add("hidden");

    stakesPanel = null;


    // Un rafraîchissement en direct a pu être mis en attente pendant l'ouverture.
    if (betsRefreshPending) {

        betsRefreshPending = false;

        displayBets({ quiet: true, force: true });

    }

}

/*
    Mode validation : un clic hors de la carte le quitte,
    comme le bouton « ✕ Annuler » (même animation de sortie).
    Les fenêtres et le détail des parieurs ne comptent pas comme « dehors ».
*/

function setupValidationOutsideClick() {

    document.addEventListener("click", event => {

        if (!cardValidation) {

            return;

        }

        const target = event.target;

        if (
            !(target instanceof Element) ||
            !target.isConnected ||
            target.closest(".modal, #stakes-panel, #stakes-panel-backdrop, .verdict-overlay, .verdict-wrap, .activity-feed")
        ) {

            return;

        }

        if (target.closest(".bet-card")?.dataset.betId === cardValidation.betId) {

            return;

        }

        document
            .querySelector(`.bet-card[data-bet-id="${cardValidation.betId}"] [data-validate-toggle]`)
            ?.click();

    });

}

function setupStakesPanel() {

    document
        .getElementById("stakes-panel-backdrop")
        .addEventListener("click", closeStakesPanel);

    document.addEventListener("keydown", event => {

        if (event.key === "Escape") {
            closeStakesPanel();
        }

    });

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

/*
    Le formulaire de création est une fenêtre (bouton « + Créer un pari »
    de la page des paris). Elle se vide quand on la ferme (closeCreateModal).
*/

function openCreateModal() {

    // Échéance repartie de zéro : une date choisie puis abandonnée ne reste pas affichée.
    resetDeadlinePicker();

    // Avant le niveau 4 : 2 choix à 2 / 2.
    if (createOddsLocked()) {
        setThreeChoices(false);
    }

    document.getElementById("create-modal").classList.remove("hidden");

    updateCreateGuide();

    // Sur téléphone, pas de curseur automatique : le clavier cacherait la fenêtre.
    if (!PHONE_LAYOUT.matches) {

        setTimeout(() => document.getElementById("bet-question")?.focus(), 120);

    }

}

function closeCreateModal() {

    document.getElementById("create-modal").classList.add("hidden");

    // Fenêtre quittée : tout repart de zéro la prochaine fois.
    document.getElementById("create-bet-form").reset();

    document.getElementById("bet-target-options")?.classList.add("hidden");

    document.getElementById("odds-error")?.classList.add("hidden");

    document.getElementById("deadline-error")?.classList.add("hidden");

    resetDeadlinePicker();

    setThreeChoices(false);

}

function setupCreateModal() {

    const modal = document.getElementById("create-modal");

    if (!modal) {
        return;
    }

    document
        .getElementById("close-create-modal")
        .addEventListener("click", closeCreateModal);

    document.addEventListener("keydown", event => {

        if (event.key === "Escape" && !modal.classList.contains("hidden")) {
            closeCreateModal();
        }

    });

}

/*
    Pari à 3 choix : le créateur fixe les cotes 1 et 2, la 3e se calcule
    pour que 1/cote1 + 1/cote2 + 1/cote3 = 1 (même équilibre qu'à 2 choix).
*/
function threeChoicesOn() {

    return !document.getElementById("duel-third")?.classList.contains("hidden");

}

function calculerCoteTroisieme(oddsOne, oddsTwo) {

    if (!oddsOne || !oddsTwo || oddsOne <= 1 || oddsTwo <= 1) {
        return 0;
    }

    const left = 1 - 1 / oddsOne - 1 / oddsTwo;

    if (left <= 0) {
        return Infinity;
    }

    return Math.round((1 / left) * 100) / 100;

}

function oddsProblemThree(oddsOne, oddsTwo, oddsThree) {

    if (!oddsOne || !oddsTwo) {
        return "";
    }

    if (oddsOne > ODDS_MAX || oddsTwo > ODDS_MAX) {
        return "Cote trop haute : " + ODDS_MAX + " maximum.";
    }

    if (oddsOne < ODDS_MIN || oddsTwo < ODDS_MIN) {
        return "Cote trop basse : 1,01 minimum.";
    }

    if (oddsThree === Infinity) {
        return "Cotes 1 et 2 trop basses : le choix 3 n'aurait plus aucune chance. Monte-les un peu.";
    }

    if (oddsThree > ODDS_MAX) {
        return "Avec ces cotes, le choix 3 dépasserait " + ODDS_MAX + " : monte un peu les cotes 1 ou 2.";
    }

    return "";

}

// Cotes calculées et message d'erreur, à chaque saisie (2 ou 3 choix).
function updateCreateOdds() {

    const oddsOne = Number(document.getElementById("odds-one").value);

    const oddsTwoInput = document.getElementById("odds-two");

    const oddsThreeInput = document.getElementById("odds-three");

    let problem;

    if (threeChoicesOn()) {

        const oddsTwo = Number(oddsTwoInput.value);

        // Calculée depuis ses chances (pas depuis les cotes 1 et 2 arrondies).
        const oddsThree = shareOdds(createShares[2]);

        oddsThreeInput.value = oddsThree && oddsThree !== Infinity ? oddsThree.toFixed(2) : "";

        problem = oddsProblemThree(oddsOne, oddsTwo, oddsThree);

    } else {

        const cote = shareOdds(createShares[1]);

        oddsTwoInput.value = cote ? cote.toFixed(2) : "";

        problem = oddsProblem(oddsOne, cote);

    }

    const oddsError = document.getElementById("odds-error");

    oddsError.textContent = problem;

    oddsError.classList.toggle("hidden", !problem);

}

/*
    Répartition des chances (version D de demo-choix-cotes.html) :
    une barre partagée entre les choix, à glisser. Les chances font 100 %,
    la cote d'un choix vaut 100 / chances (20 % minimum, soit une cote de 5 au plus).
    Les cotes 1 (et 2 à trois choix) vont dans les champs cachés ; updateCreateOdds
    calcule la dernière comme avant, et c'est elle qui est affichée.
*/

const SHARE_MIN = 20;

const SHARE_COLORS = ["#6c63ff", "#ff7aa8", "#f5c451"];

let createShares = [50, 50];

// Curseur glissé au moins une fois : le halo passe à la date (updateCreateGuide).
let createSharesTouched = false;


function renderShareBar() {

    const bar = document.getElementById("share-bar");

    if (!bar) {
        return;
    }

    const three = createShares.length === 3;

    document.getElementById("odds-one").value = (Math.round(100 / createShares[0] * 100) / 100).toFixed(2);

    if (three) {
        document.getElementById("odds-two").value = (Math.round(100 / createShares[1] * 100) / 100).toFixed(2);
    }

    // Cote du dernier choix (et message d'erreur éventuel), comme avant.
    updateCreateOdds();

    const odds = ["odds-one", "odds-two", "odds-three"]
        .slice(0, createShares.length)
        .map(id => Number(document.getElementById(id).value));

    const names = ["choice-one", "choice-two", "choice-three"]
        .map((id, index) => document.getElementById(id).value.trim() || `Choix ${index + 1}`);

    let changed = false;

    createShares.forEach((share, index) => {

        const label = document.querySelector(`[data-share-odds="${index}"]`);

        // Mode pourcentages (profil) : les chances du choix au lieu de sa cote.
        const text = !odds[index] ? "–" : oddsAsPercent() ? Math.round(share) + " %" : formatOdds(odds[index]);

        if (label.textContent === text) {
            return;
        }

        label.textContent = text;

        // Petit « pop » de la cote qui change pendant le glissé.
        if (bar.classList.contains("dragging")) {

            changed = true;

            label.classList.remove("pop");

            void label.offsetWidth;

            label.classList.add("pop");

        }

    });

    // Petit clic sous le doigt à chaque cran (téléphones qui le permettent).
    if (changed) {
        navigator.vibrate?.(4);
    }

    const segments = bar.querySelectorAll(":scope > div");

    // Même nombre de choix : on change seulement les largeurs, pour que ça glisse en douceur.
    if (segments.length === createShares.length) {

        let left = 0;

        const handles = bar.querySelectorAll(".share-handle");

        createShares.forEach((share, index) => {

            segments[index].style.width = share + "%";

            segments[index].textContent = share >= 16 ? names[index] : "";

            left += share;

            if (handles[index]) {
                handles[index].style.left = left + "%";
            }

        });

        return;

    }

    bar.innerHTML = createShares
        .map((share, index) => `
            <div style="width: ${share}%; background: ${SHARE_COLORS[index]}">
                ${share >= 16 ? escapeHtml(names[index]) : ""}
            </div>
        `)
        .join("");

    // Une poignée entre chaque paire de choix.
    let left = 0;

    createShares.slice(0, -1).forEach((share, index) => {

        left += share;

        const handle = document.createElement("span");

        handle.className = "share-handle";

        handle.style.left = left + "%";

        handle.setAttribute("aria-hidden", "true");

        handle.addEventListener("pointerdown", event => dragShare(event, index));

        bar.appendChild(handle);

    });

}


/*
    Crans du séparateur : une cote ronde (pas de 0,5, de 1,5 à 5) pour le choix
    de gauche ou celui de droite, le cran le plus proche du doigt.
    x : chances voulues pour le choix de gauche ; pair : chances des deux choix.
*/
const ODDS_STEP = 0.5;

// Cote d'un choix d'après ses chances (en %).
function shareOdds(share) {

    return Math.round(100 / share * 100) / 100;

}

function snapShare(x, pair) {

    const candidates = [];

    for (let odds = 1.5; odds <= ODDS_MAX + 0.001; odds += ODDS_STEP) {

        candidates.push(100 / odds, pair - 100 / odds);

    }

    const allowed = candidates.filter(share =>
        share >= SHARE_MIN - 0.001 && share <= pair - SHARE_MIN + 0.001
    );

    if (!allowed.length) {
        return null;
    }

    return allowed.reduce((best, share) =>
        Math.abs(share - x) < Math.abs(best - x) ? share : best
    );

}

function dragShare(event, index) {

    event.preventDefault();

    if (createOddsLocked()) {
        return;
    }

    const bar = document.getElementById("share-bar");

    const rect = bar.getBoundingClientRect();

    const before = createShares.slice(0, index).reduce((sum, share) => sum + share, 0);

    const pair = createShares[index] + createShares[index + 1];

    bar.classList.add("dragging");

    const move = moveEvent => {

        const x = (moveEvent.clientX - rect.left) / rect.width * 100 - before;

        const share = snapShare(x, pair);

        if (share === null || Math.abs(share - createShares[index]) < 0.001) {
            return;
        }

        createShares[index] = share;

        createShares[index + 1] = pair - share;

        renderShareBar();

    };

    const up = () => {

        bar.classList.remove("dragging");

        if (!createSharesTouched) {

            createSharesTouched = true;

            updateCreateGuide();

        }

        window.removeEventListener("pointermove", move);

        window.removeEventListener("pointerup", up);

        window.removeEventListener("pointercancel", up);

    };

    window.addEventListener("pointermove", move);

    window.addEventListener("pointerup", up);

    window.addEventListener("pointercancel", up);

}


/*
    Avant le niveau 4 (body.level-lock-4) : pas de curseur ni de 3e choix,
    les paris se créent à 2 / 2.
*/
function createOddsLocked() {

    return document.body.classList.contains("level-lock-4");

}

// Bouton « Ajouter / Retirer le 3e choix ».
function setThreeChoices(on) {

    const third = document.getElementById("duel-third");

    if (!third) {
        return;
    }

    third.classList.toggle("hidden", !on);

    createShares = on ? [40, 40, 20] : [50, 50];

    // Nouvelle répartition : le curseur est à régler de nouveau.
    createSharesTouched = false;

    document.getElementById("choice-three").required = on;

    document.getElementById("odds-two").value = "";

    document.getElementById("odds-three").value = "";

    document.getElementById("toggle-third-choice").textContent =
        on ? "✕ Retirer le 3e choix" : "+ Ajouter un 3e choix";

    renderShareBar();

    updateCreateGuide();

}


async function createBet() {

    // Avant le niveau 4 : quoi qu'il arrive, 2 choix à 2 / 2.
    if (createOddsLocked() && (threeChoicesOn() || createShares[0] !== 50)) {
        setThreeChoices(false);
    }

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

    const three =
        threeChoicesOn();

    // Cotes 2 et 3 : celles affichées (updateCreateOdds, depuis les chances).
    const oddsTwo =
        Number(document.getElementById("odds-two").value);

    const choiceThree =
        three
            ? document.getElementById("choice-three").value.trim()
            : "";

    const oddsThree =
        three
            ? Number(document.getElementById("odds-three").value)
            : 0;


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


    if (!choiceOne || !choiceTwo || (three && !choiceThree)) {

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


    // Cotes limitées à 20 (tous les choix).
    const oddsMessage = three
        ? oddsProblemThree(oddsOne, oddsTwo, oddsThree)
        : oddsProblem(oddsOne, oddsTwo);

    if (oddsMessage) {

        const oddsError = document.getElementById("odds-error");

        oddsError.textContent = oddsMessage;

        oddsError.classList.remove("hidden");

        oddsError.scrollIntoView({ behavior: "smooth", block: "center" });

        return;

    }


    try {

        /*
            Création du pari, en brouillon : il sera publié
            quand le créateur aura misé dessus (brouillon-createur.sql).
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

                status: "draft",

                deadline_at:
                    deadlineAt,

                target_user_id:
                    targetUserId || null,

                target_blocked:
                    targetBlocked,

                group_id:
                    currentGroup.id

            })
            .select()
            .single();


        if (betError) {

            throw betError;

        }


        /*
            Création des choix (2 ou 3).
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

                },

                ...(three
                    ? [{
                        bet_id: bet.id,

                        label: choiceThree,

                        odds: oddsThree
                    }]
                    : [])

            ]);


        if (choicesError) {

            /*
                Si les choix échouent,
                on supprime le brouillon.
            */

            await supabaseClient.rpc(
                "delete_draft_bet",
                {
                    p_bet_id: bet.id
                }
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

        setThreeChoices(false);


        /*
            On ferme la fenêtre : le brouillon arrive en haut de la liste,
            il reste à miser dessus pour le publier.
        */

        closeCreateModal();


        await displayBets({ quiet: true });

        document
            .querySelector(`.bet-card-draft[data-draft-id="${bet.id}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });

        await displayMyBets();

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
    Sélecteur d'échéance : un jour parmi les 6 prochains, ou n'importe
    quelle date avec le 7e bouton « Autre » (calendrier du navigateur),
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


/*
    Fenêtre de création : halo sur la prochaine étape
    (question → curseur des chances → jour de fin), qui passe à la suivante une fois faite.
    Un nom de choix vidé reprend le halo avant le curseur.
*/
function updateCreateGuide() {

    const question = document.getElementById("bet-question");

    if (!question) {
        return;
    }

    const steps = [
        [question, question.value.trim()],
        [document.getElementById("choice-one").closest(".share-row"), document.getElementById("choice-one").value.trim()],
        [document.getElementById("choice-two").closest(".share-row"), document.getElementById("choice-two").value.trim()]
    ];

    if (threeChoicesOn()) {

        steps.push([document.getElementById("duel-third"), document.getElementById("choice-three").value.trim()]);

    }

    steps.push([document.getElementById("share-bar"), createSharesTouched || createOddsLocked()]);

    steps.push([document.getElementById("deadline-days"), deadlineDayOffset !== null]);

    const next = steps.find(([, filled]) => !filled)?.[0];

    steps.forEach(([element]) => {
        element?.classList.toggle("fill-here", element === next);
    });

    // Les sections suivantes (et le bouton) restent grisées tant que l'étape en cours n'est pas faite.
    const form = document.getElementById("create-bet-form");

    const sections = [...form.querySelectorAll(".create-section")];

    const current = next ? sections.indexOf(next.closest(".create-section")) : -1;

    // inert : ni clic ni clavier (Tab) dans une section grisée.
    sections.forEach((section, index) => {

        const later = current !== -1 && index > current;

        section.classList.toggle("create-later", later);

        section.inert = later;

    });

    const footer = form.querySelector(".create-footer");

    if (footer) {

        footer.classList.toggle("create-later", Boolean(next));

        footer.inert = Boolean(next);

    }

}


function updateDeadlinePreview() {

    updateCreateGuide();

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


    // Jour choisi : seul son bouton reste allumé.
    const selectDay = (offset, activeButton) => {

        deadlineDayOffset = offset;

        daysContainer
            .querySelectorAll(".deadline-day")
            .forEach(button => button.classList.toggle("active", button === activeButton));

        document.getElementById("deadline-error").classList.add("hidden");

        updateDeadlinePreview();

    };


    for (let i = 0; i < 6; i++) {

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

        dayButton.addEventListener("click", () => selectDay(i, dayButton));

        daysContainer.appendChild(dayButton);

    }


    // 7e bouton : n'importe quelle date, avec le calendrier du navigateur.
    const otherButton =
        document.createElement("button");

    otherButton.type = "button";

    otherButton.className = "deadline-day deadline-day-other";

    otherButton.innerHTML = `
        <small data-other-top>autre</small>
        <b data-other-day>📅</b>
        <input type="date" class="deadline-other-input" tabindex="-1" aria-label="Choisir une autre date">
    `;

    const dateInput =
        otherButton.querySelector(".deadline-other-input");

    otherButton.addEventListener("click", () => {

        // Pas de date passée dans le calendrier.
        const today = new Date();

        dateInput.min =
            today.getFullYear() + "-" +
            String(today.getMonth() + 1).padStart(2, "0") + "-" +
            String(today.getDate()).padStart(2, "0");

        // Champ vidé : n'importe quel choix (même la date d'avant) est bien pris en compte.
        dateInput.value = "";

        try {
            dateInput.showPicker();
        } catch {
            dateInput.focus();
            dateInput.click();
        }

    });

    dateInput.addEventListener("click", event => event.stopPropagation());

    dateInput.addEventListener("change", () => {

        if (!dateInput.value) {
            return;
        }

        const [year, month, day] = dateInput.value.split("-").map(Number);

        const chosen = new Date(year, month - 1, day);

        const today = new Date();

        today.setHours(0, 0, 0, 0);

        const offset = Math.round((chosen - today) / 86400000);

        if (offset < 0) {
            return;
        }

        // Date déjà présente dans les 6 premiers boutons : on allume celui-là.
        if (offset < 6) {

            resetOtherDeadlineButton();

            selectDay(offset, daysContainer.querySelectorAll(".deadline-day")[offset]);

            return;

        }

        otherButton.querySelector("[data-other-top]").textContent =
            chosen.toLocaleDateString("fr-FR", { month: "short" });

        otherButton.querySelector("[data-other-day]").textContent =
            chosen.getDate();

        selectDay(offset, otherButton);

    });

    daysContainer.appendChild(otherButton);


    document
        .getElementById("deadline-range")
        .addEventListener("input", updateDeadlinePreview);

    resetDeadlinePicker();

}


// Bouton « Autre » remis à zéro (icône calendrier, sans date).
function resetOtherDeadlineButton() {

    const otherButton =
        document.querySelector(".deadline-day-other");

    if (!otherButton) {
        return;
    }

    otherButton.querySelector("[data-other-top]").textContent = "autre";

    otherButton.querySelector("[data-other-day]").textContent = "📅";

    otherButton.querySelector(".deadline-other-input").value = "";

}


function resetDeadlinePicker() {

    deadlineDayOffset = null;

    resetOtherDeadlineButton();

    document
        .querySelectorAll(".deadline-day")
        .forEach(button => button.classList.remove("active"));

    document.getElementById("deadline-range").value =
        DEFAULT_DEADLINE_STEP;

    updateDeadlinePreview();

}



/*
    Cotes autorisées à la création : de 1,01 à 5.
    La cote 2 étant calculée depuis la cote 1, la cote 1 doit rester entre 1,25 et 5
    (en dessous de 1,25, la cote 2 dépasserait 5).
    Aussi vérifié côté base : cote-max-5.sql (création), cotes-et-combines.sql (10 ensuite).
*/

const ODDS_MIN = 1.01;

// Plafond à la création (les cotes qui bougent peuvent ensuite monter jusqu'à 10).
const ODDS_MAX = 5;

// Cote enflammée (étincelles) à partir de 8.
const ODDS_FIRE_FROM = 8;


/*
    Cotes qui bougent (cotes-mouvantes.sql) : petite flèche sur la carte
    quand la cote n'est plus celle fixée par le créateur.
*/
function oddsMoveHtml(choice) {

    const start = Number(choice.start_odds);

    const odds = Number(choice.odds);

    if (!start || Math.abs(odds - start) < 0.005) {
        return "";
    }

    const up = odds > start;

    return `<em class="odds-move ${up ? "up" : "down"}" title="Au départ : ${oddsText(start)}">${up !== oddsAsPercent() ? "▲" : "▼"}</em>`;

}

function oddsProblem(oddsOne, oddsTwo) {

    if (!oddsOne || !oddsTwo) {
        return "";
    }

    if (oddsOne > ODDS_MAX) {
        return "Cote trop haute : " + ODDS_MAX + " maximum.";
    }

    if (oddsOne < ODDS_MIN || oddsTwo > ODDS_MAX) {
        return "Cote trop basse : avec " + formatOdds(oddsOne) + ", le choix 2 dépasserait " + ODDS_MAX + ". Mets au moins 1,25.";
    }

    return "";

}

function formatOdds(value) {

    return Number(value).toFixed(2).replace(".", ",");

}

/*
    Préférence d'affichage (profil) : cotes (2.50) ou pourcentages (40 %).
    Le pourcentage est la chance que la cote suppose : 100 / cote.
    Rangé dans ce navigateur seulement.
*/
const ODDS_MODE_KEY = "betlab-odds-mode";

function oddsAsPercent() {

    try {
        return localStorage.getItem(ODDS_MODE_KEY) === "percent";
    } catch {
        return false;
    }

}

function setOddsAsPercent(on) {

    try {
        localStorage.setItem(ODDS_MODE_KEY, on ? "percent" : "odds");
    } catch {
        // Navigateur sans stockage : le réglage ne sera pas gardé.
    }

}

// comma : « 2,50 » au lieu de « 2.50 » ; times : « × 2,50 » (rien en pourcentage).
function oddsText(value, { comma = false, times = false } = {}) {

    const odds = Number(value);

    if (oddsAsPercent()) {

        if (!odds) {
            return "0 %";
        }

        const percent = 100 / odds;

        // En dessous de 1 % (gros combinés), une décimale pour ne pas afficher 0 %.
        return (percent < 1
            ? percent.toFixed(1).replace(".", ",")
            : Math.round(percent)) + " %";

    }

    const text = comma ? formatOdds(odds) : odds.toFixed(2);

    return times ? "× " + text : text;

}

// Interrupteur « Cotes / Pourcentages » du profil : tout se redessine aussitôt.
function setupOddsModeSwitch() {

    const input = document.getElementById("odds-mode-switch");

    if (!input) {
        return;
    }

    input.checked = oddsAsPercent();

    input.addEventListener("change", () => {

        setOddsAsPercent(input.checked);

        renderShareBar();

        if (!currentGroup) {
            return;
        }

        displayBets({ quiet: true, force: true });

        displayMyBets();

        displayMyCreatedBets();

        renderTicket();

    });

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
        .from("group_members")
        .select("profiles!inner ( id, username, is_admin )")
        .eq("group_id", currentGroup?.id)
        .eq("profiles.is_admin", false);


    if (error) {

        console.error("Erreur loadTargetUsers :", error);

        return;

    }


    // Seul dans le groupe : personne d'autre à viser, la section disparaît.
    const alone =
        !(data || []).some(member => member.profiles.id !== currentUser?.id);

    document
        .getElementById("bet-target-section")
        ?.classList.toggle("hidden", alone);

    if (alone) {

        document.getElementById("bet-has-target").checked = false;

        document.getElementById("bet-target-options")?.classList.add("hidden");

    }


    (data || [])
        .map(member => member.profiles)
        .sort((x, y) => x.username.localeCompare(y.username))
        .forEach(
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
        id: "last_chance",
        title: "Last Chance",
        description: "Miser pendant que la carte est rouge (juste avant la fermeture des mises), et gagner le pari.",
        points: 27,
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
        price: 300,
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
        options: ["🔥", "⚡", "🍀", "💎"]
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
    },
    {
        id: "clic_perroquet",
        title: "Clic du perroquet ×2",
        description: "Chaque clic sur le perroquet te donne 2 € au lieu de 1 €, jusqu'à ton plafond du jour.",
        price: 30,
    },
    {
        id: "clic_perroquet_x3",
        title: "Clic du perroquet ×3",
        description: "Chaque clic sur le perroquet te donne 3 € au lieu de 1 €, jusqu'à ton plafond du jour.",
        price: 80,
    },
    {
        id: "scanner",
        title: "Pseudo scanner",
        description: "Un trait de lumière balaie ton pseudo en boucle.",
        price: 80,
    },
    {
        id: "neon_anime",
        title: "Pseudo néon animé",
        description: "Un dégradé néon bleu-violet qui défile en continu sur ton pseudo.",
        price: 250,
    },
    {
        id: "fiole",
        title: "Pseudo fiole qui bouillonne",
        description: "Ton pseudo brille en vert labo et de petites bulles s'en échappent.",
        price: 280,
    },
    {
        id: "ruban_chantier",
        title: "Pseudo ruban chantier",
        description: "Des rayures jaunes défilent sur ton pseudo, comme un ruban « travaux en cours ».",
        price: 300,
    }
];


// Pseudos animés de la boutique, du plus cher au moins cher (un seul affiché).
const NAME_ANIMATIONS = ["ruban_chantier", "fiole", "neon_anime", "scanner"];


/*
    Catégories de la boutique (ordre d'affichage).
    Mélange les avantages historiques (REWARDS) et les cosmétiques.
*/

// combine : se cumule avec tout ; replace : un seul équipé dans la section
// (même groupes que EXCLUSIVE_GROUPS).
const SHOP_CATEGORIES = [
    {
        icon: "➕",
        title: "Bonus du pseudo",
        mode: "combine",
        kind: "cosmetic",
        items: ["emoji", "etincelles"]
    },
    {
        icon: "🎨",
        title: "Style du pseudo",
        mode: "replace",
        kind: "cosmetic",
        items: ["neon", "scanner", "metal_rose", "metal_bronze", "metal_argent", "neon_anime", "metal_or", "fiole", "ruban_chantier", "couleur"]
    },
    {
        icon: "🖼️",
        title: "Cadre du classement",
        mode: "replace",
        kind: "cosmetic",
        items: ["cadre", "aura"]
    },
    {
        icon: "🃏",
        title: "Thème de carte",
        mode: "replace",
        kind: "cosmetic",
        items: ["theme"]
    },
    {
        icon: "🦜",
        title: "Perroquet",
        kind: "utile",
        items: ["clic_perroquet", "clic_perroquet_x3"]
    },
    {
        icon: "🔥",
        title: "Série",
        kind: "utile",
        items: ["bouclier", "rattrapage"]
    }
];


// Option choisie dans la boutique pour chaque cosmétique (avant achat).
const shopSelections = {};

// Filtre actif de la boutique : all, cosmetic ou utile.
let shopFilter = "all";


function cosmeticOptionLabel(option) {

    return option.charAt(0).toUpperCase() + option.slice(1);

}


// Uniquement l'effet d'un article de la boutique (aperçu sur mon pseudo).
function shopItemEffects(itemId, selected) {

    return {
        gold: itemId === "cadre",
        rainbow: itemId === "couleur",
        metal: itemId.startsWith("metal_") ? itemId.slice(6) : null,
        anim: NAME_ANIMATIONS.includes(itemId) ? itemId : null,
        neon: itemId === "neon" ? selected : null,
        emoji: itemId === "emoji" ? selected : null,
        sparkle: itemId === "etincelles",
        aura: itemId === "aura",
        theme: itemId === "theme" ? selected : null
    };

}


/*
    Aperçu affiché directement sur la carte de la boutique
    (version 4 « En ligne » de demo-cartes-boutique-v2.html).
*/

function shopStageHtml(itemId, selected) {

    const me = {
        username: currentProfile.username
    };

    if (itemId === "clic_perroquet" || itemId === "clic_perroquet_x3") {

        return `
            <span class="shop-row-util">
                <img src="assets/perroquet/skins/classique/thumb.png" alt="">
                <b>+${itemId === "clic_perroquet" ? 2 : 3} €</b>
                <small>par clic</small>
            </span>
        `;

    }

    const effects =
        shopItemEffects(itemId, selected);

    if (effects.theme) {

        return `
            <div class="bet-card bet-card-theme bet-theme-${escapeHtml(effects.theme)} shop-preview-bet">
                <div class="bet-card-header">
                    <span>🏆</span>
                    <span class="bet-author">Créé par ${escapeHtml(me.username)}</span>
                </div>
                <div class="bet-question-row">
                    <span class="bet-question-icon">🎲</span>
                    <h3>Qui gagne ce soir ?</h3>
                </div>
            </div>
        `;

    }

    if (effects.gold || effects.aura) {

        return leaderboardRowHtml(me, { rank: 3, medal: "", balance: formatBalance(1520), effects });

    }

    return `<span class="user-name shop-row-name">${nameHtml(me, effects)}</span>`;

}


// Rareté d'un article, selon son prix (badge et bordure de la carte).
function shopRarity(price) {

    return price >= 400 ? ["legendaire", "Légendaire"]
        : price >= 250 ? ["epique", "Épique"]
        : price >= 100 ? ["rare", "Rare"]
        : ["commun", "Commun"];

}


// Carte « en ligne » : aperçu à gauche, titre et options au milieu, boutons à droite.
function shopRowHtml({ id, title, price, stage, middle = "", actions }) {

    const [rarity, rarityLabel] =
        shopRarity(price);

    return `
        <div class="mission-card shop-card shop-row shop-rarity--${rarity}" data-shop-item="${id}">

            <div class="shop-row-stage">${stage}</div>

            <div class="shop-row-mid">
                <span class="shop-rarity">${rarityLabel}</span>
                <h3>${escapeHtml(title)}</h3>
                ${middle}
            </div>

            <div class="shop-row-actions">${actions}</div>

        </div>
    `;

}


// Bouton d'achat : le prix sert de bouton (grisé s'il manque des pièces).
function shopPriceButtonHtml(className, dataAttribute, price, enabled) {

    const missing =
        price - (currentProfile.points || 0);

    return `
        <button
            class="primary-button ${className}"
            ${dataAttribute}
            ${enabled ? "" : "disabled"}
            ${missing > 0 ? `title="Il te manque ${missing} 🪙"` : ""}
        >
            ${price} 🪙
        </button>
    `;

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
        } = await supabaseClient.rpc("mission_progress", { p_group: currentGroup.id });


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
                        Récupérer ${total} 🪙
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
                        <span class="mission-points">+${mission.points} 🪙</span>
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

    // Départ des pièces : le bouton « Récupérer » (avant que la liste soit redessinée).
    const origin = button.getBoundingClientRect();

    const pointsBefore = Number(currentProfile?.points || 0);


    try {

        const {
            data,
            error
        } = await supabaseClient.rpc(
            "claim_mission",
            {
                p_group: currentGroup.id,
                p_mission: missionId
            }
        );


        if (error) {
            throw error;
        }


        // Le total est connu tout de suite : les pièces partent sans attendre le réseau,
        // et le compteur ne saute pas à sa valeur finale avant leur arrivée.
        if (currentProfile) {

            currentProfile.points = pointsBefore + Number(data);

        }

        const card = button.closest(".mission-card");

        // La carte passe doucement à l'état « Récupérée » (au lieu d'être redessinée d'un coup).
        if (card) {

            card.classList.remove("ready");

            await button.animate(
                [{ opacity: 1 }, { opacity: 0 }],
                { duration: 220, easing: "ease-out", fill: "forwards" }
            ).finished.catch(() => {});

            const done = document.createElement("span");

            done.className = "mission-state done";

            done.textContent = "Récupérée";

            button.replaceWith(done);

            done.animate(
                [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
                { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" }
            );

        }

        // Les pièces volent jusqu'au compteur ; la liste n'est mise à jour qu'après leur arrivée.
        if (typeof flyCoins === "function") {

            await flyCoins(origin, Number(data), pointsBefore);

        }

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


/* =========================================================
   COFFRE ALÉATOIRE (boutique, version B de demo-coffre-aleatoire.html)
   100 🪙 = un article permanent pas encore possédé, chance ∝ 1 / prix.
   Tirage côté base : open_random_chest (coffre-aleatoire.sql).
========================================================= */

const CHEST_PRICE = 100;

// Coffre caché pour le moment (2026-10-13) : passer à true pour le remettre dans la boutique.
const CHEST_ENABLED = false;

const CHEST_ICONS = {
    emoji: "😀",
    neon: "💡",
    metal_rose: "🌸",
    etincelles: "✦",
    metal_bronze: "🥉",
    metal_argent: "🥈",
    metal_or: "🥇",
    aura: "🌀",
    theme: "🃏",
    clic_perroquet: "🦜",
    clic_perroquet_x3: "🦜",
    scanner: "📡",
    neon_anime: "🌈",
    fiole: "🧪",
    ruban_chantier: "🚧"
};

// Dernier gain, affiché sous la roulette après le rechargement de la boutique.
let chestLastWin = null;

let chestSpinning = false;

function chestRarity(price) {

    return price >= 300 ? ["legendaire", "Légendaire"]
        : price >= 200 ? ["epique", "Épique"]
        : price >= 80 ? ["rare", "Rare"]
        : ["commun", "Commun"];

}

// Articles que je n'ai pas encore (même liste que shop_catalogue()).
function chestPool() {

    return COSMETICS.filter(item => !isRewardActive(currentProfile?.cosmetics?.[item.id]?.until));

}

function chestDraw(pool) {

    const total = pool.reduce((sum, item) => sum + 1 / item.price, 0);

    let roll = Math.random() * total;

    for (const item of pool) {

        roll -= 1 / item.price;

        if (roll <= 0) {
            return item;
        }

    }

    return pool[pool.length - 1];

}

function chestIcon(item, option) {

    return item.id === "emoji" && option ? escapeHtml(option) : CHEST_ICONS[item.id] || "🎁";

}

function chestLabel(item, option) {

    return item.title + (option && item.id !== "emoji" ? " · " + cosmeticOptionLabel(option) : "");

}

/*
    Aperçu animé de l'article dans sa case de la roulette, sur mon pseudo
    (mêmes effets que l'aperçu de la boutique, openShopPreview).
*/
function chestPreviewHtml(item, option) {

    const me = { username: currentProfile?.username || "Toi" };

    if (item.id === "theme") {

        return `<div class="bet-card bet-card-theme bet-theme-${escapeHtml(option || item.options[0])} rchest-theme">Pari</div>`;

    }

    if (item.id === "aura") {

        return `<div class="leaderboard-row leaderboard-row--aura rchest-aura">${nameHtml(me, {})}</div>`;

    }

    // Clic du perroquet ×3 : pas d'aperçu, juste son nom dans la case.
    if (item.id === "clic_perroquet_x3") {

        return "";

    }

    if (item.id === "clic_perroquet") {

        return `<span class="rchest-parrot"><img src="assets/perroquet/skins/classique/thumb.png" alt=""><b>×2</b></span>`;

    }

    const effects = {
        metal: item.id.startsWith("metal_") ? item.id.slice(6) : null,
        anim: NAME_ANIMATIONS.includes(item.id) ? item.id : null,
        neon: item.id === "neon" ? option || item.options[0] : null,
        emoji: item.id === "emoji" ? option || item.options[0] : null,
        sparkle: item.id === "etincelles"
    };

    return `<span class="user-name rchest-name">${nameHtml(me, effects)}</span>`;

}

function chestCellHtml(item, option = null) {

    // Case décorative : une option au hasard, pour varier les couleurs.
    const shown = option || (item.options ? item.options[Math.floor(Math.random() * item.options.length)] : null);

    return `
        <div class="rchest-cell rchest-cell--${chestRarity(item.price)[0]}">
            <div class="rchest-cell-preview">${chestPreviewHtml(item, shown).trim()}</div>
            <div class="rchest-cell-label">${escapeHtml(chestLabel(item, option))}</div>
        </div>
    `;

}

function randomChestHtml() {

    if (!CHEST_ENABLED) {
        return "";
    }

    const pool = chestPool();

    const total = pool.reduce((sum, item) => sum + 1 / item.price, 0);

    // Chance totale par rareté, parmi ce qu'il me reste à gagner.
    const order = ["commun", "rare", "epique", "legendaire"];

    const tiers = [];

    pool.forEach(item => {

        const [key, label] = chestRarity(item.price);

        let tier = tiers.find(other => other.key === key);

        if (!tier) {

            tier = { key, label, chance: 0 };

            tiers.push(tier);

        }

        tier.chance += (1 / item.price) / total * 100;

    });

    tiers.sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key));

    const cells = pool.length
        ? Array.from({ length: 12 }, () => chestCellHtml(chestDraw(pool))).join("")
        : "";

    const win = chestLastWin
        ? COSMETICS.find(item => item.id === chestLastWin.item)
        : null;

    return `
        <section class="rshop-chest">

            <h2 class="missions-title">🎁 Coffre aléatoire</h2>

            <div class="rchest-card">

                <div class="rchest-head">
                    <div>
                        <h3>Un article au hasard</h3>
                        <p>Parmi ceux que tu n'as pas encore. Plus c'est cher, plus c'est rare.</p>
                    </div>
                    <button
                        type="button"
                        class="rchest-open-button"
                        data-chest-open
                        ${pool.length ? "" : "disabled"}
                    >
                        ${pool.length ? `${chestLastWin ? "Rouvrir" : "Ouvrir"} · ${CHEST_PRICE} 🪙` : "Tout est débloqué"}
                    </button>
                </div>

                <div class="rchest-window">
                    <div class="rchest-needle"></div>
                    <div class="rchest-strip">${cells}</div>
                </div>

                <div class="rchest-legend">
                    ${tiers.map(tier => `<span class="rchest-tier--${tier.key}">${tier.label} ${tier.chance < 1 ? tier.chance.toFixed(1) : Math.round(tier.chance)} %</span>`).join("")}
                </div>

                <p class="rchest-result">${win
                    ? `${chestIcon(win, chestLastWin.option)} Tu as gagné <b>${escapeHtml(chestLabel(win, chestLastWin.option))}</b> · ${chestRarity(win.price)[1]} !`
                    : ""}</p>

                ${chestEquipQuestionHtml(win)}

                <p class="rchest-error"></p>

            </div>

        </section>
    `;

}

/*
    Article gagné : il arrive non équipé (open_random_chest), on demande
    si on veut l'équiper tout de suite. Les clics du perroquet n'ont
    rien à équiper.
*/
function chestEquipQuestionHtml(win) {

    if (!win || chestLastWin.answered || win.id.startsWith("clic_perroquet")) {
        return "";
    }

    if (!currentProfile?.cosmetics?.[win.id]?.off) {
        return "";
    }

    return `
        <div class="rchest-equip">
            <span>L'équiper maintenant ?</span>
            <button type="button" class="rchest-equip-yes" data-chest-equip="yes">✓ Équiper</button>
            <button type="button" class="rchest-equip-no" data-chest-equip="no">Plus tard</button>
        </div>
    `;

}

async function answerChestEquip(answer, button) {

    if (!chestLastWin) {
        return;
    }

    if (answer === "yes") {

        button.disabled = true;

        const { error } = await supabaseClient.rpc("toggle_cosmetic", {
            p_group: currentGroup.id,
            p_item: chestLastWin.item,
            p_on: true
        });

        if (error) {

            console.error(error);

            button.disabled = false;

            button.closest(".rshop-chest").querySelector(".rchest-error").textContent =
                error.message || "Impossible d'équiper l'article.";

            return;

        }

        await unequipConflicts(chestLastWin.item);

    }

    chestLastWin.answered = true;

    await loadCurrentProfile();

    displayShop();

    if (answer === "yes") {

        await displayLeaderboard();

        await displayBets({ quiet: true });

    }

}

async function openRandomChest(button) {

    if (chestSpinning) {
        return;
    }

    const section = button.closest(".rshop-chest");

    const errorElement = section.querySelector(".rchest-error");

    errorElement.textContent = "";

    const pool = chestPool();

    const points = Number(currentProfile?.points || 0);

    if (!currentProfile?.is_admin && points < CHEST_PRICE) {

        errorElement.textContent = `Il te manque ${CHEST_PRICE - points} 🪙 pour ouvrir le coffre.`;

        return;

    }

    chestSpinning = true;

    button.disabled = true;

    const buttonRect = button.getBoundingClientRect();

    const { data, error } = await supabaseClient.rpc("open_random_chest", { p_group: currentGroup.id });

    if (error) {

        console.error(error);

        errorElement.textContent = error.message || "Impossible d'ouvrir le coffre.";

        chestSpinning = false;

        button.disabled = false;

        return;

    }

    const won = COSMETICS.find(item => item.id === data.item);

    section.querySelector(".rchest-result").textContent = "";

    // Les pièces partent du compteur vers le bouton pendant que la roulette tourne.
    if (typeof spendCoins === "function" && !currentProfile.is_admin) {

        currentProfile.points = points - CHEST_PRICE;

        spendCoins(buttonRect, CHEST_PRICE, points);

    }

    // Roulette : 45 cases, l'article gagné en 41e, arrêté sous l'aiguille.
    const strip = section.querySelector(".rchest-strip");

    const cells = Array.from({ length: 45 }, () => chestCellHtml(chestDraw(pool.length ? pool : COSMETICS)));

    cells[40] = chestCellHtml(won, data.option);

    strip.style.transition = "none";

    strip.style.transform = "translateX(0)";

    strip.innerHTML = cells.join("");

    const winCell = strip.children[40];

    const offset =
        winCell.offsetLeft + winCell.offsetWidth / 2
        - strip.parentElement.clientWidth / 2
        + (Math.random() * 60 - 30);

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    strip.style.transition = "transform 4.2s cubic-bezier(0.1, 0.7, 0.15, 1)";

    strip.style.transform = `translateX(${-offset}px)`;

    await new Promise(resolve => setTimeout(resolve, 4400));

    winCell.classList.add("win");

    section.querySelector(".rchest-result").innerHTML =
        `${chestIcon(won, data.option)} Tu as gagné <b>${escapeHtml(chestLabel(won, data.option))}</b> · ${chestRarity(won.price)[1]} !`;

    await new Promise(resolve => setTimeout(resolve, 1500));

    chestLastWin = data;

    chestSpinning = false;

    await loadCurrentProfile();

    displayShop();

    await displayLeaderboard();

    await displayBets({ quiet: true });

}


/* =========================================================
   BOUTIQUE : « TON LOOK » (ma ligne du vrai classement du groupe,
   entre mes deux voisins grisés, comme dans les aperçus)
   Elle suit tout de suite ce que j'équipe ou retire.
========================================================= */

// Classement complet du groupe (gardé pour redessiner sans attendre).
let shopLookRanking = null;

async function loadShopLookRanking() {

    const { data, error } = await supabaseClient
        .from("group_members")
        .select("balance, profiles!inner ( username, is_admin )")
        .eq("group_id", currentGroup?.id)
        .eq("profiles.is_admin", false)
        .order("balance", { ascending: false });

    if (error) {

        console.error(error);

        return;

    }

    shopLookRanking = (data || []).map(member => ({
        username: member.profiles.username,
        balance: member.balance
    }));

    renderShopLook();

}

function shopLookRowsHtml() {

    const ranking = shopLookRanking || [];

    const row = (player, index, mine) => leaderboardRowHtml(
        mine ? currentProfile : { username: player.username },
        {
            rank: index + 1,
            medal: "",
            balance: formatBalance(player.balance),
            // Les voisins sans leurs effets : l'œil va sur ma ligne.
            effects: mine ? getEffects(currentProfile) : {},
            extraClass: mine ? " shop-look-me" : " shop-preview-dim"
        }
    );

    // L'admin n'est pas classé : sa ligne épinglée, au-dessus des deux premiers.
    if (currentProfile.is_admin) {

        return leaderboardRowHtml(currentProfile, {
            rank: "—",
            medal: "👑",
            balance: "∞",
            effects: getEffects(currentProfile),
            extraClass: " shop-look-me"
        }) + ranking.slice(0, 2).map((player, index) => row(player, index, false)).join("");

    }

    const myIndex = ranking.findIndex(player => player.username === currentProfile.username);

    if (myIndex < 0) {

        return row({ username: currentProfile.username, balance: currentProfile.balance }, 0, true);

    }

    const from = Math.max(0, Math.min(myIndex - 1, ranking.length - 3));

    return ranking
        .slice(from, from + 3)
        .map((player, offset) => row(player, from + offset, from + offset === myIndex))
        .join("");

}

function renderShopLook() {

    const box = document.getElementById("shop-look");

    if (!box || !currentProfile) {
        return;
    }

    const effects = getEffects(currentProfile);

    box.innerHTML = `
        <div class="shop-preview-board shop-look-board">
            ${shopLookRanking ? shopLookRowsHtml() : `<p class="shop-category-hint">Chargement du classement…</p>`}
        </div>

        <div class="shop-look-bet">
            <div class="bet-card${effects.theme ? " bet-card-theme bet-theme-" + escapeHtml(effects.theme) : ""} shop-look-card">
                ${effects.theme === "diamant" ? `<span class="dia-stars" aria-hidden="true"></span>` : ""}
                <span class="shop-look-card-author">🏆 Créé par <span class="user-name${effects.gold ? " name-gold" : ""}">${nameHtml(currentProfile, effects)}</span></span>
                <b>Qui gagne le match ce soir ?</b>
            </div>
        </div>
    `;

}

function shopLookHtml() {

    return `
        <section class="shop-look-section">

            <h2 class="missions-title">👀 Ton look</h2>

            <p class="shop-category-hint">Ce que les autres voient de toi en ce moment, avec ce que tu as équipé.</p>

            <div class="mission-card shop-look" id="shop-look"></div>

        </section>
    `;

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
                    data-preview-item="${reward.id}"
                >
                    ${equipLabel(reward.id, previewOn)}
                </button>
            `
            : "";


        rewardCards[reward.id] = shopRowHtml({
            id: reward.id,
            title: reward.title,
            price: reward.price,
            stage: shopStageHtml(reward.id),
            actions: `
                ${active ? "" : shopPriceButtonHtml("reward-buy", `data-reward="${reward.id}"`, reward.price, canBuy)}
                ${adminToggle}
                ${equipToggleHtml(reward.id, active)}
            `
        });

    });


    /*
        Boutique rangée par catégories.
    */

    const cardOf = id =>
        id === "bouclier"
            ? shieldCardHtml(points)
            : id === "rattrapage"
            ? restoreCardHtml(points)
            : rewardCards[id] ||
            cosmeticCardHtml(COSMETICS.find(c => c.id === id));

    // Inclinaison « la carte suit la souris » : on la retient pour la remettre sur la carte
    // redessinée (sinon elle se redresse d'un coup quand on équipe ou achète).
    const savedTilts = new Map();

    container.querySelectorAll("[data-shop-item].tilting").forEach(card => {

        savedTilts.set(card.dataset.shopItem, card.style.transform);

    });

    const shopCountOf = kind =>
        SHOP_CATEGORIES
            .filter(category => kind === "all" || category.kind === kind)
            .reduce((total, category) => total + category.items.length, 0);

    container.innerHTML = `

        <div class="my-bets-filters shop-filters">

            ${[
                ["all", "Tous"],
                ["cosmetic", "Cosmétiques"],
                ["utile", "Objets utiles"]
            ].map(([key, label]) => `
                <button
                    class="my-bets-filter${shopFilter === key ? " active" : ""}"
                    data-filter="${key}"
                >
                    ${label}<span>${shopCountOf(key)}</span>
                </button>
            `).join("")}

        </div>

    ` + shopLookHtml() + randomChestHtml() + SHOP_CATEGORIES.map(category => `

        <section
            class="shop-category${shopFilter !== "all" && shopFilter !== category.kind ? " hidden" : ""}"
            data-kind="${category.kind}"
        >

            <h2 class="missions-title">
                ${category.icon} ${escapeHtml(category.title)}
                ${category.mode
                    ? `<span class="shop-mode shop-mode--${category.mode}">${category.mode === "combine" ? "Se cumulent" : "Un seul à la fois"}</span>`
                    : ""}
            </h2>

            <div class="missions-grid shop-rows">
                ${category.items.map(cardOf).join("")}
            </div>

        </section>

    `).join("") + diamondShopHtml(); // diamants en dernier, avec leur bandeau « Obtenir des 💎 »

    // « Ton look » : dessiné tout de suite avec le classement gardé, puis rafraîchi.
    renderShopLook();

    loadShopLookRanking();

    container.querySelector("[data-chest-open]")?.addEventListener("click", event => {

        openRandomChest(event.currentTarget);

    });

    container.querySelectorAll("[data-chest-equip]").forEach(button => {

        button.addEventListener("click", () => answerChestEquip(button.dataset.chestEquip, button));

    });

    savedTilts.forEach((transform, itemId) => {

        const card = container.querySelector(`[data-shop-item="${itemId}"]`);

        if (card && transform) {

            card.classList.add("tilting");

            card.style.transform = transform;

        }

    });


    /*
        Filtres (le choix est gardé quand la boutique est redessinée).
    */

    container
        .querySelectorAll(".shop-filters .my-bets-filter")
        .forEach(button => {

            button.addEventListener("click", () => {

                shopFilter = button.dataset.filter;

                container
                    .querySelectorAll(".shop-filters .my-bets-filter")
                    .forEach(other => other.classList.toggle("active", other === button));

                container
                    .querySelectorAll(".shop-category")
                    .forEach(section => section.classList.toggle(
                        "hidden",
                        shopFilter !== "all" && section.dataset.kind !== shopFilter
                    ));

            });

        });


    container
        .querySelectorAll(".reward-preview-toggle[data-preview]")
        .forEach(button => {

            button.addEventListener(
                "click",
                async () => {

                    const field = button.dataset.preview;

                    const turnOn = !hasMyReward(field);

                    if (turnOn) {
                        await unequipConflicts(button.dataset.previewItem);
                    }

                    setAdminPreview(field, turnOn);

                    displayShop();

                    displayLeaderboard();

                    displayBets({ quiet: true });

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

            button.addEventListener("click", async () => {

                const id = button.dataset.cosmetic;

                const item = COSMETICS.find(c => c.id === id);

                const turnOn = !hasMyCosmetic(id);

                if (turnOn) {
                    await unequipConflicts(id);
                }

                setAdminPreview(
                    "cosmetic:" + id,
                    turnOn
                        ? (item.options ? shopSelections[id] || item.options[0] : true)
                        : false
                );

                displayShop();

                displayLeaderboard();

                displayBets({ quiet: true });

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


    container
        .querySelectorAll(".shield-buy")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => buyStreakShield(button, "shop-message")
            );

        });


    container
        .querySelectorAll(".restore-buy")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => restoreStreak(button, "shop-message")
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
    const effects =
        shopItemEffects(itemId, selected);

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
                ${leaderboardRowHtml({ username: "Emma" }, { rank: 2, medal: "", balance: formatBalance(1840), effects: {}, extraClass: " shop-preview-dim" })}
                ${leaderboardRowHtml(me, { rank: 3, medal: "", balance: formatBalance(1520), effects })}
                ${leaderboardRowHtml({ username: "Lucas" }, { rank: 4, medal: "", balance: formatBalance(1310), effects: {}, extraClass: " shop-preview-dim" })}
            </div>
            <p class="shop-preview-bet-line">
                Sur une carte de pari : 🏆 Créé par
                <span class="user-name${effects.gold ? " name-gold" : ""}">${nameHtml(me, effects)}</span>
            </p>
        `;

    }


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


/*
    Toutes les fenêtres (pari, parieurs, validation...) se ferment
    aussi en cliquant sur le fond sombre, hors de la carte.
    Sauf l'annonce admin et le message exceptionnel, qui doivent
    être fermés avec leur bouton pour être marqués comme lus.
*/

function setupModalBackdrops() {

    document
        .querySelectorAll(".modal:not(#announcement-modal):not(#removed-modal):not(#notice-modal):not(#gift-received-modal):not(#click-consent-modal)")
        .forEach(modal => {

            modal.addEventListener("mousedown", event => {

                // On retient où le clic a commencé, pour ne pas fermer
                // si on sélectionne du texte en glissant hors de la carte.
                modal._pressedOnBackdrop = event.target === modal;

            });

            modal.addEventListener("click", event => {

                if (event.target === modal && modal._pressedOnBackdrop) {
                    modal.classList.add("hidden");
                }

            });

        });

}


let openXpModal = null;


// Ouvre la fenêtre XP et met en avant un skin du perroquet (bouton d'un message).
function openXpModalOnSkin(skinId) {

    if (!openXpModal) {
        return;
    }

    openXpModal();

    const button =
        document.querySelector(`#xp-skins [data-skin="${skinId}"]`);

    const item =
        button?.closest(".xp-skin");

    if (!item) {
        return;
    }

    item.scrollIntoView({ block: "center", behavior: "smooth" });

    item.classList.remove("xp-skin-highlight");

    void item.offsetWidth;

    item.classList.add("xp-skin-highlight");

}


/*
    Carte « Ton niveau » : un clic ouvre la fenêtre XP
    (niveau actuel et façons de gagner de l'XP).
*/

function setupXpModal() {

    const card =
        document.getElementById("level-sidebar");

    const modal =
        document.getElementById("xp-modal");

    if (!card || !modal) {
        return;
    }

    const open = event => {

        // Le bouton « Débloquer le niveau » garde son propre rôle.
        if (event?.target.closest("#level-up-button")) {
            return;
        }

        document.getElementById("xp-modal-label").textContent =
            document.getElementById("level-sidebar-label").textContent;

        document.getElementById("xp-modal-xp").textContent =
            document.getElementById("level-sidebar-xp").textContent;

        document.getElementById("xp-modal-fill").style.width =
            document.getElementById("level-sidebar-fill").style.width;

        modal.classList.remove("hidden");

    };

    card.addEventListener("click", open);

    openXpModal = open;

    card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open(event);
        }
    });

    document
        .getElementById("close-xp-modal")
        .addEventListener("click", () => modal.classList.add("hidden"));

    setupXpMini(open);

}


/*
    Fenêtres XP et série (flamme) : sur ordinateur, posées pile au-dessus
    de la colonne des cartes de paris (même bord gauche, même largeur).
    Les cartes ne sont pas centrées dans la page, d'où ce calage.
*/

function alignModalsWithCards() {

    const modals =
        ["xp-modal", "streak-modal", "balance-modal", "diamond-modal", "player-modal", "points-modal"]
            .map(id => document.getElementById(id))
            .filter(Boolean);

    const align = modal => {

        const content = modal.querySelector(".modal-content");

        if (!content || modal.classList.contains("hidden")) {
            return;
        }

        const card = [...document.querySelectorAll("#bets-container .bet-card, #bets-container .bet-create-card")]
            .find(item => item.getBoundingClientRect().width > 0);

        // Téléphone, ou cartes pas affichées : la fenêtre reste centrée.
        if (PHONE_LAYOUT.matches || !card) {

            modal.style.justifyContent = "";

            content.style.marginLeft = "";

            content.style.width = "";

            content.style.maxWidth = "";

            return;

        }

        const rect = card.getBoundingClientRect();

        const padding = parseFloat(getComputedStyle(modal).paddingLeft) || 0;

        modal.style.justifyContent = "flex-start";

        content.style.marginLeft = (rect.left - padding) + "px";

        content.style.width = rect.width + "px";

        content.style.maxWidth = "none";

    };

    modals.forEach(modal => {

        // Alignée à chaque ouverture (la classe « hidden » est retirée).
        new MutationObserver(() => align(modal))
            .observe(modal, { attributes: true, attributeFilter: ["class"] });

    });

    window.addEventListener("resize", () => modals.forEach(align));

}


/*
    Téléphone : la carte « Ton niveau » est remplacée par une petite jauge
    dans la barre du haut. Elle recopie la carte (qui reste la seule mise à
    jour par animations.js) et l'ouvre au toucher, comme la flamme.
    Niveau à débloquer : la jauge brille et le toucher le débloque.
*/

function setupXpMini(openXpModal) {

    const mini = document.getElementById("xp-mini");

    const card = document.getElementById("level-sidebar");

    if (!mini || !card) {
        return;
    }

    const levelUpButton = document.getElementById("level-up-button");

    const sync = () => {

        const label = document.getElementById("level-sidebar-label").textContent.trim();

        document.getElementById("xp-mini-label").textContent =
            label.replace("Niveau", "Niv.");

        document.getElementById("xp-mini-fill").style.width =
            document.getElementById("level-sidebar-fill").style.width || "0%";

        document.getElementById("xp-mini-xp").textContent =
            document.getElementById("level-sidebar-xp").textContent.trim();

        // « ⭐ Débloquer le niveau 4 » → « ⭐ Débloquer niv. 4 » (ordinateur).
        if (levelUpButton) {

            document.getElementById("xp-mini-unlock").textContent =
                levelUpButton.textContent.trim().replace("le niveau", "niv.");

        }

        mini.classList.toggle(
            "pending",
            Boolean(levelUpButton && !levelUpButton.classList.contains("hidden"))
        );

    };

    new MutationObserver(sync).observe(card, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["style", "class"]
    });

    sync();

    mini.addEventListener("click", () => {

        if (mini.classList.contains("pending") && typeof claimNextLevel === "function") {

            claimNextLevel();

            return;

        }

        openXpModal();

    });

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

    // Les cartes de la boutique montrent leur aperçu directement (shopStageHtml) :
    // plus de fenêtre au clic sur une carte.

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
            ${equipLabel(itemId, on)}
        </button>
    `;

}


/*
    Objets qui ne se cumulent pas : un seul style de pseudo, un seul cadre,
    un seul thème de carte. Équiper l'un retire les autres du même groupe
    (boutique, diamants, coffre aléatoire, passe, pseudo enflammé).
    Emoji et étincelles se cumulent avec tout.
*/
const EXCLUSIVE_GROUPS = [
    {
        label: "style de pseudo",
        items: [
            "metal_or", "metal_argent", "metal_bronze", "metal_rose", "couleur",
            "neon", "neon_anime", "fiole", "ruban_chantier", "scanner",
            "diamond:cristal", "flame"
        ]
    },
    {
        label: "cadre",
        items: ["cadre", "aura", "diamond:cadre_diamant"]
    },
    {
        label: "thème de carte",
        items: ["theme", "diamond:theme_diamant"]
    }
];

// Champ de l'avantage pour le cadre doré et l'arc-en-ciel (aperçu admin).
const EXCLUSIVE_REWARD_FIELDS = {
    cadre: "gold_frame_until",
    couleur: "name_color_until"
};

// Groupe d'un objet (style de pseudo, cadre, thème), ou null s'il se cumule.
function exclusiveGroupOf(key) {

    return EXCLUSIVE_GROUPS.find(entry => entry.items.includes(key)) || null;

}

// Cet objet est-il possédé et équipé en ce moment (pour moi) ?
// Pour l'admin, « équipé » = son aperçu est activé.
function exclusiveItemOn(key) {

    if (key === "flame") {
        return flameNameOn(currentProfile);
    }

    if (key.startsWith("diamond:")) {
        return diamondItemOn(currentProfile, key.slice(8));
    }

    if (currentProfile?.is_admin) {
        return EXCLUSIVE_REWARD_FIELDS[key] ? hasMyReward(EXCLUSIVE_REWARD_FIELDS[key]) : hasMyCosmetic(key);
    }

    const owned =
        key === "cadre" ? isRewardActive(currentProfile?.gold_frame_until)
        : key === "couleur" ? isRewardActive(currentProfile?.name_color_until)
        : isRewardActive(currentProfile?.cosmetics?.[key]?.until);

    return owned && !currentProfile?.cosmetics?.[key]?.off;

}

// Retire les objets du même groupe que celui qu'on vient d'équiper.
// itemId : id de la boutique, « diamond:<id> » pour un objet en diamants,
// ou « flame » pour le pseudo enflammé. Renvoie le nombre d'objets retirés.
async function unequipConflicts(itemId) {

    if (!currentProfile) {
        return 0;
    }

    const group = exclusiveGroupOf(itemId);

    if (!group) {
        return 0;
    }

    let removed = 0;

    for (const key of group.items) {

        if (key === itemId || !exclusiveItemOn(key)) {
            continue;
        }

        // Admin : ses objets de boutique sont des aperçus locaux.
        if (currentProfile.is_admin && !key.startsWith("diamond:") && key !== "flame") {

            setAdminPreview(EXCLUSIVE_REWARD_FIELDS[key] || "cosmetic:" + key, false);

            removed++;

            continue;

        }

        const { error } =
            key === "flame"
                ? await supabaseClient.rpc("toggle_flame_name", { p_on: false })
            : key.startsWith("diamond:")
                ? await supabaseClient.rpc("toggle_diamond_item", { p_item: key.slice(8), p_on: false })
            : await supabaseClient.rpc("toggle_cosmetic", { p_group: currentGroup.id, p_item: key, p_on: false });

        if (error) {

            console.error(error);

            continue;

        }

        if (key === "flame") {
            currentProfile.flame_name_off = true;
        }

        removed++;

    }

    return removed;

}


// Texte du bouton d'équipement : « Équiper » (il remplace l'objet du même
// groupe, voir unequipConflicts) ou « ✓ Équipé · Retirer ».
function equipLabel(key, on) {

    return on ? "✓ Équipé · Retirer" : "Équiper";

}


async function toggleEquip(itemId, turnOn, button) {

    button.disabled = true;

    const { error } =
        await supabaseClient.rpc(
            "toggle_cosmetic",
            {
                p_group: currentGroup.id,
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

    if (turnOn) {
        await unequipConflicts(itemId);
    }

    await loadCurrentProfile();

    displayShop();

    settleShopCard(itemId);

    await displayLeaderboard();

    await displayBets({ quiet: true });

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


    /*
        Boutons : le prix pour acheter, ou pour un article possédé à options,
        « Équiper » pour passer gratuitement à l'option sélectionnée.
    */

    const ownedOption =
        currentProfile.cosmetics?.[item.id]?.option;

    const mainButton = !active
        ? shopPriceButtonHtml("cosmetic-buy", `data-cosmetic="${item.id}"`, item.price, canBuy)
        : item.options && selected !== ownedOption
            ? `<button class="primary-button cosmetic-buy" data-cosmetic="${item.id}">Équiper</button>`
            : "";


    // Néon et thème : pastilles de couleur (title = nom de l'option).
    const options = item.options
        ? `
            <div class="cosmetic-options">
                ${item.options.map(option => `
                    <button
                        class="cosmetic-option cosmetic-option--${item.id}${option === selected ? " active" : ""}"
                        data-cosmetic="${item.id}"
                        data-option="${escapeHtml(option)}"
                        title="${escapeHtml(item.id === "emoji" ? option : cosmeticOptionLabel(option))}"
                    >${escapeHtml(item.id === "emoji" ? option : cosmeticOptionLabel(option))}</button>
                `).join("")}
            </div>
        `
        : "";


    const previewOn =
        hasMyCosmetic(item.id);

    // Le clic du perroquet ne change pas le pseudo : pas d'aperçu.
    const adminToggle = currentProfile.is_admin && !item.id.startsWith("clic_perroquet")
        ? `
            <button
                class="reward-preview-toggle cosmetic-preview-toggle${previewOn ? " on" : ""}"
                data-cosmetic="${item.id}"
            >
                ${equipLabel(item.id, previewOn)}
            </button>
        `
        : "";


    return shopRowHtml({
        id: item.id,
        title: item.title,
        price: item.price,
        stage: shopStageHtml(item.id, selected),
        middle: options,
        actions: `
            ${mainButton}
            ${adminToggle}
            ${equipToggleHtml(item.id, active)}
        `
    });

}


/*
    Après un achat : la carte concernée se pose en douceur avec une brève lueur.
*/

function settleShopCard(itemId) {

    const card = document.querySelector(`#shop-container [data-shop-item="${itemId}"]`);

    if (!card) {

        return;

    }

    // Sans « transform » : la carte garde sa perspective pendant l'animation.
    card.animate(
        [
            { opacity: 0.35 },
            { opacity: 1 }
        ],
        { duration: 500, easing: "cubic-bezier(.2,.8,.2,1)" }
    );

    card.animate(
        [
            { boxShadow: "0 0 0 0 rgba(108, 99, 255, 0)" },
            { boxShadow: "0 0 28px 4px rgba(108, 99, 255, 0.55)", offset: 0.35 },
            { boxShadow: "0 0 0 0 rgba(108, 99, 255, 0)" }
        ],
        { duration: 1100, easing: "ease-out" }
    );

}


async function buyCosmetic(id, button) {

    // Arrivée des pièces : le bouton « Acheter » (avant que la carte ne change).
    const buttonRect = button.getBoundingClientRect();

    button.disabled = true;

    const item =
        COSMETICS.find(c => c.id === id);

    const option = item.options
        ? shopSelections[id] || currentProfile.cosmetics?.[id]?.option || item.options[0]
        : null;

    const pointsBefore = Number(currentProfile?.points || 0);


    try {

        const { data, error } =
            await supabaseClient.rpc(
                "buy_cosmetic",
                {
                    p_group: currentGroup.id,
                    p_item: id,
                    p_option: option
                }
            );

        if (error) {
            throw error;
        }

        // Achat (pas un simple changement d'option) : les pièces quittent le compteur
        // et filent vers le bouton, puis le reste se met à jour.
        const spent = data === "option" ? 0 : item.price;

        if (data !== "option") {
            await unequipConflicts(id);
        }

        if (spent > 0 && typeof spendCoins === "function") {

            if (currentProfile) {

                currentProfile.points = pointsBefore - spent;

            }

            await spendCoins(buttonRect, spent, pointsBefore);

        }

        await loadCurrentProfile();

        displayShop();

        settleShopCard(id);

        await displayLeaderboard();

        await displayBets({ quiet: true });

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

    const buttonRect = button.getBoundingClientRect();

    button.disabled = true;

    const pointsBefore = Number(currentProfile?.points || 0);


    try {

        const {
            error
        } = await supabaseClient.rpc(
            "buy_reward",
            {
                p_group: currentGroup.id,
                p_reward: rewardId
            }
        );


        if (error) {
            throw error;
        }


        const spent = REWARDS.find(reward => reward.id === rewardId)?.price || 0;

        // L'avantage arrive équipé : il remplace le cadre ou le style de pseudo porté.
        await unequipConflicts(rewardId);

        if (spent > 0 && typeof spendCoins === "function") {

            if (currentProfile) {

                currentProfile.points = pointsBefore - spent;

            }

            await spendCoins(buttonRect, spent, pointsBefore);

        }

        await loadCurrentProfile();

        displayShop();

        settleShopCard(rewardId);

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
   10 TER. AIDE APP (BÊTA-TESTEURS) ET JOURNAL DES NOUVEAUTÉS
   (tables et fonctions : aide-app.sql)
========================================================= */

const BETA_POINTS = {
    send: 10,
    ideaSend: 5,
    bugFixed: 50,
    ideaKept: 80,
    vote: 5,
    elected: 100
};

const BETA_TOPICS = [
    "Paris : créer / valider",
    "Mise : Simple / Combinée",
    "Profil : XP, flammes, argent, pièces",
    "Affichage / téléphone",
    "Autre"
];

// Pseudos réservés aux bêta-testeurs : un par palier de contributions.
const BETA_TIERS = [
    { at: 5, style: "terminal", name: "Terminal" },
    { at: 10, style: "glitch", name: "Glitch" }
];

// Palier du skin perroquet « chantier » (pas encore dessiné).
const BETA_SKIN_AT = 15;

const BETA_KINDS = {
    feature: "Fonctionnalité",
    design: "Design"
};


// Contributions des bêta-testeurs acceptés, par pseudo (leur pseudo bêta s'affiche partout).
let betaContributions = new Map();

// Ma ligne de beta_testers (null si je n'ai jamais demandé l'accès).
let myBeta = null;

// Demandes d'accès en attente (admin).
let betaRequests = [];

let betaTab = "idea";

let betaBugTopic = null;

let betaIdeaKind = "feature";

let betaBugs = [];

let betaIdeas = [];

let betaLikes = [];

// Brouillon de nouveauté de l'admin (rempli depuis une idée retenue).
let betaNewsDraft = { title: "", kind: "feature", ideaId: "" };


// Nouveautés de la semaine (journal de la page Paris) et mon vote du vendredi.
let weekNews = [];

let myWeekVote = null;

let betaVoteChoice = null;


function hasBetaAccess() {

    return Boolean(currentProfile?.is_admin) || myBeta?.status === "accepted";

}

// Version bêta de l'app (body.beta) : réservée à l'admin depuis le 2026-10-14
// (les bêta-testeurs gardent l'onglet Aide app, mais plus la version bêta).
function hasBetaVersionAccess() {

    return Boolean(currentProfile?.is_admin);

}


// Pseudo bêta d'un joueur : celui du plus haut palier atteint.
function betaStyleOf(username) {

    const contributions =
        betaContributions.get(username);

    if (contributions === undefined) {
        return null;
    }

    const reached =
        BETA_TIERS.filter(tier => contributions >= tier.at);

    return reached.length
        ? reached[reached.length - 1].style
        : null;

}


/*
    Dates à l'heure de Paris (le vote ouvre le vendredi,
    le journal repart à zéro le lundi).
*/

function parisDay(date = new Date()) {

    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(date);

}

// 1 = lundi … 7 = dimanche.
function parisWeekday() {

    return new Date(parisDay() + "T12:00:00Z").getUTCDay() || 7;

}

// Lundi de la semaine en cours, au format AAAA-MM-JJ.
function parisWeekStart() {

    const day = new Date(parisDay() + "T12:00:00Z");

    day.setUTCDate(day.getUTCDate() - (parisWeekday() - 1));

    return day.toISOString().slice(0, 10);

}


/*
    Statut bêta de tout le monde : mon accès, les demandes
    en attente (admin) et les contributions (pseudos bêta).
*/

async function loadBetaStatus() {

    const { data, error } = await supabaseClient
        .from("beta_testers")
        .select("user_id, status, contributions, decided_at, seen_at, requested_at, profiles!beta_testers_user_id_fkey ( username )");

    if (error) {
        console.error(error);
        return;
    }

    const rows = data || [];

    betaContributions = new Map(
        rows
            .filter(row => row.status === "accepted" && row.profiles)
            .map(row => [row.profiles.username, row.contributions])
    );

    myBeta =
        rows.find(row => row.user_id === currentUser?.id) || null;

    betaRequests =
        rows
            .filter(row => row.status === "pending" && row.profiles)
            .sort((a, b) => new Date(a.requested_at) - new Date(b.requested_at));

    refreshBetaNav();

}


// L'onglet Aide app a-t-il déjà été ouvert sur cet appareil ?
function betaTabKey() {

    return "beta-tab-visited-" + (currentUser?.id || "");

}

function betaTabVisited() {

    try {
        return localStorage.getItem(betaTabKey()) === "1";
    } catch {
        return true;
    }

}

function markBetaTabVisited() {

    try {
        localStorage.setItem(betaTabKey(), "1");
    } catch {}

    document
        .getElementById("beta-nav-button")
        ?.classList.remove("nav-highlight");

}


function refreshBetaNav() {

    displayVersionSwitch();

    const button =
        document.getElementById("beta-nav-button");

    button?.classList.toggle("hidden", !hasBetaAccess());

    // Nouveau bêta-testeur : l'onglet est mis en avant jusqu'à sa première visite.
    button?.classList.toggle(
        "nav-highlight",
        myBeta?.status === "accepted" && !currentProfile?.is_admin && !betaTabVisited()
    );

    // Admin : pastille tant que des demandes attendent une réponse.
    document
        .getElementById("beta-nav-dot")
        ?.classList.toggle("hidden", !(currentProfile?.is_admin && betaRequests.length));

}


/*
    Notifications : réponse à ma demande d'accès, bug corrigé,
    idée retenue ou non. Affichées une seule fois.
*/

async function notifyBetaUpdates() {

    if (!currentUser || currentProfile?.is_admin || typeof alertToast !== "function") {
        return;
    }

    const notes = [];

    // Accès accepté : une vraie fenêtre de bienvenue, pas une simple notification.
    const welcome =
        myBeta?.decided_at && !myBeta.seen_at && myBeta.status === "accepted";

    if (myBeta?.decided_at && !myBeta.seen_at && myBeta.status === "refused") {

        notes.push("Ta demande pour devenir bêta-testeur n'a pas été acceptée.");

    }

    if (myBeta?.status === "accepted") {

        const [bugs, ideas] = await Promise.all([
            supabaseClient
                .from("beta_bugs")
                .select("topic, status")
                .eq("user_id", currentUser.id)
                .neq("status", "sent")
                .is("seen_at", null),
            supabaseClient
                .from("beta_ideas")
                .select("text, status")
                .eq("user_id", currentUser.id)
                .neq("status", "sent")
                .is("seen_at", null)
        ]);

        (bugs.data || []).forEach(bug => {

            notes.push(
                bug.status === "fixed"
                    ? `Ton bug « ${escapeHtml(bug.topic)} » est corrigé : <b>+${BETA_POINTS.bugFixed} 🪙</b>`
                    : `Ton bug « ${escapeHtml(bug.topic)} » n'a pas été retenu.`
            );

        });

        (ideas.data || []).forEach(idea => {

            notes.push(
                idea.status === "kept"
                    ? `Ton idée « ${escapeHtml(idea.text)} » est retenue : <b>+${BETA_POINTS.ideaKept} 🪙</b>`
                    : idea.status === "later"
                        ? `Ton idée « ${escapeHtml(idea.text)} » est gardée pour plus tard.`
                        : `Ton idée « ${escapeHtml(idea.text)} » n'a pas été retenue.`
            );

        });

    }

    if (welcome) {

        document.getElementById("beta-welcome-modal")?.classList.remove("hidden");

    }

    if (!notes.length && !welcome) {
        return;
    }

    notes.forEach(text => {

        alertToast(text, {
            type: "beta",
            onClick: hasBetaAccess() ? () => openBetaPage() : null
        });

    });

    const { error } = await supabaseClient.rpc("beta_mark_seen");

    if (error) {
        console.error(error);
    }

}


function openBetaPage() {

    document
        .querySelector('.nav-button[data-page="beta-page"]')
        ?.click();

}


/*
    Version de l'app : classique ou bêta (beta.css, beta.js, saison.sql).
    Le choix est gardé dans localStorage « betlab-version » ; la classe
    « beta » est posée sur <body> dès le chargement (app.html).
    Réservé aux bêta-testeurs acceptés et à l'admin.
*/

function isBetaVersion() {

    return document.body.classList.contains("beta");

}

function setAppVersion(beta) {

    try {

        if (beta) {
            localStorage.setItem("betlab-version", "beta");
        } else {
            localStorage.removeItem("betlab-version");
        }

    } catch {}

    window.location.reload();

}

// Plus bêta-testeur (ou jamais été) : retour à la version classique.
function checkAppVersion() {

    if (isBetaVersion() && !hasBetaVersionAccess()) {

        setAppVersion(false);

        return false;

    }

    return true;

}

// Interrupteur « Bêta » de la barre du haut (même choix que la carte du Profil).
function displayVersionSwitch() {

    const button =
        document.getElementById("version-switch");

    if (!button) {
        return;
    }

    const beta = isBetaVersion();

    button.classList.toggle("hidden", !hasBetaVersionAccess());

    button.classList.toggle("on", beta);

    button.setAttribute("aria-checked", String(beta));

    button.title = beta ? "Revenir à la version classique" : "Passer à la version bêta";

    if (!button.dataset.ready) {

        button.dataset.ready = "1";

        button.addEventListener("click", () => {

            // Le bouton glisse avant le rechargement de la page.
            button.classList.toggle("on");

            setTimeout(() => setAppVersion(!isBetaVersion()), 200);

        });

    }

}

function displayVersionCard() {

    const card =
        document.getElementById("version-card");

    if (!card) {
        return;
    }

    if (!hasBetaVersionAccess()) {

        card.classList.add("hidden");

        return;

    }

    const beta = isBetaVersion();

    card.classList.remove("hidden");

    card.innerHTML = `
        <h2>🧪 Version de l'app</h2>

        <p class="version-state">
            ${beta
                ? "Tu utilises la <b>version bêta</b> : passe de combat, cartes épurées, plus de pièces ni de diamants."
                : "Tu utilises la <b>version classique</b>. La version bêta est réservée à l'admin."
            }
        </p>

        <button type="button" class="primary-button" id="version-switch-button">
            ${beta ? "Revenir à la version classique" : "Essayer la version bêta"}
        </button>
    `;

    card.querySelector("#version-switch-button").addEventListener("click", () => setAppVersion(!beta));

}


/*
    Carte du Profil : demander à devenir bêta-testeur.
*/

function displayBetaRequestCard() {

    displayVersionCard();

    const card =
        document.getElementById("beta-request-card");

    if (!card) {
        return;
    }

    // Admin et bêta-testeurs : l'onglet Aide app suffit.
    if (currentProfile?.is_admin || myBeta?.status === "accepted") {

        card.classList.add("hidden");

        return;

    }

    const pending =
        myBeta?.status === "pending";

    const refused =
        myBeta?.status === "refused";

    card.classList.remove("hidden");

    card.innerHTML = `
        <h2>🧪 Deviens bêta-testeur</h2>

        <p class="profile-hint">
            Teste les nouveautés en avant-première, signale les bugs, propose tes idées
            et gagne des 🪙 et des pseudos exclusifs.
        </p>

        ${pending
            ? `<p class="beta-request-state">⏳ Demande envoyée : en attente de l'admin.</p>`
            : `
                ${refused ? `<p class="beta-request-state refused">Ta dernière demande n'a pas été acceptée.</p>` : ""}
                <button type="button" class="primary-button" id="beta-request-button">
                    🙋 Devenir bêta-testeur
                </button>
            `}

        <p
            id="beta-request-message"
            class="missions-message hidden"
        ></p>
    `;

    card.querySelector("#beta-request-button")?.addEventListener("click", async event => {

        const button = event.currentTarget;

        button.disabled = true;

        const { error } = await supabaseClient.rpc("beta_request");

        if (error) {

            showMissionsMessage(error.message, true, "beta-request-message");

            button.disabled = false;

            return;

        }

        await loadBetaStatus();

        displayBetaRequestCard();

    });

}


/*
    Données de l'onglet : bugs (les miens, ou tous pour l'admin),
    idées de tout le monde et leurs « j'aime ».
*/

async function loadBetaData() {

    const [bugs, ideas, likes] = await Promise.all([
        supabaseClient
            .from("beta_bugs")
            .select("id, user_id, topic, text, status, created_at, profiles!beta_bugs_user_id_fkey ( username )")
            .order("created_at", { ascending: false }),
        supabaseClient
            .from("beta_ideas")
            .select("id, user_id, kind, text, status, kept_rewarded, created_at, profiles!beta_ideas_user_id_fkey ( username )")
            .order("created_at", { ascending: false }),
        // Votes anonymes : les totaux et mon vote seulement (beta-votes-idees.sql).
        supabaseClient.rpc("beta_idea_votes")
    ]);

    [bugs, ideas, likes].forEach(result => {

        if (result.error) {
            console.error(result.error);
        }

    });

    betaBugs = bugs.data || [];

    betaIdeas = ideas.data || [];

    betaLikes = likes.data || [];

}


async function displayBetaPage() {

    const container =
        document.getElementById("beta-container");

    if (!container) {
        return;
    }

    markBetaTabVisited();

    if (!hasBetaAccess()) {

        container.innerHTML = "";

        return;

    }

    await Promise.all([
        loadBetaStatus(),
        loadBetaData(),
        loadWeekNews()
    ]);

    renderBetaPage();

}


function renderBetaPage() {

    const container =
        document.getElementById("beta-container");

    if (!container) {
        return;
    }

    const isAdmin =
        Boolean(currentProfile?.is_admin);

    document.getElementById("beta-page-subtitle").textContent = isAdmin
        ? "Vue admin : demandes d'accès, journal de la semaine, bugs et idées à traiter."
        : "Merci de tester BetLab ! Signale les bugs et propose tes idées.";

    const tabs = [
        ["idea", "💡 Idées"],
        ["bug", "🐞 Bug"]
    ];

    container.innerHTML = `
        ${isAdmin ? betaRequestsHtml() + betaNewsAdminHtml() : betaProgressHtml()}

        <div class="beta-subnav">
            ${tabs.map(([key, label]) => `
                <button type="button" class="${betaTab === key ? "on" : ""}" data-beta-tab="${key}">${label}</button>
            `).join("")}
        </div>

        ${betaTab === "idea" ? betaIdeasHtml() : betaBugsHtml()}
    `;

}


/*
    Jauge des paliers : 5 = pseudo Terminal, 10 = pseudo Glitch,
    15 = skin chantier. Chaque palier a son aperçu (comme la boutique).
*/

function betaProgressHtml() {

    const contributions =
        myBeta?.contributions || 0;

    const percent =
        Math.min(100, contributions / BETA_SKIN_AT * 100);

    const nextTier =
        BETA_TIERS.find(tier => contributions < tier.at);

    const next = nextTier
        ? `encore ${nextTier.at - contributions} pour le pseudo ${nextTier.name}`
        : contributions < BETA_SKIN_AT
            ? `encore ${BETA_SKIN_AT - contributions} pour le skin chantier`
            : "tout est débloqué";

    const me = { username: currentProfile.username };

    return `
        <div class="beta-progress">

            <div class="beta-progress-head">
                <span><b>${contributions}</b> contribution${contributions > 1 ? "s" : ""}</span>
                <span>${next}</span>
            </div>

            <div class="beta-progress-track">
                <div class="beta-progress-fill" style="width: ${percent}%"></div>
                ${BETA_TIERS.map(tier => `
                    <span class="beta-progress-tick${contributions >= tier.at ? " done" : ""}" style="left: ${tier.at / BETA_SKIN_AT * 100}%"></span>
                `).join("")}
            </div>

            <div class="beta-progress-labels">
                ${BETA_TIERS.map(tier => `
                    <span class="${contributions >= tier.at ? "done" : ""}" style="left: ${tier.at / BETA_SKIN_AT * 100}%">
                        <button type="button" class="beta-tier-peek" data-beta-tier="${tier.style}" title="Voir l'aperçu">
                            <b>${tier.at}</b>
                            <span class="beta-tier-pill">
                                <span class="beta-tier-eye">👁</span>
                                <span class="beta-tier-name">${nameHtml(me, { beta: tier.style })}</span>
                                ${contributions >= tier.at ? " ✓" : ""}
                            </span>
                        </button>
                    </span>
                `).join("")}
                <span class="${contributions >= BETA_SKIN_AT ? "done" : ""}" style="left: 100%">
                    <b>${BETA_SKIN_AT}</b>skin chantier
                </span>
            </div>

        </div>
    `;

}


// Aperçu d'un pseudo bêta, dans la fenêtre d'aperçu de la boutique.
function openBetaTierPreview(style) {

    const tier =
        BETA_TIERS.find(item => item.style === style);

    if (!tier || !currentProfile) {
        return;
    }

    const me = { username: currentProfile.username };

    const effects = { beta: tier.style };

    const contributions =
        myBeta?.contributions || 0;

    document.getElementById("shop-preview-stage").innerHTML = `
        <h3 class="beta-preview-title">Pseudo ${tier.name}</h3>
        <div class="shop-preview-board">
            ${leaderboardRowHtml({ username: "Emma" }, { rank: 2, medal: "", balance: formatBalance(1840), effects: {}, extraClass: " shop-preview-dim" })}
            ${leaderboardRowHtml(me, { rank: 3, medal: "", balance: formatBalance(1520), effects })}
            ${leaderboardRowHtml({ username: "Lucas" }, { rank: 4, medal: "", balance: formatBalance(1310), effects: {}, extraClass: " shop-preview-dim" })}
        </div>
        <p class="shop-preview-bet-line">
            Sur une carte de pari : 🏆 Créé par
            <span class="user-name">${nameHtml(me, effects)}</span>
        </p>
        <p class="beta-preview-lock">
            ${contributions >= tier.at
                ? "✓ Débloqué"
                : `🔒 Débloqué à ${tier.at} contributions (encore ${tier.at - contributions})`}
            · réservé aux bêta-testeurs
        </p>
    `;

    document.getElementById("shop-preview-options").innerHTML = "";

    document.getElementById("shop-preview-modal").classList.remove("hidden");

}


// Admin : demandes d'accès en attente.
function betaRequestsHtml() {

    if (!betaRequests.length) {
        return "";
    }

    return `
        <div class="beta-requests">
            <b>🙋 Demandes pour devenir bêta-testeur (${betaRequests.length})</b>
            ${betaRequests.map(request => `
                <div class="beta-request">
                    <span>${styledName(request.profiles)}</span>
                    <button type="button" class="primary-button" data-beta-accept="${request.user_id}">Accepter</button>
                    <button type="button" class="secondary-button" data-beta-refuse="${request.user_id}">Refuser</button>
                </div>
            `).join("")}
        </div>
    `;

}


// Admin : publier une nouveauté dans le journal de la page Paris.
function betaNewsAdminHtml() {

    const kept =
        betaIdeas.filter(idea => idea.status === "kept");

    return `
        <div class="beta-card beta-news-admin">

            <h3>📖 Journal de la semaine</h3>

            <p class="beta-meta">
                Visible par tous sur la page Paris jusqu'à lundi. Seulement les fonctionnalités et le design, pas les bugs corrigés.
            </p>

            <div class="beta-topics">
                ${Object.entries(BETA_KINDS).map(([key, label]) => `
                    <button type="button" class="beta-topic${betaNewsDraft.kind === key ? " on" : ""}" data-beta-news-kind="${key}">${label}</button>
                `).join("")}
            </div>

            <div class="beta-news-form">
                <input
                    type="text"
                    class="beta-input"
                    id="beta-news-title"
                    maxlength="80"
                    placeholder="Titre de la nouveauté"
                    value="${escapeHtml(betaNewsDraft.title)}"
                >
                <select class="beta-input" id="beta-news-idea">
                    <option value="">🛠️ Équipe BetLab</option>
                    ${kept.map(idea => `
                        <option value="${idea.id}"${String(idea.id) === String(betaNewsDraft.ideaId) ? " selected" : ""}>
                            💡 Idée de ${escapeHtml(idea.profiles?.username || "?")} : ${escapeHtml(idea.text.slice(0, 40))}
                        </option>
                    `).join("")}
                </select>
                <button type="button" class="primary-button" data-beta-news-add>Publier</button>
            </div>

            <div class="beta-list">
                ${weekNews.length
                    ? weekNews.map(news => `
                        <div class="beta-item">
                            <div class="beta-item-text">
                                <b>${escapeHtml(news.title)}</b>
                                <p>${BETA_KINDS[news.kind]} · ${news.profiles?.username ? "idée de " + escapeHtml(news.profiles.username) : "Équipe BetLab"}</p>
                            </div>
                            <button type="button" class="secondary-button" data-beta-news-delete="${news.id}" title="Retirer du journal">✕</button>
                        </div>
                    `).join("")
                    : `<p class="beta-empty">Rien de publié cette semaine.</p>`}
            </div>

        </div>
    `;

}


const BETA_BUG_STATUS = {
    sent: { icon: "📨", label: "Envoyé", className: "sent" },
    fixed: { icon: "✅", label: "Corrigé", className: "ok" },
    rejected: { icon: "✖", label: "Rejeté", className: "no" }
};

const BETA_IDEA_STATUS = {
    sent: { icon: "📨", label: "Envoyée", className: "sent" },
    later: { icon: "⏳", label: "Plus tard", className: "later" },
    kept: { icon: "⭐", label: "Retenue", className: "ok" },
    rejected: { icon: "✖", label: "Pas retenue", className: "no" }
};


function betaGainHtml(points) {

    return `<span class="beta-gain">+${points} 🪙</span>`;

}


function betaBugsHtml() {

    const isAdmin =
        Boolean(currentProfile?.is_admin);

    const list = isAdmin
        ? betaBugs
        : betaBugs.filter(bug => bug.user_id === currentUser.id);

    return `
        <div class="beta-stack">

            ${isAdmin ? "" : `
                <div class="beta-card">
                    <h3 class="beta-card-head">🐞 Signaler un bug <span class="beta-bonus">+${BETA_POINTS.bugFixed} 🪙 si corrigé</span></h3>
                    <div class="beta-topics">
                        ${BETA_TOPICS.map(topic => `
                            <button type="button" class="beta-topic${betaBugTopic === topic ? " on" : ""}" data-beta-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>
                        `).join("")}
                    </div>
                    <textarea
                        class="beta-input"
                        id="beta-bug-text"
                        rows="3"
                        maxlength="600"
                        placeholder="Explique ce qui s'est passé et ce que tu attendais…"
                    ></textarea>
                    <div class="beta-actions">
                        <button type="button" class="primary-button" data-beta-send-bug ${betaBugTopic ? "" : "disabled"}>
                            Envoyer ${betaGainHtml(BETA_POINTS.send)}
                        </button>
                    </div>
                </div>
            `}

            <div class="beta-card">
                <h3>${isAdmin ? "🐞 Bugs signalés" : "📋 Mes signalements"}</h3>
                <div class="beta-list">
                    ${list.length
                        ? list.map(bug => {
                            const status = BETA_BUG_STATUS[bug.status];
                            return `
                                <div class="beta-item beta-item--${status.className}">
                                    <span class="beta-item-icon">${status.icon}</span>
                                    <div class="beta-item-text">
                                        <b>${escapeHtml(bug.topic)}</b>${isAdmin ? ` · ${styledName(bug.profiles)}` : ""}
                                        <p>${escapeHtml(bug.text)}</p>
                                    </div>
                                    <div class="beta-item-side">
                                        <span class="beta-status beta-status--${status.className}">${status.label}</span>
                                        ${isAdmin && bug.status === "sent" ? `
                                            <div class="beta-item-buttons">
                                                <button type="button" class="primary-button" data-beta-fix="${bug.id}">✓ Corrigé ${betaGainHtml(BETA_POINTS.bugFixed)}</button>
                                                <button type="button" class="secondary-button" data-beta-reject-bug="${bug.id}">Rejeter</button>
                                            </div>
                                        ` : ""}
                                    </div>
                                </div>
                            `;
                        }).join("")
                        : `<p class="beta-empty">Aucun signalement pour l'instant.</p>`}
                </div>
            </div>

        </div>
    `;

}


// Date de publication d'une idée : « aujourd'hui à 14:32 », « hier à 9:05 », « le 3 oct. à 18:00 ».
function betaDateLabel(value) {

    const date = new Date(value);

    const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    const yesterday = new Date();

    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === new Date().toDateString()) {
        return `aujourd'hui à ${time}`;
    }

    if (date.toDateString() === yesterday.toDateString()) {
        return `hier à ${time}`;
    }

    return `le ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${time}`;

}


function betaIdeasHtml() {

    const isAdmin =
        Boolean(currentProfile?.is_admin);

    // Votes anonymes : { idea_id, likes, dislikes, my_vote } par idée.
    const votesOf = id =>
        betaLikes.find(vote => vote.idea_id === id) || { likes: 0, dislikes: 0, my_vote: null };

    // Les plus récentes en haut.
    const sorted = [...betaIdeas].sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
    );

    return `
        <div class="beta-stack">

            ${isAdmin ? "" : `
                <div class="beta-card">
                    <h3 class="beta-card-head">💡 Proposer une idée <span class="beta-bonus">+${BETA_POINTS.ideaKept} 🪙 si retenue</span></h3>
                    <div class="beta-topics">
                        ${Object.entries(BETA_KINDS).map(([key, label]) => `
                            <button type="button" class="beta-topic${betaIdeaKind === key ? " on" : ""}" data-beta-kind="${key}">${key === "design" ? "🎨" : "🧩"} ${label}</button>
                        `).join("")}
                    </div>
                    <div class="beta-idea-form">
                        <input
                            type="text"
                            class="beta-input"
                            id="beta-idea-text"
                            maxlength="300"
                            placeholder="${betaIdeaKind === "design" ? "Ex. : un thème de nuit pour les cartes" : "Ex. : pouvoir parier en équipe"}"
                        >
                        <button type="button" class="primary-button" data-beta-send-idea>
                            Proposer ${betaGainHtml(BETA_POINTS.ideaSend)}
                        </button>
                    </div>
                </div>
            `}

            <div class="beta-card">
                <h3>🗳️ Les idées de tout le monde</h3>
                <p class="beta-meta">👍 J'aime / 👎 J'aime pas : les votes sont anonymes, personne ne voit qui a voté quoi.</p>
                <div class="beta-list">
                    ${sorted.length
                        ? sorted.map(idea => {
                            const status = BETA_IDEA_STATUS[idea.status];
                            const mine = idea.user_id === currentUser.id;
                            return `
                                <div class="beta-item beta-item--${status.className}">
                                    <div class="beta-item-text">
                                        <b>${escapeHtml(idea.text)}</b>
                                        <p>${idea.kind === "design" ? "🎨 Design" : "🧩 Fonctionnalité"} · par ${mine ? "toi" : styledName(idea.profiles)} · ${betaDateLabel(idea.created_at)}</p>
                                    </div>
                                    <div class="beta-item-side">
                                        <div class="beta-item-status-row">
                                            <div class="beta-votes">
                                                ${[[1, "👍", "J'aime", "likes"], [-1, "👎", "J'aime pas", "dislikes"]].map(([value, icon, label, field]) => `
                                                    <button
                                                        type="button"
                                                        class="beta-like beta-vote${value < 0 ? " beta-vote--down" : ""}${votesOf(idea.id).my_vote === value ? " on" : ""}"
                                                        data-beta-vote="${idea.id}"
                                                        data-vote="${value}"
                                                        ${mine || isAdmin ? "disabled" : ""}
                                                        title="${mine ? "Ta propre idée" : label}"
                                                    >
                                                        <span class="beta-like-icon">${icon}</span>${votesOf(idea.id)[field]}
                                                    </button>
                                                `).join("")}
                                            </div>
                                            <span class="beta-status beta-status--${status.className}">${status.icon} ${status.label}</span>
                                        </div>
                                        ${isAdmin ? `
                                            <div class="beta-item-buttons">
                                                ${idea.status !== "kept"
                                                    // Les pièces ne sont versées qu'une fois (idees-changer-statut.sql).
                                                    ? `<button type="button" class="primary-button" data-beta-status="kept" data-idea="${idea.id}">★ Retenir ${idea.kept_rewarded ? "" : betaGainHtml(BETA_POINTS.ideaKept)}</button>`
                                                    : ""}
                                                ${idea.status !== "later"
                                                    ? `<button type="button" class="secondary-button" data-beta-status="later" data-idea="${idea.id}">⏳ Plus tard</button>`
                                                    : ""}
                                                ${idea.status !== "rejected"
                                                    ? `<button type="button" class="secondary-button" data-beta-status="rejected" data-idea="${idea.id}">Pas retenue</button>`
                                                    : ""}
                                            </div>
                                        ` : ""}
                                        ${isAdmin && idea.status === "kept"
                                            ? `<button type="button" class="secondary-button" data-beta-to-news="${idea.id}">📖 Au journal</button>`
                                            : ""}
                                        ${isAdmin
                                            // Admin : supprimer l'idée (aide-app-suppression-idee.sql), 2 clics.
                                            ? `<button type="button" class="beta-idea-delete" data-beta-idea-delete="${idea.id}">🗑️ Supprimer</button>`
                                            : ""}
                                    </div>
                                </div>
                            `;
                        }).join("")
                        : `<p class="beta-empty">Aucune idée pour l'instant : lance-toi !</p>`}
                </div>
            </div>

        </div>
    `;

}


/*
    Envoi d'un bug, d'une idée ou d'un vote : les pièces gagnées
    volent du bouton jusqu'au compteur de points.
*/

async function betaEarn(button, rpc, params) {

    const origin =
        button.getBoundingClientRect();

    const pointsBefore =
        Number(currentProfile?.points || 0);

    button.disabled = true;

    const { data, error } =
        await supabaseClient.rpc(rpc, params);

    if (error) {

        button.disabled = false;

        throw error;

    }

    const gained =
        Number(data) || 0;

    if (currentProfile) {
        currentProfile.points = pointsBefore + gained;
    }

    if (typeof flyCoins === "function") {
        flyCoins(origin, gained, pointsBefore);
    }

    return gained;

}


// Après un envoi : une contribution de plus, et peut-être un pseudo débloqué.
function betaCountContribution() {

    if (!myBeta) {
        return;
    }

    myBeta.contributions += 1;

    betaContributions.set(currentProfile.username, myBeta.contributions);

    const tier =
        BETA_TIERS.find(item => item.at === myBeta.contributions);

    if (tier && typeof alertToast === "function") {

        alertToast(`Pseudo <b>${tier.name}</b> débloqué ! Il s'affiche partout sur le site.`, {
            type: "beta",
            onClick: () => openBetaTierPreview(tier.style)
        });

    }

}


function burstLikes(button) {

    const rect = button.getBoundingClientRect();

    const icons = ["👍", "💚", "✨"];

    for (let i = 0; i < 7; i++) {

        const heart = document.createElement("span");

        heart.className = "beta-like-burst";

        heart.textContent = icons[i % icons.length];

        heart.style.left = rect.left + rect.width / 2 - 7 + "px";

        heart.style.top = rect.top + 6 + "px";

        document.body.appendChild(heart);

        const angle = (Math.PI * 2 * i) / 7;

        heart.animate(
            [
                { transform: "translate(0, 0) scale(0.4)", opacity: 1 },
                { transform: `translate(${Math.cos(angle) * 40}px, ${Math.sin(angle) * 40 - 10}px) scale(1)`, opacity: 0 }
            ],
            { duration: 650, easing: "ease-out" }
        ).finished.then(() => heart.remove()).catch(() => heart.remove());

    }

}


function setupBetaPage() {

    const container =
        document.getElementById("beta-container");

    if (!container) {
        return;
    }

    const message = (text, isError = false) =>
        showMissionsMessage(text, isError, "beta-message");

    container.addEventListener("click", async event => {

        const button = event.target.closest("button");

        if (!button || button.disabled) {
            return;
        }

        const data = button.dataset;

        try {

            if (data.betaTab) {

                betaTab = data.betaTab;

                renderBetaPage();

            } else if (data.betaTier) {

                openBetaTierPreview(data.betaTier);

            } else if (data.betaTopic) {

                const text = document.getElementById("beta-bug-text")?.value || "";

                betaBugTopic = data.betaTopic;

                renderBetaPage();

                // Le texte déjà tapé est gardé.
                document.getElementById("beta-bug-text").value = text;

            } else if (data.betaSendBug !== undefined) {

                const text = document.getElementById("beta-bug-text").value;

                await betaEarn(button, "beta_send_bug", {
                    p_group: currentGroup.id,
                    p_topic: betaBugTopic,
                    p_text: text
                });

                betaBugTopic = null;

                betaCountContribution();

                message("Bug reçu, merci ! Tu suis son avancement juste en dessous.");

                await loadBetaData();

                renderBetaPage();

            } else if (data.betaKind) {

                const text = document.getElementById("beta-idea-text")?.value || "";

                betaIdeaKind = data.betaKind;

                renderBetaPage();

                document.getElementById("beta-idea-text").value = text;

            } else if (data.betaSendIdea !== undefined) {

                const input = document.getElementById("beta-idea-text");

                if (!input.value.trim()) {

                    input.focus();

                    return;

                }

                await betaEarn(button, "beta_send_idea", {
                    p_group: currentGroup.id,
                    p_kind: betaIdeaKind,
                    p_text: input.value
                });

                betaCountContribution();

                message("Idée envoyée : les autres bêta-testeurs peuvent l'aimer.");

                await loadBetaData();

                renderBetaPage();

            } else if (data.betaVote) {

                const id = Number(data.betaVote);

                const { data: vote, error } = await supabaseClient.rpc("beta_vote_idea", {
                    p_idea: id,
                    p_vote: Number(data.vote)
                });

                if (error) {
                    throw error;
                }

                // Totaux à jour (les autres ont pu voter entre-temps).
                const votes = await supabaseClient.rpc("beta_idea_votes");

                if (!votes.error) {
                    betaLikes = votes.data || [];
                }

                renderBetaPage();

                if (vote === 1) {

                    const again = container.querySelector(`[data-beta-vote="${id}"][data-vote="1"]`);

                    if (again) {

                        again.classList.add("boom");

                        burstLikes(again);

                    }

                }

            } else if (data.betaAccept || data.betaRefuse) {

                const { error } = await supabaseClient.rpc("beta_decide", {
                    p_user: data.betaAccept || data.betaRefuse,
                    p_accept: Boolean(data.betaAccept)
                });

                if (error) {
                    throw error;
                }

                message(data.betaAccept ? "Accès bêta accordé." : "Demande refusée.");

                await loadBetaStatus();

                renderBetaPage();

            } else if (data.betaFix) {

                const { error } = await supabaseClient.rpc("beta_fix_bug", { p_bug: Number(data.betaFix) });

                if (error) {
                    throw error;
                }

                message(`Bug corrigé : son auteur reçoit +${BETA_POINTS.bugFixed} 🪙 et une notification.`);

                await loadBetaData();

                renderBetaPage();

            } else if (data.betaRejectBug) {

                const { error } = await supabaseClient.rpc("beta_reject_bug", { p_bug: Number(data.betaRejectBug) });

                if (error) {
                    throw error;
                }

                message("Bug rejeté : son auteur est prévenu.");

                await loadBetaData();

                renderBetaPage();

            } else if (data.betaStatus) {

                // Statut changeable à tout moment par l'admin (idees-changer-statut.sql).
                const idea = betaIdeas.find(item => String(item.id) === data.idea);

                // Bouton en attente (rond qui tourne) jusqu'à la réponse de Supabase.
                button.classList.add("is-busy");

                button.closest(".beta-item-buttons")
                    ?.querySelectorAll("button")
                    .forEach(other => other.disabled = true);

                const { error } = await supabaseClient.rpc("beta_set_idea_status", {
                    p_idea: Number(data.idea),
                    p_status: data.betaStatus
                });

                if (error) {

                    button.classList.remove("is-busy");

                    button.closest(".beta-item-buttons")
                        ?.querySelectorAll("button")
                        .forEach(other => other.disabled = false);

                    throw error;

                }

                message({
                    kept: idea?.kept_rewarded
                        ? "Idée de nouveau retenue (pièces déjà versées) : son auteur est prévenu."
                        : `Idée retenue : son auteur reçoit +${BETA_POINTS.ideaKept} 🪙 et une notification.`,
                    later: "Idée gardée pour plus tard : son auteur est prévenu.",
                    rejected: "Idée marquée « pas retenue » : son auteur est prévenu."
                }[data.betaStatus]);

                await loadBetaData();

                renderBetaPage();

            } else if (data.betaToNews) {

                const idea = betaIdeas.find(item => String(item.id) === data.betaToNews);

                betaNewsDraft = {
                    title: idea.text.slice(0, 80),
                    kind: idea.kind,
                    ideaId: idea.id
                };

                renderBetaPage();

                document.getElementById("beta-news-title")?.focus();

            } else if (data.betaNewsKind) {

                betaNewsDraft = {
                    title: document.getElementById("beta-news-title").value,
                    kind: data.betaNewsKind,
                    ideaId: document.getElementById("beta-news-idea").value
                };

                renderBetaPage();

            } else if (data.betaNewsAdd !== undefined) {

                const ideaId = document.getElementById("beta-news-idea").value;

                const { error } = await supabaseClient.rpc("beta_add_news", {
                    p_title: document.getElementById("beta-news-title").value,
                    p_kind: betaNewsDraft.kind,
                    p_idea: ideaId ? Number(ideaId) : null
                });

                if (error) {
                    throw error;
                }

                betaNewsDraft = { title: "", kind: "feature", ideaId: "" };

                message("Nouveauté publiée dans le journal de la page Paris.");

                await loadWeekNews();

                renderBetaPage();

            } else if (data.betaIdeaDelete) {

                // 1er clic : « Confirmer ? » pendant 4 s, 2e clic : suppression.
                if (!button.classList.contains("confirm")) {

                    button.classList.add("confirm");

                    button.textContent = "🗑️ Confirmer ?";

                    setTimeout(() => {
                        if (button.isConnected) {
                            button.classList.remove("confirm");
                            button.textContent = "🗑️ Supprimer";
                        }
                    }, 4000);

                    return;

                }

                const { error } = await supabaseClient.rpc("beta_delete_idea", { p_idea: Number(data.betaIdeaDelete) });

                if (error) {
                    throw error;
                }

                message("Idée supprimée.");

                await loadBetaData();

                renderBetaPage();

            } else if (data.betaNewsDelete) {

                const { error } = await supabaseClient.rpc("beta_delete_news", { p_news: Number(data.betaNewsDelete) });

                if (error) {
                    throw error;
                }

                await loadWeekNews();

                renderBetaPage();

            }

        } catch (error) {

            console.error(error);

            message(error.message || "Une erreur est survenue.", true);

        }

    });

}


/*
    Journal des nouveautés (page Paris, sous le classement) :
    seulement les nouveautés de la semaine, et le vote du vendredi.
*/

async function loadWeekNews() {

    const weekStart =
        parisWeekStart();

    // Un peu plus large que la semaine, puis tri à l'heure de Paris.
    const since =
        new Date(new Date(weekStart + "T00:00:00Z").getTime() - 86400000).toISOString();

    const [news, vote] = await Promise.all([
        supabaseClient
            .from("beta_news")
            .select("id, title, kind, author_id, created_at, profiles!beta_news_author_id_fkey ( username )")
            .gte("created_at", since)
            .order("created_at"),
        currentUser
            ? supabaseClient
                .from("beta_votes")
                .select("news_id")
                .eq("week_start", weekStart)
                .eq("user_id", currentUser.id)
                .maybeSingle()
            : { data: null }
    ]);

    if (news.error) {

        console.error(news.error);

        return;

    }

    weekNews =
        (news.data || []).filter(item => parisDay(new Date(item.created_at)) >= weekStart);

    myWeekVote =
        vote.data?.news_id || null;

    renderNewsJournal();

}


// Le vote est ouvert du vendredi au dimanche, s'il y a au moins 2 nouveautés.
function betaVoteOpen() {

    return parisWeekday() >= 5 && weekNews.length >= 2;

}


function renderNewsJournal() {

    const journal =
        document.getElementById("news-journal");

    if (!journal) {
        return;
    }

    journal.classList.toggle("hidden", weekNews.length === 0);

    if (!weekNews.length) {

        journal.innerHTML = "";

        return;

    }

    const vote = !betaVoteOpen()
        ? ""
        : myWeekVote
            ? `<button type="button" class="news-journal-vote done" data-journal-vote>✓ Tu as voté · voir les résultats</button>`
            : `<div class="news-journal-vote">🏆 Vote de la semaine <button type="button" data-journal-vote>Voter +${BETA_POINTS.vote} 🪙</button></div>`;

    journal.innerHTML = `
        <div class="news-journal-head">
            📖 Nouveautés
            <span>cette semaine</span>
        </div>

        ${vote}

        <div class="news-journal-list">
            ${weekNews.map(news => `
                <div class="news-journal-line${news.author_id === currentUser?.id ? " mine" : ""}" title="${escapeHtml(news.title)}">
                    <span class="news-journal-new">NEW</span>
                    <span class="news-journal-title">${escapeHtml(news.title)}</span>
                    <span class="news-journal-who">${news.profiles?.username ? "#" + escapeHtml(news.profiles.username) : "Équipe"}</span>
                </div>
            `).join("")}
        </div>
    `;

}


/*
    Fenêtre du vote : choix puis « Voter », définitif.
    Après le vote, elle montre les résultats.
*/

async function openBetaVote() {

    const body =
        document.getElementById("beta-vote-body");

    const modal =
        document.getElementById("beta-vote-modal");

    if (!body || !modal) {
        return;
    }

    let counts = new Map();

    if (myWeekVote) {

        const { data } = await supabaseClient
            .from("beta_votes")
            .select("news_id")
            .eq("week_start", parisWeekStart());

        (data || []).forEach(vote => counts.set(vote.news_id, (counts.get(vote.news_id) || 0) + 1));

    }

    const total =
        [...counts.values()].reduce((sum, count) => sum + count, 0) || 1;

    body.innerHTML = `
        <h2 class="beta-vote-title">🏆 Meilleure nouveauté de la semaine</h2>

        <p class="beta-vote-hint">
            ${myWeekVote
                ? "Résultats en direct. Le gagnant est connu lundi."
                : `L'auteur de l'idée élue gagne +${BETA_POINTS.elected} 🪙. Un seul vote, définitif.`}
        </p>

        <div class="beta-vote-options">
            ${weekNews.map(news => {
                const percent = Math.round((counts.get(news.id) || 0) / total * 100);
                return `
                    <button
                        type="button"
                        class="beta-vote-option${betaVoteChoice === news.id && !myWeekVote ? " selected" : ""}${myWeekVote === news.id ? " mine" : ""}"
                        data-vote-option="${news.id}"
                        ${myWeekVote ? "disabled" : ""}
                    >
                        ${myWeekVote ? `<i class="beta-vote-bar" style="width: ${percent}%"></i>` : ""}
                        <span>${escapeHtml(news.title)}</span>
                        ${myWeekVote ? `<b>${percent} %</b>` : ""}
                    </button>
                `;
            }).join("")}
        </div>

        ${myWeekVote ? "" : `
            <button type="button" class="primary-button beta-vote-go" data-vote-go ${betaVoteChoice ? "" : "disabled"}>
                Voter ${betaGainHtml(BETA_POINTS.vote)}
            </button>
        `}

        <p
            id="beta-vote-message"
            class="missions-message hidden"
        ></p>
    `;

    modal.classList.remove("hidden");

}


function setupNewsJournal() {

    document.getElementById("news-journal")?.addEventListener("click", event => {

        if (event.target.closest("[data-journal-vote]")) {
            openBetaVote();
        }

    });

    document.getElementById("close-beta-vote")?.addEventListener("click", () => {

        document.getElementById("beta-vote-modal").classList.add("hidden");

    });

    document.getElementById("beta-vote-body")?.addEventListener("click", async event => {

        const option = event.target.closest("[data-vote-option]");

        if (option && !option.disabled) {

            betaVoteChoice = Number(option.dataset.voteOption);

            openBetaVote();

            return;

        }

        const go = event.target.closest("[data-vote-go]");

        if (!go || go.disabled || !betaVoteChoice) {
            return;
        }

        try {

            await betaEarn(go, "beta_vote", {
                p_group: currentGroup.id,
                p_news: betaVoteChoice
            });

            myWeekVote = betaVoteChoice;

            betaVoteChoice = null;

            renderNewsJournal();

            openBetaVote();

        } catch (error) {

            console.error(error);

            showMissionsMessage(error.message || "Vote impossible.", true, "beta-vote-message");

        }

    });

}


/*
    Le ticket de mise apparaît (ou disparaît) entre le classement
    et le journal : le journal glisse vers sa nouvelle place.
*/

function newsJournalTop() {

    const journal =
        document.getElementById("news-journal");

    return journal && !journal.classList.contains("hidden")
        ? journal.getBoundingClientRect().top
        : null;

}

function slideNewsJournal(previousTop) {

    const journal =
        document.getElementById("news-journal");

    if (previousTop === null || !journal) {
        return;
    }

    const shift =
        previousTop - journal.getBoundingClientRect().top;

    if (Math.abs(shift) < 2) {
        return;
    }

    journal.animate(
        [
            { transform: `translateY(${shift}px)` },
            { transform: "none" }
        ],
        { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" }
    );

}


/*
    Après l'affichage (statut bêta et journal déjà chargés) :
    boutons, carte du Profil, dépouillement des votes passés et notifications.
*/

async function initBeta() {

    setupBetaPage();

    setupNewsJournal();

    displayBetaRequestCard();


    // Fenêtre de bienvenue des nouveaux bêta-testeurs.
    const welcome =
        document.getElementById("beta-welcome-modal");

    document.getElementById("close-beta-welcome")?.addEventListener("click", () => {

        welcome.classList.add("hidden");

    });

    document.getElementById("beta-welcome-go")?.addEventListener("click", () => {

        welcome.classList.add("hidden");

        openBetaPage();

    });

    supabaseClient.rpc("beta_settle_votes").then(({ error }) => {

        if (error) {
            console.error(error);
        }

    });

    notifyBetaUpdates();

}



/* =========================================================
   10 QUATER. DIAMANTS 💎
   Monnaie commune à tous les groupes : objets exclusifs,
   échange en pièces, packs « bientôt disponibles » (diamants.sql).
========================================================= */

const DIAMOND_RATE = 200;

const DIAMOND_ITEMS = [
    {
        id: "cristal",
        title: "Pseudo cristal",
        description: "Ton pseudo scintille comme un diamant, avec un reflet bleu-violet qui passe.",
        price: 1
    },
    {
        id: "cadre_diamant",
        title: "Cadre diamant",
        description: "Ta ligne du classement brille d'un contour de diamant.",
        price: 2
    },
    {
        id: "theme_diamant",
        title: "Thème de carte « Diamant »",
        description: "Les paris que tu crées ont un fond cristal étoilé, visible par tous.",
        price: 5
    },
    {
        id: "skin_cristal",
        title: "Skin perroquet « Cristal »",
        description: "Le perroquet devient bleu glacier et lavande.",
        price: 10
    }
];

const DIAMOND_PACKS = [
    { count: 5, price: "1,99 €", bonus: "" },
    { count: 12, price: "3,99 €", bonus: "+2 offerts" },
    { count: 30, price: "8,99 €", bonus: "+5 offerts", best: true },
    { count: 80, price: "19,99 €", bonus: "+20 offerts" }
];

let diamondConvertCount = 1;


function myDiamonds() {

    return Number(currentProfile?.diamonds) || 0;

}

function ownsDiamondItem(id) {

    return Boolean(currentProfile?.diamond_items?.[id]);

}

// Objet exclusif possédé et équipé (pour n'importe quel joueur).
function diamondItemOn(profile, id) {

    const item = profile?.diamond_items?.[id];

    return Boolean(item) && !item.off;

}


function updateDiamondDisplay() {

    const element = document.getElementById("diamond-balance");

    if (element) {

        element.textContent = currentProfile?.is_admin
            ? "∞ 💎"
            : myDiamonds() + " 💎";

    }

}


// Aperçu d'un objet exclusif dans sa carte de la boutique.
function diamondPreviewHtml(item) {

    const me = { username: currentProfile.username };

    const row = (effects, extra = "") => `
        <div class="dia-peek">
            ${leaderboardRowHtml(me, { rank: 3, medal: "", balance: formatBalance(1520), effects, extraClass: extra })}
        </div>
    `;

    if (item.id === "cristal") {
        return row({ cristal: true });
    }

    if (item.id === "cadre_diamant") {
        return row({ diamondFrame: true });
    }

    if (item.id === "theme_diamant") {
        return `<div class="dia-theme-peek bet-theme-diamant"><span class="dia-stars" aria-hidden="true"></span>🏆 Qui gagne le match ce soir ?</div>`;
    }

    return `<div class="dia-skin-peek"><img src="assets/perroquet/skins/cristal/thumb.png" alt=""></div>`;

}


// Diamants : à quel groupe l'objet appartient (il remplace, ou se cumule).
function exclusiveTagHtml(key) {

    const group = exclusiveGroupOf(key);

    return group
        ? `<span class="shop-mode shop-mode--replace dia-mode">Remplace ton ${group.label}</span>`
        : "";

}


function diamondShopHtml() {

    const admin = Boolean(currentProfile?.is_admin);

    const diamonds = myDiamonds();

    const cards = DIAMOND_ITEMS.map(item => {

        const owned = ownsDiamondItem(item.id);

        const canBuy = admin || diamonds >= item.price;

        const on = owned && !currentProfile.diamond_items[item.id].off;

        let button;

        if (!owned) {

            button = `<button type="button" class="primary-button" data-diamond-buy="${item.id}" ${canBuy ? "" : "disabled"}>Acheter</button>`;

        } else if (item.id === "skin_cristal") {

            const active = typeof activeParrotSkin === "function" && activeParrotSkin() === "cristal";

            button = `<button type="button" class="secondary-button" data-diamond-skin="${active ? "off" : "on"}">${active ? "Retirer le skin" : "Activer le skin"}</button>`;

        } else {

            button = `<button type="button" class="secondary-button" data-diamond-toggle="${item.id}" data-on="${on ? "0" : "1"}">${equipLabel("diamond:" + item.id, on)}</button>`;

        }

        return `
            <div class="mission-card dia-card${owned ? " owned" : ""}">
                <div class="mission-head">
                    <h3>${escapeHtml(item.title)}<span class="dia-excl">EXCLU</span></h3>
                    <span class="mission-points dia-price">${item.price} 💎</span>
                </div>
                ${exclusiveTagHtml("diamond:" + item.id)}
                ${diamondPreviewHtml(item)}
                <div class="mission-footer">
                    <span class="mission-state${owned ? " done" : ""}">
                        ${owned ? "✓ Possédé" : canBuy ? "Disponible" : "Il te manque " + (item.price - diamonds) + " 💎"}
                    </span>
                    ${button}
                </div>
            </div>
        `;

    }).join("");

    return `
        <section
            class="shop-category dia-section${shopFilter === "utile" ? " hidden" : ""}"
            data-kind="cosmetic"
        >

            <h2 class="missions-title">💎 Exclusivités diamant</h2>

            <div class="missions-grid">${cards}</div>

            <p
                id="diamond-message"
                class="missions-message hidden"
            ></p>

            <div class="dia-banner">
                <span class="dia-banner-icon">💎</span>
                <div class="dia-banner-text">
                    <b>${admin ? "∞" : diamonds} diamant${diamonds > 1 || admin ? "s" : ""}</b>
                    <p>Objets exclusifs, introuvables avec les pièces. Communs à tous tes groupes.</p>
                </div>
                <button type="button" class="dia-button" data-diamond-packs>Obtenir des 💎</button>
            </div>

        </section>
    `;

}


async function afterDiamondChange(message) {

    await loadCurrentProfile();

    displayShop();

    updateDiamondDisplay();

    displayLeaderboard?.();

    if (message) {
        showMissionsMessage(message, false, "diamond-message");
    }

}


function setupDiamonds() {

    const container = document.getElementById("shop-container");

    container?.addEventListener("click", async event => {

        const button = event.target.closest("button");

        if (!button || button.disabled || !button.closest(".dia-section")) {
            return;
        }

        const data = button.dataset;

        try {

            if (data.diamondBuy) {

                button.disabled = true;

                const { error } = await supabaseClient.rpc("buy_diamond_item", { p_item: data.diamondBuy });

                if (error) {
                    throw error;
                }

                const item = DIAMOND_ITEMS.find(entry => entry.id === data.diamondBuy);

                await unequipConflicts("diamond:" + data.diamondBuy);

                await afterDiamondChange(`« ${item.title} » est à toi !`);

            } else if (data.diamondToggle) {

                const { error } = await supabaseClient.rpc("toggle_diamond_item", {
                    p_item: data.diamondToggle,
                    p_on: data.on === "1"
                });

                if (error) {
                    throw error;
                }

                if (data.on === "1") {
                    await unequipConflicts("diamond:" + data.diamondToggle);
                }

                await afterDiamondChange();

            } else if (data.diamondSkin) {

                writeStorage("parrot-skin", data.diamondSkin === "on" ? "cristal" : "classique");

                applyParrotSkin();

                displayShop();

            } else if (data.diamondPacks !== undefined) {

                openDiamondModal();

            }

        } catch (error) {

            console.error(error);

            button.disabled = false;

            showMissionsMessage(error.message || "Action impossible.", true, "diamond-message");

        }

    });


    // Capsule 💎 de la barre du haut : fenêtre des packs.
    const widget = document.getElementById("diamond-widget");

    widget?.addEventListener("click", openDiamondModal);

    widget?.addEventListener("keydown", event => {

        if (event.key === "Enter" || event.key === " ") {

            event.preventDefault();

            openDiamondModal();

        }

    });

    const modal = document.getElementById("diamond-modal");

    document.getElementById("close-diamond-modal")?.addEventListener("click", () => {

        modal.classList.add("hidden");

    });

    // « Voir les exclusivités » : boutique, section Diamants.
    modal?.addEventListener("click", event => {

        if (!event.target.closest("[data-diamond-shop]")) {
            return;
        }

        modal.classList.add("hidden");

        document.querySelector('.nav-button[data-page="shop-page"]')?.click();

        setTimeout(() => {
            document.querySelector(".dia-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 400);

    });

    updateDiamondDisplay();

}


/*
    Fenêtre des pièces (clic sur la capsule 🪙) : comment en gagner,
    et l'échange de diamants (déplacé depuis la boutique).
*/

function pointsModalHtml() {

    const admin = Boolean(currentProfile?.is_admin);

    const diamonds = myDiamonds();

    const count = Math.max(1, Math.min(diamondConvertCount, Math.max(1, diamonds)));

    diamondConvertCount = count;

    const beta = typeof hasBetaAccess === "function" && hasBetaAccess() && !admin;

    const ways = [
        ["🎯", "Missions", "De 5 à 30 🪙 par mission réussie. Récupère-les dans l'onglet Missions.", "missions-page", "Voir les missions"],
        ["🏆", "Vote du vendredi", "Vote pour la nouveauté de la semaine dans le journal de la page Paris : +5 🪙.", null, null],
        ...(beta ? [["🧪", "Aide app", "Bêta-testeur : +10 🪙 par bug signalé (5 par jour), +5 🪙 par idée proposée (10 par jour), +50 si ton bug est corrigé, +80 si ton idée est retenue.", "beta-page", "Ouvrir l'Aide app"]] : []),
        ["💎", "Diamants", `Échange tes diamants juste en dessous : 1 💎 = ${DIAMOND_RATE} 🪙.`, null, null]
    ];

    return `
        <h2>🪙 Tes pièces</h2>

        <div class="pts-now">
            <span>Dans ce groupe</span>
            <strong>${admin ? "∞" : (currentProfile?.points || 0)} 🪙</strong>
        </div>

        <p class="pts-hint">Les pièces servent à acheter des objets dans la boutique. Chaque groupe a ses propres pièces.</p>

        <p class="level-sidebar-title">💡 Comment gagner des pièces</p>

        <ul class="pts-ways">
            ${ways.map(([icon, title, text, page, link]) => `
                <li>
                    <span class="pts-way-icon">${icon}</span>
                    <div>
                        <b>${title}</b>
                        <p>${text}</p>
                        ${page ? `<button type="button" class="pts-way-link" data-points-page="${page}">${link} →</button>` : ""}
                    </div>
                </li>
            `).join("")}
        </ul>

        <p class="level-sidebar-title">💎 Échanger des diamants contre des pièces</p>

        <div class="dia-convert">
            <span class="dia-convert-count">
                <button type="button" data-diamond-count="-1">−</button>
                <b>${count}</b>
                <button type="button" data-diamond-count="1">+</button>
                💎
            </span>
            <span class="dia-convert-result">= <b>${count * DIAMOND_RATE} 🪙</b></span>
            <button type="button" class="dia-button ghost" data-diamond-convert ${!admin && diamonds < count ? "disabled" : ""}>Échanger</button>
            <p class="pts-convert-note">Tu as ${admin ? "∞" : diamonds} 💎 · 1 💎 = ${DIAMOND_RATE} 🪙, à sens unique.</p>
        </div>

        <p
            id="points-message"
            class="missions-message hidden"
        ></p>
    `;

}


function openPointsModal() {

    const body = document.getElementById("points-modal-body");

    const modal = document.getElementById("points-modal");

    if (!body || !modal) {
        return;
    }

    body.innerHTML = pointsModalHtml();

    modal.classList.remove("hidden");

}


function setupPointsModal() {

    const widget = document.getElementById("points-widget");

    const modal = document.getElementById("points-modal");

    if (!widget || !modal) {
        return;
    }

    widget.addEventListener("click", openPointsModal);

    widget.addEventListener("keydown", event => {

        if (event.key === "Enter" || event.key === " ") {

            event.preventDefault();

            openPointsModal();

        }

    });

    document.getElementById("close-points-modal")?.addEventListener("click", () => {

        modal.classList.add("hidden");

    });

    modal.addEventListener("click", async event => {

        const button = event.target.closest("button");

        if (!button || button.disabled) {
            return;
        }

        const data = button.dataset;

        if (data.pointsPage) {

            modal.classList.add("hidden");

            document.querySelector(`.nav-button[data-page="${data.pointsPage}"]`)?.click();

            return;

        }

        if (data.diamondCount) {

            diamondConvertCount += Number(data.diamondCount);

            document.getElementById("points-modal-body").innerHTML = pointsModalHtml();

            return;

        }

        if (data.diamondConvert === undefined) {
            return;
        }

        button.disabled = true;

        const origin = button.getBoundingClientRect();

        const pointsBefore = Number(currentProfile?.points || 0);

        const { data: gained, error } = await supabaseClient.rpc("convert_diamonds", {
            p_group: currentGroup.id,
            p_count: diamondConvertCount
        });

        if (error) {

            button.disabled = false;

            showMissionsMessage(error.message || "Échange impossible.", true, "points-message");

            return;

        }

        currentProfile.points = pointsBefore + Number(gained);

        // Les pièces volent du bouton jusqu'à la capsule 🪙.
        if (typeof flyCoins === "function") {
            flyCoins(origin, Number(gained), pointsBefore);
        }

        diamondConvertCount = 1;

        await loadCurrentProfile();

        updateDiamondDisplay();

        displayShop();

        document.getElementById("points-modal-body").innerHTML = pointsModalHtml();

        showMissionsMessage(`+${gained} 🪙 ajoutés à tes pièces !`, false, "points-message");

    });

}


function openDiamondModal() {

    const body = document.getElementById("diamond-modal-body");

    const modal = document.getElementById("diamond-modal");

    if (!body || !modal) {
        return;
    }

    body.innerHTML = `
        <h2>💎 Tes diamants</h2>

        <div class="dia-now">
            <span>Tu as</span>
            <strong>${currentProfile?.is_admin ? "∞" : myDiamonds()} 💎</strong>
        </div>

        <p class="level-sidebar-title">💳 Acheter des diamants</p>

        <div class="dia-packs">
            ${DIAMOND_PACKS.map((pack, index) => `
                <div class="dia-pack${pack.best ? " best" : ""}">
                    ${pack.best ? `<span class="dia-pack-tag">LE PLUS CHOISI</span>` : ""}
                    <span class="dia-pack-gems">${"💎".repeat(Math.min(4, index + 1))}</span>
                    <span class="dia-pack-count">${pack.count} 💎</span>
                    <span class="dia-pack-bonus">${pack.bonus}</span>
                    <span class="dia-pack-price">${pack.price}</span>
                    <button type="button" class="dia-pack-soon" disabled>Bientôt disponible</button>
                </div>
            `).join("")}
        </div>

        <p class="dia-legal">
            Paiement sécurisé à venir. Les diamants ne servent qu'aux objets exclusifs et à l'échange
            en pièces (1 💎 = ${DIAMOND_RATE} 🪙) ; ils ne se revendent pas et ne se transforment jamais en argent réel.
        </p>

        <button type="button" class="bal-shop-link" data-diamond-shop>Voir les exclusivités →</button>
    `;

    modal.classList.remove("hidden");

}



/* =========================================================
   10 QUINQUIES. FENÊTRE D'UN PARTICIPANT (clic sur un pseudo)
   Stats, perroquet, argent en jeu et historique, avec « Copier »
   pour rejouer un pari ou un combiné encore possible
   (version B de demo-profil-joueur.html, profil-joueur.sql).
========================================================= */

const PARROT_SKIN_NAMES = {
    classique: "Classique",
    flamant: "Flamant",
    nuit: "Bleu nuit",
    violet: "Violet royal",
    arctique: "Arctique",
    noir: "Noir et or",
    phenix: "Phénix",
    cristal: "Cristal",
    corbeau: "Corbeau"
};

// Paris de la fenêtre ouverte, pour retrouver ce qu'on copie.
let playerProfileItems = [];

// Joueur dont la fenêtre de profil est ouverte (pour le don).
let playerProfileTarget = null;


/*
    Peut-on copier ces sélections ([{ betId, choiceId }]) ?
    Mêmes règles qu'un clic sur les cotes. Renvoie la raison, ou null.
*/

function copyBlockReason(legs) {

    for (const leg of legs) {

        const bet = lastLoadedBets.find(item => item.id === leg.betId);

        if (!bet || bet.status !== "open") {
            return "Ce pari n'est plus ouvert.";
        }

        if (!bet.bet_choices?.some(choice => choice.id === leg.choiceId)) {
            return "Ce choix n'existe plus.";
        }

        if (isBlockedTarget(bet)) {
            return "Tu es bloqué(e) sur ce pari.";
        }

        if (isBetClosed(bet)) {
            return "Mises closes (échéance trop proche).";
        }

    }

    if (legs.length === 1) {

        const bet = lastLoadedBets.find(item => item.id === legs[0].betId);

        if (myStakesOn(bet) >= STAKES_PER_BET) {
            return "Tu as déjà misé sur ce pari.";
        }

        return null;

    }

    const key = legs.map(leg => leg.choiceId).sort().join(",");

    if (myCombos.some(combo => (combo.combo_legs || []).map(leg => leg.choice_id).sort().join(",") === key)) {
        return "Tu as déjà joué exactement ce combiné.";
    }

    return null;

}


// Copier : page Paris, cotes cochées, fenêtre de mise ouverte.
function copyPlayerBet(legs) {

    document.getElementById("player-modal")?.classList.add("hidden");

    document.querySelector('.nav-button[data-page="bets-page"]')?.click();

    ticketLegs = legs.map(leg => ({ betId: leg.betId, choiceId: leg.choiceId }));

    // Téléphone : le ticket s'ouvre en grand, comme après un clic sur une cote.
    ticketOpen = true;

    renderTicket({ bump: true });

    syncTicketHighlights();

}


function playerBetHtml(item, index, canCopy) {

    const euros = value => formatMoney(Number(value) || 0);

    const states = {
        open: ["⏳ En cours", "open"],
        won: ["✅ Gagné", "won"],
        lost: ["❌ Perdu", "lost"],
        refunded: ["↩️ Remboursé", "refunded"],
        cancelled: ["↩️ Annulé", "refunded"]
    };

    const [stateLabel, stateClass] = states[item.state] || states.open;

    const reason = item.state === "open" && canCopy
        ? copyBlockReason(item.legs.map(leg => ({ betId: leg.bet_id, choiceId: leg.choice_id })))
        : null;

    return `
        <div class="pp-bet">
            <div class="pp-bet-top">
                <span class="pp-bet-kind${item.combo ? " combo" : ""}">${item.combo ? "Combiné · " + item.legs.length : "Simple"}</span>
                ${item.state === "open" ? "" : `<span class="pp-bet-state ${stateClass}">${stateLabel}</span>`}
            </div>
            <ul class="pp-legs">
                ${item.legs.map(leg => `
                    <li>
                        <span class="pp-leg-q">${escapeHtml(leg.question)} → <b>${escapeHtml(leg.label)}</b></span>
                        <span class="pp-leg-o">${oddsText(leg.odds)}</span>
                    </li>
                `).join("")}
            </ul>
            <div class="pp-bet-foot">
                <span>
                    Mise <b>${euros(item.stake)}</b>
                    ${item.combo ? ` · cote <b>${oddsText(item.odds)}</b>` : ""}
                    ${item.state === "won" ? ` · gain <b class="pp-win">+${euros(item.win)}</b>` : ""}
                </span>
                ${item.state === "open" && canCopy
                    ? `<button type="button" class="pp-copy" data-copy-bet="${index}" ${reason ? "disabled" : ""}>📋 Copier</button>`
                    : ""}
            </div>
            ${reason ? `<span class="pp-why">${escapeHtml(reason)}</span>` : ""}
        </div>
    `;

}


function playerProfileHtml(data) {

    const euros = value => Math.round(Number(value) || 0).toLocaleString("fr-FR") + " €";

    const isMe = data.username === currentProfile?.username;

    const admin = Boolean(data.is_admin);

    const info = typeof levelFromXp === "function" ? levelFromXp(Number(data.xp) || 0) : { level: 1, current: 0, needed: 100 };

    const skin = PARROT_SKIN_NAMES[data.parrot_skin] ? data.parrot_skin : "classique";

    // Mises simples et combinés, du plus récent au plus ancien.
    const simple = (data.stakes || []).map(stake => ({
        combo: false,
        created_at: stake.created_at,
        stake: stake.stake,
        win: stake.potential_win,
        state: stake.status === "resolved"
            ? (stake.winner_choice_id === stake.choice_id ? "won" : "lost")
            : stake.status === "cancelled" ? "cancelled" : "open",
        legs: [{ bet_id: stake.bet_id, question: stake.question, choice_id: stake.choice_id, label: stake.label, odds: stake.odds }]
    }));

    const combos = (data.combos || []).map(combo => ({
        combo: true,
        created_at: combo.created_at,
        stake: combo.stake,
        odds: combo.odds,
        win: combo.potential_win,
        state: combo.state || "open",
        legs: combo.legs || []
    }));

    playerProfileItems = [...simple, ...combos]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const open = playerProfileItems.map((item, index) => [item, index]).filter(([item]) => item.state === "open");

    const done = playerProfileItems.map((item, index) => [item, index]).filter(([item]) => item.state !== "open");

    const list = (items, empty) => items.length
        ? items.map(([item, index]) => playerBetHtml(item, index, !isMe)).join("")
        : `<p class="pp-empty">${empty}</p>`;

    const medal = ["🥇", "🥈", "🥉"][data.rank - 1] || "🏅";

    // Dons : pas à soi-même, et ni l'admin ni vers l'admin (solde illimité).
    const canGive = !isMe && !admin && !currentProfile?.is_admin;

    return `
        <div class="pp-head">
            <img class="pp-parrot" src="assets/perroquet/skins/${skin}/thumb.png" alt="">
            <div class="pp-who">
                <div class="pp-name">${styledName({ username: data.username })}</div>
                <div class="pp-sub">🦜 Perroquet ${escapeHtml(PARROT_SKIN_NAMES[skin])}</div>
                <div class="pp-sub">Membre depuis le ${new Date(data.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</div>
            </div>
            ${admin ? "" : `<div class="pp-rank"><b>${medal} ${data.rank}<sup>${data.rank === 1 ? "er" : "e"}</sup></b><span>du groupe</span>${canGive ? `<button type="button" class="pp-gift" data-gift-open>🎁 Don</button>` : ""}</div>`}
        </div>

        <div class="pp-stats">
            <div class="pp-stat xp wide">
                <span>Niveau</span>
                <b>Niv. ${info.level} <small>${info.current} / ${info.needed} XP</small></b>
            </div>
            <div class="pp-stat fire"><span>Série</span><b>🔥 ${admin ? "∞" : data.streak}</b></div>
            <div class="pp-stat money"><span>Solde</span><b>${admin ? "∞" : euros(data.balance)}</b></div>
            <div class="pp-stat coins"><span>Pièces</span><b>${admin ? "∞" : (data.points || 0) + " 🪙"}</b></div>
            <div class="pp-stat gems"><span>Diamants</span><b>${admin ? "∞" : (data.diamonds || 0) + " 💎"}</b></div>
            <div class="pp-stat play wide"><span>Argent en jeu</span><b>${euros(data.in_play)}</b></div>
        </div>

        <p class="level-sidebar-title">⏳ Paris en cours</p>
        <div class="pp-history">${list(open, "Aucun pari en cours.")}</div>

        <p class="level-sidebar-title pp-done-title">📜 Paris terminés</p>
        <div class="pp-history">${list(done, "Aucun pari terminé pour l'instant.")}</div>
    `;

}


async function openPlayerProfile(username) {

    const modal = document.getElementById("player-modal");

    const body = document.getElementById("player-modal-body");

    if (!modal || !body || !currentGroup || !username) {
        return;
    }

    body.innerHTML = `<p class="pp-empty">Chargement du profil de ${escapeHtml(username)}…</p>`;

    modal.classList.remove("hidden");

    const { data: profile, error: idError } = await supabaseClient
        .from("profiles")
        .select("id")
        .eq("username", username)
        .maybeSingle();

    if (idError || !profile) {

        body.innerHTML = `<p class="pp-empty">Profil introuvable.</p>`;

        return;

    }

    const { data, error } = await supabaseClient.rpc("player_profile", {
        p_group: currentGroup.id,
        p_user: profile.id
    });

    if (error) {

        body.innerHTML = `<p class="pp-empty">${escapeHtml(error.message || "Profil indisponible.")}</p>`;

        return;

    }

    playerProfileTarget = { id: profile.id, username };

    body.innerHTML = playerProfileHtml(data);

}


function setupPlayerProfile() {

    const modal = document.getElementById("player-modal");

    if (!modal) {
        return;
    }

    // Un clic sur un pseudo (classement, cartes, détail des parieurs…) ouvre sa fenêtre.
    // En capture : la carte de pari derrière le pseudo ne s'ouvre pas en plus.
    document.addEventListener("click", event => {

        const target = event.target.closest("[data-player]");

        if (!target || target.closest(".shop-preview-stage, .dia-peek, .shop-card, #player-modal") || event.target.closest(".lb-duel-btn, .lb-duel-chip")) {
            return;
        }

        event.preventDefault();

        event.stopPropagation();

        // Téléphone : le classement (en fenêtre) se ferme pour laisser place au profil.
        document.body.classList.remove("leaderboard-open");

        openPlayerProfile(target.dataset.player);

    }, true);

    document.getElementById("close-player-modal")?.addEventListener("click", () => {

        modal.classList.add("hidden");

    });

    modal.addEventListener("click", event => {

        if (event.target.closest("[data-gift-open]")) {

            openGiftModal();

            return;

        }

        const button = event.target.closest("[data-copy-bet]");

        if (!button || button.disabled) {
            return;
        }

        const item = playerProfileItems[Number(button.dataset.copyBet)];

        if (item) {
            copyPlayerBet(item.legs.map(leg => ({ betId: leg.bet_id, choiceId: leg.choice_id })));
        }

    });

}



/* =========================================================
   DONS ENTRE JOUEURS (dons.sql)
   Bouton « 🎁 Don » dans la fenêtre d'un joueur : on lui envoie
   de l'argent de son solde du groupe. Celui qui reçoit voit
   une fenêtre « don reçu » à sa prochaine visite.
========================================================= */

const GIFT_MIN = 10;

let giftConfirmTimer = null;


function giftAmount() {

    return Math.floor(Number(document.getElementById("gift-amount").value) || 0);

}


function giftError(amount) {

    if (amount < GIFT_MIN) {
        return `${GIFT_MIN} € minimum.`;
    }

    if (amount > Number(currentProfile?.balance || 0)) {
        return `Tu n'as que ${formatMoney(currentProfile?.balance || 0)}.`;
    }

    return "";

}


// Remet le bouton « Envoyer » à sa première étape (avant « Confirmer ? »).
function resetGiftConfirm() {

    clearTimeout(giftConfirmTimer);

    const send = document.getElementById("gift-send");

    send.classList.remove("confirm");

    send.textContent = `🎁 Envoyer ${formatMoney(Math.max(0, giftAmount()))}`;

}


function refreshGiftModal() {

    const amount = giftAmount();

    const error = giftError(amount);

    document.getElementById("gift-error").textContent = error;

    document.getElementById("gift-after").textContent =
        formatMoney(Number(currentProfile?.balance || 0) - Math.max(0, amount));

    document.getElementById("gift-send").disabled = Boolean(error);

    document.querySelectorAll("[data-gift-amount]").forEach(chip => {
        chip.classList.toggle("on", Number(chip.dataset.giftAmount) === amount);
    });

    resetGiftConfirm();

}


function openGiftModal() {

    if (!playerProfileTarget) {
        return;
    }

    document.getElementById("gift-target").textContent = playerProfileTarget.username;

    document.getElementById("gift-amount").value = 100;

    document.getElementById("gift-message").value = "";

    refreshGiftModal();

    document.getElementById("gift-modal").classList.remove("hidden");

}


function closeGiftModal() {

    clearTimeout(giftConfirmTimer);

    document.getElementById("gift-modal").classList.add("hidden");

}


async function sendGift() {

    const send = document.getElementById("gift-send");

    const amount = giftAmount();

    if (giftError(amount) || !playerProfileTarget || !currentGroup) {
        return;
    }

    // Premier clic : « Confirmer ? » pendant 4 secondes.
    if (!send.classList.contains("confirm")) {

        send.classList.add("confirm");

        send.textContent = "Confirmer ?";

        giftConfirmTimer = setTimeout(resetGiftConfirm, 4000);

        return;

    }

    clearTimeout(giftConfirmTimer);

    send.disabled = true;

    send.textContent = "Envoi…";

    const target = playerProfileTarget;

    const { error } = await supabaseClient.rpc("give_money", {
        p_group: currentGroup.id,
        p_to: target.id,
        p_amount: amount,
        p_message: document.getElementById("gift-message").value.trim() || null
    });

    if (error) {

        console.error("Erreur give_money :", error);

        send.disabled = false;

        resetGiftConfirm();

        document.getElementById("gift-error").textContent =
            error.message || "Le don n'a pas pu être envoyé.";

        return;

    }

    closeGiftModal();

    await loadCurrentProfile();

    await displayLeaderboard();

    // Le profil du joueur se recharge avec son nouveau solde.
    await openPlayerProfile(target.username);

}


function setupGiftModal() {

    const modal = document.getElementById("gift-modal");

    if (!modal) {
        return;
    }

    document.getElementById("close-gift-modal").addEventListener("click", closeGiftModal);

    document.getElementById("gift-cancel").addEventListener("click", closeGiftModal);

    document.getElementById("gift-send").addEventListener("click", sendGift);

    document.getElementById("gift-amount").addEventListener("input", refreshGiftModal);

    document.getElementById("gift-chips").addEventListener("click", event => {

        const chip = event.target.closest("[data-gift-amount]");

        if (!chip) {
            return;
        }

        document.getElementById("gift-amount").value = chip.dataset.giftAmount;

        refreshGiftModal();

    });

}


// Dons reçus pas encore vus : une fenêtre par don, « Merci ! » pour passer au suivant.
async function checkReceivedGifts() {

    const { data, error } = await supabaseClient.rpc("unseen_gifts");

    if (error) {

        console.error("Dons indisponibles (dons.sql lancé ?)", error);

        return;

    }

    const modal = document.getElementById("gift-received-modal");

    const okButton = document.getElementById("gift-received-ok");

    if (!modal || !okButton) {
        return;
    }

    const gifts = data || [];

    const showNext = () => {

        const gift = gifts.shift();

        if (!gift) {

            modal.classList.add("hidden");

            return;

        }

        document.getElementById("gift-received-from").innerHTML =
            `<b>${escapeHtml(gift.from_name)}</b> t'a fait un don`;

        document.getElementById("gift-received-amount").textContent =
            "+" + formatMoney(gift.amount);

        const message = document.getElementById("gift-received-message");

        message.textContent = gift.message ? `« ${gift.message} »` : "";

        message.classList.toggle("hidden", !gift.message);

        // Le groupe n'est précisé que si le don vient d'un autre groupe.
        document.getElementById("gift-received-group").textContent =
            gift.group_id === currentGroup?.id ? "" : `Dans le groupe « ${gift.group_name} »`;

        // On rejoue le petit saut du cadeau à chaque don.
        const emoji = modal.querySelector(".gift-emoji");

        emoji.classList.remove("gift-pop");

        void emoji.offsetWidth;

        emoji.classList.add("gift-pop");

        modal.classList.remove("hidden");

        okButton.onclick = async () => {

            okButton.disabled = true;

            await supabaseClient.rpc("mark_gift_seen", { p_gift: gift.id });

            okButton.disabled = false;

            showNext();

        };

    };

    showNext();

}


/* =========================================================
   CHAT DU GROUPE (chat.sql, chat-actions.sql)
   Bulle 💬 en bas à gauche : un chat par groupe, en direct.
   Tous les messages sont effacés chaque lundi à 0 h.
   Barre au survol (appui long sur téléphone) : réagir,
   répondre, modifier et supprimer ses messages.
   Bulle « … écrit » quand quelqu'un tape (broadcast).
========================================================= */

const CHAT_MAX = 300;

// Petite barre au survol du message : pouce, cœur, rire, choqué.
const CHAT_BAR_EMOJIS = ["👍", "❤️", "😂", "😮"];

// Ordre d'affichage sous les messages (😢 et 🔥 : anciennes réactions).
const CHAT_EMOJIS = [...CHAT_BAR_EMOJIS, "😢", "🔥"];

let chatMessages = [];

// Réactions : id du message → (id du joueur → emoji).
let chatReactions = new Map();

let chatNames = new Map();

let chatChannel = null;

let chatUnread = 0;

let chatReplyTo = null;

let chatEditId = null;

// Qui écrit en ce moment : id du joueur → { name, until }.
let chatTyping = new Map();

let chatTypingSentAt = 0;

let chatConfirmTimer = null;


function chatSeenKey() {

    return "betlab-chat-seen-" + currentGroup.id;

}


function chatSeenId() {

    try {
        return Number(localStorage.getItem(chatSeenKey())) || 0;
    } catch {
        return 0;
    }

}


function markChatSeen() {

    const last = chatMessages[chatMessages.length - 1];

    if (last) {
        try {
            localStorage.setItem(chatSeenKey(), String(last.id));
        } catch {}
    }

    chatUnread = 0;

    renderChatUnread();

}


function renderChatUnread() {

    const badge = document.getElementById("chat-unread");

    badge.textContent = chatUnread > 9 ? "9+" : String(chatUnread);

    badge.classList.toggle("hidden", chatUnread === 0);

}


function isChatOpen() {

    const panel = document.getElementById("chat-panel");

    // Pendant l'animation de fermeture, le chat compte déjà comme fermé.
    return !panel.classList.contains("hidden") && !panel.classList.contains("closing");

}


function findChatMessage(id) {

    return chatMessages.find(message => message.id === id);

}


async function ensureChatName(userId) {

    if (chatNames.has(userId)) {
        return;
    }

    const { data } = await supabaseClient
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle();

    if (data?.username) {
        chatNames.set(userId, data.username);
    }

}


function chatDayLabel(date) {

    const today = new Date();

    if (date.toDateString() === today.toDateString()) {
        return "Aujourd'hui";
    }

    const label = date.toLocaleDateString("fr-FR", { weekday: "long" });

    return label.charAt(0).toUpperCase() + label.slice(1);

}


function chatAuthorLabel(message) {

    if (message.user_id === currentUser.id) {
        return "Toi";
    }

    return chatNames.get(message.user_id) || "Ancien membre";

}


function chatQuoteHtml(message) {

    const quoted = message.reply_to ? findChatMessage(message.reply_to) : null;

    if (!quoted) {
        return "";
    }

    const text = quoted.deleted_at ? "Message supprimé" : quoted.content.slice(0, 80);

    return `<span class="chat-quote" data-chat-jump="${quoted.id}"><i>${escapeHtml(chatAuthorLabel(quoted))}</i>${escapeHtml(text)}</span>`;

}


function chatReactionsHtml(message) {

    const byUser = chatReactions.get(message.id);

    if (!byUser || message.deleted_at) {
        return "";
    }

    // Regroupe par emoji, dans l'ordre de la barre.
    const groups = CHAT_EMOJIS
        .map(emoji => ({
            emoji,
            users: [...byUser].filter(([, value]) => value === emoji).map(([userId]) => userId)
        }))
        .filter(group => group.users.length > 0);

    if (groups.length === 0) {
        return "";
    }

    return `<div class="chat-reacts">${groups.map(group => {

        const mine = group.users.includes(currentUser.id);

        const names = group.users.map(userId => userId === currentUser.id ? "Toi" : chatNames.get(userId) || "?").join(", ");

        return `<button type="button" class="chat-react${mine ? " mine" : ""}" data-chat-react="${group.emoji}" title="${escapeHtml(names)}">${group.emoji} ${group.users.length}</button>`;

    }).join("")}</div>`;

}


// Barre des réactions : au-dessus de la bulle, visible au survol du message
// (sur téléphone, avec l'appui long).
function chatEmojiBarHtml() {

    return `<div class="chat-emoji-bar">${CHAT_BAR_EMOJIS.map(emoji => `<button type="button" data-chat-react="${emoji}">${emoji}</button>`).join("")}</div>`;

}


// ⋯ à côté du message (au survol) : il ouvre la fenêtre des actions
// (Répondre, + Modifier / Supprimer sur ses messages).
function chatMoreHtml(message) {

    const own = message.user_id === currentUser.id
        ? `<button type="button" data-chat-act="edit">✏️ Modifier</button><button type="button" class="danger" data-chat-act="delete">🗑️ Supprimer</button>`
        : "";

    return `<div class="chat-more-menu"><button type="button" data-chat-act="reply">↩️ Répondre</button>${own}</div>`;

}


function chatMessageHtml(message) {

    const mine = message.user_id === currentUser.id;

    const time = new Date(message.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    const name = chatNames.get(message.user_id);

    const deleted = Boolean(message.deleted_at);

    const body = deleted
        ? "🚫 Message supprimé"
        : chatQuoteHtml(message) + escapeHtml(message.content);

    const timeLabel = time + (message.edited_at && !deleted ? " · modifié" : "");

    // Messages des autres : l'heure à droite du pseudo. Les miens (sans pseudo) : sous la bulle.
    return `
        <div class="chat-msg${mine ? " me" : ""}${deleted ? " deleted" : ""}" data-chat-id="${message.id}">
            ${mine ? "" : `<div class="chat-who">${styledName(withGroupStyle(name ? { username: name } : null), "Ancien membre")}<span class="chat-who-time">${timeLabel}</span></div>`}
            <div class="chat-txt">${body}${deleted ? "" : `<button type="button" class="chat-more" data-chat-more title="Répondre, modifier…">⋯</button>${chatEmojiBarHtml()}${chatMoreHtml(message)}`}</div>
            ${chatReactionsHtml(message)}
            ${mine ? `<div class="chat-time">${timeLabel}</div>` : ""}
        </div>
    `;

}


// Tout en haut de la liste, au-dessus du plus ancien message.
const CHAT_WIPE_NOTE =
    `<p class="chat-wipe-note">Les messages s'effacent lundi à 00:00</p>`;

function renderChat() {

    const list = document.getElementById("chat-list");

    // On reste en bas si on y était, sinon on garde sa place.
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;

    const keep = list.scrollTop;

    if (chatMessages.length === 0) {

        list.innerHTML = CHAT_WIPE_NOTE + `<p class="chat-empty">Aucun message cette semaine. Lance la discussion !</p><div id="chat-typing"></div>`;

    } else {

        let lastDay = "";

        list.innerHTML = CHAT_WIPE_NOTE + chatMessages.map(message => {

            const date = new Date(message.created_at);

            const day = date.toDateString();

            const separator = day !== lastDay ? `<div class="chat-day">${chatDayLabel(date)}</div>` : "";

            lastDay = day;

            return separator + chatUnreadMarkerHtml(message) + chatMessageHtml(message);

        }).join("") + `<div id="chat-typing"></div>`;

    }

    renderChatTyping();

    list.scrollTop = atBottom ? list.scrollHeight : keep;

    watchChatNamesOnScreen(list);

}


// Pseudos animés (néon, flammes, métal…) : en pause tant que leur message est
// hors de l'écran du chat. Sinon ils se redessinaient tous en permanence et
// le défilement ramait dès qu'il y avait beaucoup de messages.
let chatNamesObserver = null;

function watchChatNamesOnScreen(list) {

    if (!("IntersectionObserver" in window)) {
        return;
    }

    chatNamesObserver?.disconnect();

    chatNamesObserver = new IntersectionObserver(entries => {

        entries.forEach(entry => {
            entry.target.classList.toggle("chat-offscreen", !entry.isIntersecting);
        });

    }, { root: list, rootMargin: "120px 0px" });

    list.querySelectorAll(".chat-who").forEach(name => chatNamesObserver.observe(name));

}


/* ----- Bulle « … écrit » : une seule bulle, noms sur la même ligne ----- */

function chatTypingLabel(names) {

    if (names.length === 1) {
        return `${names[0]} écrit…`;
    }

    if (names.length <= 3) {
        return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]} écrivent…`;
    }

    return `${names.slice(0, 2).join(", ")} et ${names.length - 2} autres écrivent…`;

}


function renderChatTyping() {

    const box = document.getElementById("chat-typing");

    if (!box) {
        return;
    }

    const now = Date.now();

    const names = [...chatTyping.values()]
        .filter(entry => entry.until > now)
        .map(entry => entry.name);

    if (names.length === 0) {

        box.innerHTML = "";

        return;

    }

    const list = document.getElementById("chat-list");

    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;

    box.innerHTML = `
        <div class="chat-typing">
            <div class="chat-typing-who">${escapeHtml(chatTypingLabel(names))}</div>
            <div class="chat-dots"><i></i><i></i><i></i></div>
        </div>
    `;

    if (atBottom) {
        list.scrollTop = list.scrollHeight;
    }

}


function onChatTyping({ payload }) {

    if (!payload?.user_id || payload.user_id === currentUser.id) {
        return;
    }

    if (payload.stop) {
        chatTyping.delete(payload.user_id);
    } else {
        chatTyping.set(payload.user_id, { name: payload.username || "Quelqu'un", until: Date.now() + 4000 });
    }

    renderChatTyping();

}


function sendChatTyping(stop = false) {

    if (!chatChannel) {
        return;
    }

    // Pendant qu'on tape : un signal toutes les 2 s suffit.
    if (!stop && Date.now() - chatTypingSentAt < 2000) {
        return;
    }

    chatTypingSentAt = stop ? 0 : Date.now();

    chatChannel.send({
        type: "broadcast",
        event: "typing",
        payload: { user_id: currentUser.id, username: currentProfile?.username, stop }
    });

}


/* ----- Chargement et direct ----- */

async function loadChat() {

    // La base ne renvoie que ce qui date de la semaine (depuis lundi 0 h).
    const [messagesResult, reactionsResult] = await Promise.all([
        supabaseClient
            .from("chat_messages")
            // Lien précisé : les réactions font un 2e chemin vers profiles.
            .select("id, user_id, content, created_at, reply_to, edited_at, deleted_at, profiles!chat_messages_user_id_fkey ( username )")
            .eq("group_id", currentGroup.id)
            .order("id", { ascending: true })
            .limit(500),
        supabaseClient
            .from("chat_reactions")
            .select("message_id, user_id, emoji, profiles ( username )")
            .eq("group_id", currentGroup.id)
            .not("emoji", "is", null)
    ]);

    if (messagesResult.error || reactionsResult.error) {
        console.error(messagesResult.error || reactionsResult.error);
        return;
    }

    chatMessages = messagesResult.data || [];

    chatReactions = new Map();

    [...chatMessages, ...(reactionsResult.data || [])].forEach(row => {
        if (row.profiles?.username) {
            chatNames.set(row.user_id, row.profiles.username);
        }
    });

    (reactionsResult.data || []).forEach(setChatReaction);

    const seen = chatSeenId();

    chatUnread = chatMessages.filter(message => message.id > seen && message.user_id !== currentUser.id).length;

    renderChatUnread();

    renderChat();

}


function setChatReaction(row) {

    if (!chatReactions.has(row.message_id)) {
        chatReactions.set(row.message_id, new Map());
    }

    const byUser = chatReactions.get(row.message_id);

    if (row.emoji) {
        byUser.set(row.user_id, row.emoji);
    } else {
        byUser.delete(row.user_id);
    }

}


async function onChatMessage(payload) {

    const message = payload.new;

    await ensureChatName(message.user_id);

    const existing = findChatMessage(message.id);

    if (existing) {

        // Modifié ou supprimé.
        Object.assign(existing, message);

        renderChat();

        return;

    }

    if (payload.eventType !== "INSERT") {
        return;
    }

    // On lisait plus haut ? (mesuré avant d'ajouter le message)
    const readingAbove = !isChatAtBottom();

    chatMessages.push(message);

    // Celui qui écrit a fini : on enlève sa bulle « … ».
    chatTyping.delete(message.user_id);

    renderChat();

    if (message.user_id === currentUser.id) {

        // Mon message : direction le bas de la conversation.
        scrollChatToBottom();

    } else if (readingAbove) {

        // Message d'un autre pendant que je lis plus haut : petite flèche.
        chatNewIds.push(message.id);

        renderChatNewArrow();

    }

    if (isChatOpen()) {

        markChatSeen();

    } else if (message.user_id !== currentUser.id) {

        chatUnread++;

        renderChatUnread();

        bounceChatFab();

    }

}


/* ----- Bas de la conversation et flèche « nouveau message » ----- */

// Messages arrivés pendant qu'on lisait plus haut (le 1er = celui où la flèche emmène).
let chatNewIds = [];

function isChatAtBottom() {

    const list = document.getElementById("chat-list");

    return list.scrollHeight - list.scrollTop - list.clientHeight < 60;

}

function scrollChatToBottom() {

    const list = document.getElementById("chat-list");

    list.scrollTop = list.scrollHeight;

    chatNewIds = [];

    renderChatNewArrow();

}

// Petite flèche ↓ : on a remonté dans le chat (et pas de flèche « Nouveau message »).
function renderChatBottomArrow() {

    const list = document.getElementById("chat-list");

    const arrow = document.getElementById("chat-bottom-arrow");

    if (!list || !arrow) {
        return;
    }

    const scrolledUp = list.scrollHeight - list.scrollTop - list.clientHeight > 150;

    const show = scrolledUp && chatNewIds.length === 0;

    if (arrow.classList.contains("show") !== show) {
        arrow.classList.toggle("show", show);
    }

}

function renderChatNewArrow() {

    const arrow = document.getElementById("chat-new-arrow");

    arrow.classList.toggle("hidden", chatNewIds.length === 0);

    renderChatBottomArrow();

    document.getElementById("chat-new-label").textContent = chatNewIds.length > 1
        ? `${chatNewIds.length} nouveaux messages`
        : "Nouveau message";

}

// Clic sur la flèche : on arrive sur le 1er nouveau message, prêt à le lire.
function jumpToNewChatMessage() {

    const target = document.querySelector(`.chat-msg[data-chat-id="${chatNewIds[0]}"]`);

    chatNewIds = [];

    renderChatNewArrow();

    if (!target) {
        scrollChatToBottom();
        return;
    }

    target.scrollIntoView({ block: "start" });

    target.classList.remove("flash");
    void target.offsetWidth;
    target.classList.add("flash");

}


async function onChatReaction(payload) {

    await ensureChatName(payload.new.user_id);

    setChatReaction(payload.new);

    renderChat();

}


/* ----- Écrire, répondre, modifier ----- */

function renderChatContext() {

    const box = document.getElementById("chat-context");

    const input = document.getElementById("chat-input");

    const target = findChatMessage(chatReplyTo || chatEditId);

    if (!target) {

        chatReplyTo = null;

        chatEditId = null;

        box.classList.add("hidden");

        input.placeholder = "Écrire un message…";

        return;

    }

    const editing = Boolean(chatEditId);

    box.classList.toggle("editing", editing);

    box.classList.remove("hidden");

    document.getElementById("chat-context-title").textContent = editing
        ? "✏️ Modifier le message"
        : "↩️ Réponse à " + (target.user_id === currentUser.id ? "toi" : chatAuthorLabel(target));

    document.getElementById("chat-context-text").textContent = target.content;

    input.placeholder = editing ? "Nouveau texte…" : "Ta réponse…";

}


function cancelChatContext() {

    if (chatEditId) {
        document.getElementById("chat-input").value = "";
    }

    chatReplyTo = null;

    chatEditId = null;

    renderChatContext();

}


async function sendChatMessage(event) {

    event.preventDefault();

    const input = document.getElementById("chat-input");

    const content = input.value.trim().slice(0, CHAT_MAX);

    if (!content) {
        return;
    }

    const button = document.getElementById("chat-send");

    button.disabled = true;

    const editId = chatEditId;

    const { error } = editId
        ? await supabaseClient.rpc("edit_chat_message", { p_message: editId, p_content: content })
        : await supabaseClient.rpc("send_chat_message", {
            p_group: currentGroup.id,
            p_content: content,
            p_reply_to: chatReplyTo
        });

    button.disabled = false;

    if (error) {

        console.error(error);

        alert(error.message || "Impossible d'envoyer le message.");

        return;

    }

    sendChatTyping(true);

    input.value = "";

    chatReplyTo = null;

    chatEditId = null;

    renderChatContext();

    input.focus();

    if (!editId) {
        scrollChatToBottom();
    }

    // Si le direct est lent, on recharge pour voir le changement tout de suite.
    setTimeout(() => {
        const done = editId
            ? findChatMessage(editId)?.content === content
            : chatMessages.some(message => message.user_id === currentUser.id && message.content === content);
        if (!done) {
            loadChat().then(() => {
                if (!editId) {
                    scrollChatToBottom();
                }
            });
        }
    }, 1500);

}


async function reactToChatMessage(messageId, emoji) {

    const { data, error } = await supabaseClient.rpc("react_chat_message", {
        p_message: messageId,
        p_emoji: emoji
    });

    if (error) {
        console.error(error);
        return;
    }

    // Affichage immédiat, sans attendre le direct.
    setChatReaction({ message_id: messageId, user_id: currentUser.id, emoji: data });

    renderChat();

}


async function deleteChatMessage(messageId, button) {

    // 1er clic : « Confirmer ? » pendant 4 s, 2e clic : suppression.
    if (!button.classList.contains("confirm")) {

        button.classList.add("confirm");

        button.textContent = "🗑️ Confirmer ?";

        clearTimeout(chatConfirmTimer);

        chatConfirmTimer = setTimeout(() => {
            button.classList.remove("confirm");
            button.textContent = "🗑️ Supprimer";
        }, 4000);

        return;

    }

    clearTimeout(chatConfirmTimer);

    const { error } = await supabaseClient.rpc("delete_chat_message", { p_message: messageId });

    if (error) {

        console.error(error);

        alert(error.message || "Impossible de supprimer le message.");

        return;

    }

    const message = findChatMessage(messageId);

    if (message) {
        message.deleted_at = new Date().toISOString();
    }

    if (chatEditId === messageId || chatReplyTo === messageId) {
        cancelChatContext();
    }

    renderChat();

}


function onChatListClick(event) {

    const jump = event.target.closest("[data-chat-jump]");

    if (jump) {

        const target = document.querySelector(`.chat-msg[data-chat-id="${jump.dataset.chatJump}"]`);

        if (target) {
            target.scrollIntoView({ block: "center", behavior: "smooth" });
            target.classList.remove("flash");
            void target.offsetWidth;
            target.classList.add("flash");
        }

        return;

    }

    const element = event.target.closest(".chat-msg");

    if (!element) {
        closeChatBars();
        return;
    }

    const messageId = Number(element.dataset.chatId);

    const react = event.target.closest("[data-chat-react]");

    if (react) {

        closeChatBars();

        reactToChatMessage(messageId, react.dataset.chatReact);

        return;

    }

    if (event.target.closest("[data-chat-more]")) {

        const wasOpen = element.classList.contains("menu-open");

        closeChatBars();

        element.classList.toggle("menu-open", !wasOpen);

        // La fenêtre reste visible même sous le dernier message : sous lui, rien ne
        // permettait de descendre plus bas, d'où une marge le temps que la fenêtre est ouverte.
        if (!wasOpen) {

            const menu = element.querySelector(".chat-more-menu");

            const list = element.closest(".chat-list");

            if (list && !element.nextElementSibling?.matches(".chat-msg")) {

                element.style.marginBottom = menu.offsetHeight + 12 + "px";

                // Tout en bas : la fenêtre entière, marge comprise.
                list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });

            } else {

                menu.scrollIntoView({ block: "nearest", behavior: "smooth" });

            }

        }

        return;

    }

    const action = event.target.closest("[data-chat-act]")?.dataset.chatAct;

    if (!action) {

        // Clic ailleurs sur un message : on referme la fenêtre ⋯ ouverte.
        closeChatBars();

        return;

    }

    const input = document.getElementById("chat-input");

    if (action === "delete") {

        deleteChatMessage(messageId, event.target.closest("[data-chat-act]"));

        return;

    }

    closeChatBars();

    if (action === "reply") {

        chatReplyTo = messageId;

        chatEditId = null;

    }

    if (action === "edit") {

        chatEditId = messageId;

        chatReplyTo = null;

        input.value = findChatMessage(messageId)?.content || "";

    }

    renderChatContext();

    input.focus();

}


function closeChatBars() {

    if (Date.now() - chatLongPressAt < 600) {
        return;
    }

    document.querySelectorAll(".chat-msg.menu-open").forEach(element => {

        element.classList.remove("menu-open");

        element.style.marginBottom = "";

    });

}


// Téléphone : appui long sur un message = sa fenêtre ⋯.
let chatLongPressAt = 0;

function setupChatLongPress(list) {

    let pressTimer = null;

    list.addEventListener("touchstart", event => {

        const element = event.target.closest(".chat-msg:not(.deleted)");

        if (!element || event.target.closest(".chat-more, .chat-more-menu, .chat-emoji-bar, .chat-react, [data-player]")) {
            return;
        }

        pressTimer = setTimeout(() => {

            closeChatBars();

            element.classList.add("menu-open");

            // Le clic qui suit le doigt levé ne doit pas la refermer.
            chatLongPressAt = Date.now();

            navigator.vibrate?.(15);

        }, 450);

    }, { passive: true });

    ["touchend", "touchmove", "touchcancel"].forEach(type =>
        list.addEventListener(type, () => clearTimeout(pressTimer), { passive: true })
    );

}


/*
    Ouverture du chat : on arrive au dernier message vu, avec un repère
    temporaire « Nouveaux messages en dessous » juste avant le 1er non lu.
*/

const CHAT_UNREAD_MARKER_MS = 6000;

let chatUnreadMarker = null;

function chatUnreadMarkerHtml(message) {

    if (!chatUnreadMarker || chatUnreadMarker.id !== message.id) {
        return "";
    }

    const left = chatUnreadMarker.until - Date.now();

    if (left <= 0) {
        return "";
    }

    // Redessiné (message reçu, réaction…) : le fondu reprend où il en était.
    return `<div class="chat-unread-marker" style="animation-delay: ${left - 600}ms"><span>Nouveaux messages en dessous ↓</span></div>`;

}

function openChatAtLastSeen() {

    const list = document.getElementById("chat-list");

    const marker = list.querySelector(".chat-unread-marker");

    if (!marker) {
        scrollChatToBottom();
        return;
    }

    // Le repère un peu sous le haut : on voit encore le dernier message lu au-dessus.
    list.scrollTop = Math.max(0, marker.offsetTop - list.offsetTop - 70);

}


// Petit rebond de la bulle 💬 quand un message arrive chat fermé.
function bounceChatFab() {

    const fab = document.getElementById("chat-fab");

    fab.classList.remove("bounce");

    void fab.offsetWidth;

    fab.classList.add("bounce");

}


let chatCloseTimer = null;

function toggleChat(open) {

    const panel = document.getElementById("chat-panel");

    clearTimeout(chatCloseTimer);

    if (open) {

        panel.classList.remove("hidden", "closing");

        // Rejoue l'animation d'ouverture.
        panel.classList.remove("opening");
        void panel.offsetWidth;
        panel.classList.add("opening");

    } else if (!panel.classList.contains("hidden")) {

        panel.classList.remove("opening");

        panel.classList.add("closing");

        // Caché à la fin de l'animation de fermeture (0,11 s).
        chatCloseTimer = setTimeout(() => {
            panel.classList.add("hidden");
            panel.classList.remove("closing");
        }, 110);

    }

    document.body.classList.toggle("chat-open", open);

    if (open) {

        // Premier message pas encore vu (d'un autre joueur), calculé avant de tout marquer lu.
        const seen = chatSeenId();

        const firstUnread = chatMessages.find(message => message.id > seen && message.user_id !== currentUser.id);

        chatUnreadMarker = firstUnread
            ? { id: firstUnread.id, until: Date.now() + CHAT_UNREAD_MARKER_MS }
            : null;

        renderChat();

        openChatAtLastSeen();

        markChatSeen();

        // Pas de clavier qui surgit tout seul sur téléphone.
        if (!PHONE_LAYOUT.matches) {
            document.getElementById("chat-input").focus();
        }

    } else {

        closeChatBars();

    }

}


async function setupChat() {

    if (!currentGroup || !currentUser) {
        return;
    }

    document.getElementById("chat-fab").classList.remove("hidden");

    document.body.classList.add("has-chat");

    document.getElementById("chat-fab").addEventListener("click", () => toggleChat(!isChatOpen()));

    document.getElementById("chat-close").addEventListener("click", () => toggleChat(false));

    document.getElementById("chat-form").addEventListener("submit", sendChatMessage);

    document.getElementById("chat-context-cancel").addEventListener("click", cancelChatContext);

    document.getElementById("chat-input").addEventListener("input", event => {
        if (event.target.value.trim()) {
            sendChatTyping();
        }
    });

    const list = document.getElementById("chat-list");

    list.addEventListener("click", onChatListClick);

    document.getElementById("chat-new-arrow").addEventListener("click", jumpToNewChatMessage);

    document.getElementById("chat-bottom-arrow").addEventListener("click", () => {

        list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });

    });

    // Pendant le défilement : animations des pseudos en pause et pas de survol,
    // pour un défilement fluide (style.css, .chat-list.scrolling).
    let chatScrollTimer = null;

    // Mesures (bas atteint, petite flèche) : une fois par image au plus,
    // pas à chaque événement de défilement.
    let chatScrollFrame = 0;

    list.addEventListener("scroll", () => {

        if (!chatScrollFrame) {

            chatScrollFrame = requestAnimationFrame(() => {

                chatScrollFrame = 0;

                // Arrivé en bas : les nouveaux messages sont lus, la flèche part.
                if (chatNewIds.length > 0 && isChatAtBottom()) {
                    chatNewIds = [];
                    renderChatNewArrow();
                }

                renderChatBottomArrow();

            });

        }

        if (!list.classList.contains("scrolling")) {
            list.classList.add("scrolling");
        }

        clearTimeout(chatScrollTimer);

        chatScrollTimer = setTimeout(() => list.classList.remove("scrolling"), 150);

    }, { passive: true });

    // Clic hors des messages : barre (téléphone) et menu ⋯ refermés.
    // Clic hors de la fenêtre du chat : le chat se ferme
    // (sauf dans une fenêtre ouverte depuis le chat, ex. profil d'un joueur).
    document.addEventListener("click", event => {

        if (!event.target.closest(".chat-msg")) {
            closeChatBars();
        }

        if (
            isChatOpen() &&
            event.target.isConnected &&
            !event.target.closest("#chat-panel, #chat-fab, .modal")
        ) {
            toggleChat(false);
        }

    });

    setupChatLongPress(list);

    // Échap : annule la réponse / modification, sinon ferme le chat.
    document.addEventListener("keydown", event => {

        if (event.key !== "Escape" || !isChatOpen()) {
            return;
        }

        if (chatReplyTo || chatEditId) {
            cancelChatContext();
        } else {
            toggleChat(false);
        }

    });

    // Les bulles « … » s'effacent 4 s après le dernier signal.
    setInterval(() => {
        if (chatTyping.size > 0) {
            renderChatTyping();
        }
    }, 1000);

    await loadChat();

    const filter = "group_id=eq." + currentGroup.id;

    chatChannel = supabaseClient
        .channel("chat-" + currentGroup.id)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter }, onChatMessage)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter }, onChatMessage)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_reactions", filter }, onChatReaction)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_reactions", filter }, onChatReaction)
        .on("broadcast", { event: "typing" }, onChatTyping)
        .subscribe();

}


/* =========================================================
   11. NAVIGATION
========================================================= */

function showPage(pageId, skipCascade = false) {

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

        // Admin : les demandes « mot de passe oublié » arrivent à tout moment.
        if (pageId === "admin-page") {
            displayAdminPasswordRequests();
        }

        // Téléphone : chaque changement d'onglet repart du haut de la page.
        if (PHONE_LAYOUT.matches) {

            window.scrollTo({ top: 0, behavior: "instant" });

        }

        if (!skipCascade) {

            cascadeIn(page);

        }


        // Le perroquet s'adapte à la largeur du contenu de la nouvelle page.
        parrotRefit?.();


        /*
            Retour sur les paris : on recharge le classement
            pour jouer une éventuelle remontée.
        */

        if (pageId === "bets-page") {

            displayLeaderboard();

            // Nouveautés publiées entre-temps (et vote du vendredi).
            loadWeekNews();

        }


        // Profil : la demande bêta a pu être acceptée entre-temps.
        if (pageId === "profile-page") {

            loadBetaStatus().then(displayBetaRequestCard);

        }


        // Historique : contestations et votes à jour (redessiné seulement si ça a changé).
        if (pageId === "my-bets-page") {

            displayMyBets({ cascade: !skipCascade });

        }

    }


    /*
        Le perroquet est présent sur toutes les pages sauf le Profil.
        Il repart en attente en revenant du Profil ou sur la page des paris.
    */

    const parrotElement =
        document.getElementById("parrot");

    if (parrotElement) {

        const hideParrot =
            pageId === "profile-page";

        const wasHidden =
            parrotElement.classList.contains("parrot-hidden");

        parrotElement.classList.toggle("parrot-hidden", hideParrot);

        // Retour en attente sans rebond (changer d'onglet ne doit pas le faire sauter).
        if (!hideParrot && (wasHidden || pageId === "bets-page")) {
            Parrot.wait(true);
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


    moveNavIndicator();

    // Changer d'onglet ferme la fenêtre du classement (téléphone).
    document.body.classList.remove("leaderboard-open");

}


/*
    Téléphone : le trait lumineux du menu du bas glisse
    au-dessus de l'onglet actif (caché sur le Profil).
*/

function moveNavIndicator() {

    const indicator = document.querySelector(".nav-indicator");

    if (!indicator || !PHONE_LAYOUT.matches) {
        return;
    }

    const tab = document.querySelector("nav .nav-button.active");

    if (!tab || tab.offsetWidth === 0) {

        indicator.style.opacity = "0";

        return;

    }

    const width = tab.offsetWidth * 0.5;

    indicator.style.width = width + "px";

    indicator.style.left = (tab.offsetLeft + (tab.offsetWidth - width) / 2) + "px";

    indicator.style.opacity = "1";

    // Première pose sans glissement, ensuite il glisse d'un onglet à l'autre.
    if (!indicator.classList.contains("ready")) {

        requestAnimationFrame(() => indicator.classList.add("ready"));

    }

}

/*
    Téléphone : le classement « Top Parieurs » s'ouvre en fenêtre
    avec le bouton « 🏆 Classement » (le CSS ne le montre que sur téléphone).
*/

function setupLeaderboardPopup() {

    const close = () => document.body.classList.remove("leaderboard-open");

    document
        .getElementById("leaderboard-open-button")
        ?.addEventListener("click", () => document.body.classList.add("leaderboard-open"));

    document
        .getElementById("leaderboard-close-button")
        ?.addEventListener("click", close);

    document
        .getElementById("leaderboard-backdrop")
        ?.addEventListener("click", close);

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            close();
        }
    });

}

function setupPhoneNav() {

    const nav = document.querySelector(".navbar nav");

    if (!nav) {
        return;
    }

    // Bouton rond « + » : créer un pari.
    document
        .getElementById("nav-create-button")
        ?.addEventListener("click", openCreateModal);

    // Petit rebond de l'icône touchée.
    nav.querySelectorAll(".nav-button").forEach(button => {

        button.addEventListener("click", () => {

            button.classList.remove("nav-pop");

            void button.offsetWidth;

            button.classList.add("nav-pop");

        });

    });

    // Le trait se replace si le menu change de taille (onglet admin, rotation…).
    if (typeof ResizeObserver !== "undefined") {

        new ResizeObserver(moveNavIndicator).observe(nav);

    }

    PHONE_LAYOUT.addEventListener?.("change", moveNavIndicator);

    moveNavIndicator();

    setupNavHover(nav);

}


/*
    Ordinateur : au survol des onglets, un surligneur glisse de l'un à l'autre,
    comme dans le classement (setupLeaderboardHover).
*/

function setupNavHover(nav) {

    const glow = document.createElement("span");

    glow.className = "nav-hover";

    glow.setAttribute("aria-hidden", "true");

    nav.prepend(glow);

    nav.addEventListener("mouseover", event => {

        const tab = event.target.closest(".nav-button");

        if (!tab || PHONE_LAYOUT.matches) {
            return;
        }

        const visible = glow.classList.contains("on");

        // Il apparaît sur place la première fois, puis glisse d'un onglet à l'autre.
        glow.style.transition = visible ? "" : "none";

        glow.style.transform = `translateX(${tab.offsetLeft}px)`;

        glow.style.width = tab.offsetWidth + "px";

        glow.style.top = tab.offsetTop + "px";

        glow.style.height = tab.offsetHeight + "px";

        if (!visible) {

            void glow.offsetWidth;

            glow.style.transition = "";

        }

        glow.classList.add("on");

    });

    nav.addEventListener("mouseleave", () => {

        glow.classList.remove("on");

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

    renderUsernameLock();


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

        renderUsernameLock();

        showMissionsMessage(
            "Pseudo changé ! Connecte-toi désormais avec « " + currentProfile.username + " ». Prochain changement possible dans 48 h.",
            false,
            "username-message"
        );

        await displayLeaderboard();

        await displayBets();

    });

}



/*
    Un seul changement de pseudo toutes les 48 h (pseudo-48h.sql) :
    le formulaire est bloqué jusque-là, avec la date du prochain changement.
    L'admin n'est pas limité.
*/

const USERNAME_CHANGE_DELAY_MS = 48 * 3600 * 1000;

function renderUsernameLock() {

    const input = document.getElementById("username-input");

    const submit = document.getElementById("username-submit");

    const lock = document.getElementById("username-lock");

    const last = currentProfile?.username_changed_at;

    const nextAt = last ? new Date(last).getTime() + USERNAME_CHANGE_DELAY_MS : 0;

    const locked = !currentProfile?.is_admin && nextAt > Date.now();

    input.disabled = locked;

    submit.disabled = locked;

    lock.classList.toggle("hidden", !locked);

    if (locked) {

        const date = new Date(nextAt);

        lock.textContent = "🔒 Tu as changé de pseudo récemment. Prochain changement possible le " +
            date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) + " à " +
            date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + ".";

    }

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

/*
    Bouton œil sur chaque champ mot de passe :
    affiche / masque ce qu'on tape.
*/

const EYE_OPEN_ICON = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
        <circle cx="12" cy="12" r="3"/>
    </svg>
`;

const EYE_CLOSED_ICON = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/>
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
        <line x1="2" y1="2" x2="22" y2="22"/>
    </svg>
`;

function setupPasswordEyes() {

    document
        .querySelectorAll(".auth-card input[type='password']")
        .forEach(input => {

            const wrapper = document.createElement("div");

            wrapper.className = "password-field";

            input.parentNode.insertBefore(wrapper, input);

            wrapper.appendChild(input);

            const button = document.createElement("button");

            button.type = "button";

            button.className = "password-eye";

            button.innerHTML = EYE_OPEN_ICON;

            button.setAttribute("aria-label", "Afficher le mot de passe");

            button.addEventListener("click", () => {

                const visible = input.type === "password";

                input.type = visible ? "text" : "password";

                button.innerHTML = visible ? EYE_CLOSED_ICON : EYE_OPEN_ICON;

                button.setAttribute(
                    "aria-label",
                    visible ? "Masquer le mot de passe" : "Afficher le mot de passe"
                );

            });

            wrapper.appendChild(button);

        });

}

// Connexion / inscription : bouton en attente + barre du haut qui avance,
// pour voir tout de suite que le clic a été pris en compte.
// Renvoie une fonction qui remet le bouton et la barre à zéro (en cas d'erreur).
function startAuthLoading(form, label) {

    const button = form.querySelector("button[type=submit]");

    const originalLabel = button.textContent;

    button.disabled = true;

    button.classList.add("is-loading");

    button.textContent = label;

    setLoadProgress(15);

    const timer = setTimeout(() => setLoadProgress(45), 300);

    const timer2 = setTimeout(() => setLoadProgress(70), 1200);

    return () => {

        clearTimeout(timer);

        clearTimeout(timer2);

        setLoadProgress(0);

        button.disabled = false;

        button.classList.remove("is-loading");

        button.textContent = originalLabel;

    };

}


/* ----- Inscription en questions (Index.html) -----
   Pseudo → mot de passe (le compte est créé ici) → rejoindre ou créer un groupe.
   Le navigateur retient qu'on est déjà venu : la fois suivante,
   on arrive directement sur la connexion. */

const KNOWN_VISITOR_KEY = "betlab-deja-venu";

// Réponse « Oui » à la question du tuto : lu (puis effacé) par startGuidedTour dans app.html.
const GUIDED_TOUR_KEY = "betlab-tuto";

function isKnownVisitor() {

    try {

        return localStorage.getItem(KNOWN_VISITOR_KEY) === "1";

    } catch (error) {

        return false;

    }

}


function rememberKnownVisitor() {

    try {

        localStorage.setItem(KNOWN_VISITOR_KEY, "1");

    } catch (error) {

        // Stockage indisponible (navigation privée) : le questionnaire reviendra.

    }

}


const ONBOARDING_STEPS = ["pseudo", "password", "group", "tuto"];


/* Questionnaire en cours après la création du compte (questions 3 et 4) :
   si la page est rechargée, on y revient au lieu de partir sur app.html.
   { user, step, pseudo }, effacé à la réponse au tuto. */
const ONBOARDING_RESUME_KEY = "betlab-inscription-en-cours";

function saveOnboardingResume(state) {

    try {
        localStorage.setItem(ONBOARDING_RESUME_KEY, JSON.stringify(state));
    } catch (error) {
        // Stockage indisponible : un rechargement mènera directement à l'app.
    }

}

function readOnboardingResume(userId) {

    try {

        const state = JSON.parse(localStorage.getItem(ONBOARDING_RESUME_KEY));

        return state && state.user === userId ? state : null;

    } catch (error) {

        return null;

    }

}

function clearOnboardingResume() {

    try {
        localStorage.removeItem(ONBOARDING_RESUME_KEY);
    } catch (error) {
        // Rien à effacer.
    }

}


/* Questionnaire à reprendre pour le compte connecté, ou null pour entrer dans l'app.
   Sans étape gardée sur ce navigateur (autre appareil, ou passé par « Se connecter »
   pendant le questionnaire) : pas de groupe ni de demande en attente = question 3. */
async function pendingOnboardingStep() {

    const saved = readOnboardingResume(currentUser.id);

    if (saved) {
        return saved;
    }

    if (currentProfile?.is_admin) {
        return null;
    }

    const [members, requests] = await Promise.all([
        supabaseClient
            .from("group_members")
            .select("group_id")
            .eq("user_id", currentUser.id)
            .limit(1),
        supabaseClient.rpc("my_join_requests")
    ]);

    // En cas de doute, on laisse entrer dans l'app.
    if (members.error || requests.error) {

        console.error(members.error || requests.error);

        return null;

    }

    if (
        members.data.length > 0 ||
        (requests.data || []).some(request => request.status === "pending")
    ) {
        return null;
    }

    return {
        user: currentUser.id,
        step: "group",
        pseudo: currentProfile?.username || ""
    };

}

function showOnboardingStep(step, back = false) {

    const index = ONBOARDING_STEPS.indexOf(step);

    document
        .querySelectorAll("#onboarding-section [data-onb-step]")
        .forEach(element => {

            const active = element.dataset.onbStep === step;

            element.classList.toggle("hidden", !active);

            element.classList.toggle("back", active && back);

            const error = element.querySelector(".onb-error");

            if (error) {
                error.textContent = "";
            }

        });

    document.getElementById("onb-gauge-fill").style.width =
        [10, 35, 60, 85][index] + "%";

    document.getElementById("onb-gauge-label").textContent =
        `Question ${index + 1} sur 4`;

}


function onboardingError(step, message, field) {

    document
        .querySelector(`#onboarding-section [data-onb-step="${step}"] .onb-error`)
        .textContent = message;

    if (field) {

        field.classList.remove("bad");

        void field.offsetWidth;

        field.classList.add("bad");

    }

}


// Bouton en attente pendant une étape ; renvoie de quoi le remettre.
function onboardingLoading(button, label) {

    const originalLabel = button.textContent;

    button.disabled = true;

    button.classList.add("is-loading");

    button.textContent = label;

    return () => {

        button.disabled = false;

        button.classList.remove("is-loading");

        button.textContent = originalLabel;

    };

}


function setupOnboarding(showAuthSection) {

    let pseudo = "";

    let mode = "join";

    let joining = false;


    // Étape atteinte, gardée pour un éventuel rechargement de la page.
    const rememberStep = step => saveOnboardingResume({
        user: currentUser?.id,
        step,
        pseudo
    });


    document.getElementById("onb-show-login").addEventListener("click", () => {

        clearOnboardingResume();

        showAuthSection("login-section");

        document.getElementById("login-username").focus();

    });


    /* Question 1 : pseudo */

    const pseudoForm = document.getElementById("onb-pseudo-form");

    pseudoForm.addEventListener("submit", async event => {

        event.preventDefault();

        const input = document.getElementById("onb-pseudo");

        const field = input.closest(".onb-field");

        const value = input.value.trim();

        field.classList.remove("bad");

        if (value.length < 3) {

            onboardingError("pseudo", "Au moins 3 caractères.", field);

            return;

        }

        // Le pseudo devient un e-mail (usernameToEmail) : accents enlevés, emojis refusés.
        if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(usernameKey(value))) {

            onboardingError(
                "pseudo",
                "Lettres, chiffres, point, tiret ou _ seulement.",
                field
            );

            return;

        }

        const stopLoading = onboardingLoading(
            pseudoForm.querySelector("button[type=submit]"),
            "Vérification…"
        );

        // Même pseudo à la casse près = même compte (voir usernameToEmail).
        // Sans compte, profiles n'est pas lisible : on passe par pseudo-disponible.sql.
        const { data: available, error } = await supabaseClient
            .rpc("pseudo_disponible", { p_username: value });

        stopLoading();

        if (error) {

            console.error(error);

            onboardingError("pseudo", "Vérification impossible, réessaie.");

            return;

        }

        if (!available) {

            onboardingError("pseudo", "Ce pseudo est déjà pris, essaie autre chose.", field);

            return;

        }

        pseudo = value;

        document.getElementById("onb-password-hint").textContent =
            `Pour retrouver ton compte, ${pseudo}.`;

        showOnboardingStep("password");

        document.getElementById("onb-password").focus();

    });


    /* Question 2 : mot de passe, et création du compte */

    const passwordForm = document.getElementById("onb-password-form");

    document.getElementById("onb-password-back").addEventListener("click", () => {

        showOnboardingStep("pseudo", true);

        document.getElementById("onb-pseudo").focus();

    });

    passwordForm.addEventListener("submit", async event => {

        event.preventDefault();

        const input = document.getElementById("onb-password");

        const field = input.closest(".onb-field");

        field.classList.remove("bad");

        if (input.value.length < 4) {

            onboardingError("password", "Au moins 4 caractères.", field);

            return;

        }

        const stopLoading = onboardingLoading(
            passwordForm.querySelector("button[type=submit]"),
            "Création du compte…"
        );

        setLoadProgress(30);

        try {

            await registerUser(pseudo, input.value);

        } catch (error) {

            console.error(error);

            stopLoading();

            setLoadProgress(0);

            // Pris entre-temps (ou même pseudo avec d'autres majuscules).
            if (/already|registered|déjà utilisé/i.test(error.message || "")) {

                showOnboardingStep("pseudo", true);

                onboardingError(
                    "pseudo",
                    "Ce pseudo est déjà pris, essaie autre chose.",
                    document.getElementById("onb-pseudo").closest(".onb-field")
                );

                return;

            }

            onboardingError("password", error.message || "Impossible de créer le compte.");

            return;

        }

        setLoadProgress(0);

        rememberKnownVisitor();

        rememberStep("group");

        showOnboardingStep("group");

        setTimeout(() => document.querySelector("#onb-code input")?.focus(), 50);

    });


    /* Question 3 : rejoindre (code du groupe) ou créer */

    const groupStep = document.querySelector('#onboarding-section [data-onb-step="group"]');

    const groupButton = document.getElementById("onb-group-button");

    const codeBox = document.getElementById("onb-code");

    const found = document.getElementById("onb-found");

    const readCode = () =>
        [...codeBox.querySelectorAll("input")].map(input => input.value).join("");


    groupStep.querySelectorAll(".onb-choice").forEach(choice => {

        choice.addEventListener("click", () => {

            if (choice.classList.contains("active")) {
                return;
            }

            groupStep.querySelectorAll(".onb-choice").forEach(other => {
                other.classList.toggle("active", other === choice);
            });

            mode = choice.dataset.onbMode;

            onboardingError("group", "");

            groupButton.textContent = mode === "join" ? "Rejoindre →" : "Créer mon groupe →";

            setTimeout(() => {

                (mode === "join"
                    ? codeBox.querySelector("input")
                    : document.getElementById("onb-group-name")
                ).focus();

            }, 200);

        });

    });


    async function previewCode() {

        const code = readCode();

        codeBox.classList.remove("ok", "bad");

        found.innerHTML = "";

        onboardingError("group", "");

        if (code.length < 6) {
            return;
        }

        const { data, error } =
            await supabaseClient.rpc("preview_group", { p_code: code });

        // Le code a changé pendant la recherche : on ignore ce résultat.
        if (readCode() !== code) {
            return;
        }

        if (error || !data || data.length === 0) {

            onboardingError("group", "Code inconnu : vérifie-le auprès de tes amis.", codeBox);

            return;

        }

        const group = data[0];

        codeBox.classList.add("ok");

        found.innerHTML = `
            <div class="onb-found">
                <span>✅</span>
                <span>
                    <b>${escapeHtml(group.name)}</b>
                    <small>${group.members} membre${group.members > 1 ? "s" : ""}</small>
                </span>
            </div>
        `;

    }


    for (let i = 0; i < 6; i++) {

        const input = document.createElement("input");

        input.maxLength = 1;

        input.autocomplete = "off";

        input.setAttribute("aria-label", `Caractère ${i + 1} du code`);

        input.addEventListener("input", () => {

            input.value = input.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 1);

            if (input.value && input.nextElementSibling) {
                input.nextElementSibling.focus();
            }

            previewCode();

        });

        input.addEventListener("keydown", event => {

            if (event.key === "Backspace" && !input.value && input.previousElementSibling) {
                input.previousElementSibling.focus();
            }

            if (event.key === "Enter") {
                submitGroup();
            }

        });

        input.addEventListener("paste", event => {

            event.preventDefault();

            const text = (event.clipboardData.getData("text") || "")
                .replace(/[^a-z0-9]/gi, "")
                .toUpperCase()
                .slice(0, 6);

            [...codeBox.children].forEach((element, index) => {
                element.value = text[index] || "";
            });

            previewCode();

        });

        codeBox.appendChild(input);

    }


    async function submitGroup() {

        if (joining) {
            return;
        }

        if (mode === "join") {

            const code = readCode();

            if (code.length < 6) {

                onboardingError("group", "Le code fait 6 caractères.", codeBox);

                return;

            }

            joining = true;

            const stopLoading = onboardingLoading(groupButton, "Envoi de la demande…");

            const { error } =
                await supabaseClient.rpc("join_group", { p_code: code });

            joining = false;

            if (error) {

                stopLoading();

                onboardingError("group", error.message || "Impossible de rejoindre ce groupe.", codeBox);

                return;

            }

            stopLoading();

            rememberStep("tuto");

            showOnboardingStep("tuto");

            return;

        }

        const nameInput = document.getElementById("onb-group-name");

        const name = nameInput.value.trim();

        if (name.length < 3) {

            onboardingError("group", "Donne un nom d'au moins 3 caractères.", nameInput.closest(".onb-field"));

            return;

        }

        joining = true;

        const stopLoading = onboardingLoading(groupButton, "Création du groupe…");

        const { data, error } =
            await supabaseClient.rpc("create_group", { p_name: name });

        joining = false;

        stopLoading();

        if (error) {

            onboardingError("group", error.message || "Impossible de créer le groupe.");

            return;

        }

        saveGroupId(data.id);

        rememberStep("tuto");

        showOnboardingStep("tuto");

    }


    groupButton.addEventListener("click", submitGroup);

    document.getElementById("onb-group-name").addEventListener("keydown", event => {

        if (event.key === "Enter") {
            submitGroup();
        }

    });


    /* Question 4 : tuto guidé ou non (lancé à l'arrivée dans app.html, voir startGuidedTour) */

    document.querySelectorAll("[data-onb-tuto]").forEach(button => {

        button.addEventListener("click", () => {

            try {

                if (button.dataset.onbTuto === "oui") {
                    localStorage.setItem(GUIDED_TOUR_KEY, "1");
                } else {
                    localStorage.removeItem(GUIDED_TOUR_KEY);
                }

            } catch (error) {

                // Stockage indisponible : pas de tuto.

            }

            clearOnboardingResume();

            // Fin du questionnaire : directement dans l'app, sans écran de plus.
            window.location.href = "app.html";

        });

    });


    // Reprise après un rechargement (voir ONBOARDING_RESUME_KEY).
    return state => {

        pseudo = state.pseudo || currentProfile?.username || "";

        document.getElementById("onb-password-hint").textContent =
            `Pour retrouver ton compte, ${pseudo}.`;

        showOnboardingStep(state.step);

        showAuthSection("onboarding-section");

        if (state.step === "group") {
            setTimeout(() => document.querySelector("#onb-code input")?.focus(), 50);
        }

    };

}


async function initAuthPage() {

    const loginForm =
        document.getElementById(
            "login-form"
        );


    const showRegister =
        document.getElementById(
            "show-register"
        );


    /*
        Si on est sur la page de connexion.
    */

    if (
        !loginForm ||
        !document.getElementById("onboarding-section")
    ) {

        return;

    }


    /*
        Première visite sur ce navigateur : le questionnaire d'inscription
        plutôt que la page de connexion (affiché tout de suite, sans attendre
        la vérification de session).
    */

    if (!isKnownVisitor()) {

        document.getElementById("login-section").classList.add("hidden");

        document.getElementById("onboarding-section").classList.remove("hidden");

        document.body.classList.add("onboarding");

    }


    /*
        Vérification session existante.
    */

    const {
        data
    } = await supabaseClient.auth.getSession();


    /*
        Session ouverte avec un mot de passe provisoire de l'admin
        (voir mot-de-passe-oublie.sql) : on reste ici pour le changer.
    */

    let mustChangePassword = false;

    let resumeState = null;


    if (data.session) {

        currentUser =
            data.session.user;


        try {

            await loadCurrentProfile();

            mustChangePassword =
                Boolean(currentProfile?.must_change_password);

        } catch (error) {

            console.error(error);

        }


        // Compte créé mais questionnaire pas fini (groupe ou tuto) : on y revient.
        resumeState =
            mustChangePassword ? null : await pendingOnboardingStep();

        if (!mustChangePassword && !resumeState) {

            window.location.href =
                "app.html";

            return;

        }

    }


    const showAuthSection = id => {

        ["login-section", "onboarding-section", "forgot-section", "find-username-section", "new-password-section"].forEach(section => {

            document
                .getElementById(section)
                ?.classList.toggle("hidden", section !== id);

        });

        // Inscription en questions : perroquet au-dessus du logo, sans le sous-titre.
        document.body.classList.toggle("onboarding", id === "onboarding-section");

    };


    setupPasswordEyes();


    const resumeOnboarding =
        setupOnboarding(showAuthSection);


    /*
        Afficher inscription (le questionnaire).
    */

    showRegister.addEventListener(
        "click",
        () => {

            showOnboardingStep("pseudo");

            showAuthSection("onboarding-section");

            document.getElementById("onb-pseudo").focus();

        }
    );


    if (!document.getElementById("onboarding-section").classList.contains("hidden")) {

        document.getElementById("onb-pseudo").focus();

    }


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


            const stopLoading =
                startAuthLoading(loginForm, "Connexion…");


            try {

                await loginUser(
                    username,
                    password
                );


                // Mot de passe provisoire de l'admin : à changer avant d'entrer.
                if (currentProfile?.must_change_password) {

                    stopLoading();

                    showAuthSection("new-password-section");

                    document.getElementById("new-password").focus();

                    return;

                }


                rememberKnownVisitor();


                // Questionnaire quitté à la question 3 : on y revient.
                const pendingStep = await pendingOnboardingStep();

                if (pendingStep) {

                    stopLoading();

                    saveOnboardingResume(pendingStep);

                    resumeOnboarding(pendingStep);

                    return;

                }


                window.location.href =
                    "app.html";


            } catch (error) {

                console.error(error);

                stopLoading();


                errorElement.textContent =
                    error.message ||
                    "Connexion impossible.";

            }

        }
    );


    /*
        MOT DE PASSE OUBLIÉ (voir mot-de-passe-oublie.sql)
        Pas de vrai e-mail : la demande part chez l'admin,
        qui choisit un nouveau mot de passe.
    */

    document
        .getElementById("show-forgot")
        ?.addEventListener("click", () => {

            document.getElementById("forgot-username").value =
                document.getElementById("login-username").value;

            document.getElementById("forgot-error").textContent = "";

            document.getElementById("forgot-success").classList.add("hidden");

            showAuthSection("forgot-section");

        });


    document
        .getElementById("forgot-back")
        ?.addEventListener("click", () => showAuthSection("login-section"));


    document
        .getElementById("forgot-form")
        ?.addEventListener("submit", async event => {

            event.preventDefault();

            const username = document.getElementById("forgot-username").value.trim();

            const errorElement = document.getElementById("forgot-error");

            const successElement = document.getElementById("forgot-success");

            const button = event.target.querySelector("button[type='submit']");

            errorElement.textContent = "";

            successElement.classList.add("hidden");

            if (!username) {
                return;
            }

            button.disabled = true;

            const { error } = await supabaseClient.rpc("request_password_reset", {
                p_username: username
            });

            button.disabled = false;

            if (error) {

                console.error(error);

                errorElement.textContent = "Impossible d'envoyer la demande pour le moment.";

                return;

            }

            successElement.textContent =
                `Demande envoyée pour « ${username} ». ` +
                "Si ce compte existe, l'admin va te donner un nouveau mot de passe.";

            successElement.classList.remove("hidden");

        });


    /*
        IDENTIFIANT OUBLIÉ
        On demande la 1ère lettre du pseudo, puis on liste les pseudos
        qui commencent par elle (voir identifiant-oublie.sql).
    */

    const findLetter = document.getElementById("find-username-letter");

    const findList = document.getElementById("find-username-list");

    const findError = document.getElementById("find-username-error");


    document
        .getElementById("show-find-username")
        ?.addEventListener("click", () => {

            findLetter.value = "";

            findList.innerHTML = "";

            findError.textContent = "";

            showAuthSection("find-username-section");

            findLetter.focus();

        });


    document
        .getElementById("find-username-back")
        ?.addEventListener("click", () => showAuthSection("login-section"));


    findLetter?.addEventListener("input", async () => {

        findLetter.value = findLetter.value.trim().slice(0, 1).toUpperCase();

        const letter = findLetter.value;

        findList.innerHTML = "";

        findError.textContent = "";

        if (!letter) {
            return;
        }

        const { data, error } = await supabaseClient
            .rpc("pseudos_par_lettre", { p_lettre: letter });

        // La lettre a changé pendant la recherche : on ignore ce résultat.
        if (findLetter.value !== letter) {
            return;
        }

        if (error) {

            console.error(error);

            findError.textContent = "Recherche impossible pour le moment, réessaie.";

            return;

        }

        if (!data || data.length === 0) {

            findList.innerHTML = `<p>Aucun pseudo ne commence par « ${escapeHtml(letter)} ».</p>`;

            return;

        }

        findList.innerHTML =
            "<p>Clique sur ton pseudo :</p>" +
            data
                .map(username => `
                    <button
                        type="button"
                        class="find-username-pseudo"
                        data-username="${escapeHtml(username)}"
                    >
                        ${escapeHtml(username)}
                    </button>
                `)
                .join("");

    });


    // Pseudo choisi : retour à la connexion avec l'identifiant déjà rempli.
    findList?.addEventListener("click", event => {

        const button = event.target.closest(".find-username-pseudo");

        if (!button) {
            return;
        }

        document.getElementById("login-username").value = button.dataset.username;

        showAuthSection("login-section");

        document.getElementById("login-password").focus();

    });


    /*
        NOUVEAU MOT DE PASSE (après le mot de passe provisoire de l'admin)
    */

    document
        .getElementById("new-password-form")
        ?.addEventListener("submit", async event => {

            event.preventDefault();

            const password = document.getElementById("new-password").value;

            const passwordConfirm = document.getElementById("new-password-confirm").value;

            const errorElement = document.getElementById("new-password-error");

            const button = event.target.querySelector("button[type='submit']");

            errorElement.textContent = "";

            if (password.length < 4) {

                errorElement.textContent = "Le mot de passe doit contenir au moins 4 caractères.";

                return;

            }

            if (password !== passwordConfirm) {

                errorElement.textContent = "Les deux mots de passe ne sont pas identiques.";

                return;

            }

            button.disabled = true;

            const { error } = await supabaseClient.auth.updateUser({ password: passwordForAuth(password) });

            if (error) {

                console.error(error);

                button.disabled = false;

                errorElement.textContent = error.code === "same_password"
                    ? "Choisis un mot de passe différent de celui donné par l'admin."
                    : "Impossible de changer le mot de passe.";

                return;

            }

            const { error: finishError } = await supabaseClient.rpc("finish_password_change");

            if (finishError) {
                console.error(finishError);
            }

            window.location.href =
                "app.html";

        });


    document
        .getElementById("new-password-cancel")
        ?.addEventListener("click", async () => {

            await supabaseClient.auth.signOut();

            document.getElementById("login-password").value = "";

            showAuthSection("login-section");

        });


    if (mustChangePassword) {

        showAuthSection("new-password-section");

    }

    if (resumeState) {

        resumeOnboarding(resumeState);

    }

}



/* =========================================================
   15. INITIALISATION APPLICATION
========================================================= */

// Barre de chargement du haut (app.html) : avance à chaque étape,
// puis file à 100 % et disparaît dès que body perd la classe app-loading.
function setLoadProgress(percent) {

    const fill = document.querySelector("#page-loader .page-loader-fill");

    if (fill) {

        fill.style.width = percent + "%";

    }

}


function watchPageLoader() {

    const loader = document.getElementById("page-loader");

    if (!loader) {

        return;

    }

    const finish = () => {

        setLoadProgress(100);

        loader.classList.add("done");

        setTimeout(() => loader.remove(), 700);

        observer.disconnect();

    };

    const observer = new MutationObserver(() => {

        if (!document.body.classList.contains("app-loading")) {

            finish();

        }

    });

    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    setLoadProgress(10);

}


// Animation d'arrivée jouée une seule fois au premier chargement (initAppPage).
// La classe porte le même nom que l'animation CSS et est retirée à la fin.
function playFirstArrival(element, name) {

    if (!element) {

        return;

    }

    element.classList.add(name);

    // Les animations des éléments enfants remontent aussi jusqu'ici : on ne garde que la sienne.
    const onArrived = event => {

        if (event.animationName !== name) {

            return;

        }

        element.classList.remove(name);

        element.removeEventListener("animationend", onArrived);

    };

    element.addEventListener("animationend", onArrived);

}


/* ----- Tuto guidé (choisi à l'inscription, question 4) -----
   Un projecteur passe d'un élément à l'autre avec une bulle d'explication.
   Les éléments absents ou cachés (téléphone / ordinateur) sont sautés. */

const GUIDED_TOUR_STEPS = [
    {
        targets: ["#bet-ticket"],
        title: "Ton ticket",
        text: "Choisis ta mise puis appuie sur « Parier »."
    },
    {
        targets: ["#balance-widget"],
        title: "Ton argent",
        text: "De l'argent fictif, propre à chaque groupe. Gagne tes paris pour grimper au classement."
    },
    {
        targets: ["#nav-create-button", "#bets-container .bet-create-card"],
        title: "Crée tes paris",
        text: "Pose une question à ton groupe : les autres parient dessus."
    },
    {
        targets: ['.nav-button[data-page="missions-page"]'],
        title: "Les missions",
        text: "Des défis à relever pour gagner de l'XP et des récompenses."
    },
    {
        targets: ["#leaderboard-sidebar", "#leaderboard-open-button"],
        title: "Le classement",
        text: "Qui est le meilleur parieur du groupe ? C'est ici."
    },
    {
        targets: ["#chat-fab"],
        title: "Le chat",
        text: "Discute avec ton groupe. Les messages s'effacent chaque lundi."
    },
    {
        targets: ["#group-switcher-button"],
        title: "Ton groupe",
        text: "Change de groupe, ou retrouve le code pour inviter tes amis."
    }
];


function isTourTargetVisible(element) {

    if (!element || element.closest(".hidden, .level-locked")) {
        return false;
    }

    const rect = element.getBoundingClientRect();

    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";

}


function startGuidedTour(attempt = 0) {

    let wanted = false;

    try {
        wanted = localStorage.getItem(GUIDED_TOUR_KEY) === "1";
    } catch (error) {
        wanted = false;
    }

    if (!wanted || !currentGroup || CLICK_PREVIEW || document.querySelector(".tour-layer")) {
        return;
    }

    // Une fenêtre est ouverte (annonce, cadeau…) : on attend qu'elle se ferme.
    if (document.querySelector(".modal:not(.hidden)") && attempt < 40) {

        setTimeout(() => startGuidedTour(attempt + 1), 1000);

        return;

    }

    // Une seule fois : le choix est effacé dès le départ.
    try {
        localStorage.removeItem(GUIDED_TOUR_KEY);
    } catch (error) {
        // Rien à faire.
    }

    runSpotlightTour(GUIDED_TOUR_STEPS);

}


// Bouton « Revoir le tuto » du profil : retour sur les paris, puis le tuto guidé.
function setupTourReplayButton() {

    document.getElementById("tour-replay-button")?.addEventListener("click", () => {

        showPage("bets-page");

        // Le temps que la page des paris s'affiche.
        setTimeout(() => runSpotlightTour(GUIDED_TOUR_STEPS), 400);

    });

}


// Projecteur + bulle sur une suite d'éléments (tuto guidé, nouveautés d'un niveau).
// Renvoie false si aucun élément n'est visible.
function runSpotlightTour(stepList, { lastLabel = "C'est parti !", onClose = null } = {}) {

    if (document.querySelector(".tour-layer")) {
        return false;
    }

    const steps = stepList
        .map(step => ({
            ...step,
            element: step.targets
                .map(selector => document.querySelector(selector))
                .find(isTourTargetVisible)
        }))
        .filter(step => step.element);

    if (steps.length === 0) {
        return false;
    }

    const layer = document.createElement("div");

    layer.className = "tour-layer";

    layer.innerHTML = `
        <div class="tour-spot"></div>
        <div class="tour-bubble" role="dialog" aria-live="polite">
            <div class="tour-bubble-title"></div>
            <p class="tour-bubble-text"></p>
            <div class="tour-bubble-foot">
                <span class="tour-bubble-count"></span>
                <button type="button" class="tour-skip">Passer</button>
                <button type="button" class="tour-next primary-button"></button>
            </div>
        </div>
    `;

    document.body.appendChild(layer);

    const spot = layer.querySelector(".tour-spot");

    const bubble = layer.querySelector(".tour-bubble");

    let index = 0;

    let placeTimer = null;


    function place() {

        const element = steps[index].element;

        const rect = element.getBoundingClientRect();

        const pad = 8;

        spot.style.top = rect.top - pad + "px";

        spot.style.left = rect.left - pad + "px";

        spot.style.width = rect.width + pad * 2 + "px";

        spot.style.height = rect.height + pad * 2 + "px";

        // Bulle sous l'élément, ou au-dessus s'il n'y a pas la place.
        const gap = 16;

        const bubbleHeight = bubble.offsetHeight;

        const bubbleWidth = bubble.offsetWidth;

        const below = rect.bottom + pad + gap + bubbleHeight < window.innerHeight - 16;

        let top = below
            ? rect.bottom + pad + gap
            : rect.top - pad - gap - bubbleHeight;

        top = Math.max(16, Math.min(top, window.innerHeight - bubbleHeight - 16));

        let left = rect.left + rect.width / 2 - bubbleWidth / 2;

        left = Math.max(16, Math.min(left, window.innerWidth - bubbleWidth - 16));

        bubble.style.top = top + "px";

        bubble.style.left = left + "px";

    }


    function show() {

        const step = steps[index];

        bubble.querySelector(".tour-bubble-title").textContent = step.title;

        bubble.querySelector(".tour-bubble-text").textContent = step.text;

        bubble.querySelector(".tour-bubble-count").textContent = `${index + 1} / ${steps.length}`;

        bubble.querySelector(".tour-bubble-count").classList.toggle("hidden", steps.length < 2);

        bubble.querySelector(".tour-next").textContent =
            index === steps.length - 1 ? lastLabel : "Suivant →";

        bubble.classList.remove("tour-bubble-in");

        void bubble.offsetWidth;

        bubble.classList.add("tour-bubble-in");

        step.element.scrollIntoView({ block: "center", behavior: "smooth" });

        place();

    }


    // Le projecteur suit l'élément à chaque image : défilement, élément qui
    // arrive en glissant (bulle du chat tout juste débloquée…).
    function follow() {

        if (!layer.isConnected) {
            return;
        }

        place();

        placeTimer = requestAnimationFrame(follow);

    }

    placeTimer = requestAnimationFrame(follow);


    function close() {

        cancelAnimationFrame(placeTimer);

        document.removeEventListener("keydown", onKey);

        layer.classList.add("tour-closing");

        setTimeout(() => {

            layer.remove();

            onClose?.();

        }, 250);

    }


    function next() {

        if (index >= steps.length - 1) {

            close();

            return;

        }

        index++;

        show();

    }


    function onKey(event) {

        if (event.key === "Escape") {
            close();
        }

        if (event.key === "Enter" || event.key === "ArrowRight") {
            event.preventDefault();
            next();
        }

    }


    layer.querySelector(".tour-next").addEventListener("click", next);

    layer.querySelector(".tour-skip").addEventListener("click", close);

    document.addEventListener("keydown", onKey);

    show();

    return true;

}


/* ----- Version simplifiée selon le niveau -----
   Niveau 1 : l'essentiel seulement. Les nouveautés arrivent avec les niveaux,
   présentées par le projecteur du tuto au moment où on les débloque.
   (Classes level-lock-N sur body, voir style.css.) */

const LEVEL_UNLOCKS = {
    2: [
        {
            targets: ["#points-widget"],
            title: "🔓 Niveau 2 : les pièces",
            text: "Tu gagnes maintenant des pièces avec tes paris et tes missions."
        },
        {
            targets: ['.nav-button[data-page="missions-page"]'],
            title: "🔓 Les missions",
            text: "Des défis à relever pour gagner de l'XP et des pièces."
        },
        {
            targets: ['.nav-button[data-page="shop-page"]'],
            title: "🔓 La boutique",
            text: "Dépense tes pièces en skins, cadres et effets pour te démarquer."
        }
    ],
    3: [
        {
            targets: ["#streak-sidebar", "#streak-widget"],
            title: "🔓 Niveau 3 : ta série",
            text: "Connecte-toi chaque jour pour faire grandir ta flamme 🔥 et gagner des bonus."
        },
        {
            targets: ["#chat-fab"],
            title: "🔓 Le chat",
            text: "Discute avec ton groupe. Les messages s'effacent chaque lundi."
        },
        {
            targets: ["#diamond-widget"],
            title: "🔓 Les diamants",
            text: "La monnaie rare de BetLab, la même dans tous tes groupes : elle débloque des objets exclusifs."
        }
    ],
    4: [
        {
            targets: ["#nav-create-button", ".bet-create-card"],
            title: "🔓 Niveau 4 : tes propres cotes",
            text: "Quand tu crées un pari, glisse le curseur pour choisir les cotes (jusqu'à 5) et ajoute un 3e choix si tu veux."
        }
    ],
    5: [
        {
            targets: ["#bets-container .bet-card:not(.bet-card-draft)", "#bet-ticket"],
            title: "🔓 Niveau 5 : les combinés",
            text: "Touche les cotes de 2 à 4 paris différents : elles se multiplient dans ton ticket. Tout ou rien !"
        }
    ]
};


function applyLevelLocks(level) {

    // Admin (niveau illimité) : tout est ouvert.
    const current = Number.isFinite(level) ? level || 1 : 99;

    [2, 3, 4, 5].forEach(unlock => {
        document.body.classList.toggle(`level-lock-${unlock}`, current < unlock);
    });

    document
        .querySelectorAll('.nav-button[data-page="missions-page"], .nav-button[data-page="shop-page"]')
        .forEach(button => {

            button.classList.toggle("level-locked", current < 2);

            button.dataset.unlockLevel = "2";

        });

}


// Onglet verrouillé : petite bulle « débloqué au niveau 2 » au lieu d'ouvrir la page.
// (En capture, avant le clic de navigation et les .click() du code.)
document.addEventListener("click", event => {

    const button = event.target.closest?.(".nav-button.level-locked");

    if (!button) {
        return;
    }

    event.preventDefault();

    event.stopImmediatePropagation();

    document.querySelector(".level-lock-tip")?.remove();

    const tip = document.createElement("div");

    tip.className = "level-lock-tip";

    tip.textContent = `🔒 Se débloque au niveau ${button.dataset.unlockLevel}`;

    document.body.appendChild(tip);

    const rect = button.getBoundingClientRect();

    const width = tip.offsetWidth;

    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));

    // Au-dessus du menu du bas (téléphone), sinon en dessous de l'onglet.
    const top = rect.top > window.innerHeight / 2
        ? rect.top - tip.offsetHeight - 10
        : rect.bottom + 10;

    tip.style.left = left + "px";

    tip.style.top = top + "px";

    setTimeout(() => {

        tip.classList.add("level-lock-tip-out");

        setTimeout(() => tip.remove(), 250);

    }, 1800);

}, true);


// Niveau tout juste débloqué : on présente ses nouveautés après l'animation du niveau.
function showLevelUnlocks(level, attempt = 0) {

    const steps = LEVEL_UNLOCKS[level];

    if (!steps) {
        return;
    }

    if ((document.querySelector(".lu-overlay, .tour-layer") || document.querySelector(".modal:not(.hidden)")) && attempt < 60) {

        setTimeout(() => showLevelUnlocks(level, attempt + 1), 500);

        return;

    }

    runSpotlightTour(steps, { lastLabel: "Super !" });

}


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

    watchPageLoader();

    // Compte à rebours des cartes de pari (jours, heures, minutes, secondes).
    setInterval(refreshCardDeadlines, 1000);


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

    setLoadProgress(25);


    try {

        await loadCurrentProfile();

        setLoadProgress(40);


        // Mot de passe provisoire de l'admin pas encore changé (mot-de-passe-oublie.sql).
        if (currentProfile?.must_change_password) {

            window.location.href =
                "index.html";

            return;

        }

        setupWelcome();

        setupGroupSwitcher();

        setupGroupModal();

        setupGroupLeave();

        setupStakesPanel();

        setupValidationOutsideClick();

        setupValidateFabProximity();

        setupCreateModal();

        setupPhoneNav();

        setupLeaderboardPopup();

        setupContestModal();

        setupOddsModeSwitch();

        setupTourReplayButton();

        setupParrotFit();

        await checkGroupRemovals();

        setLoadProgress(50);


        // Aucun groupe : page de bienvenue uniquement.
        if (!currentGroup) {

            showWelcome(false);

            document.body.classList.remove("app-loading");

            return;

        }


        // Pseudos bêta (affichés partout) et journal des nouveautés, avant le premier dessin.
        await Promise.all([
            loadBetaStatus(),
            loadWeekNews()
        ]);

        setLoadProgress(60);

        // Version bêta sans accès : on recharge en version classique.
        if (!checkAppVersion()) {
            return;
        }

        // Groupe connu : on prépare les paris et le classement avant d'afficher
        // la page, pour que les cartes arrivent d'un coup, une seule fois.
        await displayBets();

        setLoadProgress(75);

        await displayLeaderboard();

        setLoadProgress(88);

        // La barre du haut doit être définitive avant l'affichage : série de connexions,
        // coffre et pastille de l'onglet Missions arrivaient après et faisaient bouger la barre.
        // Le niveau aussi : il décide de ce qui est affiché (version simplifiée, applyLevelLocks).
        await Promise.all([
            typeof dailyCheckin === "function" ? dailyCheckin() : null,
            displayMissions(),
            refreshProgression()
        ]);

        document.body.classList.remove("app-loading");

        if (typeof cascadeIn === "function") {

            cascadeIn(document.getElementById("bets-page"));

        }

        // Première arrivée seulement (pas au changement d'onglet) : la barre du haut
        // descend avec les cartes, puis le perroquet monte du bas de l'écran.
        playFirstArrival(document.querySelector(".navbar"), "navbar-arrive");

        playFirstArrival(document.getElementById("parrot"), "parrot-arrive");

        // Tuto guidé demandé à l'inscription : une fois les cartes arrivées.
        setTimeout(startGuidedTour, 1600);

        refreshJoinRequests();

        setupBetsRealtime();

        setupChat();

        // Arbre du groupe : pastille si un vote attend le joueur (arbre.js).
        if (typeof setupTree === "function") {
            setupTree().then(renderGroupSwitcher);
        }

        // Duels en attente ou en cours, défi reçu en fenêtre (duels.js).
        if (typeof refreshDuels === "function") {
            refreshDuels();
        }

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

            await displayAdminBalances();

            setupAdminAccounts();

            await displayAdminAccounts();

            await displayAdminPasswordRequests();

            await displayAdminHistory();

        }


        // Carte des clics : onglet Heat map (admin), sinon accord et comptage (heatmap.js).
        if (typeof setupHeatmap === "function") {
            setupHeatmap();
        }


        await checkAnnouncementPopup();

        await claimEventSkins();

        await checkPlayerNotices();

        await checkReceivedGifts();

        setupDeleteAccount();

        setupProfilePage();

        setupShopPreview();

        setupDiamonds();

        setupPointsModal();

        setupPlayerProfile();

        setupGiftModal();

        setupXpModal();

        alignModalsWithCards();

        setupModalBackdrops();

        await initBeta();

        await initAnimations();

    } catch (error) {

        console.error(error);

        document.body.classList.remove("app-loading");

    }


    /*
        Navigation.
    */

    document
        .querySelectorAll(".nav-button")
        .forEach(button => {

            button.addEventListener(
                "click",
                async () => {

                    const isBetaPage =
                        button.dataset.page === "beta-page";

                    const isRefreshPage =
                        isBetaPage ||
                        button.dataset.page === "missions-page" ||
                        button.dataset.page === "shop-page";

                    // Missions et boutique : les cartes sont redessinées à l'ouverture.
                    // On attend donc ce redessin avant de les faire arriver, pour que
                    // l'animation d'apparition se joue sur les cartes définitives.
                    showPage(
                        button.dataset.page,
                        isRefreshPage
                    );


                    if (isRefreshPage) {

                        const page = document.getElementById(button.dataset.page);

                        page.classList.add("page-refreshing");

                        if (isBetaPage) {

                            await displayBetaPage();

                        } else {

                            await displayMissions();

                            displayShop();

                        }

                        page.classList.remove("page-refreshing");

                        cascadeIn(page);

                        if (!isBetaPage) {

                            refreshProgression();

                        }

                    }

                }
            );

        });


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

        // Répartition des chances : les noms s'affichent aussi dans la barre.
        ["choice-one", "choice-two", "choice-three"].forEach(id => {

            document.getElementById(id)?.addEventListener("input", renderShareBar);

        });

        // Halo sur le prochain champ à remplir.
        ["bet-question", "choice-one", "choice-two", "choice-three"].forEach(id => {

            document.getElementById(id)?.addEventListener("input", updateCreateGuide);

        });

        document
            .getElementById("toggle-third-choice")
            ?.addEventListener("click", () => setThreeChoices(!threeChoicesOn()));

        renderShareBar();

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

        // Mise en euros entiers : ni virgule, ni point, ni signe,
        // et pas de zéro au début (01, 001...).
        stakeInput.addEventListener(
            "keydown",
            event => {

                if ([",", ".", "e", "E", "+", "-"].includes(event.key)) {

                    event.preventDefault();

                }

                if (event.key === "0" && stakeInput.value === "") {

                    event.preventDefault();

                }

            }
        );

        stakeInput.addEventListener(
            "input",
            () => {

                const cleaned = stakeInput.value.split(/[.,]/)[0].replace(/[^0-9]/g, "").replace(/^0+/, "");

                if (stakeInput.value !== cleaned) {

                    stakeInput.value = cleaned;

                }

                updatePotentialWin();

            }
        );

    }


    /*
        Mises rapides (50 €, 100 €, 200 €), moitié du max et mise max du moment
        (sans dépasser le solde). Les mises sont des montants ronds : on arrondit
        à l'euro inférieur.
    */

    document
        .querySelectorAll(".bet-quick button")
        .forEach(button => {

            button.addEventListener("click", () => {

                // Même maximum que la jauge : mise max du moment, ou le solde s'il est plus petit.
                const maxPossible = maxPossibleStake();

                stakeInput.value =
                    button.dataset.stake === "half" ? Math.min(maxPossible, Math.max(STAKE_MIN, Math.floor(maxPossible / 2)))
                    : button.dataset.stake === "max" ? maxPossible
                    : button.dataset.stake;

                updatePotentialWin();

            });

        });


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