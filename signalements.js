/* =========================================================
   BETLAB — SIGNALER UN PARI SUSPECT (voir signalements.sql)

   Maquette Exemple-aide CLAUDE/demo-signaler-pari.html :
   - profil d'un joueur : bouton « 🚩 Signaler » en bas de chaque mise
     (simple ou combiné, en cours ou terminée), motif + détail facultatif ;
   - admin : pastille sur l'onglet Message et carte « Paris signalés »
     en haut de la page, avec « Annuler sa mise » ou « Garder » ;
   - celui qui a signalé reçoit la décision dans ses messages (player_notices).
========================================================= */


// Mises déjà signalées par moi : "stake:<id>" ou "combo:<id>".
let myBetReports = new Set();

let reportingItem = null;

let adminBetReports = [];

let reportCloseTimer = null;


async function setupBetReports() {

    if (currentProfile?.is_admin) {

        setupAdminBetReports();

        await displayAdminBetReports();

        // Les signalements arrivent à tout moment : pastille relue toutes les 2 minutes.
        setInterval(displayAdminBetReports, 120000);

        return;

    }

    setupReportModal();

    const { data, error } = await supabaseClient.rpc("my_bet_reports");

    if (error) {

        console.error("Signalements indisponibles (signalements.sql lancé ?)", error);

        return;

    }

    myBetReports = new Set((data || []).map(row => `${row.kind}:${row.target_id}`));

}



/* =========================================================
   CÔTÉ JOUEUR : BOUTON ET FENÊTRE DE SIGNALEMENT
========================================================= */

// Bouton en bas d'une mise du profil (pas sur ses propres mises, ni pour l'admin).
function reportButtonHtml(item, index, canReport) {

    if (!canReport || currentProfile?.is_admin || !item.targetId) {
        return "";
    }

    if (myBetReports.has(`${item.kind}:${item.targetId}`)) {
        return `<span class="pp-report done">🚩 Signalé</span>`;
    }

    return `<button type="button" class="pp-report" data-report-bet="${index}">🚩 Signaler</button>`;

}


function setupReportModal() {

    const modal = document.getElementById("report-modal");

    if (!modal) {
        return;
    }

    document.getElementById("close-report-modal").addEventListener("click", closeReportModal);

    document.getElementById("report-cancel").addEventListener("click", closeReportModal);

    document.getElementById("report-send").addEventListener("click", sendBetReport);

    // Le bouton « 🚩 Signaler » est dessiné dans le profil du joueur.
    document.getElementById("player-modal")?.addEventListener("click", event => {

        const button = event.target.closest("[data-report-bet]");

        if (!button) {
            return;
        }

        const item = playerProfileItems[Number(button.dataset.reportBet)];

        if (item) {
            openReportModal(item);
        }

    });

}


function openReportModal(item) {

    clearTimeout(reportCloseTimer);

    reportingItem = item;

    const name = playerProfileTarget?.username || "Ce joueur";

    document.getElementById("report-target").textContent = name;

    document.getElementById("report-recap").innerHTML = `
        ${item.legs.map(leg => `
            <div class="report-leg">
                <span>${escapeHtml(leg.question)} → <b>${escapeHtml(leg.label)}</b></span>
                <span class="report-odds">${oddsText(leg.odds)}</span>
            </div>
        `).join("")}
        <div class="report-stake">
            ${escapeHtml(name)} a misé <b>${formatMoney(Number(item.stake) || 0)}</b>${item.combo ? ` en combiné (cote <b>${oddsText(item.odds)}</b>)` : ""}
        </div>
    `;

    document.querySelector('input[name="report-reason"]').checked = true;

    document.getElementById("report-details").value = "";

    document.getElementById("report-error").textContent = "";

    const send = document.getElementById("report-send");

    send.disabled = false;

    send.textContent = "🚩 Signaler";

    document.getElementById("report-form").classList.remove("hidden");

    document.getElementById("report-done").classList.add("hidden");

    document.getElementById("report-modal").classList.remove("hidden");

}


function closeReportModal() {

    clearTimeout(reportCloseTimer);

    reportingItem = null;

    document.getElementById("report-modal").classList.add("hidden");

}


async function sendBetReport() {

    const item = reportingItem;

    const send = document.getElementById("report-send");

    if (!item || send.disabled) {
        return;
    }

    send.disabled = true;

    send.textContent = "Envoi…";

    const { error } = await supabaseClient.rpc("report_bet", {
        p_kind: item.kind,
        p_target: item.targetId,
        p_reason: document.querySelector('input[name="report-reason"]:checked')?.value || "Autre",
        p_details: document.getElementById("report-details").value.trim() || null
    });

    if (error) {

        console.error("Erreur report_bet :", error);

        send.disabled = false;

        send.textContent = "🚩 Signaler";

        document.getElementById("report-error").textContent =
            error.message || "Le signalement n'a pas pu être envoyé.";

        return;

    }

    myBetReports.add(`${item.kind}:${item.targetId}`);

    // Le bouton du profil devient « 🚩 Signalé ».
    document
        .querySelectorAll(`#player-modal [data-report-bet]`)
        .forEach(button => {

            const other = playerProfileItems[Number(button.dataset.reportBet)];

            if (other && myBetReports.has(`${other.kind}:${other.targetId}`)) {
                button.outerHTML = `<span class="pp-report done">🚩 Signalé</span>`;
            }

        });

    document.getElementById("report-form").classList.add("hidden");

    document.getElementById("report-done").classList.remove("hidden");

    reportCloseTimer = setTimeout(closeReportModal, 1800);

}



