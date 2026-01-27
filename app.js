// OpenOutdoors - Hiking Trails Progressive Web App
// Main Application Logic

// Geographic constants
const EARTH_CIRCUMFERENCE_METERS = 40075000;
const TILE_SIZE = 256;
const METERS_PER_DEGREE = 111000; // Approximate meters per degree at equator

class TrailsApp {
    constructor() {
        this.map = null;
        this.userMarker = null;
        this.trailLayers = new Map(); // Map trail ID to layer
        this.savedTrails = this.loadSavedTrails();
        this.allTrails = []; // Combined list of all trails
        this.currentLocation = null;
        this.highlightedTrailIds = new Set(); // Changed to Set for multi-selection
        
        // Performance optimization: Cache data structures
        this.trailsById = new Map(); // Quick lookup by ID
        this.savedTrailIds = new Set(); // Quick saved check
        this.parentGroupsByName = new Map(); // Merge parents by name
        
        this.init();
    }

    async init() {
        // Initialize map
        this.initMap();

        // Setup event listeners
        this.setupEventListeners();

        // Load saved trails to allTrails and display them
        this.allTrails = [...this.savedTrails];
        if (this.savedTrails.length > 0) {
            this.displayTrailsOnMap(this.savedTrails);
        }

        // Update UI
        this.updateTrailsUI();

        // Load shared trails from URL if present (async)
        await this.loadSharedTrails();

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
        // Search button - searches in current map view
        document.getElementById('searchBtn').addEventListener('click', () => {
            this.searchTrails();
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

        // Collapse button (mobile)
        const collapseBtn = document.getElementById('collapseBtn');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', () => {
                this.toggleCollapse();
            });
        }
    }

    toggleCollapse() {
        const controlPanel = document.querySelector('.control-panel');
        const collapseBtn = document.getElementById('collapseBtn');
        
        if (!controlPanel || !collapseBtn) {
            return;
        }
        
        const icon = collapseBtn.querySelector('i');
        if (!icon) {
            return;
        }
        
        controlPanel.classList.toggle('collapsed');
        
        if (controlPanel.classList.contains('collapsed')) {
            icon.className = 'fas fa-chevron-down';
            collapseBtn.title = 'Expand trail list';
        } else {
            icon.className = 'fas fa-chevron-up';
            collapseBtn.title = 'Collapse trail list';
        }
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
            },
            (error) => {
                this.showLoading(false);
                this.showToast('Unable to retrieve your location: ' + error.message);
            }
        );
    }

    async searchTrails() {
        this.showLoading(true);
        
        try {
            // Get map bounds for search
            const bounds = this.map.getBounds();
            const south = bounds.getSouth();
            const west = bounds.getWest();
            const north = bounds.getNorth();
            const east = bounds.getEast();

            // Build Overpass query focusing on hiking networks/relations
            const overpassQuery = `
                [out:json][timeout:25];
                (
                    relation["route"="hiking"](${south},${west},${north},${east});
                    relation["route"="foot"](${south},${west},${north},${east});
                    relation["network"="rwn"](${south},${west},${north},${east});
                    relation["network"="nwn"](${south},${west},${north},${east});
                    relation["network"="iwn"](${south},${west},${north},${east});
                );
                out body;
                >;
                out skel qt;
            `;

            // Add timeout to fetch request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

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
            this.processSearchResults(data);
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

            // Build Overpass query for nearby hiking networks/relations
            const overpassQuery = `
                [out:json][timeout:25];
                (
                    relation["route"="hiking"](around:${radiusMeters},${lat},${lon});
                    relation["route"="foot"](around:${radiusMeters},${lat},${lon});
                    relation["network"="rwn"](around:${radiusMeters},${lat},${lon});
                    relation["network"="nwn"](around:${radiusMeters},${lat},${lon});
                    relation["network"="iwn"](around:${radiusMeters},${lat},${lon});
                );
                out body;
                >;
                out skel qt;
            `;

            // Add timeout to fetch request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

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
            this.processSearchResults(data);
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

    processSearchResults(data) {
        // Clear previous layers
        this.clearTrailLayers();

        const ways = {};
        const nodes = {};
        const relations = [];

        // First pass: collect all nodes
        data.elements.forEach(element => {
            if (element.type === 'node') {
                nodes[element.id] = element;
            }
        });

        // Second pass: collect ways
        data.elements.forEach(element => {
            if (element.type === 'way' && element.nodes) {
                const coords = element.nodes
                    .map(nodeId => nodes[nodeId])
                    .filter(node => node && node.lat && node.lon)
                    .map(node => [node.lat, node.lon]);

                if (coords.length > 0) {
                    ways[element.id] = {
                        id: element.id,
                        type: 'way',
                        tags: element.tags || {},
                        coordinates: coords
                    };
                }
            }
        });

        // Third pass: process relations
        data.elements.forEach(element => {
            if (element.type === 'relation') {
                const trail = {
                    id: element.id,
                    type: 'relation',
                    osmType: 'relation',
                    name: element.tags?.name || element.tags?.ref || `Trail ${element.id}`,
                    description: this.getTrailDescription(element.tags),
                    tags: element.tags || {},
                    members: element.members || [],
                    coordinates: [],
                    wayGroups: [], // Array of coordinate arrays, one per way
                    distance: element.tags?.distance || null,
                    isSuperRoute: element.tags?.type === 'superroute',
                    isNetwork: element.tags?.type === 'network'
                };

                // Collect coordinates from member ways - keep them separated by way
                if (element.members) {
                    element.members.forEach(member => {
                        if (member.type === 'way' && ways[member.ref]) {
                            const wayCoords = ways[member.ref].coordinates;
                            trail.wayGroups.push(wayCoords);
                            trail.coordinates.push(...wayCoords); // Keep flat list for bounds calculation
                        }
                    });
                }

                if (trail.coordinates.length > 0) {
                    relations.push(trail);
                }
            }
        });

        // Update allTrails with new search results, preserving saved trails
        const newTrails = relations.filter(trail => 
            !this.savedTrails.some(saved => saved.id === trail.id)
        );
        
        // Keep saved trails and add new search results
        this.allTrails = [...this.savedTrails, ...newTrails];
        
        // Update indexes for fast lookup
        this.updateTrailIndexes();

        // Display trails on map
        this.displayTrailsOnMap(this.allTrails);
        this.updateTrailsUI();

        if (newTrails.length === 0 && this.savedTrails.length === 0) {
            this.showToast('No trails found. Try adjusting the search area or radius.');
        } else {
            this.showToast(`Found ${newTrails.length} new trails!`);
        }
        
        // Automatically fetch and organize parent relations for new trails
        if (newTrails.length > 0) {
            this.organizeTrailHierarchy(newTrails);
        }
    }

    getTrailDescription(tags) {
        const parts = [];
        
        if (tags?.network) {
            const networkNames = {
                'iwn': 'International',
                'nwn': 'National',
                'rwn': 'Regional',
                'lwn': 'Local'
            };
            parts.push(networkNames[tags.network] || tags.network);
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

        return parts.length > 0 ? parts.join(' • ') : 'Hiking trail';
    }

    displayTrailsOnMap(trails) {
        trails.forEach(trail => {
            if (trail.coordinates && trail.coordinates.length > 0) {
                // Check if already on map
                if (this.trailLayers.has(trail.id)) {
                    return;
                }

                const isSaved = this.savedTrails.some(t => t.id === trail.id);
                
                // Use wayGroups if available to draw separate polylines per way, otherwise use coordinates
                let polylineGroup;
                if (trail.wayGroups && trail.wayGroups.length > 0) {
                    // Create a layer group with multiple polylines, one per way
                    const polylines = trail.wayGroups.map(wayCoords => {
                        // Create visible polyline
                        const visibleLine = L.polyline(wayCoords, {
                            color: isSaved ? '#2c7a3f' : '#e74c3c',
                            weight: 4,
                            opacity: 0.7,
                            trailId: trail.id
                        });
                        
                        // Create transparent wider polyline for fat finger support (~20px)
                        const hitLine = L.polyline(wayCoords, {
                            color: 'transparent',
                            weight: 20,
                            opacity: 0,
                            trailId: trail.id,
                            interactive: true
                        });
                        
                        return { visible: visibleLine, hit: hitLine };
                    });
                    
                    // Add both visible and hit polylines to map
                    const allLayers = [];
                    polylines.forEach(({ visible, hit }) => {
                        allLayers.push(visible, hit);
                    });
                    polylineGroup = L.layerGroup(allLayers).addTo(this.map);
                    
                    // Add event handlers to hit polylines for fat finger support
                    polylines.forEach(({ visible, hit }) => {
                        hit.on('mouseover', () => {
                            this.highlightTrail(trail.id, true);
                        });
                        hit.on('mouseout', () => {
                            this.highlightTrail(trail.id, false);
                        });
                        hit.on('click', (e) => {
                            this.handleTrailClick(e, trail.id);
                        });
                    });
                    // Use first polyline for popup
                    polylineGroup.mainPolyline = polylines[0].visible;
                    polylineGroup.allPolylines = polylines.map(p => p.visible);
                    polylineGroup.allHitPolylines = polylines.map(p => p.hit);
                } else {
                    // Fallback to single polyline
                    // Create visible polyline
                    const visibleLine = L.polyline(trail.coordinates, {
                        color: isSaved ? '#2c7a3f' : '#e74c3c',
                        weight: 4,
                        opacity: 0.7,
                        trailId: trail.id
                    });
                    
                    // Create transparent wider polyline for fat finger support (~20px)
                    const hitLine = L.polyline(trail.coordinates, {
                        color: 'transparent',
                        weight: 20,
                        opacity: 0,
                        trailId: trail.id,
                        interactive: true
                    });
                    
                    polylineGroup = L.layerGroup([visibleLine, hitLine]).addTo(this.map);
                    
                    hitLine.on('mouseover', () => {
                        this.highlightTrail(trail.id, true);
                    });
                    hitLine.on('mouseout', () => {
                        this.highlightTrail(trail.id, false);
                    });
                    hitLine.on('click', (e) => {
                        this.handleTrailClick(e, trail.id);
                    });
                    polylineGroup.mainPolyline = visibleLine;
                    polylineGroup.allPolylines = [visibleLine];
                    polylineGroup.allHitPolylines = [hitLine];
                }

                // Create popup content safely
                const popupDiv = document.createElement('div');
                popupDiv.style.minWidth = '200px';
                
                const nameElement = document.createElement('strong');
                nameElement.textContent = trail.name;
                popupDiv.appendChild(nameElement);
                popupDiv.appendChild(document.createElement('br'));
                
                if (trail.distance) {
                    const distanceSpan = document.createElement('span');
                    distanceSpan.style.color = '#2c7a3f';
                    distanceSpan.style.fontWeight = '600';
                    distanceSpan.textContent = `${trail.distance} km`;
                    popupDiv.appendChild(distanceSpan);
                    popupDiv.appendChild(document.createElement('br'));
                }
                
                const descElement = document.createElement('small');
                descElement.textContent = trail.description;
                popupDiv.appendChild(descElement);
                popupDiv.appendChild(document.createElement('br'));
                
                const buttonContainer = document.createElement('div');
                buttonContainer.style.marginTop = '8px';
                buttonContainer.style.display = 'flex';
                buttonContainer.style.gap = '4px';
                
                if (!isSaved) {
                    const saveBtn = document.createElement('button');
                    saveBtn.className = 'popup-btn popup-btn-save';
                    const icon = document.createElement('i');
                    icon.className = 'fas fa-bookmark';
                    saveBtn.appendChild(icon);
                    saveBtn.appendChild(document.createTextNode(' Save'));
                    saveBtn.addEventListener('click', () => this.saveTrail(trail.id));
                    buttonContainer.appendChild(saveBtn);
                }
                
                const osmLink = document.createElement('a');
                osmLink.className = 'popup-btn popup-btn-osm';
                osmLink.href = `https://www.openstreetmap.org/${trail.osmType || 'relation'}/${trail.id}`;
                osmLink.target = '_blank';
                osmLink.rel = 'noopener';
                const osmIcon = document.createElement('i');
                osmIcon.className = 'fas fa-map';
                osmLink.appendChild(osmIcon);
                osmLink.appendChild(document.createTextNode(' OSM'));
                buttonContainer.appendChild(osmLink);
                
                popupDiv.appendChild(buttonContainer);
                
                // Bind popup to the main polyline
                if (polylineGroup.mainPolyline) {
                    polylineGroup.mainPolyline.bindPopup(popupDiv);
                }

                this.trailLayers.set(trail.id, polylineGroup);
            }
        });

        // Fit map to show all trails
        if (this.trailLayers.size > 0) {
            const allLayers = [];
            this.trailLayers.forEach(layerGroup => {
                if (layerGroup.allPolylines) {
                    allLayers.push(...layerGroup.allPolylines);
                } else {
                    allLayers.push(layerGroup);
                }
            });
            const group = L.featureGroup(allLayers);
            this.map.fitBounds(group.getBounds().pad(0.1));
        }
    }

    clearTrailLayers() {
        this.trailLayers.forEach(layer => {
            this.map.removeLayer(layer);
        });
        this.trailLayers.clear();
    }

    highlightTrail(trailId, highlight) {
        // Highlight on map
        const layerGroup = this.trailLayers.get(trailId);
        if (layerGroup) {
            const isSaved = this.savedTrailIds.has(trailId);
            const isSelected = this.highlightedTrailIds.has(trailId);
            
            if (highlight) {
                if (layerGroup.allPolylines) {
                    layerGroup.allPolylines.forEach(polyline => {
                        polyline.setStyle({ 
                            color: '#2196F3', // Blue for hover
                            weight: 6, 
                            opacity: 1 
                        });
                        polyline.bringToFront();
                    });
                } else {
                    layerGroup.setStyle({ 
                        color: '#2196F3', // Blue for hover
                        weight: 6, 
                        opacity: 1 
                    });
                    layerGroup.bringToFront();
                }
            } else if (!isSelected) {
                // Return to original color if not selected
                const color = isSaved ? '#2c7a3f' : '#e74c3c'; // Green for saved, red for searched
                if (layerGroup.allPolylines) {
                    layerGroup.allPolylines.forEach(polyline => {
                        polyline.setStyle({ 
                            color: color,
                            weight: 4, 
                            opacity: 0.7 
                        });
                    });
                } else {
                    layerGroup.setStyle({ 
                        color: color,
                        weight: 4, 
                        opacity: 0.7 
                    });
                }
            }
        }

        // Highlight in list
        const listItem = document.querySelector(`[data-trail-id="${trailId}"]`);
        if (listItem) {
            if (highlight) {
                listItem.classList.add('highlighted');
            } else {
                listItem.classList.remove('highlighted');
            }
        }
    }

    handleTrailClick(e, trailId) {
        // Find all trails at the clicked location
        const clickPoint = e.latlng;
        const overlappingTrails = this.findTrailsAtPoint(clickPoint, 20); // 20px tolerance
        
        if (overlappingTrails.length > 1) {
            // Multiple overlapping trails - select all of them
            overlappingTrails.forEach(id => {
                if (!this.highlightedTrailIds.has(id)) {
                    this.selectTrail(id, false); // Don't focus for multi-select
                }
            });
            // Focus on the first trail in the group (length > 1 is already guaranteed)
            this.focusTrail(overlappingTrails[0]);
        } else {
            // Single trail - toggle selection
            this.toggleTrailHighlight(trailId);
        }
    }

    findTrailsAtPoint(point, tolerancePx = 20) {
        const overlapping = [];
        const toleranceMeters = tolerancePx * (EARTH_CIRCUMFERENCE_METERS / (TILE_SIZE * Math.pow(2, this.map.getZoom())));
        
        this.trailLayers.forEach((layerGroup, trailId) => {
            if (layerGroup.allPolylines) {
                for (const polyline of layerGroup.allPolylines) {
                    if (this.isPointNearPolyline(point, polyline, toleranceMeters)) {
                        overlapping.push(trailId);
                        break;
                    }
                }
            }
        });
        
        return overlapping;
    }

    isPointNearPolyline(point, polyline, tolerance) {
        const latlngs = polyline.getLatLngs();
        for (let i = 0; i < latlngs.length - 1; i++) {
            const dist = this.distanceToSegment(point, latlngs[i], latlngs[i + 1]);
            if (dist <= tolerance) {
                return true;
            }
        }
        return false;
    }

    distanceToSegment(point, start, end) {
        // Calculate distance from point to line segment
        const x = point.lng;
        const y = point.lat;
        const x1 = start.lng;
        const y1 = start.lat;
        const x2 = end.lng;
        const y2 = end.lat;
        
        const A = x - x1;
        const B = y - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) {
            param = dot / lenSq;
        }
        
        let xx, yy;
        
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        
        const dx = x - xx;
        const dy = y - yy;
        
        // Convert to meters (approximate)
        return Math.sqrt(dx * dx + dy * dy) * METERS_PER_DEGREE;
    }

    selectTrail(trailId, shouldFocus = true) {
        this.highlightedTrailIds.add(trailId);
        const layerGroup = this.trailLayers.get(trailId);
        if (layerGroup) {
            if (layerGroup.allPolylines) {
                layerGroup.allPolylines.forEach(polyline => {
                    polyline.setStyle({ 
                        color: '#2196F3', // Blue for selected
                        weight: 6, 
                        opacity: 1 
                    });
                    polyline.bringToFront();
                });
            } else {
                layerGroup.setStyle({ 
                    color: '#2196F3',
                    weight: 6, 
                    opacity: 1 
                });
                layerGroup.bringToFront();
            }
        }
        const listItem = document.querySelector(`[data-trail-id="${trailId}"]`);
        if (listItem) {
            listItem.classList.add('selected');
        }
        
        // Only focus if requested (to avoid multiple focus calls during multi-select)
        if (shouldFocus) {
            this.focusTrail(trailId);
        }
    }

    deselectTrail(trailId) {
        this.highlightedTrailIds.delete(trailId);
        const layerGroup = this.trailLayers.get(trailId);
        if (layerGroup) {
            const isSaved = this.savedTrailIds.has(trailId);
            const color = isSaved ? '#2c7a3f' : '#e74c3c';
            if (layerGroup.allPolylines) {
                layerGroup.allPolylines.forEach(polyline => {
                    polyline.setStyle({ 
                        color: color,
                        weight: 4, 
                        opacity: 0.7 
                    });
                });
            } else {
                layerGroup.setStyle({ 
                    color: color,
                    weight: 4, 
                    opacity: 0.7 
                });
            }
        }
        const listItem = document.querySelector(`[data-trail-id="${trailId}"]`);
        if (listItem) {
            listItem.classList.remove('selected');
        }
    }

    updateTrailsUI() {
        const trailsContainer = document.getElementById('trailsList');
        const trailsCount = document.getElementById('trailsCount');
        
        trailsCount.textContent = this.allTrails.length;

        if (this.allTrails.length === 0) {
            trailsContainer.innerHTML = '<div class="empty-state">No trails found. Use the search button to find trails in the current map view.</div>';
            return;
        }

        // Clear existing content
        trailsContainer.innerHTML = '';

        // Separate trails into those with parents (children) and standalone trails
        // Use Set for O(1) lookups
        const childTrails = new Set();
        const parentTrails = [];
        
        this.allTrails.forEach(trail => {
            if (trail.childRelations && trail.childRelations.length > 0) {
                parentTrails.push(trail);
                trail.childRelations.forEach(child => childTrails.add(child.id));
            }
        });
        
        const standaloneTrails = this.allTrails.filter(t => 
            !childTrails.has(t.id) && (!t.childRelations || t.childRelations.length === 0)
        );

        // Sort: saved trails first, then alphabetically by name
        // Use cached savedTrailIds for O(1) checks
        const sortTrails = (trails) => trails.sort((a, b) => {
            const aIsSaved = this.savedTrailIds.has(a.id);
            const bIsSaved = this.savedTrailIds.has(b.id);
            if (aIsSaved && !bIsSaved) return -1;
            if (!aIsSaved && bIsSaved) return 1;
            return a.name.localeCompare(b.name);
        });

        const sortedParents = sortTrails([...parentTrails]);
        const sortedStandalone = sortTrails([...standaloneTrails]);

        // Display parent routes with their children
        sortedParents.forEach(parent => {
            this.createParentTrailElement(parent, trailsContainer);
        });

        // Display standalone trails
        sortedStandalone.forEach(trail => {
            this.createTrailElement(trail, trailsContainer, false);
        });
    }

    createParentTrailElement(parent, container) {
        const isSaved = this.savedTrailIds.has(parent.id);
        
        // Parent container
        const parentContainer = document.createElement('div');
        parentContainer.className = 'parent-trail-container';
        parentContainer.style.marginBottom = '0.5rem';
        
        // Parent trail item
        const parentItem = document.createElement('div');
        parentItem.className = 'trail-item parent-trail';
        parentItem.setAttribute('data-trail-id', parent.id);
        if (parent.isSuperRoute || parent.isNetwork) {
            parentItem.style.backgroundColor = '#f0f8ff';
        }
        
        // Trail info section
        const trailInfo = document.createElement('div');
        trailInfo.className = 'trail-info';
        
        const trailName = document.createElement('div');
        trailName.className = 'trail-name';
        
        // Add collapse/expand icon (collapsed by default)
        const expandIcon = document.createElement('i');
        expandIcon.className = 'fas fa-chevron-right';
        expandIcon.style.marginRight = '0.5rem';
        expandIcon.style.cursor = 'pointer';
        trailName.appendChild(expandIcon);
        
        const nameText = document.createTextNode(parent.name);
        trailName.appendChild(nameText);
        
        if (isSaved) {
            const bookmarkIcon = document.createElement('i');
            bookmarkIcon.className = 'fas fa-bookmark';
            bookmarkIcon.style.fontSize = '0.8em';
            bookmarkIcon.style.marginLeft = '0.3rem';
            trailName.appendChild(bookmarkIcon);
        }
        
        if (parent.isSuperRoute) {
            const superIcon = document.createElement('i');
            superIcon.className = 'fas fa-layer-group';
            superIcon.style.fontSize = '0.8em';
            superIcon.style.marginLeft = '0.3rem';
            superIcon.style.color = '#9c27b0';
            trailName.appendChild(superIcon);
        }
        
        if (parent.isNetwork) {
            const networkIcon = document.createElement('i');
            networkIcon.className = 'fas fa-project-diagram';
            networkIcon.style.fontSize = '0.8em';
            networkIcon.style.marginLeft = '0.3rem';
            networkIcon.style.color = '#2196F3';
            trailName.appendChild(networkIcon);
        }
        
        const trailDetails = document.createElement('div');
        trailDetails.className = 'trail-details';
        if (parent.distance) {
            const distanceSpan = document.createElement('span');
            distanceSpan.className = 'trail-distance';
            distanceSpan.textContent = `${parent.distance} km`;
            trailDetails.appendChild(distanceSpan);
            trailDetails.appendChild(document.createTextNode(' • '));
        }
        const description = parent.description || 'Route';
        trailDetails.appendChild(document.createTextNode(`${parent.childRelations.length} routes • ${description}`));
        
        trailInfo.appendChild(trailName);
        trailInfo.appendChild(trailDetails);
        trailInfo.addEventListener('click', () => this.toggleTrailHighlight(parent.id));
        
        // Trail actions section
        const trailActions = document.createElement('div');
        trailActions.className = 'trail-actions';
        
        if (!isSaved) {
            const saveBtn = document.createElement('button');
            saveBtn.className = 'save-btn';
            saveBtn.title = 'Save parent and all children';
            saveBtn.setAttribute('aria-label', 'Save parent route');
            const saveIcon = document.createElement('i');
            saveIcon.className = 'fas fa-bookmark';
            saveBtn.appendChild(saveIcon);
            saveBtn.appendChild(document.createTextNode(' All'));
            saveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.saveParentRoute(parent.id);
            });
            trailActions.appendChild(saveBtn);
        } else {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.title = 'Remove parent route';
            removeBtn.setAttribute('aria-label', 'Remove parent');
            const removeIcon = document.createElement('i');
            removeIcon.className = 'fas fa-trash';
            removeBtn.appendChild(removeIcon);
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeTrail(parent.id);
            });
            trailActions.appendChild(removeBtn);
        }
        
        const osmBtn = document.createElement('button');
        osmBtn.className = 'osm-btn';
        osmBtn.title = 'View on OpenStreetMap';
        osmBtn.setAttribute('aria-label', 'View on OSM');
        const osmIcon = document.createElement('i');
        osmIcon.className = 'fas fa-map';
        osmBtn.appendChild(osmIcon);
        osmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(`https://www.openstreetmap.org/${parent.osmType || 'relation'}/${parent.id}`, '_blank');
        });
        trailActions.appendChild(osmBtn);
        
        parentItem.appendChild(trailInfo);
        parentItem.appendChild(trailActions);
        parentContainer.appendChild(parentItem);
        
        // Children container (collapsible, collapsed by default)
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'children-container';
        childrenContainer.style.marginLeft = '1.5rem';
        childrenContainer.style.borderLeft = '2px solid #9c27b0';
        childrenContainer.style.paddingLeft = '0.5rem';
        childrenContainer.style.display = 'none'; // Collapsed by default
        
        parent.childRelations.forEach(child => {
            this.createTrailElement(child, childrenContainer, true);
        });
        
        parentContainer.appendChild(childrenContainer);
        
        // Toggle collapse/expand
        expandIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            if (childrenContainer.style.display === 'none' || childrenContainer.style.display === '') {
                childrenContainer.style.display = 'block';
                expandIcon.className = 'fas fa-chevron-down';
            } else {
                childrenContainer.style.display = 'none';
                expandIcon.className = 'fas fa-chevron-right';
            }
        });
        
        // Add hover listeners to parent
        parentItem.addEventListener('mouseenter', () => {
            this.highlightTrail(parent.id, true);
        });
        parentItem.addEventListener('mouseleave', () => {
            this.highlightTrail(parent.id, false);
        });
        parentItem.addEventListener('touchstart', () => {
            this.highlightTrail(parent.id, true);
        });
        
        container.appendChild(parentContainer);
    }

    createTrailElement(trail, container, isChild = false) {
        const isSaved = this.savedTrailIds.has(trail.id);
        
        // Create trail item
        const trailItem = document.createElement('div');
        trailItem.className = 'trail-item';
        if (isChild) {
            trailItem.className += ' child-trail';
        }
        trailItem.setAttribute('data-trail-id', trail.id);
        
        // Trail info section
        const trailInfo = document.createElement('div');
        trailInfo.className = 'trail-info';
        
        const trailName = document.createElement('div');
        trailName.className = 'trail-name';
        trailName.textContent = trail.name;
        if (isSaved) {
            const bookmarkIcon = document.createElement('i');
            bookmarkIcon.className = 'fas fa-bookmark';
            bookmarkIcon.style.fontSize = '0.8em';
            trailName.appendChild(document.createTextNode(' '));
            trailName.appendChild(bookmarkIcon);
        }
        
        const trailDetails = document.createElement('div');
        trailDetails.className = 'trail-details';
        if (trail.distance) {
            const distanceSpan = document.createElement('span');
            distanceSpan.className = 'trail-distance';
            distanceSpan.textContent = `${trail.distance} km`;
            trailDetails.appendChild(distanceSpan);
            trailDetails.appendChild(document.createTextNode(' • '));
        }
        trailDetails.appendChild(document.createTextNode(trail.description));
        
        trailInfo.appendChild(trailName);
        trailInfo.appendChild(trailDetails);
        trailInfo.addEventListener('click', () => this.toggleTrailHighlight(trail.id));
        
        // Trail actions section
        const trailActions = document.createElement('div');
        trailActions.className = 'trail-actions';
        
        if (!isSaved) {
            const saveBtn = document.createElement('button');
            saveBtn.className = 'save-btn';
            saveBtn.title = 'Save trail';
            saveBtn.setAttribute('aria-label', 'Save trail');
            const saveIcon = document.createElement('i');
            saveIcon.className = 'fas fa-bookmark';
            saveBtn.appendChild(saveIcon);
            saveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.saveTrail(trail.id);
            });
            trailActions.appendChild(saveBtn);
        } else {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.title = 'Remove trail';
            removeBtn.setAttribute('aria-label', 'Remove trail');
            const removeIcon = document.createElement('i');
            removeIcon.className = 'fas fa-trash';
            removeBtn.appendChild(removeIcon);
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeTrail(trail.id);
            });
            trailActions.appendChild(removeBtn);
        }
        
        const osmBtn = document.createElement('button');
        osmBtn.className = 'osm-btn';
        osmBtn.title = 'View on OpenStreetMap';
        osmBtn.setAttribute('aria-label', 'View on OSM');
        const osmIcon = document.createElement('i');
        osmIcon.className = 'fas fa-map';
        osmBtn.appendChild(osmIcon);
        osmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(`https://www.openstreetmap.org/${trail.osmType || 'relation'}/${trail.id}`, '_blank');
        });
        trailActions.appendChild(osmBtn);
        
        trailItem.appendChild(trailInfo);
        trailItem.appendChild(trailActions);
        container.appendChild(trailItem);
        
        // Add hover listeners
        trailItem.addEventListener('mouseenter', () => {
            this.highlightTrail(trail.id, true);
        });
        trailItem.addEventListener('mouseleave', () => {
            this.highlightTrail(trail.id, false);
        });
        // Touch support
        trailItem.addEventListener('touchstart', () => {
            this.highlightTrail(trail.id, true);
        });
    }

    toggleTrailHighlight(trailId) {
        // Toggle highlighting
        if (this.highlightedTrailIds.has(trailId)) {
            // Deselect this trail
            this.deselectTrail(trailId);
        } else {
            // Select this trail - focus is handled by selectTrail
            this.selectTrail(trailId);
        }
    }

    focusTrail(trailId) {
        const trail = this.trailsById.get(trailId);
        
        if (!trail) {
            return;
        }
        
        // If this is a parent-only route (no coordinates), focus on its children
        if (trail.isParentOnly && trail.childRelations && trail.childRelations.length > 0) {
            // Collect all children coordinates
            const allCoords = [];
            trail.childRelations.forEach(child => {
                if (child.coordinates && child.coordinates.length > 0) {
                    allCoords.push(...child.coordinates);
                }
            });
            
            if (allCoords.length > 0) {
                const bounds = L.latLngBounds(allCoords);
                this.map.fitBounds(bounds.pad(0.2));
            }
            return;
        }
        
        if (trail.coordinates && trail.coordinates.length > 0) {
            const bounds = L.latLngBounds(trail.coordinates);
            this.map.fitBounds(bounds.pad(0.2));
            
            // Open popup if layer exists
            const layerGroup = this.trailLayers.get(trailId);
            if (layerGroup && layerGroup.mainPolyline && layerGroup.mainPolyline.openPopup) {
                layerGroup.mainPolyline.openPopup();
            }
        }
    }

    saveTrail(trailId) {
        const trail = this.trailsById.get(trailId);
        
        if (!trail) {
            return;
        }

        // Check if already saved using cached Set
        if (this.savedTrailIds.has(trail.id)) {
            this.showToast('Trail already saved!');
            return;
        }

        this.savedTrails.push(trail);
        this.saveSavedTrails();
        
        // Update trail color on map
        const layerGroup = this.trailLayers.get(trailId);
        if (layerGroup) {
            if (layerGroup.allPolylines) {
                layerGroup.allPolylines.forEach(polyline => {
                    polyline.setStyle({ color: '#2c7a3f' });
                });
            } else {
                layerGroup.setStyle({ color: '#2c7a3f' });
            }
        }
        
        this.updateTrailsUI();
        this.showToast(`Saved: ${trail.name}`);
    }

    removeTrail(trailId) {
        this.savedTrails = this.savedTrails.filter(t => t.id != trailId);
        this.saveSavedTrails();
        
        // Remove from allTrails if it was only saved (not from search)
        this.allTrails = this.allTrails.filter(t => t.id != trailId);
        this.updateTrailIndexes();
        
        // Remove from map
        const layer = this.trailLayers.get(trailId);
        if (layer) {
            this.map.removeLayer(layer);
            this.trailLayers.delete(trailId);
        }
        
        this.updateTrailsUI();
        this.showToast('Trail removed');
    }

    clearSavedTrails() {
        if (this.savedTrails.length === 0) {
            this.showToast('No saved trails to clear');
            return;
        }

        if (confirm('Are you sure you want to clear all saved trails?')) {
            // Remove saved trails from map and allTrails
            this.savedTrails.forEach(trail => {
                const layer = this.trailLayers.get(trail.id);
                if (layer) {
                    this.map.removeLayer(layer);
                    this.trailLayers.delete(trail.id);
                }
            });
            
            // Use cached Set for faster filtering
            this.allTrails = this.allTrails.filter(t => !this.savedTrailIds.has(t.id));
            this.updateTrailIndexes();
            
            this.savedTrails = [];
            this.saveSavedTrails();
            this.updateTrailsUI();
            this.showToast('All trails cleared');
        }
    }

    loadSavedTrails() {
        try {
            const saved = localStorage.getItem('openoutdoors_trails');
            const trails = saved ? JSON.parse(saved) : [];
            // Update cache
            this.savedTrailIds = new Set(trails.map(t => t.id));
            return trails;
        } catch (error) {
            console.error('Error loading saved trails:', error);
            return [];
        }
    }

    saveSavedTrails() {
        try {
            localStorage.setItem('openoutdoors_trails', JSON.stringify(this.savedTrails));
            // Update cache
            this.savedTrailIds = new Set(this.savedTrails.map(t => t.id));
        } catch (error) {
            console.error('Error saving trails:', error);
            this.showToast('Error saving trails');
        }
    }
    
    // Helper method to update trail indexes
    updateTrailIndexes() {
        this.trailsById.clear();
        this.allTrails.forEach(trail => {
            this.trailsById.set(trail.id, trail);
        });
    }

    shareTrails() {
        if (this.savedTrails.length === 0) {
            this.showToast('No trails to share. Save some trails first!');
            return;
        }

        // Get current map bounds
        const bounds = this.map.getBounds();
        const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
        
        // Create a compressed representation using OSM refs only
        const trailRefs = this.savedTrails.map(trail => trail.id).join(',');
        
        const shareUrl = `${window.location.origin}${window.location.pathname}?refs=${trailRefs}&bbox=${bbox}`;

        // Check URL length
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
        // Create a better fallback dialog using DOM methods
        const toast = document.getElementById('toast');
        
        // Clear previous content
        toast.textContent = '';
        
        const container = document.createElement('div');
        container.style.textAlign = 'left';
        
        const title = document.createElement('strong');
        title.textContent = 'Share Link:';
        container.appendChild(title);
        container.appendChild(document.createElement('br'));
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = url;
        input.readOnly = true;
        input.style.width = '100%';
        input.style.margin = '8px 0';
        input.style.padding = '8px';
        input.style.border = '1px solid #ccc';
        input.style.borderRadius = '4px';
        input.addEventListener('click', () => input.select());
        container.appendChild(input);
        
        const hint = document.createElement('small');
        hint.textContent = 'Click the link to select, then copy it manually';
        container.appendChild(hint);
        
        toast.appendChild(container);
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            toast.textContent = ''; // Reset to text content
        }, 10000); // Show for 10 seconds
    }

    async loadSharedTrails() {
        const urlParams = new URLSearchParams(window.location.search);
        const refsParam = urlParams.get('refs');
        const bboxParam = urlParams.get('bbox');
        const trailsParam = urlParams.get('trails'); // Keep backward compatibility

        // New format: OSM refs
        if (refsParam) {
            try {
                this.showLoading(true);
                const refs = refsParam.split(',').map(ref => ref.trim()).filter(ref => ref);
                
                // Set map bounds if provided
                if (bboxParam) {
                    const [south, west, north, east] = bboxParam.split(',').map(parseFloat);
                    if (!isNaN(south) && !isNaN(west) && !isNaN(north) && !isNaN(east)) {
                        this.map.fitBounds([[south, west], [north, east]]);
                    }
                }
                
                // Fetch trails from OSM
                const trails = await this.fetchTrailsByRefs(refs);
                
                if (trails.length > 0) {
                    // Merge with existing saved trails
                    trails.forEach(trail => {
                        if (!this.savedTrails.some(t => t.id === trail.id)) {
                            this.savedTrails.push(trail);
                        }
                    });

                    this.saveSavedTrails();
                    this.allTrails = [...this.savedTrails];
                    
                    // Display shared trails on map
                    this.displayTrailsOnMap(trails);
                    this.updateTrailsUI();

                    this.showToast(`Loaded ${trails.length} shared trails!`);
                } else {
                    this.showToast('No trails could be loaded from shared link');
                }
                
                this.showLoading(false);
                
                // Clean URL
                window.history.replaceState({}, document.title, window.location.pathname);
            } catch (error) {
                console.error('Error loading shared trails:', error);
                this.showToast('Error loading shared trails');
                this.showLoading(false);
            }
            return;
        }
        
        // Old format: full trail data (backward compatibility)
        if (trailsParam) {
            try {
                const trailsData = JSON.parse(decodeURIComponent(trailsParam));
                const trails = trailsData.map(t => ({
                    id: t.i,
                    type: 'relation',
                    osmType: t.ot || 'relation',
                    name: t.n,
                    description: t.d,
                    coordinates: t.c,
                    wayGroups: t.wg || [],
                    distance: t.di,
                    tags: {}
                }));

                // Merge with existing saved trails
                trails.forEach(trail => {
                    if (!this.savedTrails.some(t => t.id === trail.id)) {
                        this.savedTrails.push(trail);
                    }
                });

                this.saveSavedTrails();
                this.allTrails = [...this.savedTrails];
                
                // Display shared trails on map
                this.displayTrailsOnMap(trails);
                this.updateTrailsUI();

                this.showToast(`Loaded ${trails.length} shared trails!`);

                // Clean URL
                window.history.replaceState({}, document.title, window.location.pathname);
            } catch (error) {
                console.error('Error loading shared trails:', error);
                this.showToast('Error loading shared trails');
            }
        }
    }

    async fetchTrailsByRefs(refs) {
        try {
            // Build Overpass query to fetch specific relations by ID
            const relationIds = refs.map(ref => `relation(${ref});`).join('\n                    ');
            const overpassQuery = `
                [out:json][timeout:25];
                (
                    ${relationIds}
                );
                out body;
                >;
                out skel qt;
            `;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

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
            
            // Process the response similar to processSearchResults
            const ways = {};
            const nodes = {};
            const trails = [];

            // First pass: collect all nodes
            data.elements.forEach(element => {
                if (element.type === 'node') {
                    nodes[element.id] = element;
                }
            });

            // Second pass: collect ways
            data.elements.forEach(element => {
                if (element.type === 'way' && element.nodes) {
                    const coords = element.nodes
                        .map(nodeId => nodes[nodeId])
                        .filter(node => node && node.lat && node.lon)
                        .map(node => [node.lat, node.lon]);

                    if (coords.length > 0) {
                        ways[element.id] = {
                            id: element.id,
                            type: 'way',
                            tags: element.tags || {},
                            coordinates: coords
                        };
                    }
                }
            });

            // Third pass: process relations
            data.elements.forEach(element => {
                if (element.type === 'relation') {
                    const trail = {
                        id: element.id,
                        type: 'relation',
                        osmType: 'relation',
                        name: element.tags?.name || element.tags?.ref || `Trail ${element.id}`,
                        description: this.getTrailDescription(element.tags),
                        tags: element.tags || {},
                        members: element.members || [],
                        coordinates: [],
                        wayGroups: [],
                        distance: element.tags?.distance || null
                    };

                    // Collect coordinates from member ways - keep them separated by way
                    if (element.members) {
                        element.members.forEach(member => {
                            if (member.type === 'way' && ways[member.ref]) {
                                const wayCoords = ways[member.ref].coordinates;
                                trail.wayGroups.push(wayCoords);
                                trail.coordinates.push(...wayCoords);
                            }
                        });
                    }

                    if (trail.coordinates.length > 0) {
                        trails.push(trail);
                    }
                }
            });

            return trails;
        } catch (error) {
            console.error('Error fetching trails by refs:', error);
            throw error;
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

    async fetchParentRelations(relationId, skipDelay = false) {
        try {
            // Add 200ms delay to avoid overloading OSM API (unless skipDelay is true)
            if (!skipDelay && this.lastApiCallTime) {
                const timeSinceLastCall = Date.now() - this.lastApiCallTime;
                if (timeSinceLastCall < 200) {
                    await new Promise(resolve => setTimeout(resolve, 200 - timeSinceLastCall));
                }
            }
            this.lastApiCallTime = Date.now();
            
            const response = await fetch(`https://www.openstreetmap.org/api/0.6/relation/${relationId}/relations`);
            
            if (!response.ok) {
                if (response.status === 404) {
                    // No parent relations found
                    return [];
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const xmlText = await response.text();
            
            // Check if response is empty or invalid
            if (!xmlText || xmlText.trim().length === 0) {
                console.warn(`Empty response for relation ${relationId}`);
                return [];
            }
            
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
            
            // Check for parsing errors
            const parserError = xmlDoc.getElementsByTagName('parsererror');
            if (parserError.length > 0) {
                console.error('XML parsing error:', parserError[0].textContent);
                return [];
            }
            
            const relationElements = xmlDoc.getElementsByTagName('relation');
            const parents = [];
            
            // Check if relationElements is valid
            if (!relationElements || relationElements.length === 0) {
                // No parent relations found (empty OSM response is valid)
                return [];
            }
            
            for (let i = 0; i < relationElements.length; i++) {
                const relationElement = relationElements[i];
                const id = relationElement.getAttribute('id');
                const tags = {};
                
                const tagElements = relationElement.getElementsByTagName('tag');
                for (let j = 0; j < tagElements.length; j++) {
                    const tagElement = tagElements[j];
                    tags[tagElement.getAttribute('k')] = tagElement.getAttribute('v');
                }
                
                // Only include if it's a route, superroute, or network
                if (tags.type === 'route' || tags.type === 'superroute' || tags.type === 'network') {
                    parents.push({
                        id: parseInt(id),
                        tags: tags,
                        name: tags.name || tags.ref || `Relation ${id}`,
                        isSuperRoute: tags.type === 'superroute',
                        isNetwork: tags.type === 'network'
                    });
                }
            }
            
            return parents;
        } catch (error) {
            console.error('Error fetching parent relations:', error);
            return [];
        }
    }

    async organizeTrailHierarchy(trails) {
        try {
            this.showLoading(true);
            this.showToast('Fetching parent routes...');
            
            // Track which trails have been processed to avoid loops
            const processed = new Set();
            const parentMap = new Map(); // Map of parent ID to children
            const parentsByName = new Map(); // Map of parent name to parent IDs (for merging)
            
            // Process trails in batches with rate limiting
            // Process up to 3 at a time to speed things up while respecting rate limit
            const batchSize = 3;
            for (let i = 0; i < trails.length; i += batchSize) {
                const batch = trails.slice(i, i + batchSize);
                const promises = batch.map(async (trail) => {
                    if (processed.has(trail.id)) return null;
                    
                    try {
                        const parents = await this.fetchParentRelations(trail.id);
                        
                        if (parents.length > 0) {
                            trail.parentRelations = parents;
                            processed.add(trail.id);
                            return { trail, parents };
                        }
                    } catch (error) {
                        console.warn(`Failed to fetch parent relations for trail ${trail.id}:`, error);
                        // Continue processing other trails even if this one fails
                    }
                    return null;
                });
                
                const results = await Promise.all(promises);
                
                // Group by parent ID and track parent names
                results.forEach(result => {
                    if (result) {
                        result.parents.forEach(parent => {
                            if (!parentMap.has(parent.id)) {
                                parentMap.set(parent.id, []);
                            }
                            parentMap.get(parent.id).push(result.trail);
                            
                            // Track parent name for merging
                            if (!parentsByName.has(parent.name)) {
                                parentsByName.set(parent.name, []);
                            }
                            if (!parentsByName.get(parent.name).includes(parent.id)) {
                                parentsByName.get(parent.name).push(parent.id);
                            }
                        });
                    }
                });
            }
            
            // Create parent route objects from the OSM API data (don't fetch from Overpass)
            // Merge parents with the same name
            this.parentGroupsByName.clear();
            
            for (const [parentName, parentIds] of parentsByName.entries()) {
                // Collect all children from all parents with this name
                const allChildren = new Set();
                const parentInfos = [];
                
                parentIds.forEach(parentId => {
                    const children = parentMap.get(parentId) || [];
                    children.forEach(child => allChildren.add(child));
                    
                    // Get parent info from ANY child that has it (not just first)
                    let parentInfo = null;
                    for (const child of children) {
                        parentInfo = child.parentRelations?.find(p => p.id === parentId);
                        if (parentInfo) {
                            break;
                        }
                    }
                    
                    if (parentInfo) {
                        parentInfos.push({ id: parentId, info: parentInfo });
                    }
                });
                
                if (parentInfos.length > 0 && allChildren.size > 0) {
                    const childrenArray = Array.from(allChildren);
                    
                    // Use the first parent's info as the primary
                    const primaryParentInfo = parentInfos[0].info;
                    const primaryParentId = parentInfos[0].id;
                    
                    // Check if parent already exists in allTrails
                    const existingParent = this.trailsById.get(primaryParentId);
                    
                    if (!existingParent) {
                        const parentTrail = {
                            id: primaryParentId,
                            type: 'relation',
                            osmType: 'relation',
                            name: parentName,
                            description: this.getTrailDescription(primaryParentInfo.tags),
                            tags: primaryParentInfo.tags,
                            members: [],
                            coordinates: [], // No coordinates for parent-only display
                            wayGroups: [],
                            distance: primaryParentInfo.tags?.distance || null,
                            isSuperRoute: primaryParentInfo.isSuperRoute,
                            isNetwork: primaryParentInfo.isNetwork,
                            childRelations: childrenArray,
                            isParentOnly: true, // Flag to indicate this is a lightweight parent
                            mergedParentIds: parentIds // Track all merged parent IDs
                        };
                        this.allTrails.push(parentTrail);
                        this.trailsById.set(primaryParentId, parentTrail);
                        console.log(`Created parent group: ${parentName} with ${childrenArray.length} children`);
                    } else {
                        // Update existing parent with children
                        existingParent.childRelations = childrenArray;
                        existingParent.mergedParentIds = parentIds;
                        console.log(`Updated existing parent: ${parentName} with ${childrenArray.length} children`);
                    }
                    
                    this.parentGroupsByName.set(parentName, {
                        parentId: primaryParentId,
                        children: childrenArray
                    });
                } else {
                    // Log when we can't create a parent group
                    if (allChildren.size > 0 && parentInfos.length === 0) {
                        console.warn(`Parent "${parentName}" has children but no parent info found`);
                    }
                }
            }
            
            this.showLoading(false);
            this.updateTrailsUI();
        } catch (error) {
            console.error('Error organizing trail hierarchy:', error);
            this.showLoading(false);
            // Still update UI even if there were errors
            this.updateTrailsUI();
        }
    }

    saveParentRoute(parentId) {
        const parent = this.trailsById.get(parentId);
        
        if (!parent) {
            return;
        }
        
        // Save the parent using cached Set for faster checks
        if (!this.savedTrailIds.has(parent.id)) {
            this.savedTrails.push(parent);
        }
        
        // Save all children
        if (parent.childRelations) {
            parent.childRelations.forEach(child => {
                if (!this.savedTrailIds.has(child.id)) {
                    this.savedTrails.push(child);
                }
                
                // Update child trail color on map
                const layerGroup = this.trailLayers.get(child.id);
                if (layerGroup) {
                    if (layerGroup.allPolylines) {
                        layerGroup.allPolylines.forEach(polyline => {
                            polyline.setStyle({ color: '#2c7a3f' });
                        });
                    } else {
                        layerGroup.setStyle({ color: '#2c7a3f' });
                    }
                }
            });
        }
        
        this.saveSavedTrails();
        this.updateTrailsUI();
        
        const childCount = parent.childRelations ? parent.childRelations.length : 0;
        this.showToast(`Saved ${parent.name} with ${childCount} child routes`);
    }
}

// Initialize the app
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new TrailsApp();
});
