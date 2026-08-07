// ==========================================
// 1. CONFIGURACIÓN DE SUPABASE
// ==========================================
const supabaseUrl = 'https://wgqqbahoalozgfukioza.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndncXFiYWhvYWxvemdmdWtpb3phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNTA3OTYsImV4cCI6MjA5OTgyNjc5Nn0.v_kpYceS8ceIUBNaLLHjfyBeFA2Y3lDRy7Yn6cb5Uz8';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = null;
let saldo = 0; 

// ==========================================
// 2. VARIABLES DEL JUEGO
// ==========================================
let apuestaPreparada = 0; // Lo que el usuario va sumando con las fichas
let apuestaActual = 0;
let multiplicadorActual = 1.00;
let puntoDeChoque = 0;
let juegoActivo = false; 
let intervaloVuelo = null;
let apuestaRegistrada = 0; 
let enRondaActual = false;  
let yaCobro = false;        
let tiempoEspera = 10;
let intervaloContador = null;
let historialCaidas = [];

// ==========================================
// 3. LÓGICA DE AUTENTICACIÓN Y SALDOS
// ==========================================
async function verificarSesionYJugar() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        if (!session) {
            // MODO PRUEBA LOCAL: Si abres el archivo suelto y no hay sesión, 
            // no te bloquea. Te da un usuario falso y saldo para que puedas probarlo.
            console.warn("No hay sesión activa de Supabase. Iniciando en MODO PRUEBA...");
            document.getElementById("message").innerText = "Modo de prueba local activado";
            currentUser = { id: 'usuario_prueba_local' };
            saldo = 5000;
        } else {
            // MODO PRODUCCIÓN: Si hay sesión, busca tu saldo real en la base de datos
            currentUser = session.user;
            const { data: perfilData, error } = await supabaseClient
                .from('perfiles')
                .select('saldo')
                .eq('id', currentUser.id)
                .single();

            if (perfilData) {
                saldo = parseFloat(perfilData.saldo);
            } else {
                saldo = 10000; // Bono inicial si la cuenta es nueva
                await guardarSaldoEnBD(); 
            }
        }

        // Una vez que tenemos el saldo (real o de prueba), arrancamos el juego
        actualizarUI();
        ajustarCanvas();
        iniciarCuentaRegresiva();

    } catch (error) {
        console.error("Error fatal al conectar con Supabase:", error);
        document.getElementById("message").innerText = "Error de conexión con la Base de Datos.";
    }
}

async function guardarSaldoEnBD() {
    if(!currentUser || currentUser.id === 'usuario_prueba_local') return;
    await supabaseClient
        .from('perfiles')
        .upsert({ 
            id: currentUser.id, 
            saldo: saldo 
        });
}

function actualizarUI() {
    document.getElementById("balance-amount").innerText = saldo.toFixed(2);
}

// Iniciar sesión apenas carga la ventana
window.onload = verificarSesionYJugar;
window.onresize = ajustarCanvas;

// ==========================================
// 4. LÓGICA DE FICHAS Y APUESTAS
// ==========================================
function sumarApuesta(cantidad) {
    if (juegoActivo || tiempoEspera <= 0 || apuestaRegistrada > 0) return;
    
    if (saldo < apuestaPreparada + cantidad) {
        alert("¡No tienes suficientes créditos para colocar esta ficha!");
        return;
    }
    
    apuestaPreparada += cantidad;
    document.getElementById("bet-amount").innerText = apuestaPreparada;
}

function limpiarApuesta() {
    if (juegoActivo || apuestaRegistrada > 0) return;
    apuestaPreparada = 0;
    document.getElementById("bet-amount").innerText = apuestaPreparada;
}

function registrarApuestaJugador() {
    if (apuestaPreparada <= 0) {
        alert("Por favor, selecciona fichas para apostar.");
        return;
    }
    if (apuestaPreparada > saldo) {
        alert("No tienes suficientes fichas.");
        return;
    }

    apuestaRegistrada = apuestaPreparada;
    document.getElementById("btn-despegar").disabled = true; 
    document.getElementById("btn-clear").disabled = true;
    document.getElementById("chips-container").classList.add("disabled");
    actualizarTextoEspera();
}

// ==========================================
// 5. MOTOR DEL JUEGO (CRASH)
// ==========================================
function ajustarCanvas() {
    const canvas = document.getElementById("trail-canvas");
    const flightZone = document.getElementById("flight-zone");
    if (canvas && flightZone) {
        canvas.width = flightZone.clientWidth;
        canvas.height = flightZone.clientHeight;
    }
}

function iniciarCuentaRegresiva() {
    juegoActivo = false;
    enRondaActual = false;
    yaCobro = false;
    multiplicadorActual = 1.00;
    tiempoEspera = 10;
    apuestaRegistrada = 0;
    apuestaPreparada = 0;

    document.getElementById("bet-amount").innerText = "0";
    document.getElementById("multiplier-display").style.color = "#ffffff";
    document.getElementById("multiplier-display").innerText = "1.00x";
    
    document.getElementById("btn-retirarse").style.display = "none";
    document.getElementById("betting-section").style.display = "block";
    document.getElementById("btn-despegar").disabled = false;
    document.getElementById("btn-clear").disabled = false;
    document.getElementById("chips-container").classList.remove("disabled");
    
    document.getElementById("flight-zone").style.borderColor = "#3d3d5c";
    document.getElementById("message").style.color = "#b0b0cb";

    resetearAvion();
    limpiarCanvas(); 

    if (saldo <= 0) {
        saldo = 2000; // Bono de emergencia si se queda en 0
        guardarSaldoEnBD();
        actualizarUI();
    }

    actualizarTextoEspera();

    intervaloContador = setInterval(() => {
        tiempoEspera--;
        actualizarTextoEspera();

        if (tiempoEspera <= 0) {
            clearInterval(intervaloContador);
            comenzarVuelo(); 
        }
    }, 1000);
}

