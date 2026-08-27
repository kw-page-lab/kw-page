function setupSidebar() {}

// Setup Easter Egg logic
function setupEasterEgg() {
    const easterEggWord = document.getElementById('easter-egg-word');
    if (!easterEggWord) return;

    let isEasterEggActiveText = false;

    // Handle manual click
    easterEggWord.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (isEasterEggActiveText) {
            // Precise moment: Send trigger over WebSocket & locally fallback
            sendEasterEggWsMessage();
            
            // Display visual glitch animation to signal activation
            easterEggWord.style.letterSpacing = '6px';
            easterEggWord.style.color = '#ffffff';
            easterEggWord.style.textShadow = '0 0 15px #ffffff';
            setTimeout(() => {
                easterEggWord.style.letterSpacing = '';
                easterEggWord.style.color = '#f60101';
                easterEggWord.style.textShadow = '0 0 12px rgba(246, 1, 1, 0.9)';
            }, 350);
        } else {
            // Normal state: Open macrostasis.dev in new tab
            window.open('https://macrostasis.dev', '_blank');
        }
    });

    // WebSocket broadcast sender
    function sendEasterEggWsMessage() {
        const wsUrl = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" 
            ? "ws://localhost:8088" 
            : "wss://kimeraware.macrostasis.dev/ws";
        
        try {
            const tempSocket = new WebSocket(wsUrl);
            tempSocket.onopen = () => {
                tempSocket.send(JSON.stringify({ type: 'trigger_easter_egg' }));
                console.log('[Easter Egg] Sent trigger_easter_egg WS payload to server');
                setTimeout(() => tempSocket.close(), 1000);
            };
            tempSocket.onerror = (err) => {
                console.warn('[Easter Egg] WebSocket connection failed, running local fallback:', err);
                if (typeof window.triggerEasterEgg === 'function') {
                    window.triggerEasterEgg();
                }
            };
        } catch (err) {
            console.error('[Easter Egg] Failed to create WebSocket, running local fallback:', err);
            if (typeof window.triggerEasterEgg === 'function') {
                window.triggerEasterEgg();
            }
        }
    }

    // Loop to randomly swap text from metacodex to macrostasis
    function queueNextEasterEggWindow() {
        // Random delay between 15 and 35 seconds
        const delay = 15000 + Math.random() * 20000;
        
        setTimeout(() => {
            // Set active state
            isEasterEggActiveText = true;
            easterEggWord.textContent = 'macrostasis';
            easterEggWord.style.color = '#f60101'; // Accent red
            easterEggWord.style.textShadow = '0 0 12px rgba(246, 1, 1, 0.9)';
            
            // Stay active for 2.5 seconds
            setTimeout(() => {
                isEasterEggActiveText = false;
                easterEggWord.textContent = 'metacodex';
                easterEggWord.style.color = '';
                easterEggWord.style.textShadow = '';
                
                // Queue next occurrence
                queueNextEasterEggWindow();
            }, 2500);
            
        }, delay);
    }

    // Start the background schedule loop
    queueNextEasterEggWindow();
}

// Setup Scroll Down Hint
function setupScrollHint() {
    const hint = document.getElementById('scroll-hint-indicator');
    if (!hint) return;

    const pageLoadTime = Date.now();
    let hasInteracted = false;
    
    // Show scroll hint after 4 seconds of idle time at load
    let scrollHintTimeout = setTimeout(() => {
        if (!hasInteracted && !isTVFocused) {
            hint.classList.add('show');
        }
    }, 4000);

    function handleUserInteraction() {
        if (hasInteracted) return;
        // Ignore interactions within the first 800ms of page load (e.g. lingering touch from reload tap)
        if (Date.now() - pageLoadTime < 800) return;
        
        hasInteracted = true;
        
        clearTimeout(scrollHintTimeout);
        hint.classList.remove('show');
        
        // Remove all tracking listeners immediately to clean up memory/processing
        window.removeEventListener('mousedown', handleUserInteraction);
        window.removeEventListener('keydown', handleUserInteraction);
        window.removeEventListener('touchstart', handleUserInteraction);
        window.removeEventListener('wheel', handleUserInteraction);
    }

    // Register listeners (Excluding mousemove to prevent auto-cancellation on load/hover)
    window.addEventListener('mousedown', handleUserInteraction, { passive: true });
    window.addEventListener('keydown', handleUserInteraction, { passive: true });
    window.addEventListener('touchstart', handleUserInteraction, { passive: true });
    window.addEventListener('wheel', handleUserInteraction, { passive: true });
}

