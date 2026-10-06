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
            isManager: member.is_manager || member.groups.created_by === currentUser.id
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
        .select("cosmetics, gold_frame_until, name_color_until, profiles ( username )")
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
                    name_color_until: member.name_color_until
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

    switchGroup(data.id);

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

    document.getElementById("group-manage-section").classList.toggle("hidden", !manager);

    document.getElementById("group-member-note").classList.toggle("hidden", manager);

    if (manager) {

        document.getElementById("group-rename-input").value = group.name;

        document.getElementById("group-code").textContent = group.code;

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

    const total =
        (data || []).reduce((sum, s) => sum + Number(s.stake), 0);

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


/*
    Taille adaptée à l'écran : le perroquet reste en bas à droite et ne
    descend jamais sur le coffre ni sur la carte d'expérience (colonne de
    droite). S'il n'y a vraiment pas la place, il se cache.
*/

const PARROT_BOTTOM_OFFSET = 42;   // le perroquet dépasse de 42 px sous l'écran (bottom: -42px)

const PARROT_GAP = 12;             // marge sous la colonne de droite

const PARROT_MIN_WIDTH = 130;

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

    // Le haut du perroquet doit rester sous le bas de la colonne.
    const room = window.innerHeight + PARROT_BOTTOM_OFFSET - columnRect.bottom - PARROT_GAP;

    return room * 512 / 650;

}

function applyParrotWidth(seconds) {

    const parrotElement = document.getElementById("parrot");

    if (!parrotElement) {
        return;
    }

    const wanted = Math.min(
        parrotWidthFor(parrotLastTotal),
        window.innerWidth * 0.42
    );

    const limit = parrotWidthLimit(wanted);

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

    window.addEventListener("scroll", refit, { passive: true });

    const column = document.querySelector(".right-column");

    if (column && typeof ResizeObserver !== "undefined") {

        new ResizeObserver(refit).observe(column);

    }

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

    return {
        gold: isMe ? hasMyReward("gold_frame_until") : isRewardActive(profile.gold_frame_until) && !profile.cosmetics?.cadre?.off,
        rainbow: isMe ? hasMyReward("name_color_until") : isRewardActive(profile.name_color_until) && !profile.cosmetics?.couleur?.off,
        metal,
        neon: active("neon") ? option("neon") : null,
        emoji: active("emoji") ? option("emoji") : null,
        title: active("titre") ? option("titre") : null,
        sparkle: active("etincelles"),
        aura: active("aura"),
        theme: active("theme") ? option("theme") : null
    };

}


/*
    Pseudo avec ses effets (couleur, emoji, titre, étincelles).
    Priorité de la couleur : métal > arc-en-ciel > néon.
*/

