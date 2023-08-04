import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import { Grid, UserComponentRegistry } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import "./manage.css";

import { createClient } from '@supabase/supabase-js'

import { categorySettings, aliasMap, tableSettingsList } from './settings.js';

const highlightColor = "#3298FD";
document.body.style.setProperty('--highlight-color', highlightColor);

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient("http://"+supabaseUrl, supabaseKey)

const url = new URL(window.location);
var activities;

let sidebar = document.querySelector(".sidebar");
let closeBtn = document.querySelector("#btn");

closeBtn.addEventListener("click", ()=>{
  sidebar.classList.toggle("open");
  menuBtnChange();
});

function menuBtnChange() {
 if(sidebar.classList.contains("open")){
   closeBtn.classList.replace("fa-bars", "fa-bars-staggered");//replacing the iocns class
 }else {
   closeBtn.classList.replace("fa-bars-staggered","fa-bars");//replacing the iocns class
 }
}

const strava_link = document.getElementById("strava-link");
const logout = document.getElementById("logout-link");

logout.onclick = () => {
    document.cookie = `athlete=; expires=Thu, 01-Jan-1970 00:00:01 GMT; path=/;`;
    window.location.href = "./index.html";
}

var dataTable; 

if (url.searchParams.has("id")) {
    console.log(url.searchParams.get("id"));
    supabase.from('strava-athletes-profile').select('*').eq('id',6824046)
        .then(response => {
            if (response.data.length > 0) {
                document.getElementById("user_name").innerText = response.data[0].first_name + " " + response.data[0].last_name;
                strava_link.removeChild(document.getElementById("user-placeholder"));
                const img = document.createElement("img");
                img.src = response.data[0].profile_medium;
                strava_link.insertAdjacentElement('afterbegin', img);
            }
    });

    document.addEventListener('DOMContentLoaded', () => {
        fetchSupabase(url.searchParams.get("id"));
    });
}


const categoryButtons = Object.entries(categorySettings).map(([key, value]) => {
    const button = {
        text: `<i class="${value.icon}" style="color:${value.active?value.color:"gray"}"></i>`,
        action: function ( e, dt, node, config ) {
            value.active = !value.active;
            e.currentTarget.firstChild.firstChild.style.color = value.active ? value.color : "gray";
            dt.draw();
        }
    }
    return button;
});

class CustomHeaderComp extends new UserComponentRegistry().agGridDefaults['agColumnHeader'] {
    init(params) {
        super.init(params)
        this.eGui.querySelector('[ref="eText"]').innerHTML = params.displayName;
    }
}
class CustomHeaderGroupComp extends new UserComponentRegistry().agGridDefaults['agColumnGroupHeader'] {
    init(params) {
        super.init(params)
        this.eGui.querySelector('[ref="agLabel"]').innerHTML = params.displayName;
    }
}

const gridOptions = {
    columnDefs: tableSettingsList,
    rowData: null,
    defaultColDef: {
        resizable: false,
        filter: true,
        sortable: true,
        floatingFilter: true,
        suppressMenu: true,
        suppressSizeToFit: true,
        maxWidth: 100,
        cellClass: 'ag-right-aligned-cell',
        cellStyle: { 'font-family': 'monospace' },
    },
    components: {
        agColumnHeader: CustomHeaderComp,
        agColumnGroupHeader: CustomHeaderGroupComp
    },
    pagination: true,
    onGridReady: (event) => { 
        event.api.sizeColumnsToFit();
        window.onresize = () => {
            event.api.sizeColumnsToFit();
        }
    },
    onColumnGroupOpened: (event) => event.api.sizeColumnsToFit(),
    getRowId: (params) => params.data.id,
}

const grid = new Grid(document.querySelector('#myGrid'), gridOptions);

async function fetchSupabase(athlete) {
    var requiredFields = new Set(["id","type"]);
    Object.keys(tableSettingsList).forEach((key) => {
        requiredFields.add(key);
    });
    //Array.from(requiredFields).join(','), 
    const response = await supabase.from('strava-activities').select("*",{ count: 'exact' }).eq('athlete',athlete).range(0,1000);
    activities = response.data;

    gridOptions.api.setRowData(response.data);

    console.log(activities[0]);
    const count = response.count;

    
    const pageSize = 1000;
    const numPages = Math.ceil(count / pageSize);
    const ranges = Array.from({ length: numPages - 1 }, (_, i) => [(i+1) * pageSize+1, (i + 2) * pageSize]);

    ranges.map((range) => {
        supabase.from('strava-activities').select('*').eq('athlete',athlete).range(...range)
        .then(response => {
            //gridOptions.rowData.concat(response.data);
            gridOptions.api.applyTransaction({add:response.data});
            //gridOptions.api.setRowData(response.data);
            //datatable.rows.add(response.data).draw();
            //table_body.innerHTML += response.data.map(tableRow).join('\n');
        })
    });
}



