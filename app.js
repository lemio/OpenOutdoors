// OpenOutdoors - Hiking Trails Progressive Web App
// Main Application Logic

class TrailsApp {
    constructor() {
        this.map = null;
        this.userMarker = null;
        this.trailLayers = [];
        this.savedTrails = this.loadSavedTrails();
        this.searchResults = [];
        this.currentLocation = null;

        this.init();
    }

    init() {
        // Initialize map
        this.initMap();

        // Load shared trails from URL if present
        this.loadSharedTrails();

        // Setup event listeners
        this.setupEventListeners();

        // Update UI
        this.updateSavedTrailsUI();

        // Register service worker for PWA
        this.registerServiceWorker();
    }

    initMap() {
        // Create map centered on a default location
        this.map = L.map('map').setView([51.505, -0.09], 10);

        // Add OpenStreetMap tile layer
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(this.map);
    }

    setupEventListeners() {
        // Search button
        document.getElementById('searchBtn').addEventListener('click', () => {
            this.searchTrails();
        });

        // Enter key on search input
        document.getElementById('searchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.searchTrails();
            }
        });

        // My Location button
        document.getElementById('locationBtn').addEventListener('click', () => {
            this.showMyLocation();
        });

        // Nearby trails button
        document.getElementById('nearbyBtn').addEventListener('click', () => {
            this.findNearbyTrails();
        });

        // Share button
        document.getElementById('shareBtn').addEventListener('click', () => {
            this.shareTrails();
        });

        // Clear button
        document.getElementById('clearBtn').addEventListener('click', () => {
            this.clearSavedTrails();
        });
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (show) {
            loading.classList.remove('hidden');
        } else {
            loading.classList.add('hidden');
        }
    }

    showToast(message) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    showMyLocation() {
        if (!navigator.geolocation) {
            this.showToast('Geolocation is not supported by your browser');
            return;
        }

        this.showLoading(true);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                this.currentLocation = { lat, lon };

                // Remove old marker
                if (this.userMarker) {
                    this.map.removeLayer(this.userMarker);
                }

                // Add new marker
                this.userMarker = L.marker([lat, lon], {
                    icon: L.divIcon({
                        className: 'user-location-marker',
                        html: '<div style="background-color: #5a9fd4; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>',
                        iconSize: [20, 20]
                    })
                }).addTo(this.map);

                // Center map on user location
                this.map.setView([lat, lon], 13);
                this.showLoading(false);
                this.showToast('Location found!');
            },
            (error) => {
                this.showLoading(false);
                this.showToast('Unable to retrieve your location: ' + error.message);
            }
        );
    }

    async searchTrails() {
        const query = document.getElementById('searchInput').value.trim();
        
        if (!query) {
            this.showToast('Please enter a search term');
            return;
        }

        this.showLoading(true);
        
        try {
            // Get map bounds for search
            const bounds = this.map.getBounds();
            const south = bounds.getSouth();
            const west = bounds.getWest();
            const north = bounds.getNorth();
            const east = bounds.getEast();

            // Build Overpass query for hiking trails
            const overpassQuery = `
                [out:json][timeout:25];
                (
                    way["route"="hiking"](${south},${west},${north},${east});
                    way["highway"="path"]["sac_scale"](${south},${west},${north},${east});
                    way["highway"="footway"]["trail_visibility"](${south},${west},${north},${east});
                    relation["route"="hiking"](${south},${west},${north},${east});
                );
                out body;
                >;
                out skel qt;
            `;

            // Add timeout to fetch request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: overpassQuery,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.processSearchResults(data, query);
        } catch (error) {
            console.error('Search error:', error);
            if (error.name === 'AbortError') {
                this.showToast('Search timed out. Please try a smaller area.');
            } else {
                this.showToast('Error searching trails. Please try again.');
            }
        } finally {
            this.showLoading(false);
        }
    }

    async findNearbyTrails() {
        if (!this.currentLocation) {
            this.showToast('Please enable location first');
            return;
        }

        this.showLoading(true);

        try {
            const radius = document.getElementById('searchRadius').value;
            const radiusMeters = radius * 1000;
            const { lat, lon } = this.currentLocation;

            // Build Overpass query for nearby hiking trails
            const overpassQuery = `
                [out:json][timeout:25];
                (
                    way["route"="hiking"](around:${radiusMeters},${lat},${lon});
                    way["highway"="path"]["sac_scale"](around:${radiusMeters},${lat},${lon});
                    way["highway"="footway"]["trail_visibility"](around:${radiusMeters},${lat},${lon});
                    relation["route"="hiking"](around:${radiusMeters},${lat},${lon});
                );
                out body;
                >;
                out skel qt;
            `;

            // Add timeout to fetch request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: overpassQuery,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.processSearchResults(data, 'nearby trails');
        } catch (error) {
            console.error('Nearby search error:', error);
            if (error.name === 'AbortError') {
                this.showToast('Search timed out. Please try a smaller radius.');
            } else {
                this.showToast('Error finding nearby trails. Please try again.');
            }
        } finally {
            this.showLoading(false);
        }
    }

    processSearchResults(data, query) {
        // Clear previous results
        this.clearTrailLayers();
        this.searchResults = [];

        const ways = {};
        const nodes = {};

        // First pass: collect all nodes
        data.elements.forEach(element => {
            if (element.type === 'node') {
                nodes[element.id] = element;
            }
        });

        // Second pass: process ways and relations
        data.elements.forEach(element => {
            if (element.type === 'way' && element.nodes) {
                const coords = element.nodes
                    .map(nodeId => nodes[nodeId])
                    .filter(node => node && node.lat && node.lon)
                    .map(node => [node.lat, node.lon]);

                if (coords.length > 0) {
                    const trail = {
                        id: element.id,
                        type: 'way',
                        name: element.tags?.name || element.tags?.ref || `Trail ${element.id}`,
                        description: this.getTrailDescription(element.tags),
                        tags: element.tags,
                        coordinates: coords
                    };

                    this.searchResults.push(trail);
                    ways[element.id] = trail;
                }
            } else if (element.type === 'relation' && element.tags?.type === 'route') {
                // Process relation (collection of ways)
                const trail = {
                    id: element.id,
                    type: 'relation',
                    name: element.tags?.name || element.tags?.ref || `Trail ${element.id}`,
                    description: this.getTrailDescription(element.tags),
                    tags: element.tags,
                    members: element.members
                };

                this.searchResults.push(trail);
            }
        });

        // Display results on map
        this.displayTrailsOnMap(this.searchResults);
        this.updateSearchResultsUI();

        if (this.searchResults.length === 0) {
            this.showToast('No trails found. Try adjusting the search area or radius.');
        } else {
            this.showToast(`Found ${this.searchResults.length} trails!`);
        }
    }

    getTrailDescription(tags) {
        const parts = [];
        
        if (tags?.distance) {
            parts.push(`${tags.distance} km`);
        }
        if (tags?.sac_scale) {
            parts.push(`Difficulty: ${tags.sac_scale}`);
        }
        if (tags?.trail_visibility) {
            parts.push(`Visibility: ${tags.trail_visibility}`);
        }
        if (tags?.surface) {
            parts.push(`Surface: ${tags.surface}`);
        }
        if (tags?.highway) {
            parts.push(`Type: ${tags.highway}`);
        }

        return parts.length > 0 ? parts.join(' • ') : 'Hiking trail';
    }

    displayTrailsOnMap(trails) {
        trails.forEach(trail => {
            if (trail.coordinates && trail.coordinates.length > 0) {
                const polyline = L.polyline(trail.coordinates, {
                    color: '#e74c3c',
                    weight: 4,
                    opacity: 0.7
                }).addTo(this.map);

                polyline.bindPopup(`
                    <div style="min-width: 200px;">
                        <strong>${trail.name}</strong><br>
                        <small>${trail.description}</small><br>
                        <button onclick="app.saveTrail('${trail.id}')" style="margin-top: 8px; padding: 4px 12px; background: #2c7a3f; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            💾 Save Trail
                        </button>
                    </div>
                `);

                this.trailLayers.push(polyline);
            }
        });

        // Fit map to show all trails
        if (this.trailLayers.length > 0) {
            const group = L.featureGroup(this.trailLayers);
            this.map.fitBounds(group.getBounds().pad(0.1));
        }
    }

    clearTrailLayers() {
        this.trailLayers.forEach(layer => {
            this.map.removeLayer(layer);
        });
        this.trailLayers = [];
    }

    updateSearchResultsUI() {
        const resultsContainer = document.getElementById('searchResults');
        const resultsCount = document.getElementById('resultsCount');
        
        resultsCount.textContent = this.searchResults.length;

        if (this.searchResults.length === 0) {
            resultsContainer.innerHTML = '<div class="empty-state">No trails found</div>';
            return;
        }

        resultsContainer.innerHTML = this.searchResults.map(trail => `
            <div class="trail-item" onclick="app.focusTrail('${trail.id}')">
                <div class="trail-info">
                    <div class="trail-name">${trail.name}</div>
                    <div class="trail-details">${trail.description}</div>
                </div>
                <div class="trail-actions">
                    <button onclick="event.stopPropagation(); app.saveTrail('${trail.id}')">💾</button>
                </div>
            </div>
        `).join('');
    }

    focusTrail(trailId) {
        const trail = this.searchResults.find(t => t.id == trailId) || 
                     this.savedTrails.find(t => t.id == trailId);
        
        if (trail && trail.coordinates && trail.coordinates.length > 0) {
            const bounds = L.latLngBounds(trail.coordinates);
            this.map.fitBounds(bounds.pad(0.2));
        }
    }

    saveTrail(trailId) {
        const trail = this.searchResults.find(t => t.id == trailId);
        
        if (!trail) {
            return;
        }

        // Check if already saved
        if (this.savedTrails.some(t => t.id === trail.id)) {
            this.showToast('Trail already saved!');
            return;
        }

        this.savedTrails.push(trail);
        this.saveSavedTrails();
        this.updateSavedTrailsUI();
        this.showToast(`Saved: ${trail.name}`);
    }

    removeTrail(trailId) {
        this.savedTrails = this.savedTrails.filter(t => t.id != trailId);
        this.saveSavedTrails();
        this.updateSavedTrailsUI();
        this.showToast('Trail removed');
    }

    updateSavedTrailsUI() {
        const savedContainer = document.getElementById('savedTrailsList');
        const savedCount = document.getElementById('savedCount');
        
        savedCount.textContent = this.savedTrails.length;

        if (this.savedTrails.length === 0) {
            savedContainer.innerHTML = '<div class="empty-state">No saved trails</div>';
            return;
        }

        savedContainer.innerHTML = this.savedTrails.map(trail => `
            <div class="trail-item" onclick="app.focusTrail('${trail.id}')">
                <div class="trail-info">
                    <div class="trail-name">${trail.name}</div>
                    <div class="trail-details">${trail.description}</div>
                </div>
                <div class="trail-actions">
                    <button class="remove" onclick="event.stopPropagation(); app.removeTrail('${trail.id}')">🗑️</button>
                </div>
            </div>
        `).join('');
    }

    clearSavedTrails() {
        if (this.savedTrails.length === 0) {
            this.showToast('No saved trails to clear');
            return;
        }

        if (confirm('Are you sure you want to clear all saved trails?')) {
            this.savedTrails = [];
            this.saveSavedTrails();
            this.updateSavedTrailsUI();
            this.showToast('All trails cleared');
        }
    }

    loadSavedTrails() {
        try {
            const saved = localStorage.getItem('openoutdoors_trails');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('Error loading saved trails:', error);
            return [];
        }
    }

    saveSavedTrails() {
        try {
            localStorage.setItem('openoutdoors_trails', JSON.stringify(this.savedTrails));
        } catch (error) {
            console.error('Error saving trails:', error);
            this.showToast('Error saving trails');
        }
    }

    shareTrails() {
        if (this.savedTrails.length === 0) {
            this.showToast('No trails to share. Save some trails first!');
            return;
        }

        // Create a compressed representation of trails
        const trailsData = this.savedTrails.map(trail => ({
            i: trail.id,
            n: trail.name,
            d: trail.description,
            c: trail.coordinates
        }));

        const encoded = encodeURIComponent(JSON.stringify(trailsData));
        const shareUrl = `${window.location.origin}${window.location.pathname}?trails=${encoded}`;

        // Check URL length (most browsers support ~2048 chars, be conservative)
        if (shareUrl.length > 2000) {
            this.showToast('Too many trails to share via URL. Try sharing fewer trails.');
            console.warn('Share URL too long:', shareUrl.length, 'characters');
            return;
        }

        // Copy to clipboard
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareUrl).then(() => {
                this.showToast('Share link copied to clipboard!');
            }).catch(() => {
                this.showShareDialog(shareUrl);
            });
        } else {
            this.showShareDialog(shareUrl);
        }
    }

    showShareDialog(url) {
        // Create a better fallback dialog instead of using prompt()
        const toast = document.getElementById('toast');
        toast.innerHTML = `
            <div style="text-align: left;">
                <strong>Share Link:</strong><br>
                <input type="text" value="${url.replace(/"/g, '&quot;')}" 
                       readonly 
                       style="width: 100%; margin: 8px 0; padding: 8px; border: 1px solid #ccc; border-radius: 4px;"
                       onclick="this.select()">
                <small>Click the link to select, then copy it manually</small>
            </div>
        `;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            toast.textContent = ''; // Reset to text content
        }, 10000); // Show for 10 seconds
    }

    loadSharedTrails() {
        const urlParams = new URLSearchParams(window.location.search);
        const trailsParam = urlParams.get('trails');

        if (!trailsParam) {
            return;
        }

        try {
            const trailsData = JSON.parse(decodeURIComponent(trailsParam));
            const trails = trailsData.map(t => ({
                id: t.i,
                name: t.n,
                description: t.d,
                coordinates: t.c
            }));

            // Merge with existing saved trails
            trails.forEach(trail => {
                if (!this.savedTrails.some(t => t.id === trail.id)) {
                    this.savedTrails.push(trail);
                }
            });

            this.saveSavedTrails();
            this.updateSavedTrailsUI();

            // Display shared trails on map
            this.displayTrailsOnMap(trails);

            this.showToast(`Loaded ${trails.length} shared trails!`);

            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (error) {
            console.error('Error loading shared trails:', error);
            this.showToast('Error loading shared trails');
        }
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/service-worker.js')
                    .then(registration => {
                        console.log('ServiceWorker registered:', registration);
                    })
                    .catch(error => {
                        console.log('ServiceWorker registration failed:', error);
                    });
            });
        }
    }
}

// Initialize the app
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new TrailsApp();
});
