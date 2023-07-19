
import './style.css';
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import 'sortable-tablesort/sortable.min.js'
import { createClient } from '@supabase/supabase-js'

const highlightColor = "#3298FD";
document.body.style.setProperty('--highlight-color', highlightColor);


const supabaseUrl = 'https://yvkdmnzwrhvjckzyznwu.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2a2Rtbnp3cmh2amNrenl6bnd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODkzMTY4NjEsImV4cCI6MjAwNDg5Mjg2MX0.dTJIcC50-lwOTXHNsJ7fr4LVund8cI4LLQkJmED60BY'
const supabase = createClient(supabaseUrl, supabaseKey)

const url = new URL(window.location);

const tableColumns = {
    "name": {
        "title": '<i class="fa-solid fa-route"></i>',
        "body": (act) => `<a href='https://www.strava.com/activities/${act.id}'>${act['name']}</a>`
    },
    "total_elevation_gain": {
        "title": '<i class="fa-solid fa-ruler-vertical"></i>',
        "body": (act) => act['total_elevation_gain'].toFixed(0)
    },
    "distance": {
        "title": '<i class="fa-solid fa-ruler-horizontal"></i>',
        "body": (act) => (act['distance']/1000).toFixed(1)
    },
    "elapsed_time": {
        "title": '<i class="fa-solid fa-stopwatch"></i>',
        "body": (act) => new Date(act['elapsed_time']*1000).toISOString().substr(11, 8)
    },
    "start_date_local": {
        "title": '<i class="fa-solid fa-calendar-days"></i>',
        "body": (act) => new Date(act['start_date_local_timestamp']*1000).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}),
        "sort": (act) => act['start_date_local_timestamp']
    }
};

function tableRow(act) {
    const tableRows = Object.entries(tableColumns).map(function([id, column]) { 
        if ("sort" in column) {
            return `<td data-sort='${column.sort(act)}'>${column.body(act)}</td>`;
        }
        else {
            return `<td>${column.body(act)}</td>`;
        }
    });
    return `<tr id=${act.id} class="${act['type']}">`+ tableRows.join("") + "</tr>";
}

var activities;

const table_container = document.getElementById("table-container");
const profile_container = document.getElementById("profile-container");

if (url.searchParams.has("profile")) {
    const profile = document.createElement("a");
    profile.href = "https://www.strava.com/athletes/" + url.searchParams.get("id");
    profile.style.textDecoration = "none";
    profile.innerHTML = `<div class="profile"><img src="${url.searchParams.get("profile")}"><h2>${url.searchParams.get("firstname")} ${url.searchParams.get("lastname")}</h2></div>`;
    profile_container.appendChild(profile);
}


if (url.searchParams.has("id")) {
    const table = document.createElement("table");
    table.classList.add("sortable");
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>${Object.entries(tableColumns).map(([id, column]) => { return `<th>${column.title}</th>`; }).join("")}</tr>`;
    const tbody = document.createElement("tbody");
    const tfoot = document.createElement("tfoot");
    const tfootr = document.createElement("tr");
    const tfootd = document.createElement("td");
    tfootd.setAttribute("colspan",Object.entries(tableColumns).length);
    tfootd.innerText = "Loading...";
    tfootr.appendChild(tfootd);
    tfoot.appendChild(tfootr);
    table.appendChild(thead);
    table.appendChild(tbody);
    table.appendChild(tfoot);
    table_container.appendChild(table);
    supabase.from('strava-activities').select("*", {count: "exact"}).eq('athlete',url.searchParams.get("id"))
    .then(response => {
        tbody.innerHTML = response.data.map(tableRow).join('\n');
        tfootd.innerText = `${response.count} Activities`;
    })
}



