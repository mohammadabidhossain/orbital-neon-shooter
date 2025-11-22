// --- CONFIG ---
const CONFIG = {
    ARENA_SIZE: 120,
    SUN_SIZE: 18,
    PLAYER_ORBIT_RADIUS: 60,
    PLAYER_ORBIT_SPEED: 0.005,
    PLAYER_ACCEL_RADIUS: 0.3,
    ENEMY_SPEED: 1.2,
    BULLET_SPEED: 3.5,
    BULLET_COOLDOWN: 120, 
    ENEMY_SPAWN_RATE: 2000, 
    POWERUP_SPAWN_RATE: 8000,
    SHAKE_DECAY: 0.9,
    COLORS: { PLAYER: 0x00ff00, ENEMY: 0xff0000, BULLET: 0x00ffff, SUN: 0xffff00, BG: 0x000000, STAR: 0xffffff }
};

// --- GLOBALS ---
let scene, camera, renderer;
let player, sun, starfield;
let mouseRaycaster, mousePos;
let bullets = [], enemies = [], particles = [], powerups = [];
let keys = { w: false, a: false, s: false, d: false, space: false, mouse: false };

let gameState = { 
    isPlaying: false, 
    score: 0, 
    lastShotTime: 0, 
    lastSpawnTime: 0,
    lastPowerupTime: 0,
    difficultyMult: 1.0 
};

let playerOrbitAngle = 0;
let playerOrbitRadius = CONFIG.PLAYER_ORBIT_RADIUS;
let activePowerups = { rapidFire: false, shield: false };
let rapidFireTimer = null;
let shakeIntensity = 0;

// --- INIT ---
window.onload = () => {
    initThreeJS();
    setupInputs();
    
    document.getElementById('start-screen').addEventListener('click', (e) => {
        // Delay slightly to prevent click-through shooting
        setTimeout(() => {
            document.getElementById('start-screen').classList.add('hidden');
            startGame();
        }, 100);
    });
    document.getElementById('restart-btn').addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent stick activation
        resetGame();
    });
};

function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.COLORS.BG);
    scene.fog = new THREE.FogExp2(CONFIG.COLORS.BG, 0.004);

    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 1000);
    camera.position.set(0, 140, 0);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for mobile performance
    document.body.appendChild(renderer.domElement);

    mouseRaycaster = new THREE.Raycaster();
    mousePos = new THREE.Vector2();

    createWorld();
    requestAnimationFrame(gameLoop);
}

function createWorld() {
    // Sun
    const sunGeo = new THREE.SphereGeometry(CONFIG.SUN_SIZE, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ 
        color: CONFIG.COLORS.SUN, 
        emissive: 0xffaa00, 
        emissiveIntensity: 2 
    });
    sun = new THREE.Mesh(sunGeo, sunMat);
    scene.add(sun);
    
    // Sun Halo
    const haloGeo = new THREE.SphereGeometry(CONFIG.SUN_SIZE * 1.2, 32, 32);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.15, side: THREE.BackSide });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    sun.add(halo);

    // Starfield
    const starGeo = new THREE.BufferGeometry();
    const starCount = 800;
    const posArray = new Float32Array(starCount * 3);
    for(let i=0; i<starCount*3; i++) {
        posArray[i] = (Math.random() - 0.5) * 400; 
        if (i % 3 === 1) posArray[i] = (Math.random() - 0.5) * 50 - 50; 
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const starMat = new THREE.PointsMaterial({ size: 0.8, color: CONFIG.COLORS.STAR, transparent: true, opacity: 0.6 });
    starfield = new THREE.Points(starGeo, starMat);
    scene.add(starfield);

    // Player
    const pGeo = new THREE.TetrahedronGeometry(1.5);
    const pMat = new THREE.MeshBasicMaterial({ color: CONFIG.COLORS.PLAYER, wireframe: true });
    const pCore = new THREE.Mesh(new THREE.TetrahedronGeometry(0.8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    player = new THREE.Group();
    player.add(new THREE.Mesh(pGeo, pMat));
    player.add(pCore);
    
    // Shield
    const shieldGeo = new THREE.SphereGeometry(2.5, 16, 16);
    const shieldMat = new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.3, wireframe: true });
    const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    shieldMesh.name = 'shield';
    shieldMesh.visible = false;
    player.add(shieldMesh);

    player.position.set(CONFIG.PLAYER_ORBIT_RADIUS, 0, 0); 
    scene.add(player);
}