function nameHtml(profile, effects = getEffects(profile)) {

    let name;

    if (effects.metal) {
        name = `<span class="name-metal metal-${effects.metal}">${escapeHtml(profile.username)}</span>`;
    } else if (effects.rainbow) {
        name = `<span class="pseudo-color">${rainbowName(profile.username)}</span>`;
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

    if (effects.title) {
        name += ` <span class="name-title">${escapeHtml(effects.title)}</span>`;
    }

    return name;

}


function styledName(profile, fallback = "Utilisateur") {

    if (!profile?.username) {
        return escapeHtml(fallback);
    }

    const effects =
        getEffects(profile);

    return `<span class="user-name${effects.gold ? " name-gold" : ""}">${nameHtml(profile, effects)}</span>`;

}


/*
    Ligne du classement (joueur classé ou admin épinglé).
*/

function leaderboardRowHtml(profile, { rank, medal, balance, extraClass = "", effects: forcedEffects = null }) {

    const effects =
        forcedEffects || getEffects(profile);

    const hasEffect =
        effects.metal || effects.rainbow || effects.neon || effects.sparkle || effects.emoji || effects.title;

    return `
        <div class="leaderboard-row${extraClass}${effects.gold ? " leaderboard-row--gold" : ""}${effects.aura ? " leaderboard-row--aura" : ""}">
            <span class="leaderboard-rank">${rank}</span>
            <span class="leaderboard-medal">${medal}</span>
            <span class="leaderboard-pseudo${hasEffect ? " has-effect" : ""}">${nameHtml(profile, effects)}</span>
            <span class="leaderboard-balance">${balance}</span>
        </div>
    `;

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
            profiles!bets_author_id_fkey ( username, gold_frame_until, name_color_until, cosmetics ),
            target:profiles!bets_target_user_id_fkey ( username, gold_frame_until, name_color_until, cosmetics ),
            stakes ( id, user_id, choice_id, stake, potential_win, claimed_at, created_at, profiles!stakes_user_id_fkey ( username, gold_frame_until, name_color_until, cosmetics ) )
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
    Échéance d'un pari :
    - les mises ferment 1 h avant la date d'échéance (la carte se grise) ;
    - la carte devient rouge 2 h avant (c'est la dernière heure pour miser).
*/

const BET_CLOSE_MS = 3600 * 1000;

const BET_URGENT_MS = 7200 * 1000;

// Étiquette en haut de la carte : « Trop tard » (mises closes), « Last Chance » (dernières heures) ou « Aujourd'hui ».
function betBadgeLabel(bet) {

    if (isBetClosed(bet)) {

        return "TROP TARD";

    }

    if (bet.deadline_at && new Date(bet.deadline_at) - Date.now() <= BET_URGENT_MS) {

        return "LAST CHANCE";

    }

    return isCreatedToday(bet.created_at) ? "AUJOURD'HUI" : "";

}


function isBetClosed(bet) {

    return Boolean(
        bet.deadline_at &&
        new Date(bet.deadline_at) - Date.now() <= BET_CLOSE_MS
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

                    return `

                        <div class="bet-choice-wrapper">

                            ${showBadge
                                ? `<span class="choice-badge">${count}</span>`
                                : ""
                            }

                            <${tag}
                                class="bet-choice-button${!validating && (isClosed || isTargetBlocked) ? " bet-choice-closed" : ""}${myChoiceIds.includes(choice.id) ? " bet-choice-picked" : ""}${interactive ? "" : " bet-choice-readonly"}${validating ? " bet-choice-validate" : ""}${validating && cardValidation?.pick === choice.id ? " validate-selected" : ""}"
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


async function claimBet(betId, won, card) {

    if (card.classList.contains("claiming")) {
        return;
    }

    card.classList.add("claiming");


    const oldBalance =
        Number(currentProfile?.balance || 0);

    const { data, error } =
        await supabaseClient.rpc(
            "claim_bet",
            {
                p_bet_id: betId
            }
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

    document.addEventListener("mousemove", event => {

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

}


function isMyOpenBet(bet) {

    return Boolean(
        currentUser &&
        bet.author_id === currentUser.id &&
        bet.status === "open"
    );

}

/*
    Bilan si ce choix gagne : une ligne par joueur et par choix,
    gagnants avec leur gain, perdants avec leur mise perdue.
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

    return `
        <div class="validate-bilan">

            <div class="validate-cols">

                <div class="validate-col validate-col-win">
                    <h4>🏆 Gagnants (${winners.length})</h4>
                    ${winnerLines || `<small>Personne</small>`}
                </div>

                <div class="validate-col validate-col-lose">
                    <h4>✗ Perdants (${losers.length})</h4>
                    ${loserLines || `<small>Personne</small>`}
                </div>

            </div>

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
            (bet.stakes || []).filter(s => s.claimed_at).length
        ].join(":"))
        .join("|");

}


/*
    Arrivée d'une carte en direct : elle se dévoile de gauche à droite
    pendant qu'un reflet la traverse, et les autres cartes descendent
    en douceur pour lui faire de la place.
    Le dévoilement dépasse un peu de la carte (marges négatives) pour ne
    pas couper la pastille « AUJOURD'HUI » ni la lueur autour de la carte.
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

        const bets = await getBets();


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

        }


        container.innerHTML = "";


        const openBets =
            bets.filter(
                bet => bet.status === "open"
            );


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

        const previousClaimIds = renderedClaimIds;

        renderedClaimIds = new Set(claimableBets.map(bet => bet.id));

        claimableBets.forEach(bet => {

            const claimCard = renderClaimCard(bet);

            // Nouvelle carte à récupérer (pari qui vient d'être validé) : elle arrive en douceur.
            if (quiet && !previousClaimIds.has(bet.id)) {

                claimCard.classList.add("claim-card-enter");

            }

            container.appendChild(claimCard);

        });


        if (openBets.length === 0 && claimableBets.length === 0) {

            container.innerHTML = `
                <div class="empty-state">
                    Aucun pari disponible pour le moment.
                </div>
            `;

            return;

        }


        if (cardValidation && !openBets.some(bet => bet.id === cardValidation.betId && isMyOpenBet(bet))) {

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
                    (quiet && !previousIds.has(bet.id) ? " bet-card-live-in" : "");


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

                }


                const totalStaked =
                    (bet.stakes || []).reduce(
                        (sum, s) => sum + Number(s.stake),
                        0
                    );


                // Mode validation (créateur du pari seulement).
                const mine = isMyOpenBet(bet);

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

                            const closed = (deadline && new Date(deadline) - Date.now() <= BET_CLOSE_MS) ||
                                card.classList.contains("bet-card-locked");

                            card.querySelectorAll(".bet-choice-validate").forEach(choiceButton => {

                                choiceButton.classList.remove("bet-choice-validate", "validate-selected");

                                if (closed) {

                                    choiceButton.classList.add("bet-choice-closed");

                                    choiceButton.disabled = true;

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

        container.querySelectorAll("[data-validate-confirm]").forEach(button => {

            button.addEventListener("click", event => {

                event.stopPropagation();

                confirmCardValidation(button.dataset.validateConfirm, button);

            });

        });


        if (quiet) {

            animateLiveCards(container, previousTops);

        }


        /*
            Ajout des événements sur la carte
            (ouvre le détail des parieurs en focus,
            sauf si on clique sur un bouton de choix).
        */

        document
            .querySelectorAll(".bet-card:not(.claim-card)")
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
    Jauge de gain de la fenêtre de mise : elle se remplit avec le gain
    (pleine à 500 €), un message motive vers le palier suivant,
    et le bouton affiche le montant misé.
*/

const BET_GAUGE_FULL = 500;

const BET_GAIN_GOALS = [50, 100, 200, 500, 1000];

function updateBetGauge(stake, gain) {

    const percent =
        Math.min(100, gain / BET_GAUGE_FULL * 100);

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

    button.textContent = stake
        ? "🎟️ Miser " + formatMoney(stake)
        : "Placer le pari";

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
            "Les mises sont closes (dernière heure avant l'échéance).";

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


    // Limite : 3 mises par pari et par joueur (aussi vérifiée côté base).
    const myStakesCount =
        (currentBet?.stakes || []).filter(
            s => s.user_id === currentUser?.id
        ).length;

    if (myStakesCount >= 3) {

        errorElement.textContent =
            "Tu as déjà placé 3 mises sur ce pari (maximum).";

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
   7. MES PARIS
========================================================= */

// Filtre actif de l'onglet « Historique » : all, open, win ou lose.
let myBetsFilter = "all";


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
                bets!inner (
                    id,
                    question,
                    status,
                    winner_choice_id,
                    group_id
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
                stakes ( stake )
            `)
            .eq("author_id", currentUser.id)
            .eq("group_id", currentGroup?.id)
            .order("created_at", { ascending: false });

        if (createdError) {

            throw createdError;

        }

        const created = createdData || [];


        container.innerHTML = "";


        if ((!data || data.length === 0) && created.length === 0) {

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
                    stake.bets.status !== "resolved" ? "open"
                    : stake.bets.winner_choice_id === stake.bet_choices.id ? "win"
                    : "lose"
            }));

        const countOf = result =>
            result === "creation"
                ? created.length
                : stakes.filter(s => result === "all" || s.result === result).length;

        const totalStaked =
            stakes.reduce((sum, s) => sum + Number(s.stake), 0);

        const totalWon =
            stakes
                .filter(s => s.result === "win")
                .reduce((sum, s) => sum + Number(s.potential_win), 0);


        /*
            Mini bilan + filtres.
        */

        container.innerHTML = `

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


        stakes.forEach(
            stake => {

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
                    : "⏳";

                const amount =
                    stake.result === "win" ? "+" + formatMoney(stake.potential_win)
                    : stake.result === "lose" ? "−" + formatMoney(stake.stake)
                    : formatMoney(stake.potential_win);


                item.innerHTML = `

                    <span class="my-bet-dot">${icon}</span>

                    <div class="my-bet-text">

                        <h3>${escapeHtml(bet.question)}</h3>

                        <p>
                            ${escapeHtml(choice.label)}
                            · ${Number(choice.odds).toFixed(2)}
                            · mise ${formatMoney(stake.stake)}
                        </p>

                    </div>

                    <span class="my-bet-amount">${amount}</span>

                `;


                rows.appendChild(item);

            }
        );


        created.forEach(bet => {

            const choices = bet.bet_choices || [];

            const done = bet.status === "resolved";

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

                <span class="my-bet-dot">${done ? "✓" : "⏳"}</span>

                <div class="my-bet-text">

                    <h3>${escapeHtml(bet.question)}</h3>

                    <p>
                        ${choices.map(choice => escapeHtml(choice.label) + " " + Number(choice.odds).toFixed(2)).join(" · ")}
                        ${done && winner ? " · 🏆 " + escapeHtml(winner.label) : (done ? "" : " · en cours")}
                    </p>

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
                    myBetsFilter === "all"
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
            .select("choice_id, stake, potential_win, profiles!stakes_user_id_fkey ( username, gold_frame_until, name_color_until, cosmetics )")
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


    // Liste des parieurs sous le contenu de la carte.
    const stakes = bet.stakes || [];

    const more = document.createElement("div");

    more.className = "stakes-pop-more";

    more.innerHTML = `
        <h3 class="stakes-pop-title">Détail des parieurs</h3>

        <div class="stakes-pop-list">
            ${stakes.length === 0
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

                // La carte se replie en douceur sous la fenêtre de mise qui s'ouvre
                // (au lieu de disparaître d'un coup).
                closeStakesPanel();

                openBetModal(bet, choice);

            }

        });

    });

    pop.querySelector(".stakes-pop-close").addEventListener("click", closeStakesPanel);

    // Pastille « Valider » : la carte se replie et passe en mode validation.
    pop.querySelector(".validate-fab")?.addEventListener("click", event => {

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

    document.getElementById("create-modal").classList.remove("hidden");

    setTimeout(() => document.getElementById("bet-question")?.focus(), 120);

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

        resetDeadlinePicker();


        /*
            On ferme la fenêtre : le nouveau pari arrive dans la liste.
        */

        closeCreateModal();


        await displayBets({ quiet: true });

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
    Sélecteur d'échéance : un jour parmi les 7 prochains
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


    for (let i = 0; i < 7; i++) {

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

        dayButton.addEventListener("click", () => {

            deadlineDayOffset = i;

            daysContainer
                .querySelectorAll(".deadline-day")
                .forEach(button => button.classList.toggle("active", button === dayButton));

            document.getElementById("deadline-error").classList.add("hidden");

            updateDeadlinePreview();

        });

        daysContainer.appendChild(dayButton);

    }


    document
        .getElementById("deadline-range")
        .addEventListener("input", updateDeadlinePreview);

    resetDeadlinePicker();

}


function resetDeadlinePicker() {

    deadlineDayOffset = null;

    document
        .querySelectorAll(".deadline-day")
        .forEach(button => button.classList.remove("active"));

    document.getElementById("deadline-range").value =
        DEFAULT_DEADLINE_STEP;

    updateDeadlinePreview();

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
        id: "titre",
        title: "Titre à côté du pseudo",
        description: "Un petit titre affiché à côté de ton pseudo.",
        price: 20,
        options: ["Chanceux", "Outsider", "Requin", "Débutant"]
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
    }
];


/*
    Catégories de la boutique (ordre d'affichage).
    Mélange les avantages historiques (REWARDS) et les cosmétiques.
*/

const SHOP_CATEGORIES = [
    {
        icon: "✨",
        title: "Additionnels au pseudo",
        items: ["emoji", "titre", "etincelles"]
    },
    {
        icon: "🎨",
        title: "Couleurs et animations du pseudo",
        items: ["neon", "metal_rose", "metal_bronze", "metal_argent", "metal_or", "couleur"]
    },
    {
        icon: "🖼️",
        title: "Cadres",
        items: ["cadre", "aura"]
    },
    {
        icon: "🃏",
        title: "Thèmes de cartes",
        items: ["theme"]
    }
];


// Option choisie dans la boutique pour chaque cosmétique (avant achat).
const shopSelections = {};


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
        rewardCards[id] ||
        cosmeticCardHtml(COSMETICS.find(c => c.id === id));

    // Inclinaison « la carte suit la souris » : on la retient pour la remettre sur la carte
    // redessinée (sinon elle se redresse d'un coup quand on équipe ou achète).
    const savedTilts = new Map();

    container.querySelectorAll("[data-shop-item].tilting").forEach(card => {

        savedTilts.set(card.dataset.shopItem, card.style.transform);

    });

    container.innerHTML = SHOP_CATEGORIES.map(category => `

        <section class="shop-category">

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
        neon: itemId === "neon" ? selected : null,
        emoji: itemId === "emoji" ? selected : null,
        title: itemId === "titre" ? selected : null,
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

        if (card) {
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

    const adminToggle = currentProfile.is_admin
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

        if (!skipCascade) {

            cascadeIn(page);

        }


        /*
            Retour sur les paris : on recharge le classement
            pour jouer une éventuelle remontée.
        */

        if (pageId === "bets-page") {

            displayLeaderboard();

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

        setupWelcome();

        setupGroupSwitcher();

        setupGroupModal();

        setupGroupLeave();

        setupStakesPanel();

        setupValidateFabProximity();

        setupCreateModal();

        setupParrotFit();

        await checkGroupRemovals();


        // Aucun groupe : page de bienvenue uniquement.
        if (!currentGroup) {

            showWelcome(false);

            document.body.classList.remove("app-loading");

            return;

        }


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

        }


        await checkAnnouncementPopup();

        setupDeleteAccount();

        setupProfilePage();

        setupShopPreview();

        setupModalBackdrops();

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

                    const isRefreshPage =
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

                        await displayMissions();

                        displayShop();

                        page.classList.remove("page-refreshing");

                        cascadeIn(page);

                        refreshProgression();

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
            openCreateModal
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
        Mises rapides (20 €, 50 €, 100 €).
    */

    document
        .querySelectorAll(".bet-quick button")
        .forEach(button => {

            button.addEventListener("click", () => {

                stakeInput.value = button.dataset.stake;

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