// --- CONFIGURATION ET INITIALISATION ---

// Configuration par défaut des temps d'étirement (min 30s/45s)
const defaultStretchingTimers = {
    mollet: 30, fente: 45, pigeon: 45, torsion: 60, pec: 30, delto: 30
};

// Configuration par défaut des temps d'abdos (MINIMUM FIXÉ À 30S)
const defaultAbdosTimers = {
    crunch_classique: 30, russion_twist: 30, crunch_papillon: 30, crunch_bras: 30, ciseaux: 30, chandelle: 30
};

// NOUVEAU: Configuration par défaut des répétitions de Force Natation (Minimum de 10)
const defaultForceReps = {
    'pompes-force': 48,
    'tractions-force': 32
};
const minRepsForce = 10; // Minimum plafonné à 10


// On combine tous les temps par défaut
const defaultTimers = {...defaultStretchingTimers, ...defaultAbdosTimers};

// Chargement des données sauvegardées
let savedTimers = JSON.parse(localStorage.getItem('stretchingTimers'));
let currentTimers = {...defaultTimers, ...savedTimers}; 

let savedReps = JSON.parse(localStorage.getItem('forceReps'));
let currentReps = {...defaultForceReps, ...savedReps}; 

// Variable globale pour stocker temporairement les données TCX lues
let tcxDataToSave = null; 


// Au lancement, on met à jour l'affichage des temps/reps dans le HTML
function initTimers() {
    for (const [key, value] of Object.entries(currentTimers)) {
        document.querySelectorAll(`#time-${key}`).forEach(el => {
            if(el) el.innerText = value;
        });
    }
    
    // Mise à jour des répétitions
    for (const [key, value] of Object.entries(currentReps)) {
        const el = document.getElementById(`rep-${key}`);
        if(el) el.innerText = value;
    }
    
    // Initialisation du bouton TCX pour la sauvegarde manuelle
    document.getElementById('tcxSaveButton').addEventListener('click', saveTcxSession);
    
    // Initialisation du formulaire de saisie manuelle de la course
    document.getElementById('form-running-manual').addEventListener('submit', saveManualRunningSession);
}

// Fonction utilitaire pour convertir les secondes en HH:MM:SS
function formatTime(totalSeconds) {
    if (totalSeconds < 0 || isNaN(totalSeconds)) return '00h 00min 00s';
    
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.round(totalSeconds % 60);
    
    const pad = (num) => String(num).padStart(2, '0');
    
    return `${pad(hours)}h ${pad(minutes)}min ${pad(seconds)}s`;
}

// Fonction utilitaire clé : convertit l'allure arrondie (MM:SS) en Vitesse (m/s)
const convertPaceToSpeed = (paceString) => {
    if (!paceString || paceString.indexOf(':') === -1) return 0;
    const parts = paceString.split(':');
    const minutes = parseInt(parts[0]);
    const seconds = parseInt(parts[1]);
    const totalSecondsPerKm = (minutes * 60) + seconds;
    
    // Vitesse (m/s) = 1000m / Temps (s/km)
    return totalSecondsPerKm > 0 ? (1000 / totalSecondsPerKm) : 0;
};


// --- LOGIQUE DE LECTURE TCX ---

function loadTcxFile(event) {
    const file = event.target.files[0];
    const displayElement = document.getElementById('tcx-stats-display');
    const saveButton = document.getElementById('tcxSaveButton');
    
    displayElement.innerHTML = '';
    saveButton.style.display = 'none';
    tcxDataToSave = null; 

    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const tcxContent = e.target.result;
            const data = parseTcxData(tcxContent);
            
            // Assurez-vous que la distance est réelle avant de continuer
            if (data && parseFloat(data.distanceKm) > 0.1) {
                // Afficher les stats extraites
                displayElement.innerHTML = `
                    ✅ Fichier chargé !<br>
                    <strong>Distance:</strong> ${data.distanceKm} km<br>
                    <strong>Durée:</strong> ${data.totalTimeFormatted}<br>
                    <strong>Allure Moyenne:</strong> ${data.avgPaceFormatted} /km<br>
                    <strong>Dénivelé:</strong> ${data.elevationGain} m<br>
                    <strong>Fréquence Cardiaque Moyenne:</strong> ${data.avgHeartRate} bpm<br>
                    <strong>Date de l'activité:</strong> ${data.startDateFormatted}
                `;
                tcxDataToSave = data; // Stocker les données pour la sauvegarde
                saveButton.style.display = 'block';
            } else {
                displayElement.innerHTML = '❌ Erreur de parsing ou distance non significative (doit être > 100m).';
            }
        } catch (error) {
            displayElement.innerHTML = '❌ Erreur lors du décodage du fichier TCX. Vérifiez le format.';
            console.error("TCX Parsing Error:", error);
        }
    };
    reader.readAsText(file);
}

