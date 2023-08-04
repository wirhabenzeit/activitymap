import './style.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL


const url = new URL(window.location);
console.log(url.searchParams.get("code"));

if (url.searchParams.has("code")) {
    console.log("Code found!")
    fetch("http://"+supabaseUrl+"/functions/v1/strava-login?code=" + url.searchParams.get("code"))
    .then(response => {
        console.log(response)
        return response.json();
    })
    .then(data => {
        console.log(data);
        if (data.id) {
            const params = new URLSearchParams(data).toString();
            document.cookie = `athlete=${data.athlete}; max-age=${24*60*60*30}; path=/;`;
            window.location.href = "./manage.html?id=" + data.id;
        }
        else if (data.athlete) {
            document.cookie = `athlete=${data.athlete}; max-age=${24*60*60*30}; path=/;`;
            window.location.href = "./index.html";
        }
        else {
            document.getElementById("error").innerHTML = JSON.stringify(data);
        }
    });
}