// UI Setup and Sync
function syncUI() {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    const setInnerText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };
    const setChecked = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = val;
    };
    const setDisplay = (id, display) => {
        const el = document.getElementById(id);
        if (el) el.style.display = display;
    };

    setVal('boxWidth', params.width);
    setInnerText('boxWidthVal', params.width.toFixed(1));
    
    setVal('boxHeight', params.height);
    setInnerText('boxHeightVal', params.height.toFixed(2));
    
    setVal('boxDepth', params.depth);
    setInnerText('boxDepthVal', params.depth.toFixed(1));

    setChecked('autoRotate', params.autoRotate);
    setVal('rotateSpeed', params.rotateSpeed);
    setInnerText('rotateSpeedVal', params.rotateSpeed.toFixed(1));
    setChecked('particles', params.particles);
    setChecked('mouseLight', params.interiorLight);
    setChecked('performanceMode', params.performanceMode);

    setVal('blackOffset', params.blackOffset);
    setInnerText('blackOffsetVal', params.blackOffset.toFixed(3));
    setVal('whiteOffset', params.whiteOffset);
    setInnerText('whiteOffsetVal', params.whiteOffset.toFixed(3));
    setVal('redOffset', params.redOffset);
    setInnerText('redOffsetVal', params.redOffset.toFixed(2));
    setVal('animMult', params.animMult);
    setInnerText('animMultVal', params.animMult.toFixed(1));

    setChecked('autoTime', params.autoTime);
    setVal('timeOfDay', params.timeOfDay);
    setDisplay('timeSliderRow', params.autoTime ? 'none' : 'block');
}