/**
 * PARSER TCX CORRIGÉ : Cumule la distance et le temps de tous les laps (circuits).
 */
function parseTcxData(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "application/xml");
    
    const lapElements = xmlDoc.getElementsByTagNameNS('*', 'Lap');
    const activityElement = xmlDoc.getElementsByTagNameNS('*', 'Activity')[0];
    
    if (!activityElement) return null;

    // --- CORRECTION MAJEURE: Calcul de la distance et du temps par cumul ---
    let totalSeconds = 0;
    let distanceMeters = 0;
    
    // On boucle sur TOUS les laps pour cumuler la distance et la durée
    for (let i = 0; i < lapElements.length; i++) {
        const lap = lapElements[i];
        
        // Recherche de DistanceMeters et TotalTimeSeconds DANS le lap
        const distElem = lap.getElementsByTagNameNS('*', 'DistanceMeters')[0];
        const timeElem = lap.getElementsByTagNameNS('*', 'TotalTimeSeconds')[0];
        
        // Ajout de la distance et de la durée de CE lap
        const lapDistance = distElem ? parseFloat(distElem.textContent) : 0;
        const lapTime = timeElem ? parseFloat(timeElem.textContent) : 0;
        
        distanceMeters += lapDistance;
        totalSeconds += lapTime; 
    }
    
    // Fallback : Si le cumul ne donne rien (cas de TCX très simples), on cherche les totaux dans l'Activity.
    if (distanceMeters === 0 || totalSeconds === 0) {
        const distanceElement = activityElement.querySelector('DistanceMeters');
        const timeElement = activityElement.querySelector('TotalTimeSeconds');
        
        distanceMeters = distanceElement ? parseFloat(distanceElement.textContent) : 0;
        totalSeconds = timeElement ? parseFloat(timeElement.textContent) : 0;
    }
    
    // L'élément source devient l'Activity elle-même pour les autres métriques
    const sourceElement = activityElement; 
    
    // --- 1. DATE DE DÉBUT ---
    const idElement = activityElement.getElementsByTagNameNS('*', 'Id')[0];
    const startTimeIso = idElement ? idElement.textContent : new Date().toISOString();

    // 3. Dénivelé (Total Ascent/Elevation Gain)
    let elevationGain = 0;
    const elevationElement = activityElement.getElementsByTagNameNS('*', 'TotalAscent')[0] 
                            || activityElement.querySelector('ElevationSummary TotalAscent');
    if (elevationElement) {
        elevationGain = parseFloat(elevationElement.textContent) || 0;
    }
    
    // 4. Fréquence Cardiaque Moyenne (BPM)
    let avgHeartRate = 'N/A';
    let totalHrValue = 0;
    let totalHrTime = 0; // Total temps pour lequel on a une donnée cardiaque

    // Calculer la moyenne pondérée à partir de tous les Laps
    for (let i = 0; i < lapElements.length; i++) {
        const lap = lapElements[i];
        
        const timeElem = lap.getElementsByTagNameNS('*', 'TotalTimeSeconds')[0];
        const hrValueElem = lap.querySelector('AverageHeartRateBpm Value');
        
        const lapTime = timeElem ? parseFloat(timeElem.textContent) : 0;
        const lapBPM = hrValueElem ? parseInt(hrValueElem.textContent) : 0;
        
        if (lapBPM > 0 && lapTime > 0) {
            totalHrValue += lapTime * lapBPM;
            totalHrTime += lapTime;
        }
    }
    
    if (totalHrTime > 0) {
        avgHeartRate = Math.round(totalHrValue / totalHrTime);
    } else {
        // Fallback (Si aucun Lap n'a de donnée) : Tente de lire directement le champ Activity/Lap
        const heartRateBpmElement = xmlDoc.querySelector('Activity AverageHeartRateBpm Value') || 
                                    xmlDoc.querySelector('Lap AverageHeartRateBpm Value');
                                    
        if (heartRateBpmElement) {
            const parsedBpm = parseInt(heartRateBpmElement.textContent);
            if (!isNaN(parsedBpm) && parsedBpm > 0) {
                avgHeartRate = parsedBpm;
            }
        }
    }


    // --- CALCULS & FORMATAGE ---
    
    const startDate = new Date(startTimeIso);
    const startDateFormatted = startDate.toLocaleDateString('fr-FR');
    
    const distanceKm = (distanceMeters / 1000).toFixed(2);
    const totalTimeFormatted = formatTime(totalSeconds);
    
    // Calcul de l'allure (minutes par km)
    const totalMinutes = totalSeconds / 60;
    const distanceForPace = distanceMeters / 1000;
    const avgPaceMinutesPerKm = distanceForPace > 0 ? totalMinutes / distanceForPace : 0;
    
    // Arrondi de l'allure à la seconde près
    const paceMinutes = Math.floor(avgPaceMinutesPerKm);
    const paceSeconds = Math.round((avgPaceMinutesPerKm - paceMinutes) * 60);
    const avgPaceFormatted = `${paceMinutes}:${String(paceSeconds).padStart(2, '0')}`;
    
    const finalElevationGain = Math.round(elevationGain);

    return {
        distanceKm: distanceKm,
        totalTimeSeconds: totalSeconds,
        totalTimeFormatted: totalTimeFormatted,
        startDateFormatted: startDateFormatted,
        timestamp: startDate.getTime(),
        
        elevationGain: finalElevationGain,
        avgHeartRate: avgHeartRate,
        avgPaceFormatted: avgPaceFormatted
    };
}

