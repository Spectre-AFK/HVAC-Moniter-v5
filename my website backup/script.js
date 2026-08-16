// Initialize typewriter when page loads
window.addEventListener('load', () => {
    startTypewriter();
});

// Typewriter Effect for Hero
const phrases = [
    "Software Developer",
    "Cyber Security Student",
    "HVAC/R Technician",
    "Problem Solver"
];

let phraseIndex = 0;
let charIndex = 0;
let isDeleting = false;
const typewriterElement = document.getElementById('typewriter');

function startTypewriter() {
    if (!typewriterElement) return;
    const currentPhrase = phrases[phraseIndex];

    if (isDeleting) {
        charIndex--;
        typewriterElement.textContent = currentPhrase.substring(0, charIndex);
    } else {
        typewriterElement.textContent = currentPhrase.substring(0, charIndex + 1);
        charIndex++;
    }

    let typeSpeed = isDeleting ? 50 : 100;

    if (!isDeleting && charIndex === currentPhrase.length) {
        typeSpeed = 2000; // Pause at end
        isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        typeSpeed = 500;
    }

    setTimeout(startTypewriter, typeSpeed);
}

// Sticky nav shadow on scroll
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
    if (!navbar) return;
    navbar.classList.toggle('scrolled', window.scrollY > 10);
});

// Mobile Menu Toggle
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileMenu = document.getElementById('mobile-menu');

mobileMenuBtn.addEventListener('click', () => {
    mobileMenu.classList.toggle('hidden');
});

// Close mobile menu when clicking a link
mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
    });
});

// Smooth scroll for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Animate skill bars into view
const skillBars = document.querySelectorAll('.skill-progress');
if (skillBars.length) {
    const skillObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const bar = entry.target;
                bar.style.width = bar.dataset.width || bar.style.width;
                skillObserver.unobserve(bar);
            }
        });
    }, { threshold: 0.4 });

    skillBars.forEach(bar => {
        bar.dataset.width = bar.style.width;
        bar.style.width = '0%';
        skillObserver.observe(bar);
    });
}

// --- IOT WIDGET LOGIC ---
const SUPABASE_URL = "https://swbcwtrijguodjaxyitm.supabase.co"; // <-- Paste your Supabase URL
const SUPABASE_ANON_KEY = "sb_publishable_iVV7-ht6QWT2cqYg_MxWfg_cdPRWd2Y"; // <-- Paste your Supabase Anon Key
const SENSOR_INDEX = 0;

let tempChart = null; 

function initChart() {
    const ctx = document.getElementById('tempChart');
    if (!ctx) return;

    tempChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                data: [],
                borderColor: '#d97706',
                backgroundColor: 'rgba(217, 119, 6, 0.1)',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { display: false },
                y: { display: false, min: 60, max: 100 }
            },
            animation: { duration: 0 }
        }
    });
}

async function fetchIoTData() {
    try {
        // Fetch the last 20 readings directly from Supabase via REST API
        const response = await fetch(`${SUPABASE_URL}/rest/v1/sensor_data?sensor_index=eq.${SENSOR_INDEX}&select=*&order=timestamp.desc&limit=20`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error("Database request failed");
        
        const data = await response.json(); 
        
        if (!data || data.length === 0) return;

        // Supabase returns newest first. We grab the newest for the text, 
        // and reverse the array so the chart draws left-to-right (oldest to newest).
        const currentData = data[0];
        const historyData = [...data].reverse();

        const tempElement = document.getElementById("live-temp");
        const timeElement = document.getElementById("live-time");
        const dotElement = document.getElementById("live-dot");
        const statusText = document.getElementById("live-status-text");
        
        // Handle potential column naming differences (temperature vs value)
        // added conversion from Celsius to Fahrenheit 8/12/26 
        const tempC = parseFloat(currentData.temperature_c);
        const tempFloat = (tempC * 9/5) + 32;

        if (isNaN(tempFloat)) {
            timeElement.innerText = "WAITING FOR DATA...";
            return;
}

        tempElement.innerHTML = `${tempFloat.toFixed(1)}°<span class="text-3xl">F</span>`;

        // Color thresholds
        if (tempFloat > 85) {
            tempElement.style.color = "#dc2626";
            dotElement.style.backgroundColor = "#dc2626";
            dotElement.style.boxShadow = "0 0 8px rgba(220,38,38,0.6)";
            statusText.style.color = "#dc2626";
            if (tempChart) tempChart.data.datasets[0].borderColor = "#dc2626";
        } else if (tempFloat < 65) {
            tempElement.style.color = "#2563eb";
            dotElement.style.backgroundColor = "#2563eb";
            dotElement.style.boxShadow = "0 0 8px rgba(37,99,235,0.6)";
            statusText.style.color = "#2563eb";
            if (tempChart) tempChart.data.datasets[0].borderColor = "#2563eb";
        } else {
            tempElement.style.color = "#d97706";
            dotElement.style.backgroundColor = "#d97706";
            dotElement.style.boxShadow = "0 0 8px rgba(217,119,6,0.6)";
            statusText.style.color = "#d97706";
            if (tempChart) tempChart.data.datasets[0].borderColor = "#d97706";
        }

        // Update the live time text
        const date = new Date(currentData.timestamp);
        timeElement.innerText = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // Update the chart arrays
        if (tempChart) {
            tempChart.data.labels = historyData.map(r => r.timestamp);
            // Map the chart data, converting each historical reading to Fahrenheit
            tempChart.data.datasets[0].data = historyData.map(r => (parseFloat(r.temperature_c) * 9/5) + 32);
            tempChart.update();
        }
        
    } catch (error) {
        console.error("IoT Widget offline:", error);
    }
}

// Boot up sequence
if (document.getElementById("live-temp")) {
    initChart();
    fetchIoTData();
    setInterval(fetchIoTData, 10000);
}