/* =========================================================
   CÔTÉ ADMIN : PASTILLE ET CARTE « PARIS SIGNALÉS »
========================================================= */

function setupAdminBetReports() {

    const box = document.getElementById("admin-reports-card");

    if (!box) {
        return;
    }

    box.addEventListener("click", event => {

        const button = event.target.closest("[data-report-decide]");

        if (button && !button.disabled) {
            decideBetReport(button);
        }

    });

}


async function displayAdminBetReports() {

    const box = document.getElementById("admin-reports-card");

    if (!box || !currentProfile?.is_admin) {
        return;
    }

    const { data, error } = await supabaseClient.rpc("admin_bet_reports");

    if (error) {

        console.error("Signalements indisponibles (signalements.sql lancé ?)", error);

        box.classList.add("hidden");

        return;

    }

    adminBetReports = data || [];

    const pending = adminBetReports.filter(report => report.pending);

    const done = adminBetReports.filter(report => !report.pending).slice(0, 5);

    document
        .getElementById("reports-nav-dot")
        ?.classList.toggle("hidden", pending.length === 0);

    box.classList.toggle("hidden", adminBetReports.length === 0);

    box.innerHTML = `
        <h2>
            🚩 Paris signalés
            ${pending.length ? `<span class="report-count">${pending.length} à traiter</span>` : ""}
        </h2>
        ${pending.length ? "" : `<p class="report-none">Aucun signalement à traiter.</p>`}
        ${pending.map(adminReportHtml).join("")}
        ${done.length ? `
            <p class="report-done-title">Déjà traités</p>
            ${done.map(adminReportHtml).join("")}
        ` : ""}
    `;

}


function adminReportHtml(report) {

    const index = adminBetReports.indexOf(report);

    const when = date => typeof toastTimeLabel === "function" ? toastTimeLabel(date) : "";

    const result = report.status === "cancelled"
        ? `<div class="report-result cancelled">🚫 Mise annulée et rendue</div>`
        : `<div class="report-result kept">✅ Mise gardée</div>`;

    return `
        <div class="report-row${report.pending ? "" : " decided"}">
            <div class="report-who">
                <b>${escapeHtml(report.reported || "—")}</b>
                · ${report.kind === "combo" ? "combiné" : "mise"} de <b>${formatMoney(Number(report.amount) || 0)}</b>
                ${report.group_name ? `<small>${escapeHtml(report.group_name)}</small>` : ""}
            </div>
            <div class="report-summary">${escapeHtml(report.summary)}</div>
            ${(report.reports || []).map(item => `
                <div class="report-why">
                    <b>${escapeHtml(item.reason)}</b>${item.details ? ` — ${escapeHtml(item.details)}` : ""}
                    <small>par ${escapeHtml(item.reporter)} ${when(item.created_at)}</small>
                </div>
            `).join("")}
            ${report.pending ? `
                <p class="report-error"></p>
                <div class="report-decide">
                    <button type="button" class="report-cancel-stake" data-report-decide="cancel" data-report-index="${index}">
                        🚫 Annuler sa mise
                    </button>
                    <button type="button" class="report-keep" data-report-decide="keep" data-report-index="${index}">
                        ✅ Garder
                    </button>
                </div>
            ` : result}
        </div>
    `;

}


// « Annuler sa mise » : premier clic « Confirmer ? » (4 s), second clic annule.
async function decideBetReport(button) {

    const report = adminBetReports[Number(button.dataset.reportIndex)];

    const cancel = button.dataset.reportDecide === "cancel";

    const row = button.closest(".report-row");

    const errorElement = row.querySelector(".report-error");

    if (!report) {
        return;
    }

    errorElement.textContent = "";

    if (cancel && !button.classList.contains("confirm")) {

        button.classList.add("confirm");

        button.textContent = "⚠️ Confirmer l'annulation ?";

        setTimeout(() => {

            if (button.isConnected && !button.disabled) {

                button.classList.remove("confirm");

                button.textContent = "🚫 Annuler sa mise";

            }

        }, 4000);

        return;

    }

    row.querySelectorAll("[data-report-decide]").forEach(other => {
        other.disabled = true;
    });

    const { error } = await supabaseClient.rpc("admin_decide_report", {
        p_kind: report.kind,
        p_target: report.target_id,
        p_cancel: cancel
    });

    if (error) {

        console.error("Erreur admin_decide_report :", error);

        errorElement.textContent = error.message || "La décision n'a pas pu être enregistrée.";

        row.querySelectorAll("[data-report-decide]").forEach(other => {
            other.disabled = false;
        });

        return;

    }

    await displayAdminBetReports();

    // Une mise annulée change les soldes et le classement.
    if (cancel) {

        await displayLeaderboard();

        await displayAdminBalances();

    }

}