// NOUVELLE FONCTION: Supprime une session de l'historique
function deleteSession(timestampToDelete) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette séance de l'historique ? Cette action est irréversible et sera immédiatement retirée des graphiques.")) {
        return;
    }
    
    let history = JSON.parse(localStorage.getItem('sportHistory')) || [];
    
    // Filtre l'historique pour conserver toutes les entrées SAUF celle correspondant au timestamp
    const updatedHistory = history.filter(item => item.timestamp !== timestampToDelete);
    
    localStorage.setItem('sportHistory', JSON.stringify(updatedHistory));
    
    // Recharge les statistiques et les graphiques
    updateStats();
    alert('Séance supprimée avec succès.');
}


function saveTcxSession() {
    if (tcxDataToSave) {
        saveSession('tcx_data', tcxDataToSave);
        
        document.getElementById('tcx-stats-display').innerHTML = 'Données TCX enregistrées !';
        document.getElementById('tcxSaveButton').style.display = 'none';
        document.getElementById('tcxFileInput').value = ''; 
        tcxDataToSave = null;
    }
}

function saveManualRunningSession(e) {
    e.preventDefault();
    
    const distance = document.getElementById('manual-distance').valueAsNumber;
    const minutes = document.getElementById('manual-time').valueAsNumber;
    
    if (isNaN(distance) || isNaN(minutes) || (distance <= 0 && minutes <= 0)) {
        alert("Veuillez entrer une distance et/ou une durée valides.");
        return;
    }
    
    const totalSeconds = minutes * 60;
    
    // Calcul de l'allure manuelle
    const distanceKm = distance.toFixed(2);
    const totalMinutes = totalSeconds / 60;
    const avgPaceMinutesPerKm = distance > 0 ? totalMinutes / distance : 0;
    
    const paceMinutes = Math.floor(avgPaceMinutesPerKm);
    const paceSeconds = Math.round((avgPaceMinutesPerKm - paceMinutes) * 60);
    const avgPaceFormatted = `${paceMinutes}:${String(paceSeconds).padStart(2, '0')}`;
    
    // Créer un objet de données similaire à celui du TCX pour l'uniformité
    const manualData = {
        distanceKm: distanceKm,
        totalTimeSeconds: totalSeconds,
        totalTimeFormatted: formatTime(totalSeconds),
        startDateFormatted: new Date().toLocaleDateString('fr-FR'),
        timestamp: Date.now(),
        isManual: true, // Marquer comme manuel
        elevationGain: 0,
        avgHeartRate: 'N/A',
        avgPaceFormatted: avgPaceFormatted
    };

    saveSession('tcx_data', manualData);
    document.getElementById('form-running-manual').reset();
}

/**
 * NOUVELLES FONCTIONS : Gestion des répétitions pour la Force Natation
 */
function addRepForce(exerciseKey) {
    // Le key est 'pompes-force' ou 'tractions-force'
    if (typeof currentReps[exerciseKey] !== 'number') {
        // Initialise la valeur si elle n'existe pas
        currentReps[exerciseKey] = defaultForceReps[exerciseKey]; 
    }
    currentReps[exerciseKey] += 1; // Incrément de 1
    localStorage.setItem('forceReps', JSON.stringify(currentReps));
    document.getElementById(`rep-${exerciseKey}`).innerText = currentReps[exerciseKey];
}

function removeRepForce(exerciseKey) {
    const minValue = minRepsForce; // Plafonné à 10 reps
    
    if (typeof currentReps[exerciseKey] !== 'number' || currentReps[exerciseKey] <= minValue) {
        alert(`Le nombre minimum de répétitions est de ${minValue}.`);
        currentReps[exerciseKey] = minValue;
    } else {
        currentReps[exerciseKey] -= 1; // Décrément de 1
    }
    
    localStorage.setItem('forceReps', JSON.stringify(currentReps));
    document.getElementById(`rep-${exerciseKey}`).innerText = currentReps[exerciseKey];
}

