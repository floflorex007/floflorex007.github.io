/* =========================================================
   BETLAB
   Le perroquet (bas à droite de la page des paris)

   Animation reprise de « Perroquet v2 » (Claude Design).
   3 états :
     - attente : état de base, la tête suit la souris ;
     - gagné   : quand on récupère une carte gagnante ;
     - perdu   : quand on récupère une carte perdante.

   Utilisation : Parrot.win(), Parrot.lose(), Parrot.wait().
   Images : assets/perroquet/*.png
========================================================= */

const Parrot = (() => {

    const ASSETS = "assets/perroquet/";

    // Durée de l'état gagné / perdu avant le retour à l'attente.
    const HOLD_SECONDS = 4;


    let root = null;
    let inner = null;
    let pose = null;
    let R = null;

    let mode = "waiting";
    let mouse = null;
    let lastMove = -1e9;
    let parts = [];
    let shake = 0;
    let prevT = null;
    let holdTimer = null;

    const cur = { rot: 0, x: 0, y: 0, speed: 0 };
    const opacity = { waiting: 1, win: 0, lose: 0 };
    const enter = { waiting: -10, win: -10, lose: -10 };

    // Niveau d'attente (1 à 4) selon l'argent en jeu : le perroquet
    // est debout sur une pile de billets plus ou moins haute.
    let level = 1;
    const levelOpacity = [1, 0, 0, 0];
    const levelEnter = [-10, -10, -10, -10];

    // Centre de la tête (pour le regard) et amplitude du mouvement, par niveau.
    const HEAD_CENTER = [[222, 220], [209, 168], [218, 174], [257, 116]];
    const HEAD_SCALE = [1, 0.85, 0.85, 0.75];


    /*
        Outils d'animation.
    */

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const easeIn = t => t * t;
    const easeOut = t => 1 - Math.pow(1 - t, 3);
    const rnd = (a, b) => a + Math.random() * (b - a);

    // Interpolation entre des étapes [temps, valeur].
    function keyframes(t, keys) {

        if (t <= keys[0][0]) {
            return keys[0][1];
        }

        for (let i = 1; i < keys.length; i++) {

            const [t1, v1] = keys[i];
            const [t0, v0] = keys[i - 1];

            if (t <= t1) {
                return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0));
            }

        }

        return keys[keys.length - 1][1];

    }

    const POP = [[0, 0.9], [0.16, 1.05], [0.3, 0.98], [0.45, 1]];
    const BUBBLE = [[0, 0], [0.35, 0], [0.55, 1.12], [0.68, 0.95], [0.8, 1]];


    /*
        Construction du perroquet (repère 512 × 650, mis à l'échelle).
    */

    function build(container) {

        container.innerHTML = `
            <div class="parrot-inner">

                <div class="parrot-pose" data-pose="waiting">
                    <div class="parrot-mirror">

                        <!-- Niveau 1 : perroquet classique -->
                        <div class="parrot-level" data-level="1" style="transform-origin:256px 560px">
                            <img src="${ASSETS}wait-body.png" alt="" style="left:2px;top:119px;width:392px;height:441px">
                            <div data-ref="head1" class="parrot-head" style="left:2px;top:119px;width:392px;height:441px;transform-origin:288px 181px">
                                <img src="${ASSETS}wait-head.png" alt="Perroquet" style="left:0;top:0;width:392px;height:441px">
                            </div>
                            <img data-ref="lines1" src="${ASSETS}wait-lines.png" alt="" style="left:343px;top:109px;width:39px;height:42px;transform-origin:0 100%;opacity:0">
                        </div>

                        <!-- Niveau 2 : sur une petite pile de billets -->
                        <div class="parrot-level" data-level="2" style="opacity:0;visibility:hidden">
                            <img src="${ASSETS}l2-body.png" alt="" style="left:98px;top:73px;width:317px;height:542px">
                            <div data-ref="head2" class="parrot-head" style="left:98px;top:73px;width:317px;height:542px;transform-origin:205px 164px">
                                <img src="${ASSETS}l2-head.png" alt="Perroquet sur une petite pile" style="left:0;top:0;width:317px;height:542px">
                            </div>
                            <img data-ref="lines2" src="${ASSETS}l2-lines.png" alt="" style="left:98px;top:73px;width:317px;height:542px;opacity:0">
                        </div>

                        <!-- Niveau 3 : sur une pile moyenne -->
                        <div class="parrot-level" data-level="3" style="opacity:0;visibility:hidden">
                            <img src="${ASSETS}l3-body.png" alt="" style="left:82px;top:92px;width:348px;height:523px">
                            <div data-ref="head3" class="parrot-head" style="left:82px;top:92px;width:348px;height:523px;transform-origin:212px 142px">
                                <img src="${ASSETS}l3-head.png" alt="Perroquet sur une pile moyenne" style="left:0;top:0;width:348px;height:523px">
                            </div>
                            <img data-ref="lines3" src="${ASSETS}l3-lines.png" alt="" style="left:82px;top:92px;width:348px;height:523px;opacity:0">
                        </div>

                        <!-- Niveau 4 : sur une énorme pile -->
                        <div class="parrot-level" data-level="4" style="opacity:0;visibility:hidden">
                            <img src="${ASSETS}l4-body.png" alt="" style="left:56px;top:15px;width:400px;height:600px">
                            <div data-ref="head4" class="parrot-head" style="left:56px;top:15px;width:400px;height:600px;transform-origin:199px 156px">
                                <img src="${ASSETS}l4-head.png" alt="Perroquet sur une énorme pile" style="left:0;top:0;width:400px;height:600px">
                            </div>
                            <img data-ref="lines4" src="${ASSETS}l4-lines.png" alt="" style="left:56px;top:15px;width:400px;height:600px;opacity:0">
                        </div>

                    </div>
                </div>

                <div class="parrot-pose" data-pose="win" style="opacity:0;visibility:hidden">
                    <img src="${ASSETS}win-main.png" alt="Pari gagné" class="parrot-win-main" style="left:2px;top:71px;width:508px;height:562px">
                    <img data-ref="winLines" src="${ASSETS}win-lines.png" alt="" style="left:254px;top:59px;width:117px;height:189px">
                    <img data-ref="winBubble" src="${ASSETS}win-bubble.png" alt="Bravo ! Tu as gagné !" style="left:321px;top:36px;width:171px;height:146px;transform-origin:9px 140px">
                </div>

                <div class="parrot-pose" data-pose="lose" style="opacity:0;visibility:hidden">
                    <img src="${ASSETS}lose-main.png" alt="Pari perdu" style="left:25px;top:95px;width:442px;height:489px">
                    <img data-ref="loseLines" src="${ASSETS}lose-lines.png" alt="" style="left:374px;top:245px;width:40px;height:47px;transform-origin:0 100%">
                    <img data-ref="loseBubble" src="${ASSETS}lose-bubble.png" alt="Tant pis… la prochaine fois !" style="left:335px;top:36px;width:156px;height:157px;transform-origin:62px 150px">
                </div>

                <div data-ref="fx" class="parrot-fx"></div>

            </div>
        `;

        const ref = name => container.querySelector(`[data-ref="${name}"]`);

        inner = container.querySelector(".parrot-inner");

        pose = {
            waiting: container.querySelector('[data-pose="waiting"]'),
            win: container.querySelector('[data-pose="win"]'),
            lose: container.querySelector('[data-pose="lose"]')
        };

        R = {
            levels: [1, 2, 3, 4].map(n => container.querySelector(`[data-level="${n}"]`)),
            heads: [1, 2, 3, 4].map(n => ref("head" + n)),
            lines: [1, 2, 3, 4].map(n => ref("lines" + n)),
            winBubble: ref("winBubble"),
            winLines: ref("winLines"),
            loseBubble: ref("loseBubble"),
            loseLines: ref("loseLines"),
            fx: ref("fx")
        };

    }


    function fit() {

        inner.style.transform = `scale(${root.clientWidth / 512})`;

    }


    /*
        Billets animés (gagné : ils s'envolent ; perdu : ils lui tombent dessus).
    */

    function bill() {

        const el = document.createElement("img");

        el.src = ASSETS + "win-bill2.png";
        el.alt = "";
        el.style.cssText = "left:0;top:0;width:114px;height:51px;margin:-25px 0 0 -57px;opacity:0";

        R.fx.appendChild(el);

        return el;

    }


    function trigger(newMode) {

        if (!root) {
            return;
        }

        clearTimeout(holdTimer);

        parts.forEach(p => p.el.remove());
        parts = [];
        R.fx.innerHTML = "";

        const now = performance.now() / 1000;

        enter[newMode] = now;
        mode = newMode;

        // Les billets ne sont plus lancés ici : ils volent entre le
        // perroquet et le solde (voir flyBills dans animations.js).

        if (newMode !== "waiting") {
            holdTimer = setTimeout(() => trigger("waiting"), HOLD_SECONDS * 1000);
        }

    }


    /*
        Boucle d'animation (respiration, regard, poses, billets).
    */

    function loop(ms) {

        requestAnimationFrame(loop);

        // Perroquet masqué (page Profil) : rien à animer.
        if (!root || root.classList.contains("parrot-hidden")) {
            prevT = null;
            return;
        }

        const now = ms / 1000;
        const dt = Math.min(0.05, now - (prevT ?? now));

        prevT = now;


        for (const m of ["waiting", "win", "lose"]) {
            const target = m === mode ? 1 : 0;
            opacity[m] += (target - opacity[m]) * (1 - Math.exp(-dt * (target ? 14 : 20)));
        }


        // Regard : suit la souris, ou balaie l'écran si elle ne bouge plus.
        const rect = root.getBoundingClientRect();
        const scale = rect.width / 512 || 1;
        const idle = ms - lastMove > 2500 || !mouse;

        let tx;
        let ty;

        if (idle) {
            tx = 222 + Math.sin(now * 0.5) * 240;
            ty = 150 + Math.sin(now * 0.37 + 1) * 150;
        } else {
            tx = (mouse.x - rect.left) / scale;
            ty = (mouse.y - rect.top) / scale;
        }

        const [headX, headY] = HEAD_CENTER[level - 1];
        const dx = headX - tx;
        const dy = ty - headY;

        const target = {
            rot: clamp(dy * 0.02, -6, 6),
            x: clamp(dx * 0.02, -8, 8),
            y: clamp(dy * 0.012, -5, 5)
        };

        const k = 1 - Math.exp(-dt * (idle ? 3 : 9));

        for (const key in target) {
            cur[key] += (target[key] - cur[key]) * k;
        }

        cur.speed *= Math.exp(-dt * 2.5);

        const breath = Math.sin(now * 2.3);


        // Attente
        {
            const sc = keyframes(now - enter.waiting, POP);
            const p = pose.waiting;

            p.style.opacity = opacity.waiting.toFixed(3);
            p.style.visibility = opacity.waiting < 0.01 ? "hidden" : "visible";
            p.style.transform = `scale(${sc * (1 - breath * 0.004)},${sc * (1 + breath * 0.008)})`;

            const lines = clamp(cur.speed * 1.6, 0, 1);

            // Fondu entre les 4 niveaux, avec un petit « pop » au changement.
            for (let i = 0; i < 4; i++) {

                const target = i === level - 1 ? 1 : 0;

                levelOpacity[i] += (target - levelOpacity[i]) * (1 - Math.exp(-dt * (target ? 14 : 20)));

                const el = R.levels[i];

                el.style.opacity = levelOpacity[i].toFixed(3);
                el.style.visibility = levelOpacity[i] < 0.01 ? "hidden" : "visible";
                el.style.transform = `scale(${keyframes(now - levelEnter[i], POP)})`;

                const hs = HEAD_SCALE[i];

                R.heads[i].style.transform = `translate(${cur.x * hs}px,${(cur.y + breath * 1.2) * hs}px) rotate(${cur.rot * hs}deg)`;

                // Niveau 4 : les traits brillent en continu (grosse pile !).
                const base = i === 3 ? 0.55 + 0.45 * Math.max(0, Math.sin(now * 5)) : 0;

                R.lines[i].style.opacity = Math.max(lines, base).toFixed(2);
                R.lines[i].style.transform = i === 0
                    ? `translate(${cur.x}px,${cur.y}px) scale(${0.7 + lines * 0.4})`
                    : `translate(${cur.x * hs}px,${cur.y * hs}px)`;

            }
        }


        // Gagné
        {
            const te = now - enter.win;
            const sc = keyframes(te, POP);
            const bob = Math.abs(Math.sin(now * 4.2));
            const p = pose.win;

            p.style.opacity = opacity.win.toFixed(3);
            p.style.visibility = opacity.win < 0.01 ? "hidden" : "visible";
            p.style.transform = `translateY(${-bob * 6}px) scale(${sc * (1 - bob * 0.012)},${sc * (1 + bob * 0.015)})`;

            R.winBubble.style.transform = `translateY(${Math.sin(now * 1.8) * 4}px) scale(${keyframes(te, BUBBLE)}) rotate(${Math.sin(now * 1.3) * 2}deg)`;
            R.winLines.style.opacity = Math.sin(now * 9) > -0.2 ? 1 : 0.25;
        }


        // Perdu
        {
            const te = now - enter.lose;
            const sc = keyframes(te, POP);

            shake *= Math.exp(-dt * 8);

            const sh = Math.sin(now * 40) * shake;
            const p = pose.lose;

            p.style.opacity = opacity.lose.toFixed(3);
            p.style.visibility = opacity.lose < 0.01 ? "hidden" : "visible";
            p.style.transform = `rotate(${Math.sin(now * 1.6) * 1.3 + sh}deg) scale(${sc * (1 - breath * 0.004)},${sc * (1 + breath * 0.008)})`;

            R.loseBubble.style.transform = `translateY(${Math.sin(now * 1.7) * 4}px) scale(${keyframes(te, BUBBLE)}) rotate(${Math.sin(now * 1.1) * 2}deg)`;

            const w = Math.sin(now * 6);

            R.loseLines.style.transform = `rotate(${w * 8}deg) scale(${1 + w * 0.08})`;
            R.loseLines.style.opacity = (0.6 + 0.4 * Math.abs(w)).toFixed(2);
        }


        // Billets
        parts = parts.filter(p => {

            const t = (now - p.t0) / p.dur;

            if (t < 0) {
                return true;
            }

            if (t >= 1) {
                if (p.hit) {
                    shake = Math.min(3, shake + 1.6);
                }
                p.el.remove();
                return false;
            }

            const e = p.ez(t);
            const u = 1 - e;
            const x = u * u * p.p0.x + 2 * u * e * p.p1.x + e * e * p.p2.x;
            const y = u * u * p.p0.y + 2 * u * e * p.p1.y + e * e * p.p2.y;
            const o = t < p.fade[0] ? t / p.fade[0] : t > p.fade[1] ? 1 - (t - p.fade[1]) / (1 - p.fade[1]) : 1;
            const sc = p.s0 + (p.s1 - p.s0) * e;
            const flip = Math.cos(now * 8 + p.t0 * 13) * 0.35 + 0.65;

            p.el.style.opacity = o.toFixed(3);
            p.el.style.transform = `translate(${x}px,${y}px) rotate(${p.r0 + (p.r1 - p.r0) * e}deg) scale(${sc},${sc * flip})`;

            return true;

        });

    }


    function init() {

        root = document.getElementById("parrot");

        if (!root) {
            return;
        }

        build(root);

        new ResizeObserver(fit).observe(root);
        fit();

        window.addEventListener("mousemove", event => {

            const n = performance.now();

            if (mouse) {
                const speed = Math.hypot(event.clientX - mouse.x, event.clientY - mouse.y) / Math.max(1, n - lastMove);
                cur.speed = Math.max(cur.speed, clamp(speed / 2.5, 0, 1));
            }

            mouse = { x: event.clientX, y: event.clientY };
            lastMove = n;

        });

        // Arrivée sur la page : petit « pop » d'apparition en attente.
        enter.waiting = performance.now() / 1000;

        requestAnimationFrame(loop);

    }


    document.addEventListener("DOMContentLoaded", init);


    // Change le niveau d'attente (1 à 4).
    function setLevel(n) {

        n = clamp(Math.round(Number(n)) || 1, 1, 4);

        if (n === level) {
            return;
        }

        levelEnter[n - 1] = performance.now() / 1000;
        level = n;

    }


    // Un billet le touche : le perroquet tremble (état perdu).
    function hit() {

        shake = Math.min(3, shake + 1.6);

    }


    // Position à l'écran de la liasse de billets (départ / arrivée des billets).
    function billsPoint() {

        const rect = root.getBoundingClientRect();

        const scale = rect.width / 512;

        return {
            x: rect.left + 335 * scale,
            y: rect.top + 370 * scale
        };

    }


    return {
        wait: () => trigger("waiting"),
        win: () => trigger("win"),
        lose: () => trigger("lose"),
        hit,
        billsPoint,
        level: setLevel,
        HOLD_SECONDS
    };

})();
