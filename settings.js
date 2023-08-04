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
const aliasMap = new Proxy({}, {
    get: (target, name) => name in target ? target[name] : "Misc"
})  

Object.entries(categorySettings).forEach(([key, value]) => {
    value.alias.forEach((alias) => {
        colorMap[alias] = value.color;
        aliasMap[alias] = key;
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

const tableSettingsMap = {
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

function intFormatter(unit="") {
    return params => (params.value == null) ? null : params.value.toFixed(0)+unit;
}

var durationFilterParams = {
    allowedCharPattern: 'h\\d',
    numberParser: (text) => {
      return text == null
        ? null
        : text.split('h').reduce((h, m) => { return parseInt(h) * 60 + parseInt(m) }, 0);
    },
};

const tableSettingsList = [
    {
        headerName: "<i class='fa-solid fa-person'></i>",
        children: [
            {
                headerName: "type",
                field: 'type', 
                sortable: false,
                filter: false,
                cellClass: 'ag-left-aligned-cell',
                cellRenderer: (params) => `<i class='${categorySettings[aliasMap[params.value]].icon}' style='color:${colorMap[params.value]}' title=${params.value}></i>`,
                columnGroupShow: 'closed',
                width: 60,
            },
            {
                headerName: "type",
                field: 'type', 
                cellClass: 'ag-left-aligned-cell',
                columnGroupShow: 'open', 
            },
            {
                headerName: "virtual",
                valueGetter: (params) => params.data.type == "VirtualRide" || params.data.type == "VirtualRun",
                cellDataType: 'boolean',
                columnGroupShow: 'open',
                maxWidth: 90,
            }
        ]
    },
    {headerName: "<i class='fa-solid fa-route'></i>", children: [{
        headerName: "activity name",
        field: 'name', 
        suppressSizeToFit: false, 
        maxWidth: null, cellClass: 'ag-left-aligned-cell', 
        minWidth: 150,
        cellRenderer: (params) => `<a href='https://www.strava.com/activities/${params.data.id}' style='color:black; text-decoration:none;'>${params.data['name']}</a>`
    }]},
    {headerName: '<i class="fa-solid fa-calendar"></i>', children : [
        {
            headerName: "day", 
            valueGetter: (params) => new Date(params.data.start_date_local),
            valueFormatter: (params) => params.value.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit'}),
            cellDataType: 'date'
        },
        {
            headerName: "time", 
            valueGetter: (params) => {
                const date = new Date(params.data.start_date_local);
                return date.getHours()*3600+date.getMinutes()*60+date.getSeconds();
            },
            valueFormatter: (params) => {
                const hours = Math.floor(params.value/3600);
                const minutes = Math.floor((params.value%3600)/60);
                const seconds = params.value%60;
                return hours+":"+String(minutes).padStart(2, '0')+":"+String(seconds).padStart(2, '0');
            },
            cellDataType: 'number',
            //valueFormatter: (params) => Math.floor(params.value/60)+"h"+params.value%60,
            columnGroupShow: 'open' 
        }    
    ]},
    {headerName: "<i class='fa-solid fa-stopwatch'></i>", children: [
        {
            headerName: "elapsed", 
            valueGetter: (params) => Math.floor(params.data.elapsed_time/60),
            valueFormatter: (params) =>  Math.floor(params.value/60)+"h"+String(params.value%60).padStart(2, '0'),
            cellDataType: 'number',
            filterParams: durationFilterParams
        },
        {
            headerName: "moving", 
            valueGetter: (params) => Math.floor(params.data.moving_time/60),
            valueFormatter: (params) =>  Math.floor(params.value/60)+"h"+String(params.value%60).padStart(2, '0'),
            cellDataType: 'number',
            filterParams: durationFilterParams,
            columnGroupShow: 'open', 
        }
    ]},
    {
        headerName: "<i class='fa-solid fa-ruler-horizontal'></i>", 
        children: [
            {
                headerName: "dist",
                valueGetter: (params) => params.data.distance/1000,
                valueFormatter: (params) => params.value.toFixed(1)+"km",
                cellDataType: 'number'
            }
        ]
    },
    {headerName: "<i class='fa-solid fa-tachometer'></i>", children: [
            {headerName: "avg", 
            field: 'average_speed',
            valueGetter: (params) => params.data.average_speed*3.6,
            valueFormatter: (params) => params.value.toFixed(1)+"km/h",
            cellDataType: 'number'
        },
        {
            headerName: "max", 
            field: 'max_speed',
            columnGroupShow: 'open', 
            valueGetter: (params) => params.data.average_speed*3.6,
            valueFormatter: (params) => params.value.toFixed(1)+"km/h",
            cellDataType: 'number'
        }
    ]},
    {headerName: "<i class='fa-solid fa-ruler-vertical'></i>", children: [
        {
            headerName: "vert+", 
            field: 'total_elevation_gain', 
            valueFormatter: intFormatter('m'),
            cellDataType: 'number'
        },
        {
            headerName: "high(m)", 
            field: 'elev_high',
            columnGroupShow: 'open',
            valueFormatter: intFormatter('m'),
            cellDataType: 'number'
        },
        {
            headerName: "low(m)", 
            field: 'elev_low',
            columnGroupShow: 'open', 
            valueFormatter: intFormatter('m'),
            cellDataType: 'number'
        }
    ]},
    {headerName: "<i class='fa-solid fa-bolt-lightning'></i>", children: [
        {
            headerName: "wavg", 
            field: 'weighted_average_watts', 
            valueFormatter: intFormatter('W'),
            cellDataType: 'number'
        },
        {
            headerName: "avg", 
            field: 'average_watts',
            columnGroupShow: 'open', 
            valueFormatter: intFormatter('W'),
            cellDataType: 'number'
        },
        {
            headerName: "max(W)", 
            field: 'max_watts' ,
            columnGroupShow: 'open', 
            valueFormatter: intFormatter('W'),
            cellDataType: 'number'
        }
    ]},
    {headerName: "<i class='fa-solid fa-thumbs-up'></i>", children: [
        { 
            headerName: "kudos", field: 'kudos_count', cellDataType: 'number'
        }
    ]},
];

const tableSettingsListO = {
    "type": {
        "title": '<i class="fa-solid fa-person"></i>',
        "body": (feature) => `<i class='${categorySettings[aliasMap[feature.type]].icon}' style='color:${colorMap[feature["type"]]}' title=${feature.type}></i>`,
        "sort": (feature) => feature['type'],
        "visible": true,
        "sortable": false
    },
    "name": {
        "title": '<i class="fa-solid fa-route"></i>',
        "body": (feature) => `<a href='https://www.strava.com/activities/${feature.id}' style='color:black'>${feature['name']}</a>`,
        "sort": (feature) => feature['name'],
        "visible": true
    },
    "total_elevation_gain": {
        "title": '<i class="fa-solid fa-ruler-vertical"></i>',
        "body": (feature) => feature['total_elevation_gain'].toFixed(0),
        "visible": true
    },
    "elev_high": {
        "title": '<i class="fa-solid fa-mountain"></i>',
        "body": (feature) => (feature['elev_high'] == null) ? "" : feature['elev_high'].toFixed(0),
        "visible": true
    },
    "elev_low": {
        "title": '<i class="fa-solid fa-mountain fa-rotate-180"></i>',
        "body": (feature) => (feature['elev_low'] == null) ? "" : feature['elev_low'].toFixed(0),
        "visible": false
    },
    "distance": {
        "title": '<i class="fa-solid fa-ruler-horizontal"></i>',
        "body": (feature) => (feature['distance']/1000).toFixed(1),
        "visible": true
    },
    "elapsed_time": {
        "title": '<i class="fa-solid fa-clock"></i>',
        "body": (feature) => new Date(feature['elapsed_time']*1000).toISOString().substr(11, 8),
        "sort": (feature) => feature['elapsed_time'],
        "visible": true
    },
    "moving_time": {
        "title": '<i class="fa-solid fa-stopwatch"></i>',
        "body": (feature) => new Date(feature['moving_time']*1000).toISOString().substr(11, 8),
        "sort": (feature) => feature['moving_time'],
        "visible": false
    },
    "average_speed": {
        "title": '<i class="fa-solid fa-tachometer"></i>',
        "body": (feature) => (feature['average_speed']*3.6).toFixed(1),
        "sort": (feature) => feature['average_speed'],
        "visible": false
    },
    "average_watts": {
        "title": '<i class="fa-solid fa-bolt"></i>',
        "body": (feature) => (feature['average_watts'] == null) ? "" : feature['average_watts'].toFixed(0),
        "visible": false
    },
    "kudos_count": {
        "title": '<i class="fa-solid fa-thumbs-up"></i>',
        "body": (feature) => feature['kudos_count'],
        "visible": false
    },
    "start_date_local_timestamp": {
        "title": '<i class="fa-solid fa-calendar-days"></i>',
        "body": (feature) => new Date(feature['start_date_local_timestamp']*1000).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}),
        "sort": (feature) => feature['start_date_local_timestamp'],
        "visible": true
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

export {mapSettings, tableSettingsMap, tableSettingsList, filterSettings, categorySettings, colorMap, aliasMap};