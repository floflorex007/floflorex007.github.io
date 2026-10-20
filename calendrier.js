/* =========================================================
   BETLAB — CALENDRIER DES RÉCOMPENSES DE SÉRIE (voir calendrier-serie.sql)

   Maquette Exemple-aide CLAUDE/demo-calendrier-serie.html (choix du
   2026-10-19) : dans la fenêtre Flamme, un chemin de jours. Chaque jour de
   série donne une récompense (pièces, XP, bouclier, et la caisse au
   7e jour) ; elles grossissent chaque semaine (×1,5, ×2, ×2,5). Un jour
   raté sans bouclier remet la série, donc le calendrier, au jour 1.
   La récompense du jour se prend avec le bouton « Prendre » ; tant
   qu'elle attend, une pastille rouge brille sur la flamme.
========================================================= */


// L'XP du calendrier : une orbe violette (dessinée en CSS, .xp-orb).
const XP_ORB = `<span class="xp-orb" aria-hidden="true"></span>`;

// Réponse de streak_calendar : jour de série, jours du chemin, récompense prise…
let streakCalendar = null;

let streakClaiming = false;


async function loadStreakCalendar() {

    const { data, error } = await supabaseClient.rpc("streak_calendar");

    // Récompense en train d'être prise (roulette de la caisse) : on ne redessine pas dessous.
    if (streakClaiming) {
        return;
    }

    if (error) {

        console.error("Calendrier de série indisponible (calendrier-serie.sql lancé ?)", error);

        return;

    }

    streakCalendar = data;

    renderStreakCalendar();

    markStreakRewardReady();

}


function streakRewardReady() {

    return Boolean(streakCalendar?.checked_today && !streakCalendar.claimed_today);

}


// Pastille rouge sur la flamme (barre du haut) et sur la carte « Ta série ».
function markStreakRewardReady() {

    const ready = streakRewardReady();

    ["streak-widget", "streak-sidebar"].forEach(id => {

        const element = document.getElementById(id);

        element?.classList.toggle("streak-reward-ready", ready);

        if (element && ready) {
            element.title = "Ta récompense de série t'attend : clique pour la prendre !";
        }

    });

}


// Icône (HTML) et texte d'une récompense (ce que la base prévoit, ou ce qu'elle a donné).
function streakRewardParts(reward) {

    const parts = [];

    if (reward.chest) {

        const won = reward.win && typeof COSMETICS !== "undefined"
            ? COSMETICS.find(item => item.id === reward.win.item)
            : null;

        parts.push(won
            ? { icon: chestIcon(won, reward.win.option), text: chestLabel(won, reward.win.option) }
            : { icon: "🎁", text: "Caisse" });

    }

    if (reward.coins > 0) {
        parts.push({ icon: "🪙", text: "+" + reward.coins });
    }

    if (reward.xp > 0) {
        parts.push({ icon: XP_ORB, text: "+" + reward.xp + " XP" });
    }

    if (reward.shields > 0) {
        parts.push({ icon: "🛡️", text: reward.shields > 1 ? reward.shields + " boucliers" : "Bouclier" });
    }

    return parts;

}


function streakRewardHtml(reward) {

    return streakRewardParts(reward)
        .map(part => part.icon + " " + escapeHtml(part.text))
        .join(" + ");

}


function streakDayHtml(entry) {

    const calendar = streakCalendar;

    const today = entry.day === calendar.day;

    const done = entry.day < calendar.day || (today && calendar.claimed_today);

    const ready = today && streakRewardReady();

    // Jour pris : ce qui a vraiment été donné (bouclier changé en pièces, article de la caisse…).
    const reward = today && calendar.claimed_today && calendar.reward ? calendar.reward : entry;

    const [part] = streakRewardParts(reward);

    const classes = [
        "streak-day",
        entry.chest ? "streak-day-big" : "",
        done ? "streak-day-done" : "",
        today ? "streak-day-today" : "",
        ready ? "streak-day-ready" : ""
    ].filter(Boolean).join(" ");

    return `
        <div
            class="${classes}"
            data-streak-day="${entry.day}"
        >
            <span class="streak-day-n">Jour ${entry.day}</span>
            <span class="streak-day-icon">${part ? part.icon : "🎁"}</span>
            <span class="streak-day-amount">${escapeHtml(part ? part.text : "")}</span>
            ${ready ? `<button type="button" class="streak-day-claim" data-streak-claim>Prendre</button>` : ""}
        </div>
    `;

}


