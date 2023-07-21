const categorySettings = {
    "BackcountryNordicSki": {
        "color": "#1982C4",
        "icon": "fa-solid fa-skiing-nordic",
        "alias": ["BackcountrySki","NordicSki"],
        "active": true
    },
    "WalkRun": {
        "color": "#FF595E",
        "icon": "fa-solid fa-walking",
        "alias": ["Walk","Run","Hike","RockClimbing","Snowshoe"],
        "active": true
    },
    "Ride": {
        "color": "#8AC926",
        "icon": "fa-solid fa-biking",
        "alias": ["Ride","VirtualRide"],
        "active": true
    },
    "AlpineSki": {
        "color": "#3FA7D6",
        "icon": "fa-solid fa-person-skiing",
        "alias": ["AlpineSki"],
        "active": true
    },
    "Misc": {
        "color": "#6A4C93",
        "icon": "fa-solid fa-person-circle-question",
        "alias": [], 
        "active": true
    }
}

const colorMap = new Proxy({}, {
    get: (target, name) => name in target ? target[name] : categorySettings["Misc"].color
})  

Object.entries(categorySettings).forEach(([key, value]) => {
    value.alias.forEach((alias) => {
        colorMap[alias] = value.color;
    });
});

const mapSettings = {
    "Mapbox Street": {url: 'mapbox://styles/mapbox/streets-v12?optimize=true', type: "vector", visible: true, overlay: false},
    "Mapbox Street 3D": {url: 'mapbox://styles/wirhabenzeit/clk6y6c1q00lk01pe8fqs0urn', type: "vector", visible: false, overlay: false},
    "Mapbox Outdoors": {url: 'mapbox://styles/mapbox/outdoors-v12?optimize=true', type: "vector", visible: false, overlay: false},
    "Mapbox Light": {url: 'mapbox://styles/mapbox/light-v11?optimize=true', type: "vector", visible: false, overlay: false},
    "Mapbox Topolight": {url: "mapbox://styles/wirhabenzeit/clk0tpduc00ab01qyguzi09gv", type: "vector", visible: false, overlay: false},
    "Mapbox Dark": {url: 'mapbox://styles/mapbox/dark-v11?optimize=true', type: "vector", visible: false, overlay: false},
    "Mapbox Satellite": {url: 'mapbox://styles/mapbox/satellite-v9?optimize=true', type: "vector", visible: false, overlay: false},
    "Swisstopo Light": {url: "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte.vt/style.json", type: "vector", visible: false, overlay: false},
    "Swisstopo Pixelkarte": {url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg`, type: "raster", visible: false, overlay: false},
    "Swisstopo Winter": {url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg`, type: "raster", visible: false, overlay: false},
    "Swisstopo Ski": {url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png`, type: "raster", visible: false, opacity: 0.8, overlay: true},
    "Swisstopo Slope": {url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png`, type: "raster", visible: false, opacity: 0.4, overlay: true},
    "Veloland": {url: `https://wmts.geo.admin.ch/1.0.0/ch.astra.veloland/default/current/3857/{z}/{x}/{y}.png`, type: "raster", visible: false, opacity: 0.4, overlay: true},
    "Wanderland": {url: `https://wmts.geo.admin.ch/1.0.0/ch.astra.wanderland/default/current/3857/{z}/{x}/{y}.png`, type: "raster", visible: false, opacity: 0.4, overlay: true}
};

const tableSettings = {
    "name": {
        "title": '<i class="fa-solid fa-route"></i>',
        "body": (feature) => `<a href='https://www.strava.com/activities/${feature.id}' style='color:${colorMap[feature["type"]]}'>${feature['name']}</a>`
    },
    "total_elevation_gain": {
        "title": '<i class="fa-solid fa-ruler-vertical"></i>',
        "body": (feature) => feature['total_elevation_gain'].toFixed(0)
    },
    "distance": {
        "title": '<i class="fa-solid fa-ruler-horizontal"></i>',
        "body": (feature) => (feature['distance']/1000).toFixed(1)
    },
    "elapsed_time": {
        "title": '<i class="fa-solid fa-stopwatch"></i>',
        "body": (feature) => new Date(feature['elapsed_time']*1000).toISOString().substr(11, 8)
    },
    "start_date_local_timestamp": {
        "title": '<i class="fa-solid fa-calendar-days"></i>',
        "body": (feature) => new Date(feature['start_date_local_timestamp']*1000).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}),
        "sort": (feature) => feature['start_date_local_timestamp']
    }
};

const filterSettings = {
    "start_date_local_timestamp": {
        "icon": "fa-solid fa-calendar-days",
        "tooltip": {to: (value) => new Date(value*1000).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'})},
        "step": 3600*24,
        "decimals": 0,
        "scale": (x) => x**(1/2)
    },
    "distance": {
        "icon": "fa-solid fa-ruler-horizontal",
        "tooltip": {to: (value) => `${Math.round(value)/1000}km`},
        "step": 1000,
        "decimals": 0,
        "scale": (x) => x**(2)
    },
    "total_elevation_gain": {
        "icon": "fa-solid fa-ruler-vertical",
        "tooltip": {to: (value) => `${Math.round(value)}m`},
        "step": 10,
        "decimals": 0,
        "scale": (x) => x**(2)
    },
    "elapsed_time": {
        "icon": "fa-solid fa-stopwatch",
        "tooltip": {to: (value) => `${new Date(value*1000).toISOString().substr(11, 8)}`},
        "step": 60,
        "decimals": 0,
        "scale": (x) => x**(2)
    }
};

export {mapSettings, tableSettings, filterSettings, categorySettings, colorMap};