/**
 * NOUVELLE FONCTION : Sauvegarde de la session Force Natation
 */
function saveForceSessionNatation(e) {
    e.preventDefault();
    
    const note = document.getElementById('force-notes').value;
    
    // Récupérer les valeurs actuelles des compteurs
    const pompesReps = currentReps['pompes-force'];
    const tractionsReps = currentReps['tractions-force'];

    saveSession('force_natation_session', { // Utilisez un nouveau type de session pour la nouvelle routine
        pompes: pompesReps,
        tractions: tractionsReps,
        note: note
    });
    
    // Réinitialisation des notes après sauvegarde
    document.getElementById('form-force-natation').reset();
}


/**
 * NOUVELLE FONCTION : Sauvegarde de la session Piscine
 */
function savePiscineSession(e) {
    e.preventDefault();
    
    const distance = document.getElementById('piscine-distance').valueAsNumber;
    const minutes = document.getElementById('piscine-time').valueAsNumber;
    
    if (isNaN(distance) || isNaN(minutes) || (distance <= 0 && minutes <= 0)) {
        alert("Veuillez entrer une distance et/ou une durée valides pour la piscine.");
        return;
    }
    
    const totalSeconds = minutes * 60;
    const distanceMeters = distance; // Supposons que la distance est entrée en mètres
    
    // Calcul de la vitesse moyenne (en mètres/minute)
    const avgMetersPerMin = distance > 0 ? distanceMeters / minutes : 0;
    
    const piscineData = {
        distanceMeters: distanceMeters,
        totalTimeSeconds: totalSeconds,
        totalTimeFormatted: formatTime(totalSeconds),
        avgPace: `${avgMetersPerMin.toFixed(0)} m/min`, 
        startDateFormatted: new Date().toLocaleDateString('fr-FR'),
        timestamp: Date.now(),
        type: 'piscine'
    };

    saveSession('piscine', piscineData);
    document.getElementById('form-piscine').reset();
}


// Fonctions de temps/répétitions (récupérées des anciennes sections)
function addTime(exerciseKey) {
    if (typeof currentTimers[exerciseKey] !== 'number') {
        currentTimers[exerciseKey] = defaultTimers[exerciseKey]; 
    }
    currentTimers[exerciseKey] += 15;
    localStorage.setItem('stretchingTimers', JSON.stringify(currentTimers));
    document.getElementById(`time-${exerciseKey}`).innerText = currentTimers[exerciseKey];
}

function removeTime(exerciseKey) {
    const minValue = defaultTimers[exerciseKey];
    
    if (typeof currentTimers[exerciseKey] !== 'number' || currentTimers[exerciseKey] <= minValue) {
        alert(`Le temps minimum pour cet exercice est de ${minValue}s.`);
        currentTimers[exerciseKey] = minValue;
    } else {
        currentTimers[exerciseKey] -= 15;
    }
    
    localStorage.setItem('stretchingTimers', JSON.stringify(currentTimers));
    document.getElementById(`time-${exerciseKey}`).innerText = currentTimers[exerciseKey];
}


// --- GESTION DES ONGLETS ---
function openTab(tabName) {
    const contents = document.querySelectorAll('.tab-content');
    const buttons = document.querySelectorAll('.tab-btn');
    contents.forEach(c => c.classList.remove('active'));
    buttons.forEach(b => b.classList.remove('active'));
    
    const targetElement = document.getElementById(tabName);
    if(targetElement) targetElement.classList.add('active');
    
    const clickedButton = Array.from(buttons).find(btn => btn.getAttribute('onclick').includes(`'${tabName}'`));
    if (clickedButton) clickedButton.classList.add('active'); 
}


// --- SAUVEGARDE DES SÉANCES ---
function saveSession(type, data) {
    let history = JSON.parse(localStorage.getItem('sportHistory')) || []; 
    const newEntry = {
        // Utilise la date/timestamp du fichier TCX si disponible, sinon la date actuelle
        date: data.startDateFormatted || new Date().toLocaleDateString('fr-FR'),
        timestamp: data.timestamp || Date.now(), 
        type: type,
        data: data
    };
    history.push(newEntry);
    localStorage.setItem('sportHistory', JSON.stringify(history));
    alert('Séance enregistrée ! 💪');
    
    updateStats(); 
    
    if(type === 'etirements') {
        document.querySelector('#form-etirements input[type="checkbox"]').checked = false;
    } 
}


// Écouteurs de formulaires
document.getElementById('form-etirements').addEventListener('submit', (e) => { 
    e.preventDefault();
    const ischioSelect = document.getElementById('ischio-level');
    const ischioLevelText = ischioSelect.options[ischioSelect.selectedIndex].text;
    const ischioScore = parseInt(ischioSelect.value);

    saveSession('etirements', {
        ischioText: ischioLevelText,
        ischioScore: ischioScore,
        timersUsed: {
            mollet: currentTimers.mollet, fente: currentTimers.fente, pigeon: currentTimers.pigeon, 
            torsion: currentTimers.torsion, pec: currentTimers.pec, delto: currentTimers.delto
        }
    });
});