function actualizarTextoEspera() {
    if (apuestaRegistrada > 0) {
        document.getElementById("message").innerText = `Siguiente vuelo en ${tiempoEspera}s [Apuesta Confirmada: $${apuestaRegistrada}]`;
    } else {
        document.getElementById("message").innerText = `Siguiente vuelo en ${tiempoEspera}s. ¡Coloca tus fichas!`;
    }
}

function comenzarVuelo() {
    juegoActivo = true;
    document.getElementById("btn-despegar").disabled = true;
    document.getElementById("btn-clear").disabled = true;
    document.getElementById("chips-container").classList.add("disabled");

    if (apuestaRegistrada > 0) {
        enRondaActual = true;
        apuestaActual = apuestaRegistrada;
        saldo -= apuestaActual; // Descontamos el saldo al iniciar
        
        guardarSaldoEnBD(); // Guardamos el descuento en Supabase
        actualizarUI();
        
        document.getElementById("message").innerText = "¡El avión ha despegado! Cuidado...";
        
        document.getElementById("betting-section").style.display = "none";
        document.getElementById("btn-retirarse").style.display = "block";
        document.getElementById("btn-retirarse").disabled = false;
        document.getElementById("btn-retirarse").innerText = `COBRAR ($${(apuestaActual * multiplicadorActual).toFixed(0)})`;
    } else {
        document.getElementById("message").innerText = "Vuelo en progreso... (Modo Espectador)";
    }

    // Cálculo del punto de choque
    const azar = Math.random();
    if (azar < 0.12) {
        puntoDeChoque = 1.00;
    } else {
        let resultadoBusqueda = 0.99 / (1 - Math.random());
        puntoDeChoque = parseFloat(Math.max(1.01, resultadoBusqueda).toFixed(2));
        if (Math.random() > 0.985) {
            puntoDeChoque = parseFloat((2 + Math.random() * 5) * (puntoDeChoque)).toFixed(2);
        } else {
            if (puntoDeChoque > 4.5) {
                puntoDeChoque = parseFloat((2 + Math.random() * 2.5).toFixed(2));
            }
        }
    }
    
    intervaloVuelo = setInterval(actualizarVuelo, 100);
}

function actualizarVuelo() {
    let incremento = 0.01 + (multiplicadorActual * 0.005);
    multiplicadorActual = parseFloat((multiplicadorActual + incremento).toFixed(2));

    document.getElementById("multiplier-display").innerText = multiplicadorActual.toFixed(2) + "x";

    if (enRondaActual && !yaCobro) {
        let fichasActuales = Math.floor(apuestaActual * multiplicadorActual);
        document.getElementById("btn-retirarse").innerText = `COBRAR ($${fichasActuales})`;
    }

    const avion = document.getElementById("airplane");
    let xPorcentaje = Math.min((multiplicadorActual - 1) * 35, 75);
    let yPorcentaje = Math.min((multiplicadorActual - 1) * 30, 70);
    
    avion.style.left = `calc(${xPorcentaje}% + 20px)`;
    avion.style.bottom = `calc(${yPorcentaje}% + 20px)`;

    dibujarTrayectoria(xPorcentaje, yPorcentaje);

    if (multiplicadorActual >= puntoDeChoque) {
        explotarAvion();
    }
}

function dibujarTrayectoria(xPct, yPct) {
    const canvas = document.getElementById("trail-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let startX = 20 + 32; 
    let startY = canvas.height - 20 - 20; 
    let currentX = (canvas.width * (xPct / 100)) + 20 + 32;
    let currentY = canvas.height - ((canvas.height * (yPct / 100)) + 20 + 20);

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
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function explotarAvion() {
    clearInterval(intervaloVuelo);
    juegoActivo = false;

    document.getElementById("btn-retirarse").style.display = "none";

    if (enRondaActual && !yaCobro) {
        document.getElementById("multiplier-display").innerText = "💥 CRASHED";
        document.getElementById("multiplier-display").style.color = "#dc3545"; 
        document.getElementById("flight-zone").style.borderColor = "#dc3545";
        document.getElementById("message").style.color = "#dc3545";
        document.getElementById("message").innerText = `El avión se estrelló. Perdiste $${apuestaActual}.`;
    } else {
        document.getElementById("multiplier-display").innerText = "💥 FLEW AWAY";
        document.getElementById("multiplier-display").style.color = "#ffc107";
        document.getElementById("message").innerText = `El avión se estrelló en ${puntoDeChoque.toFixed(2)}x.`;
    }

    agregarAlHistorial(puntoDeChoque);
    terminarRonda();
}

function agregarAlHistorial(valor) {
    historialCaidas.unshift(valor);
    if (historialCaidas.length > 15) {
        historialCaidas.pop();
    }
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

function retirarse() {
    if (!juegoActivo || !enRondaActual || yaCobro) return;
    yaCobro = true;

    let fichasGanadas = Math.floor(apuestaActual * multiplicadorActual);
    saldo += fichasGanadas;

    guardarSaldoEnBD(); // Guardar ganancias en Supabase
    actualizarUI();

    document.getElementById("multiplier-display").style.color = "#28a745";
    document.getElementById("message").innerText = `¡Te retiraste a tiempo! Ganaste $${fichasGanadas} en ${multiplicadorActual.toFixed(2)}x.`;
    document.getElementById("btn-retirarse").disabled = true;
}

function terminarRonda() {
    setTimeout(iniciarCuentaRegresiva, 3000);
}

function resetearAvion() {
    const avion = document.getElementById("airplane");
    avion.style.left = "20px";
    avion.style.bottom = "20px";
}
