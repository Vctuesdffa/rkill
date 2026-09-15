(() => {
    const DIFFICULTIES = {
        easy:   { rows: 10, cols: 10, mines: 15  },
        medium: { rows: 16, cols: 16, mines: 40  },
        hard:   { rows: 20, cols: 20, mines: 80  },
        extreme:{ rows: 30, cols: 30, mines: 150 }
    };

    const CELL_SIZE = 28;
    const MAX_PARTICLES = 120;
    const COLORS = {
        1: '#00f0ff', 2: '#00ff88', 3: '#ff00ff', 4: '#ffff00',
        5: '#ff8800', 6: '#ff0044', 7: '#ff00ff', 8: '#ffffff'
    };

    let canvas, ctx;
    let board, rows, cols, totalMines;
    let cellSize, offsetX, offsetY;
    let gameState = 'idle';
    let flagCount = 0;
    let timer = 0;
    let timerInterval = null;
    let soundEnabled = true;
    let audioCtx = null;
    let particles = [];
    let hoverCell = { r: -1, c: -1 };
    let needsRedraw = true;
    let cachedGradient = null;
    let cachedFont = '';
    let records = {};
    try { records = JSON.parse(localStorage.getItem('minesweeper_records') || '{}'); } catch(e) {}

    // ---- Audio ----
    function getAudioCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
    }

    function playTone(freq, duration, type, volume) {
        if (!soundEnabled) return;
        try {
            const ac = getAudioCtx();
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ac.currentTime);
            gain.gain.setValueAtTime(volume, ac.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
            osc.connect(gain);
            gain.connect(ac.destination);
            osc.start(ac.currentTime);
            osc.stop(ac.currentTime + duration);
        } catch (e) {}
    }

    function sfxClick() { playTone(800, 0.08, 'square', 0.1); }
    function sfxOpen() { playTone(500, 0.15, 'sine', 0.1); }
    function sfxFlag() { playTone(1200, 0.06, 'triangle', 0.12); }
    function sfxExplosion() {
        playTone(80, 0.5, 'sawtooth', 0.25);
        setTimeout(function() { playTone(60, 0.4, 'sawtooth', 0.2); }, 100);
        setTimeout(function() { playTone(40, 0.3, 'sawtooth', 0.15); }, 200);
    }
    function sfxWin() {
        [523, 659, 784, 1047].forEach(function(f, i) {
            setTimeout(function() { playTone(f, 0.3, 'sine', 0.15); }, i * 150);
        });
    }

    // ---- Particles (no shadowBlur) ----
    function spawnExplosion(cx, cy) {
        var colors = ['#ff0044', '#ff8800', '#ffff00', '#ff00ff', '#00f0ff'];
        var count = Math.min(40, MAX_PARTICLES - particles.length);
        for (var i = 0; i < count; i++) {
            var angle = Math.random() * Math.PI * 2;
            var speed = Math.random() * 5 + 1;
            particles.push({
                x: cx, y: cy,
                color: colors[(Math.random() * colors.length) | 0],
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 30 + (Math.random() * 20) | 0,
                maxLife: 50,
                size: 2 + Math.random() * 3
            });
        }
    }

    function spawnRevealEffect(cx, cy) {
        var count = Math.min(4, MAX_PARTICLES - particles.length);
        for (var i = 0; i < count; i++) {
            var angle = Math.random() * Math.PI * 2;
            var speed = Math.random() * 2 + 0.5;
            particles.push({
                x: cx, y: cy,
                color: '#00f0ff',
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 15 + (Math.random() * 8) | 0,
                maxLife: 23,
                size: 1 + Math.random() * 1.5
            });
        }
    }

    function updateParticles() {
        for (var i = particles.length - 1; i >= 0; i--) {
            var p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.05;
            p.life--;
            if (p.life <= 0) {
                particles[i] = particles[particles.length - 1];
                particles.length--;
            }
        }
    }

    function drawParticles() {
        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];
            var alpha = p.life / p.maxLife;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - p.size * alpha * 0.5, p.y - p.size * alpha * 0.5, p.size * alpha, p.size * alpha);
        }
        ctx.globalAlpha = 1;
    }

    // ---- Board ----
    function createBoard() {
        board = [];
        for (let r = 0; r < rows; r++) {
            board[r] = [];
            for (let c = 0; c < cols; c++) {
                board[r][c] = {
                    mine: false, revealed: false, flagged: false,
                    neighbors: 0, revealProgress: 0, shake: 0
                };
            }
        }
    }

    function placeMines(safeR, safeC) {
        let placed = 0;
        while (placed < totalMines) {
            const r = Math.floor(Math.random() * rows);
            const c = Math.floor(Math.random() * cols);
            if (board[r][c].mine) continue;
            if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue;
            board[r][c].mine = true;
            placed++;
        }
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (board[r][c].mine) continue;
                let count = 0;
                forNeighbors(r, c, (nr, nc) => {
                    if (board[nr][nc].mine) count++;
                });
                board[r][c].neighbors = count;
            }
        }
    }

    function forNeighbors(r, c, fn) {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) fn(nr, nc);
            }
        }
    }

    function reveal(r, c) {
        const cell = board[r][c];
        if (cell.revealed || cell.flagged) return;
        cell.revealed = true;
        cell.revealProgress = 0;
        const px = offsetX + c * cellSize + cellSize / 2;
        const py = offsetY + r * cellSize + cellSize / 2;
        spawnRevealEffect(px, py);

        if (cell.mine) {
            sfxExplosion();
            spawnExplosion(px, py);
            gameOver(false);
            return;
        }

        sfxOpen();
        if (cell.neighbors === 0) {
            forNeighbors(r, c, (nr, nc) => reveal(nr, nc));
        }
        checkWin();
    }

    function toggleFlag(r, c) {
        const cell = board[r][c];
        if (cell.revealed) return;
        cell.flagged = !cell.flagged;
        flagCount += cell.flagged ? 1 : -1;
        sfxFlag();
        updateUI();
        needsRedraw = true;
    }

    function chordReveal(r, c) {
        const cell = board[r][c];
        if (!cell.revealed || cell.neighbors === 0) return;
        let flagCountNear = 0;
        forNeighbors(r, c, (nr, nc) => {
            if (board[nr][nc].flagged) flagCountNear++;
        });
        if (flagCountNear === cell.neighbors) {
            forNeighbors(r, c, (nr, nc) => {
                if (!board[nr][nc].flagged && !board[nr][nc].revealed) {
                    reveal(nr, nc);
                }
            });
        }
    }

    function checkWin() {
        let unrevealed = 0;
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++)
                if (!board[r][c].revealed) unrevealed++;
        if (unrevealed === totalMines) gameOver(true);
    }

    function gameOver(won) {
        gameState = won ? 'won' : 'lost';
        clearInterval(timerInterval);
        if (won) sfxWin();

        if (!won) {
            for (let r = 0; r < rows; r++)
                for (let c = 0; c < cols; c++)
                    if (board[r][c].mine) board[r][c].revealed = true;
        }
        needsRedraw = true;

        var overlay = document.getElementById('game-over-overlay');
        var title = document.getElementById('overlay-title');
        var msg = document.getElementById('overlay-message');

        if (won) {
            title.textContent = 'ПОБЕДА!';
            title.style.color = '#00ff88';
            title.style.textShadow = '0 0 20px #00ff88, 0 0 40px #00ff88';
            msg.textContent = 'Время: ' + timer + ' сек | Сложность: ' + getDiffLabel();
            saveRecord(timer);
        } else {
            title.textContent = 'ИГРА ОКОНЧЕНА';
            title.style.color = '#ff0044';
            title.style.textShadow = '0 0 20px #ff0044, 0 0 40px #ff0044';
            msg.textContent = 'Вы наступили на мину!';
        }
        overlay.classList.remove('hidden');
    }

    function getDiffLabel() {
        var sel = document.getElementById('difficulty').value;
        return { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный', extreme: 'Экстрим' }[sel] || '';
    }

    function saveRecord(time) {
        var diff = document.getElementById('difficulty').value;
        if (!records[diff] || time < records[diff]) {
            records[diff] = time;
            try { localStorage.setItem('minesweeper_records', JSON.stringify(records)); } catch(e) {}
        }
        renderRecords();
    }

    function renderRecords() {
        var list = document.getElementById('records-list');
        if (!list) return;
        list.innerHTML = '';
        var labels = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный', extreme: 'Экстрим' };
        for (var diff in labels) {
            if (records[diff]) {
                var el = document.createElement('div');
                el.className = 'record-item';
                el.textContent = labels[diff] + ': ' + records[diff] + 'с';
                list.appendChild(el);
            }
        }
    }

    // ---- Timer ----
    function startTimer() {
        timer = 0;
        clearInterval(timerInterval);
        timerInterval = setInterval(function() {
            timer++;
            document.getElementById('timer').textContent = String(timer).padStart(3, '0');
        }, 1000);
    }

    function updateUI() {
        document.getElementById('mine-count').textContent = totalMines - flagCount;
        document.getElementById('flag-count').textContent = flagCount;
    }

    // ---- Cached gradient ----
    function buildGradient() {
        var grad = ctx.createLinearGradient(0, 0, 0, cellSize);
        grad.addColorStop(0, '#2a2a6a');
        grad.addColorStop(0.5, '#1e1e50');
        grad.addColorStop(1, '#151540');
        cachedGradient = grad;
    }

    // ---- Rendering ----
    function drawBoard() {
        if (!ctx || !board) return;

        // Check if anything animating
        var hasAnim = false;
        if (particles.length > 0) hasAnim = true;
        if (!hasAnim) {
            for (var r = 0; r < rows && !hasAnim; r++) {
                for (var c = 0; c < cols && !hasAnim; c++) {
                    var cl = board[r][c];
                    if (cl.revealProgress < 1 && cl.revealed) hasAnim = true;
                    if (cl.shake > 0) hasAnim = true;
                }
            }
        }
        if (!hasAnim && !needsRedraw) return;
        needsRedraw = false;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background
        ctx.fillStyle = '#060612';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid lines - batch into one path
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (var r = 0; r <= rows; r++) {
            ctx.moveTo(offsetX, offsetY + r * cellSize);
            ctx.lineTo(offsetX + cols * cellSize, offsetY + r * cellSize);
        }
        for (var c = 0; c <= cols; c++) {
            ctx.moveTo(offsetX + c * cellSize, offsetY);
            ctx.lineTo(offsetX + c * cellSize, offsetY + rows * cellSize);
        }
        ctx.stroke();

        // Cells
        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
                var cell = board[r][c];
                var x = offsetX + c * cellSize;
                var y = offsetY + r * cellSize;

                if (cell.revealed && cell.revealProgress < 1) {
                    cell.revealProgress += 0.08;
                    needsRedraw = true;
                }

                var shakeX = 0, shakeY = 0;
                if (cell.shake > 0) {
                    shakeX = (Math.random() - 0.5) * cell.shake;
                    shakeY = (Math.random() - 0.5) * cell.shake;
                    cell.shake *= 0.9;
                    if (cell.shake < 0.3) cell.shake = 0;
                    needsRedraw = true;
                }

                ctx.save();
                ctx.translate(shakeX, shakeY);

                if (!cell.revealed) {
                    drawUnrevealedCell(x, y, r, c);
                } else {
                    drawRevealedCell(x, y, cell);
                }

                ctx.restore();
            }
        }

        // Hover highlight
        if (hoverCell.r >= 0 && hoverCell.c >= 0) {
            var hc = board[hoverCell.r][hoverCell.c];
            if (!hc.revealed) {
                var hx = offsetX + hoverCell.c * cellSize;
                var hy = offsetY + hoverCell.r * cellSize;
                ctx.fillStyle = 'rgba(0, 240, 255, 0.12)';
                ctx.fillRect(hx + 1, hy + 1, cellSize - 2, cellSize - 2);
                ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(hx + 1, hy + 1, cellSize - 2, cellSize - 2);
            }
        }
    }

    function drawUnrevealedCell(x, y, r, c) {
        var cell = board[r][c];
        var pad = 1;
        var inner = cellSize - pad * 2;

        // Use cached gradient
        if (!cachedGradient) buildGradient();
        ctx.fillStyle = cachedGradient;
        ctx.fillRect(x + pad, y + pad, inner, inner);

        // Top highlight
        ctx.fillStyle = 'rgba(0, 240, 255, 0.1)';
        ctx.fillRect(x + pad, y + pad, inner, inner * 0.4);

        // Border glow
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(x + pad, y + pad, inner, inner);

        // Corner accent
        ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
        ctx.fillRect(x + pad, y + pad, 3, 3);
        ctx.fillRect(x + pad + inner - 3, y + pad, 3, 3);

        // Flag
        if (cell.flagged) {
            var cx = x + cellSize / 2;
            var cy = y + cellSize / 2;
            var s = cellSize * 0.35;

            ctx.strokeStyle = '#ccc';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy - s);
            ctx.lineTo(cx, cy + s);
            ctx.stroke();

            ctx.fillStyle = '#ff0044';
            ctx.beginPath();
            ctx.moveTo(cx, cy - s);
            ctx.lineTo(cx + s * 0.9, cy - s * 0.5);
            ctx.lineTo(cx, cy);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#999';
            ctx.fillRect(cx - s * 0.5, cy + s, s, 3);
        }
    }

    function drawRevealedCell(x, y, cell) {
        var pad = 1;
        var inner = cellSize - pad * 2;
        var progress = cell.revealProgress;
        if (progress > 1) progress = 1;

        ctx.fillStyle = '#080818';
        ctx.fillRect(x + pad, y + pad, inner, inner);

        ctx.strokeStyle = 'rgba(0, 240, 255, 0.06)';
        ctx.lineWidth = 0.3;
        ctx.strokeRect(x + pad, y + pad, inner, inner);

        if (progress < 1) {
            // Simple fade-in instead of clip
            ctx.globalAlpha = progress;
            if (cell.mine) {
                drawMineRaw(x, y);
            } else if (cell.neighbors > 0) {
                drawNumberRaw(x, y, cell.neighbors);
            }
            ctx.globalAlpha = 1;
            return;
        }

        if (cell.mine) {
            drawMineRaw(x, y);
        } else if (cell.neighbors > 0) {
            drawNumberRaw(x, y, cell.neighbors);
        }
    }

    function drawMineRaw(x, y) {
        var cx = x + cellSize / 2;
        var cy = y + cellSize / 2;
        var s = cellSize * 0.3;

        ctx.fillStyle = '#ff0044';
        ctx.beginPath();
        ctx.arc(cx, cy, s, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#ff0044';
        ctx.lineWidth = 2;
        for (var i = 0; i < 8; i++) {
            var angle = (i / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * s * 0.5, cy + Math.sin(angle) * s * 0.5);
            ctx.lineTo(cx + Math.cos(angle) * s * 1.4, cy + Math.sin(angle) * s * 1.4);
            ctx.stroke();
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.arc(cx - s * 0.25, cy - s * 0.25, s * 0.25, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawNumberRaw(x, y, num) {
        var cx = x + cellSize / 2;
        var cy = y + cellSize / 2;
        var color = COLORS[num] || '#fff';

        ctx.fillStyle = color;
        if (cachedFont !== cellSize) {
            cachedFont = cellSize;
            ctx.font = 'bold ' + (cellSize * 0.55) + 'px Orbitron, sans-serif';
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(num, cx, cy + 1);
    }

    // ---- Input ----
    function getCellFromPos(clientX, clientY) {
        if (!canvas) return null;
        var rect = canvas.getBoundingClientRect();
        var scaleX = canvas.width / rect.width;
        var scaleY = canvas.height / rect.height;
        var mx = (clientX - rect.left) * scaleX;
        var my = (clientY - rect.top) * scaleY;
        var c = Math.floor((mx - offsetX) / cellSize);
        var r = Math.floor((my - offsetY) / cellSize);
        if (r >= 0 && r < rows && c >= 0 && c < cols) return { r: r, c: c };
        return null;
    }

    function handleLeftClick(clientX, clientY) {
        if (gameState !== 'playing' && gameState !== 'idle') return;
        var pos = getCellFromPos(clientX, clientY);
        if (!pos) return;
        var cell = board[pos.r][pos.c];

        if (gameState === 'idle') {
            gameState = 'playing';
            placeMines(pos.r, pos.c);
            startTimer();
        }

        if (cell.flagged) return;

        if (cell.revealed) {
            chordReveal(pos.r, pos.c);
            cell.shake = 4;
        } else {
            sfxClick();
            reveal(pos.r, pos.c);
        }
        needsRedraw = true;
    }

    function handleRightClick(clientX, clientY) {
        if (gameState !== 'playing' && gameState !== 'idle') return;
        var pos = getCellFromPos(clientX, clientY);
        if (!pos) return;
        toggleFlag(pos.r, pos.c);
    }

    function onCanvasClick(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        handleLeftClick(e.clientX, e.clientY);
    }

    function onCanvasContextMenu(e) {
        e.preventDefault();
        handleRightClick(e.clientX, e.clientY);
    }

    function onCanvasMouseMove(e) {
        var pos = getCellFromPos(e.clientX, e.clientY);
        var prev = hoverCell;
        hoverCell = pos || { r: -1, c: -1 };
        if (prev.r !== hoverCell.r || prev.c !== hoverCell.c) {
            needsRedraw = true;
        }
    }

    function onCanvasMouseLeave() {
        hoverCell = { r: -1, c: -1 };
        needsRedraw = true;
    }

    // ---- Touch support ----
    var touchStartTime = 0;
    var touchStartPos = null;
    var longPressTimer = null;

    function onTouchStart(e) {
        e.preventDefault();
        var touch = e.touches[0];
        touchStartTime = Date.now();
        touchStartPos = { x: touch.clientX, y: touch.clientY };

        longPressTimer = setTimeout(function() {
            handleRightClick(touch.clientX, touch.clientY);
            longPressTimer = null;
        }, 500);
    }

    function onTouchMove(e) {
        e.preventDefault();
        if (longPressTimer) {
            var touch = e.touches[0];
            var dx = touch.clientX - touchStartPos.x;
            var dy = touch.clientY - touchStartPos.y;
            if (Math.sqrt(dx*dx + dy*dy) > 10) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }
    }

    function onTouchEnd(e) {
        e.preventDefault();
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
            if (touchStartPos) {
                handleLeftClick(touchStartPos.x, touchStartPos.y);
            }
        }
    }

    // ---- Resize ----
    function resizeCanvas() {
        if (!canvas || !rows || !cols) return;
        var maxW = window.innerWidth - 40;
        var maxH = window.innerHeight - 280;
        var maxCellW = Math.floor(maxW / cols);
        var maxCellH = Math.floor(maxH / rows);
        cellSize = Math.max(16, Math.min(CELL_SIZE, maxCellW, maxCellH));

        canvas.width = cols * cellSize + 2;
        canvas.height = rows * cellSize + 2;
        offsetX = 1;
        offsetY = 1;

        cachedGradient = null;
        cachedFont = '';
        needsRedraw = true;
    }

    // ---- Init ----
    function newGame() {
        var diff = document.getElementById('difficulty').value;
        var cfg = DIFFICULTIES[diff];
        if (!cfg) return;
        rows = cfg.rows;
        cols = cfg.cols;
        totalMines = cfg.mines;

        gameState = 'idle';
        flagCount = 0;
        timer = 0;
        particles = [];
        clearInterval(timerInterval);

        createBoard();
        resizeCanvas();
        updateUI();
        document.getElementById('timer').textContent = '000';
        document.getElementById('game-over-overlay').classList.add('hidden');
    }

    function animate() {
        try {
            updateParticles();
            drawBoard();
            if (particles.length > 0) {
                drawParticles();
            }
        } catch (e) {
            console.error('Render error:', e);
        }
        requestAnimationFrame(animate);
    }

    function init() {
        canvas = document.getElementById('game-canvas');
        if (!canvas) {
            console.error('Canvas element not found!');
            return;
        }
        ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error('Failed to get 2d context!');
            return;
        }

        canvas.addEventListener('click', onCanvasClick);
        canvas.addEventListener('contextmenu', onCanvasContextMenu);
        canvas.addEventListener('mousemove', onCanvasMouseMove);
        canvas.addEventListener('mouseleave', onCanvasMouseLeave);

        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd, { passive: false });

        document.getElementById('new-game-btn').addEventListener('click', newGame);
        document.getElementById('overlay-restart').addEventListener('click', function() {
            document.getElementById('game-over-overlay').classList.add('hidden');
            newGame();
        });
        document.getElementById('difficulty').addEventListener('change', newGame);
        document.getElementById('sound-btn').addEventListener('click', function() {
            soundEnabled = !soundEnabled;
            document.getElementById('sound-btn').textContent = soundEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
        });

        window.addEventListener('resize', function() {
            resizeCanvas();
        });

        newGame();
        animate();
        renderRecords();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
