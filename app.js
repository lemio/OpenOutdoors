// OpenOutdoors - Hiking Trails Progressive Web App
// Main Application Logic

class TrailsApp {
    constructor() {
        this.map = null;
        this.userMarker = null;
        this.trailLayers = new Map(); // Map trail ID to layer
        this.savedTrails = this.loadSavedTrails();
        this.allTrails = []; // Combined list of all trails
        this.currentLocation = null;
        this.highlightedTrailId = null;

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
        const icon = collapseBtn.querySelector('i');
        
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
                    distance: element.tags?.distance || null
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

        // Display trails on map
        this.displayTrailsOnMap(this.allTrails);
        this.updateTrailsUI();

        if (newTrails.length === 0 && this.savedTrails.length === 0) {
            this.showToast('No trails found. Try adjusting the search area or radius.');
        } else {
            this.showToast(`Found ${newTrails.length} new trails!`);
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
                        return L.polyline(wayCoords, {
                            color: isSaved ? '#2c7a3f' : '#e74c3c',
                            weight: 4,
                            opacity: 0.7,
                            trailId: trail.id
                        });
                    });
                    polylineGroup = L.layerGroup(polylines).addTo(this.map);
                    // Add event handlers to all polylines in the group
                    polylines.forEach(polyline => {
                        polyline.on('mouseover', () => {
                            this.highlightTrail(trail.id, true);
                        });
                        polyline.on('mouseout', () => {
                            this.highlightTrail(trail.id, false);
                        });
                        polyline.on('click', () => {
                            this.focusTrail(trail.id);
                        });
                    });
                    // Use first polyline for popup
                    polylineGroup.mainPolyline = polylines[0];
                    polylineGroup.allPolylines = polylines;
                } else {
                    // Fallback to single polyline
                    polylineGroup = L.polyline(trail.coordinates, {
                        color: isSaved ? '#2c7a3f' : '#e74c3c',
                        weight: 4,
                        opacity: 0.7,
                        trailId: trail.id
                    }).addTo(this.map);
                    
                    polylineGroup.on('mouseover', () => {
                        this.highlightTrail(trail.id, true);
                    });
                    polylineGroup.on('mouseout', () => {
                        this.highlightTrail(trail.id, false);
                    });
                    polylineGroup.on('click', () => {
                        this.focusTrail(trail.id);
                    });
                    polylineGroup.mainPolyline = polylineGroup;
                    polylineGroup.allPolylines = [polylineGroup];
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
            const isSaved = this.savedTrails.some(t => t.id === trailId);
            if (highlight) {
                if (layerGroup.allPolylines) {
                    layerGroup.allPolylines.forEach(polyline => {
                        polyline.setStyle({ weight: 6, opacity: 1 });
                        polyline.bringToFront();
                    });
                } else {
                    layerGroup.setStyle({ weight: 6, opacity: 1 });
                    layerGroup.bringToFront();
                }
            } else {
                if (layerGroup.allPolylines) {
                    layerGroup.allPolylines.forEach(polyline => {
                        polyline.setStyle({ weight: 4, opacity: 0.7 });
                    });
                } else {
                    layerGroup.setStyle({ weight: 4, opacity: 0.7 });
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

        // Sort: saved trails first, then alphabetically by name
        const sortedTrails = [...this.allTrails].sort((a, b) => {
            const aIsSaved = this.savedTrails.some(t => t.id === a.id);
            const bIsSaved = this.savedTrails.some(t => t.id === b.id);
            if (aIsSaved && !bIsSaved) return -1;
            if (!aIsSaved && bIsSaved) return 1;
            // Alphabetical sort by name
            return a.name.localeCompare(b.name);
        });

        sortedTrails.forEach(trail => {
            const isSaved = this.savedTrails.some(t => t.id === trail.id);
            
            // Create trail item
            const trailItem = document.createElement('div');
            trailItem.className = 'trail-item';
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
                saveBtn.addEventListener('click', () => this.saveTrail(trail.id));
                trailActions.appendChild(saveBtn);
            } else {
                const removeBtn = document.createElement('button');
                removeBtn.className = 'remove-btn';
                removeBtn.title = 'Remove trail';
                removeBtn.setAttribute('aria-label', 'Remove trail');
                const removeIcon = document.createElement('i');
                removeIcon.className = 'fas fa-trash';
                removeBtn.appendChild(removeIcon);
                removeBtn.addEventListener('click', () => this.removeTrail(trail.id));
                trailActions.appendChild(removeBtn);
            }
            
            const osmBtn = document.createElement('button');
            osmBtn.className = 'osm-btn';
            osmBtn.title = 'View on OpenStreetMap';
            osmBtn.setAttribute('aria-label', 'View on OSM');
            const osmIcon = document.createElement('i');
            osmIcon.className = 'fas fa-map';
            osmBtn.appendChild(osmIcon);
            osmBtn.addEventListener('click', () => {
                window.open(`https://www.openstreetmap.org/${trail.osmType || 'relation'}/${trail.id}`, '_blank');
            });
            trailActions.appendChild(osmBtn);
            
            // Add button to load parent relations
            const parentBtn = document.createElement('button');
            parentBtn.className = 'parent-btn';
            parentBtn.title = 'Load parent routes';
            parentBtn.setAttribute('aria-label', 'Load parents');
            const parentIcon = document.createElement('i');
            parentIcon.className = 'fas fa-sitemap';
            parentBtn.appendChild(parentIcon);
            parentBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                parentBtn.disabled = true;
                parentIcon.className = 'fas fa-spinner fa-spin';
                await this.loadAndDisplayParents(trail.id);
                parentIcon.className = 'fas fa-sitemap';
                parentBtn.disabled = false;
            });
            trailActions.appendChild(parentBtn);
            
            trailItem.appendChild(trailInfo);
            trailItem.appendChild(trailActions);
            
            // Display parent relations if loaded
            if (trail.parentRelations && trail.parentRelations.length > 0) {
                const parentsDiv = document.createElement('div');
                parentsDiv.className = 'trail-parents';
                parentsDiv.style.marginTop = '0.5rem';
                parentsDiv.style.paddingLeft = '1rem';
                parentsDiv.style.borderLeft = '2px solid #ddd';
                parentsDiv.style.fontSize = '0.85rem';
                parentsDiv.style.color = '#666';
                
                const parentsTitle = document.createElement('div');
                parentsTitle.style.fontWeight = '600';
                parentsTitle.style.marginBottom = '0.25rem';
                parentsTitle.textContent = 'Part of:';
                parentsDiv.appendChild(parentsTitle);
                
                trail.parentRelations.forEach(parent => {
                    const parentLink = document.createElement('div');
                    parentLink.style.marginBottom = '0.25rem';
                    
                    const parentName = document.createElement('span');
                    parentName.textContent = parent.name;
                    parentName.style.cursor = 'pointer';
                    parentName.style.color = '#2c7a3f';
                    parentName.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // Check if parent is in allTrails
                        const parentTrail = this.allTrails.find(t => t.id === parent.id);
                        if (parentTrail) {
                            this.toggleTrailHighlight(parent.id);
                        } else {
                            this.showToast(`Parent route not loaded: ${parent.name}`);
                        }
                    });
                    
                    if (parent.isSuperRoute) {
                        const superIcon = document.createElement('i');
                        superIcon.className = 'fas fa-layer-group';
                        superIcon.style.marginRight = '0.3rem';
                        parentLink.appendChild(superIcon);
                    }
                    
                    parentLink.appendChild(parentName);
                    parentsDiv.appendChild(parentLink);
                });
                
                trailItem.appendChild(parentsDiv);
            }
            
            trailsContainer.appendChild(trailItem);
            
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
        });
    }

    toggleTrailHighlight(trailId) {
        // Toggle highlighting
        if (this.highlightedTrailId === trailId) {
            // Un-highlight
            this.highlightedTrailId = null;
            const layerGroup = this.trailLayers.get(trailId);
            if (layerGroup) {
                const isSaved = this.savedTrails.some(t => t.id === trailId);
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
        } else {
            // Un-highlight previous trail
            if (this.highlightedTrailId) {
                const prevLayerGroup = this.trailLayers.get(this.highlightedTrailId);
                if (prevLayerGroup) {
                    const isSaved = this.savedTrails.some(t => t.id === this.highlightedTrailId);
                    const color = isSaved ? '#2c7a3f' : '#e74c3c';
                    if (prevLayerGroup.allPolylines) {
                        prevLayerGroup.allPolylines.forEach(polyline => {
                            polyline.setStyle({ 
                                color: color,
                                weight: 4, 
                                opacity: 0.7 
                            });
                        });
                    } else {
                        prevLayerGroup.setStyle({ 
                            color: color,
                            weight: 4, 
                            opacity: 0.7 
                        });
                    }
                }
                const prevListItem = document.querySelector(`[data-trail-id="${this.highlightedTrailId}"]`);
                if (prevListItem) {
                    prevListItem.classList.remove('selected');
                }
            }
            
            // Highlight new trail
            this.highlightedTrailId = trailId;
            const layerGroup = this.trailLayers.get(trailId);
            if (layerGroup) {
                if (layerGroup.allPolylines) {
                    layerGroup.allPolylines.forEach(polyline => {
                        polyline.setStyle({ 
                            color: '#2196F3', // Blue color
                            weight: 6, 
                            opacity: 1 
                        });
                        polyline.bringToFront();
                    });
                } else {
                    layerGroup.setStyle({ 
                        color: '#2196F3', // Blue color
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
            
            // Focus on the trail
            this.focusTrail(trailId);
        }
    }

    focusTrail(trailId) {
        const trail = this.allTrails.find(t => t.id == trailId);
        
        if (trail && trail.coordinates && trail.coordinates.length > 0) {
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
        const trail = this.allTrails.find(t => t.id == trailId);
        
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
        const trail = this.savedTrails.find(t => t.id == trailId);
        
        this.savedTrails = this.savedTrails.filter(t => t.id != trailId);
        this.saveSavedTrails();
        
        // Remove from allTrails if it was only saved (not from search)
        this.allTrails = this.allTrails.filter(t => t.id != trailId);
        
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
            
            this.allTrails = this.allTrails.filter(t => 
                !this.savedTrails.some(saved => saved.id === t.id)
            );
            
            this.savedTrails = [];
            this.saveSavedTrails();
            this.updateTrailsUI();
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

    async fetchParentRelations(relationId) {
        try {
            const response = await fetch(`https://www.openstreetmap.org/api/0.6/relation/${relationId}/relations`);
            
            if (!response.ok) {
                if (response.status === 404) {
                    // No parent relations found
                    return [];
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
            
            const relations = xmlDoc.getElementsByTagName('relation');
            const parents = [];
            
            for (let i = 0; i < relations.length; i++) {
                const relation = relations[i];
                const id = relation.getAttribute('id');
                const tags = {};
                
                const tagElements = relation.getElementsByTagName('tag');
                for (let j = 0; j < tagElements.length; j++) {
                    const tag = tagElements[j];
                    tags[tag.getAttribute('k')] = tag.getAttribute('v');
                }
                
                // Only include if it's a route or superroute
                if (tags.type === 'route' || tags.type === 'superroute') {
                    parents.push({
                        id: parseInt(id),
                        tags: tags,
                        name: tags.name || tags.ref || `Relation ${id}`,
                        isSuperRoute: tags.type === 'superroute'
                    });
                }
            }
            
            return parents;
        } catch (error) {
            console.error('Error fetching parent relations:', error);
            return [];
        }
    }

    async loadSuperRoutes(trailId, visited = new Set()) {
        // Prevent recursive loops
        if (visited.has(trailId)) {
            return null;
        }
        visited.add(trailId);
        
        // Check if already loaded in allTrails
        const existingTrail = this.allTrails.find(t => t.id === trailId);
        if (existingTrail && existingTrail.parentRelations) {
            return existingTrail;
        }
        
        const parents = await this.fetchParentRelations(trailId);
        
        if (parents.length === 0) {
            return null;
        }
        
        // Store parent info on the trail
        const trail = this.allTrails.find(t => t.id === trailId);
        if (trail) {
            trail.parentRelations = parents;
            
            // Recursively load parent relations
            for (const parent of parents) {
                if (!visited.has(parent.id)) {
                    // Check if parent is already in our trails
                    const parentInTrails = this.allTrails.find(t => t.id === parent.id);
                    if (!parentInTrails) {
                        // Fetch this parent trail too
                        const parentTrails = await this.fetchTrailsByRefs([parent.id.toString()]);
                        if (parentTrails.length > 0) {
                            const parentTrail = parentTrails[0];
                            this.allTrails.push(parentTrail);
                            // Recursively load its parents
                            await this.loadSuperRoutes(parent.id, visited);
                        }
                    } else {
                        // Load its parents recursively
                        await this.loadSuperRoutes(parent.id, visited);
                    }
                }
            }
        }
        
        return trail;
    }

    async loadAndDisplayParents(trailId) {
        try {
            await this.loadSuperRoutes(trailId);
            this.updateTrailsUI();
            this.showToast('Parent routes loaded!');
        } catch (error) {
            console.error('Error loading parent routes:', error);
            this.showToast('Error loading parent routes');
        }
    }
}

// Initialize the app
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new TrailsApp();
});