function renderStreakCalendar() {

    const box = document.getElementById("streak-calendar");

    if (!box || !streakCalendar) {
        return;
    }

    const calendar = streakCalendar;

    const forgotten = calendar.forgotten && !calendar.claimed_today
        ? `🎁 Récompense oubliée du jour ${calendar.forgotten.day} (${streakRewardHtml(calendar.forgotten)}) : donnée avec celle d'aujourd'hui.`
        : "";

    const notCounted = calendar.checked_today
        ? ""
        : "Ta connexion du jour n'est pas encore comptée : recharge la page.";

    // Seulement les cas particuliers (récompense oubliée, connexion pas comptée).
    const info = [forgotten, notCounted].filter(Boolean).join("<br>");

    // Le chemin garde sa position si on le redessine pendant qu'on le regarde.
    const scroll = box.querySelector(".streak-calendar-path")?.scrollLeft;

    box.innerHTML = `
        <div class="streak-calendar-path">
            <div class="streak-calendar-track">
                ${calendar.days.map(streakDayHtml).join("")}
            </div>
        </div>
        <div
            id="streak-chest"
            class="streak-chest hidden"
        ></div>
        ${info ? `<p class="streak-calendar-info">${info}</p>` : ""}
        <p
            id="streak-calendar-message"
            class="streak-calendar-message"
        ></p>
    `;

    const path = box.querySelector(".streak-calendar-path");

    if (scroll !== undefined) {
        path.scrollLeft = scroll;
    } else {
        scrollStreakCalendarToToday();
    }

}


// Aujourd'hui en 2e position : on voit d'où l'on vient et ce qui arrive.
function scrollStreakCalendarToToday() {

    const path = document.querySelector("#streak-calendar .streak-calendar-path");

    const today = path?.querySelector(".streak-day-today");

    if (path && today) {
        path.scrollLeft = Math.max(0, today.offsetLeft - today.offsetWidth - 16);
    }

}


async function claimStreakReward(button) {

    if (streakClaiming || !currentGroup) {
        return;
    }

    streakClaiming = true;

    button.disabled = true;

    const cell = button.closest(".streak-day");

    const rect = cell.getBoundingClientRect();

    const pointsBefore = Number(currentProfile?.points || 0);

    const message = document.getElementById("streak-calendar-message");

    const { data, error } = await supabaseClient.rpc("claim_streak_reward", { p_group: currentGroup.id });

    if (error) {

        console.error("Erreur claim_streak_reward :", error);

        message.textContent = error.message || "Impossible de prendre la récompense.";

        message.classList.add("error");

        button.disabled = false;

        streakClaiming = false;

        return;

    }

    const given = [data.reward, data.forgotten].filter(Boolean);

    const total = key => given.reduce((sum, reward) => sum + (Number(reward[key]) || 0), 0);

    const coins = total("coins");

    const xp = total("xp");

    const shields = total("shields");

    streakCalendar.claimed_today = true;

    streakCalendar.reward = data.reward;

    streakCalendar.forgotten = null;

    renderStreakCalendar();

    markStreakRewardReady();

    document
        .querySelector(`#streak-calendar [data-streak-day="${data.reward.day}"]`)
        ?.classList.add("streak-day-pop");

    const notes = [];

    if (data.forgotten) {
        notes.push(`🎁 Oubliée du jour ${data.forgotten.day} : ${streakRewardHtml(data.forgotten)}`);
    }

    if (given.some(reward => reward.shield_converted)) {
        notes.push("(tu avais déjà 3 boucliers : 40 🪙 à la place)");
    }

    if (given.some(reward => reward.chest_converted)) {
        notes.push("(tu as déjà tous les articles de la caisse : 100 🪙 à la place)");
    }

    const newMessage = document.getElementById("streak-calendar-message");

    newMessage.classList.remove("error");

    newMessage.innerHTML = notes.join("<br>");

    if (coins > 0 && currentProfile) {

        currentProfile.points = pointsBefore + coins;

        flyCoins(rect, coins, pointsBefore);

    }

    if (xp > 0) {

        flyXpOrbs(rect, xp).then(() => {

            floatXpGain(xp);

            refreshProgression();

        });

    }

    if (shields > 0) {

        streakState.shields += shields;

        renderStreakProtect();

    }

    if (data.reward.win) {
        await playStreakChest(data.reward.win);
    }

    // Article gagné (aujourd'hui ou oublié) : il apparaît dans la boutique.
    if (given.some(reward => reward.win)) {
        await loadCurrentProfile();
    }

    streakClaiming = false;

}


