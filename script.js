// ==========================================
// 1. CONFIGURACIÓN DE SUPABASE Y LOCALSTORAGE
// ==========================================
const supabaseUrl = 'https://wgqqbahoalozgfukioza.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndncXFiYWhvYWxvemdmdWtpb3phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNTA3OTYsImV4cCI6MjA5OTgyNjc5Nn0.v_kpYceS8ceIUBNaLLHjfyBeFA2Y3lDRy7Yn6cb5Uz8';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

const STORAGE_KEY = 'aviator_bet_state';

function getSavedBet() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : null;
    } catch (e) { return null; }
}

function saveBet(roundId, amount) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ roundId, amount }));
}

function clearSavedBet() {
    localStorage.removeItem(STORAGE_KEY);
}

let currentUser = null;
let saldo = 0;
let campoSaldoUsuario = 'saldo';

async function obtenerPerfilUsuario() {
    const { data, error } = await supabaseClient
        .from('perfiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle();

    if (error && error.code !== 'PGRST116') {
        throw error;
    }
    return data;
}

// ==========================================
// 2. VARIABLES DEL JUEGO (MODO EN VIVO)
// ==========================================
let apuestaPreparada = 0; 
let apuestaActual = 0;
let multiplicadorMostrado = 1.00;
let apuestaRegistrada = 0; 
let enRondaActual = false;  
let yaCobro = false;        
let historialCaidas = [];

// Variables de Sincronización Global
const CYCLE_LENGTH_MS = 45000; // Ciclo total de la ronda: 45 segundos
const WAIT_TIME_MS = 15000;    // Tiempo de espera para apostar: 15 segundos
let estadoActual = '';         // 'WAITING', 'FLYING', 'CRASHED'
let currentRoundId = -1;

// ==========================================
// 3. LÓGICA DE AUTENTICACIÓN Y SALDOS
// ==========================================
async function verificarSesionYJugar() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        if (!session) {
            console.warn("No hay sesión activa de Supabase. Iniciando en MODO PRUEBA...");
            currentUser = { id: 'usuario_prueba_local' };
            saldo = 5000;
        } else {
            currentUser = session.user;
            const perfilData = await obtenerPerfilUsuario();

            if (perfilData) {
                campoSaldoUsuario = 'saldo';
                saldo = parseFloat(perfilData.saldo ?? 0);
            } else {
                campoSaldoUsuario = 'saldo';
                saldo = 10000; 
                await guardarSaldoEnBD(); 
            }
        }

        actualizarUI();
        ajustarCanvas();
        
        // Iniciamos el motor global sincronizado
        iniciarJuegoSincronizado();

    } catch (error) {
        console.error("Error fatal al conectar con Supabase:", error);
        document.getElementById("message").innerText = "Error de conexión con la Base de Datos.";
    }
}

async function guardarSaldoEnBD() {
    if (!currentUser || currentUser.id === 'usuario_prueba_local') return;
    const payload = { id: currentUser.id };
    payload[campoSaldoUsuario] = saldo;
    await supabaseClient.from('perfiles').upsert(payload);
}

function actualizarUI() {
    document.getElementById("balance-amount").innerText = saldo.toFixed(2);
}

window.onload = verificarSesionYJugar;
window.onresize = ajustarCanvas;

// ==========================================
// 4. LÓGICA DE FICHAS Y APUESTAS (NUEVA CON PERSISTENCIA)
// ==========================================
function sumarApuesta(cantidad) {
    if (estadoActual !== 'WAITING' || apuestaRegistrada > 0) return;
    
    if (saldo < apuestaPreparada + cantidad) {
        alert("¡No tienes suficientes créditos para colocar esta ficha!");
        return;
    }
    
    apuestaPreparada += cantidad;
    document.getElementById("bet-amount").innerText = apuestaPreparada;
}

function limpiarApuesta() {
    if (estadoActual !== 'WAITING' || apuestaRegistrada > 0) return;
    apuestaPreparada = 0;
    document.getElementById("bet-amount").innerText = apuestaPreparada;
}

// NUEVO: La plata se descuenta apenas apostás y queda guardada por si cerrás.
async function registrarApuestaJugador() {
    if (apuestaPreparada <= 0) {
        alert("Por favor, selecciona fichas para apostar.");
        return;
    }
    if (apuestaPreparada > saldo) {
        alert("No tienes suficientes fichas.");
        return;
    }

    apuestaRegistrada = apuestaPreparada;
    saldo -= apuestaRegistrada;
    actualizarUI(); 

    // Bloqueamos mientras guardamos en base de datos
    document.getElementById("btn-despegar").disabled = true; 
    document.getElementById("btn-clear").disabled = true;
    document.getElementById("chips-container").classList.add("disabled");

    await guardarSaldoEnBD(); 
    saveBet(currentRoundId, apuestaRegistrada); 

    // Cambiamos el botón Limpiar por Cancelar
    const btnClear = document.getElementById("btn-clear");
    btnClear.disabled = false;
    btnClear.innerText = "Cancelar";
    btnClear.onclick = cancelarApuesta;
}

