const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const cursorCore = document.getElementById('cursor-core');
const cursorRing = document.getElementById('cursor-ring');
const loadingScreen = document.getElementById('loading-screen');
const hudState = document.getElementById('hud-state');

canvasElement.width = 640;
canvasElement.height = 480;

let currentState = 'IDLE'; 
let targetX = window.innerWidth / 2;
let targetY = window.innerHeight / 2;
let ringX = targetX, ringY = targetY;
let currentHovered = null;

let prevScrollY = 0;

let isPinching = false;
let pinchStartTime = 0;
let isDragging = false;
let grabbedElement = null;

const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1, 
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

hands.onResults(onResults);

const camera = new Camera(videoElement, {
    onFrame: async () => { await hands.send({ image: videoElement }); },
    width: 640, height: 480
});

camera.start().then(() => {
    loadingScreen.style.opacity = '0';
    setTimeout(() => loadingScreen.style.display = 'none', 500);
});

function get3DDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
}

function isExtended(landmarks, tipIdx, pipIdx) {
    const distTip = get3DDistance(landmarks[tipIdx], landmarks[0]);
    const distPip = get3DDistance(landmarks[pipIdx], landmarks[0]);
    return distTip > distPip * 1.15;
}

function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {color: '#ffffff', lineWidth: 2});
        drawLandmarks(canvasCtx, landmarks, {color: '#00ff00', lineWidth: 1, radius: 2});

        const indexExt = isExtended(landmarks, 8, 6);
        const middleExt = isExtended(landmarks, 12, 10);
        
        // Map and clamp coordinates
        const mappedX = (1 - landmarks[8].x) * window.innerWidth;
        const mappedY = landmarks[8].y * window.innerHeight;
        targetX = Math.max(10, Math.min(window.innerWidth - 10, mappedX));
        targetY = Math.max(10, Math.min(window.innerHeight - 10, mappedY));

        const pinchDist = get3DDistance(landmarks[4], landmarks[8]);
        const currentlyPinching = pinchDist < 0.08;

        if (indexExt && middleExt) {
            // SCROLLING
            currentState = 'SCROLLING';
            document.body.classList.add('scrolling');
            document.body.classList.remove('pinching', 'dragging');
            hudState.textContent = "STATE: SCROLL";
            
            const currentScrollY = (landmarks[8].y + landmarks[12].y) / 2;
            if (prevScrollY !== 0) {
                const deltaY = (prevScrollY - currentScrollY); 
                window.scrollBy(0, deltaY * window.innerHeight * 3);
            }
            prevScrollY = currentScrollY;
            
            if (isPinching) { isPinching = false; }
            if (isDragging) { releaseDrag(); }
            grabbedElement = null;

        } else if (currentlyPinching) {
            // PINCHING (CLICK OR DRAG)
            currentState = 'PINCHING';
            document.body.classList.remove('scrolling');
            document.body.classList.add('pinching');
            
            if (!isPinching) {
                isPinching = true;
                pinchStartTime = Date.now();
                // Find element under cursor
                const el = document.elementFromPoint(targetX, targetY);
                grabbedElement = el?.closest('.glass-card') || null;
            } else {
                // If held for >250ms, start dragging
                if (Date.now() - pinchStartTime > 250) {
                    if (!isDragging && grabbedElement) {
                        isDragging = true;
                        document.body.classList.add('dragging');
                        grabbedElement.classList.add('grabbed');
                        hudState.textContent = "STATE: DRAG";
                    }
                }
                
                // Move the element
                if (isDragging && grabbedElement) {
                    grabbedElement.style.position = 'fixed';
                    grabbedElement.style.left = `${targetX}px`;
                    grabbedElement.style.top = `${targetY}px`;
                    // Keep it centered on the cursor
                    grabbedElement.style.transform = 'translate(-50%, -50%) scale(1.05)'; 
                    grabbedElement.style.margin = '0';
                }
            }
            prevScrollY = 0;

        } else {
            // POINTING
            currentState = 'POINTING';
            document.body.classList.remove('scrolling', 'pinching');
            hudState.textContent = "STATE: TRACK";

            if (isPinching) {
                // Pinch released
                isPinching = false;
                document.body.classList.remove('pinching');
                
                if (isDragging) {
                    releaseDrag();
                } else if (grabbedElement) {
                    // It was a quick pinch -> CLICK
                    executeClick(grabbedElement);
                }
                grabbedElement = null;
            }
            prevScrollY = 0; 
        }
    } else {
        // NO HAND
        currentState = 'IDLE';
        document.body.classList.remove('scrolling', 'pinching', 'dragging');
        hudState.textContent = "STATE: IDLE";
        prevScrollY = 0;
        if (isPinching) { isPinching = false; }
        if (isDragging) { releaseDrag(); }
        grabbedElement = null;
    }
    canvasCtx.restore();
}

function releaseDrag() {
    if (isDragging) {
        isDragging = false;
        document.body.classList.remove('dragging');
        if (grabbedElement) {
            grabbedElement.classList.remove('grabbed');
            // Drop it exactly where the hand left it
            // (We don't reset left/top so it stays where it was dropped)
            grabbedElement.style.transform = 'translate(-50%, -50%) scale(1)'; 
        }
    }
}

function render() {
    if (currentState === 'POINTING' || currentState === 'IDLE' || currentState === 'PINCHING' || currentState === 'DRAGGING') {
        cursorCore.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, -50%)`;
        
        const distance = Math.hypot(targetX - ringX, targetY - ringY);
        let lerp = 0.15; 
        if (distance > 80) lerp = 0.85; 
        else if (distance > 30) lerp = 0.5; 

        ringX += (targetX - ringX) * lerp;
        ringY += (targetY - ringY) * lerp;
        cursorRing.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;

        if (!isDragging && Math.abs(targetX - ringX) < 200 && Math.abs(targetY - ringY) < 200) {
            const element = document.elementFromPoint(targetX, targetY);
            const targetCard = element?.closest('.glass-card');

            if (targetCard !== currentHovered) {
                if (currentHovered) currentHovered.classList.remove('hovered');
                if (targetCard) targetCard.classList.add('hovered');
                currentHovered = targetCard;
            }
        }
    } else if (currentState === 'SCROLLING') {
        cursorCore.style.transform = `translate3d(${window.innerWidth/2}px, ${window.innerHeight/2}px, 0) translate(-50%, -50%)`;
        if(currentHovered) { currentHovered.classList.remove('hovered'); currentHovered = null; }
    }

    requestAnimationFrame(render);
}

requestAnimationFrame(render);

// --- INTERACTION FUNCTIONS ---

function executeClick(element) {
    if (element) {
        // Visual flash
        element.style.transform = 'scale(0.9)';
        setTimeout(() => element.style.transform = 'scale(1)', 150);
        
        // Trigger native click
        element.click();
    }
}

function triggerClickTest() {
    const btn = document.getElementById('click-test-btn');
    btn.classList.toggle('clicked');
    if (btn.classList.contains('clicked')) {
        btn.querySelector('h2').textContent = "Clicked!";
    } else {
        btn.querySelector('h2').textContent = "Click Test";
    }
}

function openModal() {
    document.getElementById('image-modal').classList.add('active');
}

function closeModal() {
    document.getElementById('image-modal').classList.remove('active');
}