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



/* =========================================================
   3. UTILITAIRES
========================================================= */

function formatMoney(value) {

    return Number(value).toLocaleString(
        "fr-FR",
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }
    ) + " €";

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


    updateBalance();

}



/* =========================================================
   SOLDE
========================================================= */

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


    balanceElement.textContent =
        formatMoney(currentProfile.balance);

}



/* =========================================================
   5. CHARGER LES PARIS
========================================================= */

async function getBets() {
    const { data, error } = await supabaseClient
        .from("bets")
        .select(`
            *,
            bet_choices!bet_choices_bet_id_fkey (*)
        `)
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

async function displayBets() {

    const container =
        document.getElementById("bets-container");


    if (!container) {

        return;

    }


    container.innerHTML =
        "<p>Chargement des paris...</p>";


    try {

        const bets = await getBets();


        container.innerHTML = "";


        const openBets =
            bets.filter(
                bet => bet.status === "open"
            );


        if (openBets.length === 0) {

            container.innerHTML = `
                <div class="empty-state">
                    Aucun pari disponible pour le moment.
                </div>
            `;

            return;

        }


        openBets.forEach(
            bet => {

                const card =
                    document.createElement("div");

                card.className =
                    "bet-card";


                const author =
                    bet.profiles?.username ||
                    "Utilisateur";


                const choices =
                    bet.bet_choices || [];


                card.innerHTML = `

                    <div class="bet-card-header">

                        <span class="bet-author">
                            Créé par ${escapeHtml(author)}
                        </span>

                    </div>


                    <h3>
                        ${escapeHtml(bet.question)}
                    </h3>


                    <div class="bet-choices">

                        ${choices.map(
                            choice => `

                                <button
                                    class="bet-choice-button"
                                    data-bet-id="${bet.id}"
                                    data-choice-id="${choice.id}"
                                >

                                    <span>
                                        ${escapeHtml(choice.label)}
                                    </span>

                                    <strong>
                                        ${Number(choice.odds).toFixed(2)}
                                    </strong>

                                </button>

                            `
                        ).join("")}

                    </div>

                `;


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


                        openBetModal(
                            bet,
                            choice
                        );

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

    currentBet = bet;

    currentChoice = choice;


    document.getElementById(
        "modal-question"
    ).textContent =
        bet.question;


    document.getElementById(
        "modal-choice"
    ).textContent =
        `${choice.label} — cote ${Number(choice.odds).toFixed(2)}`;


    document.getElementById(
        "stake-input"
    ).value = "";


    document.getElementById(
        "potential-win"
    ).textContent =
        "0 €";


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

        document.getElementById(
            "potential-win"
        ).textContent =
            "0 €";

        return;

    }


    const potentialWin =
        value *
        Number(currentChoice.odds);


    document.getElementById(
        "potential-win"
    ).textContent =
        formatMoney(potentialWin);

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


    if (!stake || stake <= 0) {

        errorElement.textContent =
            "Entre un montant valide.";

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
            On recharge le profil.
        */

        await loadCurrentProfile();


        /*
            On ferme la fenêtre.
        */

        document
            .getElementById("bet-modal")
            .classList.add("hidden");


        /*
            On recharge les paris et l'historique.
        */

        await displayBets();

        await displayMyBets();


        alert(
            "Pari enregistré !"
        );


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
                bets (
                    id,
                    question,
                    status,
                    winner_choice_id
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
                    Tu n'as encore placé aucun pari.
                </div>
            `;

            return;

        }


        data.forEach(
            stake => {

                const bet =
                    stake.bets;


                const choice =
                    stake.bet_choices;


                let statusText =
                    "En cours";


                if (
                    bet.status === "resolved"
                ) {

                    if (
                        bet.winner_choice_id ===
                        choice.id
                    ) {

                        statusText =
                            "Gagné";

                    } else {

                        statusText =
                            "Perdu";

                    }

                }


                const item =
                    document.createElement("div");


                item.className =
                    "my-bet-item";


                item.innerHTML = `

                    <div>

                        <h3>
                            ${escapeHtml(
                                bet.question
                            )}
                        </h3>

                        <p>
                            Choix :
                            <strong>
                                ${escapeHtml(
                                    choice.label
                                )}
                            </strong>
                        </p>

                        <p>
                            Mise :
                            ${formatMoney(
                                stake.stake
                            )}
                        </p>

                        <p>
                            Gain potentiel :
                            ${formatMoney(
                                stake.potential_win
                            )}
                        </p>

                    </div>


                    <div>

                        <strong>
                            ${statusText}
                        </strong>

                    </div>

                `;


                container.appendChild(item);

            }
        );


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


                item.className =
                    "my-bet-item";


                const choices =
                    bet.bet_choices || [];


                let resolveButton = "";


                if (
                    bet.status === "open"
                ) {

                    resolveButton = `

                        <button
                            class="primary-button resolve-button"
                            data-bet-id="${bet.id}"
                        >
                            Valider le résultat
                        </button>

                    `;

                }


                item.innerHTML = `

                    <div>

                        <h3>
                            ${escapeHtml(
                                bet.question
                            )}
                        </h3>


                        <p>
                            Statut :
                            <strong>
                                ${escapeHtml(
                                    bet.status
                                )}
                            </strong>
                        </p>


                        <div class="created-bet-choices">

                            ${choices.map(
                                choice => `

                                    <span>
                                        ${escapeHtml(
                                            choice.label
                                        )}
                                        —
                                        ${Number(
                                            choice.odds
                                        ).toFixed(2)}
                                    </span>

                                `
                            ).join("")}

                        </div>

                    </div>


                    <div>

                        ${resolveButton}

                    </div>

                `;


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

function openResolveModal(bet) {

    currentResolveBet = bet;


    document.getElementById(
        "resolve-question"
    ).textContent =
        bet.question;


    const container =
        document.getElementById(
            "resolve-choices"
        );


    container.innerHTML = "";


    bet.bet_choices.forEach(
        choice => {

            const button =
                document.createElement(
                    "button"
                );


            button.className =
                "primary-button";


            button.textContent =
                choice.label;


            button.addEventListener(
                "click",
                () => {

                    resolveBet(
                        bet.id,
                        choice.id
                    );

                }
            );


            container.appendChild(button);

        }
    );


    document.getElementById(
        "resolve-error"
    ).textContent = "";


    document
        .getElementById(
            "resolve-modal"
        )
        .classList.remove("hidden");

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

        await displayMyBets();

        await displayMyCreatedBets();


        alert(
            "Le pari a été validé."
        );


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


    const oddsTwo =
        Number(
            document.getElementById(
                "odds-two"
            ).value
        );


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

                status: "open"

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


        /*
            Retour vers les paris.
        */

        showPage("bets-page");


        await displayBets();

        await displayMyCreatedBets();


        alert(
            "Ton pari a été créé !"
        );


    } catch (error) {

        console.error(error);


        alert(
            error.message ||
            "Impossible de créer le pari."
        );

    }

}



/* =========================================================
   11. NAVIGATION
========================================================= */

function showPage(pageId) {

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

        await displayBets();

        await displayMyBets();

        await displayMyCreatedBets();

    } catch (error) {

        console.error(error);

        alert(
            "Impossible de charger ton compte."
        );

    }


    /*
        Navigation.
    */

    document
        .querySelectorAll(".nav-button")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    showPage(
                        button.dataset.page
                    );

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
            () => {

                showPage(
                    "create-page"
                );

            }
        );

    }


    /*
        Formulaire création.
    */

    const createForm =
        document.getElementById(
            "create-bet-form"
        );


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
        Mise à jour gain potentiel.
    */

    const stakeInput =
        document.getElementById(
            "stake-input"
        );


    if (stakeInput) {

        stakeInput.addEventListener(
            "input",
            updatePotentialWin
        );

    }


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