document.getElementById('form-pompes').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const nbPompes = document.getElementById('nb-pompes').valueAsNumber || 0;
    
    saveSession('pompes_solo', { pompes: nbPompes });
    
    document.getElementById('form-pompes').reset();
});

document.getElementById('form-balais').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const nbBalais = document.getElementById('nb-balais').valueAsNumber || 0;
    
    saveSession('balais_solo', { balais: nbBalais });
    
    document.getElementById('form-balais').reset();
});


document.getElementById('form-abdos').addEventListener('submit', (e) => {
    e.preventDefault();
    const note = document.getElementById('abdos-notes').value;
    
    saveSession('abdos', { 
        note: note,
        timersUsed: {
            crunch_classique: currentTimers.crunch_classique, russion_twist: currentTimers.russion_twist, 
            crunch_papillon: currentTimers.crunch_papillon, crunch_bras: currentTimers.crunch_bras, 
            ciseaux: currentTimers.ciseaux, chandelle: currentTimers.chandelle
        }
    });
});

const forceNatationForm = document.getElementById('form-force-natation');
if (forceNatationForm) {
    forceNatationForm.addEventListener('submit', saveForceSessionNatation);
}

const piscineForm = document.getElementById('form-piscine');
if (piscineForm) {
    piscineForm.addEventListener('submit', savePiscineSession);
}


// --- AFFICHAGE DES GRAPHIQUES ---

let chartPompes = null; 
let chartForceNatation = null; // NOUVEAU CHART
let chartIschio = null; 
let chartDurationStretching = null; // DUREE ETIREMENTS
let chartAbdos = null; // DUREE ABDOS
let chartTcx = null; 

