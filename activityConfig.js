const sportsCategories = {
    "BackcountryNordicSki": {"color": "#1982C4", "icon": "fa-solid fa-person-skiing-nordic", "alias": ["BackcountrySki","NordicSki"]},
    "WalkRun": {"color": "#FF595E", "icon": "fa-solid fa-walking", "alias": ["Walk","Run","Hike","RockClimbing","Snowshoe"]},
    "Ride": {"color": "#8AC926", "icon": "fa-solid fa-biking", "alias": ["Ride","VirtualRide"]},
    "AlpineSki": {"color": "#3FA7D6", "icon": "fa-solid fa-person-skiing", "alias": ["AlpineSki"]},
    "Misc": {"color": "#6A4C93", "icon": "fa-solid fa-person-circle-question", "alias": []},
}

var activityFilters = {
    "start_date_local": { "icon": "fa-solid fa-calendar-days", "transform": "new Date(value).getTime()", "tooltip": '`new Date(${value}).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})`', "step": 7 * 24 * 60 * 60 * 1000, "decimals":0},
    "distance": { "icon": "fa-solid fa-ruler-horizontal", "transform": "value", "tooltip": '`${Math.round(value)/1000}km`', "step": 100, "decimals":0},
    "total_elevation_gain": { "icon": "fa-solid fa-ruler-vertical", "transform": "value", "tooltip": '`${Math.round(value)}m`', "step": 10, "decimals":0}
};

const tableColumns = {
    "name": { 
        "title": "TOUR", 
        "body": function(feature) { return `<a href='https://www.strava.com/activities/${feature.id_}' style='color:${colorMap[feature.values_["type"]]}'>${feature.values_['name']}</a>`; } 
    },
    "total_elevation_gain": {
        "title": "ELEV",
        "body": function(feature) { return feature.values_['total_elevation_gain'].toFixed(0); }
    },
    "distance": {
        "title": "DIST",
        "body": function(feature) { return (feature.values_['distance']/1000).toFixed(1); }
    },
    "elapsed_time": {
        "title": "TIME",
        "body": function(feature) { return new Date(feature.values_['elapsed_time']*1000).toISOString().substr(11, 8); }
    },
    "start_date_local": {
        "title": "DATE",
        "body": function(feature) { return new Date(feature.values_['start_date_local']).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}); },
        "sort": function(feature) { return new Date(feature.values_['start_date_local']).getTime(); }
    }
}

export { sportsCategories, activityFilters, colorMap, aliasMap, tableColumns };
//module.exports = { sportsCategories, activityFilters, colorMap, aliasMap, tableColumns };