# 🥾 OpenOutdoors - Hiking Trails Progressive Web App

A static Progressive Web App (PWA) for discovering, visualizing, and sharing hiking trails using OpenStreetMap data.

![OpenOutdoors App](https://github.com/user-attachments/assets/bee49fce-3d9f-4519-a898-52b5b971ec33)

## Features

✅ **Search Hiking Trails** - Search for hiking trails on OpenStreetMap using the Overpass API  
✅ **Interactive Map** - Visualize trails on an interactive map powered by Leaflet.js  
✅ **Current Location** - Show your current location on the map with GPS  
✅ **Nearby Trails** - Find trails near your current location with adjustable radius  
✅ **Save Trails** - Save your favorite trails to localStorage for offline access  
✅ **Share Trails** - Share selected trails with others via a simple URL  
✅ **Progressive Web App** - Installable, works offline, and provides app-like experience  
✅ **Responsive Design** - Works on mobile, tablet, and desktop devices  

## Technologies Used

- **OpenStreetMap** - Map tiles from `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- **Overpass API** - Trail data from `https://overpass-api.de/api/`
- **Leaflet.js** - Interactive map library
- **localStorage** - Client-side data persistence
- **Service Worker** - Offline functionality and caching
- **Vanilla JavaScript** - No frameworks, pure JS implementation

## Getting Started

### Prerequisites

- A modern web browser (Chrome, Firefox, Safari, Edge)
- A local web server (for testing)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/lemio/OpenOutdoors.git
cd OpenOutdoors
```

2. Start a local web server:
```bash
# Using Python 3
python3 -m http.server 8080

# Using Node.js
npx http-server -p 8080

# Using PHP
php -S localhost:8080
```

3. Open your browser and navigate to:
```
http://localhost:8080
```

### Deployment

This is a static web app with no backend requirements. You can deploy it to any static hosting service:

- **GitHub Pages**: Push to `gh-pages` branch
- **Netlify**: Connect your repository
- **Vercel**: Import your repository
- **Firebase Hosting**: `firebase deploy`
- **AWS S3**: Upload files to an S3 bucket with static hosting enabled

## Usage

### Search for Trails

1. **By Map Area**: 
   - Pan and zoom the map to your desired area
   - Enter a search term (optional)
   - Click "🔍 Search" to find trails in the visible map area

2. **By Location**:
   - Click "📍 My Location" to enable GPS and center the map
   - Set your desired search radius (1-50 km)
   - Click "🎯 Trails Near Me" to find nearby trails

### Save Trails

- Click the "💾" button on any trail in the search results
- Saved trails appear in the "Saved Trails" section
- Saved trails are stored in your browser's localStorage
- They persist even after closing the browser

### Share Trails

1. Save the trails you want to share
2. Click "🔗 Share Selected"
3. The share link is copied to your clipboard
4. Send the link to others - when they open it, they'll see your saved trails

### View Trail Details

- Click on any trail marker on the map to see a popup with details
- Click on a trail in the results list to focus the map on that trail

## Project Structure

```
OpenOutdoors/
├── index.html          # Main HTML file
├── app.js              # Application logic
├── styles.css          # Styling
├── manifest.json       # PWA manifest
├── service-worker.js   # Service worker for offline support
├── icon-192.png        # App icon (192x192)
├── icon-512.png        # App icon (512x512)
└── README.md          # This file
```

## Browser Compatibility

- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## License

This project is open source and available under the MIT License.

## Acknowledgments

- [OpenStreetMap](https://www.openstreetmap.org/) - Map data
- [Overpass API](https://overpass-api.de/) - Query service
- [Leaflet](https://leafletjs.com/) - Map library
- OpenStreetMap contributors worldwide

---

**Happy Hiking! 🥾⛰️**