function setupUIEventListeners() {
    const addInputListener = (id, callback) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', callback);
    };
    const addChangeListener = (id, callback) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', callback);
    };

    addInputListener('boxWidth', e => {
        params.width = parseFloat(e.target.value);
        const valEl = document.getElementById('boxWidthVal');
        if (valEl) valEl.innerText = params.width.toFixed(1);
        if (cuboidGroup) cuboidGroup.scale.x = params.width / 2.0;
    });
    addInputListener('boxHeight', e => {
        params.height = parseFloat(e.target.value);
        const valEl = document.getElementById('boxHeightVal');
        if (valEl) valEl.innerText = params.height.toFixed(2);
        if (cuboidGroup) cuboidGroup.scale.y = params.height / 3.92;
    });
    addInputListener('boxDepth', e => {
        params.depth = parseFloat(e.target.value);
        const valEl = document.getElementById('boxDepthVal');
        if (valEl) valEl.innerText = params.depth.toFixed(1);
        if (cuboidGroup) cuboidGroup.scale.z = params.depth / 2.0;
    });

    addChangeListener('autoRotate', e => {
        params.autoRotate = e.target.checked;
    });
    addInputListener('rotateSpeed', e => {
        params.rotateSpeed = parseFloat(e.target.value);
        const valEl = document.getElementById('rotateSpeedVal');
        if (valEl) valEl.innerText = params.rotateSpeed.toFixed(1);
    });
    addChangeListener('particles', e => {
        params.particles = e.target.checked;
        starField.visible = params.particles;
    });
    addChangeListener('mouseLight', e => {
        params.interiorLight = e.target.checked;
        updateInteriorLights();
    });
    addChangeListener('performanceMode', e => {
        params.performanceMode = e.target.checked;
        updateGLBMaterials();
    });

    addInputListener('blackOffset', e => {
        params.blackOffset = parseFloat(e.target.value);
        const valEl = document.getElementById('blackOffsetVal');
        if (valEl) valEl.innerText = params.blackOffset.toFixed(3);
        updateMeshPositions();
    });
    addInputListener('whiteOffset', e => {
        params.whiteOffset = parseFloat(e.target.value);
        const valEl = document.getElementById('whiteOffsetVal');
        if (valEl) valEl.innerText = params.whiteOffset.toFixed(3);
        updateMeshPositions();
    });
    addInputListener('redOffset', e => {
        params.redOffset = parseFloat(e.target.value);
        const valEl = document.getElementById('redOffsetVal');
        if (valEl) valEl.innerText = params.redOffset.toFixed(2);
        updateMeshPositions();
    });
    addInputListener('animMult', e => {
        params.animMult = parseFloat(e.target.value);
        const valEl = document.getElementById('animMultVal');
        if (valEl) valEl.innerText = params.animMult.toFixed(1);
    });

    addChangeListener('autoTime', e => {
        params.autoTime = e.target.checked;
        const rowEl = document.getElementById('timeSliderRow');
        if (rowEl) rowEl.style.display = params.autoTime ? 'none' : 'block';
        updateEnvironmentFromTime();
    });

    addInputListener('timeOfDay', e => {
        params.timeOfDay = parseFloat(e.target.value);
        const hrs = Math.floor(params.timeOfDay);
        const mins = Math.floor((params.timeOfDay - hrs) * 60);
        const valEl = document.getElementById('timeOfDayVal');
        if (valEl) {
            valEl.innerText = (hrs < 10 ? '0' + hrs : hrs) + ':' + (mins < 10 ? '0' + mins : mins);
        }
        updateEnvironmentFromTime();
    });

    window.addEventListener('wheel', e => {
        if (isTVFocused) {
            // In Act 1 mode, if they scroll UP, exit focus and snap up to monolith! (only if focus lock is enabled)
            if (document.body.classList.contains('act1-focus-lock') && typeof window.act1Factor !== 'undefined' && window.act1Factor > 0.5) {
                if (e.deltaY < 0) { // scroll up
                    console.log('[Act 1] Wheel scroll up detected while focused on TV. Triggering zoom-out.');
                    isTVFocused = false;
                    isExitingTV = true;
                    tvExitStartTime = Date.now();
                    window.currentExitTargetX = currentTvYaw;
                    const tvCenterY = getTVCenterY();
                    window.currentExitTargetY = tvCenterY + currentTvPitch;
                    
                    isCameraLocked = true;
                    scrollProgress = 1.0;
                    targetScrollProgress = 1.0; // Keep Y at TV level during zoom-out
                    window.act1ScrollUpPending = true; // Trigger vertical scroll-up on completion
                    updateCameraLockUI();
                }
                return;
            }

            const baseDist = getTVTargetFocusDistance();
            const exitThreshold = baseDist - 0.3;
            const minFocusLimit = baseDist - 0.4;
            const maxFocusLimit = baseDist * 1.5;

            if (e.deltaY < 0) { // scroll up (zoom in / exit focus)
                if (tvTargetFocusDistance <= exitThreshold) {
                    isTVFocused = false;
                    isExitingTV = true;
                    tvExitStartTime = Date.now();
                    window.currentExitTargetX = currentTvYaw;
                    const tvCenterY = getTVCenterY();
                    window.currentExitTargetY = tvCenterY + currentTvPitch;
                    
                    isCameraLocked = true;
                    targetScrollProgress = 0; // Snap up
                    updateCameraLockUI();
                } else {
                    tvTargetFocusDistance = Math.max(minFocusLimit, tvTargetFocusDistance - 0.3);
                }
            } else if (e.deltaY > 0) { // scroll down (zoom out)
                tvTargetFocusDistance = Math.min(maxFocusLimit, tvTargetFocusDistance + 0.3);
            }
            return;
        }
        if (!isCameraLocked) return;
        // Ignore scroll wheels if a scroll transition or exit focus is currently active to prevent interruption
        if (Math.abs(scrollProgress - targetScrollProgress) > 0.005 || isExitingTV) return;
        if (e.deltaY > 0) {
            targetScrollProgress = 1; // Snap down
        } else if (e.deltaY < 0) {
            targetScrollProgress = 0; // Snap up
        }
    }, { passive: true });

    // Touch drag support for mobile devices to snap transition
    let touchStartYLocal = 0;
    window.addEventListener('touchstart', e => {
        if (isExitingTV) return;
        // In Act 1, track swipe starting point even when focused on TV
        if (!isCameraLocked && !isTVFocused) return;
        if (e.touches.length === 1) {
            touchStartYLocal = e.touches[0].pageY;
        }
    }, { passive: true });

    window.addEventListener('touchmove', e => {
        if (isTVFocused) {
            if (e.touches.length === 1) {
                const touchY = e.touches[0].pageY;
                const deltaY = touchStartYLocal - touchY;
                
                // In Act 1 mode, exit focus on a simple swipe up (only if focus lock is enabled)
                if (document.body.classList.contains('act1-focus-lock') && typeof window.act1Factor !== 'undefined' && window.act1Factor > 0.5) {
                    if (deltaY < -15) { // Swipe up / drag down gesture
                        console.log('[Act 1] Touch swipe up detected while focused on TV. Triggering zoom-out.');
                        isTVFocused = false;
                        isExitingTV = true;
                        tvExitStartTime = Date.now();
                        window.currentExitTargetX = currentTvYaw;
                        const tvCenterY = getTVCenterY();
                        window.currentExitTargetY = tvCenterY + currentTvPitch;
                        
                        isCameraLocked = true;
                        scrollProgress = 1.0;
                        targetScrollProgress = 1.0; // Keep Y at TV level during zoom-out
                        window.act1ScrollUpPending = true; // Trigger vertical scroll-up on completion
                        updateCameraLockUI();
                    }
                    return;
                }

                const exitThresholdTouch = getTVTargetFocusDistance() - 0.3;
                if (tvTargetFocusDistance <= exitThresholdTouch && deltaY < -80) { // Require larger drag down when zoomed in to exit focus on mobile
                    isTVFocused = false;
                    isExitingTV = true;
                    tvExitStartTime = Date.now();
                    window.currentExitTargetX = currentTvYaw;
                    const tvCenterY = getTVCenterY();
                    window.currentExitTargetY = tvCenterY + currentTvPitch;
                    
                    isCameraLocked = true;
                    targetScrollProgress = 0;
                    updateCameraLockUI();
                }
            }
            return;
        }
        if (!isCameraLocked) return;
        // Ignore touch-swipe transitions if one is currently active
        if (Math.abs(scrollProgress - targetScrollProgress) > 0.005 || isExitingTV) return;
        if (e.touches.length === 1) {
            const touchY = e.touches[0].pageY;
            const deltaY = touchStartYLocal - touchY;
            // Trigger snap only on deliberate drag movements
            if (deltaY > 15) {
                targetScrollProgress = 1; // Snap down
            } else if (deltaY < -15) {
                targetScrollProgress = 0; // Snap up
            }
        }
    }, { passive: true });
}

