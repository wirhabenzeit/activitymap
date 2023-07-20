
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

const profileColumns = {
    "Country": (data) => data["country"],
    "City": (data) => data["city"],
    "Sex": (data) => (data["sex"]=="F") ? `<i class="fa-solid fa-venus"></i>` : `<i class="fa-solid fa-mars"></i>`,
    "Weight": (data) => `${data["weight"]}kg`,
    "Premium": (data) => (data["summit"]) ? `<i class="fa-solid fa-check"></i>` : `<i class="fa-solid fa-xmark"></i>`,
    "Member since": (data) => new Date(data["created_at"]).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}),
};

function profileTable(data) {
    const tableRows = Object.entries(profileColumns).map(function([id, column]) { 
        return `<tr><td align="right" class="profile-table-left">${id}</td><td class="profile-table-right">${column(data)}</td></tr>`;
    });
    return tableRows.join("");
}

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

let sidebar = document.querySelector(".sidebar");
let closeBtn = document.querySelector("#btn");

closeBtn.addEventListener("click", ()=>{
  sidebar.classList.toggle("open");
  menuBtnChange();
});

// following are the code to change sidebar button(optional)
function menuBtnChange() {
 if(sidebar.classList.contains("open")){
   closeBtn.classList.replace("fa-bars", "fa-bars-staggered");//replacing the iocns class
 }else {
   closeBtn.classList.replace("fa-bars-staggered","fa-bars");//replacing the iocns class
 }
}

const strava_link = document.getElementById("strava-link");
const table_container = document.getElementById("table-container");

if (url.searchParams.has("id")) {
    strava_link.href = "https://www.strava.com/athletes/" + url.searchParams.get("id");
    fetch("https://yvkdmnzwrhvjckzyznwu.supabase.co/functions/v1/strava-athlete?id=" + url.searchParams.get("id"))
    .then(response => response.json())
    .then(data => {
        console.log(data);
        document.getElementsByClassName("links_name")[0].innerText = data.firstname + " " + data.lastname;
        strava_link.removeChild(document.getElementById("user-placeholder"));
        const img = document.createElement("img");
        img.src = data.profile_medium;
        strava_link.insertAdjacentElement('afterbegin', img);
    });

    const table = document.createElement("table");
    table.classList.add("sortable");
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr style="height:3em;">${Object.entries(tableColumns).map(([id, column]) => { return `<th>${column.title}</th>`; }).join("")}</tr>`;
    const tbody = document.createElement("tbody");
    const tfoot = document.createElement("tfoot");
    const tfootr = document.createElement("tr");
    const tfootd = document.createElement("td");
    tfootd.setAttribute("colspan",Object.entries(tableColumns).length);
    const footdiv = document.createElement("div");
    footdiv.id = "table-footer";
    tfootd.appendChild(footdiv);
    const tfootdspan = document.createElement("span");
    tfootdspan.innerText = "Loading...";
    footdiv.appendChild(tfootdspan);
    const load_button = document.createElement("button");
    load_button.style.marginLeft = "1em";
    load_button.innerText = "Load More";
    load_button.onclick = function() {
        load_button.disabled = true;
        load_button.innerText = "Loading...";
        fetch(`https://yvkdmnzwrhvjckzyznwu.supabase.co/functions/v1/strava-webhook?page=${Math.floor(activities.length/200)+1}&owner_id=${url.searchParams.get("id")}&aspect_type=create&object_type=activity`)
        .then(response => response.json())
        .then(data => {
            const newData = data.filter(act => !activities.some(a => a.id === act.id));
            activities = activities.concat(newData);
            tbody.insertAdjacentHTML('beforeend', newData.map(tableRow).join('\n'));
            tfootdspan.innerText = `${activities.length} Activities`;
            if (data.length == 200) {
                load_button.disabled = false;
                load_button.innerText = "Load More";
            }
            else {
                load_button.innerText = "No more activities";
            }
        })
    }
    footdiv.appendChild(load_button);
    tfootr.appendChild(tfootd);
    tfoot.appendChild(tfootr);
    table.appendChild(thead);
    table.appendChild(tbody);
    table.appendChild(tfoot);
    table_container.appendChild(table);
    supabase.from('strava-activities').select("*", {count: "exact"}).eq('athlete',url.searchParams.get("id"))
    .then(response => {
        activities = response.data;
        tbody.innerHTML = response.data.map(tableRow).join('\n');
        tfootdspan.innerText = `${response.count} Activities`;
    })
}