// NUEVO: Devuelve la plata si te arrepentís antes de que vuele.
async function cancelarApuesta() {
    if (estadoActual !== 'WAITING') return;
    
    let amountToRefund = apuestaRegistrada;
    apuestaRegistrada = 0;
    apuestaPreparada = 0;
    clearSavedBet();
    
    saldo += amountToRefund;
    actualizarUI();
    
    const btnClear = document.getElementById("btn-clear");
    btnClear.disabled = true; 
    
    await guardarSaldoEnBD();

    document.getElementById("bet-amount").innerText = "0";
    document.getElementById("btn-despegar").disabled = false;
    btnClear.disabled = false;
    btnClear.innerText = "Limpiar";
    btnClear.onclick = limpiarApuesta;
    document.getElementById("chips-container").classList.remove("disabled");
}

function restaurarUI_ApuestaRegistrada() {
    document.getElementById("btn-despegar").disabled = true; 
    const btnClear = document.getElementById("btn-clear");
    btnClear.disabled = false;
    btnClear.innerText = "Cancelar";
    btnClear.onclick = cancelarApuesta;
    document.getElementById("chips-container").classList.add("disabled");
    document.getElementById("bet-amount").innerText = apuestaRegistrada;
}

// ==========================================
// 5. MOTOR GLOBAL DEL JUEGO EN VIVO (DETERMINISTA)
// ==========================================