// Update Camera Lock button UI (🔒 / 🔓 SVGs)
function updateCameraLockUI() {
    const svgLocked = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;
    const svgUnlocked = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/></svg>`;
    const lockIcon = document.getElementById('camera-lock-icon');
    if (lockIcon) {
        lockIcon.innerHTML = isCameraLocked ? svgLocked : svgUnlocked;
    }
}

// Setup Neobrutalism Carousel with Pagination controls and Responsive Collapsible Drawer
function setupNeobrutalismCarousel() {
    const container = document.getElementById('neobrutalism-tv-carousel-container');
    const track = document.getElementById('nb-carousel-track');
    const viewport = document.getElementById('nb-carousel-viewport');
    const prevBtn = document.getElementById('nb-prev-btn');
    const nextBtn = document.getElementById('nb-next-btn');
    const pageBtns = document.querySelectorAll('.nb-page-btn');
    const counterEl = document.getElementById('nb-card-counter');
    const activeBadge = document.getElementById('nb-active-badge');
    const slides = document.querySelectorAll('.nb-carousel-slide');
    const toggleBtn = document.getElementById('nb-toggle-drawer-btn');
    const closeBtn = document.getElementById('nb-close-card-btn');
    const toggleIcon = document.getElementById('nb-toggle-icon');
    const toggleText = document.getElementById('nb-toggle-text');

    if (!track || !slides.length) return;

    let currentIndex = 0;
    const totalSlides = slides.length;
    let isCollapsed = false;

    function setDrawerCollapsed(collapsed) {
        isCollapsed = collapsed;
        if (!container) return;

        if (isCollapsed) {
            container.classList.add('is-collapsed');
            if (toggleIcon) toggleIcon.textContent = '▶';
            if (toggleText) toggleText.textContent = 'NOTICIAS';
            if (toggleBtn) {
                toggleBtn.setAttribute('title', 'Abrir noticias y anuncios');
                toggleBtn.classList.add('is-collapsed-tab');
            }
        } else {
            container.classList.remove('is-collapsed');
            if (toggleIcon) toggleIcon.textContent = '◀';
            if (toggleText) toggleText.textContent = 'NOTICIAS';
            if (toggleBtn) {
                toggleBtn.setAttribute('title', 'Ocultar noticias');
                toggleBtn.classList.remove('is-collapsed-tab');
            }
        }
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setDrawerCollapsed(!isCollapsed);
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setDrawerCollapsed(true);
        });
    }

    function goToSlide(index) {
        if (index < 0) index = 0;
        if (index >= totalSlides) index = totalSlides - 1;
        currentIndex = index;

        track.style.transform = `translateX(-${currentIndex * 100}%)`;

        // Update slide active classes to ensure perfect visual isolation
        slides.forEach((slide, idx) => {
            if (idx === currentIndex) {
                slide.classList.add('is-active-slide');
            } else {
                slide.classList.remove('is-active-slide');
            }
        });

        // Update pagination buttons active state
        pageBtns.forEach((btn, idx) => {
            if (idx === currentIndex) {
                btn.classList.add('is-active');
            } else {
                btn.classList.remove('is-active');
            }
        });

        // Update Prev / Next disabled states
        if (prevBtn) prevBtn.disabled = currentIndex === 0;
        if (nextBtn) nextBtn.disabled = currentIndex === totalSlides - 1;

        // Update Counter
        if (counterEl) {
            counterEl.textContent = `${currentIndex + 1} / ${totalSlides}`;
        }

        // Update Badge Text and Class
        const curSlide = slides[currentIndex];
        if (curSlide && activeBadge) {
            const badgeText = curSlide.getAttribute('data-badge') || `CARD ${currentIndex + 1}`;
            const badgeClass = curSlide.getAttribute('data-badge-class') || 'nb-badge-yellow';
            activeBadge.textContent = badgeText;
            activeBadge.className = `nb-badge ${badgeClass}`;
        }
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            goToSlide(currentIndex - 1);
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            goToSlide(currentIndex + 1);
        });
    }

    pageBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pageIndex = parseInt(btn.getAttribute('data-page'), 10);
            if (!isNaN(pageIndex)) {
                goToSlide(pageIndex);
            }
        });
    });

    // Touch swipe gesture for the carousel viewport
    let touchStartX = 0;
    let touchEndX = 0;

    if (viewport) {
        viewport.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                touchStartX = e.touches[0].clientX;
            }
        }, { passive: true });

        viewport.addEventListener('touchend', (e) => {
            if (e.changedTouches.length === 1) {
                touchEndX = e.changedTouches[0].clientX;
                const diffX = touchStartX - touchEndX;
                if (diffX > 35) {
                    goToSlide(currentIndex + 1);
                } else if (diffX < -35) {
                    goToSlide(currentIndex - 1);
                }
            }
        }, { passive: true });
    }

    // Reset collapsed state when transitioning to desktop
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && isCollapsed) {
            setDrawerCollapsed(false);
        }
    });

    // Initialize slide 0 & default state (collapsed by default on mobile, open on desktop)
    goToSlide(0);
    const startCollapsed = window.innerWidth <= 768;
    setDrawerCollapsed(startCollapsed);
}