// --- GAMEPLAY ---
function startGame() {
    gameState.isPlaying = true;
    gameState.score = 0;
    gameState.lastSpawnTime = Date.now();
    gameState.lastPowerupTime = Date.now();
    gameState.difficultyMult = 1.0;
    
    playerOrbitAngle = 0;
    playerOrbitRadius = CONFIG.PLAYER_ORBIT_RADIUS;
    player.position.set(playerOrbitRadius, 0, 0);
    
    activePowerups.shield = false;
    activePowerups.rapidFire = false;
    updateUI();
}

function gameLoop() {
    requestAnimationFrame(gameLoop);

    if (gameState.isPlaying) {
        const now = Date.now();

        // 1. Difficulty
        gameState.difficultyMult = 1 + Math.min(gameState.score / 5000, 1.5); 

        // 2. Player Movement (Input Mixing)
        let orbitSpeed = CONFIG.PLAYER_ORBIT_SPEED;
        
        // Key inputs
        let inputX = 0; // Orbit speed mod
        let inputY = 0; // Radius mod

        if (keys.a) inputX = 1;
        if (keys.d) inputX = -1;
        if (keys.w) inputY = -1;
        if (keys.s) inputY = 1;

        playerOrbitAngle += (orbitSpeed + (inputX * 0.01)); // Apply orbit mod
        playerOrbitRadius += (inputY * CONFIG.PLAYER_ACCEL_RADIUS);
        
        playerOrbitRadius = THREE.MathUtils.clamp(playerOrbitRadius, CONFIG.SUN_SIZE + 4, CONFIG.ARENA_SIZE * 1.5);

        player.position.x = Math.cos(playerOrbitAngle) * playerOrbitRadius;
        player.position.z = Math.sin(playerOrbitAngle) * playerOrbitRadius;
        player.rotation.y = -playerOrbitAngle; 

        // 3. Heat Warning
        const heatWarningEl = document.getElementById('heat-warning');
        if (playerOrbitRadius < CONFIG.SUN_SIZE + 15) {
            heatWarningEl.classList.remove('hidden');
        } else {
            heatWarningEl.classList.add('hidden');
        }

        // 4. Aiming
        // --- MOUSE AIMING ---
        const vector = new THREE.Vector3(mousePos.x, mousePos.y, 0.5);
        vector.unproject(camera);
        const dir = vector.sub(camera.position).normalize();
        const distance = -camera.position.y / dir.y;
        const targetPoint = camera.position.clone().add(dir.multiplyScalar(distance));
        
        if (targetPoint) {
            targetPoint.y = player.position.y;
            player.lookAt(targetPoint);
        }

        // 5. Shooting
        const currentCooldown = activePowerups.rapidFire ? CONFIG.BULLET_COOLDOWN / 3 : CONFIG.BULLET_COOLDOWN;
        const isTryingToShoot = keys.space || keys.mouse;

        if (isTryingToShoot && (now - gameState.lastShotTime > currentCooldown)) {
            fireBullet();
            gameState.lastShotTime = now;
        }

        // 6. Spawning
        const currentSpawnRate = Math.max(600, CONFIG.ENEMY_SPAWN_RATE / gameState.difficultyMult);
        if (now - gameState.lastSpawnTime > currentSpawnRate) {
            spawnEnemy();
            gameState.lastSpawnTime = now;
        }

        if (now - gameState.lastPowerupTime > CONFIG.POWERUP_SPAWN_RATE) {
            if (Math.random() > 0.3) spawnPowerup();
            gameState.lastPowerupTime = now;
        }

        updateEntities();
    }

    // Camera Shake
    if (shakeIntensity > 0) {
        const rx = (Math.random() - 0.5) * shakeIntensity;
        const rz = (Math.random() - 0.5) * shakeIntensity;
        camera.position.set(rx, 140, rz);
        shakeIntensity *= CONFIG.SHAKE_DECAY;
        if (shakeIntensity < 0.1) {
            shakeIntensity = 0;
            camera.position.set(0, 140, 0);
        }
    }

    const pulseScale = 1 + Math.sin(Date.now() * 0.002) * 0.05;
    sun.scale.setScalar(pulseScale);

    renderer.render(scene, camera);
}