function updateStats() {
    const history = JSON.parse(localStorage.getItem('sportHistory')) || [];
    const list = document.getElementById('history-list');
    list.innerHTML = '';

    const chronoHistory = history.slice().sort((a, b) => a.timestamp - b.timestamp);
    const etirementsData = chronoHistory.filter(h => h.type === 'etirements');
    const abdosData = chronoHistory.filter(h => h.type === 'abdos');
    const tcxData = chronoHistory.filter(h => h.type === 'tcx_data');
    
    // FILTRES CLAIRS:
    const forceNatationData = chronoHistory.filter(h => h.type === 'force_natation_session'); 
    const oldForceData = chronoHistory.filter(h => h.type === 'pompes_solo' || h.type === 'balais_solo' || h.type === 'pompes-balais' || h.type === 'pompes');


    // 2. Affichage Liste (Trié du plus récent au plus vieux)
    const sortedHistory = history.slice().sort((a, b) => b.timestamp - a.timestamp);
    
    sortedHistory.forEach(item => {
        const li = document.createElement('li'); 
        let detail = '';
        
        // LOGIQUE MISE À JOUR POUR LES TYPES DE SESSIONS
        if(item.type === 'force_natation_session') { // NOUVEAU TYPE DE SESSION
            detail = `🏋️ Force Natation: Pompes: ${item.data.pompes}, Tractions: ${item.data.tractions}`;
        } else if(item.type === 'etirements') {
            const ischioText = item.data.ischioText || 'N/A'; detail = `🧘 Étirements. Ischios : ${ischioText}`;
        } else if(item.type === 'abdos') {
            detail = `🍫 Abdos terminés. ${item.data.note ? '('+item.data.note+')' : ''}`;
        } else if (item.type === 'tcx_data') { 
            const manual = item.data.isManual ? ' (Saisie manuelle)' : '';
            detail = `🏃 Course: ${item.data.distanceKm} km, ${item.data.totalTimeFormatted} ${manual}`;
        } else if (item.type === 'piscine') {
            detail = `🏊 Natation: ${item.data.distanceMeters} m, ${item.data.totalTimeFormatted} (${item.data.avgPace})`;
        } else if (item.type === 'pompes_solo' || item.type === 'balais_solo' || item.type === 'pompes-balais' || item.type === 'pompes') {
             // Ancien format Pompes & Balais (conservé dans le code initial fourni)
            const pompes = item.data.pompes || item.data.count || 0; 
            const balais = item.data.balais || 0;
            detail = `💪 Pompes & Balais: Pompes: ${pompes}, Balais: ${balais}`;
        }
        
        li.innerHTML = `
            <div>
                <strong>${item.date}</strong> - ${detail}
            </div>
            <button class="delete-btn" onclick="deleteSession(${item.timestamp})">🗑️</button>
        `; 
        list.appendChild(li);
    });

    // --- AGRÉGATION ET GRAPH 1 : POMPES & BALAIS (Original) ---
    
    const aggregatedPompesBalais = {};
    // On agrège SEULEMENT les anciennes données Pompes/Balais Solo pour ce graphique
    oldForceData.slice().sort((a, b) => b.timestamp - a.timestamp).forEach(h => { 
        const date = h.date;
        
        if (!aggregatedPompesBalais[date]) {
            aggregatedPompesBalais[date] = { pompes: null, balais: null, date: date };
        }
        
        const dailyData = aggregatedPompesBalais[date];

        // OLD Pompes/Balais Solo data: La dernière entrée de la journée (la plus récente) est conservée
        if (dailyData.pompes === null) dailyData.pompes = h.data.pompes || h.data.count || null;
        if (dailyData.balais === null) dailyData.balais = h.data.balais || null;
    });

    const pompesGraphData = Object.values(aggregatedPompesBalais).sort((a, b) => {
        const dateA = new Date(a.date.split('/').reverse().join('-'));
        const dateB = new Date(b.date.split('/').reverse().join('-'));
        return dateA - dateB;
    });

    if(chartPompes) chartPompes.destroy();
    chartPompes = new Chart(document.getElementById('pompesChart'), {
        type: 'line',
        data: {
            labels: pompesGraphData.map(h => h.date),
            datasets: [
                {
                    label: 'Pompes (répétitions)', 
                    data: pompesGraphData.map(h => h.pompes), 
                    borderColor: '#4CAF50', // Vert
                    backgroundColor: 'rgba(76, 175, 80, 0.2)',
                    fill: false, tension: 0.3
                },
                {
                    label: 'Balais (répétitions)', 
                    data: pompesGraphData.map(h => h.balais), 
                    borderColor: '#FFD700', // Jaune
                    backgroundColor: 'rgba(255, 215, 0, 0.2)',
                    fill: false, tension: 0.3
                }
            ]
        },
        options: { scales: { y: { beginAtZero: true } } }
    });


    // --- AGRÉGATION ET GRAPH 2 : FORCE NATATION (Nouveau) ---

    const aggregatedForceNatation = {};
    const forceNatationHistoryDesc = forceNatationData.slice().sort((a, b) => b.timestamp - a.timestamp);

    forceNatationHistoryDesc.forEach(h => {
        const date = h.date;
        if (!aggregatedForceNatation[date]) {
            // Prend la dernière session enregistrée du jour
            aggregatedForceNatation[date] = { pompes: h.data.pompes, tractions: h.data.tractions, date: date };
        }
    });

    const forceNatationGraphData = Object.values(aggregatedForceNatation).sort((a, b) => {
        const dateA = new Date(a.date.split('/').reverse().join('-'));
        const dateB = new Date(b.date.split('/').reverse().join('-'));
        return dateA - dateB;
    });

    if(chartForceNatation) chartForceNatation.destroy();
    chartForceNatation = new Chart(document.getElementById('forceNatationChart'), {
        type: 'line',
        data: {
            labels: forceNatationGraphData.map(h => h.date),
            datasets: [
                {
                    label: 'Pompes (répétitions)', 
                    data: forceNatationGraphData.map(h => h.pompes), 
                    borderColor: '#FF00FF', // Violet pour différencier
                    backgroundColor: 'rgba(255, 0, 255, 0.2)',
                    fill: false, tension: 0.3
                },
                {
                    label: 'Tractions Inversées (répétitions)', 
                    data: forceNatationGraphData.map(h => h.tractions), 
                    borderColor: '#00FFFF', // Cyan pour différencier
                    backgroundColor: 'rgba(0, 255, 255, 0.2)',
                    yAxisID: 'tractions-y',
                    fill: false,
                    tension: 0.3
                }
            ]
        },
        options: { scales: { y: { beginAtZero: true } } }
    });
    
    // --- AGRÉGATION ET GRAPH TCX (Course à Pied) ---

    const aggregatedTcxData = {};
    const tcxHistory = tcxData.slice().sort((a, b) => a.timestamp - b.timestamp); 
    
    // --- CUMUL QUOTIDIEN ---
    tcxHistory.forEach(h => {
        const date = h.date;
        
        if (!aggregatedTcxData[date]) {
            // Initialisation pour le jour
            aggregatedTcxData[date] = { 
                distance: 0, 
                timeSeconds: 0, 
                elevation: 0, 
                avgHeartRate: null, // Initialisation à null
                date: date 
            };
        }
        
        const dailyData = aggregatedTcxData[date];
        const hDistance = parseFloat(h.data.distanceKm) || 0;
        const hTime = parseFloat(h.data.totalTimeSeconds) || 0;
        const hElevation = parseFloat(h.data.elevationGain) || 0;
        const hBPM = parseInt(h.data.avgHeartRate) || null;

        // 1. Cumuler la Distance, le Temps et le Dénivelé
        dailyData.distance += hDistance;
        dailyData.timeSeconds += hTime;
        dailyData.elevation += hElevation;

        // 2. CORRECTION BPM : On prend la valeur de la session la plus récente qui a un BPM valide
        if (dailyData.avgHeartRate === null && hBPM !== null && hBPM > 0) {
            dailyData.avgHeartRate = hBPM;
        }
    });

    // --- RECALCULER L'ALLURE MOYENNE / VITESSE MOYENNE TOTALE DU JOUR ---
    Object.keys(aggregatedTcxData).forEach(date => {
        const dailyData = aggregatedTcxData[date];
        const distanceKm = dailyData.distance;
        const totalSeconds = dailyData.timeSeconds;
        
        // --- Calcul de l'Allure Numérique (min/km) ---
        const avgPaceMinutesPerKm = distanceKm > 0 ? (totalSeconds / 60) / distanceKm : 0;
        
        // STOCKAGE DE L'ALLURE NUMÉRIQUE (MIN/KM) POUR LE GRAPHIQUE
        dailyData.avgPaceMpm = avgPaceMinutesPerKm;
        
        // Calcul de l'Allure Arrondie (MM:SS)
        const paceMinutes = Math.floor(avgPaceMinutesPerKm);
        const paceSeconds = Math.round((avgPaceMinutesPerKm - paceMinutes) * 60);
        dailyData.avgPaceFormatted = `${paceMinutes}:${String(paceSeconds).padStart(2, '0')}`;
        
        // Stockage de la Vitesse (m/s) basée sur l'Allure Arrondie
        dailyData.avgSpeedMps = convertPaceToSpeed(dailyData.avgPaceFormatted);
    });
    
    const tcxGraphData = Object.values(aggregatedTcxData).sort((a, b) => {
        const dateA = new Date(a.date.split('/').reverse().join('-'));
        const dateB = new Date(b.date.split('/').reverse().join('-'));
        return dateA - dateB;
    });

    if(chartTcx) chartTcx.destroy();
    chartTcx = new Chart(document.getElementById('tcxChart'), {
        type: 'line',
        data: {
            labels: tcxGraphData.map(h => h.date),
            datasets: [
                {
                    label: 'Distance (km)',
                    data: tcxGraphData.map(h => h.distance),
                    borderColor: '#1E90FF', // Bleu foncé
                    backgroundColor: 'rgba(30, 144, 255, 0.2)',
                    yAxisID: 'distance-y',
                    fill: false,
                    tension: 0.3
                },
                {
                    // Fréquence Cardiaque (BPM)
                    label: 'Fréquence Cardiaque (bpm)',
                    data: tcxGraphData.map(h => h.avgHeartRate),
                    borderColor: '#FF0000', // Rouge
                    backgroundColor: 'rgba(255, 0, 0, 0.2)',
                    yAxisID: 'bpm-y',
                    fill: false,
                    tension: 0.3
                },
                {
                    // Allure (min/km)
                    label: 'Allure (min/km)',
                    data: tcxGraphData.map(h => h.avgPaceMpm), // Utilisation de l'allure numérique pour le tracé
                    borderColor: '#008000', // Vert
                    backgroundColor: 'rgba(0, 128, 0, 0.2)',
                    yAxisID: 'pace-y', // Nouvelle ID d'axe pour Allure
                    fill: false,
                    tension: 0.3
                }
            ]
        },
        options: {
            scales: {
                'distance-y': {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    title: { display: true, text: 'Distance (km)' }
                },
                'bpm-y': {
                    type: 'linear',
                    position: 'right', 
                    grid: { drawOnChartArea: false }, 
                    title: { display: true, text: 'BPM' }
                },
                'pace-y': { // Configuration de l'axe d'allure
                    type: 'linear',
                    position: 'right', 
                    grid: { drawOnChartArea: false }, 
                    // Conversion du nombre de minutes/km (e.g., 5.008) en MM:SS
                    ticks: {
                        callback: function(value) {
                            if (value === 0) return '0:00';
                            const paceMinutes = Math.floor(value);
                            const paceSeconds = Math.round((value - paceMinutes) * 60);
                            return `${paceMinutes}:${String(paceSeconds).padStart(2, '0')}`;
                        }
                    },
                    title: { display: true, text: 'Allure (min/km)' }
                }
            }
        }
    });

    // --- GRAPH 3 : SOUPLESSE ISCHIOS ---
    if(chartIschio) chartIschio.destroy();
    
    const allStretchingDates = [...new Set(etirementsData.map(h => h.date))];

    chartIschio = new Chart(document.getElementById('ischioChart'), {
        type: 'line',
        data: {
            labels: etirementsData.map(h => h.date),
            datasets: [{
                label: 'Niveau Souplesse (1-7)', data: etirementsData.map(h => h.data.ischioScore),
                borderColor: '#FF9800', backgroundColor: 'rgba(255, 152, 0, 0.2)',
                stepped: true, fill: true
            }]
        },
        options: {
            scales: {
                y: { 
                    min: 0, max: 8,
                    ticks: {
                        callback: function(value) {
                            const labels = ["", "Genoux", "Haut Tibia", "Bas Tibia", "Chevilles", "Pieds (doigts)", "Pieds (main)", "Poignets"];
                            return labels[value] || value;
                        }
                    }
                }
            }
        }
    });

    // --- GRAPH 4 : DURÉES ÉTIREMENTS ---
    if(chartDurationStretching) chartDurationStretching.destroy();
    
    const stretchingExosKeys = Object.keys(defaultStretchingTimers);
    const colorsStretching = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4'];
    
    
    const durationStretchingDatasets = stretchingExosKeys.map((key, index) => {
        const aggregatedStretching = {};
        // CORRECTION ROBUSTESSE APPLIQUEE
        etirementsData.forEach(h => {
            if (h.data && h.data.timersUsed && h.data.timersUsed[key] !== undefined) {
                aggregatedStretching[h.date] = h.data.timersUsed[key]; 
            }
        });

        const dataPoints = allStretchingDates.map(date => {
            return aggregatedStretching[date] !== undefined ? aggregatedStretching[date] : null;
        });

        return {
            label: key.charAt(0).toUpperCase() + key.slice(1), 
            data: dataPoints, 
            borderColor: colorsStretching[index], backgroundColor: 'transparent',
            borderWidth: 2, tension: 0.1
        };
    });

    chartDurationStretching = new Chart(document.getElementById('durationChart'), {
        type: 'line',
        data: {
            labels: allStretchingDates,
            datasets: durationStretchingDatasets
        }
    });

    // --- GRAPH 5 : DURÉES ABDOS ---
    if(chartAbdos) chartAbdos.destroy();
    
    const abdosExosKeys = Object.keys(defaultAbdosTimers);
    const colorsAbdos = ['#00FFFF', '#FF00FF', '#0000FF', '#FF8000', '#00FF80', '#8000FF']; 
    
    const abdosAllDates = [...new Set(abdosData.map(h => h.date))];

    const durationAbdosDatasets = abdosExosKeys.map((key, index) => {
        const aggregatedAbdos = {};
        // CORRECTION ROBUSTESSE APPLIQUEE
        abdosData.forEach(h => {
            if (h.data && h.data.timersUsed && h.data.timersUsed[key] !== undefined) {
                aggregatedAbdos[h.date] = h.data.timersUsed[key]; 
            }
        });
        
        const dataPoints = abdosAllDates.map(date => {
            return aggregatedAbdos[date] !== undefined ? aggregatedAbdos[date] : null;
        });

        return {
            label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), 
            data: dataPoints, 
            borderColor: colorsAbdos[index], backgroundColor: 'transparent',
            borderWidth: 2, tension: 0.1
        };
    });

    chartAbdos = new Chart(document.getElementById('abdosChart'), {
        type: 'line',
        data: {
            labels: abdosAllDates, 
            datasets: durationAbdosDatasets
        }
    });
}

