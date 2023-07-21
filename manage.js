
import './sortable.css';
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import 'sortable-tablesort/sortable.min.js'
import { createClient } from '@supabase/supabase-js'

import { tableSettings } from './settings.js';

const highlightColor = "#3298FD";
document.body.style.setProperty('--highlight-color', highlightColor);

const supabaseUrl = 'https://yvkdmnzwrhvjckzyznwu.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2a2Rtbnp3cmh2amNrenl6bnd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODkzMTY4NjEsImV4cCI6MjAwNDg5Mjg2MX0.dTJIcC50-lwOTXHNsJ7fr4LVund8cI4LLQkJmED60BY'
const supabase = createClient(supabaseUrl, supabaseKey)

const url = new URL(window.location);

function tableRow(act) {
    const tableRows = Object.entries(tableSettings).map(function([id, column]) { 
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
const logout = document.getElementById("logout-link");

if (url.searchParams.has("id")) {
    logout.onclick = () => {
        document.cookie = `athlete=; expires=Thu, 01-Jan-1970 00:00:01 GMT; path=/;`;
        window.location.href = "./index.html";
    }

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
    thead.innerHTML = `<tr style="height:3em;">${Object.entries(tableSettings).map(([id, column]) => { return `<th>${column.title}</th>`; }).join("")}</tr>`;
    const tbody = document.createElement("tbody");
    const tfoot = document.createElement("tfoot");
    const tfootr = document.createElement("tr");
    const tfootd = document.createElement("td");
    tfootd.setAttribute("colspan",Object.entries(tableSettings).length);
    const footdiv = document.createElement("div");
    footdiv.id = "table-footer";
    tfootd.appendChild(footdiv);
    const tfootdspan = document.createElement("span");
    tfootdspan.innerText = "Loading...";
    footdiv.appendChild(tfootdspan);
    const load_button = document.createElement("button");
    load_button.style.marginLeft = "1em";
    load_button.style.padding = "5px";
    load_button.style.transform = "translateY(-2px)";
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

    fetchSupabase(url.searchParams.get("id"), tbody, tfootdspan);
}

async function fetchSupabase(athlete, table_body, tfoot) {
    const { nodata, counterror, count, status} = await supabase.from('strava-activities').select('*', { count: 'exact', head: true }).eq('athlete',athlete);

    tfoot.innerText = `${count} Activities`;

    var requiredFields = new Set(["id","type"]);
    Object.keys(tableSettings).forEach((key) => {
        requiredFields.add(key);
    });
    
    const pageSize = 1000;
    const numPages = Math.ceil(count / pageSize);
    const ranges = Array.from({ length: numPages }, (_, i) => [i * pageSize, (i + 1) * pageSize]);

    ranges.map((range) => {
        supabase.from('strava-activities').select(Array.from(requiredFields).join(','), {count: "exact"}).eq('athlete',athlete).range(...range)
        .then(response => {
            activities = response.data;
            table_body.innerHTML += response.data.map(tableRow).join('\n');
        })
    });
}