function fireBullet() {
    const geo = new THREE.SphereGeometry(0.5, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ 
        color: activePowerups.rapidFire ? 0xffff00 : CONFIG.COLORS.BULLET, 
        emissive: activePowerups.rapidFire ? 0xffff00 : CONFIG.COLORS.BULLET, 
        emissiveIntensity: 2 
    });
    const bullet = new THREE.Mesh(geo, mat);
    bullet.position.copy(player.position);
    
    const dir = new THREE.Vector3(0,0,1).applyQuaternion(player.quaternion);
    bullet.userData = { velocity: dir.multiplyScalar(CONFIG.BULLET_SPEED) };
    
    scene.add(bullet);
    bullets.push(bullet);
}

function spawnEnemy() {
    const geo = new THREE.OctahedronGeometry(1.4);
    const mat = new THREE.MeshBasicMaterial({ color: CONFIG.COLORS.ENEMY, wireframe: true });
    const enemy = new THREE.Mesh(geo, mat);
    
    const angle = Math.random() * Math.PI * 2;
    const radius = CONFIG.ARENA_SIZE * 1.5;
    enemy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    
    enemy.userData = { rotSpeed: Math.random() * 0.1 + 0.02 };
    scene.add(enemy);
    enemies.push(enemy);
}

function spawnPowerup() {
    const type = Math.random() > 0.5 ? 'rapid' : 'shield';
    const color = type === 'rapid' ? 0xffff00 : 0x0088ff;
    
    const geo = new THREE.BoxGeometry(2, 2, 2);
    const mat = new THREE.MeshBasicMaterial({ color: color, wireframe: true, emissive: color, emissiveIntensity: 0.5 });
    const powerup = new THREE.Mesh(geo, mat);

    const angle = Math.random() * Math.PI * 2;
    const radius = CONFIG.SUN_SIZE + 20 + Math.random() * 60;
    powerup.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    
    powerup.userData = { type: type, rotSpeed: 0.05 };
    scene.add(powerup);
    powerups.push(powerup);
}

function updateEntities() {
    // Bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.position.add(b.userData.velocity);
        if (b.position.length() > CONFIG.ARENA_SIZE * 2 || b.position.distanceTo(sun.position) < CONFIG.SUN_SIZE) {
            scene.remove(b); bullets.splice(i, 1);
        }
    }

    // Powerups
    for (let i = powerups.length - 1; i >= 0; i--) {
        const p = powerups[i];
        p.rotation.x += p.userData.rotSpeed;
        p.rotation.y += p.userData.rotSpeed;

        if (p.position.distanceTo(player.position) < 3) {
            activatePowerup(p.userData.type);
            scene.remove(p);
            powerups.splice(i, 1);
            createExplosion(p.position, p.material.color, 5);
        }
    }

    // Enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        
        const dir = new THREE.Vector3().subVectors(player.position, e.position).normalize();
        const speed = CONFIG.ENEMY_SPEED * 0.15 * (gameState.difficultyMult); 
        e.position.add(dir.multiplyScalar(speed + 0.15)); 
        
        e.lookAt(player.position); 
        e.rotation.z += e.userData.rotSpeed;

        if (e.position.distanceTo(sun.position) < CONFIG.SUN_SIZE + 2) {
            createExplosion(e.position, CONFIG.COLORS.SUN, 8);
            shakeIntensity = 0.5;
            scene.remove(e); enemies.splice(i, 1);
            continue;
        }

        if (e.position.distanceTo(player.position) < 2.5) {
            if (activePowerups.shield) {
                activePowerups.shield = false;
                player.getObjectByName('shield').visible = false;
                createExplosion(e.position, 0x0088ff, 15); 
                shakeIntensity = 2;
                scene.remove(e); enemies.splice(i, 1);
                updateUI();
            } else {
                createExplosion(player.position, CONFIG.COLORS.PLAYER, 20);
                endGame();
                return;
            }
        }

        for (let j = bullets.length - 1; j >= 0; j--) {
            const b = bullets[j];
            if (b && e.position.distanceTo(b.position) < 2.5) {
                createExplosion(e.position, CONFIG.COLORS.ENEMY, 10);
                shakeIntensity = 0.8; 
                scene.remove(e); enemies.splice(i, 1);
                scene.remove(b); bullets.splice(j, 1);
                updateScore(100);
                break;
            }
        }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.position.add(p.userData.vel);
        p.material.opacity -= 0.03;
        p.scale.multiplyScalar(0.95);
        if (p.material.opacity <= 0) {
            scene.remove(p); particles.splice(i, 1);
        }
    }

    if (playerOrbitRadius < CONFIG.SUN_SIZE + 1.5) {
        if (activePowerups.shield) {
            playerOrbitRadius += 10; 
            activePowerups.shield = false;
            player.getObjectByName('shield').visible = false;
            shakeIntensity = 5;
            updateUI();
        } else {
            createExplosion(player.position, CONFIG.COLORS.SUN, 30);
            endGame();
        }
    }
}