function clearData() {
    if(confirm("Effacer tout l'historique ?")) {
        localStorage.removeItem('sportHistory'); updateStats();
    }
}

// --- GESTION DE LA MUSIQUE ET DE L'OVERLAY DE DÉMARRAGE ---

document.addEventListener('DOMContentLoaded', () => {
    initTimers(); 

    const enterButton = document.getElementById('enter-app-button');
    const startupOverlay = document.getElementById('startup-overlay');
    const backgroundMusic = document.getElementById('background-music');

    if (enterButton && startupOverlay) {
        enterButton.addEventListener('click', () => {
            
            // 1. TENTER DE LANCER LA MUSIQUE IMMÉDIATEMENT
            if (backgroundMusic) {
                backgroundMusic.volume = 0.4;
                backgroundMusic.play().catch(error => { console.warn("Échec du lancement de l'audio.", error); });
                
                // ARRÊTER LA MUSIQUE APRÈS UNE SEULE LECTURE
                backgroundMusic.addEventListener('ended', () => {
                    backgroundMusic.pause();
                    backgroundMusic.currentTime = 0; // Remettre au début si jamais elle est relancée
                });
            }

            // 2. LANCER LE FONDU VERS LE SITE WEB
            document.body.classList.add('ready');
            startupOverlay.classList.add('hidden');
            
            // 3. Mettre à jour les statistiques pour afficher les données existantes
            updateStats();
        });
    }
});