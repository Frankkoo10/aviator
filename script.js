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

// Variables de Sincronización Global Dinámica
const WAIT_TIME_MS = 15000;      // 15 segundos en la pista
const CRASH_DELAY_MS = 5000;     // 5 segundos mostrando la explosión
const GLOBAL_EPOCH = 1750000000000; // Fecha base para sincronizar a todos los jugadores

let estadoActual = '';           // 'WAITING', 'FLYING', 'CRASHED'
let currentRoundId = -1;
let roundStartTime = 0;          // Cuándo empezó la ronda actual
let roundCrashTime = 0;          // Cuánto dura el vuelo actual
let roundPuntoChoque = 1.00;     // En cuánto choca

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
// 4. LÓGICA DE FICHAS Y APUESTAS
// ==========================================
function sumarApuesta(cantidad) {
    if ((estadoActual !== 'WAITING' && estadoActual !== 'CRASHED') || apuestaRegistrada > 0) return;
    
    if (saldo < apuestaPreparada + cantidad) {
        alert("¡No tienes suficientes créditos para colocar esta ficha!");
        return;
    }
    
    apuestaPreparada += cantidad;
    document.getElementById("bet-amount").innerText = apuestaPreparada;
}

function limpiarApuesta() {
    if ((estadoActual !== 'WAITING' && estadoActual !== 'CRASHED') || apuestaRegistrada > 0) return;
    apuestaPreparada = 0;
    document.getElementById("bet-amount").innerText = apuestaPreparada;
}

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
    saveBet(currentRoundId + 1, apuestaRegistrada); // Guarda para la ronda que viene (o actual si está en espera)

    // Cambiamos el botón Limpiar por Cancelar
    const btnClear = document.getElementById("btn-clear");
    btnClear.disabled = false;
    btnClear.innerText = "Cancelar";
    btnClear.onclick = cancelarApuesta;
}

async function cancelarApuesta() {
    if (estadoActual !== 'WAITING' && estadoActual !== 'CRASHED') return;
    
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

function sincronizarConElMundo() {
    let now = Date.now();
    let elapsed = now - GLOBAL_EPOCH;
    
    let rId = 0;
    let accTime = 0;
    
    while(true) {
        let cp = calcularPuntoChoque(rId);
        let fTime = (Math.log(cp) / 0.25) * 1000;
        if (fTime > 28000) fTime = 28000;
        if (cp < 1.00) cp = 1.00;
        
        let duration = WAIT_TIME_MS + fTime + CRASH_DELAY_MS;
        
        if (accTime + duration > elapsed) {
            currentRoundId = rId;
            roundStartTime = GLOBAL_EPOCH + accTime;
            roundCrashTime = fTime;
            roundPuntoChoque = cp;
            break;
        }
        accTime += duration;
        rId++;
    }
}

function iniciarJuegoSincronizado() {
    sincronizarConElMundo();
    
    let nowMs = Date.now();
    let savedBet = getSavedBet();
    
    if (savedBet && savedBet.roundId === currentRoundId) {
        let timeInCycleMs = nowMs - roundStartTime;
        if (timeInCycleMs < WAIT_TIME_MS) {
            apuestaRegistrada = savedBet.amount;
        } else {
            let timeFlyingMs = timeInCycleMs - WAIT_TIME_MS;
            if (timeFlyingMs < roundCrashTime) {
                apuestaActual = savedBet.amount;
                enRondaActual = true;
            } else {
                clearSavedBet();
            }
        }
    } else if (savedBet) {
        clearSavedBet();
    }

    generarHistorialInicial(currentRoundId);
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
    
    while (nowMs > roundStartTime + WAIT_TIME_MS + roundCrashTime + CRASH_DELAY_MS) {
        roundStartTime += (WAIT_TIME_MS + roundCrashTime + CRASH_DELAY_MS);
        currentRoundId++;
        
        roundPuntoChoque = calcularPuntoChoque(currentRoundId);
        roundCrashTime = (Math.log(roundPuntoChoque) / 0.25) * 1000;
        if (roundCrashTime > 28000) {
            roundCrashTime = 28000;
            roundPuntoChoque = parseFloat(Math.exp(0.25 * 28).toFixed(2));
        }
        if (roundPuntoChoque < 1.00) roundPuntoChoque = 1.00;
        
        enRondaActual = false;
        yaCobro = false;
        if (estadoActual !== 'WAITING' && estadoActual !== 'CRASHED') apuestaRegistrada = 0; 
        
        generarHistorialInicial(currentRoundId);
    }

    let timeInCycleMs = nowMs - roundStartTime;

    if (timeInCycleMs >= WAIT_TIME_MS && apuestaRegistrada > 0) {
        apuestaActual = apuestaRegistrada;
        apuestaRegistrada = 0;
        enRondaActual = true;
        const btnClear = document.getElementById("btn-clear");
        btnClear.innerText = "Limpiar";
        btnClear.onclick = limpiarApuesta;
    }

    if (timeInCycleMs < WAIT_TIME_MS) {
        if (estadoActual !== 'WAITING') transitionToWaiting();
        let secsLeft = Math.ceil((WAIT_TIME_MS - timeInCycleMs) / 1000);
        actualizarTextoEspera(secsLeft);
    } else if (timeInCycleMs < WAIT_TIME_MS + roundCrashTime) {
        if (estadoActual !== 'FLYING') transitionToFlying();
        let timeFlyingMs = timeInCycleMs - WAIT_TIME_MS;
        let multi = Math.max(1.00, Math.exp(0.25 * (timeFlyingMs / 1000)));
        actualizarVueloUI(multi);
    } else {
        if (estadoActual !== 'CRASHED') transitionToCrashed(roundPuntoChoque);
        let secsToReset = Math.ceil(( (WAIT_TIME_MS + roundCrashTime + CRASH_DELAY_MS) - timeInCycleMs ) / 1000);
        document.getElementById("message").innerText = `💥 Reiniciando pista en ${secsToReset}s... ¡Prepara tus fichas!`;
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
    requestAnimationFrame(