function mulberry32(a) {
    return function() {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

function calcularPuntoChoque(seed) {
    let rng = mulberry32(seed);
    rng(); rng(); rng(); 
    
    const azar = rng();
    if (azar < 0.12) {
        return 1.00;
    } else {
        let resultado = 0.99 / (1 - rng());
        let crash = Math.max(1.01, resultado);
        if (rng() > 0.985) {
            crash = crash * (2 + rng() * 5);
        } else if (crash > 4.5 && rng() > 0.5) {
            crash = 2 + rng() * 2.5;
        }
        return parseFloat(crash.toFixed(2));
    }
}

function iniciarJuegoSincronizado() {
    let nowMs = Date.now();
    let initialRound = Math.floor(nowMs / CYCLE_LENGTH_MS);
    currentRoundId = initialRound;
    
    // REVISAR APUESTAS PENDIENTES SI LA PÁGINA SE RECARGÓ
    let savedBet = getSavedBet();
    if (savedBet) {
        if (savedBet.roundId === initialRound) {
            let timeInCycleMs = nowMs % CYCLE_LENGTH_MS;
            if (timeInCycleMs < WAIT_TIME_MS) {
                apuestaRegistrada = savedBet.amount;
                // El saldo ya fue descontado en la sesión anterior
            } else {
                let cp = calcularPuntoChoque(initialRound);
                let crashTimeMs = (Math.log(cp) / 0.25) * 1000;
                if (crashTimeMs > 28000) crashTimeMs = 28000;
                
                let timeFlyingMs = timeInCycleMs - WAIT_TIME_MS;
                if (timeFlyingMs < crashTimeMs) {
                    apuestaActual = savedBet.amount;
                    enRondaActual = true;
                } else {
                    clearSavedBet();
                }
            }
        } else {
            // Apuesta de una ronda anterior y no cobró = PERDIDA.
            clearSavedBet();
        }
    }

    generarHistorialInicial(initialRound);
    requestAnimationFrame(loopGlobal);
}

function generarHistorialInicial(roundActual) {
    historialCaidas = [];
    for (let i = 1; i <= 10; i++) {
        let pastRoundId = roundActual - i;
        let cp = calcularPuntoChoque(pastRoundId);
        let crashTimeMs = (Math.log(cp) / 0.25) * 1000;
        if (crashTimeMs > 28000) cp = parseFloat(Math.exp(0.25 * 28).toFixed(2));
        if (cp < 1.00) cp = 1.00;
        historialCaidas.push(cp); 
    }
    renderizarHistorial();
}

function loopGlobal() {
    let nowMs = Date.now();
    
    let roundId = Math.floor(nowMs / CYCLE_LENGTH_MS);
    let timeInCycleMs = nowMs % CYCLE_LENGTH_MS;
    
    if (roundId !== currentRoundId) {
        if (currentRoundId !== -1 && (roundId - currentRoundId) > 1) {
            generarHistorialInicial(roundId);
        }
        currentRoundId = roundId;
        enRondaActual = false;
        yaCobro = false;
        if (estadoActual !== 'WAITING') apuestaRegistrada = 0; 
    }

    let puntoChoque = calcularPuntoChoque(roundId);
    let crashTimeMs = (Math.log(puntoChoque) / 0.25) * 1000;
    if (crashTimeMs > 28000) {
        crashTimeMs = 28000;
        puntoChoque = parseFloat(Math.exp(0.25 * 28).toFixed(2));
    }
    if (puntoChoque < 1.00) puntoChoque = 1.00;

    // Inicia el vuelo para los apostadores
    if (timeInCycleMs >= WAIT_TIME_MS && apuestaRegistrada > 0) {
        apuestaActual = apuestaRegistrada;
        apuestaRegistrada = 0;
        // NOTA: El saldo ya se dedujo al tocar 'Apostar'
        enRondaActual = true;
        
        // Volvemos el boton al estado normal para la próxima ronda
        const btnClear = document.getElementById("btn-clear");
        btnClear.innerText = "Limpiar";
        btnClear.onclick = limpiarApuesta;
    }

    if (timeInCycleMs < WAIT_TIME_MS) {
        if (estadoActual !== 'WAITING') transitionToWaiting();
        let secsLeft = Math.ceil((WAIT_TIME_MS - timeInCycleMs) / 1000);
        actualizarTextoEspera(secsLeft);
    } else if (timeInCycleMs < WAIT_TIME_MS + crashTimeMs) {
        if (estadoActual !== 'FLYING') transitionToFlying();
        let timeFlyingMs = timeInCycleMs - WAIT_TIME_MS;
        let multi = Math.max(1.00, Math.exp(0.25 * (timeFlyingMs / 1000)));
        actualizarVueloUI(multi);
    } else {
        if (estadoActual !== 'CRASHED') transitionToCrashed(puntoChoque);
    }

    requestAnimationFrame(loopGlobal);
}

// ==========================================
// 6. TRANSICIONES DE ESTADO Y UI
// ==========================================

function transitionToWaiting() {
    estadoActual = 'WAITING';
    enRondaActual = false;
    yaCobro = false;

    if (saldo <= 0 && !getSavedBet()) {
        saldo = 2000;
        guardarSaldoEnBD();
        actualizarUI();
    }

    document.getElementById("btn-retirarse").style.display = "none";
    document.getElementById("betting-section").style.display = "block";
    
    if (apuestaRegistrada <= 0) {
        document.getElementById("btn-despegar").disabled = false;
        const btnClear = document.getElementById("btn-clear");
        btnClear.disabled = false;
        btnClear.innerText = "Limpiar";
        btnClear.onclick = limpiarApuesta;
        document.getElementById("chips-container").classList.remove("disabled");
        document.getElementById("bet-amount").innerText = "0";
        apuestaPreparada = 0;
    } else {
        restaurarUI_ApuestaRegistrada();
    }

    document.getElementById("multiplier-display").style.color = "#ffffff";
    document.getElementById("multiplier-display").innerText = "1.00x";
    document.getElementById("flight-zone").style.borderColor = "#3d3d5c";
    document.getElementById("message").style.color = "#b0b0cb";

    resetearAvion();
    limpiarCanvas();
    requestAnimationFrame(ajustarCanvas);
}

function transitionToFlying() {
    estadoActual = 'FLYING';
    document.getElementById("btn-despegar").disabled = true;
    document.getElementById("btn-clear").disabled = true;
    document.getElementById("chips-container").classList.add("disabled");

    if (enRondaActual) {
        document.getElementById("betting-section").style.display = "none";
        document.getElementById("btn-retirarse").style.display = "block";
        document.getElementById("btn-retirarse").disabled = false;
        document.getElementById("btn-retirarse").innerText = `COBRAR ($${apuestaActual})`;
        document.getElementById("message").innerText = "¡El avión ha despegado! Cuidado...";
    } else {
        document.getElementById("message").innerText = "Vuelo en progreso... (Modo Espectador)";
    }
    requestAnimationFrame(ajustarCanvas);
}

function transitionToCrashed(crashPoint) {
    estadoActual = 'CRASHED';
    document.getElementById("btn-retirarse").style.display = "none";
    document.getElementById("betting-section").style.display = "block";

    document.getElementById("btn-despegar").disabled = false;
    const btnClear = document.getElementById("btn-clear");
    btnClear.disabled = false;
    btnClear.innerText = "Limpiar";
    btnClear.onclick = limpiarApuesta;
    document.getElementById("chips-container").classList.remove("disabled");

    if (enRondaActual && !yaCobro) {
        document.getElementById("multiplier-display").innerText = "💥 CRASHED";
        document.getElementById("multiplier-display").style.color = "#dc3545"; 
        document.getElementById("flight-zone").style.borderColor = "#dc3545";
        document.getElementById("message").style.color = "#dc3545";
        document.getElementById("message").innerText = `El avión se estrelló. Perdiste $${apuestaActual}.`;
        clearSavedBet();
    } else {
        document.getElementById("multiplier-display").innerText = "💥 FLEW AWAY";
        document.getElementById("multiplier-display").style.color = "#ffc107";
        document.getElementById("message").innerText = `El avión se estrelló en ${crashPoint.toFixed(2)}x.`;
    }
    
    enRondaActual = false; 
    
    historialCaidas.unshift(crashPoint); 
    if (historialCaidas.length > 15) historialCaidas.pop();
    renderizarHistorial();
    
    requestAnimationFrame(ajustarCanvas);
}

function actualizarTextoEspera(timeLeft) {
    if (apuestaRegistrada > 0) {
        document.getElementById("message").innerText = `Siguiente vuelo en ${timeLeft}s [Apuesta Confirmada: $${apuestaRegistrada}]`;
    } else {
        document.getElementById("message").innerText = `Siguiente vuelo en ${timeLeft}s. ¡Coloca tus fichas!`;
    }
}

function actualizarVueloUI(multi) {
    multiplicadorMostrado = multi;
    document.getElementById("multiplier-display").innerText = multi.toFixed(2) + "x";

    if (enRondaActual && !yaCobro) {
        let fichasActuales = Math.floor(apuestaActual * multi);
        document.getElementById("btn-retirarse").innerText = `COBRAR ($${fichasActuales})`;
    }

    const avion = document.getElementById("airplane");
    let xPorcentaje = Math.min((multi - 1) * 35, 75);
    let yPorcentaje = Math.min((multi - 1) * 30, 70);
    
    avion.style.left = `calc(${xPorcentaje}% + 20px)`;
    avion.style.bottom = `calc(${yPorcentaje}% + 20px)`;

    dibujarTrayectoria(xPorcentaje, yPorcentaje);
}

// ==========================================
// 7. FUNCIONES VISUALES Y EVENTO COBRAR
// ==========================================

async function retirarse() {
    if (estadoActual !== 'FLYING' || !enRondaActual || yaCobro) return;
    yaCobro = true;

    let fichasGanadas = Math.floor(apuestaActual * multiplicadorMostrado);
    saldo += fichasGanadas;

    document.getElementById("btn-retirarse").disabled = true;
    
    await guardarSaldoEnBD(); 
    actualizarUI();
    clearSavedBet(); 

    document.getElementById("multiplier-display").style.color = "#28a745";
    document.getElementById("message").innerText = `¡Te retiraste a tiempo! Ganaste $${fichasGanadas} en ${multiplicadorMostrado.toFixed(2)}x.`;

    requestAnimationFrame(ajustarCanvas);
}

function renderizarHistorial() {
    const barraHistorial = document.getElementById("history-bar");
    barraHistorial.innerHTML = ""; 

    historialCaidas.forEach(multiplicador => {
        const item = document.createElement("span");
        item.classList.add("history-item");
        item.innerText = `${multiplicador.toFixed(2)}x`;
        if (multiplicador < 2.00) item.classList.add("history-low");    
        else if (multiplicador < 10.00) item.classList.add("history-medium"); 
        else item.classList.add("history-high");   
        barraHistorial.appendChild(item);
    });
}

function ajustarCanvas() {
    const canvas = document.getElementById("trail-canvas");
    const flightZone = document.getElementById("flight-zone");
    if (canvas && flightZone) {
        const ratio = window.devicePixelRatio || 1;
        const cssWidth = Math.max(0, flightZone.clientWidth);
        const cssHeight = Math.max(0, flightZone.clientHeight);

        canvas.style.width = cssWidth + "px";
        canvas.style.height = cssHeight + "px";

        canvas.width = Math.floor(cssWidth * ratio);
        canvas.height = Math.floor(cssHeight * ratio);

        const ctx = canvas.getContext("2d");
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        limpiarCanvas();
    }
}

function dibujarTrayectoria(xPct, yPct) {
    const canvas = document.getElementById("trail-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    let startX = 20 + 32;
    let startY = h - 20 - 20;
    let currentX = (w * (xPct / 100)) + 20 + 32;
    let currentY = h - ((h * (yPct / 100)) + 20 + 20);

    ctx.beginPath();
    ctx.strokeStyle = "#dc3545"; 
    ctx.lineWidth = 5;            
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#dc3545";

    ctx.moveTo(startX, startY);
    let controlX = startX + (currentX - startX) * 0.5;
    let controlY = startY; 

    ctx.quadraticCurveTo(controlX, controlY, currentX, currentY);
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function limpiarCanvas() {
    const canvas = document.getElementById("trail-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
}

function resetearAvion() {
    const avion = document.getElementById("airplane");
    avion.style.left = "20px";
    avion.style.bottom = "20px";
}