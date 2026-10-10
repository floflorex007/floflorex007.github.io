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
    Échéance affichée sur les cartes : l'heure seule si c'est
    aujourd'hui (« 14:30 »), sinon la date et l'heure (« 09/10 à 14:30 »).
*/

function formatCardDeadline(value) {

    if (!value) {

        return null;

    }

    const date =
        new Date(value);

    if (date.toDateString() !== new Date().toDateString()) {

        return formatDeadline(value);

    }

    return date.toLocaleTimeString(
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
        .select("balance, points, cosmetics, gold_frame_until, name_color_until, is_manager, joined_at, groups ( id, name, code, created_by )")
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
        .select("cosmetics, gold_frame_until, name_color_until, profiles ( username, streak_days, last_checkin, flame_name_off, diamond_items )")
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

// Version téléphone (même seuil que le bloc « VERSION TÉLÉPHONE » de style.css).
const PHONE_LAYOUT = window.matchMedia("(max-width: 800px)");

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
        .select("balance, profiles!inner ( username, is_admin, gold_frame_until, name_color_until, cosmetics )")
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
        member => ({ ...member.profiles, balance: member.balance })
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

    if (!player || player.flame_name_off || !player.last_checkin) {
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
                { rank: index + 1, medal: medals[index] || "", balance: formatBalance(profile.balance) }
            )
        ).join("");


        setupLeaderboardHover(container);

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


    // Aucun message, ou message vidé par l'admin : la fenêtre disparaît.
    if (!data || !data.content?.trim()) {

        sidebar.classList.add("hidden");

        content.textContent = "";

        if (permanentInput) {

            permanentInput.value = "";

        }

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
    Admin : stats de tous les joueurs, groupe par groupe (voir admin-stats.sql) :
    XP et flammes (communes à tous les groupes), solde et points (du groupe).
*/

let adminBalances = [];

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

            ${headerExtra}

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




        ${beforeChoices}

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

                    // Cote de 10 ou plus : la case rougeoie et lâche des étincelles (animations.js).
                    const onFire =
                        Number(choice.odds) >= 10 &&
                        !validating &&
                        !isClosed &&
                        !isTargetBlocked;

                    return `

                        <div class="bet-choice-wrapper">

                            ${showBadge
                                ? `<span class="choice-badge">${count}</span>`
                                : ""
                            }

                            <${tag}
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
                                    ${Number(choice.odds).toFixed(2)}
                                </strong>

                            </${tag}>

                            ${onFire
                                ? `<canvas class="odds-embers" aria-hidden="true"></canvas>`
                                : ""
                            }

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
            : `<div class="draft-banner">👆 Mise sur ton pari (seul ou dans un combiné) pour le publier</div>`
        }

        <div class="bet-footer">

            <button type="button" class="draft-delete">🗑 Supprimer le brouillon</button>

            <div class="bet-total-footer">
                <span>Solde misé</span>
                <strong>${formatMoney(0)}</strong>
            </div>

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


function isMyOpenBet(bet) {

    return Boolean(
        currentUser &&
        bet.author_id === currentUser.id &&
        bet.status === "open"
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

function commissionLineHtml(amount) {

    return `
        <div class="validate-commission">
            <span>💼 Ta commission <small>10 % des mises perdues</small></span>
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

            ${commissionLineHtml(creatorCommission(bet, winnerChoiceId))}

            <p class="validate-error"></p>

            <button type="button" class="validate-confirm" data-validate-confirm="${bet.id}">
                ✓ Valider le pari
            </button>

        </div>
    `;

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

    draftFlips.forEach((front, betId) => {

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
            height: rect.height + "px",
            margin: "0",
            zIndex: "5",
            pointerEvents: "none",
            transform: "",
            backfaceVisibility: "hidden",
            webkitBackfaceVisibility: "hidden"
        });

        document.body.appendChild(front);

        const timing = { duration: 1100, delay: 150, easing: "cubic-bezier(.45,0,.25,1)", fill: "both" };

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

                        draftFlips.set(id, card.cloneNode(true));

                    }

                });

        }


        container.innerHTML = "";


        // Carte « Créer un pari » en tête de liste (ordinateur ; sur téléphone, le « + » du menu).
        container.appendChild(renderCreateBetCard());


        const openBets =
            bets.filter(
                bet => bet.status === "open"
            );


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

            container.insertAdjacentHTML("beforeend", `
                <div class="empty-state">
                    Aucun pari disponible pour le moment.
                </div>
            `);

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
                    (isBlockedTarget(bet) || isBetClosed(bet) ? " bet-card-locked" : "") +
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
                    (mine
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
                        beforeChoices: `<div class="validate-reveal${animateHint ? "" : " show"}"><div class="validate-reveal-inner"><div class="validate-hint">👆 Clique la cote qui a gagné</div></div></div>`
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

                                // La cote enflammée (10 ou plus), coupée pendant la validation, revient.
                                const odds = Number(choiceButton.querySelector("strong")?.textContent);

                                if (!closed && !choiceButton.disabled && odds >= 10 && !choiceButton.classList.contains("odds-fire")) {

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

        container.querySelectorAll("[data-validate-confirm]").forEach(button => {

            button.addEventListener("click", event => {

                event.stopPropagation();

                confirmCardValidation(button.dataset.validateConfirm, button);

            });

        });


        if (quiet) {

            animateLiveCards(container, previousTops);

            playDraftFlips(container, draftFlips);

        }


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
        choice.label;

    document.getElementById(
        "modal-odds"
    ).textContent =
        "× " + Number(choice.odds).toFixed(2);


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

const COMBO_MAX_ODDS = 100;

const COMBO_BOOST_PER_LEG = 0.05;

// Sélections du ticket : [{ betId, choiceId }]
let ticketLegs = [];

let ticketStake = 0;

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

    return entries.length === 1 ? product : comboOdds(product, entries.length);

}

// Mise max du ticket : la plus petite mise max du moment parmi ses paris.
function ticketMaxStake(entries = ticketEntries()) {

    return entries.reduce(
        (max, entry) => Math.min(max, betMaxStake(entry.bet)),
        STAKE_MAX
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

    } else if (ticketLegs.length < COMBO_MAX_LEGS) {

        ticketLegs.push({ betId: bet.id, choiceId: choice.id });

    } else {

        ticketAlert("⚠️ " + COMBO_MAX_LEGS + " paris maximum dans un combiné");

        return;

    }

    renderTicket({ bump: true });

    syncTicketHighlights();

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


    const kind = count === 0
        ? ""
        : combo
            ? `<span class="t-kind combo">Combiné · ${count}</span>`
            : `<span class="t-kind">Mise simple</span>`;

    const odds = ticketOdds(entries);

    const boost = combo ? comboBoost(count) : 0;


    ticket.innerHTML = `

        <button type="button" class="ticket-bar" data-ticket-toggle>
            ${kind}
            <b class="ticket-bar-odds${bump ? " bump" : ""}">× ${formatOdds(odds)}</b>
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
                        <div class="ticket-leg">
                            <span class="ticket-leg-text">
                                <b>${escapeHtml(entry.choice.label)}</b>
                                ${escapeHtml(entry.bet.question)}
                            </span>
                            <span class="ticket-leg-odds">${formatOdds(entry.choice.odds)}</span>
                            <button type="button" class="ticket-leg-remove" data-ticket-remove="${entry.bet.id}" aria-label="Retirer">✕</button>
                        </div>
                    `).join("")}
                </div>

                <div class="ticket-sum">
                    <span>${combo ? "Cote combinée" : "Cote"}</span>
                    <b class="ticket-odds${bump ? " bump" : ""}">× ${formatOdds(odds)}</b>
                </div>

                ${entries.some(entry => entry.bet.status === "draft")
                    ? `<p class="ticket-note ticket-note-draft">📝 Ta mise publie ${entries.filter(entry => entry.bet.status === "draft").length > 1 ? "tes brouillons" : "ton brouillon"}.</p>`
                    : ""}

                ${boost ? `<p class="ticket-boost">⚡ Boost +${Math.round(boost * 100)} % inclus${odds >= COMBO_MAX_ODDS ? " · cote max " + COMBO_MAX_ODDS : ""}</p>` : ""}

                ${ticketDuplicate(entries)
                    ? `<p class="ticket-note ticket-note-duplicate">Tu as déjà fait ce combiné (mêmes paris, mêmes choix). Change un choix ou un pari.</p>`
                    : ticketSingleBlocked(entries)
                    ? `<p class="ticket-note">Tu as déjà misé sur ce pari (1 seule mise par pari). Ajoute un 2e pari pour faire un combiné.</p>`
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

                <div class="ticket-win">
                    <span>Gain possible</span>
                    <strong data-ticket-win>0 €</strong>
                </div>

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
    ".ticket-stake, .ticket-chips, .ticket-win, .ticket-go, .ticket-rules";

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

    const win = ticket.querySelector("[data-ticket-win]");

    if (win) {

        win.textContent = formatMoney(ticketStake * odds);

    }

    const go = ticket.querySelector("[data-ticket-go]");

    if (go) {

        const duplicate = ticketDuplicate(entries);

        const blocked = ticketSingleBlocked(entries) || duplicate;

        const publishing = entries.some(entry => entry.bet.status === "draft");

        go.disabled = !ticketStake || blocked || ticketBusy;

        // Mise impossible (pari simple déjà misé, combiné déjà joué) :
        // le bouton change de couleur pour le faire comprendre.
        go.classList.toggle("ticket-go--blocked", blocked);

        go.textContent = duplicate
            ? "⛔ Combiné déjà joué"
            : blocked
            ? "⛔ Déjà misé sur ce pari"
            : !ticketStake
                ? "Choisis ta mise"
                : (entries.length > 1
                    ? "🔗 Miser le combiné · " + formatMoney(ticketStake)
                    : "🎟️ Miser " + formatMoney(ticketStake)) + (publishing ? " et publier" : "");

    }

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

        showError("Mise max en ce moment" + (combo ? " pour ce combiné" : "") + " : " + formatMoney(maxNow) + " (elle baisse avec le temps).");

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
        const { error } = combo
            ? await supabaseClient.rpc("place_combo", {
                p_choice_ids: entries.map(entry => entry.choice.id),
                p_stake: stake
            })
            : await supabaseClient.rpc("place_bet", {
                p_choice_id: entries[0].choice.id,
                p_stake: stake
            });

        if (error) {
            throw error;
        }

        ticketLegs = [];

        ticketStake = 0;

        ticketOpen = false;

        ticketBusy = false;

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
    État d'un combiné : open (en attente), lost, won, refunded (tous ses paris annulés).
    Un pari annulé après contestation sort du combiné (cote 1).
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

        } else if (status !== "cancelled") {

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

    return {
        status: "won",
        payout: Math.round(Number(combo.stake) * comboOdds(product, won) * 100) / 100
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
            leg.bets?.status === "resolved" && leg.bets.winner_choice_id !== leg.choice_id
        );

        card.className = "bet-card claim-card claim-card--combo claim-card--lose";

        card.innerHTML = `

            <div class="claim-card-top">
                <span class="claim-card-badge">🔗 Combiné perdu</span>
                <span class="claim-card-result">Cote <b>× ${formatOdds(combo.odds)}</b></span>
            </div>

            <h3>Combiné · ${legs.length} paris</h3>

            <p class="claim-card-note combo-claim-legs">
                ${legs.map(leg => {

                    const bet = leg.bets || {};

                    const mark =
                        bet.status === "cancelled" ? "↺"
                        : bet.status !== "resolved" ? "⏳"
                        : bet.winner_choice_id === leg.choice_id ? "✓"
                        : "✗";

                    return `${mark} ${escapeHtml(comboLegLabel(leg))}`;

                }).join(" · ")}
            </p>

            ${lostLeg ? `<p class="claim-card-note">Perdu sur « ${escapeHtml(lostLeg.bets.question)} »</p>` : ""}

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
            <span class="claim-card-result">Cote <b>× ${formatOdds(refunded ? 1 : state.payout / Number(combo.stake))}</b></span>
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

    return bet.status === "cancelled" ? "cancelled"
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
                <span class="combo-leg-odds">${formatOdds(leg.odds)}</span>
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
                · cote × ${formatOdds(combo.odds)}
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
                : result === "combo"
                    ? comboRows.length
                    : stakes.filter(s => result === "all" || s.result === result).length +
                      comboRows.filter(row => result === "all" || row.result === result).length;

        const totalStaked =
            stakes.reduce((sum, s) => sum + Number(s.stake), 0) +
            comboRows.reduce((sum, row) => sum + Number(row.combo.stake), 0);

        const totalWon =
            stakes
                .filter(s => s.result === "win")
                .reduce((sum, s) => sum + Number(s.potential_win), 0) +
            comboRows
                .filter(row => row.result === "win")
                .reduce((sum, row) => sum + (row.combo.claimed_at ? Number(row.combo.claimed_amount) : row.state.payout), 0);


        /*
            Mini bilan + filtres.
        */

        container.innerHTML = `

            ${renderContestsBlock()}

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
                    ["lose", "Perdus"],
                    ["combo", "Combinés"],
                    ["creation", "Mes créations"]
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
                            · ${Number(choice.odds).toFixed(2)}
                            · mise ${formatMoney(stake.stake)}
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
                        ${choices.map(choice => escapeHtml(choice.label) + " " + Number(choice.odds).toFixed(2)).join(" · ")}
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
                    // « Tous » montre les mises ; les créations n'apparaissent qu'avec leur filtre.
                    myBetsFilter === "combo"
                        ? row.dataset.combo !== "1"
                        : myBetsFilter === "all"
                        ? row.dataset.result === "creation"
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
                                <span>🎲 ${Number(choice?.odds || 0).toFixed(2)}</span>
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
                                <span>🎲 ${Number(choice?.odds || 0).toFixed(2)} · combiné × ${Number(combo.odds).toFixed(2)}</span>
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
    de la page des paris). Ce que tu as tapé est gardé si tu la fermes.
*/

function openCreateModal() {

    // Échéance repartie de zéro : une date choisie puis abandonnée ne reste pas affichée.
    resetDeadlinePicker();

    document.getElementById("create-modal").classList.remove("hidden");

    // Sur téléphone, pas de curseur automatique : le clavier cacherait la fenêtre.
    if (!PHONE_LAYOUT.matches) {

        setTimeout(() => document.getElementById("bet-question")?.focus(), 120);

    }

}

function closeCreateModal() {

    document.getElementById("create-modal").classList.add("hidden");

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


    // Cotes limitées à 20 (les deux choix).
    const oddsMessage = oddsProblem(oddsOne, oddsTwo);

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
    Cotes autorisées : de 1,01 à 20 (vérifié aussi par Supabase, voir securite-paris.sql).
    La cote 2 étant calculée depuis la cote 1, la cote 1 doit rester entre 1,06 et 20
    (en dessous de 1,06, la cote 2 dépasserait 20).
*/

const ODDS_MIN = 1.01;

const ODDS_MAX = 20;

function oddsProblem(oddsOne, oddsTwo) {

    if (!oddsOne || !oddsTwo) {
        return "";
    }

    if (oddsOne > ODDS_MAX) {
        return "Cote trop haute : 20 maximum.";
    }

    if (oddsOne < ODDS_MIN || oddsTwo > ODDS_MAX) {
        return "Cote trop basse : avec " + formatOdds(oddsOne) + ", le choix 2 dépasserait 20. Mets au moins 1,06.";
    }

    return "";

}

function formatOdds(value) {

    return Number(value).toFixed(2).replace(".", ",");

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
        options: ["🔥", "⚡", "🍀", "🦊", "💎", "🎯"]
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

const SHOP_CATEGORIES = [
    {
        icon: "✨",
        title: "Additionnels au pseudo",
        kind: "cosmetic",
        items: ["emoji", "etincelles"]
    },
    {
        icon: "🎨",
        title: "Couleurs et animations du pseudo",
        kind: "cosmetic",
        items: ["neon", "scanner", "metal_rose", "metal_bronze", "metal_argent", "neon_anime", "metal_or", "fiole", "ruban_chantier", "couleur"]
    },
    {
        icon: "🖼️",
        title: "Cadres",
        kind: "cosmetic",
        items: ["cadre", "aura"]
    },
    {
        icon: "🃏",
        title: "Thèmes de cartes",
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
            : `<span class="mission-state">${canBuy ? "Disponible" : "Il te manque " + (reward.price - points) + " 🪙"}</span>`;


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
                    <span class="mission-points">${reward.price} 🪙</span>
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

    ` + diamondShopHtml() + SHOP_CATEGORIES.map(category => `

        <section
            class="shop-category${shopFilter !== "all" && shopFilter !== category.kind ? " hidden" : ""}"
            data-kind="${category.kind}"
        >

            <h2 class="missions-title">
                ${category.icon} ${escapeHtml(category.title)}
            </h2>

            <div class="missions-grid">
                ${category.items.map(cardOf).join("")}
            </div>

        </section>

    `).join("");

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
    const effects = {
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
                ${leaderboardRowHtml({ username: "Emma" }, { rank: 2, medal: "🥈", balance: formatBalance(1840), effects: {}, extraClass: " shop-preview-dim" })}
                ${leaderboardRowHtml(me, { rank: 3, medal: "🥉", balance: formatBalance(1520), effects })}
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
    Sauf l'annonce admin, qui doit être fermée avec son bouton
    pour être marquée comme lue.
*/

function setupModalBackdrops() {

    document
        .querySelectorAll(".modal:not(#announcement-modal):not(#removed-modal)")
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
        if (window.innerWidth <= 800 || !card) {

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


    // Clic sur une carte (hors boutons) : ouvre l'aperçu.
    container.addEventListener("click", event => {

        if (event.target.closest("button")) {
            return;
        }

        const card =
            event.target.closest("[data-shop-item]");

        // Pas d'aperçu pour les articles sans effet sur le pseudo.
        if (card && !["clic_perroquet", "clic_perroquet_x3", "bouclier", "rattrapage"].includes(card.dataset.shopItem)) {
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


    const status = active
        ? `<span class="mission-state done">✓ Possédé</span>`
        : `<span class="mission-state">${canBuy ? "Disponible" : "Il te manque " + (item.price - points) + " 🪙"}</span>`;


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

    // Le clic du perroquet ne change pas le pseudo : pas d'aperçu.
    const adminToggle = currentProfile.is_admin && !item.id.startsWith("clic_perroquet")
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
                <span class="mission-points">${item.price} 🪙</span>
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
    bugFixed: 50,
    ideaKept: 150,
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
    Carte du Profil : demander à devenir bêta-testeur.
*/

function displayBetaRequestCard() {

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
            .select("id, user_id, kind, text, status, created_at, profiles!beta_ideas_user_id_fkey ( username )")
            .order("created_at", { ascending: false }),
        supabaseClient
            .from("beta_idea_likes")
            .select("idea_id, user_id")
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
            ${leaderboardRowHtml({ username: "Emma" }, { rank: 2, medal: "🥈", balance: formatBalance(1840), effects: {}, extraClass: " shop-preview-dim" })}
            ${leaderboardRowHtml(me, { rank: 3, medal: "🥉", balance: formatBalance(1520), effects })}
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


function betaIdeasHtml() {

    const isAdmin =
        Boolean(currentProfile?.is_admin);

    const likesOf = id =>
        betaLikes.filter(like => like.idea_id === id).length;

    const iLike = id =>
        betaLikes.some(like => like.idea_id === id && like.user_id === currentUser.id);

    // Les idées encore en attente d'abord, puis les plus aimées.
    const sorted = [...betaIdeas].sort((a, b) =>
        (a.status === "sent" ? 0 : 1) - (b.status === "sent" ? 0 : 1) ||
        likesOf(b.id) - likesOf(a.id)
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
                            Proposer ${betaGainHtml(BETA_POINTS.send)}
                        </button>
                    </div>
                </div>
            `}

            <div class="beta-card">
                <h3>🗳️ Les idées de tout le monde</h3>
                <p class="beta-meta">❤️ « J'aime » sur celles que tu veux voir arriver.</p>
                <div class="beta-list">
                    ${sorted.length
                        ? sorted.map(idea => {
                            const status = BETA_IDEA_STATUS[idea.status];
                            const mine = idea.user_id === currentUser.id;
                            return `
                                <div class="beta-item beta-item--${status.className}">
                                    <button
                                        type="button"
                                        class="beta-like${iLike(idea.id) ? " on" : ""}"
                                        data-beta-like="${idea.id}"
                                        ${mine || isAdmin ? "disabled" : ""}
                                        title="${mine ? "Ta propre idée" : "J'aime"}"
                                    >
                                        <span class="beta-like-icon">❤️</span>${likesOf(idea.id)}
                                    </button>
                                    <div class="beta-item-text">
                                        <b>${escapeHtml(idea.text)}</b>
                                        <p>${idea.kind === "design" ? "🎨 Design" : "🧩 Fonctionnalité"} · par ${mine ? "toi" : styledName(idea.profiles)}</p>
                                    </div>
                                    <div class="beta-item-side">
                                        <span class="beta-status beta-status--${status.className}">${status.icon} ${status.label}</span>
                                        ${isAdmin && idea.status === "sent" ? `
                                            <div class="beta-item-buttons">
                                                <button type="button" class="primary-button" data-beta-keep="${idea.id}">★ Retenir ${betaGainHtml(BETA_POINTS.ideaKept)}</button>
                                                <button type="button" class="secondary-button" data-beta-reject="${idea.id}">Pas retenue</button>
                                            </div>
                                        ` : ""}
                                        ${isAdmin && idea.status === "kept"
                                            ? `<button type="button" class="secondary-button" data-beta-to-news="${idea.id}">📖 Au journal</button>`
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

    const icons = ["❤️", "💖", "✨"];

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

            } else if (data.betaLike) {

                const id = Number(data.betaLike);

                const { data: liked, error } = await supabaseClient.rpc("beta_toggle_like", { p_idea: id });

                if (error) {
                    throw error;
                }

                betaLikes = liked
                    ? [...betaLikes, { idea_id: id, user_id: currentUser.id }]
                    : betaLikes.filter(like => !(like.idea_id === id && like.user_id === currentUser.id));

                renderBetaPage();

                if (liked) {

                    const again = container.querySelector(`[data-beta-like="${id}"]`);

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

            } else if (data.betaKeep || data.betaReject) {

                const { error } = await supabaseClient.rpc("beta_decide_idea", {
                    p_idea: Number(data.betaKeep || data.betaReject),
                    p_keep: Boolean(data.betaKeep)
                });

                if (error) {
                    throw error;
                }

                message(data.betaKeep
                    ? `Idée retenue : son auteur reçoit +${BETA_POINTS.ideaKept} 🪙 et une notification.`
                    : "Idée marquée « pas retenue ».");

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
        price: 8
    },
    {
        id: "emoji_diamant",
        title: "💎 à côté du pseudo",
        description: "Un petit diamant à côté de ton pseudo, partout sur le site.",
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
            ${leaderboardRowHtml(me, { rank: 3, medal: "🥉", balance: formatBalance(1520), effects, extraClass: extra })}
        </div>
    `;

    if (item.id === "cristal") {
        return row({ cristal: true });
    }

    if (item.id === "cadre_diamant") {
        return row({ diamondFrame: true });
    }

    if (item.id === "emoji_diamant") {
        return row({ diamondEmoji: true });
    }

    if (item.id === "theme_diamant") {
        return `<div class="dia-theme-peek bet-theme-diamant">🏆 Qui gagne le match ce soir ?</div>`;
    }

    return `<div class="dia-skin-peek"><img src="assets/perroquet/skins/cristal/thumb.png" alt=""></div>`;

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

            button = `<button type="button" class="secondary-button" data-diamond-toggle="${item.id}" data-on="${on ? "0" : "1"}">${on ? "Retirer" : "Équiper"}</button>`;

        }

        return `
            <div class="mission-card dia-card${owned ? " owned" : ""}">
                <div class="mission-head">
                    <h3>${escapeHtml(item.title)}<span class="dia-excl">EXCLU</span></h3>
                    <span class="mission-points dia-price">${item.price} 💎</span>
                </div>
                <p class="mission-description">${escapeHtml(item.description)}</p>
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

            <div class="dia-banner">
                <span class="dia-banner-icon">💎</span>
                <div class="dia-banner-text">
                    <b>${admin ? "∞" : diamonds} diamant${diamonds > 1 || admin ? "s" : ""}</b>
                    <p>Objets exclusifs, introuvables avec les pièces. Communs à tous tes groupes.</p>
                </div>
                <button type="button" class="dia-button" data-diamond-packs>Obtenir des 💎</button>
            </div>

            <h2 class="missions-title">💎 Exclusivités diamant</h2>

            <div class="missions-grid">${cards}</div>

            <p
                id="diamond-message"
                class="missions-message hidden"
            ></p>

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

                await afterDiamondChange(`« ${item.title} » est à toi !`);

            } else if (data.diamondToggle) {

                const { error } = await supabaseClient.rpc("toggle_diamond_item", {
                    p_item: data.diamondToggle,
                    p_on: data.on === "1"
                });

                if (error) {
                    throw error;
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
        ["🎁", "Coffre du jour", "Ouvre-le une fois par jour (barre du haut sur ordinateur, page Paris sur téléphone) : de 5 à 20 🪙.", null, null],
        ["🏆", "Vote du vendredi", "Vote pour la nouveauté de la semaine dans le journal de la page Paris : +5 🪙.", null, null],
        ...(beta ? [["🧪", "Aide app", "Bêta-testeur : +10 🪙 par bug ou idée envoyé, +50 si ton bug est corrigé, +150 si ton idée est retenue.", "beta-page", "Ouvrir l'Aide app"]] : []),
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
    cristal: "Cristal"
};

// Paris de la fenêtre ouverte, pour retrouver ce qu'on copie.
let playerProfileItems = [];


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
                        <span class="pp-leg-o">${Number(leg.odds).toFixed(2)}</span>
                    </li>
                `).join("")}
            </ul>
            <div class="pp-bet-foot">
                <span>
                    Mise <b>${euros(item.stake)}</b>
                    ${item.combo ? ` · cote <b>${Number(item.odds).toFixed(2)}</b>` : ""}
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

    return `
        <div class="pp-head">
            <img class="pp-parrot" src="assets/perroquet/skins/${skin}/thumb.png" alt="">
            <div class="pp-who">
                <div class="pp-name">${styledName({ username: data.username })}</div>
                <div class="pp-sub">🦜 Perroquet ${escapeHtml(PARROT_SKIN_NAMES[skin])}</div>
                <div class="pp-sub">Membre depuis le ${new Date(data.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</div>
            </div>
            ${admin ? "" : `<div class="pp-rank"><b>${medal} ${data.rank}<sup>${data.rank === 1 ? "er" : "e"}</sup></b><span>du groupe</span></div>`}
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

        if (!target || target.closest(".shop-preview-stage, .dia-peek, .shop-card, #player-modal")) {
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


    /*
        Session ouverte avec un mot de passe provisoire de l'admin
        (voir mot-de-passe-oublie.sql) : on reste ici pour le changer.
    */

    let mustChangePassword = false;


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


        if (!mustChangePassword) {

            window.location.href =
                "app.html";

            return;

        }

    }


    const showAuthSection = id => {

        ["login-section", "register-section", "forgot-section", "new-password-section"].forEach(section => {

            document
                .getElementById(section)
                ?.classList.toggle("hidden", section !== id);

        });

    };


    setupPasswordEyes();


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


                // Mot de passe provisoire de l'admin : à changer avant d'entrer.
                if (currentProfile?.must_change_password) {

                    showAuthSection("new-password-section");

                    document.getElementById("new-password").focus();

                    return;

                }


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


            const passwordConfirm =
                document.getElementById(
                    "register-password-confirm"
                ).value;


            errorElement.textContent = "";


            if (password !== passwordConfirm) {

                errorElement.textContent =
                    "Les deux mots de passe ne sont pas identiques.";

                return;

            }


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

            const { error } = await supabaseClient.auth.updateUser({ password: password });

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

        setupParrotFit();

        await checkGroupRemovals();


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

        // Groupe connu : on prépare les paris et le classement avant d'afficher
        // la page, pour que les cartes arrivent d'un coup, une seule fois.
        await displayBets();

        await displayLeaderboard();

        // La barre du haut doit être définitive avant l'affichage : série de connexions,
        // coffre et pastille de l'onglet Missions arrivaient après et faisaient bouger la barre.
        await Promise.all([
            typeof dailyCheckin === "function" ? dailyCheckin() : null,
            displayMissions()
        ]);

        document.body.classList.remove("app-loading");

        if (typeof cascadeIn === "function") {

            cascadeIn(document.getElementById("bets-page"));

        }

        refreshJoinRequests();

        setupBetsRealtime();

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

        }


        await checkAnnouncementPopup();

        setupDeleteAccount();

        setupProfilePage();

        setupShopPreview();

        setupDiamonds();

        setupPointsModal();

        setupPlayerProfile();

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

        oddsOneInput.addEventListener(
            "input",
            () => {

                const cote =
                    calculerCoteComplementaire(
                        Number(oddsOneInput.value)
                    );

                oddsTwoInput.value =
                    cote ? cote.toFixed(2) : "";

                // Cote max 20 : message tout de suite sous les cotes.
                const problem = oddsProblem(Number(oddsOneInput.value), cote);

                const oddsError = document.getElementById("odds-error");

                oddsError.textContent = problem;

                oddsError.classList.toggle("hidden", !problem);

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