/*
    Orbes violettes qui partent de la case vers la jauge d'XP (comme les
    pièces vers leur compteur, flyCoins). Une orbe par 10 XP, 8 au plus.
*/
function flyXpOrbs(fromRect, xp) {

    const target = [document.querySelector(".level-sidebar"), document.getElementById("xp-mini")]
        .find(element => element && element.getClientRects().length > 0);

    if (!target || !fromRect) {
        return Promise.resolve();
    }

    const to = target.getBoundingClientRect();

    const startX = fromRect.left + fromRect.width / 2;

    const startY = fromRect.top + fromRect.height / 2;

    const count = Math.max(3, Math.min(8, Math.round(xp / 10)));

    const flights = Array.from({ length: count }, (_, index) => {

        const orb = document.createElement("span");

        orb.className = "xp-orb xp-orb-flying";

        orb.style.left = startX - 7 + "px";

        orb.style.top = startY - 7 + "px";

        document.body.appendChild(orb);

        const dx = to.left + to.width / 2 - startX;

        const dy = to.top + to.height / 2 - startY;

        // Chaque orbe s'écarte un peu au départ, puis file vers la jauge.
        const spreadX = (Math.random() - 0.5) * 70;

        const spreadY = -20 - Math.random() * 40;

        return orb.animate(
            [
                { transform: "translate(0, 0) scale(0.4)", opacity: 0 },
                { transform: `translate(${spreadX}px, ${spreadY}px) scale(1.15)`, opacity: 1, offset: 0.3 },
                { transform: `translate(${dx}px, ${dy}px) scale(0.6)`, opacity: 0.9 }
            ],
            { duration: 750 + index * 70, delay: index * 45, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "forwards" }
        ).finished.finally(() => orb.remove());

    });

    return Promise.allSettled(flights).then(() => bump(target));

}


/*
    Caisse du 7e jour : la roulette de la boutique (openRandomChest dans
    app.js), arrêtée sur l'article tiré par la base, puis « L'équiper ? ».
*/
async function playStreakChest(win) {

    const box = document.getElementById("streak-chest");

    const won = COSMETICS.find(item => item.id === win.item);

    if (!box || !won) {
        return;
    }

    const pool = chestPool();

    const cells = Array.from({ length: 45 }, () => chestCellHtml(chestDraw(pool.length ? pool : COSMETICS)));

    cells[40] = chestCellHtml(won, win.option);

    box.innerHTML = `
        <div class="rchest-window">
            <div class="rchest-needle"></div>
            <div class="rchest-strip">${cells.join("")}</div>
        </div>
        <p class="streak-chest-result"></p>
    `;

    box.classList.remove("hidden");

    const strip = box.querySelector(".rchest-strip");

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

    // Les clics du perroquet n'ont rien à équiper.
    const equip = win.item.startsWith("clic_perroquet")
        ? ""
        : `
            <span class="streak-chest-equip">
                <button type="button" class="rchest-equip-yes" data-streak-equip="${escapeHtml(win.item)}">✓ L'équiper</button>
                <button type="button" class="rchest-equip-no" data-streak-equip-later>Plus tard</button>
            </span>
        `;

    box.querySelector(".streak-chest-result").innerHTML =
        `${chestIcon(won, win.option)} Tu as gagné <b>${escapeHtml(chestLabel(won, win.option))}</b> · ${chestRarity(won.price)[1]} !${equip}`;

}


async function equipStreakChestItem(item, button) {

    button.disabled = true;

    const { error } = await supabaseClient.rpc("toggle_cosmetic", {
        p_group: currentGroup.id,
        p_item: item,
        p_on: true
    });

    const equip = button.closest(".streak-chest-equip");

    if (error) {

        console.error(error);

        button.disabled = false;

        equip.insertAdjacentHTML("beforeend", `<small class="streak-chest-error">${escapeHtml(error.message || "Impossible d'équiper l'article.")}</small>`);

        return;

    }

    await unequipConflicts(item);

    equip.textContent = "✓ Équipé !";

    await loadCurrentProfile();

    if (typeof displayLeaderboard === "function") {
        await displayLeaderboard();
    }

    if (typeof displayBets === "function") {
        await displayBets({ quiet: true });
    }

}


function setupStreakCalendar() {

    const box = document.getElementById("streak-calendar");

    if (!box) {
        return;
    }

    box.addEventListener("click", event => {

        const claim = event.target.closest("[data-streak-claim]");

        if (claim) {

            claimStreakReward(claim);

            return;

        }

        // Clic sur la case du jour elle-même : comme le bouton.
        if (event.target.closest(".streak-day-ready") && !streakClaiming) {

            const button = box.querySelector("[data-streak-claim]");

            if (button) {
                claimStreakReward(button);
            }

            return;

        }

        const equip = event.target.closest("[data-streak-equip]");

        if (equip) {

            equipStreakChestItem(equip.dataset.streakEquip, equip);

            return;

        }

        if (event.target.closest("[data-streak-equip-later]")) {
            event.target.closest(".streak-chest-equip").textContent = "Il t'attend dans la boutique.";
        }

    });

    // Fenêtre Flamme ouverte (setupStreakModal, animations.js) : chemin à jour, centré sur aujourd'hui.
    document.getElementById("streak-widget")?.addEventListener("click", () => {

        if (streakClaiming) {
            return;
        }

        renderStreakCalendar();

        requestAnimationFrame(scrollStreakCalendarToToday);

        loadStreakCalendar();

    });

}

document.addEventListener("DOMContentLoaded", setupStreakCalendar);