function activatePowerup(type) {
    if (type === 'shield') {
        activePowerups.shield = true;
        player.getObjectByName('shield').visible = true;
    } else if (type === 'rapid') {
        activePowerups.rapidFire = true;
        clearTimeout(rapidFireTimer);
        rapidFireTimer = setTimeout(() => {
            activePowerups.rapidFire = false;
            updateUI();
        }, 5000);
    }
    updateUI();
}

function createExplosion(pos, color, count) {
    for(let k=0; k<count; k++) {
        const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const mat = new THREE.MeshBasicMaterial({color: color, transparent: true, emissive: color});
        const p = new THREE.Mesh(geo, mat);
        p.position.copy(pos);
        
        const speed = Math.random() * 0.8 + 0.2;
        p.userData.vel = new THREE.Vector3(
            (Math.random()-0.5), (Math.random()-0.5), (Math.random()-0.5)
        ).normalize().multiplyScalar(speed);
        
        scene.add(p);
        particles.push(p);
    }
}

function updateScore(points) {
    gameState.score += points;
    updateUI();
}

function updateUI() {
    document.getElementById('score-display').innerText = `SCORE: ${gameState.score}`;
    
    const shieldEl = document.getElementById('shield-status');
    shieldEl.style.opacity = activePowerups.shield ? '1' : '0';

    const rapidEl = document.getElementById('rapid-fire-status');
    rapidEl.style.opacity = activePowerups.rapidFire ? '1' : '0';
}

function endGame() {
    gameState.isPlaying = false;
    document.getElementById('final-score').innerText = `SCORE: ${gameState.score}`;
    document.getElementById('game-over-modal').classList.remove('hidden');
    document.getElementById('ui-layer').classList.add('hidden');
}

function resetGame() {
    enemies.forEach(e => scene.remove(e)); enemies = [];
    bullets.forEach(b => scene.remove(b)); bullets = [];
    particles.forEach(p => scene.remove(p)); particles = [];
    powerups.forEach(p => scene.remove(p)); powerups = [];
    
    document.getElementById('game-over-modal').classList.add('hidden');
    document.getElementById('ui-layer').classList.remove('hidden');
    startGame();
}

// --- INPUTS ---
function setupInputs() {
    window.addEventListener('keydown', e => {
        const key = e.key.toLowerCase();
        if(key === 'w') keys.w = true;
        if(key === 'a') keys.a = true;
        if(key === 's') keys.s = true;
        if(key === 'd') keys.d = true;
        if(key === ' ') keys.space = true;
    });
    window.addEventListener('keyup', e => {
        const key = e.key.toLowerCase();
        if(key === 'w') keys.w = false;
        if(key === 'a') keys.a = false;
        if(key === 's') keys.s = false;
        if(key === 'd') keys.d = false;
        if(key === ' ') keys.space = false;
    });
    window.addEventListener('mousemove', e => {
        mousePos.x = (e.clientX / window.innerWidth) * 2 - 1;
        mousePos.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    window.addEventListener('mousedown', () => keys.mouse = true);
    window.addEventListener('mouseup', () => keys.mouse = false);
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}